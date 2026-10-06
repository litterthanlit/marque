import { add, distance, dot, length, normalize, rotate, scale, sub, type Vec } from '../path/bezier.ts'
import { shapeAnchors, type EditableShape } from '../path/editPath.ts'
import { carveOutline } from '../carve/outline.ts'
import { isGroove, type CarveSpec } from '../carve/spec.ts'
import type { IllustratorDocument, IllustratorLayer } from '../illustrator/types.ts'

/**
 * Live snapping, in layer space. Everything here is pure: the editor builds
 * an index of what can be snapped to when a drag starts, then asks where the
 * dragged geometry should land on every frame.
 *
 * Priority within the tolerance (8 screen pixels):
 *   1. onto a point (anchors, corners, centres, the artboard centre)
 *   2. aligned on both axes
 *   3. onto an edge, aligned on one axis as well
 *   4. aligned on one axis
 *   5. onto an edge
 *   6. along a 15° ray from an origin (the other end of a channel, a neighbour)
 */

export type SnapTargetKind = 'point' | 'centre'

export interface SnapTarget {
  p: Vec
  kind: SnapTargetKind
}

export interface EdgeHit {
  point: Vec
  distance: number
  /** Unit tangent of the edge at `point`. */
  tangent: Vec
}

export interface SnapIndex {
  targets: SnapTarget[]
  /** Nearest point on the edges of the other shapes' ink. */
  nearestEdge?: ((p: Vec) => EdgeHit | null) | null
}

export type SnapGuide = { kind: 'line'; a: Vec; b: Vec } | { kind: 'mark'; p: Vec }

export interface SnapResult {
  /** Offset to add to the dragged geometry. */
  d: Vec
  /** Shown next to the pointer: "point", "centre", "aligned", "edge", "45°"… */
  label: string | null
  guides: SnapGuide[]
}

export const NO_SNAP: SnapResult = { d: { x: 0, y: 0 }, label: null, guides: [] }

export interface SnapOptions {
  /** Layer units (8 screen pixels at the current zoom). */
  tolerance: number
  /** Axes the geometry may move along: a Shift-locked move or an edge handle snaps along one. */
  axes?: { x: boolean; y: boolean }
  /** Let a single point land on other shapes' edges. */
  edges?: boolean
  /** Let a single point land on 15° rays from these origins. */
  rays?: Vec[]
}

const SAME = 0.5
const RAY_STEP = 15

interface AxisHit {
  delta: number
  value: number
}

function bestAxis(targets: SnapTarget[], moving: Vec[], axis: 'x' | 'y', tolerance: number): AxisHit | null {
  let best: AxisHit | null = null
  for (const m of moving) {
    for (const t of targets) {
      const delta = t.p[axis] - m[axis]
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, value: t.p[axis] }
      }
    }
  }
  return best
}

/** A guide through every target on the line, and the snapped geometry. */
function alignGuide(axis: 'x' | 'y', value: number, targets: SnapTarget[], snapped: Vec[]): SnapGuide {
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

  // 1. Onto a point.
  if (ax && ay) {
    let best: { m: Vec; t: SnapTarget; dist: number } | null = null
    for (const m of moving) {
      for (const t of index.targets) {
        const dist = distance(m, t.p)
        if (dist > tol) continue
        const closer = !best || dist < best.dist - 1e-9
        const tieToCentre = best && Math.abs(dist - best.dist) <= 1e-9 && t.kind === 'centre' && best.t.kind !== 'centre'
        if (closer || tieToCentre) best = { m, t, dist }
      }
    }
    if (best) {
      return { d: sub(best.t.p, best.m), label: best.t.kind === 'centre' ? 'centre' : 'point', guides: [{ kind: 'mark', p: best.t.p }] }
    }
  }

  const bx = ax ? bestAxis(index.targets, moving, 'x', tol) : null
  const by = ay ? bestAxis(index.targets, moving, 'y', tol) : null

  // 2. Aligned on both axes.
  if (bx && by) {
    const d = { x: bx.delta, y: by.delta }
    const snapped = moving.map((m) => add(m, d))
    return {
      d,
      label: 'aligned',
      guides: [alignGuide('x', bx.value, index.targets, snapped), alignGuide('y', by.value, index.targets, snapped)],
    }
  }

  const edge = single && ax && ay && options.edges && index.nearestEdge ? index.nearestEdge(single) : null
  const onEdge = edge && edge.distance <= tol ? edge : null

  // 3. Onto an edge where it crosses an alignment line.
  if (onEdge && single && (bx || by) && index.nearestEdge) {
    const combo = edgeOnAxis(index.nearestEdge, onEdge, bx ? 'x' : 'y', (bx ?? by)!.value)
    if (combo && distance(combo, single) <= tol) {
      const axis = bx ? 'x' : 'y'
      return {
        d: sub(combo, single),
        label: 'edge',
        guides: [{ kind: 'mark', p: combo }, alignGuide(axis, (bx ?? by)!.value, index.targets, [combo])],
      }
    }
  }

  // 4. Aligned on one axis.
  if (bx || by) {
    const d = { x: bx?.delta ?? 0, y: by?.delta ?? 0 }
    const snapped = moving.map((m) => add(m, d))
    const guides = bx ? [alignGuide('x', bx.value, index.targets, snapped)] : [alignGuide('y', by!.value, index.targets, snapped)]
    return { d, label: 'aligned', guides }
  }

  // 5. Onto an edge.
  if (onEdge && single) {
    return { d: sub(onEdge.point, single), label: 'edge', guides: [{ kind: 'mark', p: onEdge.point }] }
  }

  // 6. Along a 15° ray.
  if (single && ax && ay && options.rays?.length) {
    const ray = nearestRay(single, options.rays, tol)
    if (ray) return ray
  }

  return NO_SNAP
}

