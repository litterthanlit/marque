// Hit-testing with an offscreen canvas: Path2D + isPointInPath / isPointInStroke in doc coordinates.
import { contoursToD, itemBounds } from './geometry.js';

export function createHit(getState) {
  let g = null;
  const paths = new WeakMap();   // contours are immutable, so their Path2D can be cached by reference
  const pathOf = it => {
    let p = paths.get(it.contours);
    if (!p) paths.set(it.contours, p = new Path2D(contoursToD(it.contours, 3)));
    return p;
  };

  return {
    // Topmost hittable item under p (doc units). tolPx is the stroke half-width in screen px.
    item(p, tolPx = 4) {
      g ??= document.createElement('canvas').getContext('2d');
      const { doc, viewport } = getState();
      for (let i = doc.items.length - 1; i >= 0; i--) {
        const it = doc.items[i];
        if (!it.visible || it.locked) continue;
        const path = pathOf(it);
        if ((it.fill !== null || it.op === 'cut') && g.isPointInPath(path, p.x, p.y, it.fillRule)) return it.id;
        if (it.stroke !== null) {
          g.lineWidth = Math.max(it.strokeWidth, 2 * tolPx / viewport.zoom);
          g.lineCap = it.cap;
          g.lineJoin = it.join;
          if (g.isPointInStroke(path, p.x, p.y)) return it.id;
        }
      }
      return null;
    },

    // Ids (stack order) of hittable items whose bounds touch the rect.
    itemsInRect(r) {
      return getState().doc.items.filter(it => {
        if (!it.visible || it.locked) return false;
        const b = itemBounds(it);
        return b && b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
      }).map(it => it.id);
    },
  };
}
