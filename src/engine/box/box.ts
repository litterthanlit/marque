import {
  add,
  dot,
  emptyBounds,
  includeCubic,
  normalizeDegrees,
  rotate,
  scale,
  sub,
  type Bounds,
  type Vec,
} from '../path/bezier.ts'
import { curveCount, curveOf, type EditablePath, type EditableShape } from '../path/editPath.ts'

/**
 * The box that handles sit around: eight resize handles on a frame padded
 * outside it, and a rotate knob above. Recipes use it for their own frame;
 * a free path and a multi-selection use it to resize and turn every member
 * together with one affine map.
 */

/* ─── Handles ─── */

export type HandleId =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw'
  | 'radius'
  | 'rotate'
  | 'from'
  | 'to'
  | 'width'

export type HandleKind = 'resize' | 'scale' | 'radius' | 'rotate' | 'endpoint' | 'width'

export interface CarveHandle {
  id: HandleId
  kind: HandleKind
  /** Layer-space position. */
  at: Vec
  /** Direction the handle pulls along, in degrees (screen), for cursor choice. */
  axisDeg: number
  /** How far a resize square is turned, with its box, in degrees. */
  turn?: number
}

export interface HandleLayout {
  /** Gap between the outline and the resize frame, in layer units. */
  pad: number
  /** Extra distance of the rotate dot above the frame. */
  rotateOffset: number
  /** Below this size, edge-midpoint handles are hidden to avoid crowding. */
  minEdgeHandleSize: number
  /** How far inside its corner the rounding dot sits when the corner is sharp. */
  radiusInset: number
  /** Below this length of a padded side, the box around a selection hides that side's square. */
  minBoxSide: number
}

export const DEFAULT_HANDLE_LAYOUT: HandleLayout = { pad: 12, rotateOffset: 22, minEdgeHandleSize: 30, radiusInset: 10, minBoxSide: 48 }

/** A box that may be turned. `rotation` is in degrees, clockwise on screen, about `center`. */
export interface OrientedBox {
  center: Vec
  width: number
  height: number
  rotation: number
}

const BOX_HANDLES: Array<{ id: HandleId; fx: -1 | 0 | 1; fy: -1 | 0 | 1; axis: number }> = [
  { id: 'nw', fx: -1, fy: -1, axis: 45 },
  { id: 'n', fx: 0, fy: -1, axis: 90 },
  { id: 'ne', fx: 1, fy: -1, axis: -45 },
  { id: 'e', fx: 1, fy: 0, axis: 0 },
  { id: 'se', fx: 1, fy: 1, axis: 45 },
  { id: 's', fx: 0, fy: 1, axis: 90 },
  { id: 'sw', fx: -1, fy: 1, axis: -45 },
  { id: 'w', fx: -1, fy: 0, axis: 0 },
]

/** Where on the box a resize handle sits: -1, 0 or 1 along each side. Null for other handles. */
export function handleFraction(id: HandleId): Vec | null {
  const h = BOX_HANDLES.find((candidate) => candidate.id === id)
  return h ? { x: h.fx, y: h.fy } : null
}

export function isCornerHandle(id: HandleId): boolean {
  const f = handleFraction(id)
  return Boolean(f && f.x !== 0 && f.y !== 0)
}

export interface BoxHandleOptions {
  /** 'scale' squares resize uniformly (punches, selections that hold a recipe). */
  kind: 'resize' | 'scale'
  /** Side-middle handles. Hidden anyway when the padded side is shorter than `minEdgeHandleSize`. */
  edges: boolean
  /**
   * When set in place of `minEdgeHandleSize`, a side's square shows only
   * where the padded side is at least this long. The box around a selection
   * uses it: each side of its frame resizes along its whole length, so a
   * small shape needs no squares crowding it. The corners always show.
   */
  minSide?: number
}

/** Layer-space position of a point given in the box's own unrotated frame, about its centre. */
export function boxPoint(box: OrientedBox, local: Vec): Vec {
  return add(box.center, rotate(local, box.rotation))
}

