import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { add, cross, cubicPoint, distance, dot, normalize, rotate, scale, sub, type Vec } from '../path/bezier.ts'
import { recipePrimitives } from '../geometry/primitives.ts'
import { asCircle } from '../geometry/asCircle.ts'
import { carveKeyPoints, documentSizes } from '../snap/snapping.ts'
import type { IllustratorDocument } from '../illustrator/types.ts'
import { bandParts, bandWidth, neckCentres, partEnds, type BandPart } from './band.ts'
import { carveHandles, foldTransform, rotateCarveAbout, translateCarve } from './edit.ts'
import { offsetRecipe, offsetsExactly } from './offset.ts'
import { bandOuterPathData, carveOutline } from './outline.ts'
import { carveLayerName, describeCarve, isCarveSpec, roundCarveSpec, type BandSpec } from './spec.ts'
import { isObjectCarveValid, segsToContour } from './sync.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function areaOf(shape: paper.PathItem): number {
  return Math.abs((shape as unknown as { area: number }).area)
}

/** The band united with its two circles, as the mark composes them. */
function unionWithCircles(spec: BandSpec): paper.PathItem {
  scope.activate()
  const band = scope.PathItem.create(carveOutline(spec).pathData)
  const a = new scope.Path.Circle({ center: [spec.a.c.x, spec.a.c.y], radius: spec.a.r, insert: false })
  const b = new scope.Path.Circle({ center: [spec.b.c.x, spec.b.c.y], radius: spec.b.r, insert: false })
  return band.unite(a, { insert: false }).unite(b, { insert: false })
}

/** How many separate pieces a shape has, and its smallest piece's area: a sliver shows as a tiny one. */
function piecesOf(shape: paper.PathItem): { count: number; smallest: number } {
  const children = shape instanceof scope.CompoundPath ? (shape.children as paper.Path[]) : [shape as paper.Path]
  const areas = children.map((child) => Math.abs(child.area))
  return { count: children.length, smallest: Math.min(...areas) }
}

/** How far a point lies from the infinite line through a segment. */
function fromLine(p: Vec, a: Vec, b: Vec): number {
  return Math.abs(cross(sub(b, a), sub(p, a))) / distance(a, b)
}

const segments = (spec: BandSpec) => bandParts(spec)!.parts.filter((part): part is Extract<BandPart, { kind: 'segment' }> => part.kind === 'segment')
const arcs = (spec: BandSpec) => bandParts(spec)!.parts.filter((part): part is Extract<BandPart, { kind: 'arc' }> => part.kind === 'arc')

/** Twice the area the outline encloses, positive clockwise on screen. */
function signedArea(spec: BandSpec): number {
  const points = carveOutline(spec).curves.flatMap((curve) => Array.from({ length: 8 }, (_, i) => cubicPoint(curve, i / 8)))
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]
    return sum + p.x * q.y - q.x * p.y
  }, 0)
}

const band = (a: [number, number, number], b: [number, number, number], fit: BandSpec['fit'], extra: Partial<BandSpec> = {}): BandSpec => ({
  v: 1,
  kind: 'band',
  a: { c: { x: a[0], y: a[1] }, r: a[2] },
  b: { c: { x: b[0], y: b[1] }, r: b[2] },
  fit,
  ...extra,
})

/** Ref 4's big circle and circle C, as measured on the sheet, with radii of 100 and 65. */
const ref4 = band([347, 512, 100], [372, 723, 65], 'strip', { angle: 60, side: 1 })

/** Ref 2's right and bottom circles, their edges 40.9 apart. */
function ref2Neck(radius = 38): BandSpec {
  const a = { x: 565, y: 490 }
  const towards = normalize({ x: -134, y: 200 })
  const b = add(a, { x: towards.x * (91 + 110 + 40.9), y: towards.y * (91 + 110 + 40.9) })
  return band([a.x, a.y, 91], [b.x, b.y, 110], 'neck', { radius })
}

