import paper from 'paper'
import {
  add,
  clamp,
  cubicPoint,
  cubicTangent,
  emptyBounds,
  includeCubic,
  length,
  normalize,
  rotate,
  scale,
  straightCubic,
  sub,
  type Bounds,
  type Cubic,
  type Vec,
} from '../path/bezier.ts'
import type {
  CarveBends,
  CarveSpec,
  CornerFullness,
  CornerId,
  GrooveSpec,
  LineSideId,
  PunchSpec,
  SideBend,
  SlabSpec,
} from './spec.ts'

/** Handle ratio that makes a cubic quarter arc look circular. */
export const KAPPA = 0.5522847498307936
/** Far enough past any artboard that a slice always cuts edge to edge. */
export const SLICE_REACH = 4000

const EPS = 1e-6
/** How far a bend may reach inward, as a share of the distance across the shape. */
const INWARD_LIMIT = 0.45

/** A path anchor with handles relative to it (the paper.js convention). */
export interface Seg {
  p: Vec
  hIn: Vec | null
  hOut: Vec | null
}

export type SideRef =
  | { type: 'line'; id: LineSideId }
  | { type: 'corner'; id: CornerId }
  | { type: 'rail'; id: 'left' | 'right' }
  | { type: 'cap'; id: 'start' | 'end' }

export interface BoxFrame {
  kind: 'box'
  center: Vec
  rotation: number
  /** Nominal size: for punches 2r × 2r, for the triangle the circumscribed box. */
  width: number
  height: number
  /** Effective corner radius after clamping. */
  radius: number
  /** Bounds of the outline in the unrotated frame around `center`, bends included. */
  extent: Bounds
}

export interface GrooveFrame {
  kind: 'groove'
  spine: Cubic
  width: number
}

export type CarveFrame = BoxFrame | GrooveFrame

export interface CarveOutline {
  /** One closed ring of anchors. */
  segs: Seg[]
  /** Curve i runs from segs[i] to segs[(i + 1) % n], in layer space. */
  curves: Cubic[]
  /** Which side of the recipe each curve belongs to. */
  curveSides: SideRef[]
  pathData: string
  frame: CarveFrame
}

interface Piece {
  c: Cubic
  side: SideRef
  line: boolean
}

/* ─── Boxes: slabs, circle and square punches ─── */

interface SideInfo {
  id: LineSideId
  p0: Vec
  p3: Vec
  /** Outward unit normal. */
  n: Vec
  /** Direction of travel when the side is straight. */
  axis: Vec
  /** Distance across the shape from this side, for the inward bend limit. */
  span: number
  cubic: Cubic
  line: boolean
  chord: number
}

export interface BoxGeometry {
  width: number
  height: number
  radius: number
  sides: Partial<Record<LineSideId, SideInfo>>
  corners: Partial<Record<CornerId, { a: Vec; b: Vec; dirIn: Vec; dirOut: Vec; radius: number; cubic: Cubic }>>
  pieces: Piece[]
}

/** A straight side, bent by `bend` if given. Local frame, no rotation. */
export function bentSideCubic(
  p0: Vec,
  p3: Vec,
  n: Vec,
  span: number,
  bend: SideBend | undefined,
): { cubic: Cubic; line: boolean } {
  const chord = sub(p3, p0)
  const len = length(chord)
  if (!bend || len < EPS) return { cubic: straightCubic(p0, p3), line: true }
  const o1 = clamp(bend.o1, -INWARD_LIMIT * span, len)
  const o2 = clamp(bend.o2, -INWARD_LIMIT * span, len)
  const a1 = clamp(bend.a1, -1, 1)
  const a2 = clamp(bend.a2, -1, 1)
  if (o1 === 0 && o2 === 0 && a1 === 0 && a2 === 0) return { cubic: straightCubic(p0, p3), line: true }
  const p1 = add(add(p0, scale(chord, 1 / 3 + a1)), scale(n, o1))
  const p2 = add(add(p0, scale(chord, 2 / 3 + a2)), scale(n, o2))
  return { cubic: [p0, p1, p2, p3], line: false }
}

