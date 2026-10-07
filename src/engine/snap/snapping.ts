import { add, distance, dot, length, normalize, rotate, scale, sub, type Vec } from '../path/bezier.ts'
import { shapeAnchors, type EditableShape } from '../path/editPath.ts'
import { carveOutline, polygonParts } from '../carve/outline.ts'
import { bandParts, bandWidth } from '../carve/band.ts'
import { polygonCornerRadius, type CarveSpec, type PolygonSpec, type PunchSpec, type SlabSpec } from '../carve/spec.ts'
import type { IllustratorDocument, IllustratorLayer } from '../illustrator/types.ts'
import { asCircle, type Circle } from '../geometry/asCircle.ts'
import {
  contoursPrimitives,
  guidePrimitives,
  intersectPrimitives,
  nearestOnPrimitive,
  primitiveBounds,
  primitiveNear,
  recipePrimitives,
  type Primitive,
} from '../geometry/primitives.ts'
import { lineTouches, roundPrimitives, tangentAtAngle, tangentMove, tangentMoveAlong, tangentRadius, type Touch } from '../geometry/tangent.ts'
import type { Contour, Guide } from '../vector/types.ts'
import { shapeCentre } from '../vector/pins.ts'

/**
 * Live snapping, in layer space. Everything here is pure: the editor builds
 * an index of what can be snapped to when a drag starts, then asks where the
 * dragged geometry should land on every frame. The index holds every shape's
 * outline as analytic pieces, guides included, so an edge buried inside the
 * ink is a target too, and every hit knows whose it is.
 *
 * Priority within the tolerance (8 screen pixels):
 *   1. onto a point (anchors, corners, centres, the artboard centre, and
 *      where edges and guides cross)
 *   2. a moved circle touching a line, an edge, a guide or another circle;
 *      a moved line touching a circle
 *   3. aligned on both axes
 *   4. onto an edge, aligned on one axis as well
 *   5. aligned on one axis
 *   6. onto an edge or a guide
 *   7. along a 15° ray from an origin (the other end of a channel, a neighbour)
 */

export type SnapTargetKind = 'point' | 'centre' | 'intersection'

export interface SnapTarget {
  p: Vec
  kind: SnapTargetKind
  /** The object or guide the point belongs to; missing for the artboard centre and crossings. */
  owner?: string
  /** Set on a guide's points. */
  guide?: boolean
}

export interface EdgeHit {
  point: Vec
  distance: number
  /** Unit tangent of the edge at `point`. */
  tangent: Vec
  owner?: string
  guide?: boolean
}

export interface SnapIndex {
  targets: SnapTarget[]
  /** Nearest point on the other shapes' edges and the guides, if within `reach` (any distance when missing). */
  nearestEdge?: ((p: Vec, reach?: number) => EdgeHit | null) | null
  /** The other shapes' outlines and the guides, as pieces: for crossings and tangency. */
  primitives?: readonly Primitive[]
  /** The pieces that could come within `reach` of `p`: read from a grid, so only those around it. */
  piecesNear?: (p: Vec, reach: number) => readonly Primitive[]
}

/**
 * What a snap shows on the canvas, in pink: an alignment line, a cross where
 * the geometry landed, a short stroke along the line a circle touches, or a
 * ringed centre where a pin holds.
 */
export type SnapHint =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'mark'; p: Vec }
  | { kind: 'tangent'; p: Vec; dir: Vec }
  | { kind: 'pin'; p: Vec }

/** What decided a snap: the kind of target, whose it was, and which of the moving points landed on it. */
export interface SnapHit {
  kind: SnapTargetKind | 'tangent' | 'edge'
  owner: string | null
  guide: boolean
  moving: number
}

export interface SnapResult {
  /** Offset to add to the dragged geometry. */
  d: Vec
  /** Shown next to the pointer: "point", "centre", "tangent", "aligned", "edge", "on guide", "45°"… */
  label: string | null
  hints: SnapHint[]
  hit?: SnapHit
}

export const NO_SNAP: SnapResult = { d: { x: 0, y: 0 }, label: null, hints: [] }

