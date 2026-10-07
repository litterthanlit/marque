import { arcEnds, arcHas, intersectPrimitives, nearestOnPrimitive, type Primitive } from '../geometry/primitives.ts'
import { onPieceTolerance } from './corners.ts'
import { add, cubicPoint, distance, dot, projectOnCubic, scale, sub, type Vec } from '../path/bezier.ts'

/**
 * A fillet's place is anchored to its first object's outline, not to free
 * space: an edit carries it to the same place on that outline, so it moves
 * with its object, lost or not. Where the fillet sits on the corner of two
 * objects, the place goes to where their outlines now cross, which is where
 * their corner went. Pure, in layer space.
 */

/** A place on an outline: which of its pieces, and where along it. */
export interface OutlinePlace {
  index: number
  /** Along a segment or a curve, its parameter from 0 to 1; round a circle, the angle; along an arc, the share of its sweep; along a line, the distance from its point. */
  param: number
}

const TAU = Math.PI * 2

/** The place on an outline nearest `p`; null for an outline with no pieces. The first of two pieces as near wins. */
export function placeOn(primitives: readonly Primitive[], p: Vec): OutlinePlace | null {
  let best: { index: number; distance: number } | null = null
  primitives.forEach((primitive, index) => {
    const d = nearestOnPrimitive(primitive, p).distance
    if (!best || d < best.distance - 1e-9) best = { index, distance: d }
  })
  if (!best) return null
  const index = (best as { index: number }).index
  return { index, param: paramOf(primitives[index], p) }
}

/** Where along a piece the point nearest `p` lies. */
function paramOf(primitive: Primitive, p: Vec): number {
  switch (primitive.kind) {
    case 'segment': {
      const ab = sub(primitive.b, primitive.a)
      const len2 = dot(ab, ab)
      return len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, primitive.a), ab) / len2)) : 0
    }
    case 'line':
      return dot(sub(p, primitive.p), primitive.d)
    case 'circle':
      return Math.atan2(p.y - primitive.c.y, p.x - primitive.c.x)
    case 'arc': {
      const angle = Math.atan2(p.y - primitive.c.y, p.x - primitive.c.x)
      const span = primitive.end - primitive.start
      if (span <= 0) return 0
      if (!arcHas(primitive, angle)) {
        // Off the arc: the nearer end.
        const before = ((((primitive.start - angle) % TAU) + TAU) % TAU)
        const after = ((((angle - primitive.end) % TAU) + TAU) % TAU)
        return before <= after ? 0 : 1
      }
      return ((((angle - primitive.start) % TAU) + TAU) % TAU) / span
    }
    case 'cubic':
      return projectOnCubic(primitive.curve, p).t
    default:
      return primitive satisfies never
  }
}

/** The point at a place along a piece. */
export function pointOn(primitive: Primitive, param: number): Vec {
  switch (primitive.kind) {
    case 'segment':
      return add(primitive.a, scale(sub(primitive.b, primitive.a), param))
    case 'line':
      return add(primitive.p, scale(primitive.d, param))
    case 'circle':
      return add(primitive.c, { x: Math.cos(param) * primitive.r, y: Math.sin(param) * primitive.r })
    case 'arc': {
      const angle = primitive.start + param * (primitive.end - primitive.start)
      return add(primitive.c, { x: Math.cos(angle) * primitive.r, y: Math.sin(angle) * primitive.r })
    }
    case 'cubic':
      return cubicPoint(primitive.curve, param)
    default:
      return primitive satisfies never
  }
}

/** Do two outlines have the same pieces, of the same kinds, in the same order? */
export function sameStructure(a: readonly Primitive[], b: readonly Primitive[]): boolean {
  return a.length === b.length && a.every((primitive, i) => primitive.kind === b[i].kind)
}

/** The piece of an outline nearest `p`, and its index; null for an outline with no pieces. */
function nearestPiece(primitives: readonly Primitive[], p: Vec): { index: number; point: Vec } | null {
  let best: { index: number; point: Vec; distance: number } | null = null
  primitives.forEach((primitive, index) => {
    const near = nearestOnPrimitive(primitive, p)
    if (!best || near.distance < best.distance - 1e-9) best = { index, point: near.point, distance: near.distance }
  })
  return best
}

