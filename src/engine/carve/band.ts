import { add, cubicPoint, distance, dot, scale, sub, type Cubic, type Vec } from '../path/bezier.ts'
import { arcToCubics } from '../path/arc.ts'
import { bandSettings, type BandEnd, type BandSpec } from './spec.ts'

/**
 * Bands as geometry: the outline of each fit, the points where it touches
 * its circles, and its two edges. Everything here is pure, in layer space,
 * and reads only the recipe, whose ends are snapshots of the circles.
 *
 * With d the distance between the centres and u the unit vector from a to b:
 *
 * - belt: the outer tangents. With cos φ = (r_a − r_b)/d the normals are
 *   n± = cos φ·u ± sin φ·u⊥, touching at c + r·n±. The outline is a tangent,
 *   the far arc on b, the other tangent and the far arc on a. It needs
 *   d > |r_a − r_b|: one circle inside the other has no outer tangents.
 * - bar: a channel of the width from centre to centre, half circles at each
 *   centre, as the channel recipe draws one. It needs the centres apart.
 * - strip: edges at the angle θ, normal n = (−sin θ, cos θ). The first lies
 *   on a's side `side`, at n·x = n·c_a + side·r_a; the second on b's other
 *   side, at n·x = n·c_b − side·r_b. Its ends run through the centres at
 *   right angles to θ, so it is the rectangle between those four lines. It
 *   needs each edge to cross the other circle, so its ends stay inside the
 *   circles, and the edges in the order the side gives, so it has a width.
 * - neck: two concave arcs of radius ρ, each touching both circles from
 *   outside. Their centres are where the circles of radius r_a + ρ and
 *   r_b + ρ about the centres meet. The outline runs along one arc, across
 *   b by a chord between the arcs' touch points, back along the other arc
 *   and across a: the chords lie inside the circles, so the neck unites
 *   with them cleanly. It needs those circles to meet, and the arcs not to
 *   cross the line between the centres.
 */

const EPS = 1e-6
const TAU = Math.PI * 2

/**
 * A straight piece, or an arc from angle `start` through `sweep` (radians,
 * positive clockwise on screen). `inside` marks a part that only closes the
 * outline within a circle (a bar's cap, a strip's end, a neck's chord): the
 * construction look leaves it out, as the sheets do.
 */
export type BandPart = ({ kind: 'segment'; a: Vec; b: Vec } | { kind: 'arc'; c: Vec; r: number; start: number; sweep: number }) & { inside?: true }

/** A band's edge as a construction line: an infinite line through `p` at `angle` degrees, or a circle. */
export type BandEdge = { kind: 'line'; p: Vec; angle: number } | { kind: 'circle'; c: Vec; r: number }

export interface BandParts {
  /** The outline, in order and turning clockwise on screen. */
  parts: BandPart[]
  /** Where it touches its circles: a belt's four tangent points, a strip's two, a neck's four. */
  touches: Vec[]
  /** Its two edges: a belt's tangents, a bar's or strip's sides, a neck's arc circles. */
  edges: [BandEdge, BandEdge]
  /** How wide it is: a bar's width, a strip's distance between its edges, a neck's waist, a belt's wider circle across. */
  width: number
  /** Circles the construction look draws: a neck's arcs, whole. */
  circles: Array<{ c: Vec; r: number }>
}

const perpOf = (u: Vec): Vec => ({ x: -u.y, y: u.x })
const angleOf = (v: Vec): number => Math.atan2(v.y, v.x)
const degrees = (radians: number): number => (radians * 180) / Math.PI

/** `b − a` folded into (−π, π]. */
function turn(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d <= -Math.PI) d += TAU
  if (d > Math.PI) d -= TAU
  return d
}

/** Does the arc from `start` through `sweep` reach the direction `angle`? */
function onArc(start: number, sweep: number, angle: number): boolean {
  const along = turn(start, angle)
  return sweep >= 0 ? along >= -1e-12 && along <= sweep + 1e-12 : along <= 1e-12 && along >= sweep - 1e-12
}

/**
 * The parts of a band, or null when its circles allow none: nested circles
 * for a belt or a neck, centres together for a bar, edges that cross or miss
 * for a strip, circles too far apart for a neck's arcs to reach both. Kept
 * per recipe, which is immutable once stored.
 */
export function bandParts(spec: BandSpec): BandParts | null {
  const cached = cache.get(spec)
  if (cached !== undefined) return cached
  const parts = buildParts(spec)
  cache.set(spec, parts)
  return parts
}

const cache = new WeakMap<BandSpec, BandParts | null>()

function buildParts(spec: BandSpec): BandParts | null {
  const { a, b } = spec
  if (!(a.r > 0) || !(b.r > 0)) return null
  const settings = bandSettings(spec)
  switch (spec.fit) {
    case 'belt':
      return belt(a, b)
    case 'bar':
      return bar(a, b, settings.width)
    case 'strip':
      return strip(a, b, settings.angle, settings.side)
    case 'neck':
      return neck(a, b, settings.radius)
    default:
      return spec.fit satisfies never
  }
}