export interface SnapOptions {
  /** Layer units (8 screen pixels at the current zoom). */
  tolerance: number
  /** Axes the geometry may move along: a Shift-locked move or an edge handle snaps along one. */
  axes?: { x: boolean; y: boolean }
  /** Let a single point land on other shapes' edges. */
  edges?: boolean
  /** Let a single point land on 15° rays from these origins. */
  rays?: Vec[]
  /** The moved geometry is this circle, where the moving points now are: it can snap to touch. */
  circle?: Circle
  /** The moved geometry is this infinite line, at `angle` degrees through `p` where it now is: it can snap to touch a circle. */
  line?: { p: Vec; angle: number }
  /**
   * Targets the index does not have, read one by one after its own: a few
   * that change from one move to the next, such as the pen's own points,
   * which would otherwise sort every target afresh on each move.
   */
  extra?: readonly SnapTarget[]
  /**
   * Which moving point may land where edges and guides cross: the one under
   * the pointer. A single point always may; with several, only this one does.
   */
  primary?: number | null
}

const SAME = 0.5
const AXIS_WAYS = { x: { x: 1, y: 0 }, y: { x: 0, y: 1 } } as const
const RAY_STEP = 15
/** Crossings are looked for among this many pieces nearest a point at most. */
const CROSSING_PIECES = 8
/** How many times curves may be halved in all, looking for where they cross near one point: curves that run along each other stop there. */
const CROSSING_SPLITS = 600

interface AxisHit {
  delta: number
  value: number
}

/** Targets sorted on each axis, so a moving point reads only those in reach: the order of each, and the values in that order. */
interface SortedTargets {
  x: { order: Int32Array; values: Float64Array }
  y: { order: Int32Array; values: Float64Array }
}

const sortedCache = new WeakMap<readonly SnapTarget[], SortedTargets>()

function sortedTargets(targets: readonly SnapTarget[]): SortedTargets {
  const cached = sortedCache.get(targets)
  if (cached) return cached
  const along = (axis: 'x' | 'y') => {
    const order = Int32Array.from(targets.keys()).sort((a, b) => targets[a].p[axis] - targets[b].p[axis])
    return { order, values: Float64Array.from(order, (i) => targets[i].p[axis]) }
  }
  const sorted = { x: along('x'), y: along('y') }
  sortedCache.set(targets, sorted)
  return sorted
}

/** Visit the targets whose `axis` is within `reach` of `value`, by index, in no set order: callers break ties by index. */
function forTargetsWithin(targets: readonly SnapTarget[], axis: 'x' | 'y', value: number, reach: number, visit: (index: number) => void): void {
  const { order, values } = sortedTargets(targets)[axis]
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] < value - reach) lo = mid + 1
    else hi = mid
  }
  for (let k = lo; k < values.length && values[k] <= value + reach; k++) visit(order[k])
}

/**
 * The nearest alignment on one axis; on a tie, the earliest moving point and
 * then the earliest target, as a plain scan would find. `extra` targets come
 * after the sorted ones, read one by one.
 */
function bestAxis(targets: SnapTarget[], extra: readonly SnapTarget[], moving: Vec[], axis: 'x' | 'y', tolerance: number): AxisHit | null {
  const found: { best: (AxisHit & { m: number; t: number }) | null } = { best: null }
  for (let m = 0; m < moving.length; m++) {
    const at = moving[m][axis]
    const consider = (target: SnapTarget, t: number) => {
      const delta = target.p[axis] - at
      if (Math.abs(delta) > tolerance) return
      const best = found.best
      const closer = !best || Math.abs(delta) < Math.abs(best.delta)
      const earlier = best !== null && Math.abs(delta) === Math.abs(best.delta) && best.m === m && t < best.t
      if (closer || earlier) found.best = { delta, value: target.p[axis], m, t }
    }
    forTargetsWithin(targets, axis, at, tolerance, (t) => consider(targets[t], t))
    extra.forEach((target, j) => consider(target, targets.length + j))
  }
  return found.best && { delta: found.best.delta, value: found.best.value }
}

/** A hint line through every target on the line, and the snapped geometry. */
function alignHint(axis: 'x' | 'y', value: number, targets: SnapTarget[], snapped: Vec[]): SnapHint {
  const other = axis === 'x' ? 'y' : 'x'
  let lo = Infinity
  let hi = -Infinity
  for (const p of [...targets.map((t) => t.p), ...snapped]) {
    if (Math.abs(p[axis] - value) > SAME) continue
    lo = Math.min(lo, p[other])
    hi = Math.max(hi, p[other])
  }
  return axis === 'x'
    ? { kind: 'line', a: { x: value, y: lo }, b: { x: value, y: hi } }
    : { kind: 'line', a: { x: lo, y: value }, b: { x: hi, y: value } }
}

