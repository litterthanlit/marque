import paper from 'paper'
import { inScratchScope } from '../vector/pathSerialization.ts'
import type { Contour, Segment } from '../vector/types.ts'

/**
 * The general offset: any closed contours, holes included, grown or shrunk
 * by a distance. It is for what has no exact offset (free paths, compound
 * paths, bent slabs and punches), and it runs at a commit, not on every frame.
 *
 * 1. The contours are read under their fill rule, crossings resolved, and
 *    turned so that the material lies on the left of every contour (outlines
 *    clockwise on screen, holes the other way); then flattened to lines
 *    within FLATNESS of the curves.
 * 2. The offset is every point whose distance from the shape, counted
 *    negative inside it, is at most d. That distance is read on a lattice
 *    GRID units apart, and only where the edge of the offset can pass: the
 *    distance changes no faster than the point moves, so a cell whose centre
 *    lies further from d than its half-diagonal holds none of it, and is not
 *    read finer. Where the edge crosses a lattice line, the crossing is
 *    solved from the lines and corners of the shape nearest to it, so it lies
 *    on the offset exactly; where the edge turns sharply, as where two parts
 *    of the shape are equally near, the corner is put back exactly.
 *    Nothing can fold back or fill twice: holes close, parts join and parts
 *    vanish just as the distance says.
 * 3. Each ring is fitted with curves again, as a bent groove's rails are,
 *    its sharp corners kept sharp.
 *
 * The result lies within 0.5 units of the exact offset. Pieces smaller than
 * the lattice can show, under MIN_AREA, are dropped: null when nothing is
 * left. The work grows with the length of the offset's edge, and with how
 * many lines of the shape lie within d of it.
 */

/** How far the lines may stray from the curves they stand for. */
export const FLATNESS = 0.05
/** The spacing of the lattice the distance is read on. */
const GRID = 0.5
/** The lattice is read first in cells this many spacings across, then halved where the edge may pass. */
const ROOT = 64
/** How far the fitted curves may stray from the offset lines: paper's fit reads it as a squared distance, so 0.2 units. */
const FIT_TOLERANCE = 0.04
/** A turn sharper than this at one point is a corner, kept sharp by the fit. */
const CORNER_TURN = (40 * Math.PI) / 180
/** How far the points the fit reads may stray from the traced edge. */
const THIN = 0.05
/** The longest stretch between points the fit reads, so a long line keeps straight. */
const FIT_SPACING = 2
/** Pieces smaller than this, in square units, are what an inset leaves of a vanishing part: dropped. */
const MIN_AREA = 0.5
/** The furthest the general method offsets: the work grows with the square of the distance, so further gives null. */
export const MAX_DISTANCE = 1000

interface P {
  x: number
  y: number
}

let offsetScope: paper.PaperScope | null = null

function scope(): paper.PaperScope {
  if (!offsetScope) {
    offsetScope = new paper.PaperScope()
    offsetScope.setup(new paper.Size(1, 1))
  }
  return offsetScope
}

/**
 * Closed contours grown by `d` (d > 0) or shrunk (d < 0), as contours of
 * one object: its holes stay holes, read even-odd. Open contours have no
 * inside and are left out. Null when nothing is left, or when |d| is
 * beyond MAX_DISTANCE.
 */
export function offsetContours(contours: readonly Contour[], fillRule: 'nonzero' | 'evenodd', d: number): Contour[] | null {
  const closed = contours.filter((contour) => contour.closed && contour.segments.length > 1)
  if (!closed.length || !(Math.abs(d) <= MAX_DISTANCE)) return null
  return inScratchScope(scope, (s) => {
    const rings = materialLeftRings(s, closed, closed.length > 1 ? fillRule : 'nonzero')
    if (!rings.length) return null
    if (Math.abs(d) < 1e-9) return fitAll(rings)
    const edge = offsetEdge(new Shape(rings, d), d)
    return fitAll(edge.filter((ring) => Math.abs(signedArea(ring)) >= MIN_AREA))
  })
}

/* ─── Reading the contours ─── */

/**
 * The contours as rings of points, read under the fill rule as the mark
 * fills them: crossings resolved, and edges that two contours share merged
 * away, so that two parts meeting along an edge read as one and neither is
 * taken for outside. Every outline is clockwise on screen (positive area)
 * and every hole the other way, so the material is on the left of each.
 */
function materialLeftRings(s: paper.PaperScope, contours: readonly Contour[], fillRule: 'nonzero' | 'evenodd'): P[][] {
  const raw = contours.map((contour) => {
    const path = contourPath(s, contour)
    path.flatten(FLATNESS)
    return dedupe(path.segments.map((segment) => ({ x: segment.point.x, y: segment.point.y })))
  })
  return filledRings(raw, fillRule)
}

function contourPath(s: paper.PaperScope, contour: Contour): paper.Path {
  const path = new s.Path({ insert: false })
  for (const segment of contour.segments) {
    path.add(
      new s.Segment(
        new s.Point(segment.point.x, segment.point.y),
        segment.handleIn ? new s.Point(segment.handleIn.x, segment.handleIn.y) : undefined,
        segment.handleOut ? new s.Point(segment.handleOut.x, segment.handleOut.y) : undefined,
      ),
    )
  }
  path.closed = true
  return path
}

