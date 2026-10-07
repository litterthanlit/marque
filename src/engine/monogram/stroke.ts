import { add, cross, distance, dot, emptyBounds, includeCubic, includePoint, normalize, scale, sub, type Bounds, type Vec } from '../path/bezier.ts'

/**
 * Strokes as ink: a centreline of lines and circular arcs, given a width,
 * turned into closed outlines. Each piece of a centreline becomes one
 * outline, so no outline has a hole and the pieces unite into the stroke.
 * Everything here is pure and works in the units the centreline is drawn in.
 *
 * - Width follows the direction of travel: a vertical stroke is `vertical`
 *   wide, a horizontal one `horizontal`, and between them it goes with the
 *   square of the sine, w = h + (v − h)·d_y². Along an arc it changes as the
 *   arc turns, as a broad pen held level would draw it.
 * - Where two pieces meet at an angle, the outer side of the corner is
 *   filled by a wedge split along the line from the corner to its tip, half
 *   to each piece: a miter (the edges carried on until they meet), a bevel
 *   (the edges' ends joined), or a round (an arc about the corner). A miter
 *   reaching further than MITER_LIMIT half-widths becomes a bevel. On the
 *   inner side the pieces simply overlap.
 * - Mitered corners on a cap line or baseline are cut flat at the ink line,
 *   half a horizontal stroke beyond it, whatever the limit, so that an apex
 *   and a foot sit where the bars do. Free ends there that are not
 *   horizontal are cut flat to the same line, or pulled back so a round cap
 *   reaches it.
 * - Ends marked as tees stop square at the point given: they finish inside
 *   another stroke and are never seen.
 */

/** A piece of centreline: a line, or an arc from angle `start` through `sweep` (radians, positive clockwise on screen). */
export type Piece =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'arc'; c: Vec; r: number; start: number; sweep: number }

/** A run of pieces, each starting where the last ends. A closed run also joins its last piece to its first. */
export interface Skeleton {
  pieces: Piece[]
  closed: boolean
  /** An end that finishes inside another stroke. */
  tee: { start: boolean; end: boolean }
}

export type CornerStyle = 'miter' | 'bevel' | 'round'

export interface StrokeStyle {
  vertical: number
  horizontal: number
  corners: CornerStyle
  /** The cap line and baseline of the centreline, where corners and free ends are cut flat. */
  lines?: { top: number; bottom: number }
}

export type OutlineStep = { kind: 'line'; to: Vec } | { kind: 'cubic'; c1: Vec; c2: Vec; to: Vec }

/** A closed outline: a start and the steps back round to it. */
export interface Outline {
  start: Vec
  steps: OutlineStep[]
}

/** How many half-widths a miter may reach from its corner before it is beveled. */
export const MITER_LIMIT = 2
/** Directions closer than this (as the sine of the angle between them) meet smoothly. */
const SMOOTH = 1e-4
/** How near a point must be to a cap line or baseline to count as on it. */
const ON_LINE = 1e-6
/** A free end whose direction rises by more than this (as a sine) is not horizontal. */
const STEEP = 0.2
/** The largest turn one cubic of an outline stands for. */
const EIGHTH = Math.PI / 4

const leftOf = (d: Vec): Vec => ({ x: -d.y, y: d.x })
const angleOf = (v: Vec): number => Math.atan2(v.y, v.x)
const polar = (c: Vec, r: number, a: number): Vec => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })

export function pieceStart(piece: Piece): Vec {
  return piece.kind === 'line' ? piece.a : polar(piece.c, piece.r, piece.start)
}

export function pieceEnd(piece: Piece): Vec {
  return piece.kind === 'line' ? piece.b : polar(piece.c, piece.r, piece.start + piece.sweep)
}

export function piecePoint(piece: Piece, t: number): Vec {
  if (piece.kind === 'line') return add(piece.a, scale(sub(piece.b, piece.a), t))
  return polar(piece.c, piece.r, piece.start + piece.sweep * t)
}

/** The unit direction of travel at `t`. */
export function pieceTangent(piece: Piece, t: number): Vec {
  if (piece.kind === 'line') return normalize(sub(piece.b, piece.a))
  const a = piece.start + piece.sweep * t
  const s = Math.sign(piece.sweep)
  return { x: -Math.sin(a) * s, y: Math.cos(a) * s }
}

export function pieceLength(piece: Piece): number {
  return piece.kind === 'line' ? distance(piece.a, piece.b) : Math.abs(piece.sweep) * piece.r
}

/** How wide a stroke travelling in direction `d` is. */
export function widthAlong(style: Pick<StrokeStyle, 'vertical' | 'horizontal'>, d: Vec): number {
  return style.horizontal + (style.vertical - style.horizontal) * d.y * d.y
}