/** How a target fares in a tie: a centre over any other point, then a shape's over a guide's or the artboard's. */
function rank(t: SnapTarget): number {
  return (t.kind === 'centre' ? 2 : 0) + (t.owner !== undefined && !t.guide ? 1 : 0)
}

const POINT_LABELS: Record<SnapTargetKind, string> = { point: 'point', centre: 'centre', intersection: 'intersection' }

/** The pieces of an index that could come within `reach` of `p`. */
function piecesNear(index: SnapIndex, p: Vec, reach: number): readonly Primitive[] {
  return index.piecesNear ? index.piecesNear(p, reach) : (index.primitives ?? [])
}

/** Where pieces cross within `tolerance` of `p`, found only near it, as it is asked. */
export function crossingsNear(primitives: readonly Primitive[], p: Vec, tolerance: number): SnapTarget[] {
  const near: Array<{ primitive: Primitive; d: number }> = []
  for (const primitive of primitives) {
    if (!primitiveNear(primitive, p, tolerance)) continue
    const d = nearestOnPrimitive(primitive, p).distance
    if (d <= tolerance) near.push({ primitive, d })
  }
  if (near.length < 2 || near.every((each) => each.primitive.owner === near[0].primitive.owner)) return []
  near.sort((a, b) => a.d - b.d)
  const pieces = near.slice(0, CROSSING_PIECES).map((each) => each.primitive)
  const out: SnapTarget[] = []
  const budget = { left: CROSSING_SPLITS }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      // A shape's own corners are its points already.
      if (pieces[i].owner === pieces[j].owner) continue
      for (const x of intersectPrimitives(pieces[i], pieces[j], budget)) {
        if (distance(x, p) <= tolerance) out.push({ p: x, kind: 'intersection' })
      }
    }
  }
  return out
}

/**
 * Marks along a line snapped to touch a circle at `touch`: there, and at
 * every other circle it touches too, as a line across two circles does.
 */
export function lineTouchHints(rounds: ReturnType<typeof roundPrimitives>, p: Vec, angle: number, touch: Touch): SnapHint[] {
  const dir = rotate({ x: 1, y: 0 }, angle)
  const others = lineTouches(p, angle, rounds).filter((each) => distance(each.p, touch.p) > 1e-6)
  return [touch, ...others].map((each) => ({ kind: 'tangent', p: each.p, dir }))
}

/** Short strokes along what a circle touches, at each touch. */
function touchHints(center: Vec, touches: readonly Touch[]): SnapHint[] {
  return touches.map(({ p }) => {
    const out = normalize(sub(center, p), { x: 0, y: -1 })
    return { kind: 'tangent', p, dir: { x: -out.y, y: out.x } }
  })
}

/**
 * Where a set of points moving together should land. All of them get the
 * same offset; whichever snaps best decides it.
 */