/** How near, as a share of the shape's size (but no less than of 100 units), two points or a point and a line count as touching. */
const TOUCH = 1e-7

/** One line of a ring as read in: where others cut it, at how far along. */
interface RawLine {
  a: P
  b: P
  tx: number
  ty: number
  len: number
  cuts: Array<{ along: number; p: P }>
}

/**
 * The outline of what rings of points fill under a rule, without paper's
 * booleans, which misread contours that both share an edge and overlap:
 * every line is cut where another crosses it, ends on it or runs along it;
 * a piece is kept when the winding of the rings, read just off either side
 * of it, fills one side and not the other, and once only where several lie
 * on top of each other; it is turned so the filled side is on its left.
 * Each side is read nearer the piece than any other piece lies, so a line
 * that nearly touches it, or crosses it at a shallow angle, is not read past.
 * The pieces join end to end into rings, each turning at a point into the
 * piece that bounds the same filled corner, so parts that touch at a point
 * stay apart.
 */
export function filledRings(raw: readonly P[][], fillRule: 'nonzero' | 'evenodd'): P[][] {
  const rings = raw.filter((ring) => ring.length >= 3)
  if (!rings.length) return []
  const box = boundsOf(rings, 0)
  const tol = TOUCH * Math.max(100, box.maxX - box.minX, box.maxY - box.minY)
  const lines: RawLine[] = []
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len > 0) lines.push({ a, b, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len, len, cuts: [] })
    }
  }

  // Lines that may meet are found by a sweep across x.
  const beside = (line: RawLine, p: P) => line.tx * (p.y - line.a.y) - line.ty * (p.x - line.a.x)
  const endsOn = (line: RawLine, p: P) => {
    const along = (p.x - line.a.x) * line.tx + (p.y - line.a.y) * line.ty
    if (along > tol && along < line.len - tol && Math.abs(beside(line, p)) <= tol) line.cuts.push({ along, p })
  }
  const meet = (e: RawLine, f: RawLine) => {
    endsOn(e, f.a)
    endsOn(e, f.b)
    endsOn(f, e.a)
    endsOn(f, e.b)
    const fa = beside(e, f.a)
    const fb = beside(e, f.b)
    if (!((fa > tol && fb < -tol) || (fa < -tol && fb > tol))) return
    const ea = beside(f, e.a)
    const eb = beside(f, e.b)
    if (!((ea > tol && eb < -tol) || (ea < -tol && eb > tol))) return
    const t = ea / (ea - eb)
    const p = { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t }
    e.cuts.push({ along: t * e.len, p })
    f.cuts.push({ along: (fa / (fa - fb)) * f.len, p })
  }
  const order = lines.map((_, k) => k).sort((j, k) => Math.min(lines[j].a.x, lines[j].b.x) - Math.min(lines[k].a.x, lines[k].b.x))
  let active: number[] = []
  for (const k of order) {
    const e = lines[k]
    const left = Math.min(e.a.x, e.b.x) - tol
    const top = Math.min(e.a.y, e.b.y) - tol
    const bottom = Math.max(e.a.y, e.b.y) + tol
    active = active.filter((j) => Math.max(lines[j].a.x, lines[j].b.x) >= left)
    for (const j of active) {
      const f = lines[j]
      if (Math.max(f.a.y, f.b.y) >= top && Math.min(f.a.y, f.b.y) <= bottom) meet(f, e)
    }
    active.push(k)
  }

  // Points closer than a hair are one point: found among those filed in buckets about as many as the lines.
  const points: P[] = []
  const hair = 2 * tol
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY)
  const bucket = Math.max(4 * hair, span / Math.sqrt(lines.length + 1))
  const columns = Math.floor((box.maxX - box.minX) / bucket) + 3
  const buckets = new Map<number, number[]>()
  const pointId = (p: P): number => {
    const cx = Math.floor((p.x - box.minX) / bucket) + 1
    const cy = Math.floor((p.y - box.minY) / bucket) + 1
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of buckets.get((cy + dy) * columns + cx + dx) ?? []) {
          if (Math.abs(points[id].x - p.x) <= hair && Math.abs(points[id].y - p.y) <= hair) return id
        }
      }
    }
    const id = points.length
    points.push(p)
    const key = cy * columns + cx
    const filed = buckets.get(key)
    if (filed) filed.push(id)
    else buckets.set(key, [id])
    return id
  }

  // Every line in pieces, each running the way its line does: those on top of each other share their ends.
  const from: number[] = []
  const to: number[] = []
  for (const line of lines) {
    const stops = [pointId(line.a), ...line.cuts.sort((p, q) => p.along - q.along).map((cut) => pointId(cut.p)), pointId(line.b)]
    for (let i = 1; i < stops.length; i++) {
      if (stops[i] === stops[i - 1]) continue
      from.push(stops[i - 1])
      to.push(stops[i])
    }
  }

  // The winding of the pieces about a point, read along a ray in +x: the pieces filed in rows of y.
  const pieces = from.length
  const rowHeight = Math.max(hair, (4 * span) / Math.max(1, pieces))
  const rowOf = (y: number) => Math.floor((y - box.minY) / rowHeight)
  const rows = new Map<number, number[]>()
  for (let k = 0; k < pieces; k++) {
    const r1 = rowOf(Math.max(points[from[k]].y, points[to[k]].y))
    for (let r = rowOf(Math.min(points[from[k]].y, points[to[k]].y)); r <= r1; r++) {
      const filed = rows.get(r)
      if (filed) filed.push(k)
      else rows.set(r, [k])
    }
  }
  const winding = (x: number, y: number) => {
    let w = 0
    for (const k of rows.get(rowOf(y)) ?? []) {
      const a = points[from[k]]
      const b = points[to[k]]
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)
      if (a.y <= y) {
        if (b.y > y && side > 0) w++
      } else if (b.y <= y && side < 0) w--
    }
    return w
  }
  const fills = (x: number, y: number) => {
    const w = winding(x, y)
    return fillRule === 'nonzero' ? w !== 0 : (w & 1) === 1
  }

  // How far a point lies from the nearest piece other than those between `lo` and `hi`, looked for no further than `reach`.
  const clearance = (x: number, y: number, lo: number, hi: number, reach: number) => {
    let nearest = reach
    for (let r = rowOf(y - reach); r <= rowOf(y + reach); r++) {
      for (const k of rows.get(r) ?? []) {
        if ((from[k] === lo && to[k] === hi) || (from[k] === hi && to[k] === lo)) continue
        nearest = Math.min(nearest, distanceToPiece(points[from[k]], points[to[k]], x, y))
      }
    }
    return nearest
  }

  // A piece is kept, once, where it parts filled from empty, the filled side on its left.
  const out = new Map<number, number[]>()
  const seen = new Set<number>()
  const keptFrom: number[] = []
  const keptTo: number[] = []
  for (let k = 0; k < pieces; k++) {
    const lo = Math.min(from[k], to[k])
    const hi = Math.max(from[k], to[k])
    const key = lo * points.length + hi
    if (seen.has(key)) continue
    seen.add(key)
    const a = points[lo]
    const b = points[hi]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    // Read just off the piece, by a few hairs at most and by less than half the way to any other piece: so none is stepped over.
    const off = Math.min(len / 4, clearance(mx, my, lo, hi, 8 * tol) / 2)
    const nx = (-(b.y - a.y) / len) * off
    const ny = ((b.x - a.x) / len) * off
    const left = fills(mx + nx, my + ny)
    if (left === fills(mx - nx, my - ny)) continue
    const id = keptFrom.length
    keptFrom.push(left ? lo : hi)
    keptTo.push(left ? hi : lo)
    const leaving = out.get(keptFrom[id])
    if (leaving) leaving.push(id)
    else out.set(keptFrom[id], [id])
  }

  // Joined end to end: at a point, the piece that leaves next clockwise from the way back bounds the same filled corner.
  const heading = (id: number) => Math.atan2(points[keptTo[id]].y - points[keptFrom[id]].y, points[keptTo[id]].x - points[keptFrom[id]].x)
  const next = (id: number): number | undefined => {
    const back = heading(id) + Math.PI
    let best: number | undefined
    let bestTurn = Infinity
    for (const candidate of out.get(keptTo[id]) ?? []) {
      let turn = (((back - heading(candidate)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      if (turn <= 1e-12) turn += 2 * Math.PI
      if (turn < bestTurn) {
        bestTurn = turn
        best = candidate
      }
    }
    return best
  }
  const result: P[][] = []
  const used = new Uint8Array(keptFrom.length)
  for (let start = 0; start < keptFrom.length; start++) {
    if (used[start]) continue
    const ring: P[] = []
    let at: number | undefined = start
    while (at !== undefined && !used[at]) {
      used[at] = 1
      ring.push(points[keptFrom[at]])
      at = next(at)
    }
    // A ring that does not close is a hair's misreading: it is left out.
    if (at === start && ring.length >= 3) result.push(ring)
  }
  return result
}

/** How far a point lies from the line from `a` to `b`. */
function distanceToPiece(a: P, b: P, x: number, y: number): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy)
}

