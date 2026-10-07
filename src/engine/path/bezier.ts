/**
 * Small, dependency-free vector and cubic Bézier helpers. Everything here is
 * pure so the editing engine can be unit-tested without a canvas.
 */

export interface Vec {
  x: number
  y: number
}

/** A cubic Bézier as its four control points: start, handle, handle, end. */
export type Cubic = readonly [Vec, Vec, Vec, Vec]

export const vec = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x
export const length = (a: Vec): number => Math.hypot(a.x, a.y)
export const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export function normalize(a: Vec, fallback: Vec = { x: 1, y: 0 }): Vec {
  const len = length(a)
  return len > 1e-9 ? { x: a.x / len, y: a.y / len } : fallback
}

/** Rotate by `deg` degrees. Same convention as paper.js: clockwise on a y-down screen. */
export function rotate(a: Vec, deg: number): Vec {
  if (deg === 0) return a
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export function rotateAbout(p: Vec, pivot: Vec, deg: number): Vec {
  return add(pivot, rotate(sub(p, pivot), deg))
}

/** Normalise an angle in degrees to (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360
  if (d <= -180) d += 360
  if (d > 180) d -= 360
  return d
}

export function cubicPoint(c: Cubic, t: number): Vec {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const d = 3 * mt * t * t
  const e = t * t * t
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  }
}

/** First derivative. */
export function cubicDerivative(c: Cubic, t: number): Vec {
  const mt = 1 - t
  const a = 3 * mt * mt
  const b = 6 * mt * t
  const d = 3 * t * t
  return {
    x: a * (c[1].x - c[0].x) + b * (c[2].x - c[1].x) + d * (c[3].x - c[2].x),
    y: a * (c[1].y - c[0].y) + b * (c[2].y - c[1].y) + d * (c[3].y - c[2].y),
  }
}

function cubicSecondDerivative(c: Cubic, t: number): Vec {
  const mt = 1 - t
  return {
    x: 6 * mt * (c[2].x - 2 * c[1].x + c[0].x) + 6 * t * (c[3].x - 2 * c[2].x + c[1].x),
    y: 6 * mt * (c[2].y - 2 * c[1].y + c[0].y) + 6 * t * (c[3].y - 2 * c[2].y + c[1].y),
  }
}

/** Unit tangent; falls back to the chord, then to +x, when the derivative vanishes. */
export function cubicTangent(c: Cubic, t: number): Vec {
  const d = cubicDerivative(c, t)
  if (length(d) > 1e-9) return normalize(d)
  return normalize(sub(c[3], c[0]))
}

/** A straight segment as a cubic with handles at a third and two thirds. */
export function straightCubic(p0: Vec, p3: Vec): Cubic {
  return [p0, lerp(p0, p3, 1 / 3), lerp(p0, p3, 2 / 3), p3]
}

/** Grabbing a curve too close to an end makes the handles explode; keep t inside. */
export const BEND_T_MIN = 0.1
export const BEND_T_MAX = 0.9

/**
 * Move the two handles of `c` so that the curve passes exactly through
 * `target` at parameter `t` (clamped to [0.1, 0.9]).
 *
 * B(t) is linear in P1 and P2 with weights b1 = 3(1−t)²t and b2 = 3(1−t)t².
 * Splitting the offset Δ between them as Δ(1−t)s and Δt·s, with
 * s = 1 / (b1(1−t) + b2·t), moves B(t) by exactly Δ — the end the pointer is
 * nearer to moves more, which is what a hand expects.
 */
export function solveBend(c: Cubic, t: number, target: Vec): Cubic {
  const tt = clamp(t, BEND_T_MIN, BEND_T_MAX)
  const delta = sub(target, cubicPoint(c, tt))
  const mt = 1 - tt
  const b1 = 3 * mt * mt * tt
  const b2 = 3 * mt * tt * tt
  const s = 1 / (b1 * mt + b2 * tt)
  return [c[0], add(c[1], scale(delta, mt * s)), add(c[2], scale(delta, tt * s)), c[3]]
}

/** Nearest point on a cubic: coarse sampling, then a few Newton steps. */
export function projectOnCubic(c: Cubic, p: Vec): { t: number; point: Vec; distance: number } {
  const samples = 48
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const d = distance(cubicPoint(c, t), p)
    if (d < bestD) {
      bestD = d
      bestT = t
    }
  }
  let t = bestT
  for (let i = 0; i < 8; i++) {
    const q = sub(cubicPoint(c, t), p)
    const d1 = cubicDerivative(c, t)
    const d2 = cubicSecondDerivative(c, t)
    const f = dot(q, d1)
    const fp = dot(d1, d1) + dot(q, d2)
    if (Math.abs(fp) < 1e-12) break
    const next = clamp(t - f / fp, 0, 1)
    if (Math.abs(next - t) < 1e-9) {
      t = next
      break
    }
    t = next
  }
  // At an end whose handle sits on its point the curve has no speed, and Newton's method stays put: the samples about it are searched instead.
  if (t === 0 || t === 1) t = goldenSearch(c, p, Math.max(0, bestT - 1 / samples), Math.min(1, bestT + 1 / samples))
  const point = cubicPoint(c, t)
  const d = distance(point, p)
  return d <= bestD ? { t, point, distance: d } : { t: bestT, point: cubicPoint(c, bestT), distance: bestD }
}

