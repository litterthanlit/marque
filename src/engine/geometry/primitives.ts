import {
  add,
  cross,
  cubicPoint,
  cubicTangent,
  distance,
  dot,
  emptyBounds,
  includeCubic,
  includePoint,
  length,
  normalize,
  projectOnCubic,
  rotate,
  scale,
  splitCubic,
  sub,
  type Bounds,
  type Cubic,
  type Vec,
} from '../path/bezier.ts'
import { carveOutline, KAPPA, polygonParts } from '../carve/outline.ts'
import type { CarveSpec, PolygonSpec } from '../carve/spec.ts'
import type { Contour, Guide } from '../vector/types.ts'
import { asCircle, type CircleSource } from './asCircle.ts'

/**
 * Outlines as analytic pieces, for snapping: straight segments, infinite
 * lines, circles and circular arcs where the geometry is exact, and cubics
 * everywhere else. Every piece names the object or guide it came from.
 * Everything here is pure and works in layer space.
 */

interface Owned {
  /** The object or guide the piece belongs to. */
  owner: string
  /** Set on the pieces of a guide. */
  guide?: true
}

export type Primitive = Owned &
  (
    | { kind: 'segment'; a: Vec; b: Vec }
    /** An infinite line through `p` along the unit vector `d`. */
    | { kind: 'line'; p: Vec; d: Vec }
    | { kind: 'circle'; c: Vec; r: number }
    /** The arc from angle `start` to `end` (radians, `end` > `start`), turning as angles grow: clockwise on screen. */
    | { kind: 'arc'; c: Vec; r: number; start: number; end: number }
    | { kind: 'cubic'; curve: Cubic }
  )

/** What `outlinePrimitives` reads: an object's id, its recipe if it has one, and its contours. */
export type PrimitiveSource = CircleSource & { id: string }

const TAU = Math.PI * 2
const ZERO: Vec = { x: 0, y: 0 }

/* ─── Reading outlines ─── */

const objectCache = new WeakMap<object, readonly Primitive[]>()

/**
 * The pieces of an object's outline. An object `asCircle` accepts is one
 * circle. Otherwise each curve is a segment when it is straight, an arc when
 * it is a quarter circle as the editor draws one (a slab's corner at full
 * fullness beside unbent sides, a channel's caps), and a cubic else: a bent
 * side, a free path. Kept per object, which is immutable.
 */
export function outlinePrimitives(object: PrimitiveSource): readonly Primitive[] {
  const cached = objectCache.get(object)
  if (cached) return cached
  const primitives = object.carve ? recipePrimitives(object.carve, object.id) : contoursPrimitives(object.contours, object.id)
  objectCache.set(object, primitives)
  return primitives
}

/**
 * The pieces of a recipe's outline. A polygon is read from its own numbers:
 * its sides are segments and its rounded corners arcs of their circles, so a
 * corner that turns less than a quarter is exact too.
 */
export function recipePrimitives(spec: CarveSpec, owner: string): Primitive[] {
  switch (spec.kind) {
    case 'polygon':
      return polygonPrimitives(spec, owner)
    case 'slab':
    case 'punch':
    case 'channel':
    case 'slice': {
      const circle = asCircle({ carve: spec, contours: [] })
      if (circle) return [{ kind: 'circle', c: circle.c, r: circle.r, owner }]
      return curvesPrimitives(carveOutline(spec).curves, owner)
    }
    default:
      return spec satisfies never
  }
}

/** A polygon's corner arcs and sides, in order round it. */
function polygonPrimitives(spec: PolygonSpec, owner: string): Primitive[] {
  const parts = polygonParts(spec)
  if (!parts.corners.length) return parts.sides.map(([a, b]): Primitive => ({ kind: 'segment', a, b, owner }))
  const out: Primitive[] = []
  parts.corners.forEach((corner, k) => {
    out.push({ kind: 'arc', c: corner.c, r: parts.radius, start: corner.start, end: corner.start + corner.sweep, owner })
    const next = parts.corners[(k + 1) % parts.corners.length]
    if (distance(corner.b, next.a) > 1e-6) out.push({ kind: 'segment', a: corner.b, b: next.a, owner })
  })
  return out
}