function cornerCubic(a: Vec, b: Vec, dirIn: Vec, dirOut: Vec, radius: number, fullness?: CornerFullness): Cubic {
  const k1 = clamp(fullness?.k1 ?? 1, 0, 3)
  const k2 = clamp(fullness?.k2 ?? 1, 0, 3)
  return [a, add(a, scale(dirIn, k1 * KAPPA * radius)), sub(b, scale(dirOut, k2 * KAPPA * radius)), b]
}

function makeSide(
  id: LineSideId,
  p0: Vec,
  p3: Vec,
  n: Vec,
  axis: Vec,
  span: number,
  bends: CarveBends,
): SideInfo {
  const { cubic, line } = bentSideCubic(p0, p3, n, span, bends.sides?.[id])
  return { id, p0, p3, n, axis, span, cubic, line, chord: length(sub(p3, p0)) }
}

/**
 * Rounded box centred on the origin, unrotated: 4 straight sides and 4 corner
 * arcs. Corner arcs take their handle directions from the neighbouring sides,
 * so a straight side always meets its corner smoothly; zero-length pieces are
 * never emitted.
 */
export function boxGeometry(width: number, height: number, radius: number, bends: CarveBends): BoxGeometry {
  const w = Math.max(width, 0.5)
  const h = Math.max(height, 0.5)
  const hw = w / 2
  const hh = h / 2
  const re = clamp(radius, 0, Math.min(hw, hh))

  const sides: Record<'top' | 'right' | 'bottom' | 'left', SideInfo> = {
    top: makeSide('top', { x: -hw + re, y: -hh }, { x: hw - re, y: -hh }, { x: 0, y: -1 }, { x: 1, y: 0 }, h, bends),
    right: makeSide('right', { x: hw, y: -hh + re }, { x: hw, y: hh - re }, { x: 1, y: 0 }, { x: 0, y: 1 }, w, bends),
    bottom: makeSide('bottom', { x: hw - re, y: hh }, { x: -hw + re, y: hh }, { x: 0, y: 1 }, { x: -1, y: 0 }, h, bends),
    left: makeSide('left', { x: -hw, y: hh - re }, { x: -hw, y: -hh + re }, { x: -1, y: 0 }, { x: 0, y: -1 }, w, bends),
  }

  const order: Array<['top' | 'right' | 'bottom' | 'left', CornerId, 'top' | 'right' | 'bottom' | 'left']> = [
    ['top', 'tr', 'right'],
    ['right', 'br', 'bottom'],
    ['bottom', 'bl', 'left'],
    ['left', 'tl', 'top'],
  ]

  const corners: BoxGeometry['corners'] = {}
  const pieces: Piece[] = []
  for (const [sideId, cornerId, nextId] of order) {
    const side = sides[sideId]
    if (side.chord > EPS) pieces.push({ c: side.cubic, side: { type: 'line', id: sideId }, line: side.line })
    if (re > EPS) {
      const next = sides[nextId]
      const dirIn = side.chord > EPS && !side.line ? normalize(sub(side.cubic[3], side.cubic[2]), side.axis) : side.axis
      const dirOut = next.chord > EPS && !next.line ? normalize(sub(next.cubic[1], next.cubic[0]), next.axis) : next.axis
      const cubic = cornerCubic(side.p3, next.p0, dirIn, dirOut, re, bends.corners?.[cornerId])
      corners[cornerId] = { a: side.p3, b: next.p0, dirIn, dirOut, radius: re, cubic }
      pieces.push({ c: cubic, side: { type: 'corner', id: cornerId }, line: false })
    }
  }

  return { width: w, height: h, radius: re, sides, corners, pieces }
}

/** Triangle punch: same circumradius (×1.25) and orientation as the original tool. */
export function triangleGeometry(radius: number, bends: CarveBends): BoxGeometry {
  const r = Math.max(radius, 0.25) * 1.25
  // paper.js RegularPolygon(3): (0, −R) rotated by −120°, 0°, 120°.
  const vertices = [-120, 0, 120].map((deg) => rotate({ x: 0, y: -r }, deg))
  const ids: LineSideId[] = ['s0', 's1', 's2']
  const sides: BoxGeometry['sides'] = {}
  const pieces: Piece[] = []
  for (let i = 0; i < 3; i++) {
    const p0 = vertices[i]
    const p3 = vertices[(i + 1) % 3]
    const axis = normalize(sub(p3, p0))
    const n = { x: axis.y, y: -axis.x }
    const side = makeSide(ids[i], p0, p3, n, axis, 1.5 * r, bends)
    sides[ids[i]] = side
    pieces.push({ c: side.cubic, side: { type: 'line', id: ids[i] }, line: side.line })
  }
  return { width: r * Math.sqrt(3), height: r * 1.5, radius: 0, sides, corners: {}, pieces }
}

