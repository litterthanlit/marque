import {
  add,
  clamp,
  cross,
  cubicPoint,
  cubicTangent,
  distance,
  dot,
  length,
  maxChordDeviation,
  normalize,
  normalizeDegrees,
  projectOnCubic,
  rotate,
  rotateAbout,
  scale,
  solveBend,
  sub,
  BEND_T_MAX,
  BEND_T_MIN,
  type Cubic,
  type Vec,
} from '../path/bezier.ts'
import type { IllustratorTransform } from '../illustrator/types.ts'
import {
  applyAffine,
  boxHandles,
  boxRotateHandle,
  DEFAULT_HANDLE_LAYOUT,
  MIN_BOX_SIZE,
  rotateBox,
  type Affine,
  type CarveHandle,
  type HandleId,
  type HandleLayout,
  type OrientedBox,
} from '../box/box.ts'
import { boxGeometryFor, carveOutline, grooveSpine, KAPPA, type SideRef } from './outline.ts'
import { isGroove } from './spec.ts'
import type {
  CarveBends,
  CarveSpec,
  CornerFullness,
  CornerId,
  GrooveSpec,
  LineSideId,
  PunchSpec,
  SideBend,
  SlabSpec,
} from './spec.ts'

/* ─── Handles ─── */

export type { CarveHandle, HandleId, HandleKind, HandleLayout } from '../box/box.ts'
export { DEFAULT_HANDLE_LAYOUT } from '../box/box.ts'

/**
 * The rounding dot travels half as far as the radius grows, so it stays near
 * its corner: even a full circle keeps its middle free for moving.
 */
const RADIUS_DOT_RATE = 0.5

const MIN_SIZE = MIN_BOX_SIZE
const MIN_GROOVE_WIDTH = 2
const MIN_PUNCH_RADIUS = 2

function hasBends(spec: CarveBends): boolean {
  return Boolean(
    (spec.sides && Object.keys(spec.sides).length) || (spec.corners && Object.keys(spec.corners).length),
  )
}

export function carveHandles(spec: CarveSpec, layout: HandleLayout = DEFAULT_HANDLE_LAYOUT): CarveHandle[] {
  const outline = carveOutline(spec)

  if (isGroove(spec)) {
    const spine = grooveSpine(spec)
    const mid = cubicPoint(spine, 0.5)
    const tan = cubicTangent(spine, 0.5)
    const nu = { x: tan.y, y: -tan.x }
    const axis = (Math.atan2(nu.y, nu.x) * 180) / Math.PI
    const chordAxis = (Math.atan2(spec.to.y - spec.from.y, spec.to.x - spec.from.x) * 180) / Math.PI
    return [
      { id: 'from', kind: 'endpoint', at: spec.from, axisDeg: chordAxis },
      { id: 'to', kind: 'endpoint', at: spec.to, axisDeg: chordAxis },
      { id: 'width', kind: 'width', at: add(mid, scale(nu, spec.width / 2 + layout.pad)), axisDeg: axis },
    ]
  }

  if (outline.frame.kind !== 'box') return []
  const { extent } = outline.frame
  // The box around the outline in the recipe's own frame; bends can push it off centre.
  const box: OrientedBox = {
    center: add(spec.center, rotate({ x: (extent.minX + extent.maxX) / 2, y: (extent.minY + extent.maxY) / 2 }, spec.rotation)),
    width: extent.maxX - extent.minX,
    height: extent.maxY - extent.minY,
    rotation: spec.rotation,
  }
  const toWorld = (p: Vec): Vec => add(spec.center, rotate(p, spec.rotation))
  const isPunch = spec.kind === 'punch'
  const handles = boxHandles(box, layout, { kind: isPunch ? 'scale' : 'resize', edges: !isPunch })

  if (spec.kind === 'slab') {
    const hw = Math.max(spec.width, 0.5) / 2
    const hh = Math.max(spec.height, 0.5) / 2
    const re = clamp(spec.radius, 0, Math.min(hw, hh))
    const inset = layout.radiusInset + re * RADIUS_DOT_RATE
    handles.push({
      id: 'radius',
      kind: 'radius',
      at: toWorld({ x: -hw + Math.min(inset, hw), y: -hh + Math.min(inset, hh) }),
      axisDeg: 45 + spec.rotation,
    })
  }

  const rotates = spec.kind === 'slab' || spec.shape !== 'circle' || hasBends(spec)
  if (rotates) handles.push(boxRotateHandle(box, layout))

  return handles
}