export function snapMoving(index: SnapIndex, moving: Vec[], options: SnapOptions): SnapResult {
  if (!moving.length) return NO_SNAP
  const tol = options.tolerance
  const ax = options.axes?.x ?? true
  const ay = options.axes?.y ?? true
  const single = moving.length === 1 ? moving[0] : null
  const extra = options.extra ?? []

  // 1. Onto a point, or where edges and guides cross.
  if (ax && ay) {
    const found: { best: { m: Vec; i: number; t: SnapTarget; k: number; dist: number } | null } = { best: null }
    // `k` orders targets on a full tie: the earliest wins, as a plain scan would find; crossings come after every target.
    const consider = (m: Vec, i: number, t: SnapTarget, k: number) => {
      const dist = distance(m, t.p)
      if (dist > tol) return
      const best = found.best
      const closer = !best || dist < best.dist - 1e-9
      // On a tie a centre wins, and a shape's point wins over a guide's or the artboard's: a pin can hold to it.
      const tie = best !== null && Math.abs(dist - best.dist) <= 1e-9
      const better = tie && (rank(t) > rank(best.t) || (rank(t) === rank(best.t) && best.i === i && k < best.k))
      if (closer || better) found.best = { m, i, t, k, dist }
    }
    for (let i = 0; i < moving.length; i++) {
      const m = moving[i]
      // Only the targets in reach on x are read; of those, most are far off on y.
      forTargetsWithin(index.targets, 'x', m.x, tol, (k) => {
        const t = index.targets[k]
        if (Math.abs(t.p.y - m.y) <= tol) consider(m, i, t, k)
      })
      extra.forEach((t, j) => consider(m, i, t, index.targets.length + j))
    }
    // Crossings cost far more to find than points: they are looked for once, near the primary point
    // alone, and only where one could be nearer than the best point found.
    const primary = options.primary ?? (single ? 0 : null)
    if (primary !== null && primary < moving.length && index.primitives) {
      const reach = found.best ? found.best.dist : tol
      const m = moving[primary]
      if (reach >= 1e-9) for (const t of crossingsNear(piecesNear(index, m, reach), m, reach)) consider(m, primary, t, Infinity)
    }
    if (found.best) {
      const { m, i, t } = found.best
      return {
        d: sub(t.p, m),
        label: POINT_LABELS[t.kind],
        hints: [{ kind: 'mark', p: t.p }],
        hit: { kind: t.kind, owner: t.owner ?? null, guide: t.guide === true, moving: i },
      }
    }
  }

  // 2. A moved circle touching a line, an edge or a circle; a moved line touching a circle. Along the free axis alone when one is locked.
  const locked = ax && ay ? null : ax ? 'x' : ay ? 'y' : undefined
  if (options.circle && locked !== undefined && index.primitives) {
    const near = piecesNear(index, options.circle.c, options.circle.r + tol)
    const touch = locked ? tangentMoveAlong(near, options.circle, locked, tol) : tangentMove(near, options.circle, tol)
    if (touch) {
      const first = touch.touches[0]
      return {
        d: sub(touch.center, options.circle.c),
        label: 'tangent',
        hints: touchHints(touch.center, touch.touches),
        hit: { kind: 'tangent', owner: first.owner, guide: first.guide, moving: 0 },
      }
    }
  }
  if (options.line && locked !== undefined && index.primitives) {
    const { p, angle } = options.line
    const rounds = roundPrimitives(index.primitives)
    const touch = tangentAtAngle(p, angle, rounds, tol, locked ? AXIS_WAYS[locked] : undefined)
    if (touch) {
      return {
        d: sub(touch.p, p),
        label: 'tangent',
        hints: lineTouchHints(rounds, touch.p, angle, touch.touch),
        hit: { kind: 'tangent', owner: touch.touch.owner, guide: touch.touch.guide, moving: 0 },
      }
    }
  }

  const bx = ax ? bestAxis(index.targets, extra, moving, 'x', tol) : null
  const by = ay ? bestAxis(index.targets, extra, moving, 'y', tol) : null
  // The extra targets are drawn through as the index's own are.
  const along = (snapped: Vec[]) => [...snapped, ...extra.map((target) => target.p)]

  // 3. Aligned on both axes.
  if (bx && by) {
    const d = { x: bx.delta, y: by.delta }
    const snapped = moving.map((m) => add(m, d))
    return {
      d,
      label: 'aligned',
      hints: [alignHint('x', bx.value, index.targets, along(snapped)), alignHint('y', by.value, index.targets, along(snapped))],
    }
  }

  const edge = single && ax && ay && options.edges && index.nearestEdge ? index.nearestEdge(single, tol) : null
  const onEdge = edge && edge.distance <= tol ? edge : null
  const edgeLabel = onEdge?.guide ? 'on guide' : 'edge'
  const edgeHit = (edge: EdgeHit): SnapHit => ({ kind: 'edge', owner: edge.owner ?? null, guide: edge.guide === true, moving: 0 })

  // 4. Onto an edge where it crosses an alignment line.
  if (onEdge && single && (bx || by) && index.nearestEdge) {
    const combo = edgeOnAxis(index.nearestEdge, onEdge, bx ? 'x' : 'y', (bx ?? by)!.value, tol)
    if (combo && distance(combo, single) <= tol) {
      const axis = bx ? 'x' : 'y'
      return {
        d: sub(combo, single),
        label: edgeLabel,
        hints: [{ kind: 'mark', p: combo }, alignHint(axis, (bx ?? by)!.value, index.targets, along([combo]))],
        hit: edgeHit(onEdge),
      }
    }
  }

  // 5. Aligned on one axis.
  if (bx || by) {
    const d = { x: bx?.delta ?? 0, y: by?.delta ?? 0 }
    const snapped = moving.map((m) => add(m, d))
    const hints = bx ? [alignHint('x', bx.value, index.targets, along(snapped))] : [alignHint('y', by!.value, index.targets, along(snapped))]
    return { d, label: 'aligned', hints }
  }

  // 6. Onto an edge or a guide.
  if (onEdge && single) {
    return { d: sub(onEdge.point, single), label: edgeLabel, hints: [{ kind: 'mark', p: onEdge.point }], hit: edgeHit(onEdge) }
  }

  // 7. Along a 15° ray.
  if (single && ax && ay && options.rays?.length) {
    const ray = nearestRay(single, options.rays, tol)
    if (ray) return ray
  }

  return NO_SNAP
}

