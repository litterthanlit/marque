import { add, cross, distance, dot, length, normalize, projectOnCubic, rotate, scale, sub, type Vec } from '../path/bezier.ts'
import type { Circle } from './asCircle.ts'
import { arcHas, nearestOnPrimitive, primitiveBounds, type Primitive } from './primitives.ts'

/**
 * Tangency, for snapping: where a moved circle touches lines, edges and other
 * circles; how large a circle grows until it touches one; which lines through
 * a point, or at an angle, touch a circle; and the lines two circles share.
 * Everything here is pure and works in layer space.
 */

/** Where a snapped circle or line touches a piece, and whose piece it is. */
export interface Touch {
  p: Vec
  owner: string
  guide: boolean
}

type Round = Extract<Primitive, { kind: 'circle' | 'arc' }>

const touchOf = (primitive: Primitive, p: Vec): Touch => ({ p, owner: primitive.owner, guide: primitive.guide === true })

/** Is a point of a circle or arc's circle on the piece itself? */
function onRound(round: Round, p: Vec): boolean {
  return round.kind === 'circle' || arcHas(round, Math.atan2(p.y - round.c.y, p.x - round.c.x), 1e-7)
}

/**
 * Could a piece have a point between `r - reach` and `r + reach` from `c`?
 * Read from its bounds: the nearest of them no further than the outer
 * radius, the farthest no nearer than the inner one. A circle of radius
 * about `r` near `c` touches only such pieces: those inside it, and those
 * well outside, are passed over without the cost of a projection.
 */
function inBand(primitive: Primitive, c: Vec, r: number, reach: number): boolean {
  const b = primitiveBounds(primitive)
  const nx = Math.max(b.minX - c.x, 0, c.x - b.maxX)
  const ny = Math.max(b.minY - c.y, 0, c.y - b.maxY)
  if (nx * nx + ny * ny > (r + reach) * (r + reach)) return false
  const inner = r - reach
  if (inner <= 0) return true
  const fx = Math.max(Math.abs(c.x - b.minX), Math.abs(c.x - b.maxX))
  const fy = Math.max(Math.abs(c.y - b.minY), Math.abs(c.y - b.maxY))
  return fx * fx + fy * fy >= inner * inner
}

/* ─── A moved circle ─── */

/** A line along a unit vector, or a circle. */
type Track = { kind: 'line'; p: Vec; d: Vec } | { kind: 'circle'; c: Vec; r: number }

/**
 * Where the centre of a circle of a given radius may be so it touches one
 * piece: a line parallel to a straight piece, or a circle about a round one.
 * `touch` gives the point touched from a centre on the locus, or null where
 * the touch would fall off the piece.
 */
type Locus = Track & {
  primitive: Primitive
  touch(center: Vec): Vec | null
}