/** A ring without points on top of each other, nor its first repeated at its end. */
function dedupe(points: P[]): P[] {
  const out: P[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-7) out.push(p)
  }
  while (out.length > 1 && Math.hypot(out[0].x - out.at(-1)!.x, out[0].y - out.at(-1)!.y) <= 1e-7) out.pop()
  return out
}

function signedArea(ring: readonly P[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    area += p.x * q.y - q.x * p.y
  }
  return area / 2
}

function boundsOf(rings: readonly P[][], pad: number) {
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
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

/* ─── Measuring the shape ─── */

/** One line of a ring: from `a` along the unit `t` for `len`; `prev` and `next` are its neighbours in the ring. */
interface Line {
  a: P
  t: P
  len: number
  prev: number
  next: number
}

/**
 * What is nearest a point, and how far: `signed` is negative inside the
 * shape. A feature is a line's inside (2k, for line k) or a ring's corner
 * (2k + 1, for the corner where line k starts).
 */
interface Near {
  signed: number
  feature: number
}

/** The flattened shape, its lines filed in square buckets so that what lies near a point is found without reading them all. */
class Shape {
  readonly lines: Line[] = []
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  private readonly size: number
  private readonly columns: number
  private readonly rows: number
  private readonly starts: Int32Array
  private readonly filed: Int32Array
  private readonly seen: Int32Array
  private visit = 0
  // The lines again, flat, for the distance read in the inner loops.
  private readonly ax: Float64Array
  private readonly ay: Float64Array
  private readonly tx: Float64Array
  private readonly ty: Float64Array
  private readonly len: Float64Array
  private readonly dist: Float64Array
  /** Corners at one point, where rings touch or a ring passes twice: each corner's line, to all lines whose corners lie there. */
  private readonly twins = new Map<number, number[]>()

  constructor(rings: readonly P[][], d: number) {
    for (const ring of rings) {
      const first = this.lines.length
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % n]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        this.lines.push({ a, t: { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, len, prev: first + ((i + n - 1) % n), next: first + ((i + 1) % n) })
      }
    }
    const box = boundsOf(rings, 0)
    this.minX = box.minX
    this.minY = box.minY
    this.maxX = box.maxX
    this.maxY = box.maxY
    // Buckets about a quarter of the distance across, and no more than 400 to a side.
    this.size = Math.max(2, Math.abs(d) / 4, Math.max(box.maxX - box.minX, box.maxY - box.minY) / 400)
    this.columns = Math.floor((box.maxX - box.minX) / this.size) + 1
    this.rows = Math.floor((box.maxY - box.minY) / this.size) + 1
    const spans = this.lines.map((line) => {
      const bx = line.a.x + line.t.x * line.len
      const by = line.a.y + line.t.y * line.len
      return [this.column(Math.min(line.a.x, bx)), this.column(Math.max(line.a.x, bx)), this.row(Math.min(line.a.y, by)), this.row(Math.max(line.a.y, by))]
    })
    const counts = new Int32Array(this.columns * this.rows + 1)
    for (const [c0, c1, r0, r1] of spans) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * this.columns + c + 1]++
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    this.starts = counts
    this.filed = new Int32Array(counts[counts.length - 1])
    const fill = counts.slice(0, -1)
    spans.forEach(([c0, c1, r0, r1], k) => {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.filed[fill[r * this.columns + c]++] = k
    })
    this.seen = new Int32Array(this.lines.length)
    const n = this.lines.length
    this.ax = new Float64Array(n)
    this.ay = new Float64Array(n)
    this.tx = new Float64Array(n)
    this.ty = new Float64Array(n)
    this.len = new Float64Array(n)
    this.dist = new Float64Array(n)
    const corners = new Map<string, number[]>()
    this.lines.forEach((line, k) => {
      const key = `${line.a.x},${line.a.y}`
      const there = corners.get(key)
      if (there) there.push(k)
      else corners.set(key, [k])
    })
    for (const there of corners.values()) if (there.length > 1) for (const k of there) this.twins.set(k, there)
    this.lines.forEach((line, k) => {
      this.ax[k] = line.a.x
      this.ay[k] = line.a.y
      this.tx[k] = line.t.x
      this.ty[k] = line.t.y
      this.len[k] = line.len
    })
  }

  /** How far `p` lies from line k, and where along it the nearest point is: in `this.at`. */
  private from(k: number, x: number, y: number): number {
    const wx = x - this.ax[k]
    const wy = y - this.ay[k]
    const tx = this.tx[k]
    const ty = this.ty[k]
    let s = wx * tx + wy * ty
    if (s < 0) s = 0
    else if (s > this.len[k]) s = this.len[k]
    this.at = s
    const dx = wx - tx * s
    const dy = wy - ty * s
    return Math.sqrt(dx * dx + dy * dy)
  }

  private at = 0

  private column(x: number): number {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.minX) / this.size)))
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.size)))
  }

  /** What is nearest `p`, if anything lies within `reach` of it. */
  nearest(p: P, reach: number): Near | null {
    const visit = ++this.visit
    const col = Math.floor((p.x - this.minX) / this.size)
    const row = Math.floor((p.y - this.minY) / this.size)
    let best = reach
    let bestLine = -1
    let bestAt = 0
    const read = (bucket: number) => {
      for (let at = this.starts[bucket]; at < this.starts[bucket + 1]; at++) {
        const k = this.filed[at]
        if (this.seen[k] === visit) continue
        this.seen[k] = visit
        const dist = this.from(k, p.x, p.y)
        if (dist < best || (bestLine < 0 && dist <= best)) {
          best = dist
          bestLine = k
          bestAt = this.at
        }
      }
    }
    // Rings of buckets about p, outward, until the next lies further than the nearest line found.
    for (let ring = 0; (ring - 1) * this.size <= best; ring++) {
      const r0 = Math.max(0, row - ring)
      const r1 = Math.min(this.rows - 1, row + ring)
      const c0 = Math.max(0, col - ring)
      const c1 = Math.min(this.columns - 1, col + ring)
      for (let r = r0; r <= r1; r++) {
        if (r === row - ring || r === row + ring) {
          for (let c = c0; c <= c1; c++) read(r * this.columns + c)
        } else {
          if (col - ring >= c0) read(r * this.columns + col - ring)
          if (ring > 0 && col + ring <= c1) read(r * this.columns + col + ring)
        }
      }
      if (row - ring <= 0 && col - ring <= 0 && row + ring >= this.rows - 1 && col + ring >= this.columns - 1) break
    }
    return bestLine < 0 ? null : this.near(p, bestLine, bestAt, best)
  }

  /** The lines within `radius` of `p`. */
  within(p: P, radius: number): number[] {
    const kept: number[] = []
    const keep = (k: number) => {
      if (this.from(k, p.x, p.y) <= radius) kept.push(k)
    }
    const visit = ++this.visit
    for (let r = this.row(p.y - radius); r <= this.row(p.y + radius); r++) {
      for (let c = this.column(p.x - radius); c <= this.column(p.x + radius); c++) {
        const bucket = r * this.columns + c
        for (let at = this.starts[bucket]; at < this.starts[bucket + 1]; at++) {
          const k = this.filed[at]
          if (this.seen[k] === visit) continue
          this.seen[k] = visit
          keep(k)
        }
      }
    }
    return kept
  }

  /** What is nearest `p` among some lines only. */
  among(p: P, lines: readonly number[]): Near {
    let best = Infinity
    let bestLine = lines[0]
    let bestAt = 0
    for (let i = 0; i < lines.length; i++) {
      const k = lines[i]
      const dist = this.from(k, p.x, p.y)
      if (dist < best) {
        best = dist
        bestLine = k
        bestAt = this.at
      }
    }
    return this.near(p, bestLine, bestAt, best)
  }

  /**
   * What is nearest `p` among some lines, and those of them that lie
   * within `slack` of being as near: all that can be nearest to a point
   * within slack / 2 of p.
   */
  amongKept(p: P, lines: readonly number[], slack: number): { near: Near; kept: number[] } {
    let best = Infinity
    let bestLine = lines[0]
    let bestAt = 0
    for (let i = 0; i < lines.length; i++) {
      const k = lines[i]
      const dist = this.from(k, p.x, p.y)
      this.dist[i] = dist
      if (dist < best) {
        best = dist
        bestLine = k
        bestAt = this.at
      }
    }
    const kept: number[] = []
    for (let i = 0; i < lines.length; i++) if (this.dist[i] <= best + slack) kept.push(lines[i])
    return { near: this.near(p, bestLine, bestAt, best), kept }
  }

  /** The lines that make a feature: a line, or the two that meet at a corner. */
  linesOf(feature: number): number[] {
    const k = feature >> 1
    return feature & 1 ? [k, this.lines[k].prev] : [k]
  }

  /** Does the offset's edge pass smoothly from one feature to the other: a line and a corner at one of its ends? */
  smooth(f: number, g: number): boolean {
    if (f & 1) [f, g] = [g, f]
    if (f & 1 || !(g & 1)) return false
    const k = f >> 1
    return g >> 1 === k || g >> 1 === this.lines[k].next
  }

  private near(p: P, k: number, at: number, dist: number): Near {
    const line = this.lines[k]
    let feature = 2 * k
    if (at <= 0) feature = 2 * k + 1
    else if (at >= line.len) feature = 2 * line.next + 1
    return { signed: this.inside(p, feature) ? -dist : dist, feature }
  }

  /**
   * Is `p` inside, read from the feature nearest it: the material lies left
   * of every line. Where several corners lie at one point, p is inside when
   * it lies within any of them.
   */
  private inside(p: P, feature: number): boolean {
    const k = feature >> 1
    if (!(feature & 1)) return this.leftOf(k, k, p)
    const twins = this.twins.get(k)
    return twins ? twins.some((j) => this.withinCorner(j, p)) : this.withinCorner(k, p)
  }

  /** Is `p` left of line k, read from where line `from` starts? */
  private leftOf(k: number, from: number, p: P): boolean {
    const t = this.lines[k].t
    const a = this.lines[from].a
    return t.x * (p.y - a.y) - t.y * (p.x - a.x) > 0
  }

  /** Is `p` within the corner where line k starts: inside both lines where the ring turns left there, inside either where it turns right. */
  private withinCorner(k: number, p: P): boolean {
    const line = this.lines[k]
    const before = this.lines[line.prev]
    const turn = before.t.x * line.t.y - before.t.y * line.t.x
    return turn > 0 ? this.leftOf(line.prev, k, p) && this.leftOf(k, k, p) : this.leftOf(line.prev, k, p) || this.leftOf(k, k, p)
  }
}