/** The pieces of some contours: a single closed one that reads as a circle is that circle. */
export function contoursPrimitives(contours: readonly Contour[], owner: string, guide = false): Primitive[] {
  const circle = asCircle({ contours: contours as Contour[] })
  const tag = guide ? { owner, guide: true as const } : { owner }
  if (circle) return [{ kind: 'circle', c: circle.c, r: circle.r, ...tag }]
  return contours.flatMap((contour) => curvesPrimitives(contourCurves(contour), owner, guide))
}

const guideCache = new WeakMap<Guide, readonly Primitive[]>()

/** The pieces of a guide: its infinite line, its circle, or its path's. */
export function guidePrimitives(guide: Guide): readonly Primitive[] {
  const cached = guideCache.get(guide)
  if (cached) return cached
  const owner = guide.id
  const { shape } = guide
  let primitives: Primitive[]
  switch (shape.kind) {
    case 'line':
      primitives = [{ kind: 'line', p: shape.p, d: rotate({ x: 1, y: 0 }, shape.angle), owner, guide: true }]
      break
    case 'circle':
      primitives = shape.r > 0 ? [{ kind: 'circle', c: shape.c, r: shape.r, owner, guide: true }] : []
      break
    case 'path':
      primitives = contoursPrimitives([shape.contour], owner, true)
      break
    default:
      primitives = shape satisfies never
  }
  guideCache.set(guide, primitives)
  return primitives
}

/** The curves of a contour, a closed one wrapping round to its first point. */
export function contourCurves(contour: Contour): Cubic[] {
  const { segments } = contour
  const count = contour.closed ? segments.length : segments.length - 1
  const curves: Cubic[] = []
  for (let i = 0; i < count; i++) {
    const a = segments[i]
    const b = segments[(i + 1) % segments.length]
    curves.push([a.point, add(a.point, a.handleOut ?? ZERO), add(b.point, b.handleIn ?? ZERO), b.point])
  }
  return curves
}

/** Each curve as a segment, an arc or a cubic; arcs of one circle that follow each other join. */
function curvesPrimitives(curves: readonly Cubic[], owner: string, guide = false): Primitive[] {
  const tag = guide ? { owner, guide: true as const } : { owner }
  const out: Primitive[] = []
  for (const curve of curves) {
    if (distance(curve[0], curve[3]) < 1e-9 && distance(curve[0], curve[1]) < 1e-9 && distance(curve[0], curve[2]) < 1e-9) continue
    if (isStraight(curve)) {
      out.push({ kind: 'segment', a: curve[0], b: curve[3], ...tag })
      continue
    }
    const arc = quarterArc(curve)
    if (!arc) {
      out.push({ kind: 'cubic', curve, ...tag })
      continue
    }
    const last = out.at(-1)
    if (last?.kind === 'arc' && sameCircle(last, arc) && Math.abs(angleGap(last.end, arc.start)) < 1e-6 && last.end - last.start + (arc.end - arc.start) < TAU - 1e-6) {
      out[out.length - 1] = { ...last, end: last.end + (arc.end - arc.start) }
      continue
    }
    out.push({ kind: 'arc', ...arc, ...tag })
  }
  return out
}

/** Does a cubic trace its chord: its handles on the chord and between its ends? */
function isStraight(curve: Cubic): boolean {
  const chord = sub(curve[3], curve[0])
  const len = length(chord)
  if (len < 1e-9) return false
  for (const handle of [curve[1], curve[2]]) {
    const v = sub(handle, curve[0])
    if (Math.abs(cross(chord, v)) / len > 1e-6) return false
    const along = dot(chord, v) / (len * len)
    if (along < -1e-9 || along > 1 + 1e-9) return false
  }
  return true
}

/**
 * A cubic that is a quarter circle as the editor draws one: handles of
 * equal length κ·r, at right angles to each other and to the radii at its
 * ends. Returns the arc, or null.
 */