/** The loci of a piece near a circle: those within `reach` of its centre. */
function lociOf(primitive: Primitive, circle: Circle, reach: number): Locus[] {
  const { c, r } = circle
  switch (primitive.kind) {
    case 'segment':
    case 'line': {
      const a = primitive.kind === 'line' ? primitive.p : primitive.a
      const d = primitive.kind === 'line' ? primitive.d : normalize(sub(primitive.b, primitive.a))
      const len = primitive.kind === 'line' ? Infinity : distance(primitive.a, primitive.b)
      const n = { x: -d.y, y: d.x }
      const s = dot(sub(c, a), n)
      const out: Locus[] = []
      if (Math.abs(Math.abs(s) - r) <= reach) {
        const side = s >= 0 ? 1 : -1
        out.push({
          kind: 'line',
          p: add(a, scale(n, side * r)),
          d,
          primitive,
          touch: (center) => {
            const t = dot(sub(center, a), d)
            return primitive.kind === 'line' || (t >= -1e-6 && t <= len + 1e-6) ? add(a, scale(d, t)) : null
          },
        })
      }
      // Past the end of a segment, its end is what the circle touches.
      if (primitive.kind === 'segment') {
        for (const [end, beyond] of [
          [primitive.a, (t: number) => t < 0],
          [primitive.b, (t: number) => t > len],
        ] as const) {
          if (Math.abs(distance(c, end) - r) > reach) continue
          out.push({ kind: 'circle', c: end, r, primitive, touch: (center) => (beyond(dot(sub(center, a), d)) ? end : null) })
        }
      }
      return out
    }
    case 'circle':
    case 'arc': {
      const away = distance(c, primitive.c)
      const out: Locus[] = []
      // From outside, or inside: the moved circle in the other, or the other in it.
      for (const rho of [primitive.r + r, Math.abs(primitive.r - r)]) {
        if (rho < 1e-9 || Math.abs(away - rho) > reach) continue
        const outward = rho === primitive.r + r || r < primitive.r
        out.push({
          kind: 'circle',
          c: primitive.c,
          r: rho,
          primitive,
          touch: (center) => {
            const u = normalize(sub(center, primitive.c))
            const p = add(primitive.c, scale(u, outward ? primitive.r : -primitive.r))
            return onRound(primitive, p) ? p : null
          },
        })
      }
      return out
    }
    case 'cubic': {
      // The curve is never further than its ends: one that ends well inside the circle crosses it.
      if (Math.min(distance(c, primitive.curve[0]), distance(c, primitive.curve[3])) < r - reach) return []
      const hit = projectOnCubic(primitive.curve, c)
      if (Math.abs(hit.distance - r) > reach || hit.distance < 1e-9) return []
      // Settle onto the curve's offset by a few projections, then take the offset as straight there.
      let center = c
      let q = hit.point
      for (let i = 0; i < 4; i++) {
        center = add(q, scale(normalize(sub(center, q)), r))
        q = projectOnCubic(primitive.curve, center).point
      }
      const along = normalize(sub(center, q))
      return [
        {
          kind: 'line',
          p: center,
          d: { x: -along.y, y: along.x },
          primitive,
          touch: (at) => {
            const near = projectOnCubic(primitive.curve, at)
            return Math.abs(near.distance - r) <= 1e-3 * Math.max(1, r) ? near.point : null
          },
        },
      ]
    }
    default:
      return primitive satisfies never
  }
}

function projectOnLocus(locus: Track, p: Vec): Vec {
  if (locus.kind === 'line') return add(locus.p, scale(locus.d, dot(sub(p, locus.p), locus.d)))
  return add(locus.c, scale(normalize(sub(p, locus.c)), locus.r))
}

function locusCrossings(a: Track, b: Track): Vec[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const denom = cross(a.d, b.d)
    if (Math.abs(denom) < 1e-12) return []
    return [add(a.p, scale(a.d, cross(sub(b.p, a.p), b.d) / denom))]
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    const d = distance(a.c, b.c)
    if (d < 1e-12 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return []
    const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d)
    const h = Math.sqrt(Math.max(0, a.r * a.r - along * along))
    const u = scale(sub(b.c, a.c), 1 / d)
    const base = add(a.c, scale(u, along))
    const n = { x: -u.y, y: u.x }
    return [add(base, scale(n, h)), sub(base, scale(n, h))]
  }
  const line = (a.kind === 'line' ? a : b) as Extract<Track, { kind: 'line' }>
  const round = (a.kind === 'circle' ? a : b) as Extract<Track, { kind: 'circle' }>
  const w = sub(line.p, round.c)
  const half = dot(w, line.d)
  const disc = half * half - (dot(w, w) - round.r * round.r)
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return [add(line.p, scale(line.d, -half - root)), add(line.p, scale(line.d, -half + root))]
}

/**
 * Two touches closer than this, seen from the circle's centre, are one: 5°.
 * A join that turns less is smooth to the eye, and a curve's locus, taken
 * straight where it is near, can find a false corner within that of a
 * smooth join.
 */
const ONE_TOUCH_COS = Math.cos((5 * Math.PI) / 180)

/**
 * Do two touches meet the circle about `center` at one place? So they do
 * where two pieces join smoothly, a side running into its rounded corner:
 * their loci only graze there, which is no corner to hold a circle.
 */
function oneTouch(center: Vec, a: Vec, b: Vec): boolean {
  const ua = sub(a, center)
  const ub = sub(b, center)
  const size = length(ua) * length(ub)
  return size < 1e-18 || dot(ua, ub) >= ONE_TOUCH_COS * size
}