/** Slide along the edge (locally straight) until the given axis matches, then settle back onto it. */
function edgeOnAxis(nearestEdge: NonNullable<SnapIndex['nearestEdge']>, hit: EdgeHit, axis: 'x' | 'y', value: number, tolerance: number): Vec | null {
  const along = hit.tangent[axis]
  if (Math.abs(along) < 0.2) return null
  const moved = add(hit.point, scale(hit.tangent, (value - hit.point[axis]) / along))
  const settled = nearestEdge(moved, tolerance * 2)
  if (!settled) return null
  const p = axis === 'x' ? { x: value, y: settled.point.y } : { x: settled.point.x, y: value }
  return distance(p, settled.point) <= SAME ? p : null
}

function nearestRay(p: Vec, origins: Vec[], tolerance: number): SnapResult | null {
  let best: { point: Vec; origin: Vec; angle: number; off: number } | null = null
  for (const origin of origins) {
    const v = sub(p, origin)
    const len = length(v)
    // Too close to the origin, any angle is within reach: don't snap.
    if (len < tolerance * 2) continue
    const angle = Math.round(((Math.atan2(v.y, v.x) * 180) / Math.PI) / RAY_STEP) * RAY_STEP
    const dir = rotate({ x: 1, y: 0 }, angle)
    const point = add(origin, scale(dir, dot(v, dir)))
    const off = distance(point, p)
    if (off <= tolerance && (!best || off < best.off)) best = { point, origin, angle, off }
  }
  if (!best) return null
  // Lines read counter-clockwise from the right, as on a protractor: flat is 0°, upright 90°.
  const shown = ((-best.angle % 180) + 180) % 180
  return {
    d: sub(best.point, p),
    label: `${shown}°`,
    hints: [{ kind: 'line', a: best.origin, b: add(best.point, scale(normalize(sub(best.point, best.origin)), tolerance * 2)) }],
  }
}

/** Snap a size to one already used nearby ("same size"). */
export function snapValue(value: number, candidates: number[], tolerance: number): number | null {
  let best: number | null = null
  for (const c of candidates) {
    if (Math.abs(c - value) <= tolerance && (best === null || Math.abs(c - value) < Math.abs(best - value))) best = c
  }
  return best
}

/**
 * The size of a circle being resized about `pivot` (its centre, or the
 * corner that stays put) that just touches a piece, as a snap: null when
 * none is within `tolerance`.
 */
export function snapRadiusTangent(index: SnapIndex, circle: Circle, pivot: Vec, tolerance: number): { radius: number; center: Vec; snap: SnapResult } | null {
  if (!index.primitives || circle.r < 1e-9) return null
  // The centre moves along with the size, by the pivot's distance from it for each unit: the pieces are read that far round it.
  const reach = circle.r + tolerance * (1 + distance(circle.c, pivot) / circle.r)
  const found = tangentRadius(piecesNear(index, circle.c, reach), circle, pivot, tolerance)
  if (!found) return null
  return {
    radius: found.radius,
    center: found.center,
    snap: {
      d: { x: 0, y: 0 },
      label: 'tangent',
      hints: touchHints(found.center, [found.touch]),
      hit: { kind: 'tangent', owner: found.touch.owner, guide: found.touch.guide, moving: 0 },
    },
  }
}

/* ─── What a document offers to snap to ─── */

/**
 * Corners, side middles and centre of a recipe; a polygon's corners, side
 * middles and the tangent points of its rounded corners; a groove's ends and
 * middle; a circle's quadrants; a band's middle and the points where it
 * touches its circles.
 */
