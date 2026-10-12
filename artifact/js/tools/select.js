// Select tool: click, marquee, move (snapped), 8 scale handles, rotate zones, arrow nudges. Distort mode swaps
// the scale handles for a free quad: drag a corner anywhere, or a side to skew it.
import { boundsOf, mat, transformItem } from '../geometry.js';
import { distortContours, isConvexQuad } from '../organic.js';
import { findItem, updateItems } from '../model.js';
import { box, ctrl, handle, outline, toScreenContours } from '../overlay.js';

const HANDLES = [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]];   // [fx, fy] on the bbox
const RESIZE = ['nwse', 'ns', 'nesw', 'ew', 'nwse', 'ns', 'nesw', 'ew'].map(c => c + '-resize');
const ROTATE = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="#16181d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 6.5A6.5 6.5 0 1 0 16 11"/><path d="M16 3v4h-4"/></svg>')}") 10 10, crosshair`;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const LABEL = { move: 'Move', scale: 'Resize', rotate: 'Rotate', distort: 'Distort' };
const DISTORT_CURSOR = ['crosshair', 'crosshair', 'crosshair', 'crosshair', 'ew-resize', 'ns-resize', 'ew-resize', 'ns-resize'];
// Distort handles of a quad [TL, TR, BR, BL]: 0-3 its corners, 4-7 the midpoints of its edges (top, right, bottom, left).
const quadPoints = q => [...q, ...q.map((p, i) => ({ x: (p.x + q[(i + 1) % 4].x) / 2, y: (p.y + q[(i + 1) % 4].y) / 2 }))];
const nonZero = s => Math.abs(s) < 1e-3 ? (s < 0 ? -1e-3 : 1e-3) : s;