/** The point of the box itself that a resize handle drags: a corner or a side middle. Null for other handles. */
export function boxHandlePoint(box: OrientedBox, id: HandleId): Vec | null {
  const f = handleFraction(id)
  return f ? boxPoint(box, { x: (f.x * box.width) / 2, y: (f.y * box.height) / 2 }) : null
}

/** Whether a point lies inside the box grown by `pad` on every side. */
export function boxContains(box: OrientedBox, p: Vec, pad = 0): boolean {
  const local = rotate(sub(p, box.center), -box.rotation)
  return Math.abs(local.x) <= box.width / 2 + pad && Math.abs(local.y) <= box.height / 2 + pad
}

/** The resize handles on a frame padded around the box. */
export function boxHandles(box: OrientedBox, layout: HandleLayout, options: BoxHandleOptions): CarveHandle[] {
  const hw = box.width / 2 + layout.pad
  const hh = box.height / 2 + layout.pad
  const handles: CarveHandle[] = []
  for (const h of BOX_HANDLES) {
    const isEdge = h.fx === 0 || h.fy === 0
    if (isEdge) {
      if (!options.edges) continue
      if ((h.fx === 0 ? 2 * hw : 2 * hh) < (options.minSide ?? layout.minEdgeHandleSize)) continue
    }
    handles.push({
      id: h.id,
      kind: options.kind,
      at: boxPoint(box, { x: h.fx * hw, y: h.fy * hh }),
      axisDeg: h.axis + box.rotation,
      turn: box.rotation,
    })
  }
  return handles
}

/** A side of the frame padded around the box, as a segment, with the side handle it stands for. */
export interface BoxFrameSide {
  id: HandleId
  a: Vec
  b: Vec
  /** Where the side's handle sits: the middle of the side. */
  mid: Vec
  axisDeg: number
}

/** The four sides of the frame padded `pad` around the box. */
export function boxFrameSides(box: OrientedBox, pad: number): BoxFrameSide[] {
  const hw = box.width / 2 + pad
  const hh = box.height / 2 + pad
  return BOX_HANDLES.filter((h) => h.fx === 0 || h.fy === 0).map((h) => {
    const a = h.fx === 0 ? { x: -hw, y: h.fy * hh } : { x: h.fx * hw, y: -hh }
    const b = h.fx === 0 ? { x: hw, y: h.fy * hh } : { x: h.fx * hw, y: hh }
    return {
      id: h.id,
      a: boxPoint(box, a),
      b: boxPoint(box, b),
      mid: boxPoint(box, { x: h.fx * hw, y: h.fy * hh }),
      axisDeg: h.axis + box.rotation,
    }
  })
}

/** The rotate knob, on a short stem above the middle of the frame's top side. */
export function boxRotateHandle(box: OrientedBox, layout: HandleLayout): CarveHandle {
  return {
    id: 'rotate',
    kind: 'rotate',
    at: boxPoint(box, { x: 0, y: -(box.height / 2 + layout.pad) - layout.rotateOffset }),
    axisDeg: 0,
  }
}

/* ─── Bounds ─── */

/** A box from bounds measured in a frame turned by `rotation`. */
export function boxFromBounds(b: Bounds, rotation = 0): OrientedBox | null {
  if (!Number.isFinite(b.minX) || !Number.isFinite(b.maxX)) return null
  const local = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  return { center: rotate(local, rotation), width: b.maxX - b.minX, height: b.maxY - b.minY, rotation }
}

/** Tight bounds of a path measured in a frame turned by `rotation`, in that frame's coordinates. */
export function pathBoundsInFrame(path: EditablePath, rotation = 0): Bounds {
  const b = emptyBounds()
  const unturn = (p: Vec) => rotate(p, -rotation)
  if (path.segs.length === 1) {
    const p = unturn(path.segs[0].p)
    includeCubic(b, [p, p, p, p])
  }
  for (let i = 0; i < curveCount(path); i++) {
    const c = curveOf(path, i)
    includeCubic(b, [unturn(c[0]), unturn(c[1]), unturn(c[2]), unturn(c[3])])
  }
  return b
}