describe('a belt', () => {
  const pairs: Array<[[number, number, number], [number, number, number]]> = [
    [[0, 0, 100], [300, 40, 60]],
    [[-50, 20, 40], [120, -200, 140]],
    [[10, 10, 80], [10, 260, 80]],
    [[0, 0, 30], [70, 0, 90]],
  ]

  it('runs along both outer tangents, each touching both circles, and round the far side of each', () => {
    for (const [a, b] of pairs) {
      const spec = band(a, b, 'belt')
      for (const edge of segments(spec)) {
        expect(fromLine(spec.a.c, edge.a, edge.b)).toBeCloseTo(spec.a.r, 6)
        expect(fromLine(spec.b.c, edge.a, edge.b)).toBeCloseTo(spec.b.r, 6)
        // It ends where it touches: one end on each circle.
        const on = (p: Vec, end: BandSpec['a']) => Math.abs(distance(p, end.c) - end.r) < 1e-6
        expect((on(edge.a, spec.a) && on(edge.b, spec.b)) || (on(edge.a, spec.b) && on(edge.b, spec.a))).toBe(true)
      }
      const round = arcs(spec)
      expect(round.map((arc) => arc.r).sort()).toEqual([spec.a.r, spec.b.r].sort())
      expect(signedArea(spec)).toBeGreaterThan(0)
    }
  })

  it('wraps its circles: united with them it is one piece of its own area', () => {
    for (const [a, b] of pairs) {
      const spec = band(a, b, 'belt')
      const union = unionWithCircles(spec)
      expect(piecesOf(union).count).toBe(1)
      const own = areaOf(scope.PathItem.create(carveOutline(spec).pathData))
      expect(Math.abs(areaOf(union) - own) / own).toBeLessThan(1e-3)
    }
  })

  it('needs one circle not inside the other; equal circles are fine', () => {
    expect(bandParts(band([0, 0, 100], [30, 0, 60], 'belt'))).toBeNull()
    expect(bandParts(band([0, 0, 100], [40, 0, 60], 'belt'))).toBeNull()
    expect(bandParts(band([0, 0, 100], [40.01, 0, 60], 'belt'))).not.toBeNull()
    expect(bandParts(band([0, 0, 50], [0, 0, 50], 'belt'))).toBeNull()
    expect(bandParts(band([0, 0, 50], [1, 0, 50], 'belt'))).not.toBeNull()
    expect(carveOutline(band([0, 0, 100], [30, 0, 60], 'belt')).segs).toEqual([])
  })
})

describe('a bar', () => {
  it('is a channel of its width from centre to centre, its caps half circles about the centres', () => {
    const spec = band([0, 0, 90], [260, -80, 70], 'bar', { width: 40 })
    for (const edge of segments(spec)) {
      expect(fromLine(spec.a.c, edge.a, edge.b)).toBeCloseTo(20, 9)
      expect(fromLine(spec.b.c, edge.a, edge.b)).toBeCloseTo(20, 9)
    }
    expect(arcs(spec).map((arc) => [arc.c, arc.r, Math.abs(arc.sweep)])).toEqual([
      [expect.anything(), 20, Math.PI],
      [expect.anything(), 20, Math.PI],
    ])
    expect(bandWidth(spec)).toBe(40)
    expect(signedArea(spec)).toBeGreaterThan(0)
  })

  it('joins its circles into one piece, with nothing poking out while it is narrower than both', () => {
    const spec = band([0, 0, 90], [260, -80, 70], 'bar', { width: 40 })
    const union = unionWithCircles(spec)
    expect(piecesOf(union).count).toBe(1)
    // The channel between the circles: its area outside them, two strips of the gap's length.
    scope.activate()
    const circles = new scope.Path.Circle({ center: [0, 0], radius: 90, insert: false }).unite(new scope.Path.Circle({ center: [260, -80], radius: 70, insert: false }), { insert: false })
    const gap = distance(spec.a.c, spec.b.c) - 90 - 70
    expect(areaOf(union) - areaOf(circles)).toBeGreaterThan(40 * gap * 0.99)
    expect(areaOf(union) - areaOf(circles)).toBeLessThan(40 * (gap + 10))
  })

  it('needs its centres apart and a width', () => {
    expect(bandParts(band([5, 5, 50], [5, 5, 30], 'bar', { width: 40 }))).toBeNull()
    expect(isCarveSpec(band([0, 0, 50], [100, 0, 30], 'bar'))).toBe(false)
    expect(isCarveSpec(band([0, 0, 50], [100, 0, 30], 'bar', { width: 0 }))).toBe(false)
  })
})