export interface DragModifiers {
  shift: boolean
  alt: boolean
}

const NO_MODS: DragModifiers = { shift: false, alt: false }

function scaleBends<T extends CarveBends>(spec: T, f: number): T {
  if (!spec.sides) return spec
  const sides: CarveBends['sides'] = {}
  for (const [id, bend] of Object.entries(spec.sides) as Array<[LineSideId, SideBend | undefined]>) {
    if (bend) sides[id] = { ...bend, o1: bend.o1 * f, o2: bend.o2 * f }
  }
  return { ...spec, sides }
}

function angleOf(v: Vec): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI
}

function rotationDrag(startRotation: number, center: Vec, startPointer: Vec, pointer: Vec, mods: DragModifiers): number {
  return rotateBox(startRotation, center, startPointer, pointer, mods.shift)
}

function dragSlab(start: SlabSpec, id: HandleId, startPointer: Vec, pointer: Vec, mods: DragModifiers): SlabSpec {
  if (id === 'rotate') {
    return { ...start, rotation: rotationDrag(start.rotation, start.center, startPointer, pointer, mods) }
  }

  const rot = start.rotation
  const q0 = rotate(sub(startPointer, start.center), -rot)
  const q = rotate(sub(pointer, start.center), -rot)
  const d = sub(q, q0)
  const hw = start.width / 2
  const hh = start.height / 2

  if (id === 'radius') {
    // The dot moves along the inward diagonal at RADIUS_DOT_RATE of the radius.
    const re = clamp(start.radius, 0, Math.min(hw, hh))
    return { ...start, radius: clamp(re + (d.x + d.y) / 2 / RADIUS_DOT_RATE, 0, Math.min(hw, hh)) }
  }

  const fx = id.includes('e') ? 1 : id.includes('w') ? -1 : 0
  const fy = id.includes('s') ? 1 : id === 'n' || id === 'ne' || id === 'nw' ? -1 : 0
  if (fx === 0 && fy === 0) return start

  const isCorner = fx !== 0 && fy !== 0
  if (isCorner && mods.shift) {
    // Uniform scale of the whole recipe about the opposite corner (or the centre with Alt).
    const anchor = mods.alt ? { x: 0, y: 0 } : { x: -fx * hw, y: -fy * hh }
    const corner = { x: fx * hw, y: fy * hh }
    const axis = sub(corner, anchor)
    const moved = add(corner, d)
    const minF = MIN_SIZE / Math.max(Math.min(start.width, start.height), MIN_SIZE)
    const f = Math.max(dot(sub(moved, anchor), axis) / Math.max(dot(axis, axis), 1e-9), minF)
    const centerLocal = scale(anchor, 1 - f)
    return scaleBends(
      {
        ...start,
        width: start.width * f,
        height: start.height * f,
        radius: start.radius * f,
        center: add(start.center, rotate(centerLocal, rot)),
      },
      f,
    )
  }

  let left = -hw
  let right = hw
  let top = -hh
  let bottom = hh
  if (fx === 1) right = mods.alt ? Math.max(hw + d.x, MIN_SIZE / 2) : Math.max(hw + d.x, left + MIN_SIZE)
  if (fx === -1) left = mods.alt ? Math.min(-hw + d.x, -MIN_SIZE / 2) : Math.min(-hw + d.x, right - MIN_SIZE)
  if (fy === 1) bottom = mods.alt ? Math.max(hh + d.y, MIN_SIZE / 2) : Math.max(hh + d.y, top + MIN_SIZE)
  if (fy === -1) top = mods.alt ? Math.min(-hh + d.y, -MIN_SIZE / 2) : Math.min(-hh + d.y, bottom - MIN_SIZE)
  if (mods.alt) {
    if (fx === 1) left = -right
    if (fx === -1) right = -left
    if (fy === 1) top = -bottom
    if (fy === -1) bottom = -top
  }

  let width = right - left
  let height = bottom - top
  if (!isCorner && mods.shift) {
    // Edge with Shift keeps the proportions, growing across the middle.
    if (fx !== 0) {
      const f = width / start.width
      height = start.height * f
      top = -height / 2
      bottom = height / 2
    } else {
      const f = height / start.height
      width = start.width * f
      left = -width / 2
      right = width / 2
    }
  }

  const centerLocal = { x: (left + right) / 2, y: (top + bottom) / 2 }
  return { ...start, width, height, center: add(start.center, rotate(centerLocal, rot)) }
}