/* ─── Writing outlines ─── */

/** A point on a chain, with where it lies about a centre when the step to the next point is an arc. */
interface Node {
  p: Vec
  arc?: { c: Vec; a: number; r: number }
}

class OutlineWriter {
  readonly steps: OutlineStep[] = []
  readonly start: Vec

  constructor(start: Vec) {
    this.start = start
  }

  line(to: Vec): void {
    this.steps.push({ kind: 'line', to })
  }

  /**
   * A smooth run along f from u0 to u1, turning through `turn`, as cubics
   * through points on it whose handles follow its derivative. Each cubic
   * turns at most an eighth of a circle, and its handles are lengthened from
   * the Hermite third to what a circular arc of that turn needs, so it stays
   * within a hair of the curve.
   */
  curve(f: (u: number) => Vec, u0: number, u1: number, turn: number): void {
    const count = Math.max(1, Math.ceil(Math.abs(turn) / EIGHTH - 1e-9))
    const step = Math.abs(turn) / count
    const circular = step > 1e-9 ? (4 * Math.tan(step / 4)) / step : 1
    const h = 1e-5
    const derivative = (u: number) => scale(sub(f(u + h), f(u - h)), 1 / (2 * h))
    for (let i = 0; i < count; i++) {
      const a = u0 + ((u1 - u0) * i) / count
      const b = u0 + ((u1 - u0) * (i + 1)) / count
      const span = ((b - a) / 3) * circular
      const pa = f(a)
      const pb = f(b)
      this.steps.push({
        kind: 'cubic',
        c1: add(pa, scale(derivative(a), span)),
        c2: sub(pb, scale(derivative(b), span)),
        to: pb,
      })
    }
  }

  /** Through a chain's nodes after the first: straight, or about a centre with the radius eased from one node's to the next. */
  chain(nodes: readonly Node[]): void {
    for (let i = 1; i < nodes.length; i++) {
      const from = nodes[i - 1].arc
      const to = nodes[i].arc
      if (from && to && from.c === to.c) {
        this.curve(
          (u) => polar(from.c, from.r + (to.r - from.r) * u, from.a + (to.a - from.a) * u),
          0,
          1,
          to.a - from.a,
        )
      } else {
        this.line(nodes[i].p)
      }
    }
  }
}

/* ─── Ends and corners ─── */

/**
 * How a piece finishes at one end, as the chain across it from its left
 * edge to its right (left and right as it travels). The first node is where
 * its left edge stops, the last where its right edge does.
 */
type Finish = Node[]

interface Ink {
  /** The ink line beyond a cap line or baseline. */
  y: number
  /** +1 where beyond is downward (the baseline), −1 where upward (the cap line). */
  beyond: 1 | -1
}

function inkAt(style: StrokeStyle, p: Vec): Ink | null {
  if (!style.lines) return null
  if (Math.abs(p.y - style.lines.top) < ON_LINE) return { y: style.lines.top - style.horizontal / 2, beyond: -1 }
  if (Math.abs(p.y - style.lines.bottom) < ON_LINE) return { y: style.lines.bottom + style.horizontal / 2, beyond: 1 }
  return null
}

const isBeyond = (ink: Ink, p: Vec) => (p.y - ink.y) * ink.beyond > 1e-9

function lineMeets(p: Vec, d: Vec, q: Vec, e: Vec): Vec | null {
  const denominator = cross(d, e)
  if (Math.abs(denominator) < 1e-9) return null
  return add(p, scale(d, cross(sub(q, p), e) / denominator))
}

/** Where the segment from p to q crosses the ink line. */
function crossingInk(ink: Ink, p: Vec, q: Vec): Vec {
  const t = (ink.y - p.y) / (q.y - p.y)
  return { x: p.x + (q.x - p.x) * t, y: ink.y }
}

/**
 * The finishes on each side of a corner at v, piece i arriving in direction
 * di with width wi and piece j leaving in direction dj with width wj.
 */