/* ─── Tracing the offset's edge ─── */

/** A point of the offset's edge where it crosses a lattice line, and the feature of the shape it lies d from. */
interface Crossing {
  p: P
  feature: number
}

/**
 * The edge of the offset by `d` as rings of points, each with the offset on
 * its left: outlines turn one way and holes the other.
 *
 * Each cell carries the lines of the shape that can be nearest to any point
 * in it: those no further from its centre than the nearest is, plus its
 * diagonal. Its quarters read only those, so the fine cells along the edge
 * read a handful of lines each. A lattice point two blocks share is read by
 * each, alike: the same nearest line gives the same distance.
 */
function offsetEdge(shape: Shape, d: number): P[][] {
  const r = Math.abs(d)
  const pad = Math.max(d, 0) + 2 * GRID
  const x0 = shape.minX - pad
  const y0 = shape.minY - pad
  const rootColumns = Math.ceil((shape.maxX - shape.minX + 2 * pad) / (GRID * ROOT))
  const rootRows = Math.ceil((shape.maxY - shape.minY + 2 * pad) / (GRID * ROOT))
  const height = rootRows * ROOT + 1
  const at = (i: number, j: number): P => ({ x: x0 + i * GRID, y: y0 + j * GRID })
  const key = (i: number, j: number) => i * height + j

  const crossings = new Map<number, Crossing>()
  // Each piece of the edge runs from where it leaves the offset across a cell's side to where it next enters, the offset on its left.
  const pieces = new Map<number, { to: number; corner: P | null }>()
  // The nine lattice points of a block of four cells, and how far each lies from the shape.
  const nine: Near[] = []
  const corner = [0, 1, 4, 3]
  const block = (i: number, j: number, middle: Near, lines: readonly number[]) => {
    let below = 0
    for (let n = 0; n < 9; n++) {
      nine[n] = n === 4 ? middle : shape.among(at(i + (n % 3), j + Math.floor(n / 3)), lines)
      if (nine[n].signed - d < 0) below++
    }
    if (below === 0 || below === 9) return
    for (let cell = 0; cell < 4; cell++) {
      const ci = i + (cell & 1)
      const cj = j + (cell >> 1)
      // The cell's corners in turn, (ci, cj) first and counter-clockwise, and the lattice line from each to the next.
      const base = (cell & 1) + 3 * (cell >> 1)
      const read = corner.map((offset) => nine[base + offset])
      const inside = read.map((each) => each.signed - d < 0)
      if (inside[0] === inside[1] && inside[1] === inside[2] && inside[2] === inside[3]) continue
      const points = [
        [ci, cj],
        [ci + 1, cj],
        [ci + 1, cj + 1],
        [ci, cj + 1],
      ]
      const sideKeys = [2 * key(ci, cj), 2 * key(ci + 1, cj) + 1, 2 * key(ci, cj + 1), 2 * key(ci, cj) + 1]
      const exits: number[] = []
      const entries = new Map<number, number>()
      for (let k = 0; k < 4; k++) {
        const next = (k + 1) % 4
        if (inside[k] === inside[next]) continue
        if (!crossings.has(sideKeys[k])) {
          const [ia, ja] = points[k]
          const [ib, jb] = points[next]
          crossings.set(sideKeys[k], solveCrossing(shape, lines, at(ia, ja), read[k], at(ib, jb), read[next], d))
        }
        if (inside[k]) exits.push(k)
        else entries.set(k, sideKeys[k])
      }
      // Where all four sides are crossed, the middle of the cell says whether the offset joins across it.
      const joined = exits.length === 2 && shape.among(at(ci + 0.5, cj + 0.5), lines).signed - d < 0
      for (const k of exits) {
        const side = joined ? (k + 1) % 4 : (k + 3) % 4
        const entry = exits.length === 1 ? [...entries.values()][0] : entries.get(side)
        if (entry === undefined) continue
        pieces.set(sideKeys[k], { to: entry, corner: cornerBetween(shape, crossings.get(sideKeys[k])!, crossings.get(entry)!, d) })
      }
    }
  }

  // Cells are read finer only where the edge may pass through them, and blocks of four cells one spacing across are traced.
  const refine = (i: number, j: number, size: number, lines: readonly number[]) => {
    const half = size / 2
    const reach = size * GRID * Math.SQRT1_2
    const { near, kept } = shape.amongKept(at(i + half, j + half), lines, 2 * reach)
    if (Math.abs(near.signed - d) > reach) return
    if (size === 2) return block(i, j, near, kept)
    refine(i, j, half, kept)
    refine(i + half, j, half, kept)
    refine(i, j + half, half, kept)
    refine(i + half, j + half, half, kept)
  }
  const rootReach = ROOT * GRID * Math.SQRT1_2
  for (let i = 0; i < rootColumns; i++) {
    for (let j = 0; j < rootRows; j++) {
      const centre = at((i + 0.5) * ROOT, (j + 0.5) * ROOT)
      const near = shape.nearest(centre, r + 2 * rootReach)
      if (!near || Math.abs(near.signed - d) > rootReach) continue
      refine(i * ROOT, j * ROOT, ROOT, shape.within(centre, Math.abs(near.signed) + 2 * rootReach))
    }
  }

  const rings: P[][] = []
  const done = new Set<number>()
  for (const start of pieces.keys()) {
    if (done.has(start)) continue
    const points: Array<{ p: P; corner: boolean }> = []
    let k = start
    while (!done.has(k)) {
      done.add(k)
      const piece = pieces.get(k)
      if (!piece) break
      points.push({ p: crossings.get(k)!.p, corner: false })
      if (piece.corner) points.push({ p: piece.corner, corner: true })
      k = piece.to
    }
    if (k !== start) continue
    const ring = merged(points)
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

/**
 * Where the offset's edge crosses the lattice line from `a` to `b`, read
 * from the features nearest the two ends: in a straight line between them
 * when one line of the shape is nearest both, else solved to a hair
 * between the features, with any other of the cell's candidates found
 * nearer on the way.
 */
function solveCrossing(shape: Shape, candidates: readonly number[], a: P, nearA: Near, b: P, nearB: Near, d: number): Crossing {
  const lerp = (s: number): P => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s })
  const ga = nearA.signed - d
  if (nearA.feature === nearB.feature && !(nearA.feature & 1)) return { p: lerp(ga / (ga - (nearB.signed - d))), feature: nearA.feature }
  const lines = new Set([...shape.linesOf(nearA.feature), ...shape.linesOf(nearB.feature)])
  let found: Crossing = { p: lerp(0.5), feature: nearA.feature }
  for (let round = 0; round < 4; round++) {
    const among = [...lines]
    const p = lerp(root((s) => shape.among(lerp(s), among).signed - d, ga, nearB.signed - d))
    const local = shape.among(p, among)
    found = { p, feature: local.feature }
    const truly = shape.among(p, candidates)
    if (Math.abs(truly.signed) >= Math.abs(local.signed) - 1e-9) break
    const more = shape.linesOf(truly.feature).filter((k) => !lines.has(k))
    if (!more.length) break
    for (const k of more) lines.add(k)
  }
  return found
}

