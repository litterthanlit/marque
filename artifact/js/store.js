// Store: one immutable state tree, a history of {doc, selection} references, and a gesture API
// (begin / setDoc / commit / cancel) so a whole drag becomes a single undo step.
import { LIMITS, DEFAULT_STYLE, TOOLS } from './consts.js';
import { findItem, itemIndex, makeDoc, addItems, updateItems, removeItems, reorder, reorderTo,
         duplicateItems, setArtboard, uid } from './model.js';
import { mat, boundsOf, transformItem, rectContours, ellipseContours, polygonContours } from './geometry.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const TOOL_IDS = TOOLS.map(t => t.id);
const NAMES = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };
const NOOP = [1, 0, 0, 1, 0, 0];

// Contours of a live shape for a box and params. The shape tool uses it too, for its first draw and preview.
export function liveContours(kind, box, p) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (kind === 'rect') return rectContours(box.x, box.y, box.w, box.h, p.radius || 0);
  if (kind === 'ellipse') return ellipseContours(cx, cy, box.w / 2, box.h / 2);
  return polygonContours(cx, cy, box.w / 2, box.h / 2, p.sides, { star: p.star, inner: p.inner });
}

export function createStore({ bridge }) {
  let s = {
    doc: makeDoc(), selection: [], tool: 'select', live: null,
    toolOpts: { radius: 0, sides: 5, star: false, inner: 0.5 },
    style: { ...DEFAULT_STYLE },
    viewport: { zoom: 1, panX: 0, panY: 0, w: 0, h: 0, fitted: false },
    ui: { grid: false, snap: true, theme: 'system', sheet: null, panel: null, toast: null, example: false,
          assist: 'unknown', busy: null },
    history: { canUndo: false, canRedo: false },
  };
  let undoStack = [], redoStack = [], gesture = null, last = { key: null, t: 0 };
  let toastId = 0, fitPad = 48, notified = s, flushing = false;
  const subs = new Set();
  const flags = () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  const unExample = ui => ui.example ? { ...ui, example: false } : ui;
  const selected = () => s.doc.items.filter(i => s.selection.includes(i.id));   // stack order

  function set(patch) {
    const prev = s, next = { ...s, ...patch };
    if (next.doc !== prev.doc && next.selection.length) {            // drop ids that no longer exist
      const have = new Set(next.doc.items.map(i => i.id));
      if (!next.selection.every(id => have.has(id))) next.selection = next.selection.filter(id => have.has(id));
    }
    if (next.live && !('live' in patch) && (next.doc !== prev.doc || next.selection !== prev.selection) &&
        (!sameList(next.selection, prev.selection) || findItem(next.doc, next.live.id)?.contours !== next.live.contours)) {
      next.live = null;
    }
    s = next;
    flush();
  }

  // Subscribers run synchronously; a dispatch from inside one is queued and delivered right after.
  function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (notified !== s) {
        const prev = notified;
        notified = s;
        for (const fn of [...subs]) { try { fn(s, prev); } catch (err) { console.error(err); } }
      }
    } finally { flushing = false; }
  }

  // Push `base` ({doc, selection} before the change) onto undo, or fold it into the previous entry when the
  // same coalesce key repeats within 1000 ms. Returns the state fields every history push changes.
  function record(base, key = null) {
    const now = Date.now();
    if (!(key && key === last.key && now - last.t < 1000 && undoStack.length)) {
      undoStack.push(base);
      if (undoStack.length > LIMITS.history) undoStack.shift();
    }
    last = { key, t: now };
    redoStack = [];
    return { ui: unExample(s.ui), history: flags() };
  }

  function edit(doc, extra = {}, key = null) {
    if (doc === s.doc) return;
    set({ doc, ...extra, ...record({ doc: s.doc, selection: s.selection }, key) });
  }

  function travel(from, to) {
    if (gesture || !from.length) return;
    const e = from.pop(), resized = e.doc.w !== s.doc.w || e.doc.h !== s.doc.h;
    to.push({ doc: s.doc, selection: s.selection });
    last = { key: null, t: 0 };
    set({ doc: e.doc, selection: e.selection, live: null, ui: unExample(s.ui), history: flags() });
    if (resized && s.viewport.fitted) A.zoomFit({});
  }

  const merge = (key, p) => {
    const cur = s[key];
    if (Object.keys(p).some(k => cur[k] !== p[k])) set({ [key]: { ...cur, ...p } });
  };
  const vp = p => merge('viewport', p);

  function zoomAt(zoom, cx, cy) {
    const v = s.viewport, z = clamp(zoom, LIMITS.zoomMin, LIMITS.zoomMax), k = z / v.zoom;
    vp({ zoom: z, panX: cx - (cx - v.panX) * k, panY: cy - (cy - v.panY) * k, fitted: false });
  }

  // Run a matrix (built from the selection bounds) over the selected items as one undo step.
  function transformSelection(matFor) {
    const items = selected(), b = boundsOf(items);
    if (!b) return;
    const m = matFor(b);
    if (m.every((v, i) => Math.abs(v - NOOP[i]) < 1e-9)) return;
    edit(updateItems(s.doc, items.map(i => i.id), it => transformItem(it, m)));
  }

  // Imports bigger than the artboard shrink to fit with an 8% margin and are centred.
  function fitItems(items) {
    const b = boundsOf(items), { w, h } = s.doc;
    if (!b || (b.w <= w && b.h <= h)) return items;
    const k = Math.min(0.84 * w / (b.w || 1), 0.84 * h / (b.h || 1)), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const m = mat.multiply(mat.translate(w / 2 - cx, h / 2 - cy), mat.scale(k, k, cx, cy));
    return items.map(it => transformItem(it, m));
  }

  // Replace `src` (stack order) by one new item at the bottom-most source's position.
  function combine(src, patch, base = src[0]) {
    const item = { ...base, id: uid(), locked: false, visible: true, ...patch };
    edit(addItems(removeItems(s.doc, src.map(i => i.id)), [item], itemIndex(s.doc, src[0].id)), { selection: [item.id] });
  }

  const idsOf = p => p.ids ?? s.selection;
  const needPaper = what => !bridge.available && (A.toast({ text: `${what} need Paper.js, which did not load.` }), true);

  const A = {
    newDoc({ w, h } = {}) {
      const d = s.doc;
      edit(makeDoc({ w: w ?? d.w, h: h ?? d.h }), { selection: [], live: null });
      A.toast({ text: 'New drawing. Undo brings the old one back.' });
      if (s.doc.w !== d.w || s.doc.h !== d.h) A.zoomFit({});
    },
    loadDoc({ doc, example = false }) {
      undoStack = []; redoStack = []; gesture = null; last = { key: null, t: 0 };
      set({ doc, selection: [], live: null, ui: { ...s.ui, example: !!example }, history: flags() });
      A.zoomFit({});
    },
    setArtboard({ w, h }) { edit(setArtboard(s.doc, w, h)); A.zoomFit({}); },

    addItems({ items, select = true, fit = false, live }) {
      if (!items?.length) return;
      if (s.doc.items.length + items.length > LIMITS.maxItems) {
        return A.toast({ text: `A drawing holds up to ${LIMITS.maxItems} paths.` });
      }
      if (fit) items = fitItems(items);
      const doc = addItems(s.doc, items), ids = items.map(i => i.id), first = live && findItem(doc, ids[0]);
      edit(doc, {
        ...(select && { selection: ids }),
        ...(first && { live: { id: first.id, kind: live.kind, box: live.box, params: { ...live.params }, contours: first.contours } }),
      });
    },
    updateItems({ ids = s.selection, patch, coalesce }) { if (ids.length) edit(updateItems(s.doc, ids, patch), {}, coalesce); },
    deleteItems(p = {}) { if (idsOf(p).length) edit(removeItems(s.doc, idsOf(p))); },
    duplicateItems(p = {}) {
      const r = duplicateItems(s.doc, idsOf(p));
      if (r.ids.length) edit(r.doc, { selection: r.ids });
    },
    reorder(p) { edit(reorder(s.doc, idsOf(p), p.to)); },
    reorderTo({ id, index }) { edit(reorderTo(s.doc, id, index)); },

    setBounds(p) {
      transformSelection(b => {
        const w = p.w ?? b.w, h = p.h ?? b.h;
        return mat.multiply(mat.translate(p.x ?? b.x, p.y ?? b.y), mat.multiply(
          mat.scale(b.w > 0 && w > 0 ? w / b.w : 1, b.h > 0 && h > 0 ? h / b.h : 1), mat.translate(-b.x, -b.y)));
      });
    },
    flip({ axis }) {
      transformSelection(b => mat.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, b.x + b.w / 2, b.y + b.h / 2));
    },
    rotate({ deg }) { transformSelection(b => mat.rotate(deg * Math.PI / 180, b.x + b.w / 2, b.y + b.h / 2)); },

    booleanOp({ kind }) {
      const src = selected();
      if (src.length < 2 || needPaper('Boolean operations')) return;
      let contours;
      try { contours = bridge.booleanOp(src, kind); } catch { return A.toast({ text: 'That operation did not work on these shapes.' }); }
      if (!contours.length) return A.toast({ text: 'Nothing is left after that.' });
      combine(src, { contours, name: NAMES[kind], fillRule: 'evenodd' });
    },
    flatten() {
      const src = selected(), top = [...src].reverse().find(i => i.op === 'add' && i.visible);
      if (src.length < 2 || !top || needPaper('Flatten')) return;
      let r;
      try { r = bridge.flatten(src); } catch { return A.toast({ text: 'Those shapes could not be flattened.' }); }
      if (!r.contours.length) return A.toast({ text: 'Nothing is left to flatten.' });
      combine(src, { contours: r.contours, name: 'Flattened', op: 'add', fillRule: 'evenodd' }, top);
    },

    // Regenerate the live shape from its box and the new params.
    setLive({ params }) {
      const l = s.live;
      if (!l) return;
      const next = { ...l.params, ...params };
      const doc = updateItems(s.doc, [l.id], { contours: liveContours(l.kind, l.box, next) });
      const it = findItem(doc, l.id);
      if (it) edit(doc, { live: { ...l, params: next, contours: it.contours } }, 'live');
    },

    select({ ids = [], mode = 'set' }) {
      const ok = id => { const it = findItem(s.doc, id); return it && it.visible && !it.locked; };
      let cur = mode === 'set' ? [] : s.selection;
      for (const id of ids) {
        if (!cur.includes(id)) { if (ok(id)) cur = [...cur, id]; }
        else if (mode === 'toggle') cur = cur.filter(x => x !== id);
      }
      if (!sameList(cur, s.selection)) set({ selection: cur });
    },
    selectAll() { A.select({ ids: s.doc.items.map(i => i.id) }); },
    clearSelection() { A.select({ ids: [] }); },

    setTool({ id }) { if (TOOL_IDS.includes(id) && id !== s.tool) set({ tool: id }); },
    setToolOpt({ key, value }) { merge('toolOpts', { [key]: value }); },
    setStyle({ patch }) { merge('style', patch); },
    setUI(p) { merge('ui', p); },
    toast({ text }) { set({ ui: { ...s.ui, toast: { id: ++toastId, text } } }); },

    setViewport(p) { vp(p); },
    zoomBy({ factor, cx = s.viewport.w / 2, cy = s.viewport.h / 2 }) { zoomAt(s.viewport.zoom * factor, cx, cy); },
    zoomTo({ zoom }) { zoomAt(zoom, s.viewport.w / 2, s.viewport.h / 2); },
    // `pad` (screen px kept clear around the artboard) comes from app.js, which reads --fit-pad from CSS.
    // It is remembered, so later zoomFit dispatches without a pad (the zoom readout) reuse it.
    zoomFit({ pad } = {}) {
      if (pad != null) fitPad = pad;
      const { w, h } = s.viewport, d = s.doc;
      if (!w || !h) return;
      const z = clamp(Math.min(Math.max(w - 2 * fitPad, w / 2) / d.w, Math.max(h - 2 * fitPad, h / 2) / d.h), LIMITS.zoomMin, LIMITS.zoomMax);
      vp({ zoom: z, panX: (w - d.w * z) / 2, panY: (h - d.h * z) / 2, fitted: true });
    },
    panBy({ dx, dy }) { vp({ panX: s.viewport.panX + dx, panY: s.viewport.panY + dy, fitted: false }); },

    undo() { travel(undoStack, redoStack); },
    redo() { travel(redoStack, undoStack); },
  };

  const store = {
    getState: () => s,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    dispatch(type, payload = {}) {
      if (A[type]) A[type](payload); else console.warn('Unknown action', type);
    },
    begin() {
      if (gesture) store.cancel();
      gesture = { doc: s.doc, selection: s.selection, live: s.live };
    },
    setDoc(doc) { set({ doc }); },
    commit(label, key) {
      const g = gesture;
      gesture = null;
      if (g && s.doc !== g.doc) set(record(g, key));
    },
    cancel() {
      const g = gesture;
      gesture = null;
      if (g) set({ doc: g.doc, selection: g.selection, live: g.live });
    },
  };
  return store;
}