export function boxGeometryFor(spec: SlabSpec | PunchSpec): BoxGeometry {
  if (spec.kind === 'slab') return boxGeometry(spec.width, spec.height, spec.radius, spec)
  if (spec.shape === 'triangle') return triangleGeometry(spec.radius, spec)
  const d = spec.radius * 2
  return boxGeometry(d, d, spec.shape === 'circle' ? spec.radius : 0, spec)
}

/* ─── Grooves: channels and slices ─── */

/** The spine of a groove, bent if it has a bend. */
export function grooveSpine(spec: GrooveSpec): Cubic {
  const chord = sub(spec.to, spec.from)
  const len = length(chord)
  if (!spec.bend || len < 0.5) return straightCubic(spec.from, spec.to)
  const axis = normalize(chord)
  const n = { x: axis.y, y: -axis.x }
  const { cubic } = bentSideCubic(spec.from, spec.to, n, len / INWARD_LIMIT, spec.bend)
  return cubic
}

function quarter(center: Vec, u: Vec, v: Vec, r: number): Cubic {
  // From center + u·r to center + v·r (u ⟂ v), a circular quarter arc.
  const p0 = add(center, scale(u, r))
  const p3 = add(center, scale(v, r))
  return [p0, add(p0, scale(v, KAPPA * r)), add(p3, scale(u, KAPPA * r)), p3]
}

function line(a: Vec, b: Vec, side: SideRef): Piece {
  return { c: straightCubic(a, b), side, line: true }
}

function segmentIntersection(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const r = sub(b, a)
  const s = sub(d, c)
  const denom = r.x * s.y - r.y * s.x
  if (Math.abs(denom) < 1e-12) return null
  const ca = sub(c, a)
  const t = (ca.x * s.y - ca.y * s.x) / denom
  const u = (ca.x * r.y - ca.y * r.x) / denom
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
  return add(a, scale(r, t))
}

/** Cut out the loops an offset polyline makes on the inside of a tight bend. */
export function removeSelfLoops(points: Vec[]): Vec[] {
  const out = points.slice()
  for (let pass = 0; pass < 64; pass++) {
    let cut = false
    for (let i = 0; i < out.length - 3 && !cut; i++) {
      for (let j = out.length - 2; j > i + 1; j--) {
        const x = segmentIntersection(out[i], out[i + 1], out[j], out[j + 1])
        if (x) {
          out.splice(i + 1, j - i, x)
          cut = true
          break
        }
      }
    }
    if (!cut) break
  }
  return out
}

let fitScope: paper.PaperScope | null = null

function getFitScope(): paper.PaperScope {
  if (!fitScope) {
    fitScope = new paper.PaperScope()
    fitScope.setup(new paper.Size(1, 1))
  }
  fitScope.activate()
  return fitScope
}

/** Fit a smooth Bézier run through a polyline (paper.js curve fitting). */
function fitRail(points: Vec[], side: SideRef): Piece[] {
  const scope = getFitScope()
  const path = new scope.Path({ segments: points.map((p) => [p.x, p.y]), insert: false })
  path.simplify(0.35)
  const pieces = path.curves.map((curve): Piece => {
    const p0 = { x: curve.point1.x, y: curve.point1.y }
    const p3 = { x: curve.point2.x, y: curve.point2.y }
    const p1 = { x: p0.x + curve.handle1.x, y: p0.y + curve.handle1.y }
    const p2 = { x: p3.x + curve.handle2.x, y: p3.y + curve.handle2.y }
    const isLine = curve.handle1.isZero() && curve.handle2.isZero()
    return { c: [p0, p1, p2, p3], side, line: isLine }
  })
  path.remove()
  return pieces
}

const RAIL_SAMPLES = 64

