import {
  add,
  cross,
  cubicPoint,
  distance,
  dot,
  emptyBounds,
  includeCubic,
  normalize,
  projectOnCubic,
  rotate,
  scale,
  sub,
  type Bounds,
  type Cubic,
  type Vec,
} from '../path/bezier.ts'
import { KAPPA } from '../path/arc.ts'
import { carveOutline, outlineBounds, polygonParts } from '../carve/outline.ts'
import { polygonApothem, type BandSpec, type CarveSpec } from '../carve/spec.ts'
import { bandParts } from '../carve/band.ts'
import { asCircle, fitCircle, type Circle, type CircleSource } from '../geometry/asCircle.ts'
import { recipeCentre } from './pins.ts'
import type { ConstructionRole, Contour, Guide, PathObject } from './types.ts'

/**
 * Guides as geometry: the construction lines a shape offers, the frame that
 * touches a set of circles, and the small sums that move, turn and measure
 * a guide. Everything here is pure and works in layer space.
 */

export type GuideShape = Guide['shape']
export type GuideStyle = Guide['style']

/** A construction line a shape offers, before it is a guide. */
export interface ConstructionLine {
  role: ConstructionRole
  shape: GuideShape
  /**
   * What a guide made from it is called: where its line lies on screen, "Top"
   * or "Centre ↕", whatever the shape's turn. Spokes are "Spoke 1", "Spoke 2"
   * in order among those the shape offers.
   */
  name: string
}

/* ─── Lines ─── */

/** A line's angle as stored: in [0, 180), since a line through a point at θ is the same line at θ + 180. */
export function lineAngle(deg: number): number {
  const a = ((deg % 180) + 180) % 180
  const rounded = Math.round(a * 1e9) / 1e9
  return rounded >= 180 ? 0 : rounded
}

/**
 * A line's angle as the editor reads angles, clockwise on screen from flat
 * as a slab's turn reads, folded into a half turn and to two places: ref 4's
 * bands, falling to the right, read 60°.
 */
export function lineReading(angle: number): number {
  const reading = Math.round(lineAngle(angle) * 100) / 100
  return reading >= 180 ? 0 : reading
}

/** A line's unit direction: exact for flat and upright lines, so their points stay whole. */
export function lineDirection(angle: number): Vec {
  const a = lineAngle(angle)
  if (a === 0) return { x: 1, y: 0 }
  if (a === 90) return { x: 0, y: 1 }
  return rotate({ x: 1, y: 0 }, a)
}

/** The infinite line through `p` at `angle` degrees. */
export function lineShape(p: Vec, angle: number): GuideShape {
  return { kind: 'line', p: { x: p.x, y: p.y }, angle: lineAngle(angle) }
}

/**
 * The part of an infinite line inside a rectangle, or null when it misses.
 * `rect` is in the same space as the line.
 */
export function clipLine(p: Vec, angle: number, rect: Bounds): [Vec, Vec] | null {
  const d = lineDirection(angle)
  let lo = -Infinity
  let hi = Infinity
  for (const [origin, dir, min, max] of [
    [p.x, d.x, rect.minX, rect.maxX],
    [p.y, d.y, rect.minY, rect.maxY],
  ] as const) {
    if (Math.abs(dir) < 1e-12) {
      if (origin < min || origin > max) return null
      continue
    }
    const t1 = (min - origin) / dir
    const t2 = (max - origin) / dir
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
  }
  if (!(lo <= hi)) return null
  return [add(p, scale(d, lo)), add(p, scale(d, hi))]
}

/* ─── Measuring ─── */