/**
 * Corners are looked for among this many loci nearest the circle at most:
 * a busy mark can put hundreds of pieces near a large circle's rim, and
 * every pair of them is a corner to try.
 */
const CORNER_LOCI = 16

/**
 * Where a circle moved near pieces should go to touch them: two at once
 * when it can (a corner of two lines, a line and a circle), else the
 * nearest one, from outside or inside, whichever is nearer. Two pieces
 * that join smoothly are no corner: there the nearest touch decides, so a
 * circle slides past the join. Null when nothing is within `tolerance` of
 * a touch.
 */
export function tangentMove(primitives: readonly Primitive[], circle: Circle, tolerance: number): { center: Vec; touches: Touch[] } | null {
  const found: Array<{ locus: Locus; off: number; order: number }> = []
  for (const primitive of primitives) {
    if (!inBand(primitive, circle.c, circle.r, tolerance)) continue
    for (const locus of lociOf(primitive, circle, tolerance)) found.push({ locus, off: distance(projectOnLocus(locus, circle.c), circle.c), order: found.length })
  }
  // Nearest first: a corner is no nearer than either of its loci, so the search stops at the first locus as far as the best corner.
  found.sort((a, b) => a.off - b.off || a.order - b.order)
  const loci = found.map((each) => each.locus)
  const corners = Math.min(loci.length, CORNER_LOCI)
  let best: { center: Vec; touches: Touch[]; off: number } | null = null
  for (let i = 0; i < corners; i++) {
    if (best && found[i].off >= best.off) break
    for (let j = i + 1; j < corners; j++) {
      if (best && found[j].off >= best.off) break
      if (loci[i].primitive === loci[j].primitive) continue
      for (const center of locusCrossings(loci[i], loci[j])) {
        const off = distance(center, circle.c)
        if (off > tolerance || (best && off >= best.off)) continue
        const a = loci[i].touch(center)
        const b = loci[j].touch(center)
        if (!a || !b || oneTouch(center, a, b)) continue
        // The touches in the order the pieces were given.
        const touches = [touchOf(loci[i].primitive, a), touchOf(loci[j].primitive, b)]
        best = { center, touches: found[i].order < found[j].order ? touches : touches.reverse(), off }
      }
    }
  }
  if (best) return { center: best.center, touches: best.touches }
  for (const locus of loci) {
    const center = projectOnLocus(locus, circle.c)
    const off = distance(center, circle.c)
    if (off > tolerance || (best && off >= best.off)) continue
    const touch = locus.touch(center)
    if (touch) best = { center, touches: [touchOf(locus.primitive, touch)], off }
  }
  return best && { center: best.center, touches: best.touches }
}

/**
 * Where a circle moved along one axis only, as a Shift-locked move goes,
 * should go to touch a piece: the nearest place along that axis, no further
 * than `tolerance`. Null when nothing is in reach.
 */
export function tangentMoveAlong(primitives: readonly Primitive[], circle: Circle, axis: 'x' | 'y', tolerance: number): { center: Vec; touches: Touch[] } | null {
  const track: Track = { kind: 'line', p: circle.c, d: axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 } }
  let best: { center: Vec; touches: Touch[]; off: number } | null = null
  for (const primitive of primitives) {
    if (!inBand(primitive, circle.c, circle.r, tolerance)) continue
    for (const locus of lociOf(primitive, circle, tolerance)) {
      for (const center of locusCrossings(locus, track)) {
        const off = distance(center, circle.c)
        if (off > tolerance || (best && off >= best.off)) continue
        const touch = locus.touch(center)
        if (touch) best = { center, touches: [touchOf(primitive, touch)], off }
      }
    }
  }
  return best && { center: best.center, touches: best.touches }
}

/* ─── A circle that grows ─── */

/**
 * The radius at which a circle being resized touches a piece, nearest its
 * radius now and within `tolerance` of it. The circle scales about `pivot`:
 * its centre itself for a circle about a fixed centre, or the opposite corner
 * for a slab pulled by a corner, so its centre moves along a line from the
 * pivot as it grows. Each touch is solved exactly for that line, so the size
 * found does not depend on the size now, only whether it is in reach. A
 * piece the circle touches at every size, such as a line it sits on along
 * the side that stays put, is no snap. Null when nothing is in reach.
 */