function grooveBentPieces(spec: GrooveSpec, spine: Cubic): Piece[] {
  const r = spec.width / 2
  const left: Vec[] = []
  const right: Vec[] = []
  for (let i = 0; i < RAIL_SAMPLES; i++) {
    const t = i / (RAIL_SAMPLES - 1)
    const p = cubicPoint(spine, t)
    const tan = cubicTangent(spine, t)
    const nu = { x: tan.y, y: -tan.x }
    left.push(add(p, scale(nu, r)))
    right.push(sub(p, scale(nu, r)))
  }
  const leftRail = fitRail(removeSelfLoops(left), { type: 'rail', id: 'left' })
  const rightRail = fitRail(removeSelfLoops(right).reverse(), { type: 'rail', id: 'right' })

  const b0 = spine[0]
  const b1 = spine[3]
  const t0 = cubicTangent(spine, 0)
  const t1 = cubicTangent(spine, 1)
  const n0 = { x: t0.y, y: -t0.x }
  const n1 = { x: t1.y, y: -t1.x }

  if (spec.kind === 'channel') {
    const endCap: Piece[] = [
      { c: quarter(b1, n1, t1, r), side: { type: 'cap', id: 'end' }, line: false },
      { c: quarter(b1, t1, scale(n1, -1), r), side: { type: 'cap', id: 'end' }, line: false },
    ]
    const startCap: Piece[] = [
      { c: quarter(b0, scale(n0, -1), scale(t0, -1), r), side: { type: 'cap', id: 'start' }, line: false },
      { c: quarter(b0, scale(t0, -1), n0, r), side: { type: 'cap', id: 'start' }, line: false },
    ]
    return [...leftRail, ...endCap, ...rightRail, ...startCap]
  }

  // Slice: carry each rail straight on past the artboard along its end tangent.
  const leftStart = left[0]
  const leftEnd = left[left.length - 1]
  const rightStart = right[0]
  const rightEnd = right[right.length - 1]
  const farLeftStart = sub(leftStart, scale(t0, SLICE_REACH))
  const farLeftEnd = add(leftEnd, scale(t1, SLICE_REACH))
  const farRightEnd = add(rightEnd, scale(t1, SLICE_REACH))
  const farRightStart = sub(rightStart, scale(t0, SLICE_REACH))
  return [
    line(farLeftStart, leftStart, { type: 'rail', id: 'left' }),
    ...leftRail,
    line(leftEnd, farLeftEnd, { type: 'rail', id: 'left' }),
    line(farLeftEnd, farRightEnd, { type: 'cap', id: 'end' }),
    line(farRightEnd, rightEnd, { type: 'rail', id: 'right' }),
    ...rightRail,
    line(rightStart, farRightStart, { type: 'rail', id: 'right' }),
    line(farRightStart, farLeftStart, { type: 'cap', id: 'start' }),
  ]
}

function grooveStraightPieces(spec: GrooveSpec): Piece[] {
  const r = spec.width / 2
  const chord = sub(spec.to, spec.from)
  const len = length(chord)

  if (spec.kind === 'channel' && len < 0.5) {
    // A channel that never left its start point is a round hole.
    const c = spec.from
    const up = { x: 0, y: -1 }
    const rightDir = { x: 1, y: 0 }
    const down = { x: 0, y: 1 }
    const leftDir = { x: -1, y: 0 }
    return [
      { c: quarter(c, up, rightDir, r), side: { type: 'cap', id: 'end' }, line: false },
      { c: quarter(c, rightDir, down, r), side: { type: 'cap', id: 'end' }, line: false },
      { c: quarter(c, down, leftDir, r), side: { type: 'cap', id: 'start' }, line: false },
      { c: quarter(c, leftDir, up, r), side: { type: 'cap', id: 'start' }, line: false },
    ]
  }

  const e = len >= 0.5 ? normalize(chord) : { x: 1, y: 0 }
  const n = { x: e.y, y: -e.x }

  if (spec.kind === 'channel') {
    const a = add(spec.from, scale(n, r))
    const b = add(spec.to, scale(n, r))
    const c = sub(spec.to, scale(n, r))
    const d = sub(spec.from, scale(n, r))
    return [
      line(a, b, { type: 'rail', id: 'left' }),
      { c: quarter(spec.to, n, e, r), side: { type: 'cap', id: 'end' }, line: false },
      { c: quarter(spec.to, e, scale(n, -1), r), side: { type: 'cap', id: 'end' }, line: false },
      line(c, d, { type: 'rail', id: 'right' }),
      { c: quarter(spec.from, scale(n, -1), scale(e, -1), r), side: { type: 'cap', id: 'start' }, line: false },
      { c: quarter(spec.from, scale(e, -1), n, r), side: { type: 'cap', id: 'start' }, line: false },
    ]
  }

  const start = sub(spec.from, scale(e, SLICE_REACH))
  const end = add(spec.to, scale(e, SLICE_REACH))
  const a = add(start, scale(n, r))
  const b = add(end, scale(n, r))
  const c = sub(end, scale(n, r))
  const d = sub(start, scale(n, r))
  return [
    line(a, b, { type: 'rail', id: 'left' }),
    line(b, c, { type: 'cap', id: 'end' }),
    line(c, d, { type: 'rail', id: 'right' }),
    line(d, a, { type: 'cap', id: 'start' }),
  ]
}