/**
 * Where `g` is 0 between 0 and 1, given its values there of opposite sign:
 * false position, kept from stalling by halving the end that stays
 * (the Illinois method). The distance is smooth but for its corners, so a
 * few steps do.
 */
function root(g: (s: number) => number, g0: number, g1: number): number {
  let lo = 0
  let hi = 1
  let glo = g0
  let ghi = g1
  let side = 0
  for (let step = 0; step < 60 && hi - lo > 1e-10; step++) {
    const s = glo === ghi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, (lo * ghi - hi * glo) / (ghi - glo)))
    const gs = g(s)
    if (gs === 0) return s
    if (gs < 0 === glo < 0) {
      lo = s
      glo = gs
      if (side === -1) ghi /= 2
      side = -1
    } else {
      hi = s
      ghi = gs
      if (side === 1) glo /= 2
      side = 1
    }
  }
  return (lo + hi) / 2
}

/**
 * The corner of the offset's edge between two crossings, when it turns
 * there: where the curves at d from their two features meet, a line beside
 * a line of the shape or a circle about a corner of it. Only a corner that
 * truly lies on the edge, with the edge running straight to it from both
 * crossings, is put back; the tip of a sliver thinner than the lattice is
 * found this way too.
 */
function cornerBetween(shape: Shape, from: Crossing, to: Crossing, d: number): P | null {
  if (from.feature === to.feature || shape.smooth(from.feature, to.feature)) return null
  const r = Math.abs(d)
  const curve = (crossing: Crossing) =>
    crossing.feature & 1 ? { centre: shape.lines[crossing.feature >> 1].a, through: crossing.p, along: null } : { centre: null, through: crossing.p, along: shape.lines[crossing.feature >> 1].t }
  const mid = { x: (from.p.x + to.p.x) / 2, y: (from.p.y + to.p.y) / 2 }
  let best: P | null = null
  for (const candidate of meet(curve(from), curve(to), r)) {
    if (!best || Math.hypot(candidate.x - mid.x, candidate.y - mid.y) < Math.hypot(best.x - mid.x, best.y - mid.y)) best = candidate
  }
  if (!best || Math.hypot(best.x - mid.x, best.y - mid.y) > 20 * GRID) return null
  if (Math.hypot(best.x - from.p.x, best.y - from.p.y) < 1e-9 || Math.hypot(best.x - to.p.x, best.y - to.p.y) < 1e-9) return null
  const onEdge = (p: P, slack: number) => {
    const near = shape.nearest(p, r + 1)
    return near !== null && Math.abs(near.signed - d) <= slack
  }
  const corner = best
  const halfway = (p: P) => ({ x: (p.x + corner.x) / 2, y: (p.y + corner.y) / 2 })
  return onEdge(corner, 1e-6 * (1 + r)) && onEdge(halfway(from.p), 0.02) && onEdge(halfway(to.p), 0.02) ? corner : null
}