export function carveKeyPoints(spec: CarveSpec, owner?: string): SnapTarget[] {
  const own = owner === undefined ? {} : { owner }
  switch (spec.kind) {
    case 'channel':
    case 'slice':
      return [
        { p: spec.from, kind: 'point', ...own },
        { p: spec.to, kind: 'point', ...own },
        { p: scale(add(spec.from, spec.to), 0.5), kind: 'centre', ...own },
      ]
    case 'polygon':
      return polygonKeyPoints(spec, owner)
    case 'slab':
    case 'punch':
      return boxKeyPoints(spec, owner)
    case 'band':
      // The middle between its circles, and where it touches them; the circles offer their own centres.
      return [
        { p: scale(add(spec.a.c, spec.b.c), 0.5), kind: 'centre', ...own },
        ...(bandParts(spec)?.touches ?? []).map((p): SnapTarget => ({ p, kind: 'point', ...own })),
      ]
    default:
      return spec satisfies never
  }
}

function polygonKeyPoints(spec: PolygonSpec, owner?: string): SnapTarget[] {
  const own = owner === undefined ? {} : { owner }
  const parts = polygonParts(spec)
  const points = [...parts.vertices, ...parts.midpoints, ...parts.corners.flatMap((corner) => [corner.a, corner.b])]
  return [{ p: spec.center, kind: 'centre', ...own }, ...points.map((p): SnapTarget => ({ p, kind: 'point', ...own }))]
}

function boxKeyPoints(spec: SlabSpec | PunchSpec, owner?: string): SnapTarget[] {
  const own = owner === undefined ? {} : { owner }
  const out: SnapTarget[] = [{ p: spec.center, kind: 'centre', ...own }]
  if (spec.kind === 'punch' && spec.shape === 'triangle') {
    const plain: PunchSpec = { ...spec }
    delete plain.sides
    delete plain.corners
    for (const seg of carveOutline(plain).segs) out.push({ p: seg.p, kind: 'point', ...own })
    return out
  }
  const hw = spec.kind === 'punch' ? spec.radius : spec.width / 2
  const hh = spec.kind === 'punch' ? spec.radius : spec.height / 2
  const at = (x: number, y: number) => add(spec.center, rotate({ x, y }, spec.rotation))
  for (const [x, y] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [0, -hh],
    [hw, 0],
    [0, hh],
    [-hw, 0],
  ]) {
    out.push({ p: at(x, y), kind: 'point', ...own })
  }
  // A turned circle's side middles are off its quadrants: those are offered too.
  const circle = asCircle({ carve: spec, contours: [] })
  if (circle && spec.rotation % 90 !== 0) out.push(...quadrants(circle, owner))
  return out
}

function quadrants(circle: Circle, owner?: string, guide = false): SnapTarget[] {
  const own = owner === undefined ? {} : { owner }
  return [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ].map((u) => ({ p: add(circle.c, scale(u, circle.r)), kind: 'point' as const, ...own, ...(guide ? { guide: true } : {}) }))
}

/** A free shape's contours, for reading it as a circle or as pieces. */
export function shapeContours(shape: EditableShape): Contour[] {
  return shape.map((path) => ({
    closed: path.closed,
    segments: path.segs.map((seg) => ({ point: seg.p, handleIn: seg.hIn, handleOut: seg.hOut })),
  }))
}

/** Anchors of a free shape, on every contour, and its centre: a circle's, or the middle of its anchors' box in its frame, turned `rotation`; a circle's quadrants too. */
export function freeKeyPoints(shape: EditableShape, owner?: string, rotation = 0): SnapTarget[] {
  const anchors = shapeAnchors(shape)
  if (!anchors.length) return []
  const own = owner === undefined ? {} : { owner }
  const contours = shapeContours(shape)
  const circle = asCircle({ contours })
  const centre = shapeCentre({ contours, frame: { rotation } })!
  return [
    ...anchors.map((p) => ({ p, kind: 'point' as const, ...own })),
    { p: centre, kind: 'centre', ...own },
    ...(circle ? quadrants(circle, owner) : []),
  ]
}

/** The bounds box of a free shape, for moving it: corners, side middles and centre. */
export function freeBoxPoints(shape: EditableShape): Vec[] {
  const anchors = shapeAnchors(shape)
  if (!anchors.length) return []
  const { minX, minY, maxX, maxY, center } = pointsBounds(anchors)
  return [
    center,
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: center.x, y: minY },
    { x: maxX, y: center.y },
    { x: center.x, y: maxY },
    { x: minX, y: center.y },
  ]
}

function pointsBounds(points: Vec[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } }
}