/** Slide along the edge (locally straight) until the given axis matches, then settle back onto it. */
function edgeOnAxis(nearestEdge: (p: Vec) => EdgeHit | null, hit: EdgeHit, axis: 'x' | 'y', value: number): Vec | null {
  const along = hit.tangent[axis]
  if (Math.abs(along) < 0.2) return null
  const moved = add(hit.point, scale(hit.tangent, (value - hit.point[axis]) / along))
  const settled = nearestEdge(moved)
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
    guides: [{ kind: 'line', a: best.origin, b: add(best.point, scale(normalize(sub(best.point, best.origin)), tolerance * 2)) }],
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
 * A round punch whose rim almost touches another shape's edge: move it (or
 * size it) so it just touches.
 */
export function snapCircleTangent(
  index: SnapIndex,
  center: Vec,
  radius: number,
  tolerance: number,
  mode: 'move' | 'radius',
): { center: Vec; radius: number; touch: Vec } | null {
  const hit = index.nearestEdge?.(center)
  if (!hit || Math.abs(hit.distance - radius) > tolerance) return null
  if (mode === 'radius') return { center, radius: hit.distance, touch: hit.point }
  const away = sub(center, hit.point)
  if (length(away) < 1e-6) return null
  return { center: add(hit.point, scale(normalize(away), radius)), radius, touch: hit.point }
}

/* ─── What a document offers to snap to ─── */

/** Corners, side middles and centre of a recipe; a groove's ends and middle. */
export function carveKeyPoints(spec: CarveSpec): SnapTarget[] {
  if (isGroove(spec)) {
    return [
      { p: spec.from, kind: 'point' },
      { p: spec.to, kind: 'point' },
      { p: scale(add(spec.from, spec.to), 0.5), kind: 'centre' },
    ]
  }
  const out: SnapTarget[] = [{ p: spec.center, kind: 'centre' }]
  if (spec.kind === 'punch' && spec.shape === 'triangle') {
    const plain: CarveSpec = { ...spec }
    delete plain.sides
    delete plain.corners
    for (const seg of carveOutline(plain).segs) out.push({ p: seg.p, kind: 'point' })
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
    out.push({ p: at(x, y), kind: 'point' })
  }
  return out
}

/** Anchors of a free shape, on every contour, and the middle of its bounds. */
export function freeKeyPoints(shape: EditableShape): SnapTarget[] {
  const anchors = shapeAnchors(shape)
  if (!anchors.length) return []
  const box = pointsBounds(anchors)
  return [...anchors.map((p) => ({ p, kind: 'point' as const })), { p: box.center, kind: 'centre' }]
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
      targets.push(...carveKeyPoints(layer.carve))
      continue
    }
    const path = freePathOf(layer)
    if (path) targets.push(...freeKeyPoints(path))
  }
  return targets
}

/** Sizes already in use, for "same size": slab corner radii, punch radii, groove widths. */
export function documentSizes(doc: IllustratorDocument, exclude: Set<string>) {
  const radii: number[] = []
  const punchRadii: number[] = []
  const widths: number[] = []
  for (const layer of doc.layers) {
    const spec = layer.carve
    if (!spec || !layer.visible || exclude.has(layer.id)) continue
    if (spec.kind === 'slab') radii.push(Math.min(spec.radius, spec.width / 2, spec.height / 2))
    else if (spec.kind === 'punch') punchRadii.push(spec.radius)
    else widths.push(spec.width)
  }
  return { radii, punchRadii, widths }
}