export function tangentRadius(
  primitives: readonly Primitive[],
  circle: Circle,
  pivot: Vec,
  tolerance: number,
): { radius: number; center: Vec; touch: Touch } | null {
  const r0 = circle.r
  if (r0 < 1e-9) return null
  // The centre at radius rho is pivot + w·rho.
  const w = scale(sub(circle.c, pivot), 1 / r0)
  const centerAt = (rho: number) => add(pivot, scale(w, rho))
  const travel = length(w)
  let best: { radius: number; center: Vec; touch: Touch } | null = null
  const offer = (primitive: Primitive, rho: number, touch: (center: Vec, rho: number) => Vec | null) => {
    if (!Number.isFinite(rho) || rho < 0.5 || Math.abs(rho - r0) > tolerance) return
    if (best && Math.abs(rho - r0) >= Math.abs(best.radius - r0)) return
    const center = centerAt(rho)
    const p = touch(center, rho)
    if (p) best = { radius: rho, center, touch: touchOf(primitive, p) }
  }
  // Where the centre is `distance` from a point: |q + w·rho|² = (base + sign·rho)², with q from that point to the pivot.
  const aboutPoint = (q: Vec, base: number, sign: number): number[] =>
    quadraticRoots(dot(w, w) - 1, 2 * (dot(q, w) - sign * base), dot(q, q) - base * base)

  // Within `tolerance` of the size now, the centre moves no more than travel·tolerance: a touch is within this of the rim now.
  const reach = tolerance * (1 + travel)
  for (const primitive of primitives) {
    if (!inBand(primitive, circle.c, r0, reach)) continue
    switch (primitive.kind) {
      case 'segment':
      case 'line': {
        const a = primitive.kind === 'line' ? primitive.p : primitive.a
        const d = primitive.kind === 'line' ? primitive.d : normalize(sub(primitive.b, primitive.a))
        const len = primitive.kind === 'line' ? Infinity : distance(primitive.a, primitive.b)
        const n = { x: -d.y, y: d.x }
        // The centre's signed distance from the line is s0 + k·rho; it touches where that is ±rho.
        const s0 = dot(sub(pivot, a), n)
        const k = dot(w, n)
        const foot = (center: Vec) => {
          const t = dot(sub(center, a), d)
          return t >= -1e-6 && t <= len + 1e-6 ? add(a, scale(d, t)) : null
        }
        for (const side of [1, -1]) {
          // A slope of nought: it touches at every size, or at none.
          if (Math.abs(k - side) > 1e-9) offer(primitive, -s0 / (k - side), foot)
        }
        if (primitive.kind === 'segment') {
          // Past the end of a segment, its end is what the circle touches.
          for (const end of [primitive.a, primitive.b]) {
            for (const rho of aboutPoint(sub(pivot, end), 0, 1)) offer(primitive, rho, (center) => (foot(center) ? null : end))
          }
        }
        break
      }
      case 'circle':
      case 'arc': {
        const R = primitive.r
        const q = sub(pivot, primitive.c)
        const at = (center: Vec, sign: number) => {
          const away = sub(center, primitive.c)
          if (length(away) < 1e-9) return null
          const p = add(primitive.c, scale(normalize(away), sign * R))
          return onRound(primitive, p) ? p : null
        }
        // From outside, the centres R + rho apart; from inside, |R − rho| apart, the smaller in the larger.
        for (const rho of aboutPoint(q, R, 1)) offer(primitive, rho, (center) => at(center, 1))
        for (const rho of aboutPoint(q, R, -1)) offer(primitive, rho, (center, size) => at(center, size < R ? 1 : -1))
        break
      }
      case 'cubic': {
        // The curve is never further than its ends: one that ends well inside the circle crosses it, touching nowhere in reach.
        const [start, , , end] = primitive.curve
        if (Math.min(distance(circle.c, start), distance(circle.c, end)) < r0 - reach) break
        // A curve has no closed form: the gap is settled by secant steps from the size now.
        // Kept per size: the secant steps start from the two sizes read here.
        const gaps = new Map<number, number>()
        const gap = (rho: number) => {
          let value = gaps.get(rho)
          if (value === undefined) gaps.set(rho, (value = nearestOnPrimitive(primitive, centerAt(rho)).distance - rho))
          return value
        }
        // The gap changes by no more than 1 + travel for each unit of size: one this wide closes nowhere in reach.
        const now = gap(r0)
        if (Math.abs(now) > reach) break
        if (Math.abs(gap(r0 + tolerance) - now) <= 1e-9 * Math.max(1, r0)) break
        const rho = solveNear(gap, r0, tolerance)
        if (rho !== null) offer(primitive, rho, (center) => nearestOnPrimitive(primitive, center).point)
        break
      }
      default:
        return primitive satisfies never
    }
  }
  return best
}