/** The parameter in [lo, hi] of the point nearest `p`, by golden-section search: the distance has one low there. */
function goldenSearch(c: Cubic, p: Vec, lo: number, hi: number): number {
  const ratio = (Math.sqrt(5) - 1) / 2
  let a = lo
  let b = hi
  let x1 = b - ratio * (b - a)
  let x2 = a + ratio * (b - a)
  let f1 = distance(cubicPoint(c, x1), p)
  let f2 = distance(cubicPoint(c, x2), p)
  for (let i = 0; i < 40 && b - a > 1e-10; i++) {
    if (f1 <= f2) {
      b = x2
      x2 = x1
      f2 = f1
      x1 = b - ratio * (b - a)
      f1 = distance(cubicPoint(c, x1), p)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = a + ratio * (b - a)
      f2 = distance(cubicPoint(c, x2), p)
    }
  }
  const mid = (a + b) / 2
  // The search never quite reaches an end: an end nearer than where it settled is taken.
  return [lo, hi, mid].reduce((best, each) => (distance(cubicPoint(c, each), p) < distance(cubicPoint(c, best), p) ? each : best))
}

/** de Casteljau split at t. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t)
  const p12 = lerp(c[1], c[2], t)
  const p23 = lerp(c[2], c[3], t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const mid = lerp(p012, p123, t)
  return [
    [c[0], p01, p012, mid],
    [mid, p123, p23, c[3]],
  ]
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

export function includePoint(b: Bounds, p: Vec): void {
  if (p.x < b.minX) b.minX = p.x
  if (p.y < b.minY) b.minY = p.y
  if (p.x > b.maxX) b.maxX = p.x
  if (p.y > b.maxY) b.maxY = p.y
}

/** Tight bounds of a cubic: its end points plus the extrema of each axis. */
export function includeCubic(b: Bounds, c: Cubic): void {
  includePoint(b, c[0])
  includePoint(b, c[3])
  for (const axis of ['x', 'y'] as const) {
    const p0 = c[0][axis]
    const p1 = c[1][axis]
    const p2 = c[2][axis]
    const p3 = c[3][axis]
    // B'(t)/3 = a t² + b t + k
    const a = -p0 + 3 * p1 - 3 * p2 + p3
    const bq = 2 * (p0 - 2 * p1 + p2)
    const k = p1 - p0
    const roots: number[] = []
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(bq) > 1e-12) roots.push(-k / bq)
    } else {
      const disc = bq * bq - 4 * a * k
      if (disc >= 0) {
        const sq = Math.sqrt(disc)
        roots.push((-bq + sq) / (2 * a), (-bq - sq) / (2 * a))
      }
    }
    for (const r of roots) {
      if (r > 0 && r < 1) includePoint(b, cubicPoint(c, r))
    }
  }
}

export function boundsCenter(b: Bounds): Vec {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/** Largest distance of a cubic from its chord, sampled. Used for "is this straight?". */
export function maxChordDeviation(c: Cubic): number {
  const chord = sub(c[3], c[0])
  const len = length(chord)
  let max = 0
  for (let i = 1; i < 16; i++) {
    const p = cubicPoint(c, i / 16)
    const d = len > 1e-9 ? Math.abs(cross(chord, sub(p, c[0]))) / len : distance(p, c[0])
    if (d > max) max = d
  }
  return max
}

/** Approximate arc length by sampling. */
export function cubicLength(c: Cubic, steps = 32): number {
  let total = 0
  let prev = c[0]
  for (let i = 1; i <= steps; i++) {
    const p = cubicPoint(c, i / steps)
    total += distance(prev, p)
    prev = p
  }
  return total
}