function dragPunch(start: PunchSpec, id: HandleId, startPointer: Vec, pointer: Vec, mods: DragModifiers): PunchSpec {
  if (id === 'rotate') {
    return { ...start, rotation: rotationDrag(start.rotation, start.center, startPointer, pointer, mods) }
  }
  // Corner handles scale the punch about its centre; bends scale with it.
  const d0 = distance(startPointer, start.center)
  if (d0 < 1e-6) return start
  const f = Math.max(distance(pointer, start.center) / d0, MIN_PUNCH_RADIUS / start.radius)
  return scaleBends({ ...start, radius: start.radius * f }, f)
}

function snapAngleAround(origin: Vec, p: Vec): Vec {
  const v = sub(p, origin)
  const len = length(v)
  const snapped = Math.round(angleOf(v) / 15) * 15
  const r = (snapped * Math.PI) / 180
  return add(origin, { x: Math.cos(r) * len, y: Math.sin(r) * len })
}

function dragGroove(start: GrooveSpec, id: HandleId, startPointer: Vec, pointer: Vec, mods: DragModifiers): GrooveSpec {
  const delta = sub(pointer, startPointer)
  if (id === 'width') {
    const spine = grooveSpine(start)
    const tan = cubicTangent(spine, 0.5)
    const nu = { x: tan.y, y: -tan.x }
    return { ...start, width: Math.max(MIN_GROOVE_WIDTH, start.width + 2 * dot(delta, nu)) }
  }
  if (id !== 'from' && id !== 'to') return start
  const other = id === 'from' ? 'to' : 'from'
  let moved = add(start[id], delta)
  if (mods.shift) moved = snapAngleAround(start[other], moved)
  const next: GrooveSpec = id === 'from' ? { ...start, from: moved } : { ...start, to: moved }
  if (mods.alt) next[other] = sub(start[other], sub(moved, start[id]))
  return next
}

/**
 * Apply a handle drag. Computed from the recipe at drag start and the pointer
 * positions, never incrementally, so a drag can't drift.
 */
export function dragCarveHandle(
  start: CarveSpec,
  id: HandleId,
  startPointer: Vec,
  pointer: Vec,
  mods: DragModifiers = NO_MODS,
): CarveSpec {
  if (start.kind === 'slab') return dragSlab(start, id, startPointer, pointer, mods)
  if (start.kind === 'punch') return dragPunch(start, id, startPointer, pointer, mods)
  return dragGroove(start, id, startPointer, pointer, mods)
}

/**
 * A handle drag with what it changes at whole numbers, as box handles have
 * it with snapping on, so the number the readout shows is the number
 * stored: the knob's angle, a slab's width and height, a punch's diameter,
 * a groove's width. The side or point that stays put still does, and a
 * value keeps its exact size where rounding would take it below its floor.
 */
export function wholeCarveDrag(start: CarveSpec, raw: CarveSpec, id: HandleId, mods: DragModifiers = NO_MODS): CarveSpec {
  if (id === 'rotate' && !isGroove(raw)) {
    const rotation = normalizeDegrees(Math.round(raw.rotation))
    return rotation === raw.rotation ? raw : { ...raw, rotation }
  }
  if (raw.kind === 'punch' && start.kind === 'punch') {
    const radius = Math.round(raw.radius * 2) / 2
    if (radius === raw.radius || radius < MIN_PUNCH_RADIUS) return raw
    return scaleBends({ ...start, radius }, radius / start.radius)
  }
  if (raw.kind === 'slab' && start.kind === 'slab') return wholeSlabResize(start, raw, id, mods)
  if (isGroove(raw) && id === 'width') {
    const width = Math.round(raw.width)
    return width === raw.width || width < MIN_GROOVE_WIDTH ? raw : { ...raw, width }
  }
  return raw
}