/** The real roots of a·x² + b·x + c; none when every coefficient is nought, as for a touch at every size. */
function quadraticRoots(a: number, b: number, c: number): number[] {
  const size = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
  if (size < 1e-12) return []
  const [qa, qb, qc] = [a / size, b / size, c / size]
  if (Math.abs(qa) < 1e-12) return Math.abs(qb) < 1e-12 ? [] : [-qc / qb]
  const disc = qb * qb - 4 * qa * qc
  if (disc < -1e-12) return []
  const root = Math.sqrt(Math.max(0, disc))
  return root === 0 ? [-qb / (2 * qa)] : [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]
}

/** A root of `f` within `reach` of `x0`, by secant steps, or null. */
function solveNear(f: (x: number) => number, x0: number, reach: number): number | null {
  let a = x0
  let b = x0 + Math.max(reach, 1e-3)
  let fa = f(a)
  let fb = f(b)
  // Zero at both ends: no one root to settle on.
  if (Math.abs(fa) < 1e-10 && Math.abs(fb) < 1e-10) return null
  for (let i = 0; i < 24; i++) {
    if (Math.abs(fa) < 1e-10) break
    if (Math.abs(fb - fa) < 1e-14) return null
    const c = b - (fb * (b - a)) / (fb - fa)
    a = b
    fa = fb
    b = c
    fb = f(b)
    if (Math.abs(b - a) < 1e-10) break
  }
  const root = Math.abs(fa) < Math.abs(fb) ? a : b
  if (!Number.isFinite(root) || Math.abs(f(root)) > 1e-6 * Math.max(1, Math.abs(root))) return null
  return Math.abs(root - x0) <= reach ? root : null
}

/* ─── Lines touching circles ─── */

const deg = (rad: number) => (rad * 180) / Math.PI

/** The round pieces among some: circles and arcs, the circles lines can touch. */
export function roundPrimitives(primitives: readonly Primitive[]): Round[] {
  return primitives.filter((primitive): primitive is Round => primitive.kind === 'circle' || primitive.kind === 'arc')
}

/**
 * The line from `from` that touches a circle, for a line drawn from `from`
 * through `towards`: it turns only to a circle it already passes within
 * `tolerance` of touching, its centre that close to the radius away from the
 * line, so a far circle never draws it off. Of those, the nearest touch.
 * The angle in degrees, read the way the line was drawn, and where it
 * touches; null when no circle is in reach.
 */
export function tangentThrough(from: Vec, towards: Vec, rounds: readonly Round[], tolerance: number): { angle: number; touch: Touch } | null {
  const along = sub(towards, from)
  if (length(along) < 1e-9) return null
  const u = normalize(along)
  let best: { angle: number; touch: Touch; off: number } | null = null
  for (const round of rounds) {
    const toCentre = sub(round.c, from)
    const d = length(toCentre)
    if (d <= round.r + 1e-9) continue
    const off = Math.abs(Math.abs(cross(u, toCentre)) - round.r)
    if (off > tolerance || (best && off >= best.off)) continue
    // Of the two lines through `from` that touch it, the one nearer the line drawn, pointing the way it was drawn.
    const half = Math.asin(round.r / d)
    const lines = [-1, 1].map((side) => rotate(normalize(toCentre), deg(side * half)))
    const nearer = Math.abs(dot(lines[0], u)) >= Math.abs(dot(lines[1], u)) ? lines[0] : lines[1]
    const dir = dot(nearer, u) < 0 ? scale(nearer, -1) : nearer
    const p = add(from, scale(dir, dot(toCentre, dir)))
    if (!onRound(round, p)) continue
    best = { angle: deg(Math.atan2(dir.y, dir.x)), touch: touchOf(round, p), off }
  }
  return best && { angle: best.angle, touch: best.touch }
}