function contourCurves(contour: Contour): Cubic[] {
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

const ZERO: Vec = { x: 0, y: 0 }

/** The point of a guide nearest `p`, and how far it is. */
export function nearestOnGuide(shape: GuideShape, p: Vec): { point: Vec; distance: number } {
  switch (shape.kind) {
    case 'line': {
      const d = lineDirection(shape.angle)
      const point = add(shape.p, scale(d, dot(sub(p, shape.p), d)))
      return { point, distance: Math.abs(cross(sub(p, shape.p), d)) }
    }
    case 'circle': {
      const away = normalize(sub(p, shape.c))
      const point = add(shape.c, scale(away, shape.r))
      return { point, distance: Math.abs(distance(p, shape.c) - shape.r) }
    }
    case 'path': {
      let best = { point: shape.contour.segments[0]?.point ?? p, distance: Infinity }
      if (shape.contour.segments.length === 1) return { point: best.point, distance: distance(best.point, p) }
      for (const curve of contourCurves(shape.contour)) {
        const hit = projectOnCubic(curve, p)
        if (hit.distance < best.distance) best = { point: hit.point, distance: hit.distance }
      }
      return best
    }
    default:
      return shape satisfies never
  }
}

/** Do two guide shapes draw the same, to within a millionth of a unit? */
export function sameGuideShape(a: GuideShape, b: GuideShape): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6
  const nearVec = (u: Vec, v: Vec) => near(u.x, v.x) && near(u.y, v.y)
  if (a.kind === 'line' && b.kind === 'line') return nearVec(a.p, b.p) && near(a.angle, b.angle)
  if (a.kind === 'circle' && b.kind === 'circle') return nearVec(a.c, b.c) && near(a.r, b.r)
  if (a.kind === 'path' && b.kind === 'path') return JSON.stringify(a.contour) === JSON.stringify(b.contour)
  return false
}

/* ─── Moving ─── */

const hundredths = (v: number) => Math.round(v * 100) / 100

/** A guide moved, its position stored to hundredths as shapes are: a line's point, a circle's centre, a path's points. */
export function moveGuideShape(shape: GuideShape, d: Vec): GuideShape {
  const at = (p: Vec) => ({ x: hundredths(p.x + d.x), y: hundredths(p.y + d.y) })
  switch (shape.kind) {
    case 'line':
      return { kind: 'line', p: at(shape.p), angle: shape.angle }
    case 'circle':
      return { kind: 'circle', c: at(shape.c), r: shape.r }
    case 'path':
      return {
        kind: 'path',
        contour: { closed: shape.contour.closed, segments: shape.contour.segments.map((segment) => ({ ...segment, point: at(segment.point) })) },
      }
    default:
      return shape satisfies never
  }
}

/* ─── What a shape offers ─── */

/** The tight bounds of some contours, curves and all. */
function contoursBoundsOf(contours: readonly Contour[]): Bounds {
  const b = emptyBounds()
  for (const contour of contours) {
    if (contour.segments.length === 1) {
      const p = contour.segments[0].point
      includeCubic(b, [p, p, p, p])
    }
    for (const curve of contourCurves(contour)) includeCubic(b, curve)
  }
  return b
}

/** What construction lines are read from: a recipe or contours, and a free shape's frame. */
export type ConstructionSource = CircleSource & Pick<PathObject, 'frame'>

/**
 * The frame construction lines are measured in: a centre, a turn, and how far
 * the shape reaches from the centre along the turned axes. A turned recipe or
 * free shape is measured in its own frame, whatever its turn, so each role
 * stays on the same side of the shape as it turns; a circle is always
 * measured upright.
 */
interface SourceFrame {
  centre: Vec
  rotation: number
  reach: Bounds
}