function corner(style: StrokeStyle, v: Vec, di: Vec, wi: number, dj: Vec, wj: number): { end: Finish; start: Finish } {
  const turn = cross(di, dj)
  const ni = leftOf(di)
  const nj = leftOf(dj)
  if (Math.abs(turn) < SMOOTH && dot(di, dj) > 0) {
    return {
      end: [{ p: add(v, scale(ni, wi / 2)) }, { p: sub(v, scale(ni, wi / 2)) }],
      start: [{ p: add(v, scale(nj, wj / 2)) }, { p: sub(v, scale(nj, wj / 2)) }],
    }
  }

  // The outer side is the one the corner turns away from: +1 left, −1 right.
  const side = turn > 0 ? -1 : 1
  const pi = add(v, scale(ni, (side * wi) / 2))
  const pj = add(v, scale(nj, (side * wj) / 2))
  const { outerI, outerJ, toI, toJ } = wedge(style, v, pi, di, wi, pj, dj, wj)

  const finish = (outer: Node, toCorner: Node[], n: Vec, w: number): Finish => {
    const inner: Node = { p: add(v, scale(n, (-side * w) / 2)) }
    const at: Node = { p: v }
    return side === 1 ? [outer, ...toCorner, at, inner] : [inner, at, ...[...toCorner].reverse(), outer]
  }
  return { end: finish(outerI, toI, ni, wi), start: finish(outerJ, toJ, nj, wj) }
}

/**
 * The wedge filling the outer side of a corner at v, split along the line
 * from v to its tip: for each piece, its outer point and the nodes from
 * there to the split line, ending on it.
 */
function wedge(
  style: StrokeStyle,
  v: Vec,
  pi: Vec,
  di: Vec,
  wi: number,
  pj: Vec,
  dj: Vec,
  wj: number,
): { outerI: Node; outerJ: Node; toI: Node[]; toJ: Node[] } {
  const both = (nodes: Node[]) => ({ outerI: { p: pi }, outerJ: { p: pj }, toI: nodes, toJ: nodes })
  const bevel = () => both([{ p: scale(add(pi, pj), 0.5) }])

  if (style.corners === 'round') {
    const ai = angleOf(sub(pi, v))
    let delta = angleOf(sub(pj, v)) - ai
    while (delta > Math.PI) delta -= 2 * Math.PI
    while (delta <= -Math.PI) delta += 2 * Math.PI
    const r = (wi + wj) / 4
    const am = ai + delta / 2
    const mid: Node = { p: polar(v, r, am), arc: { c: v, a: am, r } }
    return {
      outerI: { p: pi, arc: { c: v, a: ai, r: wi / 2 } },
      outerJ: { p: pj, arc: { c: v, a: ai + delta, r: wj / 2 } },
      toI: [mid],
      toJ: [mid],
    }
  }
  if (style.corners === 'bevel') return bevel()

  const tip = dot(di, dj) > -1 + 1e-9 ? lineMeets(pi, di, pj, dj) : null
  if (!tip) return bevel()
  const ink = inkAt(style, v)
  if (ink) {
    if (!isBeyond(ink, tip)) return both([{ p: tip }])
    const cut = crossingInk(ink, tip, v)
    const toward = (p: Vec): Node[] => (isBeyond(ink, p) ? [{ p: cut }] : [{ p: crossingInk(ink, p, tip) }, { p: cut }])
    return { outerI: { p: pi }, outerJ: { p: pj }, toI: toward(pi), toJ: toward(pj) }
  }
  if (distance(tip, v) > (MITER_LIMIT * Math.max(wi, wj)) / 2) return bevel()
  return both([{ p: tip }])
}

/** A free or tee end at p, the piece leaving it in direction d (outward is −d at a start, d at an end). */
function freeEnd(style: StrokeStyle, piece: Piece, p: Vec, d: Vec, w: number, atEnd: boolean, tee: boolean): Finish {
  const n = leftOf(d)
  const left = add(p, scale(n, w / 2))
  const right = sub(p, scale(n, w / 2))
  if (tee) return [{ p: left }, { p: right }]

  if (style.corners === 'round') {
    // Half a turn about p, from the left edge to the right: through d at an end, through −d at a start.
    const a = angleOf(n)
    const toRight = atEnd ? a - Math.PI : a + Math.PI
    return [
      { p: left, arc: { c: p, a, r: w / 2 } },
      { p: right, arc: { c: p, a: toRight, r: w / 2 } },
    ]
  }

  const ink = inkAt(style, p)
  if (piece.kind === 'line' && ink && Math.abs(d.y) > STEEP) {
    const across: Vec = { x: 1, y: 0 }
    const onInk: Vec = { x: 0, y: ink.y }
    return [{ p: lineMeets(left, d, onInk, across) ?? left }, { p: lineMeets(right, d, onInk, across) ?? right }]
  }
  return [{ p: left }, { p: right }]
}

/**
 * Where a round cap's centre goes so that the cap reaches the ink line: a
 * free line end on a cap line or baseline, not horizontal, is moved along
 * its line. Other ends stay where they are.
 */
