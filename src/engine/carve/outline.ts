import paper from 'paper'
import {
  add,
  clamp,
  cubicPoint,
  cubicTangent,
  dot,
  emptyBounds,
  includeCubic,
  length,
  lerp,
  normalize,
  rotate,
  scale,
  straightCubic,
  sub,
  type Bounds,
  type Cubic,
  type Vec,
} from '../path/bezier.ts'
import { arcHandleRatio, arcToCubics, KAPPA } from '../path/arc.ts'
import { FULL_ROUND_SLACK, polygonApothem, polygonCornerRadius } from './spec.ts'
import { bandParts, partCubics, partEnds } from './band.ts'
import type {
  BandSpec,
  CarveBends,
  CarveSpec,
  CornerFullness,
  CornerId,
  GrooveSpec,
  LineSideId,
  PolygonSpec,
  PunchSpec,
  SideBend,
  SlabSpec,
} from './spec.ts'

export { KAPPA } from '../path/arc.ts'
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
  /** A polygon's side `index`, from its corner `index` to the next. */
  | { type: 'polygon-side'; index: number }
  /** A polygon's rounded corner `index`, counted clockwise from the top. */
  | { type: 'polygon-corner'; index: number }
  /** Part `index` of a band's outline: an edge, an arc, a cap or a chord. */
  | { type: 'band'; index: number }

/** A circle in layer space. */
export interface OutlineCircle {
  c: Vec
  r: number
}

export interface BoxFrame {
  kind: 'box'
  center: Vec
  rotation: number
  /** Nominal size: for punches 2r × 2r, for the triangle the circumscribed box, for a polygon its circumcircle's. */
  width: number
  height: number
  /** Effective corner radius after clamping. */
  radius: number
  /** Bounds of the outline in the unrotated frame around `center`, bends included. */
  extent: Bounds
  /**
   * The circles of a polygon's rounded corners, in layer space, for the
   * construction look to draw; none for a slab or a punch, whose rounding is
   * not drawn yet, and none for a polygon rounded all the way, to within the
   * hundredth storage keeps, where they would all lie on its outline. The
   * construction look draws them as solid light-grey hairlines.
   */
  cornerCircles: OutlineCircle[]
}

export interface GrooveFrame {
  kind: 'groove'
  spine: Cubic
  width: number
}

/**
 * A band's frame: where it touches its circles, and the circles the
 * construction look draws, a neck's arcs whole. `valid` is false while its
 * circles allow no fit: then its outline is empty.
 */
export interface BandFrame {
  kind: 'band'
  valid: boolean
  touches: Vec[]
  cornerCircles: OutlineCircle[]
}

export type CarveFrame = BoxFrame | GrooveFrame | BandFrame

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

/**
 * A rounded corner from `a` to `b` that turns through `turn` radians (a
 * quarter turn on a box). Its handles run along `dirIn` and `dirOut`, each
 * (4/3)·tan(turn/4)·r long times its fullness: at full fullness a true arc.
 */