function sourceFrame(source: ConstructionSource): SourceFrame | null {
  const circle = asCircle(source)
  if (circle) return { centre: circle.c, rotation: 0, reach: { minX: -circle.r, minY: -circle.r, maxX: circle.r, maxY: circle.r } }
  const spec = source.carve
  const about = (centre: Vec, bounds: Bounds, rotation: number): SourceFrame | null =>
    Number.isFinite(bounds.minX)
      ? { centre, rotation, reach: { minX: bounds.minX - centre.x, minY: bounds.minY - centre.y, maxX: bounds.maxX - centre.x, maxY: bounds.maxY - centre.y } }
      : null
  if (!spec) {
    if (source.contours.length === 0) return null
    const rotation = source.frame?.rotation ?? 0
    const bounds = contoursBoundsOf(rotation ? source.contours.map((contour) => rotateContour(contour, -rotation)) : source.contours)
    const middle = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    const frame = about(middle, bounds, rotation)
    return frame && { ...frame, centre: rotate(middle, rotation) }
  }
  switch (spec.kind) {
    case 'slab':
    case 'punch':
    case 'polygon':
      // Measured unturned, about its own centre.
      return about(spec.center, outlineBounds(carveOutline({ ...spec, rotation: 0 })), spec.rotation)
    case 'band': {
      // Along the line between its circles, about its middle.
      const middle = scale(add(spec.a.c, spec.b.c), 0.5)
      const rotation = (Math.atan2(spec.b.c.y - spec.a.c.y, spec.b.c.x - spec.a.c.x) * 180) / Math.PI
      const bounds = outlineBounds(carveOutline(spec))
      if (!Number.isFinite(bounds.minX)) return null
      const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
      ].map((p) => add(middle, rotate(sub(p, middle), -rotation)))
      const reach = emptyBounds()
      for (const p of corners) includeCubic(reach, [p, p, p, p])
      return about(middle, reach, rotation)
    }
    case 'channel':
    case 'slice': {
      // Along its spine, and a slice by its spine and width, not its reach past the canvas.
      const middle = scale(add(spec.from, spec.to), 0.5)
      const rotation = (Math.atan2(spec.to.y - spec.from.y, spec.to.x - spec.from.x) * 180) / Math.PI
      const unturn = (v: Vec) => add(middle, rotate(sub(v, middle), -rotation))
      return about(middle, outlineBounds(carveOutline({ ...spec, kind: 'channel', from: unturn(spec.from), to: unturn(spec.to) })), rotation)
    }
    default:
      return spec satisfies never
  }
}

function rotateContour(contour: Contour, deg: number): Contour {
  return {
    closed: contour.closed,
    segments: contour.segments.map((segment) => ({
      point: rotate(segment.point, deg),
      handleIn: segment.handleIn ? rotate(segment.handleIn, deg) : segment.handleIn,
      handleOut: segment.handleOut ? rotate(segment.handleOut, deg) : segment.handleOut,
    })),
  }
}

/** The sharp corners of a recipe that has corners, in order; null for a circle or a groove. */
function recipeVertices(spec: CarveSpec): Vec[] | null {
  const box = (center: Vec, rotation: number, hw: number, hh: number) =>
    [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].map((v) => add(center, rotate(v, rotation)))
  switch (spec.kind) {
    case 'slab':
      return box(spec.center, spec.rotation, spec.width / 2, spec.height / 2)
    case 'punch': {
      if (spec.shape === 'circle') return null
      if (spec.shape === 'square') return box(spec.center, spec.rotation, spec.radius, spec.radius)
      // As the triangle punch draws: a circumradius of 1.25 r, the first vertex at the top.
      const big = spec.radius * 1.25
      return [0, 120, 240].map((deg) => add(spec.center, rotate(rotate({ x: 0, y: -big }, deg), spec.rotation)))
    }
    case 'polygon':
      // The corners of the sharp polygon, whatever its rounding.
      return polygonParts(spec).vertices
    case 'channel':
    case 'slice':
    case 'band':
      return null
    default:
      return spec satisfies never
  }
}

/** The circumcircle and incircle of a recipe with corners, from its own numbers. */
function recipeCircles(spec: CarveSpec): { circum: Circle; in: Circle | null } | null {
  switch (spec.kind) {
    case 'slab':
      return {
        circum: { c: spec.center, r: Math.hypot(spec.width, spec.height) / 2 },
        in: { c: spec.center, r: Math.min(spec.width, spec.height) / 2 },
      }
    case 'punch':
      if (spec.shape === 'circle') return null
      if (spec.shape === 'square') return { circum: { c: spec.center, r: spec.radius * Math.SQRT2 }, in: { c: spec.center, r: spec.radius } }
      return { circum: { c: spec.center, r: spec.radius * 1.25 }, in: { c: spec.center, r: spec.radius * 0.625 } }
    case 'polygon':
      // The sharp polygon's: through its corners, and touching its sides.
      return { circum: { c: spec.center, r: spec.radius }, in: { c: spec.center, r: polygonApothem(spec) } }
    case 'channel':
    case 'slice':
    case 'band':
      return null
    default:
      return spec satisfies never
  }
}

