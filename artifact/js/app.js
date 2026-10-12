// Entry module: boots store + tools, owns the canvas (render loop, pointer, wheel, keyboard) and persistence.
import { createBridge } from './paperBridge.js';
import { createStore } from './store.js';
import { createSnap } from './snap.js';
import { createHit } from './hit.js';
import { renderBody } from './render.js';
import { exampleDoc, makeItem } from './model.js';
import { TOOLS, gridFor } from './consts.js';
import { outline, toScreenContours } from './overlay.js';
import { mountUI } from './ui.js';
import * as io from './io.js';
import * as assist from './assist.js';
import createSelect from './tools/select.js';
import createNode from './tools/node.js';
import createPen from './tools/pen.js';
import createPencil from './tools/pencil.js';
import createShape from './tools/shape.js';

const $ = id => document.getElementById(id);
const host = $('canvas-host'), docEl = $('doc'), viewportEl = $('viewport'), artboard = $('artboard'), gridEl = $('grid');
const pattern = $('grid-pattern'), gridPath = $('grid-path'), overlayEl = $('overlay-layer'), hintEl = $('hint');

// ---- Boot ----
let bridge;
try { bridge = createBridge(window.paper ?? null); } catch { bridge = createBridge(null); }
const store = createStore({ bridge });
const st = store.getState, dispatch = store.dispatch;

const view = {
  toDoc: (sx, sy) => { const v = st().viewport; return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom }; },
  toScreen: (x, y) => { const v = st().viewport; return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY }; },
  zoom: () => st().viewport.zoom,
};
const ctx = {
  store, bridge, getState: st, view, hit: createHit(st),
  px: e => e.pointerType === 'touch' ? 16 : 8,
  newItem: (contours, name, extra = {}) => makeItem(contours, { ...st().style, ...extra }, name),
  requestOverlay: schedule,
  setCursor: c => { host.style.cursor = c; },
};
ctx.snap = createSnap(ctx);
const tools = {
  select: createSelect(ctx), node: createNode(ctx), pen: createPen(ctx), pencil: createPencil(ctx),
  ...Object.fromEntries(['rect', 'ellipse', 'polygon', 'line'].map(k => [k, createShape(ctx, k)])),
};
let tool = tools.select;