/** Tight bounds of every contour of a shape, in a frame turned by `rotation`. */
export function shapeBoundsInFrame(shape: EditableShape, rotation = 0): Bounds {
  return shape.reduce((bounds, path) => unionBounds(bounds, pathBoundsInFrame(path, rotation)), emptyBounds())
}

/** The part two bounds share, or empty bounds when they do not meet. */
export function intersectBounds(a: Bounds, b: Bounds): Bounds {
  const shared = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }
  return shared.minX <= shared.maxX && shared.minY <= shared.maxY ? shared : emptyBounds()
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/* ─── Affine maps ─── */

/** x' = a·x + c·y + e, y' = b·x + d·y + f: the convention of SVG and paper.js. */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function applyAffine(m: Affine, p: Vec): Vec {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

/** The linear part alone, for directions such as Bézier handles. */
export function applyLinear(m: Affine, v: Vec): Vec {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y }
}

/** The affine matrix of a map known to be affine, read off three points. */
export function affineOf(map: (p: Vec) => Vec): Affine {
  const o = map({ x: 0, y: 0 })
  const x = map({ x: 1, y: 0 })
  const y = map({ x: 0, y: 1 })
  return { a: x.x - o.x, b: x.y - o.y, c: y.x - o.x, d: y.y - o.y, e: o.x, f: o.y }
}

export function rotationAbout(pivot: Vec, deg: number): Affine {
  return affineOf((p) => add(pivot, rotate(sub(p, pivot), deg)))
}

export function scalingAbout(pivot: Vec, factor: number): Affine {
  return affineOf((p) => add(pivot, scale(sub(p, pivot), factor)))
}

/** A path under an affine map: anchors take the whole map, Bézier handles its linear part. */
export function transformPath(path: EditablePath, m: Affine): EditablePath {
  return {
    closed: path.closed,
    segs: path.segs.map((seg) => ({
      p: applyAffine(m, seg.p),
      hIn: seg.hIn ? applyLinear(m, seg.hIn) : null,
      hOut: seg.hOut ? applyLinear(m, seg.hOut) : null,
    })),
  }
}

/** Every contour of a shape under an affine map. */
export function transformShape(shape: EditableShape, m: Affine): EditableShape {
  return shape.map((path) => transformPath(path, m))
}

/* ─── Dragging ─── */

export interface BoxDragModifiers {
  shift: boolean
  alt: boolean
}

/** The smallest side a resize leaves, in layer units. */
export const MIN_BOX_SIZE = 4

export interface BoxResize {
  /** Maps the box at drag start, and everything in it, onto the box now. */
  affine: Affine
  box: OrientedBox
  /** Growth along the box's own width and height. */
  sx: number
  sy: number
  /** The point that stays put. With a uniform resize, the map is a scaling about it by `sx`. */
  pivot: Vec
}

/**
 * The smallest a side may shrink to: `MIN_BOX_SIZE`, or its size at drag
 * start when it is already thinner, so a thin shape never jumps wider.
 */
function sideFloor(side: number): number {
  return Math.min(side, MIN_BOX_SIZE)
}

/** Whether a drag by this handle scales the box evenly: a corner with Shift, or any corner of a box that only scales evenly. */
export function scalesEvenly(id: HandleId, mods: BoxDragModifiers, uniform = false): boolean {
  return isCornerHandle(id) && (mods.shift || uniform)
}

/** The smallest factor an even scale may take: the box's shorter side stays at or above its floor. */
export function evenScaleFloor(box: OrientedBox): number {
  const sides = [box.width, box.height].filter((side) => side > 1e-6)
  return sides.length ? MIN_BOX_SIZE / Math.max(Math.min(...sides), MIN_BOX_SIZE) : 1
}

