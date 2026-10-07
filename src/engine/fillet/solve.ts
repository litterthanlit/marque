import { add, cross, cubicTangent, distance, dot, length, normalize, projectOnCubic, scale, splitCubic, sub, type Cubic, type Vec } from '../path/bezier.ts'
import type { Primitive } from '../geometry/primitives.ts'
import { cubicArea, onPieceTolerance } from './corners.ts'

/**
 * Where a fillet sits in a corner: the circle of radius ρ touching both
 * curves, on the side of each that the corner's angle opens to. Lines and
 * circles are solved exactly; otherwise, or where a touch point would fall
 * past the end of its piece, the fillet is found by Newton's method on the
 * curves as the ink draws them. A fillet counts only when it rounds its own
 * corner: each touch point on its side's run, the circle tangent to both
 * runs and crossing neither, reached from the corner without passing a
 * narrowing, and taking off no more than its notch. Where none of radius ρ
 * does, radii are tried downward from it and the largest found between two
 * tried ones by halving. Pure, in layer space.
 */

/** What the solver reads of a corner. */
export interface FilletCorner {
  p: Vec
  /** The angle between the two curves on the fillet's side, in (0, π). */
  angle: number
  /** The unit vector halving it. */
  bisector: Vec
  /** Each side's run of curves, leaving the corner. */
  sides: readonly [readonly Cubic[], readonly Cubic[]]
  /** The outline piece each side runs along: a segment, a circle or arc, or a free curve. */
  carriers: readonly [Primitive, Primitive]
}

export interface FilletSolution {
  centre: Vec
  /** Where the fillet touches side a and side b. */
  touches: [Vec, Vec]
  /** The radius used: the one asked for, or less where it would not fit. */
  radius: number
  clamped: boolean
  /** Solved on the curves as the ink draws them, not on the true lines and circles. */
  drawn: boolean
}

/** One side as the solver reads it, with the sign that puts the fillet on its side. */
type Carrier =
  /** A line through `p` whose unit normal `n` points to the fillet's side. */
  | { kind: 'line'; p: Vec; n: Vec; run: readonly Cubic[]; tolerance: number }
  /** A circle; `out` is 1 when the fillet lies outside it, −1 inside. */
  | { kind: 'circle'; c: Vec; r: number; out: 1 | -1; run: readonly Cubic[]; tolerance: number }
  /** A free curve: the run itself; `side` is the sign of the cross product from its way to the fillet's side. */
  | { kind: 'curve'; run: readonly Cubic[]; side: 1 | -1; tolerance: number }

/** How many Newton steps settle a centre at most: from a fair start it takes four or five. */
const NEWTON_STEPS = 30

/** How near ρ from both sides a centre must be: exactly tangent, to a millionth of the radius. */
const fitTolerance = (rho: number) => 1e-6 * Math.max(1, rho)

/** Each radius tried below the one asked is this much of the one before. */
const SCAN_STEP = 0.7

/** The smallest fillet worth finding. */
const LEAST = 0.01

/** Halving stops once the radius is known to this. */
const HALVING_TO = 1e-3

/**
 * The fillet of radius `radius` in a corner, cut down where it would not
 * fit; null when no fillet fits at all. Where none of the radius asked
 * rounds its corner, radii are tried downward from it: first the largest
 * the corner's own branch reaches, then in steps of 0.7; the largest that
 * fits is found by halving between it and the one tried above it.
 */