describe('a strip', () => {
  it("at ref 4's 60° is 81.2 wide, each edge touching its own circle on opposite sides", () => {
    expect(bandWidth(ref4)).toBeCloseTo(81.2, 1)
    const [touchA, touchB] = bandParts(ref4)!.touches
    expect(distance(touchA, ref4.a.c)).toBeCloseTo(100, 9)
    expect(distance(touchB, ref4.b.c)).toBeCloseTo(65, 9)
    const along = rotate({ x: 1, y: 0 }, 60)
    // Each edge runs at 60°, and the circle's radius is square to it at the touch point.
    expect(dot(sub(touchA, ref4.a.c), along)).toBeCloseTo(0, 9)
    expect(dot(sub(touchB, ref4.b.c), along)).toBeCloseTo(0, 9)
    const edges = segments(ref4).filter((edge) => Math.abs(cross(normalize(sub(edge.b, edge.a)), along)) < 1e-9)
    expect(edges).toHaveLength(2)
    expect(edges.some((edge) => Math.abs(fromLine(ref4.a.c, edge.a, edge.b) - 100) < 1e-6)).toBe(true)
    expect(edges.some((edge) => Math.abs(fromLine(ref4.b.c, edge.a, edge.b) - 65) < 1e-6)).toBe(true)
    expect(signedArea(ref4)).toBeGreaterThan(0)
  })

  it('stays tangent within a hundredth once stored, rounded to hundredths', () => {
    const stored = roundCarveSpec({ ...ref4, a: { c: { x: 347.123, y: 512.987 }, r: 100.456 } }) as BandSpec
    const outline = carveOutline(stored)
    expect(isObjectCarveValid(stored, [segsToContour(outline.segs)])).toBe(true)
    const edges = outline.curves.filter((curve) => distance(curve[0], curve[1]) < 1e-9 || distance(curve[0], curve[3]) > 1)
    const touches = (end: BandSpec['a']) => edges.some((curve) => Math.abs(fromLine(end.c, curve[0], curve[3]) - end.r) < 0.01)
    expect(touches(stored.a)).toBe(true)
    expect(touches(stored.b)).toBe(true)
  })

  it('unites with its circles into one piece, with no sliver', () => {
    const { count, smallest } = piecesOf(unionWithCircles(ref4))
    expect(count).toBe(1)
    expect(smallest).toBeGreaterThan(1000)
  })

  it('has no fit flipped onto the other sides of these circles, where its edges would cross or miss', () => {
    expect(bandParts({ ...ref4, side: -1 })).toBeNull()
    // Turned flat, a's edge passes clear of b: its end would stick out of b.
    expect(bandParts({ ...ref4, angle: 0 })).toBeNull()
    // Along the line between the centres it reaches no length.
    expect(bandParts(band([0, 0, 50], [0, 100, 50], 'strip', { angle: 0, side: 1 }))).toBeNull()
    expect(describeCarve({ ...ref4, side: -1 })).toBe('Band · strip · no fit')
  })
})