function wholeSlabResize(start: SlabSpec, raw: SlabSpec, id: HandleId, mods: DragModifiers): SlabSpec {
  const fx = id.includes('e') ? 1 : id.includes('w') ? -1 : 0
  const fy = id.includes('s') ? 1 : id === 'n' || id === 'ne' || id === 'nw' ? -1 : 0
  if ((fx === 0 && fy === 0) || id === 'radius') return raw
  const whole = (side: number): number => (Math.round(side) >= MIN_SIZE ? Math.round(side) : side)
  // A side the handle doesn't pull keeps its size, whole or not.
  let width = fx !== 0 || mods.shift ? whole(raw.width) : raw.width
  let height = fy !== 0 || mods.shift ? whole(raw.height) : raw.height
  // Shift keeps the proportions: only the longer side is whole.
  if (mods.shift && start.width >= start.height) height = (start.height * width) / start.width
  else if (mods.shift) width = (start.width * height) / start.height
  // Rounding must not take the shorter side below the smallest slab.
  if (Math.min(width, height) < MIN_SIZE) return raw
  if (width === raw.width && height === raw.height) return raw
  const sx = width / start.width
  const sy = height / start.height
  // What stays put: the opposite corner or side, or the middle with Alt (and across a side pulled with Shift).
  const pivot = {
    x: mods.alt || fx === 0 ? 0 : (-fx * start.width) / 2,
    y: mods.alt || fy === 0 ? 0 : (-fy * start.height) / 2,
  }
  const center = add(start.center, rotate({ x: pivot.x * (1 - sx), y: pivot.y * (1 - sy) }, start.rotation))
  // A corner with Shift scales the whole recipe, its rounding and bends too.
  if (fx !== 0 && fy !== 0 && mods.shift) return scaleBends({ ...start, width, height, center, radius: start.radius * sx }, sx)
  return { ...raw, width, height, center }
}

/* ─── Bending ─── */

export interface CarveGrab {
  side: SideRef
  /** Parameter on the grabbed side's curve (boxes) or on the spine (grooves). */
  t: number
  /** Where the side was grabbed, layer space. */
  point: Vec
}

/** Pixels: a bend this close to straight snaps back to straight. */
export const STRAIGHT_SNAP = 2
const ROUND_SNAP = 0.06
/** Both handles reach the square corner: the squarest a rounded corner gets without poking out. */
export const MAX_FULLNESS = 1 / KAPPA