/** How wide a band is (see BandParts.width), or null when its circles allow none. */
export function bandWidth(spec: BandSpec): number | null {
  return bandParts(spec)?.width ?? null
}

function belt(a: BandEnd, b: BandEnd): BandParts | null {
  const d = distance(a.c, b.c)
  if (d <= Math.abs(a.r - b.r) + EPS) return null
  const u = scale(sub(b.c, a.c), 1 / d)
  const cos = (a.r - b.r) / d
  const phi = Math.acos(Math.max(-1, Math.min(1, cos)))
  const base = angleOf(u)
  // n₂ at base − φ, n₁ at base + φ.
  const n1 = { x: Math.cos(base + phi), y: Math.sin(base + phi) }
  const n2 = { x: Math.cos(base - phi), y: Math.sin(base - phi) }
  const a1 = add(a.c, scale(n1, a.r))
  const b1 = add(b.c, scale(n1, b.r))
  const a2 = add(a.c, scale(n2, a.r))
  const b2 = add(b.c, scale(n2, b.r))
  const parts: BandPart[] = [
    { kind: 'segment', a: a2, b: b2 },
    { kind: 'arc', c: b.c, r: b.r, start: base - phi, sweep: 2 * phi },
    { kind: 'segment', a: b1, b: a1 },
    { kind: 'arc', c: a.c, r: a.r, start: base + phi, sweep: TAU - 2 * phi },
  ]
  return {
    parts: clockwise(parts),
    touches: [a2, b2, b1, a1],
    edges: [
      { kind: 'line', p: a2, angle: degrees(angleOf(sub(b2, a2))) },
      { kind: 'line', p: a1, angle: degrees(angleOf(sub(b1, a1))) },
    ],
    width: 2 * Math.max(a.r, b.r),
    circles: [],
  }
}

function bar(a: BandEnd, b: BandEnd, width: number): BandParts | null {
  const d = distance(a.c, b.c)
  if (d <= EPS || !(width > 0)) return null
  const u = scale(sub(b.c, a.c), 1 / d)
  const base = angleOf(u)
  const half = width / 2
  // n at base − 90°: the side a channel calls its left.
  const n = { x: u.y, y: -u.x }
  const parts: BandPart[] = [
    { kind: 'segment', a: add(a.c, scale(n, half)), b: add(b.c, scale(n, half)) },
    { kind: 'arc', c: b.c, r: half, start: base - Math.PI / 2, sweep: Math.PI, inside: true },
    { kind: 'segment', a: sub(b.c, scale(n, half)), b: sub(a.c, scale(n, half)) },
    { kind: 'arc', c: a.c, r: half, start: base + Math.PI / 2, sweep: Math.PI, inside: true },
  ]
  return {
    parts: clockwise(parts),
    touches: [],
    edges: [
      { kind: 'line', p: add(a.c, scale(n, half)), angle: degrees(base) },
      { kind: 'line', p: sub(a.c, scale(n, half)), angle: degrees(base) },
    ],
    width,
    circles: [],
  }
}

/** Where a strip's lines lie: along t from the ends `sa`, `sb`, across n from the edges `oa`, `ob`. */
export function stripLines(a: BandEnd, b: BandEnd, angle: number, side: 1 | -1): { t: Vec; n: Vec; sa: number; sb: number; oa: number; ob: number } {
  const theta = (angle * Math.PI) / 180
  const t = { x: Math.cos(theta), y: Math.sin(theta) }
  const n = { x: -Math.sin(theta), y: Math.cos(theta) }
  return { t, n, sa: dot(t, a.c), sb: dot(t, b.c), oa: dot(n, a.c) + side * a.r, ob: dot(n, b.c) - side * b.r }
}

function strip(a: BandEnd, b: BandEnd, angle: number, side: 1 | -1): BandParts | null {
  const { t, n, sa, sb, oa, ob } = stripLines(a, b, angle, side)
  const width = side * (oa - ob)
  // Each edge must cross the other circle, so the ends stay inside the circles; and in order, so the strip has a width.
  if (Math.abs(sb - sa) <= EPS || width <= EPS) return null
  if (Math.abs(ob - dot(n, a.c)) > a.r + EPS || Math.abs(oa - dot(n, b.c)) > b.r + EPS) return null
  const at = (s: number, o: number): Vec => add(scale(t, s), scale(n, o))
  const touchA = at(sa, oa)
  const touchB = at(sb, ob)
  const parts: BandPart[] = [
    { kind: 'segment', a: touchA, b: at(sb, oa) },
    { kind: 'segment', a: at(sb, oa), b: touchB, inside: true },
    { kind: 'segment', a: touchB, b: at(sa, ob) },
    { kind: 'segment', a: at(sa, ob), b: touchA, inside: true },
  ]
  return {
    parts: clockwise(parts),
    touches: [touchA, touchB],
    edges: [
      { kind: 'line', p: touchA, angle },
      { kind: 'line', p: touchB, angle },
    ],
    width,
    circles: [],
  }
}

