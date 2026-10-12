// Ink brush: paints a filled, tapered stroke. The outline comes from inkOutline (speed/pressure shape the width),
// is simplified to bezier nodes by the bridge, and lands as an ordinary closed path.
import { outline } from '../overlay.js';
import { inkOutline, smoothContours } from '../organic.js';
import { DEFAULT_STYLE } from '../consts.js';

const polygon = pts => ({ closed: true, nodes: pts.map(p => ({ x: p.x, y: p.y, hi: null, ho: null })) });

export default function create(ctx) {
  const { store, bridge, view } = ctx;
  let s = null;   // samples: doc x/y, screen sx/sy, time t, pressure p

  const sample = e => ({ x: e.x, y: e.y, sx: e.sx, sy: e.sy, t: e.time, p: e.pressure });
  const opts = () => store.getState().toolOpts;

  // Without Paper: keep points at least size/3 apart, then round the corners off.
  function fallback(poly, size) {
    const kept = poly.filter((p, i) => i === 0 || Math.hypot(p.x - poly[i - 1].x, p.y - poly[i - 1].y) >= size / 3);
    return smoothContours([polygon(kept.length >= 3 ? kept : poly)], 1)[0];
  }

  return {
    id: 'brush', cursor: 'crosshair',
    hint: () => 'Drag to paint an ink stroke. Faster strokes are thinner; pen pressure works too.',
    deactivate() { s = null; },
    cancel() {
      if (!s) return false;
      s = null;
      ctx.requestOverlay();
      return true;
    },

    onPointerDown(e) { s = [sample(e)]; ctx.requestOverlay(); },

    onPointerMove(e) {
      if (!s || !e.down) return;
      const l = s.at(-1);
      if (Math.hypot(e.sx - l.sx, e.sy - l.sy) < 1.5) return;
      s.push(sample(e));
      ctx.requestOverlay();
    },

    onPointerUp(e) {
      const ps = s;
      s = null;
      ctx.requestOverlay();
      if (!ps) return;
      const l = ps.at(-1);
      if (Math.hypot(e.sx - l.sx, e.sy - l.sy) >= 0.1) ps.push(sample(e));
      const { brushSize = 16, thinning = 0.5, taper = 0.5 } = opts(), zoom = view.zoom(), size = brushSize / zoom;
      const poly = inkOutline(ps, { size, thinning, taper });
      if (poly.length < 3) return;
      let c = null;
      if (bridge.available) {
        try { c = bridge.simplify(poly, { tolerance: 1 / zoom, close: true }); } catch { /* use the fallback */ }
      }
      if (!c || c.nodes.length < 3) c = fallback(poly, size);
      const { fill, stroke } = store.getState().style;   // a "none" fill would paint nothing: borrow the stroke colour
      store.dispatch('addItems', { items: [ctx.newItem([c], 'Ink', { stroke: null, fill: fill ?? stroke ?? DEFAULT_STYLE.fill })] });
    },

    renderOverlay() {
      if (!s) return '';
      const { brushSize = 16, thinning = 0.5, taper = 0.5 } = opts();
      const poly = inkOutline(s.map(p => ({ x: p.sx, y: p.sy, t: p.t, p: p.p })), { size: brushSize, thinning, taper });
      return poly.length ? outline([polygon(poly)], 'ov-ink') : '';
    },
  };
}
