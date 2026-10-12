// Pencil tool: freehand points, simplified into bezier nodes by the bridge (polyline fallback without Paper).
import { outline } from '../overlay.js';

const polyline = (pts, closed) => ({ closed, nodes: pts.map(p => ({ x: p.x, y: p.y, hi: null, ho: null })) });

export default function create(ctx) {
  const { store, bridge, view } = ctx;
  let pts = null;   // doc point + screen point per sample

  return {
    id: 'pencil', cursor: 'crosshair',
    hint: () => 'Drag to draw freehand · finish near the start to close the shape',
    deactivate() { pts = null; },
    cancel() {
      if (!pts) return false;
      pts = null;
      ctx.requestOverlay();
      return true;
    },

    onPointerDown(e) { pts = [{ x: e.x, y: e.y, sx: e.sx, sy: e.sy }]; },

    onPointerMove(e) {
      if (!pts || !e.down) return;
      const l = pts.at(-1);
      if (Math.hypot(e.sx - l.sx, e.sy - l.sy) < 1.5) return;
      pts.push({ x: e.x, y: e.y, sx: e.sx, sy: e.sy });
      ctx.requestOverlay();
    },

    onPointerUp(e) {
      const ps = pts;
      pts = null;
      ctx.requestOverlay();
      if (!ps) return;
      ps.push({ x: e.x, y: e.y, sx: e.sx, sy: e.sy });
      if (ps.length < 3) return;
      const close = ps.length > 3 && Math.hypot(e.sx - ps[0].sx, e.sy - ps[0].sy) <= 12;
      let c = null;
      if (bridge.available) {
        try { c = bridge.simplify(ps.map(({ x, y }) => ({ x, y })), { tolerance: 2.5 / view.zoom(), close }); } catch { /* use the fallback */ }
      }
      if (!c) {   // decimate to roughly 4 screen px spacing and keep the corners
        const keep = ps.filter((p, i) => i === 0 || i === ps.length - 1 || Math.hypot(p.sx - ps[i - 1].sx, p.sy - ps[i - 1].sy) >= 4);
        c = polyline(keep, close);
      }
      store.dispatch('addItems', { items: [ctx.newItem([c], 'Pencil')] });
    },

    renderOverlay() {
      return pts?.length > 1 ? outline([polyline(pts.map(p => ({ x: p.sx, y: p.sy })), false)], 'ov-preview') : '';
    },
  };
}
