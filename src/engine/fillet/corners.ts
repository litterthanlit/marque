import type { MarkData } from '../illustrator/types.ts'
import { add, cross, cubicPoint, distance, dot, emptyBounds, length, normalize, scale, sub, type Bounds, type Cubic, type Vec } from '../path/bezier.ts'
import { contourCurves, nearestOnPrimitive, primitiveBounds, primitiveNear, type Primitive } from '../geometry/primitives.ts'
import { pathDataToContours } from '../vector/pathSerialization.ts'

/**
 * The corners of the composed ink, for fillets: every anchor where the
 * outline turns by more than 3°, with which side of it the ink is on, and
 * the objects whose outlines carry its two curves. A smooth join, such as a
 * belt meeting its circle, is not a corner. Everything here is pure and
 * works in layer space.
 */

/** A turn sharper than this is a corner; a gentler one is a smooth join. */
export const CORNER_TURN = (3 * Math.PI) / 180

/** A turn this near a full reverse is a cusp, where no circle fits between the curves. */
const CUSP_TURN = (178 * Math.PI) / 180

/** How far from an outline a point may be and still lie on it: storage and booleans round to about a hundredth. */
const ON_OUTLINE = 0.05

/** How far along each curve from a corner the point is read that says whose curve it is. */
const SAMPLE_REACH = 4

export interface InkCorner {
  p: Vec
  /** How far the outline turns there, in radians: positive at a convex corner, negative at a concave one. */
  turn: number
  convex: boolean
  /** The angle between the two curves on the side a fillet sits, in (0, π). */
  angle: number
  /** The unit vector halving that angle: into the ink at a convex corner, out of it at a concave one. */
  bisector: Vec
  /** The two curves meeting there, each a run of ink curves leaving the corner as far as the next one. */
  sides: [Cubic[], Cubic[]]
}

export interface InkGeometry {
  corners: InkCorner[]
  /** Each contour of the ink flattened to a closed ring of points, for which side is ink and for its bounds. */
  rings: Vec[][]
  /** Each contour's curves, as `rings` flattens them. */
  contours: Cubic[][]
  /** For each contour, the one it lies directly inside, or −1: a hole's is the contour it is a hole in. */
  parents: number[]
  /** True when the ink's contours wind so that either fill rule reads them alike. */
  oriented: boolean
  /** The larger of the ink's width and height. */
  size: number
}

/** An object the ink is made from, as corners are read against it: its id, its kind and its outline's pieces. */
export interface CornerSource {
  id: string
  /** What sort of shape it is, as Round all matches corners: 'circle', 'slab', 'polygon', 'cut polygon'… */
  kind: string
  primitives: readonly Primitive[]
}

/** A corner of the ink with the objects whose outlines carry its two curves. */
export interface AttributedCorner extends InkCorner {
  between: [string, string]
  kinds: [string, string]
  /** The pieces of those outlines that each side runs along. */
  carriers: [Primitive, Primitive]
}

/* ─── Reading the ink ─── */

const geometryCache = new WeakMap<MarkData, InkGeometry>()

/** The corners and rings of a composed mark, kept per mark. */
export function markGeometry(mark: MarkData): InkGeometry {
  let geometry = geometryCache.get(mark)
  if (!geometry) {
    geometry = inkGeometry(mark.compoundPathData)
    geometryCache.set(mark, geometry)
  }
  return geometry
}

/** The corners and rings of some ink, read from its path data. */
export function inkGeometry(pathData: string): InkGeometry {
  if (!pathData) return { corners: [], rings: [], contours: [], parents: [], oriented: true, size: 0 }
  const contours = pathDataToContours(pathData)
    .filter((contour) => contour.closed)
    .map((contour) => contourCurves(contour).filter((curve) => !isPoint(curve)))
    .filter((curves) => curves.length > 0)
  const rings = contours.map(flattenRing)
  const areas = rings.map(signedArea)
  const around = rings.map((ring, i) => rings.flatMap((other, j) => (j !== i && insideRing(other, ring[0]) ? [j] : [])))
  // A contour inside an even number of others holds ink inside it; inside an odd number, it is a hole.
  const inkInside = around.map((outside) => outside.length % 2 === 0)
  // The contour a contour lies directly inside is the deepest of those around it.
  const parents = around.map((outside) => outside.reduce((parent, j) => (parent < 0 || around[j].length > around[parent].length ? j : parent), -1))
  // A contour of positive area has its inside on its left, as cross products read left (y down, that is the right on screen).
  // The ink is on that side when it is inside the contour.
  const inkLeft = areas.map((area, i) => area > 0 === inkInside[i])
  const corners: InkCorner[] = []
  contours.forEach((curves, i) => corners.push(...contourCorners(curves, inkLeft[i])))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const size = rings.length ? Math.max(maxX - minX, maxY - minY) : 0
  return { corners, rings, contours, parents, oriented: inkLeft.every((left) => left === inkLeft[0]), size }
}