function quarterArc(curve: Cubic): { c: Vec; r: number; start: number; end: number } | null {
  const out = sub(curve[1], curve[0])
  const back = sub(curve[3], curve[2])
  const l0 = length(out)
  const l3 = length(back)
  if (l0 < 1e-9 || l3 < 1e-9 || Math.abs(l0 - l3) > 1e-6 * Math.max(1, l0)) return null
  const t0 = scale(out, 1 / l0)
  const t3 = scale(back, 1 / l3)
  if (Math.abs(dot(t0, t3)) > 1e-6) return null
  const r = l0 / KAPPA
  // The centre lies to the side the curve turns towards.
  const turn = Math.sign(cross(t0, t3))
  const c = add(curve[0], scale(rotate(t0, 90 * turn), r))
  if (Math.abs(distance(c, curve[3]) - r) > 1e-6 * Math.max(1, r)) return null
  const a0 = Math.atan2(curve[0].y - c.y, curve[0].x - c.x)
  return turn > 0 ? { c, r, start: a0, end: a0 + Math.PI / 2 } : { c, r, start: a0 - Math.PI / 2, end: a0 }
}

function sameCircle(a: { c: Vec; r: number }, b: { c: Vec; r: number }): boolean {
  return distance(a.c, b.c) < 1e-6 * Math.max(1, a.r) && Math.abs(a.r - b.r) < 1e-6 * Math.max(1, a.r)
}

/** `b − a` folded into (−π, π]. */
function angleGap(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d <= -Math.PI) d += TAU
  if (d > Math.PI) d -= TAU
  return d
}

/** Does an arc reach the direction `angle` (radians)? */
export function arcHas(arc: { start: number; end: number }, angle: number, slack = 1e-9): boolean {
  const span = arc.end - arc.start
  const from = (((angle - arc.start) % TAU) + TAU) % TAU
  return from <= span + slack || from >= TAU - slack
}

/** An arc's two ends. */
export function arcEnds(arc: { c: Vec; r: number; start: number; end: number }): [Vec, Vec] {
  const at = (angle: number) => add(arc.c, { x: Math.cos(angle) * arc.r, y: Math.sin(angle) * arc.r })
  return [at(arc.start), at(arc.end)]
}

/* ─── Measuring ─── */

const boundsCache = new WeakMap<Primitive, Bounds>()

/** A piece's bounds; a line's reach everywhere. */
export function primitiveBounds(primitive: Primitive): Bounds {
  const cached = boundsCache.get(primitive)
  if (cached) return cached
  const b = emptyBounds()
  switch (primitive.kind) {
    case 'segment':
      includePoint(b, primitive.a)
      includePoint(b, primitive.b)
      break
    case 'line':
      b.minX = -Infinity
      b.minY = -Infinity
      b.maxX = Infinity
      b.maxY = Infinity
      break
    case 'circle':
    case 'arc':
      // The whole circle: an arc is never far inside it.
      includePoint(b, sub(primitive.c, { x: primitive.r, y: primitive.r }))
      includePoint(b, add(primitive.c, { x: primitive.r, y: primitive.r }))
      break
    case 'cubic':
      includeCubic(b, primitive.curve)
      break
    default:
      return primitive satisfies never
  }
  boundsCache.set(primitive, b)
  return b
}

/** Could a piece come within `reach` of `p`? A cheap test on its bounds. */
export function primitiveNear(primitive: Primitive, p: Vec, reach: number): boolean {
  const b = primitiveBounds(primitive)
  return p.x >= b.minX - reach && p.x <= b.maxX + reach && p.y >= b.minY - reach && p.y <= b.maxY + reach
}

