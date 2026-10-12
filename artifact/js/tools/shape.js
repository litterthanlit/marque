// Shape tool (rect, ellipse, polygon, line, blob): drag to draw, click to place a default size.
import { constrain45, dragRect, lineContours } from '../geometry.js';
import { liveContours } from '../store.js';
import { outline, toScreenContours } from '../overlay.js';

const NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', line: 'Line', blob: 'Blob' };
const HINTS = {
  blob: 'Drag to draw a blob. Shuffle in the Inspector for another.',
  line: 'Drag to draw a line · Shift snaps to 45° · click to place one',
  polygon: 'Drag to draw · Shift keeps it regular · Alt draws from the centre · click to place one',
};

export default function create(ctx, kind) {
  const { store, snap } = ctx, st = ctx.getState;
  let a = null, b = null, start = null, moved = false, mods = {};

  function track(e) {
    b = snap.point(e, { meta: e.meta });
    mods = { shift: e.shift, alt: e.alt };
    moved ||= Math.hypot(e.sx - start.sx, e.sy - start.sy) >= 3;
  }

  // The shape being drawn: { box } or, for a line, { p, q }. A click without a drag gives the default size.
  function geometry() {
    if (!moved) {
      const { doc } = st(), d = Math.min(doc.w, doc.h) * 0.25;
      return kind === 'line' ? { p: { x: a.x - d / 2, y: a.y }, q: { x: a.x + d / 2, y: a.y } }
                             : { box: { x: a.x - d / 2, y: a.y - d / 2, w: d, h: d } };
    }
    return kind === 'line' ? { p: a, q: mods.shift ? constrain45(a, b) : b }
                           : { box: dragRect(a, b, { square: mods.shift, center: mods.alt }) };
  }
  const contoursOf = geo => geo.box ? liveContours(kind, geo.box, st().toolOpts) : lineContours(geo.p, geo.q);

  return {
    id: kind, cursor: 'crosshair',
    hint: () => HINTS[kind] ?? 'Drag to draw · Shift keeps it square · Alt draws from the centre · click to place one',
    activate() { snap.setTargets(); },
    cancel() {
      if (!a) return false;
      a = null;
      snap.clear();
      ctx.requestOverlay();
      return true;
    },

    onPointerDown(e) {
      snap.setTargets();
      start = e; moved = false;
      a = snap.point(e, { meta: e.meta });
      b = a; mods = { shift: e.shift, alt: e.alt };
      ctx.requestOverlay();
    },

    onPointerMove(e) {
      if (!a || !e.down) return;
      track(e);
      ctx.requestOverlay();
    },

    onPointerUp(e) {
      if (!a) return;
      track(e);
      const geo = geometry(), ok = geo.box ? geo.box.w > 0 && geo.box.h > 0 : Math.hypot(geo.q.x - geo.p.x, geo.q.y - geo.p.y) > 0;
      a = null;
      snap.clear();
      if (!ok) return ctx.requestOverlay();
      const { toolOpts } = st(), name = kind === 'polygon' && toolOpts.star ? 'Star' : NAMES[kind];
      store.dispatch('addItems', {
        items: [ctx.newItem(contoursOf(geo), name)], select: true,
        live: geo.box ? { kind, box: geo.box, params: { ...toolOpts } } : undefined,
      });
      store.dispatch('setTool', { id: 'select' });
    },

    renderOverlay() {
      return a && moved ? outline(toScreenContours(contoursOf(geometry()), st().viewport), 'ov-preview') : '';
    },
  };
}