export function solveFillet(corner: FilletCorner, radius: number): FilletSolution | null {
  if (!(radius > 0)) return null
  const pieces: [Carrier, Carrier] = [carrierOf(corner, 0), carrierOf(corner, 1)]
  const drawn: [Carrier, Carrier] = [wholeRun(corner, 0), wholeRun(corner, 1)]
  const exact = pieces.every((carrier) => carrier.kind !== 'curve') ? solveExact(corner, pieces, drawn, radius) : null
  if (exact) return exact
  const branch = branchOf(corner, drawn)
  const fit = (rho: number): Fit | null => {
    const found = branch.at(rho)
    return found && rounds(corner, drawn, found.centre, found.touches, rho) ? found : null
  }
  const full = fit(radius)
  if (full) return { ...full, radius, clamped: false, drawn: true }
  const tried = [radius]
  // The largest the branch reaches is tried first: where it fits, every request above it gives the same fillet.
  const most = branch.most(radius)
  let found = most !== null && most < radius ? fit(most) : null
  if (most !== null && most < radius && !found) tried.push(most)
  for (let rho = Math.min(...tried) * SCAN_STEP; !found && rho >= LEAST; rho *= SCAN_STEP) {
    found = fit(rho)
    if (!found) tried.push(rho)
  }
  if (!found) return null
  // Halved only between a radius that fits and the one tried just above it, which did not.
  let above = Math.min(...tried.filter((rho) => rho > found!.rho))
  while (above - found.rho > HALVING_TO) {
    const next = fit((found.rho + above) / 2)
    if (next) found = next
    else above = (found.rho + above) / 2
  }
  return { centre: found.centre, touches: found.touches, radius: found.rho, clamped: true, drawn: true }
}

/** A fillet found on the curves as drawn: its radius, its centre and its touch points. */
interface Fit {
  rho: number
  centre: Vec
  touches: [Vec, Vec]
}

/**
 * The fillet of exactly ρ on the true lines and circles, where it rounds
 * its corner on the true pieces and moved onto the curves as drawn as well.
 */
function solveExact(corner: FilletCorner, carriers: [Carrier, Carrier], drawn: [Carrier, Carrier], rho: number): FilletSolution | null {
  const found = solveAt(corner, carriers, rho)
  if (!found) return null
  // The circle must clear the rest of each side as well: else it meets a third curve.
  if (!carriers.every((carrier) => clears(carrier.run, carrier.tolerance, found.centre, rho))) return null
  const solution: FilletSolution = { ...found, radius: rho, clamped: false, drawn: false }
  // Exactly tangent to the curves as drawn too, and rounding just its corner there.
  const settled = settleOn(drawn, solution)
  return settled && rounds(corner, drawn, settled.centre, settled.touches, rho) ? solution : null
}

/** A grown fillet: its radius, centre and touch points, and the way out from each side there. */
interface Grown extends Fit {
  normals: [Vec, Vec]
}

/** The radius a corner's branch starts growing from: so every request grows it the same way. */
const SEED = 1

/** How far the way out from a side may turn in one step: further, the touch point has jumped to another part of its run. */
const STEP_TURN = Math.cos((20 * Math.PI) / 180)

/** How many steps a branch may take growing, as a bound: it takes a dozen or two. */
const GROW_STEPS = 200

/**
 * A corner's branch: the fillets that grow out of it along the curves as
 * drawn, radius by radius, each centre from the last, moved the way the two
 * distances say and settled by Newton's method, the step doubling while it
 * goes well. A step whose centre settles far from where it was headed, or
 * whose touch point jumps to another part of its run, has left the branch,
 * as past a narrowing or where the circle meets a third curve, and is taken
 * again shorter; once the steps are too short to matter the branch ends.
 * Every radius on it is reached from the corner, so no fillet found here
 * sits on the far side of a narrowing. The steps never depend on the radius
 * asked, so every request reads the same branch.
 */
