// Node tool: edit the anchors and handles of the selected items.
import { insertNode, isSmooth, moveHandle, moveNode, nearestOnItem, removeNode, setSmooth } from '../geometry.js';
import { bendSegment } from '../organic.js';
import { findItem, removeItems, updateItems } from '../model.js';
import { anchor, box, ctrl, line, outline, toScreenContours } from '../overlay.js';

const LABELS = { handle: 'Move handle', bend: 'Bend', move: 'Move points' };
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Apply fn to one contour of one item / to all contours of one item.
const mapContours = (doc, id, fn) => updateItems(doc, [id], it => ({ ...it, contours: fn(it.contours) }));
const mapContour = (doc, id, ci, fn) => mapContours(doc, id, cs => cs.map((c, i) => i === ci ? fn(c) : c));
// Move the picked nodes (each carries its original node `n`) by (dx, dy).
const moveAll = (doc, picks, dx, dy) =>
  picks.reduce((d, a) => mapContour(d, a.id, a.ci, c => moveNode(c, a.ni, { x: a.n.x + dx, y: a.n.y + dy })), doc);

export default function create(ctx) {
  const { store, hit, snap, view } = ctx, st = ctx.getState;
  let picked = new Set(), g = null, cursor = '';   // picked: 'id|ci|ni' keys of selected anchors
  const key = (id, ci, ni) => `${id}|${ci}|${ni}`;

  // Every anchor of the selected items with its screen position.
  function anchors() {
    const { doc, selection } = st(), out = [];
    for (const k of picked) if (!selection.includes(k.split('|')[0])) picked.delete(k);
    for (const id of selection) {
      findItem(doc, id)?.contours.forEach((c, ci) => c.nodes.forEach((n, ni) =>
        out.push({ id, ci, ni, n, k: key(id, ci, ni), ...view.toScreen(n.x, n.y) })));
    }
    return out;
  }
  const near = (list, e, r) => {
    let best = null, bd = r;
    for (const a of list) { const d = Math.hypot(a.x - e.sx, a.y - e.sy); if (d <= bd) { best = a; bd = d; } }
    return best;
  };
  // The segment of a selected item within pick range of the pointer: { id, h } with h from nearestOnItem.
  function segAt(e) {
    const { doc, selection } = st(), r = ctx.px(e);
    let best = null;
    for (const id of selection) {
      const h = nearestOnItem(findItem(doc, id), e);
      if (h && h.dist * view.zoom() <= r && (!best || h.dist < best.h.dist)) best = { id, h };
    }
    return best;
  }
  // Handles of the picked anchors (only those that exist), with screen positions.
  const handlesOf = list => list.flatMap(a => ['hi', 'ho'].filter(w => a.n[w])
    .map(w => ({ ...a, w, anchor: { x: a.x, y: a.y }, ...view.toScreen(a.n[w].x, a.n[w].y) })));

  function commit(label, doc, coalesce) {
    store.begin();
    store.setDoc(doc);
    store.commit(label, coalesce);
  }

  function cancel() {
    if (!g) return false;
    if (g.moved && g.kind !== 'marquee') store.cancel();
    g = null;
    snap.clear();
    ctx.requestOverlay();
    return true;
  }

  function remove(list) {
    let { doc } = st();
    for (const id of new Set(list.map(a => a.id))) {
      const cs = findItem(doc, id).contours
        .map((c, ci) => list.filter(a => a.id === id && a.ci === ci).map(a => a.ni).sort((a, b) => b - a)
          .reduce((acc, ni) => removeNode(acc, ni), c))
        .filter(c => c.nodes.length >= 2);
      doc = cs.length ? mapContours(doc, id, () => cs) : removeItems(doc, [id]);
    }
    picked.clear();
    commit('Delete points', doc);
  }

  return {
    id: 'node', cursor: 'default',
    hint: () => 'Click a point to select it · drag to move · Alt-click smooths or corners · double-click a segment to add a point',
    deactivate() { cancel(); picked.clear(); },
    cancel,

    onPointerDown(e) {
      const all = anchors(), r = ctx.px(e);
      const pickedList = all.filter(a => picked.has(a.k));
      const h = near(handlesOf(pickedList), e, r);
      if (h) { g = { kind: 'handle', a: h, e0: e, base: st().doc, moved: false }; return; }

      const a = near(all, e, r);
      if (a && e.alt) {                                   // Alt-click: toggle smooth / corner
        picked = new Set([a.k]);
        commit('Toggle smooth', mapContour(st().doc, a.id, a.ci, c => setSmooth(c, a.ni, !isSmooth(c.nodes[a.ni]))));
        return ctx.requestOverlay();
      }
      if (a) {
        if (e.shift && picked.has(a.k)) { picked.delete(a.k); return ctx.requestOverlay(); }
        if (e.shift || !picked.has(a.k)) picked = e.shift ? new Set([...picked, a.k]) : new Set([a.k]);
        g = { kind: 'move', a, list: all.filter(x => picked.has(x.k)), e0: e, base: st().doc, moved: false, shift: e.shift };
        return ctx.requestOverlay();
      }
      const sg = !e.alt && segAt(e);                      // press on a segment of a selected item: bend it
      if (sg) { g = { kind: 'bend', id: sg.id, ci: sg.h.ci, seg: sg.h.seg, t: sg.h.t, e0: e, base: st().doc, moved: false, shift: e.shift }; return; }
      const id = hit.item(e, r / 2);
      if (id && !st().selection.includes(id)) {
        picked.clear();
        return store.dispatch('select', { ids: [id], mode: e.shift ? 'add' : 'set' });
      }
      g = { kind: 'marquee', e0: e, cur: e, moved: false };
    },

    onPointerMove(e) {
      if (!g) {
        const c = near(anchors(), e, ctx.px(e)) ? 'move' : segAt(e) ? 'grab' : 'default';
        if (c !== cursor) ctx.setCursor(cursor = c);
        return;
      }
      if (!e.down) return;
      g.cur = e;
      if (!g.moved) {
        if (Math.hypot(e.sx - g.e0.sx, e.sy - g.e0.sy) < 3) return;
        g.moved = true;
        if (g.kind !== 'marquee') { store.begin(); snap.setTargets(g.kind === 'move' ? g.list.map(a => a.id) : [g.a?.id ?? g.id]); }
      }
      const dx = e.x - g.e0.x, dy = e.y - g.e0.y;
      if (g.kind === 'handle') {
        const { a } = g, p0 = a.n[a.w], p = snap.point({ x: p0.x + dx, y: p0.y + dy }, { meta: e.meta });
        store.setDoc(mapContour(g.base, a.id, a.ci, c => moveHandle(c, a.ni, a.w, p, { mirror: !e.alt })));
      } else if (g.kind === 'bend') {
        store.setDoc(mapContour(g.base, g.id, g.ci, c => bendSegment(c, g.seg, g.t, { x: dx, y: dy })));   // always from the base contour
      } else if (g.kind === 'move') {
        const q = snap.point({ x: g.a.n.x + dx, y: g.a.n.y + dy }, { meta: e.meta });
        store.setDoc(moveAll(g.base, g.list, q.x - g.a.n.x, q.y - g.a.n.y));
      }
      ctx.requestOverlay();
    },

    onPointerUp(e) {
      const q = g;
      g = null;
      snap.clear();
      if (!q) return;
      if (q.kind === 'marquee') {
        const x0 = Math.min(q.e0.sx, e.sx), x1 = Math.max(q.e0.sx, e.sx), y0 = Math.min(q.e0.sy, e.sy), y1 = Math.max(q.e0.sy, e.sy);
        if (q.moved) {
          const inside = anchors().filter(a => a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1).map(a => a.k);
          picked = new Set([...(e.shift ? picked : []), ...inside]);
        } else if (!e.shift) picked.clear();
      } else if (q.moved) store.commit(LABELS[q.kind]);
      else if (q.kind === 'move' && !q.shift) picked = new Set([q.a.k]);
      else if (q.kind === 'bend' && !q.shift) picked.clear();
      ctx.requestOverlay();
    },

    onDoubleClick(e) {
      if (near(anchors(), e, ctx.px(e))) return;
      const best = segAt(e);
      if (!best) return;
      const { id, h } = best;
      commit('Add point', mapContour(st().doc, id, h.ci, c => insertNode(c, h.seg, h.t)));
      picked = new Set([key(id, h.ci, h.seg + 1)]);
      ctx.requestOverlay();
    },

    onKeyDown(k) {
      if (k.key === 'Escape') {
        if (!cancel()) {
          if (picked.size) picked.clear(); else store.dispatch('setTool', { id: 'select' });
        }
        ctx.requestOverlay();
        return true;
      }
      const list = anchors().filter(a => picked.has(a.k)), d = ARROWS[k.key];
      if (!list.length || g || k.metaKey || k.ctrlKey) return false;
      if (k.key === 'Delete' || k.key === 'Backspace') { remove(list); return true; }
      if (!d) return false;
      const n = k.shiftKey ? 10 : 1;
      commit('Nudge', moveAll(st().doc, list, d[0] * n, d[1] * n), 'nudge');
      return true;
    },

    renderOverlay() {
      const { doc, selection, viewport: v } = st(), all = anchors(), sel = all.filter(a => picked.has(a.k));
      let out = selection.map(id => outline(toScreenContours(findItem(doc, id)?.contours ?? [], v))).join('');
      for (const h of handlesOf(sel)) out += line(h.anchor, h) + ctrl(h.x, h.y);
      for (const a of all) out += anchor(a.x, a.y, picked.has(a.k));
      if (g?.kind === 'marquee' && g.moved) {
        const { e0, cur } = g;
        out += box({ x: Math.min(e0.sx, cur.sx), y: Math.min(e0.sy, cur.sy), w: Math.abs(e0.sx - cur.sx), h: Math.abs(e0.sy - cur.sy) }, 'ov-marquee');
      }
      return out;
    },
  };
}