// ---- Render loop (rAF-batched; the doc markup is rebuilt only when the doc reference changes) ----
let raf = 0, lastDoc = null, lastOverlay = '';
function schedule() { raf ||= requestAnimationFrame(render); }
const attr = (el, k, v) => { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

function render() {
  raf = 0;
  const { doc, viewport: v, ui } = st();
  if (doc !== lastDoc) { docEl.innerHTML = renderBody(doc, { ids: true }); lastDoc = doc; }
  attr(viewportEl, 'transform', `translate(${v.panX} ${v.panY}) scale(${v.zoom})`);
  for (const el of [artboard, gridEl]) { attr(el, 'width', doc.w); attr(el, 'height', doc.h); }
  const step = gridFor(doc.w, doc.h);
  gridEl.style.display = ui.grid && step * v.zoom >= 6 ? '' : 'none';
  attr(gridEl, 'fill', 'url(#grid-pattern)');
  attr(pattern, 'width', step); attr(pattern, 'height', step);
  attr(gridPath, 'd', `M ${step} 0 L 0 0 0 ${step}`);
  attr(gridPath, 'stroke-width', 1 / v.zoom);
  gridPath.style.strokeWidth = 1 / v.zoom;

  let html = '';
  for (const it of doc.items) if (it.visible && it.op === 'cut') html += outline(toScreenContours(it.contours, v), 'ov-ghost');
  html += tool.renderOverlay() + ctx.snap.guidesSvg();
  if (html !== lastOverlay) overlayEl.innerHTML = lastOverlay = html;

  const text = ui.example ? 'This is an example. Press New to start your own.' : tool.hint();
  if (hintEl.textContent !== text) hintEl.textContent = text;
}

// ---- State subscriptions ----
const applyTheme = t => { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
store.subscribe((s, p) => {
  if (s.tool !== p.tool) {
    tool.deactivate?.();
    tool = tools[s.tool];
    toolDown = null;
    tool.activate?.();
    ctx.setCursor(tool.cursor);
  }
  if (s.doc !== p.doc && !s.ui.example) io.autosave.save(s.doc);
  if (s.ui.grid !== p.ui.grid || s.ui.snap !== p.ui.snap || s.ui.theme !== p.ui.theme) {
    io.prefs.save({ grid: s.ui.grid, snap: s.ui.snap, theme: s.ui.theme });
  }
  if (s.ui.theme !== p.ui.theme) applyTheme(s.ui.theme);
  schedule();
});

// ---- Viewport ----
const fitPad = () => parseFloat(getComputedStyle(host).getPropertyValue('--fit-pad')) || 48;
const fit = () => dispatch('zoomFit', { pad: fitPad() });
let sized = false;
new ResizeObserver(() => {
  dispatch('setViewport', { w: host.clientWidth, h: host.clientHeight });
  const { w, h, fitted } = st().viewport;
  if (w && h && (!sized || fitted)) { sized = true; fit(); }   // first layout, and keep a fitted view fitted on resize
}).observe(host);

// ---- Pointer: tools, pan (middle button / Space), two-finger pinch ----
let toolDown = null, panning = null, space = false, pinch = null, clicks = { n: 0, t: 0, x: 0, y: 0 };
const touches = new Map();

function evt(e, down) {
  const r = host.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = view.toDoc(sx, sy);
  return { x: p.x, y: p.y, sx, sy, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, button: e.button,
           down, pointerType: e.pointerType ?? 'mouse', detail: clicks.n };
}
function pinchState() {
  const [a, b] = [...touches.values()], r = host.getBoundingClientRect();
  return { cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}
const idleCursor = () => ctx.setCursor(space ? 'grab' : tool.cursor);

host.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {                       // second finger: abandon the tool gesture, start pinching
      if (toolDown !== null) { tool.cancel?.(); toolDown = null; }
      pinch = pinchState();
      return;
    }
    if (touches.size > 2) return;
  }
  if (e.button === 1 || (space && e.button === 0)) {
    e.preventDefault();
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
    ctx.setCursor('grabbing');
    return;
  }
  if (e.button !== 0) return;
  const now = performance.now();
  clicks = now - clicks.t < 400 && Math.hypot(e.clientX - clicks.x, e.clientY - clicks.y) < 6
    ? { ...clicks, n: clicks.n + 1, t: now } : { n: 1, t: now, x: e.clientX, y: e.clientY };
  toolDown = e.pointerId;
  tool.onPointerDown(evt(e, true));
});

host.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      if (!pinch) return;
      const n = pinchState();
      dispatch('panBy', { dx: n.cx - pinch.cx, dy: n.cy - pinch.cy });
      dispatch('zoomBy', { factor: n.d / pinch.d, cx: n.cx, cy: n.cy });
      pinch = n;
      return;
    }
  }
  if (panning) {
    if (panning.id === e.pointerId) {
      dispatch('panBy', { dx: e.clientX - panning.x, dy: e.clientY - panning.y });
      panning.x = e.clientX; panning.y = e.clientY;
    }
  } else if (toolDown === e.pointerId) tool.onPointerMove(evt(e, true));
  else if (toolDown === null && e.pointerType !== 'touch') tool.onPointerMove(evt(e, false));
});

function pointerEnd(e) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  try { host.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  if (panning?.id === e.pointerId) { panning = null; idleCursor(); }
  else if (toolDown === e.pointerId) {
    toolDown = null;
    if (e.type === 'pointercancel') tool.cancel?.(); else tool.onPointerUp(evt(e, false));
  }
}
host.addEventListener('pointerup', pointerEnd);
host.addEventListener('pointercancel', pointerEnd);
host.addEventListener('dblclick', e => tool.onDoubleClick?.(evt(e, false)));
host.addEventListener('contextmenu', e => e.preventDefault());

// Wheel: Ctrl/Cmd (trackpad pinch) zooms; a mouse wheel zooms; trackpad scrolling pans.
host.addEventListener('wheel', e => {
  e.preventDefault();
  const r = host.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
  const lines = e.deltaMode === 1, dy = lines ? e.deltaY * 33 : e.deltaY;
  const mouseWheel = lines || (e.deltaX === 0 && !!e.wheelDeltaY && e.wheelDeltaY % 120 === 0);
  if (e.ctrlKey || e.metaKey) dispatch('zoomBy', { factor: Math.exp(-Math.max(-40, Math.min(40, dy)) * 0.01), cx, cy });
  else if (mouseWheel) dispatch('zoomBy', { factor: Math.exp(-dy * 0.002), cx, cy });
  else dispatch('panBy', { dx: -e.deltaX, dy: -e.deltaY });
}, { passive: false });