function branchOf(corner: FilletCorner, runs: [Carrier, Carrier]): { at(rho: number): Fit | null; most(limit: number): number | null } {
  const half = Math.sin(corner.angle / 2)
  const points: Grown[] = []
  let ended = half < 1e-6
  let step = 0
  const settle = (from: Grown, rho: number): Grown | null => {
    const [na, nb] = from.normals
    const along = 1 + dot(na, nb)
    // Where the sides run apart square to both, the room no longer grows.
    if (along < 1e-9) return null
    const headed = add(from.centre, scale(add(na, nb), (rho - from.rho) / along))
    const found = settleAt(corner, runs, headed, rho)
    const kept =
      found !== null &&
      distance(found.centre, headed) <= 0.5 * distance(headed, from.centre) + 1e-9 &&
      dot(found.normals[0], na) >= STEP_TURN &&
      dot(found.normals[1], nb) >= STEP_TURN
    return kept ? found : null
  }
  const start = () => {
    for (let rho = SEED; rho >= LEAST / 8; rho /= 2) {
      const guess = add(corner.p, scale(corner.bisector, rho / half))
      const found = settleAt(corner, runs, guess, rho)
      if (found && distance(found.centre, guess) <= 0.5 * (rho / half)) {
        points.push(found)
        step = rho
        return
      }
    }
    ended = true
  }
  /** Grows the branch until it passes `rho` or ends. */
  const grow = (rho: number) => {
    if (!points.length && !ended) start()
    for (let taken = 0; !ended && points.at(-1)!.rho < rho && taken < GROW_STEPS; taken++) {
      const last = points.at(-1)!
      const next = settle(last, last.rho + step)
      if (next) {
        points.push(next)
        step *= 2
      } else if ((step /= 2) < Math.max(1e-3, 1e-6 * last.rho)) ended = true
    }
  }
  return {
    at(rho) {
      grow(rho)
      // The nearest point of the branch at or below ρ, and on from it.
      let below: Grown | null = null
      for (const point of points) if (point.rho <= rho && (!below || point.rho > below.rho)) below = point
      if (!below) return null
      if (below.rho === rho) return below
      const above = points.find((point) => point.rho > rho)
      if (!above && ended) return null
      return settle(below, rho)
    },
    most(limit) {
      grow(limit)
      return points.length ? Math.min(limit, points.at(-1)!.rho) : null
    },
  }
}

/** The centre ρ from both runs that Newton's method settles on from `start`, its touch points on their runs; null when there is none. */
function settleAt(corner: FilletCorner, runs: [Carrier, Carrier], start: Vec, rho: number): Grown | null {
  const centre = newtonFrom(start, runs, rho, NEWTON_STEPS)
  if (!centre || dot(sub(centre, corner.p), corner.bisector) <= 0) return null
  const a = signedDistance(runs[0], centre)
  const b = signedDistance(runs[1], centre)
  if (Math.abs(a.value - rho) > fitTolerance(rho) || Math.abs(b.value - rho) > fitTolerance(rho)) return null
  if (!onRun(runs[0], a.foot, centre) || !onRun(runs[1], b.foot, centre)) return null
  return { rho, centre, touches: [a.foot, b.foot], normals: [a.gradient, b.gradient] }
}

/** The touch points of a circle about `centre` exactly ρ from both runs, each meeting its run square; null when it is not. */
function tangentAt(runs: [Carrier, Carrier], centre: Vec, rho: number): [Vec, Vec] | null {
  const a = signedDistance(runs[0], centre)
  const b = signedDistance(runs[1], centre)
  if (Math.abs(a.value - rho) > fitTolerance(rho) || Math.abs(b.value - rho) > fitTolerance(rho)) return null
  if (!onRun(runs[0], a.foot, centre) || !onRun(runs[1], b.foot, centre)) return null
  return [a.foot, b.foot]
}

/**
 * Does a circle tangent to both runs round just its corner? Its centre lies
 * on the side the corner opens to; the way from the corner to the centre
 * stays between the sides, the room either side of it never closing on the
 * way (a narrowing: past one, the circle sits where the ink widens again,
 * and its notch would take the ink between); and the notch it rounds off,
 * from the corner along each side to its touch point and back round the
 * arc, is no larger than the triangle of the corner and the touch points
 * and the circle's segment beyond their chord.
 */
function rounds(corner: FilletCorner, runs: [Carrier, Carrier], centre: Vec, touches: [Vec, Vec], rho: number): boolean {
  if (dot(sub(centre, corner.p), corner.bisector) <= 0) return false
  if (!runs.every((run) => clears(run.run, 0, centre, rho))) return false
  if (narrows(corner, touches)) return false
  return notchArea(corner, centre, touches, rho) <= notchBound(corner, centre, touches, rho)
}

