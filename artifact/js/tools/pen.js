// Pen tool: click = corner, drag = smooth, click the first node to close, Enter / Esc to finish.
import { constrain45 } from '../geometry.js';
import { anchor, ctrl, line, outline, toScreenContours } from '../overlay.js';

export default function create(ctx) {
  const { store, snap, view } = ctx, st = ctx.getState;
  let nodes = [], drag = null, hov = null;   // drag: the node being placed; hov: pointer (doc + screen) for the rubber band

  const point = e => {
    const last = nodes.at(-1);
    return e.shift && last ? constrain45(last, e) : snap.point(e, { meta: e.meta });
  };
  const nearFirst = (e, r) => {
    if (nodes.length < 2) return false;
    const f = view.toScreen(nodes[0].x, nodes[0].y);
    return Math.hypot(f.x - e.sx, f.y - e.sy) <= r;
  };

  function finish(close = false) {
    const ns = nodes;
    nodes = []; drag = null; hov = null;
    if (ns.length >= 2) store.dispatch('addItems', { items: [ctx.newItem([{ closed: close, nodes: ns }], 'Path')] });
    snap.setTargets();
    ctx.requestOverlay();
  }

  return {
    id: 'pen', cursor: 'crosshair',
    hint: () => nodes.length
      ? 'Click to add · drag to curve · click the first point to close · Enter finishes'
      : 'Click to place points · drag to pull out curves',
    activate() { snap.setTargets(); },
    deactivate() { finish(); },

    cancel() {      // pointer cancelled mid-placement: forget the node being placed
      if (!drag) return false;
      nodes.pop(); drag = null;
      ctx.requestOverlay();
      return true;
    },

    onPointerDown(e) {
      if (nearFirst(e, ctx.px(e))) return finish(true);
      if (!nodes.length) snap.setTargets();
      const p = point(e);
      nodes.push({ x: p.x, y: p.y, hi: null, ho: null });
      drag = { p, e };
      ctx.requestOverlay();
    },

    onPointerMove(e) {
      if (drag && e.down) {
        if (Math.hypot(e.sx - drag.e.sx, e.sy - drag.e.sy) < 3) return;
        const n = nodes.at(-1), q = e.shift ? constrain45(n, e) : snap.point(e, { meta: e.meta });
        nodes[nodes.length - 1] = { ...n, ho: q, hi: { x: 2 * n.x - q.x, y: 2 * n.y - q.y } };
      } else hov = { ...point(e), sx: e.sx, sy: e.sy, near: nearFirst(e, ctx.px(e)) };
      ctx.requestOverlay();
    },

    onPointerUp() { drag = null; },

    onDoubleClick() {   // the second click of a double-click already added a duplicate node
      if (nodes.length > 1) {
        const [a, b] = nodes.slice(-2);
        if (Math.hypot(a.x - b.x, a.y - b.y) * view.zoom() < 3) nodes.pop();
      }
      finish();
    },

    onKeyDown(k) {
      if (!nodes.length) return false;
      if (k.key === 'Enter' || k.key === 'Escape') finish();
      else if (k.key === 'Backspace' || k.key === 'Delete') { nodes.pop(); ctx.requestOverlay(); }
      else return false;
      return true;
    },

    renderOverlay() {
      if (!nodes.length) return '';
      const v = st().viewport, last = nodes.at(-1);
      let out = nodes.length > 1 ? outline(toScreenContours([{ closed: false, nodes }], v), 'ov-preview') : '';
      if (hov && !drag) {
        const end = { x: hov.x, y: hov.y, hi: null, ho: null };
        out += outline(toScreenContours([{ closed: false, nodes: [last, end] }], v), 'ov-rubber');
      }
      if (last.ho) {
        const a = view.toScreen(last.x, last.y);
        for (const h of [last.hi, last.ho]) { const p = view.toScreen(h.x, h.y); out += line(a, p) + ctrl(p.x, p.y); }
      }
      nodes.forEach((n, i) => {
        const p = view.toScreen(n.x, n.y);
        out += anchor(p.x, p.y, i === nodes.length - 1 || (i === 0 && !!hov?.near));
      });
      return out;
    },
  };
}