/** The box and the map, from the box's own frame: x' = ox + sx·x, y' = oy + sy·y about its centre. */
function resizeResult(start: OrientedBox, sx: number, sy: number, origin: Vec, pivotLocal: Vec): BoxResize {
  const local = (q: Vec): Vec => ({ x: origin.x + sx * q.x, y: origin.y + sy * q.y })
  const affine = affineOf((p) => boxPoint(start, local(rotate(sub(p, start.center), -start.rotation))))
  return {
    affine,
    box: {
      center: boxPoint(start, origin),
      width: start.width * sx,
      height: start.height * sy,
      rotation: start.rotation,
    },
    sx,
    sy,
    pivot: boxPoint(start, pivotLocal),
  }
}

/**
 * Scale a box evenly by `factor` with a corner handle: about the opposite
 * corner, or the centre with Alt. The factor never goes below
 * `evenScaleFloor`.
 */
export function scaleBoxBy(start: OrientedBox, id: HandleId, factor: number, alt: boolean): BoxResize {
  const f0 = handleFraction(id)
  const fx = f0?.x ?? 0
  const fy = f0?.y ?? 0
  const pivotLocal = alt ? { x: 0, y: 0 } : { x: (-fx * start.width) / 2, y: (-fy * start.height) / 2 }
  const f = Math.max(factor, evenScaleFloor(start))
  return resizeResult(start, f, f, { x: pivotLocal.x * (1 - f), y: pivotLocal.y * (1 - f) }, pivotLocal)
}

/**
 * The even factor that brings a corner's layer-space coordinate on `axis`
 * to `value`. Null when the corner cannot move along that axis.
 */
export function evenFactorTo(start: OrientedBox, id: HandleId, alt: boolean, axis: 'x' | 'y', value: number): number | null {
  const corner = boxHandlePoint(start, id)
  if (!corner) return null
  const pivot = scaleBoxBy(start, id, 1, alt).pivot
  const along = corner[axis] - pivot[axis]
  if (Math.abs(along) < 1e-6) return null
  return (value - pivot[axis]) / along
}

/**
 * Resize a box by one of its handles, from the box at drag start and the
 * two pointer positions, never incrementally. The opposite handle stays put,
 * or the centre with Alt. Shift on a corner, or `uniform`, scales both sides
 * alike; Shift on a side keeps the proportions, growing across the middle.
 * The box never flips, and no side shrinks below `MIN_BOX_SIZE` (or below
 * its size at drag start, when it was already thinner).
 */
export function resizeBox(
  start: OrientedBox,
  id: HandleId,
  startPointer: Vec,
  pointer: Vec,
  mods: BoxDragModifiers,
  uniform = false,
): BoxResize {
  const f0 = handleFraction(id)
  if (!f0) return { affine: IDENTITY_AFFINE, box: start, sx: 1, sy: 1, pivot: start.center }
  const fx = f0.x
  const fy = f0.y
  const d = rotate(sub(pointer, startPointer), -start.rotation)
  const hw = start.width / 2
  const hh = start.height / 2

  if (scalesEvenly(id, mods, uniform)) {
    const pivotLocal = mods.alt ? { x: 0, y: 0 } : { x: -fx * hw, y: -fy * hh }
    const corner = { x: fx * hw, y: fy * hh }
    const axis = sub(corner, pivotLocal)
    const moved = add(corner, d)
    return scaleBoxBy(start, id, dot(sub(moved, pivotLocal), axis) / Math.max(dot(axis, axis), 1e-9), mods.alt)
  }

  const minW = sideFloor(start.width)
  const minH = sideFloor(start.height)
  let left = -hw
  let right = hw
  let top = -hh
  let bottom = hh
  if (fx === 1) right = mods.alt ? Math.max(hw + d.x, minW / 2) : Math.max(hw + d.x, left + minW)
  if (fx === -1) left = mods.alt ? Math.min(-hw + d.x, -minW / 2) : Math.min(-hw + d.x, right - minW)
  if (fy === 1) bottom = mods.alt ? Math.max(hh + d.y, minH / 2) : Math.max(hh + d.y, top + minH)
  if (fy === -1) top = mods.alt ? Math.min(-hh + d.y, -minH / 2) : Math.min(-hh + d.y, bottom - minH)
  if (mods.alt) {
    if (fx === 1) left = -right
    if (fx === -1) right = -left
    if (fy === 1) top = -bottom
    if (fy === -1) bottom = -top
  }
  // A side with no length cannot grow by scaling: it stays as it is.
  let sx = start.width > 1e-6 ? (right - left) / start.width : 1
  let sy = start.height > 1e-6 ? (bottom - top) / start.height : 1
  const isCorner = fx !== 0 && fy !== 0
  if (!isCorner && mods.shift) {
    // A side with Shift keeps the proportions, growing across the middle.
    // The shared factor is raised until the other side keeps its floor too.
    const across = fx !== 0 ? start.height : start.width
    const f = Math.max(fx !== 0 ? sx : sy, across > 1e-6 ? sideFloor(across) / across : 0)
    sx = f
    sy = f
    if (fx !== 0) {
      if (mods.alt) right = hw * f
      else if (fx === 1) right = left + start.width * f
      else left = right - start.width * f
      if (mods.alt) left = -right
      top = -hh * f
      bottom = hh * f
    } else {
      if (mods.alt) bottom = hh * f
      else if (fy === 1) bottom = top + start.height * f
      else top = bottom - start.height * f
      if (mods.alt) top = -bottom
      left = -hw * f
      right = hw * f
    }
  }
  const origin = { x: start.width > 1e-6 ? left + hw * sx : 0, y: start.height > 1e-6 ? top + hh * sy : 0 }
  const pivotLocal = { x: fx === 0 || mods.alt ? 0 : -fx * hw, y: fy === 0 || mods.alt ? 0 : -fy * hh }
  return resizeResult(start, sx, sy, origin, pivotLocal)
}