/** How many points along each side, from the corner to its touch point, are read for a narrowing. */
const SIDE_SAMPLES = 12

/** How far the width between the sides may fall back and still be no narrowing: what the curves as drawn stray by. */
const narrowSlack = (rho: number) => 0.02 * rho + 1e-3

/**
 * Does the ink between the sides narrow somewhere between the corner and
 * the touch points? Read along each side from the corner, the way across to
 * the other side, as far as its touch point, only ever widens in a corner a
 * fillet rounds; past a narrowing it widens again, and a circle there would
 * take the ink between.
 */
function narrows(corner: FilletCorner, touches: [Vec, Vec]): boolean {
  const near = [runTo(corner.sides[0], touches[0]), runTo(corner.sides[1], touches[1])]
  if (!near[0].length || !near[1].length) return false
  const rho = Math.max(distance(touches[0], corner.p), distance(touches[1], corner.p))
  for (const side of [0, 1] as const) {
    const other = near[1 - side]
    const points = alongRun(near[side], SIDE_SAMPLES)
    let widest = 0
    for (const x of points) {
      const across = nearestOnRun(other, x).distance
      if (across < widest - narrowSlack(rho)) return true
      widest = Math.max(widest, across)
    }
  }
  return false
}

/** Points spread along a run of curves by parameter, its start left out. */
function alongRun(run: readonly Cubic[], count: number): Vec[] {
  const points: Vec[] = []
  for (let k = 1; k <= count; k++) {
    const at = (k / count) * run.length
    const index = Math.min(run.length - 1, Math.floor(at))
    points.push(pointOn(run[index], at - index))
  }
  return points
}

/** The arc of a fillet that faces its corner: the angle it starts from at the first touch point, and its sweep to the second. */
export function cornerArc(corner: Vec, centre: Vec, touches: readonly [Vec, Vec], radius: number): { begin: number; sweep: number } {
  const begin = Math.atan2(touches[0].y - centre.y, touches[0].x - centre.x)
  const finish = Math.atan2(touches[1].y - centre.y, touches[1].x - centre.x)
  let sweep = finish - begin
  while (sweep <= -Math.PI) sweep += 2 * Math.PI
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  // The middle of the arc that faces the corner is nearer the corner than the centre is.
  const middle = add(centre, scale({ x: Math.cos(begin + sweep / 2), y: Math.sin(begin + sweep / 2) }, radius))
  if (distance(middle, corner) > distance(centre, corner)) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI
  return { begin, sweep }
}

/** The area of a fillet's notch: from the corner along side a to its touch point, round the arc, and back along side b. */
function notchArea(corner: FilletCorner, centre: Vec, touches: [Vec, Vec], rho: number): number {
  let area = 0
  for (const curve of runTo(corner.sides[0], touches[0])) area += cubicArea(curve)
  // Round the arc, exactly: half the integral of p × dp.
  const { begin, sweep } = cornerArc(corner.p, centre, touches, rho)
  const end = add(centre, scale({ x: Math.cos(begin + sweep), y: Math.sin(begin + sweep) }, rho))
  const start = add(centre, scale({ x: Math.cos(begin), y: Math.sin(begin) }, rho))
  area += (rho * rho * sweep + cross(centre, sub(end, start))) / 2
  for (const curve of runTo(corner.sides[1], touches[1])) area -= cubicArea(curve)
  return Math.abs(area)
}

/** The most a notch may cover: the triangle of the corner and the touch points, and the circle's segment beyond their chord. */
function notchBound(corner: FilletCorner, centre: Vec, touches: [Vec, Vec], rho: number): number {
  const triangle = Math.abs(cross(sub(touches[0], corner.p), sub(touches[1], corner.p))) / 2
  const { sweep } = cornerArc(corner.p, centre, touches, rho)
  const segment = (rho * rho * (Math.abs(sweep) - Math.sin(Math.abs(sweep)))) / 2
  return (triangle + segment) * (1 + 1e-3) + 1e-6
}