/* ─── Assembly ─── */

const fmt = (v: number): string => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}
const fmtVec = (p: Vec): string => `${fmt(p.x)},${fmt(p.y)}`

function nullIfZero(v: Vec): Vec | null {
  return Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9 ? null : v
}

function assemble(pieces: Piece[], frame: CarveFrame): CarveOutline {
  const n = pieces.length
  const segs: Seg[] = pieces.map((piece) => ({
    p: piece.c[0],
    hIn: null,
    hOut: piece.line ? null : nullIfZero(sub(piece.c[1], piece.c[0])),
  }))
  for (let i = 0; i < n; i++) {
    const piece = pieces[i]
    segs[(i + 1) % n].hIn = piece.line ? null : nullIfZero(sub(piece.c[2], piece.c[3]))
  }
  const curves = pieces.map((piece): Cubic => (piece.line ? straightCubic(piece.c[0], piece.c[3]) : piece.c))
  let pathData = n ? `M${fmtVec(pieces[0].c[0])}` : ''
  for (const piece of pieces) {
    pathData += piece.line
      ? `L${fmtVec(piece.c[3])}`
      : `C${fmtVec(piece.c[1])} ${fmtVec(piece.c[2])} ${fmtVec(piece.c[3])}`
  }
  if (n) pathData += 'Z'
  return { segs, curves, curveSides: pieces.map((piece) => piece.side), pathData, frame }
}

function transformPiece(piece: Piece, center: Vec, rotation: number): Piece {
  const map = (p: Vec): Vec => add(center, rotate(p, rotation))
  return { ...piece, c: [map(piece.c[0]), map(piece.c[1]), map(piece.c[2]), map(piece.c[3])] }
}

function buildOutline(spec: CarveSpec): CarveOutline {
  if (spec.kind === 'slab' || spec.kind === 'punch') {
    const geometry = boxGeometryFor(spec)
    const extent = emptyBounds()
    for (const piece of geometry.pieces) includeCubic(extent, piece.c)
    const frame: BoxFrame = {
      kind: 'box',
      center: spec.center,
      rotation: spec.rotation,
      width: geometry.width,
      height: geometry.height,
      radius: geometry.radius,
      extent,
    }
    return assemble(
      geometry.pieces.map((piece) => transformPiece(piece, spec.center, spec.rotation)),
      frame,
    )
  }
  const spine = grooveSpine(spec)
  const frame: GrooveFrame = { kind: 'groove', spine, width: spec.width }
  return assemble(spec.bend ? grooveBentPieces(spec, spine) : grooveStraightPieces(spec), frame)
}

const CACHE_LIMIT = 64
const cache = new Map<string, CarveOutline>()

/** Generate (memoised) the outline of a recipe. */
export function carveOutline(spec: CarveSpec): CarveOutline {
  const key = JSON.stringify(spec)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const outline = buildOutline(spec)
  cache.set(key, outline)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return outline
}

/** Tight bounds of an outline in layer space. */
export function outlineBounds(outline: CarveOutline): Bounds {
  const b = emptyBounds()
  for (const c of outline.curves) includeCubic(b, c)
  return b
}