/** The point of a piece nearest `p`, how far it is, and the piece's unit tangent there. */
export function nearestOnPrimitive(primitive: Primitive, p: Vec): { point: Vec; distance: number; tangent: Vec } {
  switch (primitive.kind) {
    case 'segment': {
      const ab = sub(primitive.b, primitive.a)
      const len2 = dot(ab, ab)
      const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, primitive.a), ab) / len2)) : 0
      const point = add(primitive.a, scale(ab, t))
      return { point, distance: distance(point, p), tangent: normalize(ab) }
    }
    case 'line': {
      const point = add(primitive.p, scale(primitive.d, dot(sub(p, primitive.p), primitive.d)))
      return { point, distance: distance(point, p), tangent: primitive.d }
    }
    case 'circle':
    case 'arc': {
      const away = sub(p, primitive.c)
      const angle = length(away) > 1e-12 ? Math.atan2(away.y, away.x) : primitive.kind === 'arc' ? primitive.start : 0
      if (primitive.kind === 'arc' && !arcHas(primitive, angle)) {
        const [a, b] = arcEnds(primitive)
        const nearer = distance(a, p) <= distance(b, p) ? { at: a, angle: primitive.start } : { at: b, angle: primitive.end }
        return { point: nearer.at, distance: distance(nearer.at, p), tangent: { x: -Math.sin(nearer.angle), y: Math.cos(nearer.angle) } }
      }
      const point = add(primitive.c, { x: Math.cos(angle) * primitive.r, y: Math.sin(angle) * primitive.r })
      return { point, distance: distance(point, p), tangent: { x: -Math.sin(angle), y: Math.cos(angle) } }
    }
    case 'cubic': {
      const hit = projectOnCubic(primitive.curve, p)
      return { point: hit.point, distance: hit.distance, tangent: cubicTangent(primitive.curve, hit.t) }
    }
    default:
      return primitive satisfies never
  }
}

/* ─── Crossings ─── */

/**
 * Where two pieces cross. Pieces that run along each other give none. Two
 * curves are halved at most `budget.left` times, which they use up: a caller
 * asking about many pairs can share one budget among them.
 */
export function intersectPrimitives(a: Primitive, b: Primitive, budget: { left: number } = { left: CUBIC_SPLITS }): Vec[] {
  if (a.kind === 'cubic' && b.kind === 'cubic') return sameCurve(a.curve, b.curve) ? [] : dedupe(cubicCrossings(a.curve, b.curve, 0, budget))
  if (a.kind === 'cubic') return dedupe(cubicAgainst(a.curve, b as Exclude<Primitive, { kind: 'cubic' }>))
  if (b.kind === 'cubic') return dedupe(cubicAgainst(b.curve, a))
  if (isRound(a) && isRound(b)) return circleCircle(a, b)
  if (isRound(a)) return straightCircle(b as Straight, a)
  if (isRound(b)) return straightCircle(a as Straight, b)
  return straightStraight(a as Straight, b as Straight)
}

type Straight = Extract<Primitive, { kind: 'segment' | 'line' }>
type Round = Extract<Primitive, { kind: 'circle' | 'arc' }>

function isRound(p: Primitive): p is Round {
  return p.kind === 'circle' || p.kind === 'arc'
}

/** A straight piece as a point, a unit direction and the range of the parameter along it. */
function straightFrame(s: Straight): { p: Vec; d: Vec; lo: number; hi: number } {
  if (s.kind === 'line') return { p: s.p, d: s.d, lo: -Infinity, hi: Infinity }
  const len = distance(s.a, s.b)
  return { p: s.a, d: normalize(sub(s.b, s.a)), lo: 0, hi: len }
}

const SLACK = 1e-7

function straightStraight(a: Straight, b: Straight): Vec[] {
  const fa = straightFrame(a)
  const fb = straightFrame(b)
  const denom = cross(fa.d, fb.d)
  if (Math.abs(denom) < 1e-12) return []
  const w = sub(fb.p, fa.p)
  const ta = cross(w, fb.d) / denom
  const tb = cross(w, fa.d) / denom
  if (ta < fa.lo - SLACK || ta > fa.hi + SLACK || tb < fb.lo - SLACK || tb > fb.hi + SLACK) return []
  return [add(fa.p, scale(fa.d, ta))]
}

function straightCircle(s: Straight, c: Round): Vec[] {
  const f = straightFrame(s)
  const w = sub(f.p, c.c)
  const b = dot(w, f.d)
  const disc = b * b - (dot(w, w) - c.r * c.r)
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  const ts = root < 1e-12 ? [-b] : [-b - root, -b + root]
  return ts
    .filter((t) => t >= f.lo - SLACK && t <= f.hi + SLACK)
    .map((t) => add(f.p, scale(f.d, t)))
    .filter((p) => onRound(c, p))
}