/** A side's run of curves from the corner as far as its touch point. */
export function runTo(run: readonly Cubic[], touch: Vec): Cubic[] {
  let best = { index: 0, t: 0, distance: Infinity }
  run.forEach((curve, index) => {
    const hit = projectOnCubic(curve, touch)
    if (hit.distance < best.distance - 1e-9) best = { index, t: hit.t, distance: hit.distance }
  })
  const out = run.slice(0, best.index)
  if (best.t > 1e-6) out.push(best.t >= 1 - 1e-6 ? run[best.index] : splitCubic(run[best.index], best.t)[0])
  return out
}

/** Does a circle keep clear of a run, but for touching it, to within `slack` and how exactly it touches? */
function clears(run: readonly Cubic[], slack: number, centre: Vec, rho: number): boolean {
  return nearestOnRun(run, centre).distance >= rho - slack - fitTolerance(rho)
}

/**
 * A fillet solved on the true lines and circles, moved onto the curves the
 * ink draws them with, as the fillet pass rounds it: a circle drawn as
 * cubics strays from the true one by a few hundredths, and an arc tangent
 * to the true circle would cross the drawn one at a slant near the touch
 * point, leaving a kink of a few degrees there. The solver takes a true
 * answer only where this settles, so it always does; one found on the
 * drawn curves is there already.
 */
export function settleOnInk(corner: FilletCorner, found: FilletSolution): FilletSolution {
  if (found.drawn) return found
  return settleOn([wholeRun(corner, 0), wholeRun(corner, 1)], found) ?? found
}

/** A true answer moved onto the runs as drawn by Newton's method, exactly tangent there; null where it does not settle near. */
function settleOn(drawn: [Carrier, Carrier], found: FilletSolution): FilletSolution | null {
  const rho = found.radius
  const centre = newtonFrom(found.centre, drawn, rho, NEWTON_STEPS)
  if (!centre || distance(centre, found.centre) > 0.1 + 1e-3 * rho) return null
  const touches = tangentAt(drawn, centre, rho)
  return touches ? { ...found, centre, touches, drawn: true } : null
}

/** The ray a side leaves the corner along. */
function rayOf(corner: FilletCorner, side: 0 | 1): Vec {
  const run = corner.sides[side]
  const curve = run[0]
  for (const q of [curve[1], curve[2], curve[3]]) {
    const d = sub(q, curve[0])
    if (length(d) > 1e-9) return normalize(d)
  }
  return corner.bisector
}

/** The unit normal of a direction that points to the side `towards` lies on. */
function normalTowards(d: Vec, towards: Vec): Vec {
  const n = { x: -d.y, y: d.x }
  return dot(n, towards) >= 0 ? n : scale(n, -1)
}

function carrierOf(corner: FilletCorner, side: 0 | 1): Carrier {
  const primitive = corner.carriers[side]
  const ray = rayOf(corner, side)
  const n = normalTowards(ray, corner.bisector)
  const tolerance = onPieceTolerance(primitive)
  const fullRun = corner.sides[side]
  switch (primitive.kind) {
    case 'segment':
    case 'line': {
      const along = primitive.kind === 'segment' ? normalize(sub(primitive.b, primitive.a), ray) : primitive.d
      const p = primitive.kind === 'segment' ? primitive.a : primitive.p
      const normal = normalTowards(along, n)
      return { kind: 'line', p, n: normal, run: runAlong(fullRun, (q) => Math.abs(dot(sub(q, p), normal)) <= tolerance), tolerance }
    }
    case 'circle':
    case 'arc': {
      const out = dot(n, sub(corner.p, primitive.c)) >= 0 ? 1 : -1
      const { c, r } = primitive
      return { kind: 'circle', c, r, out, run: runAlong(fullRun, (q) => Math.abs(distance(q, c) - r) <= tolerance), tolerance }
    }
    case 'cubic':
      return { kind: 'curve', run: fullRun, side: cross(ray, n) >= 0 ? 1 : -1, tolerance }
    default:
      return primitive satisfies never
  }
}