describe('a neck', () => {
  it("between ref 2's circles 40.9 apart takes arcs of 38, each touching both circles from outside", () => {
    const spec = ref2Neck()
    const centres = neckCentres(spec.a, spec.b, 38)!
    for (const p of centres) {
      expect(distance(p, spec.a.c)).toBeCloseTo(91 + 38, 9)
      expect(distance(p, spec.b.c)).toBeCloseTo(110 + 38, 9)
    }
    const round = arcs(spec)
    expect(round).toHaveLength(2)
    for (const arc of round) {
      expect(arc.r).toBe(38)
      const [from, to] = partEnds(arc)
      // Its ends are where it touches the circles: on them, on the line to their centres.
      const ends = [from, to].map((p) => [Math.abs(distance(p, spec.a.c) - 91), Math.abs(distance(p, spec.b.c) - 110)])
      expect(ends.some(([onA]) => onA < 1e-9)).toBe(true)
      expect(ends.some(([, onB]) => onB < 1e-9)).toBe(true)
    }
    expect(bandWidth(spec)).toBeGreaterThan(40)
    expect(signedArea(spec)).toBeGreaterThan(0)
  })

  it('makes the circles one piece, with no sliver', () => {
    const { count, smallest } = piecesOf(unionWithCircles(ref2Neck()))
    expect(count).toBe(1)
    expect(smallest).toBeGreaterThan(1000)
  })

  it('needs arcs large enough to reach both circles, and small enough to leave a waist', () => {
    // 2ρ under the gap: the arcs cannot touch both.
    expect(bandParts(ref2Neck(20))).toBeNull()
    // Just over half the gap the arcs reach both, but cross over the middle: no waist, until about 22.55.
    expect(bandParts(ref2Neck(20.5))).toBeNull()
    expect(bandParts(ref2Neck(22.5))).toBeNull()
    expect(bandParts(ref2Neck(22.6))).not.toBeNull()
    expect(bandParts(band([0, 0, 100], [20, 0, 50], 'neck', { radius: 30 }))).toBeNull()
    expect(bandParts(ref2Neck(300))).not.toBeNull()
  })
})

/** A seeded stream of numbers in [0, 1), so a failure can be run again. */
function numbers(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** Twice a polygon's area by the shoelace, either way round. */
function polygonArea(points: Vec[]): number {
  return Math.abs(points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0)) / 2
}

/**
 * Each fit's area from first principles, worked out apart from band.ts:
 * - belt: the hull of the circles, a sector of each (2π − 2φ about a, 2φ
 *   about b) and the two right trapezoids between the centres and the
 *   tangent points, ½(r_a + r_b)·L each, L the tangent's length;
 * - bar: a stadium, d·w + π(w/2)²;
 * - strip: a rectangle, the centres' distance along θ times the edges'
 *   distance across it, r_a + r_b less how far b lies across from a;
 * - neck: the quadrilateral of the four touch points less the two circular
 *   segments the concave arcs cut from it, ½ρ²(α − sin α) each, the arcs'
 *   centres found by the law of cosines.
 */