/** A guide's points: a circle's centre and quadrants, a path's anchors. A line has none of its own; where it crosses things does. */
export function guideKeyTargets(guide: Guide): SnapTarget[] {
  const { shape } = guide
  switch (shape.kind) {
    case 'line':
      return []
    case 'circle':
      return [{ p: shape.c, kind: 'centre', owner: guide.id, guide: true }, ...quadrants({ c: shape.c, r: shape.r }, guide.id, true)]
    case 'path':
      return shape.contour.segments.map((segment) => ({ p: segment.point, kind: 'point', owner: guide.id, guide: true }))
    default:
      return shape satisfies never
  }
}

/** Everything visible to snap to, except the layers being edited; the artboard centre included. */
export function documentSnapTargets(
  doc: IllustratorDocument,
  exclude: Set<string>,
  freePathOf: (layer: IllustratorLayer) => EditableShape | null,
): SnapTarget[] {
  const targets: SnapTarget[] = [{ p: { x: 0, y: 0 }, kind: 'centre' }]
  for (const layer of doc.layers) {
    if (!layer.visible || exclude.has(layer.id)) continue
    if (layer.carve) {
      targets.push(...carveKeyPoints(layer.carve, layer.id))
      continue
    }
    const path = freePathOf(layer)
    if (path) targets.push(...freeKeyPoints(path, layer.id, layer.frameRotation))
  }
  return targets
}

const layerPieces = new WeakMap<IllustratorLayer, readonly Primitive[]>()

/** A layer's outline as pieces: its recipe's, or its free shape's. Kept per layer, which is immutable. */
export function layerPrimitives(layer: IllustratorLayer, freePathOf: (layer: IllustratorLayer) => EditableShape | null): readonly Primitive[] {
  const cached = layerPieces.get(layer)
  if (cached) return cached
  const shape = layer.carve ? null : freePathOf(layer)
  const pieces = layer.carve ? recipePrimitives(layer.carve, layer.id) : shape ? contoursPrimitives(shapeContours(shape), layer.id) : []
  layerPieces.set(layer, pieces)
  return pieces
}

/** What a snap index is built from: the document, the layers left out, and the guides to snap to. */
export interface SnapSources {
  doc: IllustratorDocument
  exclude: Set<string>
  freePathOf: (layer: IllustratorLayer) => EditableShape | null
  guides?: readonly Guide[]
  /** Targets the document doesn't have yet: the pen's own points. */
  extra?: SnapTarget[]
}

/** The index a gesture snaps to: every visible layer but the excluded ones, and the guides given, as points and pieces. */
export function documentSnapIndex({ doc, exclude, freePathOf, guides = [], extra = [] }: SnapSources): SnapIndex {
  const targets = [...documentSnapTargets(doc, exclude, freePathOf), ...guides.flatMap(guideKeyTargets), ...extra]
  const primitives: Primitive[] = []
  for (const layer of doc.layers) {
    if (layer.visible && !exclude.has(layer.id)) primitives.push(...layerPrimitives(layer, freePathOf))
  }
  for (const guide of guides) primitives.push(...guidePrimitives(guide))
  return primitiveIndex(targets, primitives)
}

/** An index over some points and pieces, its nearest edge read from the pieces. */
export function primitiveIndex(targets: SnapTarget[], primitives: readonly Primitive[]): SnapIndex {
  const near = pieceGrid(primitives)
  const nearestEdge = (p: Vec, reach = Infinity): EdgeHit | null => {
    let best: EdgeHit | null = null
    for (const primitive of near(p, reach)) {
      const within = Math.min(reach, best?.distance ?? Infinity)
      if (Number.isFinite(within) && !primitiveNear(primitive, p, within)) continue
      const hit = nearestOnPrimitive(primitive, p)
      if (hit.distance > within || (best && hit.distance >= best.distance)) continue
      best = { point: hit.point, distance: hit.distance, tangent: hit.tangent, owner: primitive.owner, guide: primitive.guide === true }
    }
    return best
  }
  return { targets, primitives, nearestEdge, piecesNear: near }
}

/** The side of a cell of the grid pieces are filed in, in layer units. */
const CELL = 64
/** A piece spanning more cells than this is filed as reaching everywhere. */
const MOST_CELLS = 1024

/**
 * Pieces filed in a coarse grid by their bounds, read back by where a query
 * reaches: a pointer move reads only the pieces around it, not every piece
 * of a busy mark. Infinite lines and very large pieces are read always.
 */