function circleCircle(a: Round, b: Round): Vec[] {
  const d = distance(a.c, b.c)
  if (d < 1e-12 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return []
  const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d)
  const h = Math.sqrt(Math.max(0, a.r * a.r - along * along))
  const u = scale(sub(b.c, a.c), 1 / d)
  const base = add(a.c, scale(u, along))
  const n = { x: -u.y, y: u.x }
  const points = h < 1e-9 ? [base] : [add(base, scale(n, h)), sub(base, scale(n, h))]
  return points.filter((p) => onRound(a, p) && onRound(b, p))
}

function onRound(c: Round, p: Vec): boolean {
  return c.kind === 'circle' || arcHas(c, Math.atan2(p.y - c.c.y, p.x - c.c.x), 1e-7)
}

const CUBIC_STEPS = 64

/** Where a cubic crosses a piece with a signed distance: sign changes along the cubic, settled by halving. */
function cubicAgainst(curve: Cubic, other: Exclude<Primitive, { kind: 'cubic' }>): Vec[] {
  let f: (p: Vec) => number
  let within: (p: Vec) => boolean
  if (other.kind === 'segment' || other.kind === 'line') {
    const frame = straightFrame(other)
    f = (p) => cross(frame.d, sub(p, frame.p))
    within = (p) => {
      const t = dot(sub(p, frame.p), frame.d)
      return t >= frame.lo - 1e-6 && t <= frame.hi + 1e-6
    }
  } else {
    f = (p) => distance(p, other.c) - other.r
    within = (p) => onRound(other, p)
  }
  const out: Vec[] = []
  let t0 = 0
  let v0 = f(curve[0])
  for (let i = 1; i <= CUBIC_STEPS; i++) {
    const t1 = i / CUBIC_STEPS
    const v1 = f(cubicPoint(curve, t1))
    if (v0 === 0) out.push(cubicPoint(curve, t0))
    else if (v0 * v1 < 0) {
      let lo = t0
      let hi = t1
      let flo = v0
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2
        const fm = f(cubicPoint(curve, mid))
        if (flo * fm <= 0) hi = mid
        else {
          lo = mid
          flo = fm
        }
      }
      out.push(cubicPoint(curve, (lo + hi) / 2))
    }
    t0 = t1
    v0 = v1
  }
  if (v0 === 0) out.push(curve[3])
  return out.filter(within)
}

/** How many pairs of halves two cubics may be split into while their crossings are looked for. */
const CUBIC_SPLITS = 400

/** Do two cubics trace the same curve, either way round? */
function sameCurve(a: Cubic, b: Cubic): boolean {
  const same = (p: Vec, q: Vec) => distance(p, q) <= 1e-6
  return a.every((p, i) => same(p, b[i])) || a.every((p, i) => same(p, b[3 - i]))
}

/**
 * Where two cubics cross, by halving both wherever their bounds overlap.
 * Curves that run along each other would halve without end: `budget` stops
 * them, and halves that trace the same curve give no crossing.
 */
function cubicCrossings(a: Cubic, b: Cubic, depth: number, budget: { left: number }): Vec[] {
  if (--budget.left < 0) return []
  const ba = emptyBounds()
  const bb = emptyBounds()
  includeCubic(ba, a)
  includeCubic(bb, b)
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return []
  const size = Math.max(ba.maxX - ba.minX, ba.maxY - ba.minY, bb.maxX - bb.minX, bb.maxY - bb.minY)
  if (size < 1e-6 || depth >= 40) return [cubicPoint(a, 0.5)]
  if (depth > 0 && sameCurve(a, b)) return []
  const [a1, a2] = splitCubic(a, 0.5)
  const [b1, b2] = splitCubic(b, 0.5)
  return [
    ...cubicCrossings(a1, b1, depth + 1, budget),
    ...cubicCrossings(a1, b2, depth + 1, budget),
    ...cubicCrossings(a2, b1, depth + 1, budget),
    ...cubicCrossings(a2, b2, depth + 1, budget),
  ]
}

function dedupe(points: Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of points) if (!out.some((q) => distance(p, q) < 1e-3)) out.push(p)
  return out
}
