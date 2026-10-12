// Snapping: grid and alignment targets (artboard edges/centre, other items' bbox edges, centres and anchors).
// x and y snap independently, so a point can lock to one target on each axis. Guides show what it locked to.
import { gridFor } from './consts.js';
import { itemBounds } from './geometry.js';
import { line } from './overlay.js';

export function createSnap(ctx) {
  let xs = [], ys = [], guides = [], ready = false;

  function setTargets(exclude = []) {
    const { doc } = ctx.getState(), skip = new Set(exclude);
    const X = [0, doc.w / 2, doc.w], Y = [0, doc.h / 2, doc.h];
    for (const it of doc.items) {
      const b = !skip.has(it.id) && it.visible && itemBounds(it);
      if (!b) continue;
      X.push(b.x, b.x + b.w / 2, b.x + b.w);
      Y.push(b.y, b.y + b.h / 2, b.y + b.h);
      for (const c of it.contours) for (const n of c.nodes) { X.push(n.x); Y.push(n.y); }
    }
    xs = [...new Set(X)];
    ys = [...new Set(Y)];
    guides = [];
    ready = true;
  }

  // Offset that moves the nearest candidate onto a target (within the threshold), else onto the grid.
  function axis(name, cands, targets, { ui, grid, thr }) {
    let best = null;
    if (ui.snap) for (const c of cands) for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    }
    if (best) { guides.push({ name, v: best.t }); return best.d; }
    return ui.grid ? Math.round(cands[0] / grid) * grid - cands[0] : 0;
  }

  function env() {
    if (!ready) setTargets();
    const { ui, doc } = ctx.getState();
    return { ui, grid: gridFor(doc.w, doc.h), thr: 6 / ctx.view.zoom() };
  }

  return {
    setTargets,

    point(p, { meta = false } = {}) {
      guides = [];
      if (meta) return { x: p.x, y: p.y };
      const o = env();
      return { x: p.x + axis('x', [p.x], xs, o), y: p.y + axis('y', [p.y], ys, o) };
    },

    // Snap a rect moved by (dx, dy): its left/centre/right and top/middle/bottom against the targets.
    bbox(r, dx, dy, { meta = false } = {}) {
      guides = [];
      if (meta) return { dx, dy };
      const o = env();
      return {
        dx: dx + axis('x', [r.x + dx, r.x + r.w / 2 + dx, r.x + r.w + dx], xs, o),
        dy: dy + axis('y', [r.y + dy, r.y + r.h / 2 + dy, r.y + r.h + dy], ys, o),
      };
    },

    guidesSvg() {
      const { w, h } = ctx.getState().viewport;
      return guides.map(g => {
        const s = ctx.view.toScreen(g.v, g.v);
        return g.name === 'x' ? line({ x: s.x, y: 0 }, { x: s.x, y: h }, 'ov-guide')
                              : line({ x: 0, y: s.y }, { x: w, y: s.y }, 'ov-guide');
      }).join('');
    },

    clear() { guides = []; },
  };
}
