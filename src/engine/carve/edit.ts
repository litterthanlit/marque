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
}

export interface HandleLayout {
  /** Gap between the outline and the resize frame, in layer units. */
  pad: number
  /** Extra distance of the rotate dot above the frame. */
  rotateOffset: number
  /** Below this size, edge-midpoint handles are hidden to avoid crowding. */
  minEdgeHandleSize: number
}

export const DEFAULT_HANDLE_LAYOUT: HandleLayout = { pad: 12, rotateOffset: 22, minEdgeHandleSize: 30 }

const MIN_SIZE = 4
const MIN_GROOVE_WIDTH = 2
const MIN_PUNCH_RADIUS = 2

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
  const minX = extent.minX - layout.pad
  const maxX = extent.maxX + layout.pad
  const minY = extent.minY - layout.pad
  const maxY = extent.maxY + layout.pad
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const toWorld = (p: Vec): Vec => add(spec.center, rotate(p, spec.rotation))

  const handles: CarveHandle[] = []
  const isPunch = spec.kind === 'punch'
  for (const h of BOX_HANDLES) {
    const isEdge = h.fx === 0 || h.fy === 0
    if (isPunch && isEdge) continue
    if (isEdge) {
      const across = h.fx === 0 ? maxX - minX : maxY - minY
      if (across < layout.minEdgeHandleSize) continue
    }
    const local = {
      x: h.fx === -1 ? minX : h.fx === 1 ? maxX : midX,
      y: h.fy === -1 ? minY : h.fy === 1 ? maxY : midY,
    }
    handles.push({
      id: h.id,
      kind: isPunch ? 'scale' : 'resize',
      at: toWorld(local),
      axisDeg: h.axis + spec.rotation,
    })
  }

  if (spec.kind === 'slab') {
    const hw = Math.max(spec.width, 0.5) / 2
    const hh = Math.max(spec.height, 0.5) / 2
    const re = clamp(spec.radius, 0, Math.min(hw, hh))
    const inset = Math.max(re, 10)
    handles.push({
      id: 'radius',
      kind: 'radius',
      at: toWorld({ x: -hw + Math.min(inset, hw), y: -hh + Math.min(inset, hh) }),
      axisDeg: 45 + spec.rotation,
    })
  }

  const rotates = spec.kind === 'slab' || spec.shape !== 'circle' || hasBends(spec)
  if (rotates) {
    handles.push({ id: 'rotate', kind: 'rotate', at: toWorld({ x: midX, y: minY - layout.rotateOffset }), axisDeg: 0 })
  }

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
  let next = startRotation + (angleOf(sub(pointer, center)) - angleOf(sub(startPointer, center)))
  if (mods.shift) next = Math.round(next / 15) * 15
  return normalizeDegrees(next)
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
    const re = clamp(start.radius, 0, Math.min(hw, hh))
    return { ...start, radius: clamp(re + (d.x + d.y) / 2, 0, Math.min(hw, hh)) }
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
    const k1 = clamp(l1 / unit, 0, 3)
    const k2 = clamp(l2 / unit, 0, 3)
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

export function isIdentityTransform(t: IllustratorTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0
}