function areaOracle(spec: BandSpec): number {
  const { a, b } = spec
  const d = distance(a.c, b.c)
  switch (spec.fit) {
    case 'belt': {
      const phi = Math.acos((a.r - b.r) / d)
      const tangent = Math.sqrt(d * d - (a.r - b.r) ** 2)
      return 0.5 * a.r * a.r * (2 * Math.PI - 2 * phi) + 0.5 * b.r * b.r * 2 * phi + (a.r + b.r) * tangent
    }
    case 'bar': {
      const w = spec.width!
      return d * w + Math.PI * (w / 2) ** 2
    }
    case 'strip': {
      const theta = (spec.angle! * Math.PI) / 180
      const t = { x: Math.cos(theta), y: Math.sin(theta) }
      const n = { x: -t.y, y: t.x }
      const across = (spec.side ?? 1) * dot(n, sub(b.c, a.c))
      return Math.abs(dot(t, sub(b.c, a.c))) * (a.r + b.r - across)
    }
    case 'neck': {
      const rho = spec.radius!
      const ra = a.r + rho
      const rb = b.r + rho
      const u = scale(sub(b.c, a.c), 1 / d)
      const cosA = (d * d + ra * ra - rb * rb) / (2 * d * ra)
      const centres = [1, -1].map((k) => add(a.c, scale(rotate(u, (k * Math.acos(cosA) * 180) / Math.PI), ra)))
      const touches = centres.map((p) => [add(a.c, scale(sub(p, a.c), a.r / ra)), add(b.c, scale(sub(p, b.c), b.r / rb))])
      const quad = polygonArea([touches[0][0], touches[0][1], touches[1][1], touches[1][0]])
      const segment = (p: Vec, [ta, tb]: Vec[]) => {
        const alpha = Math.acos(Math.max(-1, Math.min(1, dot(sub(ta, p), sub(tb, p)) / (rho * rho))))
        return 0.5 * rho * rho * (alpha - Math.sin(alpha))
      }
      return quad - segment(centres[0], touches[0]) - segment(centres[1], touches[1])
    }
    default:
      return spec.fit satisfies never
  }
}

/** Is a band's outline tangent to its circles where it should be: a belt's sides and a strip's edges to theirs, a neck's arcs to both? */
function touchesItsCircles(spec: BandSpec): boolean {
  const parts = bandParts(spec)!
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6 * Math.max(1, Math.abs(y))
  const lines = parts.parts.filter((part): part is Extract<BandPart, { kind: 'segment' }> => part.kind === 'segment' && !part.inside)
  switch (spec.fit) {
    case 'belt':
      return lines.length === 2 && lines.every((line) => near(fromLine(spec.a.c, line.a, line.b), spec.a.r) && near(fromLine(spec.b.c, line.a, line.b), spec.b.r))
    case 'strip':
      return lines.length === 2 && lines.some((line) => near(fromLine(spec.a.c, line.a, line.b), spec.a.r)) && lines.some((line) => near(fromLine(spec.b.c, line.a, line.b), spec.b.r))
    case 'neck':
      return parts.circles.every((arc) => near(distance(arc.c, spec.a.c), spec.a.r + arc.r) && near(distance(arc.c, spec.b.c), spec.b.r + arc.r))
    case 'bar':
      return true
    default:
      return spec.fit satisfies never
  }
}