function capped(style: StrokeStyle, skeleton: Skeleton): Piece[] {
  const pieces = [...skeleton.pieces]
  if (style.corners !== 'round' || skeleton.closed) return pieces
  const pull = (p: Vec, d: Vec): Vec => {
    const ink = inkAt(style, p)
    if (!ink || Math.abs(d.y) <= STEEP) return p
    const w = widthAlong(style, d)
    const target = ink.y - (ink.beyond * w) / 2
    return add(p, scale(d, (target - p.y) / d.y))
  }
  const first = pieces[0]
  if (first.kind === 'line' && !skeleton.tee.start) {
    pieces[0] = { ...first, a: pull(first.a, normalize(sub(first.b, first.a))) }
  }
  const last = pieces[pieces.length - 1]
  if (last.kind === 'line' && !skeleton.tee.end) {
    pieces[pieces.length - 1] = { ...last, b: pull(last.b, normalize(sub(last.b, last.a))) }
  }
  return pieces
}

/** One outline per piece of the skeleton. */
export function strokeSkeleton(skeleton: Skeleton, style: StrokeStyle): Outline[] {
  const pieces = capped(style, skeleton)
  const count = pieces.length
  const widthAt = (piece: Piece, t: number) => widthAlong(style, pieceTangent(piece, t))

  // corners[k] joins piece k to piece k + 1.
  const corners = pieces.map((piece, k) => {
    if (k === count - 1 && !skeleton.closed) return null
    const next = pieces[(k + 1) % count]
    return corner(style, pieceEnd(piece), pieceTangent(piece, 1), widthAt(piece, 1), pieceTangent(next, 0), widthAt(next, 0))
  })

  return pieces.map((piece, k) => {
    const before = k === 0 ? (skeleton.closed ? corners[count - 1] : null) : corners[k - 1]
    const after = corners[k]
    const start =
      before?.start ??
      freeEnd(style, piece, pieceStart(piece), pieceTangent(piece, 0), widthAt(piece, 0), false, skeleton.tee.start)
    const end =
      after?.end ?? freeEnd(style, piece, pieceEnd(piece), pieceTangent(piece, 1), widthAt(piece, 1), true, skeleton.tee.end)
    return pieceOutline(piece, style, start, end)
  })
}

function pieceOutline(piece: Piece, style: StrokeStyle, start: Finish, end: Finish): Outline {
  const out = new OutlineWriter(start[0].p)
  const edge = (side: 1 | -1) => (t: number) => {
    const d = pieceTangent(piece, t)
    return add(piecePoint(piece, t), scale(leftOf(d), (side * widthAlong(style, d)) / 2))
  }
  const turn = piece.kind === 'arc' ? piece.sweep : 0

  if (piece.kind === 'line') out.line(end[0].p)
  else out.curve(edge(1), 0, 1, turn)
  out.chain(end)
  if (piece.kind === 'line') out.line(start[start.length - 1].p)
  else out.curve(edge(-1), 1, 0, turn)
  out.chain([...start].reverse())
  return { start: out.start, steps: dropClosing(out.steps, out.start) }
}

/** The last step back onto the start is implied by closing the outline. */
function dropClosing(steps: OutlineStep[], start: Vec): OutlineStep[] {
  const last = steps.at(-1)
  return last?.kind === 'line' && distance(last.to, start) < 1e-9 ? steps.slice(0, -1) : steps
}

/* ─── Using outlines ─── */

export function mapOutline(outline: Outline, f: (p: Vec) => Vec): Outline {
  return {
    start: f(outline.start),
    steps: outline.steps.map((step) =>
      step.kind === 'line' ? { kind: 'line', to: f(step.to) } : { kind: 'cubic', c1: f(step.c1), c2: f(step.c2), to: f(step.to) },
    ),
  }
}

const figure = (n: number) => String(Math.round(n * 1000) / 1000 || 0)

export function outlinePathData(outline: Outline): string {
  const parts = [`M ${figure(outline.start.x)} ${figure(outline.start.y)}`]
  for (const step of outline.steps) {
    if (step.kind === 'line') parts.push(`L ${figure(step.to.x)} ${figure(step.to.y)}`)
    else
      parts.push(
        `C ${figure(step.c1.x)} ${figure(step.c1.y)} ${figure(step.c2.x)} ${figure(step.c2.y)} ${figure(step.to.x)} ${figure(step.to.y)}`,
      )
  }
  parts.push('Z')
  return parts.join(' ')
}

/** The tight bounds of an outline. */
export function outlineBounds(outline: Outline): Bounds {
  const bounds = emptyBounds()
  includePoint(bounds, outline.start)
  let at = outline.start
  for (const step of outline.steps) {
    if (step.kind === 'cubic') includeCubic(bounds, [at, step.c1, step.c2, step.to])
    else includePoint(bounds, step.to)
    at = step.to
  }
  return bounds
}