export default function create(ctx) {
  const { store, hit, snap, view } = ctx, st = ctx.getState;
  let g = null, cursor = '';

  const items = () => { const { doc, selection } = st(); return selection.map(id => findItem(doc, id)).filter(Boolean); };

  // Selection bounds in doc units (b) and screen px (x, y, w, h).
  function sbox() {
    const b = boundsOf(items());
    if (!b) return null;
    const a = view.toScreen(b.x, b.y), z = view.zoom();
    return { b, x: a.x, y: a.y, w: b.w * z, h: b.h * z };
  }

  const distorting = () => st().ui.distort && st().selection.length > 0;
  // The distort quad in doc units: the dragged one, else the selection bounds.
  function quad() {
    if (g?.kind === 'distort') return g.quad;
    const b = boundsOf(items());
    return b && [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  }

  // Scale handles that make sense at this size: none that would sit on top of each other or scale a zero extent.
  function handles(sb) {
    if (!sb) return [];
    return HANDLES.map(([fx, fy], i) => ({ i, fx, fy, x: sb.x + fx * sb.w, y: sb.y + fy * sb.h })).filter(h =>
      (h.fx === .5 ? sb.w >= 28 : sb.w >= 12 && sb.b.w > 0) && (h.fy === .5 ? sb.h >= 28 : sb.h >= 12 && sb.b.h > 0));
  }

  // What is under the pointer: { h } a scale handle, { rotate: true } a rotate zone, or null.
  function pick(e) {
    const sb = sbox();
    if (!sb) return null;
    const r = ctx.px(e);
    if (distorting()) {   // nearest of the 8 distort handles: { d: index }
      let d = -1, best = r;
      quadPoints(quad()).forEach((q, i) => { const s = view.toScreen(q.x, q.y), m = Math.hypot(s.x - e.sx, s.y - e.sy); if (m <= best) { d = i; best = m; } });
      return d < 0 ? null : { d };
    }
    let h = null, hd = Infinity;
    for (const c of handles(sb)) {
      const d = Math.hypot(c.x - e.sx, c.y - e.sy);
      if (Math.abs(c.x - e.sx) <= r && Math.abs(c.y - e.sy) <= r && d < hd) { h = c; hd = d; }
    }
    if (h) return { h };
    const outside = e.sx < sb.x || e.sx > sb.x + sb.w || e.sy < sb.y || e.sy > sb.y + sb.h;
    if (outside && sb.w + sb.h >= 24) {
      for (const x of [sb.x, sb.x + sb.w]) for (const y of [sb.y, sb.y + sb.h]) {
        const d = Math.hypot(x - e.sx, y - e.sy);
        if (d > r && d <= 3 * r) return { rotate: true };
      }
    }
    return null;
  }

  function begin(kind, e, extra) {
    const sel = items();
    g = { kind, e0: e, cur: e, moved: false, base: st().doc, ids: sel.map(i => i.id), b: boundsOf(sel), ...extra };
  }
  const apply = m => store.setDoc(updateItems(g.base, g.ids, it => transformItem(it, m)));

  function cancel() {
    if (!g) return false;
    if (g.moved && g.kind !== 'marquee') store.cancel();
    g = null;
    snap.clear();
    ctx.requestOverlay();
    return true;
  }

  function hover(e) {
    const p = pick(e);
    const id = p ? null : hit.item(e, ctx.px(e) / 2);
    const c = p?.rotate ? ROTATE : p?.d != null ? DISTORT_CURSOR[p.d] : p ? RESIZE[p.h.i] : id && st().selection.includes(id) ? 'move' : 'default';
    if (c !== cursor) ctx.setCursor(cursor = c);
  }

  // The quad for the current distort drag: a corner follows the pointer; a side slides both its corners along its
  // own axis (an exact skew). With Alt the opposite corner / side mirrors by -delta.
  function dragQuad(e) {
    const { i, q0, off } = g, h = quadPoints(q0)[i], p = snap.point({ x: e.x - off.x, y: e.y - off.y }, { meta: e.meta });
    const d = { x: p.x - h.x, y: p.y - h.y }, own = i < 4 ? [i] : [i - 4, (i - 3) % 4];
    if (i > 3) d[i % 2 ? 'x' : 'y'] = 0;
    return q0.map((c, k) => {
      const m = own.includes(k) ? 1 : e.alt && own.some(o => (o + 2) % 4 === k) ? -1 : 0;
      return { x: c.x + m * d.x, y: c.y + m * d.y };
    });
  }

  return {
    id: 'select', cursor: 'default',
    hint: () => distorting()
      ? 'Drag a corner to distort · drag a side to skew · Alt mirrors the opposite side · Esc to finish'
      : st().selection.length
      ? 'Drag to move · handles resize (Shift keeps proportions, Alt from centre) · outside a corner rotates'
      : 'Click to select · drag for a marquee · Shift adds · double-click edits points',
    deactivate: cancel,
    cancel,

    onPointerDown(e) {
      const p = pick(e);
      if (p?.d != null) {
        const q0 = quad(), h = quadPoints(q0)[p.d];
        return begin('distort', e, { i: p.d, q0, quad: q0, off: { x: e.x - h.x, y: e.y - h.y } });
      }
      if (p?.rotate) {
        const b = sbox().b, c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        return begin('rotate', e, { c, a0: Math.atan2(e.y - c.y, e.x - c.x) });
      }
      if (p) {
        const { b } = sbox(), { fx, fy } = p.h, hx = b.x + fx * b.w, hy = b.y + fy * b.h;
        return begin('scale', e, { fx, fy, hx, hy, off: { x: e.x - hx, y: e.y - hy } });
      }
      const id = hit.item(e, ctx.px(e) / 2), wasSel = !!id && st().selection.includes(id);
      if (!id) return begin('marquee', e);
      if (!wasSel) store.dispatch('select', { ids: [id], mode: e.shift ? 'add' : 'set' });
      begin('move', e, { id, wasSel });
    },

    onPointerMove(e) {
      if (!g) return hover(e);
      if (!e.down) return;
      g.cur = e;
      if (!g.moved) {
        if (Math.hypot(e.sx - g.e0.sx, e.sy - g.e0.sy) < 3) return;
        g.moved = true;
        if (g.kind !== 'marquee') { store.begin(); snap.setTargets(g.ids); }
      }
      if (g.kind === 'move' && g.b) {
        let dx = e.x - g.e0.x, dy = e.y - g.e0.y;
        const lockY = e.shift && Math.abs(dx) > Math.abs(dy), lockX = e.shift && !lockY;
        const s = snap.bbox(g.b, dx, dy, { meta: e.meta });
        dx = lockX ? 0 : s.dx; dy = lockY ? 0 : s.dy;
        apply(mat.translate(dx, dy));
      } else if (g.kind === 'scale') {
        const { b, fx, fy, hx, hy, off } = g;
        const q = snap.point({ x: fx === .5 ? hx : e.x - off.x, y: fy === .5 ? hy : e.y - off.y }, { meta: e.meta });
        const ax = e.alt ? b.x + b.w / 2 : b.x + (1 - fx) * b.w, ay = e.alt ? b.y + b.h / 2 : b.y + (1 - fy) * b.h;
        let sx = fx === .5 ? 1 : (q.x - ax) / (hx - ax), sy = fy === .5 ? 1 : (q.y - ay) / (hy - ay);
        if (e.shift) {
          const u = fx === .5 ? Math.abs(sy) : fy === .5 ? Math.abs(sx) : Math.max(Math.abs(sx), Math.abs(sy));
          sx = fx === .5 ? u : (Math.sign(sx) || 1) * u;
          sy = fy === .5 ? u : (Math.sign(sy) || 1) * u;
        }
        apply(mat.scale(nonZero(sx), nonZero(sy), ax, ay));
      } else if (g.kind === 'distort') {
        const q = dragQuad(e);
        if (isConvexQuad(q)) {   // a move that folds the quad over itself is ignored
          g.quad = q;
          store.setDoc(updateItems(g.base, g.ids, it => ({ ...it, contours: distortContours(it.contours, g.b, q) })));
        }
      } else if (g.kind === 'rotate') {
        let da = Math.atan2(e.y - g.c.y, e.x - g.c.x) - g.a0;
        if (e.shift) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
        apply(mat.rotate(da, g.c.x, g.c.y));
      }
      ctx.requestOverlay();
    },

    onPointerUp(e) {
      const q = g;
      g = null;
      snap.clear();
      if (!q) return;
      if (q.kind === 'marquee') {
        if (q.moved) {
          const x = Math.min(q.e0.x, e.x), y = Math.min(q.e0.y, e.y);
          store.dispatch('select', { ids: ctx.hit.itemsInRect({ x, y, w: Math.abs(e.x - q.e0.x), h: Math.abs(e.y - q.e0.y) }), mode: e.shift ? 'add' : 'set' });
        } else if (!e.shift) store.dispatch('clearSelection');
      } else if (q.moved) store.commit(LABEL[q.kind]);
      else if (q.kind === 'move' && q.wasSel) {   // a plain click on a selected item: shift drops it, otherwise it becomes the only one
        if (e.shift) store.dispatch('select', { ids: [q.id], mode: 'toggle' });
        else if (st().selection.length > 1) store.dispatch('select', { ids: [q.id] });
      }
      ctx.requestOverlay();
    },

    onDoubleClick(e) {
      const id = hit.item(e, ctx.px(e) / 2);
      if (!id) return;
      store.dispatch('select', { ids: [id] });
      store.dispatch('setTool', { id: 'node' });
    },

    onKeyDown(k) {
      if (k.key === 'Escape' && st().ui.distort) {   // first Esc drops a drag, the next leaves distort mode
        if (!cancel()) store.dispatch('setUI', { distort: false });
        return true;
      }
      const d = ARROWS[k.key], ids = st().selection;
      if (!d || g || !ids.length || k.metaKey || k.ctrlKey || k.altKey) return false;
      const n = k.shiftKey ? 10 : 1, m = mat.translate(d[0] * n, d[1] * n);
      store.begin();
      store.setDoc(updateItems(st().doc, ids, it => transformItem(it, m)));
      store.commit('Nudge', 'nudge');
      return true;
    },

    renderOverlay() {
      const v = st().viewport, sb = sbox();
      let out = items().map(it => outline(toScreenContours(it.contours, v))).join('');
      if (sb && distorting()) {
        const pts = quadPoints(quad()).map(q => view.toScreen(q.x, q.y));
        out += outline([{ closed: true, nodes: pts.slice(0, 4).map(q => ({ ...q, hi: null, ho: null })) }], 'ov-bbox')
          + pts.slice(0, 4).map(q => handle(q.x, q.y)).join('') + pts.slice(4).map(q => ctrl(q.x, q.y)).join('');
      } else if (sb) out += box(sb) + handles(sb).map(h => handle(h.x, h.y)).join('');
      if (g?.kind === 'marquee' && g.moved) {
        const a = g.e0, b = g.cur;
        out += box({ x: Math.min(a.sx, b.sx), y: Math.min(a.sy, b.sy), w: Math.abs(a.sx - b.sx), h: Math.abs(a.sy - b.sy) }, 'ov-marquee');
      }
      return out;
    },
  };
}