/** A curve at d from a feature: the line through a point along a direction, or the circle about a corner through it. */
interface Level {
  centre: P | null
  through: P
  along: P | null
}

/** Where two such curves meet. */
function meet(f: Level, g: Level, r: number): P[] {
  if (f.along && g.along) {
    const denom = f.along.x * g.along.y - f.along.y * g.along.x
    if (Math.abs(denom) < 1e-12) return []
    const s = ((g.through.x - f.through.x) * g.along.y - (g.through.y - f.through.y) * g.along.x) / denom
    return [{ x: f.through.x + f.along.x * s, y: f.through.y + f.along.y * s }]
  }
  if (f.centre && g.centre) {
    const dx = g.centre.x - f.centre.x
    const dy = g.centre.y - f.centre.y
    const apart = Math.hypot(dx, dy)
    if (apart < 1e-12 || apart > 2 * r) return []
    const h = Math.sqrt(Math.max(0, r * r - (apart / 2) ** 2))
    const mx = f.centre.x + dx / 2
    const my = f.centre.y + dy / 2
    return [
      { x: mx - (dy / apart) * h, y: my + (dx / apart) * h },
      { x: mx + (dy / apart) * h, y: my - (dx / apart) * h },
    ]
  }
  const line = f.along ? f : g
  const circle = f.along ? g : f
  const along = line.along!
  const centre = circle.centre!
  // |through + s along - centre| = r
  const wx = line.through.x - centre.x
  const wy = line.through.y - centre.y
  const b = wx * along.x + wy * along.y
  const c = wx * wx + wy * wy - r * r
  const disc = b * b - c
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return [-b - root, -b + root].map((s) => ({ x: line.through.x + along.x * s, y: line.through.y + along.y * s }))
}