/**
 * How much ink some path data covers, read as nested contours (one inside
 * an odd number of others is a hole), and how many contours it has: a quick
 * check of what a boolean made, near enough to tell a hole filled.
 */
export function inkMeasure(pathData: string): { area: number; contours: number } {
  if (!pathData) return { area: 0, contours: 0 }
  const contours = pathDataToContours(pathData)
    .filter((contour) => contour.closed)
    .map((contour) => contourCurves(contour).filter((curve) => !isPoint(curve)))
    .filter((curves) => curves.length > 0)
  const rings = contours.map(flattenRing)
  let area = 0
  contours.forEach((curves, i) => {
    const depth = rings.filter((other, j) => j !== i && insideRing(other, rings[i][0])).length
    area += (depth % 2 === 0 ? 1 : -1) * Math.abs(curves.reduce((sum, curve) => sum + cubicArea(curve), 0))
  })
  return { area, contours: contours.length }
}

/** Gauss–Legendre nodes and weights on [0, 1], three of them: exact for the fifth-degree sum a cubic's area is. */
const GAUSS = [
  { t: 0.5 - Math.sqrt(0.15), w: 5 / 18 },
  { t: 0.5, w: 8 / 18 },
  { t: 0.5 + Math.sqrt(0.15), w: 5 / 18 },
]