function cornerCubic(a: Vec, b: Vec, dirIn: Vec, dirOut: Vec, radius: number, fullness?: CornerFullness, turn = Math.PI / 2): Cubic {
  const k1 = clamp(fullness?.k1 ?? 1, 0, 3)
  const k2 = clamp(fullness?.k2 ?? 1, 0, 3)
  const ratio = arcHandleRatio(turn)
  return [a, add(a, scale(dirIn, k1 * ratio * radius)), sub(b, scale(dirOut, k2 * ratio * radius)), b]
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

/* ─── Polygons ─── */

/** A polygon's parts in its own frame, centred on the origin and unturned. */
export interface PolygonGeometry {
  /** The corners of the sharp polygon, clockwise from the top. */
  vertices: Vec[]
  /** The corner radius drawn: the stored one, clamped to the apothem. */
  radius: number
  /** Each corner's arc, where the polygon is rounded: from tangent point `a` to `b`, about `c`. */
  corners: Array<{ a: Vec; b: Vec; c: Vec }>
  pieces: Piece[]
}

/**
 * A regular polygon with rounded corners. Its first corner is at the top, and
 * the corners follow clockwise. Each corner turns through α = 2π/n, so with
 * radius ρ its tangent points lie ρ·tan(α/2) from the corner along both
 * sides, its arc's handles are (4/3)·tan(α/4)·ρ long, and its circle's centre
 * lies R − ρ/cos(π/n) from the middle, towards the corner. A triangle's
 * corners turn more than a quarter, so each is drawn as two arcs of half the
 * turn, as arcToCubics splits any arc. ρ stops at the
 * apothem, where the tangent points of neighbouring corners meet in the
 * middle of their side and the polygon is a circle.
 */
export function polygonGeometry(spec: Pick<PolygonSpec, 'sides' | 'radius' | 'cornerRadius'>): PolygonGeometry {
  const n = spec.sides
  const big = Math.max(spec.radius, 0.25)
  const turn = (2 * Math.PI) / n
  const vertices = Array.from({ length: n }, (_, k) => rotate({ x: 0, y: -big }, (360 * k) / n))
  const rho = polygonCornerRadius({ sides: n, radius: big, cornerRadius: spec.cornerRadius })
  const reach = rho * Math.tan(Math.PI / n)
  const toCentre = big - rho / Math.cos(Math.PI / n)
  const dirs = vertices.map((v, k) => normalize(sub(vertices[(k + 1) % n], v)))
  const corners: PolygonGeometry['corners'] = []
  const pieces: Piece[] = []
  for (let k = 0; k < n; k++) {
    const v = vertices[k]
    const dirIn = dirs[(k + n - 1) % n]
    const dirOut = dirs[k]
    if (rho > EPS) {
      const a = sub(v, scale(dirIn, reach))
      const b = add(v, scale(dirOut, reach))
      const c = scale(v, toCentre / big)
      corners.push({ a, b, c })
      const side: SideRef = { type: 'polygon-corner', index: k }
      if (turn <= Math.PI / 2 + 1e-12) pieces.push({ c: cornerCubic(a, b, dirIn, dirOut, rho, undefined, turn), side, line: false })
      else {
        // A triangle's corners turn a third of the way round: two pieces keep the arc as true as a quarter's.
        const cubics = arcToCubics(c, rho, Math.atan2(a.y - c.y, a.x - c.x), turn)
        cubics[0] = [a, cubics[0][1], cubics[0][2], cubics[0][3]]
        cubics[cubics.length - 1] = [cubics.at(-1)![0], cubics.at(-1)![1], cubics.at(-1)![2], b]
        for (const cubic of cubics) pieces.push({ c: cubic, side, line: false })
      }
    }
    const next = vertices[(k + 1) % n]
    const from = rho > EPS ? add(v, scale(dirOut, reach)) : v
    const to = rho > EPS ? sub(next, scale(dirOut, reach)) : next
    if (length(sub(to, from)) > EPS) pieces.push({ c: straightCubic(from, to), side: { type: 'polygon-side', index: k }, line: true })
  }
  return { vertices, radius: rho, corners, pieces }
}

/** A polygon's parts in layer space, as snapping, guides and the construction look read them. */
export interface PolygonParts {
  vertices: Vec[]
  /** The middle of each side, from corner k to corner k + 1. */
  midpoints: Vec[]
  radius: number
  /** Each rounded corner: its circle, its tangent points and its arc, from `start` through `sweep` (radians, clockwise on screen). */
  corners: Array<{ c: Vec; a: Vec; b: Vec; start: number; sweep: number }>
  /** The straight part of each side that has one. */
  sides: Array<[Vec, Vec]>
}

export function polygonParts(spec: PolygonSpec): PolygonParts {
  const geometry = polygonGeometry(spec)
  const map = (p: Vec): Vec => add(spec.center, rotate(p, spec.rotation))
  const vertices = geometry.vertices.map(map)
  const sweep = (2 * Math.PI) / spec.sides
  return {
    vertices,
    midpoints: vertices.map((v, k) => scale(add(v, vertices[(k + 1) % vertices.length]), 0.5)),
    radius: geometry.radius,
    corners: geometry.corners.map((corner) => {
      const c = map(corner.c)
      const a = map(corner.a)
      return { c, a, b: map(corner.b), start: Math.atan2(a.y - c.y, a.x - c.x), sweep }
    }),
    sides: geometry.pieces.filter((piece) => piece.line).map((piece) => [map(piece.c[0]), map(piece.c[3])]),
  }
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

/**
 * From center + u·r to center + v·r (u ⟂ v), a circular quarter arc. Kept
 * beside arcToCubics, which draws the same arcs from angles: built on the two
 * unit vectors, its points stay exactly where grooves have always had them.
 */
function quarter(center: Vec, u: Vec, v: Vec, r: number): Cubic {
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

/** A recipe drawn about its centre: its pieces turned and moved into place, its frame around them. */
function placed(spec: SlabSpec | PunchSpec | PolygonSpec, pieces: Piece[], size: { width: number; height: number; radius: number }, circles: OutlineCircle[]): CarveOutline {
  const extent = emptyBounds()
  for (const piece of pieces) includeCubic(extent, piece.c)
  const map = (p: Vec): Vec => add(spec.center, rotate(p, spec.rotation))
  const frame: BoxFrame = {
    kind: 'box',
    center: spec.center,
    rotation: spec.rotation,
    // By name: a geometry passed as the size must not bring its unturned parts along.
    width: size.width,
    height: size.height,
    radius: size.radius,
    extent,
    cornerCircles: circles.map((circle) => ({ c: map(circle.c), r: circle.r })),
  }
  return assemble(
    pieces.map((piece) => transformPiece(piece, spec.center, spec.rotation)),
    frame,
  )
}

function buildOutline(spec: CarveSpec): CarveOutline {
  switch (spec.kind) {
    case 'slab':
    case 'punch': {
      const geometry = boxGeometryFor(spec)
      return placed(spec, geometry.pieces, geometry, [])
    }
    case 'polygon': {
      const geometry = polygonGeometry(spec)
      const big = Math.max(spec.radius, 0.25)
      // Rounded all the way, to within what storage keeps, its corners' circles would all lie on its outline.
      const round = geometry.radius >= polygonApothem(spec) - FULL_ROUND_SLACK
      const circles = round ? [] : geometry.corners.map((corner) => ({ c: corner.c, r: geometry.radius }))
      return placed(spec, geometry.pieces, { width: 2 * big, height: 2 * big, radius: geometry.radius }, circles)
    }
    case 'channel':
    case 'slice': {
      const spine = grooveSpine(spec)
      const frame: GrooveFrame = { kind: 'groove', spine, width: spec.width }
      return assemble(spec.bend ? grooveBentPieces(spec, spine) : grooveStraightPieces(spec), frame)
    }
    case 'band':
      return bandOutline(spec)
    default:
      return spec satisfies never
  }
}

/** A band's outline: its parts as cubics, each arc in pieces of at most 90°; empty while its circles allow no fit. */
function bandOutline(spec: BandSpec): CarveOutline {
  const parts = bandParts(spec)
  if (!parts) return assemble([], { kind: 'band', valid: false, touches: [], cornerCircles: [] })
  const ends = parts.parts.map(partEnds)
  const pieces: Piece[] = parts.parts.flatMap((part, index) => {
    // Each part starts exactly where the one before it ends, and the last closes on the first.
    const from = index === 0 ? ends[0][0] : ends[index - 1][1]
    const to = index === ends.length - 1 ? ends[0][0] : ends[index][1]
    return partCubics(part, from, to).map((c): Piece => ({ c, side: { type: 'band', index }, line: part.kind === 'segment' }))
  })
  return assemble(pieces, { kind: 'band', valid: true, touches: parts.touches, cornerCircles: parts.circles })
}

/**
 * A band's outline as the construction look strokes it: open path data of
 * what lies outside its two circles, as the sheets draw it. A bar's caps, a
 * strip's ends and a neck's chords lie inside them and go, and so do the
 * runs of a bar's or strip's sides that pass inside a circle. Null when it
 * strokes whole (a belt), or has no outline.
 */
export function bandOuterPathData(spec: BandSpec): string | null {
  const parts = bandParts(spec)
  if (!parts) return null
  const outline = carveOutline(spec)
  let pathData = ''
  let clipped = false
  let last = -1
  outline.curves.forEach((curve, i) => {
    const side = outline.curveSides[i]
    if (side.type !== 'band') return
    const part = parts.parts[side.index]
    if (part.inside) {
      clipped = true
      last = -1
      return
    }
    if (part.kind === 'segment') {
      const runs = outsideCircles(curve[0], curve[3], [spec.a, spec.b])
      if (runs.length !== 1 || runs[0][0] > 0 || runs[0][1] < 1) clipped = true
      const at = (t: number) => lerp(curve[0], curve[3], t)
      for (const [from, to] of runs) pathData += `M${fmtVec(at(from))}L${fmtVec(at(to))}`
      last = -1
      return
    }
    if (side.index !== last) pathData += `M${fmtVec(curve[0])}`
    pathData += `C${fmtVec(curve[1])} ${fmtVec(curve[2])} ${fmtVec(curve[3])}`
    last = side.index
  })
  return clipped ? pathData : null
}

/** The runs of the segment from `p` to `q`, as parameters from 0 to 1, that lie outside every circle; a run that only touches one stays. */
function outsideCircles(p: Vec, q: Vec, circles: ReadonlyArray<{ c: Vec; r: number }>): Array<[number, number]> {
  let runs: Array<[number, number]> = [[0, 1]]
  const d = sub(q, p)
  const dd = dot(d, d)
  if (dd < 1e-18) return runs
  for (const { c, r } of circles) {
    // Where |p + t·d − c| = r: inside between the two roots.
    const f = sub(p, c)
    const b = dot(f, d) / dd
    const disc = b * b - (dot(f, f) - r * r) / dd
    if (disc <= 1e-12) continue
    const root = Math.sqrt(disc)
    const [enter, leave] = [-b - root, -b + root]
    runs = runs.flatMap(([from, to]): Array<[number, number]> => {
      if (leave <= from || enter >= to) return [[from, to]]
      return [
        ...(enter > from ? [[from, enter] as [number, number]] : []),
        ...(leave < to ? [[leave, to] as [number, number]] : []),
      ]
    })
  }
  // Pieces under a hundredth of a unit are rounding, not lines.
  const length = Math.sqrt(dd)
  return runs.filter(([from, to]) => (to - from) * length > 0.01)
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