function pieceGrid(primitives: readonly Primitive[]): (p: Vec, reach: number) => readonly Primitive[] {
  const bounds = primitives.map(primitiveBounds)
  const cells = new Map<string, number[]>()
  const always: number[] = []
  const cellOf = (v: number) => Math.floor(v / CELL)
  bounds.forEach((b, i) => {
    const [x0, x1, y0, y1] = [cellOf(b.minX), cellOf(b.maxX), cellOf(b.minY), cellOf(b.maxY)]
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MOST_CELLS) {
      always.push(i)
      return
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x} ${y}`
        const cell = cells.get(key)
        if (cell) cell.push(i)
        else cells.set(key, [i])
      }
    }
  })
  // Each query stamps the pieces it has read, so one filed in several cells is read once.
  const seen = new Uint32Array(primitives.length)
  let stamp = 0
  return (p, reach) => {
    const [x0, x1, y0, y1] = [cellOf(p.x - reach), cellOf(p.x + reach), cellOf(p.y - reach), cellOf(p.y + reach)]
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MOST_CELLS) return primitives
    stamp++
    const out: Primitive[] = []
    const take = (i: number) => {
      if (seen[i] === stamp) return
      seen[i] = stamp
      const b = bounds[i]
      if (p.x >= b.minX - reach && p.x <= b.maxX + reach && p.y >= b.minY - reach && p.y <= b.maxY + reach) out.push(primitives[i])
    }
    for (const i of always) take(i)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) cells.get(`${x} ${y}`)?.forEach(take)
    }
    return out
  }
}

/** Sizes already in use, for "same size". */
export interface DocumentSizes {
  /** Corner radii of slabs and polygons. */
  radii: number[]
  /** Punch radii, of every shape. */
  punchRadii: number[]
  /** Polygon radii: how far their sharp corners reach from the centre. */
  polygonRadii: number[]
  /** Groove widths, and the widths of bars and strips. */
  widths: number[]
  /** The radius of everything read as a circle: circle slabs and punches, spark circles, circle guides. */
  circleRadii: number[]
  /** Slab widths and heights. */
  slabSides: number[]
}

/**
 * Sizes already in use, for "same size", leaving out the layers and guides
 * being edited. Circle guides count only among `guides`: pass the ones on
 * the canvas, as the snap index has them, so a hidden guide offers no size.
 */
export function documentSizes(
  doc: IllustratorDocument,
  exclude: ReadonlySet<string>,
  freePathOf?: (layer: IllustratorLayer) => EditableShape | null,
  guides: readonly Guide[] = doc.guides ?? [],
): DocumentSizes {
  const sizes: DocumentSizes = { radii: [], punchRadii: [], polygonRadii: [], widths: [], circleRadii: [], slabSides: [] }
  for (const layer of doc.layers) {
    if (!layer.visible || exclude.has(layer.id)) continue
    const spec = layer.carve
    if (!spec) {
      const shape = freePathOf?.(layer)
      const circle = shape ? asCircle({ contours: shapeContours(shape) }) : null
      if (circle) sizes.circleRadii.push(circle.r)
      continue
    }
    const circle = asCircle({ carve: spec, contours: [] })
    if (circle) sizes.circleRadii.push(circle.r)
    switch (spec.kind) {
      case 'slab':
        sizes.radii.push(Math.min(spec.radius, spec.width / 2, spec.height / 2))
        sizes.slabSides.push(spec.width, spec.height)
        break
      case 'punch':
        sizes.punchRadii.push(spec.radius)
        break
      case 'polygon': {
        sizes.polygonRadii.push(spec.radius)
        const corner = polygonCornerRadius(spec)
        if (corner > 0) sizes.radii.push(corner)
        break
      }
      case 'channel':
      case 'slice':
        sizes.widths.push(spec.width)
        break
      case 'band': {
        // A bar's or strip's width is a width like a groove's: a groove can take it, and it shows as the same size.
        const width = spec.fit === 'bar' || spec.fit === 'strip' ? bandWidth(spec) : null
        if (width !== null) sizes.widths.push(width)
        break
      }
      default:
        spec satisfies never
    }
  }
  for (const guide of guides) {
    if (guide.visible && guide.shape.kind === 'circle' && !exclude.has(guide.id)) sizes.circleRadii.push(guide.shape.r)
  }
  return sizes
}