/** What a curve adds to the signed area of the contour it is part of, exactly. */
export function cubicArea([p0, p1, p2, p3]: Cubic): number {
  let sum = 0
  for (const { t, w } of GAUSS) {
    const s = 1 - t
    const p = cubicPoint([p0, p1, p2, p3], t)
    // The curve's way at t: three times the quadratic of its control points' differences.
    const d = {
      x: 3 * (s * s * (p1.x - p0.x) + 2 * s * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
      y: 3 * (s * s * (p1.y - p0.y) + 2 * s * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
    }
    sum += w * cross(p, d)
  }
  return sum / 2
}

/** A curve too short to have a way of its own: path data written to five places leaves such a stub where a contour closes. */
function isPoint(curve: Cubic): boolean {
  return curve.every((p) => distance(p, curve[0]) < 1e-3)
}

/** The way a curve leaves its start, as a unit vector. */
export function startTangent(curve: Cubic): Vec {
  for (const q of [curve[1], curve[2], curve[3]]) {
    const d = sub(q, curve[0])
    if (length(d) > 1e-9) return normalize(d)
  }
  return { x: 1, y: 0 }
}

/** The way a curve arrives at its end, as a unit vector. */
export function endTangent(curve: Cubic): Vec {
  for (const q of [curve[2], curve[1], curve[0]]) {
    const d = sub(curve[3], q)
    if (length(d) > 1e-9) return normalize(d)
  }
  return { x: 1, y: 0 }
}

export function reverseCubic(curve: Cubic): Cubic {
  return [curve[3], curve[2], curve[1], curve[0]]
}

/** The corners of one closed contour of curves, the ink lying on the left of its way when `inkLeft`. */
function contourCorners(curves: Cubic[], inkLeft: boolean): InkCorner[] {
  const n = curves.length
  const turns = curves.map((curve, k) => {
    const tin = endTangent(curves[(k - 1 + n) % n])
    const tout = startTangent(curve)
    return { tin, tout, turn: Math.atan2(cross(tin, tout), dot(tin, tout)) }
  })
  const sharp = turns.map(({ turn }) => Math.abs(turn) > CORNER_TURN)
  mergeJoints(curves, turns, sharp)
  const out: InkCorner[] = []
  turns.forEach(({ tin, tout, turn }, k) => {
    if (!sharp[k] || Math.abs(turn) >= CUSP_TURN) return
    // Turning towards the ink's side is turning round a convex corner.
    const signed = inkLeft ? turn : -turn
    const back: Cubic[] = []
    for (let j = 1; j <= n; j++) {
      const index = (k - j + n) % n
      back.push(reverseCubic(curves[index]))
      if (sharp[index]) break
    }
    const ahead: Cubic[] = []
    for (let j = 0; j < n; j++) {
      const index = (k + j) % n
      ahead.push(curves[index])
      if (sharp[(index + 1) % n]) break
    }
    out.push({
      p: curves[k][0],
      turn: signed,
      convex: signed > 0,
      angle: Math.PI - Math.abs(turn),
      bisector: normalize(sub(tout, tin)),
      sides: [back, ahead],
    })
  })
  return out
}

/**
 * A curve shorter than this is part of the joint it sits in, not a side of
 * its own: a boolean leaves such a jog where two outlines meet a hair
 * apart, as a band does where its stored circle is rounded and the circle
 * is not.
 */
export const JOINT_LENGTH = 0.1

/** How long a curve is at most: the length of its control polygon. */
function hullLength(curve: Cubic): number {
  return distance(curve[0], curve[1]) + distance(curve[1], curve[2]) + distance(curve[2], curve[3])
}

/**
 * Read each run of short curves as one joint, judged by how far the outline
 * turns across the whole of it, from the curve before it to the curve
 * after. Where that is no more than a smooth join, none of its anchors is
 * a corner; where it is more, the joint is one corner, at its anchor that
 * turns furthest, turning as the whole joint does.
 */
function mergeJoints(curves: readonly Cubic[], turns: Array<{ tin: Vec; tout: Vec; turn: number }>, sharp: boolean[]): void {
  const n = curves.length
  const short = curves.map((curve) => hullLength(curve) < JOINT_LENGTH)
  if (short.every(Boolean) || !short.some(Boolean)) return
  for (let k = 0; k < n; k++) {
    // Each run of short curves once, from its first.
    if (!short[k] || short[(k - 1 + n) % n]) continue
    let end = k
    while (short[(end + 1) % n]) end = (end + 1) % n
    const tin = endTangent(curves[(k - 1 + n) % n])
    const tout = startTangent(curves[(end + 1) % n])
    const turn = Math.atan2(cross(tin, tout), dot(tin, tout))
    // The anchors from where the joint starts to where it ends.
    let most = k
    for (let j = k; ; j = (j + 1) % n) {
      if (Math.abs(turns[j].turn) > Math.abs(turns[most].turn)) most = j
      sharp[j] = false
      if (j === (end + 1) % n) break
    }
    if (Math.abs(turn) <= CORNER_TURN) continue
    sharp[most] = true
    turns[most] = { tin, tout, turn }
  }
}

/** How many straight pieces a curve is read as for inside tests and bounds. */
function flatSteps(curve: Cubic): number {
  const chord = distance(curve[0], curve[1]) + distance(curve[1], curve[2]) + distance(curve[2], curve[3])
  if (chord < 1e-9) return 1
  const straight = Math.abs(cross(sub(curve[3], curve[0]), sub(curve[1], curve[0]))) < 1e-9 && Math.abs(cross(sub(curve[3], curve[0]), sub(curve[2], curve[0]))) < 1e-9
  return straight ? 1 : Math.max(4, Math.min(24, Math.ceil(chord / 6)))
}

function flattenRing(curves: Cubic[]): Vec[] {
  const ring: Vec[] = []
  for (const curve of curves) {
    const steps = flatSteps(curve)
    for (let i = 0; i < steps; i++) ring.push(i === 0 ? curve[0] : cubicPoint(curve, i / steps))
  }
  return ring
}

function signedArea(ring: Vec[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) area += cross(ring[i], ring[(i + 1) % ring.length])
  return area / 2
}

function insideRing(ring: Vec[], p: Vec): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/* ─── Whose curves ─── */

/** How far a point may be from a piece and lie on it: a circle drawn as cubics strays from its true circle by 0.03% of its radius. */
export function onPieceTolerance(primitive: Primitive): number {
  return ON_OUTLINE + (primitive.kind === 'circle' || primitive.kind === 'arc' ? 3e-4 * primitive.r : 0)
}

/** The point a run of curves reaches `reach` along it from its start, or its middle when it is shorter than twice that. */
export function pointAlong(run: readonly Cubic[], reach: number): Vec {
  const points: Vec[] = [run[0][0]]
  for (const curve of run) {
    const steps = 16
    for (let i = 1; i <= steps; i++) points.push(cubicPoint(curve, i / steps))
  }
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  const want = Math.min(reach, total / 2)
  let gone = 0
  for (let i = 1; i < points.length; i++) {
    const step = distance(points[i - 1], points[i])
    if (gone + step >= want && step > 0) return add(points[i - 1], scale(sub(points[i], points[i - 1]), (want - gone) / step))
    gone += step
  }
  return points.at(-1)!
}

/**
 * The object whose outline carries a point, and the piece of it: the
 * topmost of `sources` with a piece through the point. When none passes
 * that near, as where a boolean moved an edge a little, the nearest piece
 * within half a unit. Null when nothing is that near.
 */
export function ownerAt(sources: readonly CornerSource[], q: Vec): { source: CornerSource; primitive: Primitive } | null {
  let nearest: { source: CornerSource; primitive: Primitive; distance: number } | null = null
  for (const source of sources) {
    const b = sourceBounds(source.primitives)
    if (q.x < b.minX - 0.5 || q.x > b.maxX + 0.5 || q.y < b.minY - 0.5 || q.y > b.maxY + 0.5) continue
    for (const primitive of source.primitives) {
      if (!primitiveNear(primitive, q, 0.5 + onPieceTolerance(primitive))) continue
      const d = nearestOnPrimitive(primitive, q).distance
      if (d <= onPieceTolerance(primitive)) return { source, primitive }
      if (d <= 0.5 && (!nearest || d < nearest.distance)) nearest = { source, primitive, distance: d }
    }
  }
  return nearest
}

const sourceBoundsCache = new WeakMap<readonly Primitive[], Bounds>()

/** The bounds of an object's outline, each piece grown by how far off it a point may be and lie on it: a quick way past objects nowhere near. */
function sourceBounds(primitives: readonly Primitive[]): Bounds {
  let b = sourceBoundsCache.get(primitives)
  if (!b) {
    b = emptyBounds()
    for (const primitive of primitives) {
      const own = primitiveBounds(primitive)
      const slack = onPieceTolerance(primitive)
      b.minX = Math.min(b.minX, own.minX - slack)
      b.minY = Math.min(b.minY, own.minY - slack)
      b.maxX = Math.max(b.maxX, own.maxX + slack)
      b.maxY = Math.max(b.maxY, own.maxY + slack)
    }
    sourceBoundsCache.set(primitives, b)
  }
  return b
}

const attributedCache = new WeakMap<InkGeometry, WeakMap<readonly CornerSource[], AttributedCorner[]>>()

/**
 * The corners of the ink whose two curves each lie on an object's outline,
 * with those objects. Each curve is read a little way from the corner, where
 * the other's outline no longer passes. A corner of one object has its id
 * twice. Kept per ink and list of sources.
 */
export function attributedCorners(geometry: InkGeometry, sources: readonly CornerSource[]): AttributedCorner[] {
  let bySources = attributedCache.get(geometry)
  if (!bySources) attributedCache.set(geometry, (bySources = new WeakMap()))
  const cached = bySources.get(sources)
  if (cached) return cached
  const out = attributeCorners(geometry.corners, sources)
  bySources.set(sources, out)
  return out
}

/** Some corners of the ink read against the objects, as `attributedCorners` reads them all; not kept. */
export function attributeCorners(corners: readonly InkCorner[], sources: readonly CornerSource[]): AttributedCorner[] {
  const out: AttributedCorner[] = []
  for (const corner of corners) {
    const a = ownerAt(sources, pointAlong(corner.sides[0], SAMPLE_REACH))
    const b = ownerAt(sources, pointAlong(corner.sides[1], SAMPLE_REACH))
    if (!a || !b) continue
    out.push({ ...corner, between: [a.source.id, b.source.id], kinds: [a.source.kind, b.source.kind], carriers: [a.primitive, b.primitive] })
  }
  return out
}

/** What Round all matches a corner by: the kinds of its two objects, or the kind of its one object. */
export function cornerKind(corner: Pick<AttributedCorner, 'between' | 'kinds'>): string {
  if (corner.between[0] === corner.between[1]) return `${corner.kinds[0]} corner`
  return [...corner.kinds].sort().join(' · ')
}

/** Is a fillet between these objects, either way round? */
export function sameBetween(a: readonly [string, string], b: readonly [string, string]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
}