/**
 * A free shape's circles. When its anchors lie on one circle, as a regular
 * polygon's do, they are about that circle's centre; otherwise about the
 * middle of its frame, through its farthest anchor. The incircle touches the
 * nearest point of its outline, and there is none when the centre is not
 * inside the shape.
 */
function freeCircles(contours: readonly Contour[], middle: Vec): { circum: Circle; in: Circle | null } | null {
  const anchors = contours.flatMap((contour) => contour.segments.map((segment) => segment.point))
  if (anchors.length < 2) return null
  const fitted = fitCircle(anchors)
  const concyclic = fitted !== null && anchors.every((p) => Math.abs(distance(p, fitted.c) - fitted.r) <= Math.max(0.05, 0.001 * fitted.r))
  const c = concyclic ? fitted.c : middle
  const far = concyclic ? fitted.r : Math.max(...anchors.map((p) => distance(p, c)))
  if (far <= 1e-6) return null
  const curves = contours.flatMap(contourCurves)
  const near = curves.length && insideContours(contours, c) ? Math.min(...curves.map((curve) => projectOnCubic(curve, c).distance)) : 0
  return { circum: { c, r: far }, in: near > 1e-6 ? { c, r: near } : null }
}

/** Is `p` inside some contours, by the even-odd rule, their curves flattened finely? */
function insideContours(contours: readonly Contour[], p: Vec): boolean {
  let inside = false
  for (const contour of contours) {
    if (!contour.closed) continue
    const points: Vec[] = []
    for (const curve of contourCurves(contour)) {
      for (let i = 0; i < 16; i++) points.push(cubicPoint(curve, i / 16))
    }
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i]
      const b = points[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

/** The spokes of a recipe with corners: a line from the centre through each corner, once for opposite corners. */
function spokeAngles(spec: CarveSpec): number[] {
  const vertices = recipeVertices(spec)
  if (!vertices) return []
  const centre = recipeCentre(spec)
  const angles: number[] = []
  for (const v of vertices) {
    const off = sub(v, centre)
    if (Math.hypot(off.x, off.y) < 1e-9) continue
    const angle = lineAngle((Math.atan2(off.y, off.x) * 180) / Math.PI)
    if (!angles.some((a) => Math.abs(a - angle) < 1e-6 || Math.abs(Math.abs(a - angle) - 180) < 1e-6)) angles.push(angle)
  }
  return angles
}

const BOUNDS_ROLES: ConstructionRole[] = ['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left']

/** The circumcircle and incircle a shape has, other than a circle, which is its own. */
function shapeCircles(source: ConstructionSource, frame: SourceFrame): { circum: Circle; in: Circle | null } | null {
  return source.carve ? recipeCircles(source.carve) : freeCircles(source.contours, frame.centre)
}

/**
 * Do two guides draw the same line or circle, to within a hundredth of a unit
 * and of a degree? A line is the same whichever of its points it is stored by.
 */
export function coincide(a: GuideShape, b: GuideShape): boolean {
  const NEAR = 0.01
  if (a.kind === 'line' && b.kind === 'line') {
    const turn = Math.abs(lineAngle(a.angle) - lineAngle(b.angle))
    return Math.min(turn, 180 - turn) <= NEAR && nearestOnGuide(a, b.p).distance <= NEAR
  }
  if (a.kind === 'circle' && b.kind === 'circle') return distance(a.c, b.c) <= NEAR && Math.abs(a.r - b.r) <= NEAR
  return sameGuideShape(a, b)
}

/**
 * Every construction line a shape offers: its centre lines and bounds, in its
 * own frame when it is turned, its circumcircle and incircle where it has
 * them, and its spokes, each in the shape's own frame, so a role names the
 * same side through any turn. A circle offers itself once, as its
 * circumcircle. A line two roles share, to within a hundredth, is offered
 * once, by the first: a triangle's first spoke is its upright centre line.
 */
export function constructionLines(source: ConstructionSource): ConstructionLine[] {
  if (source.carve?.kind === 'band') return bandLines(source.carve)
  const roles: ConstructionRole[] = [...BOUNDS_ROLES]
  const frame = sourceFrame(source)
  if (!frame) return []
  if (asCircle(source)) roles.push('circumcircle')
  else {
    const circles = shapeCircles(source, frame)
    if (circles) {
      roles.push('circumcircle')
      if (circles.in && Math.abs(circles.in.r - circles.circum.r) > 1e-6) roles.push('incircle')
    }
    if (source.carve) spokeAngles(source.carve).forEach((_, i) => roles.push(`axis-${i}`))
  }
  const lines: ConstructionLine[] = []
  for (const role of roles) {
    const line = lineInFrame(source, frame, role)
    if (!line || lines.some((each) => coincide(each.shape, line.shape))) continue
    lines.push(line)
  }
  // Spokes are numbered in order among those offered, with no gaps.
  let k = 0
  return lines.map((line) => (isSpoke(line.role) ? { ...line, name: spokeName(k++) } : line))
}

/** The guide a construction role gives on a shape, or null when the shape no longer has it. */
export function constructionShape(source: ConstructionSource, role: ConstructionRole): GuideShape | null {
  return constructionLine(source, role)?.shape ?? null
}

/**
 * The guide a construction role gives on a shape and what it is called there,
 * or null when the shape no longer has it. The follow pass reads both, so a
 * guide's name stays true as its shape turns.
 */
export function constructionLine(source: ConstructionSource, role: ConstructionRole): ConstructionLine | null {
  if (source.carve?.kind === 'band') return bandLines(source.carve).find((line) => line.role === role) ?? null
  const frame = sourceFrame(source)
  return frame && lineInFrame(source, frame, role)
}

function lineInFrame(source: ConstructionSource, frame: SourceFrame, role: ConstructionRole): ConstructionLine | null {
  const shape = shapeInFrame(source, frame, role)
  return shape && { role, shape, name: placedName(role, shape, frame.centre) }
}

/**
 * What a construction line is called where it lies, so the name reads true on
 * screen whatever the shape's turn or the way a groove was drawn: a centre
 * line by the way it runs, a bounds line by the side of the centre it lies
 * on. A line within 45° of flat counts as flat. Circles and spokes go by
 * their role.
 */
function placedName(role: ConstructionRole, shape: GuideShape, centre: Vec): string {
  if (shape.kind !== 'line') return roleName(role)
  const angle = lineAngle(shape.angle)
  const flat = angle <= 45 || angle > 135
  switch (role) {
    case 'centre-x':
    case 'centre-y':
      return roleName(flat ? 'centre-y' : 'centre-x')
    case 'top':
    case 'bottom':
    case 'left':
    case 'right': {
      const off = sub(nearestOnGuide(shape, centre).point, centre)
      const side = flat ? off.y : off.x
      if (Math.abs(side) < 1e-9) return roleName(role)
      return roleName(flat ? (side < 0 ? 'top' : 'bottom') : side < 0 ? 'left' : 'right')
    }
    default:
      return roleName(role)
  }
}

function shapeInFrame(source: ConstructionSource, frame: SourceFrame, role: ConstructionRole): GuideShape | null {
  const { centre, rotation, reach } = frame
  const along = (x: number, y: number) => add(centre, rotate({ x, y }, rotation))
  switch (role) {
    case 'centre-x':
      return lineShape(centre, rotation + 90)
    case 'centre-y':
      return lineShape(centre, rotation)
    case 'top':
      return lineShape(along(0, reach.minY), rotation)
    case 'bottom':
      return lineShape(along(0, reach.maxY), rotation)
    case 'left':
      return lineShape(along(reach.minX, 0), rotation + 90)
    case 'right':
      return lineShape(along(reach.maxX, 0), rotation + 90)
    case 'circumcircle':
    case 'incircle': {
      const circle = asCircle(source)
      if (circle) return { kind: 'circle', c: { ...circle.c }, r: circle.r }
      const circles = shapeCircles(source, frame)
      const chosen = circles && (role === 'circumcircle' ? circles.circum : circles.in)
      return chosen && chosen.r > 1e-6 ? { kind: 'circle', c: { ...chosen.c }, r: chosen.r } : null
    }
    default: {
      const index = Number(role.slice('axis-'.length))
      // A circle has no corners, so no spokes, whatever its recipe.
      if (!source.carve || !Number.isInteger(index) || asCircle(source)) return null
      const angle = spokeAngles(source.carve)[index]
      return angle === undefined ? null : lineShape(centre, angle)
    }
  }
}

/** A role in words, as it reads on an upright shape. */
export function roleName(role: ConstructionRole): string {
  switch (role) {
    case 'centre-x':
      return 'Centre ↕'
    case 'centre-y':
      return 'Centre ↔'
    case 'top':
      return 'Top'
    case 'right':
      return 'Right'
    case 'bottom':
      return 'Bottom'
    case 'left':
      return 'Left'
    case 'circumcircle':
      return 'Circumcircle'
    case 'incircle':
      return 'Incircle'
    case 'centre-line':
      return 'Centre line'
    case 'edge-1':
      return 'Edge 1'
    case 'edge-2':
      return 'Edge 2'
    default:
      return spokeName(Number(role.slice('axis-'.length)))
  }
}

/**
 * The construction lines of a band: the line through its circles' centres,
 * and its two edges, a belt's tangents, a bar's or strip's sides, a neck's
 * arc circles, named Arc 1 and Arc 2. None while its circles allow no fit.
 */
function bandLines(spec: BandSpec): ConstructionLine[] {
  const parts = bandParts(spec)
  if (!parts) return []
  const along = (Math.atan2(spec.b.c.y - spec.a.c.y, spec.b.c.x - spec.a.c.x) * 180) / Math.PI
  const lines: ConstructionLine[] = [{ role: 'centre-line', shape: lineShape(spec.a.c, along), name: roleName('centre-line') }]
  parts.edges.forEach((edge, k) => {
    const role: ConstructionRole = k === 0 ? 'edge-1' : 'edge-2'
    const shape: GuideShape = edge.kind === 'line' ? lineShape(edge.p, edge.angle) : { kind: 'circle', c: { ...edge.c }, r: edge.r }
    // A neck's edges are its arc circles, and named so.
    lines.push({ role, shape, name: edge.kind === 'circle' ? `Arc ${k + 1}` : roleName(role) })
  })
  return lines
}

/* ─── A frame touching circles ─── */

/**
 * The four upright lines that touch a set of circles from outside: the top
 * of the highest, the right of the rightmost, the bottom of the lowest and
 * the left of the leftmost. Each is the bounds line of the circle it touches,
 * so a guide linked to that circle with the same role keeps touching it.
 */
export function tangentFrame(circles: ReadonlyArray<{ id: string; circle: Circle }>): Array<{ of: string; role: ConstructionRole; shape: GuideShape }> {
  if (circles.length === 0) return []
  const pick = (score: (circle: Circle) => number) =>
    circles.reduce((best, each) => (score(each.circle) > score(best.circle) + 1e-9 ? each : best))
  const top = pick((circle) => -(circle.c.y - circle.r))
  const right = pick((circle) => circle.c.x + circle.r)
  const bottom = pick((circle) => circle.c.y + circle.r)
  const left = pick((circle) => -(circle.c.x - circle.r))
  return [
    { of: top.id, role: 'top', shape: lineShape({ x: top.circle.c.x, y: top.circle.c.y - top.circle.r }, 0) },
    { of: right.id, role: 'right', shape: lineShape({ x: right.circle.c.x + right.circle.r, y: right.circle.c.y }, 90) },
    { of: bottom.id, role: 'bottom', shape: lineShape({ x: bottom.circle.c.x, y: bottom.circle.c.y + bottom.circle.r }, 0) },
    { of: left.id, role: 'left', shape: lineShape({ x: left.circle.c.x - left.circle.r, y: left.circle.c.y }, 90) },
  ]
}

/* ─── New guides ─── */

/** A new guide, named `name`, or else by its role when it follows a shape, or else by its kind. */
export function makeGuide(shape: GuideShape, style: GuideStyle, link?: Guide['link'], name?: string): Guide {
  const called = name ?? (link ? roleName(link.role) : shape.kind === 'line' ? 'Line' : shape.kind === 'circle' ? 'Circle' : 'Path')
  const guide: Guide = { id: crypto.randomUUID(), name: called, visible: true, locked: false, style, shape }
  if (link) guide.link = link
  return guide
}

const isSpoke = (role: ConstructionRole): boolean => role.startsWith('axis-')

/** A role of the set about a shape's centre: its circles and its spokes. */
const isRadial = (role: ConstructionRole): boolean => role === 'circumcircle' || role === 'incircle' || isSpoke(role)

/** The name of the `k`th spoke a shape has, counting from 0 among those it has guides or lines for. */
function spokeName(k: number): string {
  return `Spoke ${k + 1}`
}

/** Every spoke a shape has, each through a pair of its corners, whether or not it lies on another of its lines. */
function spokeLines(source: ConstructionSource): ConstructionLine[] {
  if (!source.carve) return []
  return spokeAngles(source.carve).flatMap((_, i) => constructionLine(source, `axis-${i}`) ?? [])
}

/**
 * The guides with a shape's spokes made again, after its corners changed in
 * number as a polygon's do when it gains or loses a side. Spokes follow by
 * their index, so a new count needs the whole set: a spoke the shape still
 * has keeps its guide, moved through its corner; one it has lost goes; a new
 * one comes in the look of the first, where the first was. A spoke that lies
 * on one of the shape's centre-line guides, as a square's two do, is left
 * out, and comes back when a later count sets it apart again.
 *
 * The spokes are made whenever a guide of the shape's circles or spokes
 * follows it, so a hexagon stepped down through a square, which has no spoke
 * of its own, gets them back. A shape with none of those is given none, and
 * the same array comes back. `shape` is the shape as it is now.
 */
export function respokeGuides(guides: Guide[], shape: ConstructionSource & Pick<PathObject, 'id'>): Guide[] {
  const ofShape = (guide: Guide) => guide.link?.kind === 'construction' && guide.link.of === shape.id
  const linked = (guide: Guide) => ofShape(guide) && isSpoke(guide.link!.role)
  const radial = guides.filter((guide) => ofShape(guide) && isRadial(guide.link!.role))
  if (radial.length === 0) return guides
  const centres = guides.filter((guide) => ofShape(guide) && (guide.link!.role === 'centre-x' || guide.link!.role === 'centre-y'))
  const first = guides.findIndex(linked)
  const old = new Map(guides.filter(linked).map((guide) => [guide.link!.role, guide]))
  // The look of its first spoke, or else of its first circle.
  const template = first < 0 ? radial[0] : guides[first]
  const spokes = spokeLines(shape)
    .filter((line) => !centres.some((guide) => coincide(guide.shape, line.shape)))
    .map(({ role, shape: line }, k) => {
      const name = spokeName(k)
      const kept = old.get(role)
      if (kept) return sameGuideShape(kept.shape, line) && kept.name === name ? kept : { ...kept, shape: line, name }
      const made = makeGuide(line, template.style, { kind: 'construction', of: shape.id, role }, name)
      return { ...made, visible: template.visible, locked: template.locked }
    })
  const rest = guides.filter((guide) => !linked(guide))
  // With no spoke guide to take the place of, they go after the shape's last guide.
  const at = first < 0 ? rest.map(ofShape).lastIndexOf(true) + 1 : guides.slice(0, first).filter((guide) => !linked(guide)).length
  return [...rest.slice(0, at), ...spokes, ...rest.slice(at)]
}

/**
 * A guide described by what it is and its measure, as the drawer and the
 * selection bar show it: "Line · 60°", "Circle · r 65", "Path · 3 points",
 * and for one that follows a shape its role and the shape's number:
 * "Top · follows 02". `numberOf` gives a shape's number, or null when it is gone.
 */
export function describeGuide(guide: Guide, numberOf: (id: string) => string | null): { name: string; measure: string; follows: string | null } {
  const { shape } = guide
  const measure =
    shape.kind === 'line'
      ? `${lineReading(shape.angle)}°`
      : shape.kind === 'circle'
        ? `r ${Math.round(shape.r * 100) / 100}`
        : `${shape.contour.segments.length} ${shape.contour.segments.length === 1 ? 'point' : 'points'}`
  const follows = guide.link ? numberOf(guide.link.of) : null
  return { name: guide.name, measure, follows: follows && `follows ${follows}` }
}

/** A guide's row in the drawer: a short label that leads with what tells it apart, and its full text. */
export interface GuideRow {
  /** "Centre ↕", "Top", "Line 60°", "Circle r 65". */
  label: string
  /** The shape it follows, by number, and an ordinal where rows would otherwise read the same: "03", "2", "03 · 2". */
  tag: string | null
  /** Everything about it, for a title. */
  title: string
}

/**
 * The drawer's rows for some guides. A guide that follows a shape reads by
 * its role and the shape's number, "Top · 03"; a plain one by its kind and
 * measure. Rows that would read the same are numbered in order: plain guides
 * among those of their kind, "Line 60° · 2", and guides that follow the same
 * shape by the same role after the shape's number, "Top · 03 · 2".
 */
export function guideRows(guides: readonly Guide[], numberOf: (id: string) => string | null): GuideRow[] {
  const keyOf = (guide: Guide) => (guide.link ? `${guide.link.of} ${guide.link.role}` : guide.shape.kind)
  const counts = new Map<string, number>()
  for (const guide of guides) counts.set(keyOf(guide), (counts.get(keyOf(guide)) ?? 0) + 1)
  const seen = new Map<string, number>()
  return guides.map((guide) => {
    const { name, measure, follows } = describeGuide(guide, numberOf)
    const key = keyOf(guide)
    const ordinal = (seen.get(key) ?? 0) + 1
    seen.set(key, ordinal)
    const nth = (counts.get(key) ?? 0) > 1 ? String(ordinal) : null
    if (guide.link) {
      const of = numberOf(guide.link.of)
      const tag = [of, nth].filter(Boolean).join(' · ') || null
      return { label: name, tag, title: [nth ? `${name} ${nth}` : name, measure, follows].filter(Boolean).join(' · ') }
    }
    const label = `${name} ${measure}`
    return { label, tag: nth, title: nth ? `${name} ${nth} · ${measure}` : `${name} · ${measure}` }
  })
}

/**
 * The closed outline a guide draws, when it can be made a shape: a closed
 * path of three segments or more, or a circle as four arcs. Null otherwise.
 */
export function closedContourOf(shape: GuideShape): Contour | null {
  if (shape.kind === 'path') return shape.contour.closed && shape.contour.segments.length > 2 ? shape.contour : null
  if (shape.kind === 'circle') return shape.r > 0 ? circleContour(shape.c, shape.r) : null
  return null
}

/** A point on a guide to show it by: where a line passes `near`, the rim of a circle nearest it, a path's first point. */
export function guideAnchor(shape: GuideShape, near: Vec): Vec {
  if (shape.kind === 'path') return shape.contour.segments[0]?.point ?? near
  return nearestOnGuide(shape, near).point
}

/** A circle as a closed contour of four quarter arcs, for drawing it as a path. */
export function circleContour(c: Vec, r: number): Contour {
  const k = KAPPA * r
  const points = [0, 90, 180, 270].map((deg) => ({ at: add(c, rotate({ x: r, y: 0 }, deg)), tangent: rotate({ x: 0, y: k }, deg) }))
  return {
    closed: true,
    segments: points.map(({ at, tangent }) => ({ point: at, handleIn: scale(tangent, -1), handleOut: tangent })),
  }
}