/** Find which side of a recipe a layer-space point is on, and where along it. */
export function locateCarveGrab(spec: CarveSpec, point: Vec): CarveGrab | null {
  const outline = carveOutline(spec)
  let best = -1
  let bestD = Infinity
  outline.curves.forEach((curve, i) => {
    const d = projectOnCubic(curve, point).distance
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  if (best < 0) return null
  const side = outline.curveSides[best]

  if (isGroove(spec)) {
    const hit = projectOnCubic(grooveSpine(spec), point)
    return { side, t: hit.t, point }
  }

  const geometry = boxGeometryFor(spec)
  const local = rotate(sub(point, spec.center), -spec.rotation)
  let cubic: Cubic | undefined
  if (side.type === 'line') cubic = geometry.sides[side.id]?.cubic
  if (side.type === 'corner') cubic = geometry.corners[side.id]?.cubic
  if (!cubic) return null
  return { side, t: projectOnCubic(cubic, local).t, point }
}

function sideBendFromCubic(c: Cubic, n: Vec): SideBend | null {
  const chord = sub(c[3], c[0])
  const len = length(chord)
  if (len < 1e-6) return null
  const e = scale(chord, 1 / len)
  return {
    a1: dot(sub(c[1], c[0]), e) / len - 1 / 3,
    o1: dot(sub(c[1], c[0]), n),
    a2: dot(sub(c[2], c[0]), e) / len - 2 / 3,
    o2: dot(sub(c[2], c[0]), n),
  }
}

type BoxSpec = SlabSpec | PunchSpec

function withSide(spec: BoxSpec, id: LineSideId, bend: SideBend | null): BoxSpec {
  const sides = { ...(spec.sides ?? {}) }
  if (bend) sides[id] = bend
  else delete sides[id]
  const next: BoxSpec = { ...spec }
  if (Object.keys(sides).length) next.sides = sides
  else delete next.sides
  return next
}

function withCorner(spec: BoxSpec, id: CornerId, fullness: CornerFullness | null): BoxSpec {
  const corners = { ...(spec.corners ?? {}) }
  if (fullness) corners[id] = fullness
  else delete corners[id]
  const next: BoxSpec = { ...spec }
  if (Object.keys(corners).length) next.corners = corners
  else delete next.corners
  return next
}

/**
 * Bend a recipe so the grabbed point follows the cursor. Straight sides store
 * the result in their own frame; corners change their fullness; grooves bend
 * their spine and keep an even width.
 */
export function bendCarve(start: CarveSpec, grab: CarveGrab, cursor: Vec): CarveSpec {
  if (isGroove(start)) {
    const spine = grooveSpine(start)
    const t = clamp(grab.t, BEND_T_MIN, BEND_T_MAX)
    const target = add(cubicPoint(spine, t), sub(cursor, grab.point))
    const bent = solveBend(spine, t, target)
    const chord = sub(start.to, start.from)
    if (length(chord) < 0.5) return start
    const e = normalize(chord)
    const bend = sideBendFromCubic(bent, { x: e.y, y: -e.x })
    const next: GrooveSpec = { ...start }
    if (!bend || maxChordDeviation(bent) < STRAIGHT_SNAP) delete next.bend
    else next.bend = bend
    return next
  }

  const geometry = boxGeometryFor(start)
  const local = rotate(sub(cursor, start.center), -start.rotation)
  const grabLocal = rotate(sub(grab.point, start.center), -start.rotation)

  if (grab.side.type === 'line') {
    const info = geometry.sides[grab.side.id]
    if (!info || info.chord < 1e-6) return start
    const t = clamp(grab.t, BEND_T_MIN, BEND_T_MAX)
    const target = add(cubicPoint(info.cubic, t), sub(local, grabLocal))
    const bent = solveBend(info.cubic, t, target)
    if (maxChordDeviation(bent) < STRAIGHT_SNAP) return withSide(start, grab.side.id, null)
    return withSide(start, grab.side.id, sideBendFromCubic(bent, info.n))
  }

  if (grab.side.type === 'corner') {
    const info = geometry.corners[grab.side.id]
    if (!info || info.radius < 1e-6) return start
    const t = clamp(grab.t, BEND_T_MIN, BEND_T_MAX)
    const target = add(cubicPoint(info.cubic, t), sub(local, grabLocal))
    const mt = 1 - t
    const b1 = 3 * mt * mt * t
    const b2 = 3 * mt * t * t
    // Handles keep their directions; solve their lengths so B(t) hits the target.
    const base = add(scale(info.a, mt * mt * mt + b1), scale(info.b, b2 + t * t * t))
    const col1 = scale(info.dirIn, b1)
    const col2 = scale(info.dirOut, -b2)
    const rhs = sub(target, base)
    const det = cross(col1, col2)
    if (Math.abs(det) < 1e-9) return start
    const l1 = cross(rhs, col2) / det
    const l2 = cross(col1, rhs) / det
    const unit = KAPPA * info.radius
    const k1 = clamp(l1 / unit, 0, MAX_FULLNESS)
    const k2 = clamp(l2 / unit, 0, MAX_FULLNESS)
    if (Math.abs(k1 - 1) < ROUND_SNAP && Math.abs(k2 - 1) < ROUND_SNAP) return withCorner(start, grab.side.id, null)
    return withCorner(start, grab.side.id, { k1, k2 })
  }

  return start
}

/** Remove the bend on one side (double-click an edge). */
export function straightenCarve(spec: CarveSpec, side: SideRef): CarveSpec {
  if (isGroove(spec)) {
    const next = { ...spec }
    delete next.bend
    return next
  }
  if (side.type === 'line') return withSide(spec, side.id, null)
  if (side.type === 'corner') return withCorner(spec, side.id, null)
  return spec
}

/** True when the side has a bend to straighten. */
export function isSideBent(spec: CarveSpec, side: SideRef): boolean {
  if (isGroove(spec)) return Boolean(spec.bend)
  if (side.type === 'line') return Boolean(spec.sides?.[side.id])
  if (side.type === 'corner') return Boolean(spec.corners?.[side.id])
  return false
}

/* ─── Moving, rotating, folding transforms ─── */

export function translateCarve(spec: CarveSpec, d: Vec): CarveSpec {
  if (isGroove(spec)) {
    return { ...spec, from: add(spec.from, d), to: add(spec.to, d) }
  }
  return { ...spec, center: add(spec.center, d) }
}

export function rotateCarveAbout(spec: CarveSpec, pivot: Vec, deg: number): CarveSpec {
  if (isGroove(spec)) {
    return { ...spec, from: rotateAbout(spec.from, pivot, deg), to: rotateAbout(spec.to, pivot, deg) }
  }
  return { ...spec, center: rotateAbout(spec.center, pivot, deg), rotation: normalizeDegrees(spec.rotation + deg) }
}

/**
 * Fold a layer transform into the recipe. Layer transforms scale and rotate
 * about the bounds centre of the untransformed path, then translate — a
 * similarity, which a recipe can represent exactly.
 */
export function foldTransform(spec: CarveSpec, t: IllustratorTransform, pivot: Vec): CarveSpec {
  const map = (p: Vec): Vec => add(add(pivot, rotate(scale(sub(p, pivot), t.scale), t.rotation)), { x: t.dx, y: t.dy })
  const s = t.scale
  if (isGroove(spec)) {
    const next: GrooveSpec = { ...spec, from: map(spec.from), to: map(spec.to), width: spec.width * s }
    if (spec.bend) next.bend = { ...spec.bend, o1: spec.bend.o1 * s, o2: spec.bend.o2 * s }
    return next
  }
  if (spec.kind === 'punch') {
    return scaleBends(
      { ...spec, center: map(spec.center), radius: spec.radius * s, rotation: normalizeDegrees(spec.rotation + t.rotation) },
      s,
    )
  }
  return scaleBends(
    {
      ...spec,
      center: map(spec.center),
      width: spec.width * s,
      height: spec.height * s,
      radius: spec.radius * s,
      rotation: normalizeDegrees(spec.rotation + t.rotation),
    },
    s,
  )
}

/**
 * A recipe scaled by `factor` about a pivot: its centre or ends move, and
 * every length scales alike (size, corner radius, width, bend offsets), so
 * the outline is the old outline scaled. Turning stays with rotateCarveAbout.
 */
export function scaleCarveAbout(spec: CarveSpec, pivot: Vec, factor: number): CarveSpec {
  return foldTransform(spec, { dx: 0, dy: 0, scale: factor, rotation: 0 }, pivot)
}

/**
 * A recipe under an affine map. A similarity (an even scale and a turn,
 * then a move) maps it exactly. Any other map would skew it out of being a
 * recipe, so it takes the similarity nearest the map: its centre (a
 * groove's middle) follows the map, its size scales by the square root of
 * the map's area factor, and it turns by the map's own rotation. A round
 * punch stays round, centred where the map puts its centre.
 */
export function carveUnderAffine(spec: CarveSpec, m: Affine): CarveSpec {
  const factor = Math.hypot(m.a, m.b)
  const similar = Math.abs(m.a - m.d) <= 1e-9 * Math.max(1, factor) && Math.abs(m.b + m.c) <= 1e-9 * Math.max(1, factor)
  // Read back off the matrix, a whole angle comes out a hair off: keep it whole.
  const whole = (radians: number) => Math.round(((radians * 180) / Math.PI) * 1e9) / 1e9
  if (similar && factor > 1e-9) {
    return foldTransform(spec, { dx: m.e, dy: m.f, scale: factor, rotation: whole(Math.atan2(m.b, m.a)) }, { x: 0, y: 0 })
  }
  const center = isGroove(spec) ? scale(add(spec.from, spec.to), 0.5) : spec.center
  const area = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))
  if (area <= 1e-9) return translateCarve(spec, sub(applyAffine(m, center), center))
  // The rotation of the map's polar decomposition: none for a stretch along any axis.
  const rotation = whole(Math.atan2(m.b - m.c, m.a + m.d))
  const moved = sub(applyAffine(m, center), center)
  return foldTransform(spec, { dx: moved.x, dy: moved.y, scale: area, rotation }, center)
}

export function isIdentityTransform(t: IllustratorTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0
}