/** A side read as the whole run of ink curves leaving the corner as drawn, whatever pieces they lie on. */
function wholeRun(corner: FilletCorner, side: 0 | 1): Carrier {
  const ray = rayOf(corner, side)
  const n = normalTowards(ray, corner.bisector)
  return { kind: 'curve', run: corner.sides[side], side: cross(ray, n) >= 0 ? 1 : -1, tolerance: onPieceTolerance(corner.carriers[side]) }
}

/** The run's curves from its start, as far as each still lies on its piece: a smooth join onto another object's outline ends it. */
function runAlong(run: readonly Cubic[], on: (q: Vec) => boolean): readonly Cubic[] {
  let end = 1
  while (end < run.length) {
    const curve = run[end]
    if (![0.25, 0.5, 0.75, 1].every((t) => on(pointOn(curve, t)))) break
    end++
  }
  return end === run.length ? run : run.slice(0, end)
}

function pointOn(curve: Cubic, t: number): Vec {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * curve[0].x + b * curve[1].x + c * curve[2].x + d * curve[3].x,
    y: a * curve[0].y + b * curve[1].y + c * curve[2].y + d * curve[3].y,
  }
}

/** The nearest point of a run of curves to `q`, how far it is, and the run's way there. */
function nearestOnRun(run: readonly Cubic[], q: Vec): { point: Vec; distance: number; tangent: Vec } {
  let best = { point: run[0][0], distance: Infinity, tangent: { x: 1, y: 0 } }
  for (const curve of run) {
    const hit = projectOnCubic(curve, q)
    if (hit.distance < best.distance) best = { point: hit.point, distance: hit.distance, tangent: cubicTangent(curve, hit.t) }
  }
  return best
}

/** How far `x` is from a side, signed so the fillet's side is positive, with the direction it grows fastest in. */
function signedDistance(carrier: Carrier, x: Vec): { value: number; gradient: Vec; foot: Vec } {
  switch (carrier.kind) {
    case 'line': {
      const value = dot(sub(x, carrier.p), carrier.n)
      return { value, gradient: carrier.n, foot: sub(x, scale(carrier.n, value)) }
    }
    case 'circle': {
      const away = sub(x, carrier.c)
      const d = length(away)
      const u = d > 1e-12 ? scale(away, 1 / d) : { x: 1, y: 0 }
      return { value: carrier.out * (d - carrier.r), gradient: scale(u, carrier.out), foot: add(carrier.c, scale(u, carrier.r)) }
    }
    case 'curve': {
      const near = nearestOnRun(carrier.run, x)
      const away = sub(x, near.point)
      const sign = Math.sign(cross(near.tangent, away)) === carrier.side ? 1 : -1
      // On the curve itself, the way out to the fillet's side is square to the curve.
      const u = near.distance > 1e-12 ? scale(away, sign / near.distance) : scale({ x: -near.tangent.y, y: near.tangent.x }, carrier.side)
      return { value: sign * near.distance, gradient: u, foot: near.point }
    }
    default:
      return carrier satisfies never
  }
}

/** The fillet of exactly radius `rho` between lines and circles, its touch points on their runs; null when there is none. */
function solveAt(corner: FilletCorner, carriers: [Carrier, Carrier], rho: number): Pick<FilletSolution, 'centre' | 'touches'> | null {
  const candidates = centreCandidates(carriers, rho)
  const ranked = candidates
    .filter((x) => dot(sub(x, corner.p), corner.bisector) > 0)
    .sort((a, b) => distance(a, corner.p) - distance(b, corner.p))
  for (const centre of ranked) {
    const a = signedDistance(carriers[0], centre)
    const b = signedDistance(carriers[1], centre)
    if (Math.abs(a.value - rho) > fitTolerance(rho) || Math.abs(b.value - rho) > fitTolerance(rho)) continue
    if (!onRun(carriers[0], a.foot, centre) || !onRun(carriers[1], b.foot, centre)) return null
    return { centre, touches: [a.foot, b.foot] }
  }
  return null
}