/** Where a neck's arcs are centred: where the circles r_a + ρ and r_b + ρ about the centres meet. Null when they do not. */
export function neckCentres(a: BandEnd, b: BandEnd, rho: number): [Vec, Vec] | null {
  const d = distance(a.c, b.c)
  const ra = a.r + rho
  const rb = b.r + rho
  if (!(rho > 0) || d <= Math.abs(ra - rb) + EPS || d >= ra + rb - EPS) return null
  const u = scale(sub(b.c, a.c), 1 / d)
  const along = (d * d + ra * ra - rb * rb) / (2 * d)
  const h = Math.sqrt(Math.max(0, ra * ra - along * along))
  const foot = add(a.c, scale(u, along))
  const perp = perpOf(u)
  return [add(foot, scale(perp, h)), sub(foot, scale(perp, h))]
}

function neck(a: BandEnd, b: BandEnd, rho: number): BandParts | null {
  const centres = neckCentres(a, b, rho)
  if (!centres) return null
  const d = distance(a.c, b.c)
  const u = scale(sub(b.c, a.c), 1 / d)
  const perp = perpOf(u)
  const touch = (end: BandEnd, p: Vec) => add(end.c, scale(sub(p, end.c), end.r / (end.r + rho)))
  // Each arc runs the short way between its touch points: towards the line between the centres.
  const arcs = centres.map((p) => {
    const ta = touch(a, p)
    const tb = touch(b, p)
    const start = angleOf(sub(ta, p))
    return { p, ta, tb, start, sweep: turn(start, angleOf(sub(tb, p))) }
  })
  // The arcs must not reach the line between the centres, or they would cross: the neck needs a waist.
  let waist = Infinity
  for (const arc of arcs) {
    const away = Math.abs(dot(sub(arc.p, a.c), perp))
    const towards = angleOf(scale(perp, -Math.sign(dot(sub(arc.p, a.c), perp))))
    const reaches = onArc(arc.start, arc.sweep, towards)
    const nearest = reaches ? away - rho : Math.min(Math.abs(dot(sub(arc.ta, a.c), perp)), Math.abs(dot(sub(arc.tb, a.c), perp)))
    waist = Math.min(waist, nearest)
  }
  if (waist <= EPS) return null
  const [one, two] = arcs
  const parts: BandPart[] = [
    { kind: 'arc', c: one.p, r: rho, start: one.start, sweep: one.sweep },
    { kind: 'segment', a: one.tb, b: two.tb, inside: true },
    { kind: 'arc', c: two.p, r: rho, start: two.start + two.sweep, sweep: -two.sweep },
    { kind: 'segment', a: two.ta, b: one.ta, inside: true },
  ]
  return {
    parts: clockwise(parts),
    touches: [one.ta, one.tb, two.tb, two.ta],
    edges: [
      { kind: 'circle', c: one.p, r: rho },
      { kind: 'circle', c: two.p, r: rho },
    ],
    width: 2 * waist,
    circles: [
      { c: one.p, r: rho },
      { c: two.p, r: rho },
    ],
  }
}

/** Where a part starts and ends. */
export function partEnds(part: BandPart): [Vec, Vec] {
  if (part.kind === 'segment') return [part.a, part.b]
  const at = (angle: number) => add(part.c, { x: Math.cos(angle) * part.r, y: Math.sin(angle) * part.r })
  return [at(part.start), at(part.start + part.sweep)]
}

/** A part as cubics: a straight one, or an arc in pieces of at most 90°, its ends exactly where `from` and `to` say. */
export function partCubics(part: BandPart, from: Vec, to: Vec): Cubic[] {
  if (part.kind === 'segment') return [[from, from, to, to]]
  const cubics = arcToCubics(part.c, part.r, part.start, part.sweep)
  if (!cubics.length) return []
  cubics[0] = [from, cubics[0][1], cubics[0][2], cubics[0][3]]
  const last = cubics.length - 1
  cubics[last] = [cubics[last][0], cubics[last][1], cubics[last][2], to]
  return cubics
}

/** The parts turned to run clockwise on screen, as every recipe's outline does. */
function clockwise(parts: BandPart[]): BandPart[] {
  if (signedArea(parts) >= 0) return parts
  return parts
    .slice()
    .reverse()
    .map((part): BandPart => (part.kind === 'segment' ? { ...part, a: part.b, b: part.a } : { ...part, start: part.start + part.sweep, sweep: -part.sweep }))
}

/** Twice the area the parts enclose, positive when they run clockwise on screen (y down). */
function signedArea(parts: BandPart[]): number {
  const points: Vec[] = []
  for (const part of parts) {
    const [from, to] = partEnds(part)
    for (const cubic of partCubics(part, from, to)) for (let i = 0; i < 8; i++) points.push(cubicPoint(cubic, i / 8))
  }
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    sum += p.x * q.y - q.x * p.y
  }
  return sum
}