/**
 * The line at `angle` degrees through `through`, moved by no more than
 * `tolerance` until it touches a circle: where it then passes, and where it
 * touches. It moves across itself, or along the unit vector `along` when
 * given (a Shift-locked move). Null when no circle is in reach.
 */
export function tangentAtAngle(
  through: Vec,
  angle: number,
  rounds: readonly Round[],
  tolerance: number,
  along?: Vec,
): { p: Vec; touch: Touch } | null {
  const d = rotate({ x: 1, y: 0 }, angle)
  const n = { x: -d.y, y: d.x }
  const way = along ?? n
  // How far the line moves across itself for each unit it moves along `way`.
  const across = dot(way, n)
  if (Math.abs(across) < 1e-9) return null
  let best: { p: Vec; touch: Touch; off: number } | null = null
  for (const round of rounds) {
    const s = dot(sub(round.c, through), n)
    for (const side of [-1, 1]) {
      const travel = (s - side * round.r) / across
      if (Math.abs(travel) > tolerance || (best && Math.abs(travel) >= best.off)) continue
      const p = add(through, scale(way, travel))
      const touch = sub(round.c, scale(n, side * round.r))
      if (!onRound(round, touch)) continue
      best = { p, touch: touchOf(round, touch), off: Math.abs(travel) }
    }
  }
  return best && { p: best.p, touch: best.touch }
}

/** Every circle or arc that the line at `angle` degrees through `p` touches, to within `hair`: where it touches each. */
export function lineTouches(p: Vec, angle: number, rounds: readonly Round[], hair = 1e-3): Touch[] {
  const d = rotate({ x: 1, y: 0 }, angle)
  const n = { x: -d.y, y: d.x }
  const out: Touch[] = []
  for (const round of rounds) {
    const s = dot(sub(round.c, p), n)
    if (Math.abs(Math.abs(s) - round.r) > hair) continue
    const touch = sub(round.c, scale(n, s))
    if (onRound(round, touch)) out.push(touchOf(round, touch))
  }
  return out
}

/** A line two circles share: through `p` at `angle` degrees, touching the first at `touches[0]` and the second at `touches[1]`. */
export interface CommonTangent {
  p: Vec
  angle: number
  touches: [Vec, Vec]
  /** External lines keep both circles on one side; internal ones pass between them. */
  kind: 'external' | 'internal'
}

/**
 * The lines that touch two circles: the two external ones, unless one
 * circle holds the other, and the two internal ones, when the circles are
 * apart. Where two circles touch, the line through that point is one line,
 * not two: internal when they touch from outside, external from inside.
 */
export function commonTangents(a: Circle, b: Circle): CommonTangent[] {
  const between = sub(b.c, a.c)
  const d = length(between)
  if (d < 1e-9) return []
  const v = scale(between, 1 / d)
  const perp = { x: -v.y, y: v.x }
  const out: CommonTangent[] = []
  for (const kind of ['external', 'internal'] as const) {
    const sign = kind === 'external' ? 1 : -1
    // A unit normal n with n·a.c − q = a.r and n·b.c − q = sign·b.r.
    const k = (sign * b.r - a.r) / d
    if (Math.abs(k) > 1 + 1e-12) continue
    const h = Math.sqrt(Math.max(0, 1 - k * k))
    const sides = h < 1e-9 ? [1] : [1, -1]
    for (const t of sides) {
      const n = add(scale(v, k), scale(perp, t * h))
      const ta = sub(a.c, scale(n, a.r))
      const tb = sub(b.c, scale(n, sign * b.r))
      const dir = { x: -n.y, y: n.x }
      out.push({ p: ta, angle: deg(Math.atan2(dir.y, dir.x)), touches: [ta, tb], kind })
    }
  }
  return out
}