/**
 * Is a touch point on its side's run, not past its end nor behind the
 * corner? On a free curve, the fillet must meet it square, not just reach
 * the end of the run.
 */
function onRun(carrier: Carrier, foot: Vec, centre: Vec): boolean {
  const near = nearestOnRun(carrier.run, foot)
  if (near.distance > carrier.tolerance) return false
  if (carrier.kind !== 'curve') return true
  const away = sub(centre, foot)
  return Math.abs(dot(near.tangent, away)) <= 1e-6 * length(away)
}

/** Where the centre can be between lines and circles, exactly. */
function centreCandidates([a, b]: [Carrier, Carrier], rho: number): Vec[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const x = lineLine(a, b, rho)
    return x ? [x] : []
  }
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a, b, rho)
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b, a, rho)
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b, rho)
  return []
}

/** Where the two lines moved ρ to the fillet's side cross. */
function lineLine(a: Extract<Carrier, { kind: 'line' }>, b: Extract<Carrier, { kind: 'line' }>, rho: number): Vec | null {
  const det = cross(a.n, b.n)
  if (Math.abs(det) < 1e-12) return null
  const ca = rho + dot(a.p, a.n)
  const cb = rho + dot(b.p, b.n)
  // Solve n_a·x = ca, n_b·x = cb.
  return { x: (ca * b.n.y - cb * a.n.y) / det, y: (a.n.x * cb - b.n.x * ca) / det }
}

/** Where the line moved ρ to the fillet's side meets the circle of radius r ± ρ. */
function lineCircle(line: Extract<Carrier, { kind: 'line' }>, circle: Extract<Carrier, { kind: 'circle' }>, rho: number): Vec[] {
  const R = circle.r + circle.out * rho
  if (!(R > 0)) return []
  const d = { x: -line.n.y, y: line.n.x }
  const base = add(line.p, scale(line.n, rho))
  const w = sub(base, circle.c)
  const half = dot(w, d)
  const disc = half * half - (dot(w, w) - R * R)
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return [add(base, scale(d, -half - root)), add(base, scale(d, -half + root))]
}

/** Where the circles of radius r₁ ± ρ and r₂ ± ρ meet. */
function circleCircle(a: Extract<Carrier, { kind: 'circle' }>, b: Extract<Carrier, { kind: 'circle' }>, rho: number): Vec[] {
  const ra = a.r + a.out * rho
  const rb = b.r + b.out * rho
  if (!(ra > 0) || !(rb > 0)) return []
  const d = distance(a.c, b.c)
  if (d < 1e-12 || d > ra + rb || d < Math.abs(ra - rb)) return []
  const along = (d * d + ra * ra - rb * rb) / (2 * d)
  const h = Math.sqrt(Math.max(0, ra * ra - along * along))
  const u = scale(sub(b.c, a.c), 1 / d)
  const mid = add(a.c, scale(u, along))
  const n = { x: -u.y, y: u.x }
  return [add(mid, scale(n, h)), sub(mid, scale(n, h))]
}

/** The point ρ from both sides by Newton's method on the two distances, from `start`. */
function newtonFrom(start: Vec, [a, b]: [Carrier, Carrier], rho: number, steps: number): Vec | null {
  let x = start
  for (let step = 0; step < steps; step++) {
    const da = signedDistance(a, x)
    const db = signedDistance(b, x)
    const fa = da.value - rho
    const fb = db.value - rho
    if (Math.abs(fa) < 1e-9 * Math.max(1, rho) && Math.abs(fb) < 1e-9 * Math.max(1, rho)) return x
    const det = cross(da.gradient, db.gradient)
    if (Math.abs(det) < 1e-12) return null
    // Solve [ga; gb]·Δ = −[fa; fb].
    const dx = (-fa * db.gradient.y + fb * da.gradient.y) / det
    const dy = (-da.gradient.x * fb + db.gradient.x * fa) / det
    x = { x: x.x + dx, y: x.y + dy }
  }
  return x
}