describe('every fit, at random', () => {
  it("matches its area oracle on ref 4's strip and ref 2's neck", () => {
    for (const spec of [ref4, ref2Neck(), ref2Neck(60)]) {
      scope.activate()
      const drawn = areaOf(scope.PathItem.create(carveOutline(spec).pathData))
      expect(Math.abs(drawn - areaOracle(spec)) / areaOracle(spec)).toBeLessThan(1e-3)
    }
    // Ref 4's strip: 81.2 wide, as long as the centres lie apart along 60°.
    expect(areaOracle(ref4)).toBeCloseTo(81.15 * Math.abs(dot({ x: Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) }, sub(ref4.b.c, ref4.a.c))), -1)
  })

  it.each(['belt', 'bar', 'strip', 'neck'] as const)('%s: matches its area oracle, touches its circles, and is one closed ring that crosses itself nowhere', (fit) => {
    const next = numbers(20261007 + fit.length)
    let tried = 0
    let fitted = 0
    while (fitted < 60 && tried < 4000) {
      tried++
      const ra = 10 + next() * 150
      const rb = 10 + next() * 150
      const along = next() * 2 * Math.PI
      const d = (fit === 'belt' ? Math.abs(ra - rb) : 0) + 1 + next() * 400
      const a = { x: next() * 400 - 200, y: next() * 400 - 200 }
      const spec = band([a.x, a.y, ra], [a.x + d * Math.cos(along), a.y + d * Math.sin(along), rb], fit, {
        width: 2 + next() * 120,
        angle: Math.floor(next() * 180),
        side: next() < 0.5 ? 1 : -1,
        radius: 2 + next() * 250,
      })
      if (!bandParts(spec)) continue
      fitted++
      const expected = areaOracle(spec)
      scope.activate()
      const drawn = scope.PathItem.create(carveOutline(spec).pathData)
      const label = JSON.stringify(spec)
      // Arcs as cubics bulge by up to 0.027% of their radius; straight fits are exact.
      expect(Math.abs(areaOf(drawn) - expected), label).toBeLessThan(1e-3 * expected + 0.05)
      expect(signedArea(spec), label).toBeGreaterThan(0)
      expect(touchesItsCircles(spec), label).toBe(true)
      expect(drawn instanceof scope.Path && drawn.closed, label).toBe(true)
      expect((drawn as paper.Path).getIntersections(drawn as paper.Path).filter((hit) => !hit.isTouching()).length, label).toBe(0)
      // The construction look strokes only what lies outside both circles; a belt lies outside whole.
      const outer = bandOuterPathData(spec)
      if (fit === 'belt') expect(outer, label).toBeNull()
      else {
        const stroke = scope.PathItem.create(outer!)
        const pieces = (stroke instanceof scope.CompoundPath ? stroke.children : [stroke]) as paper.Path[]
        for (const piece of pieces.filter((each) => each.length > 0)) {
          for (let k = 0; k <= 20; k++) {
            const p = piece.getPointAt(Math.min((piece.length * k) / 20, piece.length * (1 - 1e-9)))
            for (const end of [spec.a, spec.b]) expect(distance({ x: p.x, y: p.y }, end.c), label).toBeGreaterThan(end.r - 0.01)
          }
        }
      }
    }
    expect(fitted).toBe(60)
  })
})

