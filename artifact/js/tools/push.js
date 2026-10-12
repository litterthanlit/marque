// Push tool: drag across outlines to shove them like clay. The brush is a soft disc (size in screen px);
// each pointer move is cut into small sub-steps so a fast drag stays smooth.
import { ellipseContours } from '../geometry.js';
import { updateItems } from '../model.js';
import { outline, toScreenContours } from '../overlay.js';
import { pushContours } from '../organic.js';

export default function create(ctx) {
  const { store, hit } = ctx, st = ctx.getState;
  let g = null, at = null;   // g: the drag { ids, last } ; at: pointer in screen px, for the brush ring

  function cancel() {
    if (!g) return false;
    g = null;
    store.cancel();
    ctx.requestOverlay();
    return true;
  }

  return {
    id: 'push', cursor: 'crosshair',
    hint: () => 'Drag across an outline to push it like clay. Size and strength are in the Inspector.',
    deactivate() { cancel(); at = null; },
    cancel,

    onPointerDown(e) {
      at = e;
      let ids = st().selection;
      if (!ids.length) {   // nothing selected: push (and select) the item under the pointer
        const id = hit.item(e, 4);
        if (!id) return;
        store.dispatch('select', { ids: [id] });
        ids = st().selection;
      }
      store.begin();
      g = { ids, last: e };
    },

    onPointerMove(e) {
      at = e;
      ctx.requestOverlay();
      if (!g || !e.down) return;
      const { toolOpts, doc } = st(), R = toolOpts.pushSize / 2 / ctx.view.zoom();
      const dx = e.x - g.last.x, dy = e.y - g.last.y, n = Math.min(60, Math.ceil(Math.hypot(dx, dy) / (R / 4)));
      g.last = e;
      if (!n) return;
      let moved = false;
      const next = updateItems(doc, g.ids, it => {
        let cs = it.contours;
        for (let k = 0; k < n; k++) {
          const c = { x: e.x - dx * (n - k - 0.5) / n, y: e.y - dy * (n - k - 0.5) / n };   // centre of sub-step k
          cs = pushContours(cs, c, { x: dx / n, y: dy / n }, R, toolOpts.pushStrength);
        }
        moved ||= cs !== it.contours;
        return cs === it.contours ? it : { ...it, contours: cs };
      });
      if (moved) store.setDoc(next);
    },

    onPointerUp() {
      if (!g) return;
      g = null;
      store.commit('Push');   // a no-op if nothing moved
      ctx.requestOverlay();
    },

    renderOverlay() {
      const { doc, selection, toolOpts, viewport: v } = st(), r = toolOpts.pushSize / 2;
      let out = doc.items.filter(it => selection.includes(it.id)).map(it => outline(toScreenContours(it.contours, v))).join('');
      if (at) out += outline(ellipseContours(at.sx, at.sy, r, r), 'ov-preview');
      return out;
    },
  };
}