/** A traced ring without points closer than a hair: where a corner and a crossing nearly meet, the corner stays. */
function merged(points: ReadonlyArray<{ p: P; corner: boolean }>): P[] {
  const out: Array<{ p: P; corner: boolean }> = []
  for (const point of points) {
    const last = out.at(-1)
    if (last && Math.hypot(point.p.x - last.p.x, point.p.y - last.p.y) < 0.01) {
      if (point.corner && !last.corner) out[out.length - 1] = point
      continue
    }
    out.push(point)
  }
  while (out.length > 1 && Math.hypot(out[0].p.x - out.at(-1)!.p.x, out[0].p.y - out.at(-1)!.p.y) < 0.01) {
    if (out.at(-1)!.corner && !out[0].corner) out[0] = out.at(-1)!
    out.pop()
  }
  return out.map((point) => point.p)
}

/* ─── Fitting curves again ─── */

function fitAll(rings: P[][]): Contour[] | null {
  const contours = rings.map(fitRing).filter((contour): contour is Contour => contour !== null)
  return contours.length ? contours : null
}

/**
 * A ring of points as a contour of curves. Its sharp corners stay sharp
 * points; each run between two is fitted on its own, a straight run as one
 * line.
 */
function fitRing(ring: P[]): Contour | null {
  const n = ring.length
  if (n < 3) return null
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]
    const p = ring[i]
    const next = ring[(i + 1) % n]
    const ax = p.x - prev.x
    const ay = p.y - prev.y
    const bx = next.x - p.x
    const by = next.y - p.y
    if (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) > CORNER_TURN) corners.push(i)
  }
  // A ring with no corner is fitted in two halves: paper fits a closed run poorly where it closes.
  if (!corners.length) corners.push(0, Math.floor(n / 2))
  const runs = corners.map((from, k) => {
    const to = corners[(k + 1) % corners.length]
    const run: P[] = [ring[from]]
    for (let i = (from + 1) % n; ; i = (i + 1) % n) {
      run.push(ring[i])
      if (i === to) break
    }
    return fitRun(run)
  })
  // Each corner leaves on its own run and takes its handle in from the run before it.
  const segments: Segment[] = []
  runs.forEach((run, k) => {
    const before = runs[(k + runs.length - 1) % runs.length]
    segments.push({ ...run[0], handleIn: before.at(-1)!.handleIn }, ...run.slice(1, -1))
  })
  return { closed: true, segments }
}