/**
 * The same resize with the sides it changes at whole units, so the size the
 * readout shows is the size stored. The point that stays put still does. An
 * even resize keeps its proportions, so only its longer side is whole. A
 * side keeps its exact size where rounding would take it below its floor.
 */
export function wholeBoxResize(start: OrientedBox, resized: BoxResize, even: boolean): BoxResize {
  const whole = (side: number, factor: number): number => {
    if (side <= 1e-6 || Math.abs(factor - 1) <= 1e-12) return factor
    const rounded = Math.round(side * factor)
    return rounded > 0 && rounded >= sideFloor(side) ? rounded / side : factor
  }
  let { sx, sy } = resized
  if (even) {
    const f = start.width >= start.height ? whole(start.width, sx) : whole(start.height, sy)
    if (f >= evenScaleFloor(start)) sx = sy = f
  } else {
    sx = whole(start.width, sx)
    sy = whole(start.height, sy)
  }
  if (sx === resized.sx && sy === resized.sy) return resized
  const pivotLocal = rotate(sub(resized.pivot, start.center), -start.rotation)
  return resizeResult(start, sx, sy, { x: pivotLocal.x * (1 - sx), y: pivotLocal.y * (1 - sy) }, pivotLocal)
}

/** The widest band either side of a 15° step that settles on it, in degrees. */
const SETTLE_MAX_DEG = 3

/**
 * An angle near a 15° step settles on it. Near means the arc between the
 * angle and the step, at `reach` (the pointer's distance from the centre
 * it turns about), is within `tolerance`, and never more than 3°: the
 * farther out the pointer, the finer the control, and the band never
 * swallows a whole step.
 */
export function settleAngle(rotation: number, reach: number, tolerance: number): number | null {
  const step = Math.round(rotation / 15) * 15
  const band = Math.min((tolerance / Math.max(reach, 1)) * (180 / Math.PI), SETTLE_MAX_DEG)
  if (Math.abs(rotation - step) > band) return null
  return step === -180 ? 180 : step
}

function angleOf(v: Vec): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI
}

/**
 * The box's rotation after the rotate knob moved from `startPointer` to
 * `pointer`, turning about the box's centre. Shift settles it on 15° steps.
 */
export function rotateBox(startRotation: number, center: Vec, startPointer: Vec, pointer: Vec, shift: boolean): number {
  let next = startRotation + (angleOf(sub(pointer, center)) - angleOf(sub(startPointer, center)))
  if (shift) next = Math.round(next / 15) * 15
  return normalizeDegrees(next)
}