// ---- Keyboard ----
const zoomStep = factor => dispatch('zoomBy', { factor });   // around the host centre
const META = {
  z: e => dispatch(e.shiftKey ? 'redo' : 'undo'), y: () => dispatch('redo'), a: () => dispatch('selectAll'),
  d: () => dispatch('duplicateItems'), '[': () => dispatch('reorder', { to: 'back' }), ']': () => dispatch('reorder', { to: 'front' }),
  0: fit, 1: () => dispatch('zoomTo', { zoom: 1 }), '=': () => zoomStep(1.25), '+': () => zoomStep(1.25), '-': () => zoomStep(0.8),
  e: () => dispatch('setUI', { panel: 'export' }),
};

let tabbed = false;   // focus arrived by keyboard; a button focused by a mouse click must not swallow Space (it would press it)
window.addEventListener('pointerdown', () => { tabbed = false; }, true);

function onKey(e) {
  const { ui, selection } = st(), k = e.key.toLowerCase(), t = e.target;
  if (e.key === 'Tab') tabbed = true;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { if (e.key === 'Escape') t.blur(); return; }
  if (e.code === 'Space') {
    // Keyboard users keep Space as "press" on a button they tabbed to; otherwise it is pan mode.
    if (tabbed && t.closest?.('button,a,summary,[role=button],[role=option]')) return;
    e.preventDefault();
    if (!space) { space = true; if (!panning) ctx.setCursor('grab'); }
    return;
  }
  if (e.key === 'Escape' && (ui.panel || ui.sheet)) return dispatch('setUI', { panel: null, sheet: null });
  if (tool.onKeyDown?.(e)) return e.preventDefault();

  if (e.metaKey || e.ctrlKey) {
    if (META[k]) { e.preventDefault(); META[k](e); }
    return;
  }
  if (e.altKey) return;
  const toolDef = TOOLS.find(x => x.key === k);
  if (toolDef) return dispatch('setTool', { id: toolDef.id });
  if (k === 'escape') {
    if (!tool.cancel?.()) {
      if (selection.length) dispatch('clearSelection'); else dispatch('setTool', { id: 'select' });
    }
  } else if (k === 'delete' || k === 'backspace') { e.preventDefault(); dispatch('deleteItems'); }
  else if (k === 'x') {
    const items = st().doc.items.filter(i => selection.includes(i.id));
    dispatch('updateItems', { patch: { op: items.length && items.every(i => i.op === 'cut') ? 'add' : 'cut' } });
  }
  else if (k === 'g') dispatch('setUI', { grid: !ui.grid });
  else if (k === 's') dispatch('setUI', { snap: !ui.snap });
  else if (k === '[') dispatch('reorder', { to: 'backward' });
  else if (k === ']') dispatch('reorder', { to: 'forward' });
  else if (k === '/') {
    const input = $('describe-input');
    if (input?.getClientRects().length) { e.preventDefault(); input.focus(); }
  }
}
window.addEventListener('keydown', onKey);
window.addEventListener('keyup', e => {
  if (e.code === 'Space' && space) { space = false; if (!panning) idleCursor(); e.preventDefault(); }
  tool.onKeyUp?.(e);
});
window.addEventListener('blur', () => { space = false; });

// ---- Start ----
mountUI({ store, bridge, io, assist });
io.bindGlobalIO({ store, bridge });
const prefs = io.prefs.load() ?? {};
dispatch('setUI', Object.fromEntries(['grid', 'snap', 'theme'].filter(k => prefs[k] !== undefined).map(k => [k, prefs[k]])));
applyTheme(st().ui.theme);
const saved = io.autosave.load();
dispatch('loadDoc', { doc: saved ?? exampleDoc(), example: !saved });
tool.activate?.();
ctx.setCursor(tool.cursor);
schedule();

window.__marque = { store, bridge, io, assist, view };