/** Is every point of a run within a hair of the line from its first point to its last? */
function isStraight(run: readonly P[]): boolean {
  const a = run[0]
  const b = run.at(-1)!
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-9) return false
  return run.every((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len <= 0.01)
}

/**
 * Points along a run as segments with handles relative to their points: the
 * run's first and last points are the first and last segments.
 */
function fitRun(run: P[]): Segment[] {
  if (run.length === 2 || isStraight(run)) {
    return [run[0], run.at(-1)!].map((p) => ({ point: { x: p.x, y: p.y }, handleIn: null, handleOut: null }))
  }
  const dense = resample(thinned(run, THIN))
  const s = scope()
  const path = new s.Path({ segments: dense.map((p) => [p.x, p.y]), insert: false })
  path.simplify(FIT_TOLERANCE)
  const segments = path.segments.map(
    (segment): Segment => ({
      point: { x: segment.point.x, y: segment.point.y },
      handleIn: segment.handleIn.isZero() ? null : { x: segment.handleIn.x, y: segment.handleIn.y },
      handleOut: segment.handleOut.isZero() ? null : { x: segment.handleOut.x, y: segment.handleOut.y },
    }),
  )
  path.remove()
  // The ends are the corners themselves: exactly where the run put them.
  segments[0].point = { ...run[0] }
  segments[segments.length - 1].point = { ...run.at(-1)! }
  return segments
}

/** A run with only the points it needs to stay within `tolerance` of itself: the fit is slow on dense points. */
function thinned(run: readonly P[], tolerance: number): P[] {
  const keep = new Uint8Array(run.length)
  keep[0] = 1
  keep[run.length - 1] = 1
  const stack: Array<[number, number]> = [[0, run.length - 1]]
  while (stack.length) {
    const [from, to] = stack.pop()!
    const a = run[from]
    const b = run[to]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    let worst = -1
    let at = -1
    for (let i = from + 1; i < to; i++) {
      const p = run[i]
      const off = len > 1e-12 ? Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len : Math.hypot(p.x - a.x, p.y - a.y)
      if (off > worst) {
        worst = off
        at = i
      }
    }
    if (worst > tolerance) {
      keep[at] = 1
      stack.push([from, at], [at, to])
    }
  }
  return run.filter((_, i) => keep[i])
}

/** A run with points added along its long lines, so no stretch is longer than FIT_SPACING. */
function resample(run: readonly P[]): P[] {
  const out: P[] = [run[0]]
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]
    const b = run[i]
    const pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / FIT_SPACING)
    for (let k = 1; k < pieces; k++) out.push({ x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces })
    out.push(b)
  }
  return out
}