/** Two objects' outlines, as an edit found and left them. */
export interface OutlinesOf {
  was: readonly Primitive[]
  now: readonly Primitive[]
}

/** How far a stored place, kept to a hundredth, may be from an outline and lie on it. */
const ON_PLACE = 0.01

/** Where an edit carries a place on an outline, and the piece it is on after the edit. */
interface Carried {
  piece: Primitive
  /** Its index on the outline after the edit. */
  index: number
  point: Vec
  /** Did the place lie on the outline before the edit? */
  on: boolean
}

/** The same place on an outline after an edit, where its pieces are the same, or else the point of the new outline nearest where it was. */
function carryOn(outlines: OutlinesOf, at: Vec): Carried | null {
  const place = placeOn(outlines.was, at)
  const on = !!place && nearestOnPrimitive(outlines.was[place.index], at).distance <= ON_PLACE + onPieceTolerance(outlines.was[place.index])
  if (place && sameStructure(outlines.was, outlines.now)) {
    const piece = outlines.now[place.index]
    return { piece, index: place.index, point: pointOn(piece, place.param), on }
  }
  const near = nearestPiece(outlines.now, at)
  return near ? { piece: outlines.now[near.index], index: near.index, point: near.point, on } : null
}

/** A piece's two ends; none for a circle or a line. */
function pieceEnds(primitive: Primitive): Vec[] {
  switch (primitive.kind) {
    case 'segment':
      return [primitive.a, primitive.b]
    case 'arc':
      return arcEnds(primitive)
    case 'cubic':
      return [primitive.curve[0], primitive.curve[3]]
    case 'line':
    case 'circle':
      return []
    default:
      return primitive satisfies never
  }
}

/** The piece at `index` of an outline and the pieces that meet it end to end. */
function pieceAndNeighbours(primitives: readonly Primitive[], index: number): Primitive[] {
  const ends = pieceEnds(primitives[index])
  return primitives.filter((primitive, i) => i === index || pieceEnds(primitive).some((end) => ends.some((own) => distance(end, own) <= ON_PLACE)))
}

/**
 * Where an edit carries a fillet's place: the same place on its first
 * object's outline after the edit, where its pieces are the same, or else
 * the point of the new outline nearest where it was. Where the fillet sits
 * between two objects and its place lay on both outlines, it is their
 * corner, and goes to where they now cross. An object the edit changed
 * keeps the corner on the piece it was on. On an object the edit left
 * alone the corner stays on its piece or passes onto one that meets it end
 * to end, so a bar slid along a rounded slab takes its join from the
 * straight side onto the round, but never across to the far side. Of those
 * crossings, the nearest to the old place when one object changed (an
 * object moved along its own side carries the place away from its corner,
 * which stays put on the other), or to where the first carried it when
 * both did. With no such crossing the corner is gone, and the place goes
 * with its first object alone, as a lost fillet's does: it is never handed
 * to another corner. The very same place when neither outline changed.
 */
export function carryPlace(at: Vec, first: OutlinesOf, second: OutlinesOf | null): Vec {
  const firstChanged = first.was !== first.now
  const secondChanged = !!second && second.was !== second.now
  if (!firstChanged && !secondChanged) return at
  const one = carryOn(first, at)
  if (!one) return at
  if (!second) return one.point
  const two = carryOn(second, at)
  if (!two || !one.on || !two.on) return one.point
  const reference = firstChanged && secondChanged ? one.point : at
  const pieces = (changed: boolean, carried: Carried, outlines: OutlinesOf) => (changed ? [carried.piece] : pieceAndNeighbours(outlines.now, carried.index))
  let best: Vec | null = null
  for (const a of pieces(firstChanged, one, first)) {
    for (const b of pieces(secondChanged, two, second)) {
      for (const q of intersectPrimitives(a, b)) if (!best || distance(q, reference) < distance(best, reference)) best = q
    }
  }
  return best ?? one.point
}