describe('a band as a recipe', () => {
  const samples = [band([0, 0, 100], [300, 40, 60], 'belt'), band([0, 0, 90], [260, -80, 70], 'bar', { width: 40 }), ref4, ref2Neck()]

  it('is checked, rounded, named and described', () => {
    for (const spec of samples) {
      expect(isCarveSpec(spec)).toBe(true)
      expect(carveLayerName(spec)).toBe(`Band · ${spec.fit}`)
      expect(describeCarve(spec).startsWith(`Band · ${spec.fit}`)).toBe(true)
      expect(roundCarveSpec(spec)).toMatchObject({ kind: 'band', fit: spec.fit })
    }
    expect(describeCarve(samples[1])).toBe('Band · bar · 40 wide')
    expect(describeCarve(ref4)).toBe('Band · strip · 60° · 81 wide')
    expect(describeCarve(samples[3])).toBe('Band · neck · r 38')
    expect(isCarveSpec({ ...ref4, fit: 'spline' })).toBe(false)
    expect(isCarveSpec({ ...ref4, side: 0 })).toBe(false)
    expect(isCarveSpec({ ...ref4, a: { c: ref4.a.c, r: 0 } })).toBe(false)
    // A strip's angle is kept in [0°, 180°): turned half round, its side flipped, it is the same strip.
    expect(roundCarveSpec({ ...ref4, angle: 240 })).toMatchObject({ angle: 60, side: -1 })
    expect(roundCarveSpec({ ...ref4, angle: -30 })).toMatchObject({ angle: 150, side: -1 })
    expect(roundCarveSpec({ ...ref4, angle: 179.999 })).toMatchObject({ angle: 0, side: -1 })
    expect(bandParts(roundCarveSpec({ ...ref4, angle: 240, side: -1 }) as BandSpec)!.parts.length).toBe(4)
  })

  it('has no handles, is never a circle, and offers exact edges and arcs to snap to', () => {
    for (const spec of samples) {
      expect(carveHandles(spec)).toEqual([])
      expect(asCircle({ carve: spec, contours: [] })).toBeNull()
      const pieces = recipePrimitives(spec, 'band')
      expect(pieces.every((piece) => piece.kind === 'segment' || piece.kind === 'arc')).toBe(true)
      expect(pieces).toHaveLength(bandParts(spec)!.parts.length)
    }
    // The neck's arcs, read as pieces, touch both circles.
    for (const piece of recipePrimitives(samples[3], 'band')) {
      if (piece.kind !== 'arc') continue
      expect(distance(piece.c, samples[3].a.c)).toBeCloseTo(91 + 38, 9)
      expect(piece.end).toBeGreaterThan(piece.start)
    }
    const points = carveKeyPoints(ref4, 'band')
    expect(points[0]).toMatchObject({ kind: 'centre', p: { x: (347 + 372) / 2, y: (512 + 723) / 2 } })
    expect(points.filter((point) => point.kind === 'point')).toHaveLength(2)
  })

  it("offers a bar's and a strip's width as a size, as a groove's", () => {
    const layer = (id: string, carve: BandSpec) => ({ id, name: id, operation: 'add', visible: true, locked: false, pathData: carveOutline(carve).pathData, fillRule: 'evenodd', transform: { dx: 0, dy: 0, scale: 1, rotation: 0 }, carve })
    const doc = { layers: [layer('bar', samples[1]), layer('strip', ref4), layer('belt', samples[0])], guides: [] } as unknown as IllustratorDocument
    const widths = documentSizes(doc, new Set()).widths
    expect(widths[0]).toBe(40)
    expect(widths[1]).toBeCloseTo(81.2, 1)
    expect(widths).toHaveLength(2)
  })

  it('moves, turns and scales as its circles would', () => {
    const moved = translateCarve(ref4, { x: 10, y: -5 }) as BandSpec
    expect(moved.a.c).toEqual({ x: 357, y: 507 })
    expect(moved.b.c).toEqual({ x: 382, y: 718 })
    const turned = rotateCarveAbout(ref4, { x: 0, y: 0 }, 30) as BandSpec
    expect(turned.angle).toBe(90)
    expect(bandWidth(turned)).toBeCloseTo(bandWidth(ref4)!, 9)
    const scaled = foldTransform(ref4, { dx: 0, dy: 0, scale: 2, rotation: 0 }, { x: 0, y: 0 }) as BandSpec
    expect(scaled.a.r).toBe(200)
    expect(bandWidth(scaled)).toBeCloseTo(2 * bandWidth(ref4)!, 9)
  })

  it('offsets as the band between its circles offset alike', () => {
    for (const spec of samples) expect(offsetsExactly(spec)).toBe(true)
    const belt = offsetRecipe(samples[0], 12) as BandSpec
    expect([belt.a.r, belt.b.r]).toEqual([112, 72])
    // A belt wraps its circles, so the copy is its exact offset: every edge 12 out.
    for (const edge of segments(belt)) expect(fromLine(belt.a.c, edge.a, edge.b)).toBeCloseTo(112, 6)
    expect((offsetRecipe(samples[1], -5) as BandSpec).width).toBe(30)
    const strip = offsetRecipe(ref4, 10) as BandSpec
    expect(bandWidth(strip)).toBeCloseTo(bandWidth(ref4)! + 20, 9)
    const neck = offsetRecipe(samples[3], 8) as BandSpec
    expect(neck).toMatchObject({ a: { r: 99 }, b: { r: 118 }, radius: 30 })
    // The arcs keep their centres.
    expect(neckCentres(neck.a, neck.b, 30)![0].x).toBeCloseTo(neckCentres(samples[3].a, samples[3].b, 38)![0].x, 9)
    // An arc taken to nothing, or a circle, leaves nothing.
    expect(offsetRecipe(samples[3], 38)).toBeNull()
    expect(offsetRecipe(samples[1], -20)).toBeNull()
    expect(offsetRecipe(samples[0], -60)).toBeNull()
  })
})
