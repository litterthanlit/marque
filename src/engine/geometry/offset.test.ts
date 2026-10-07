import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { cubicPoint, distance, projectOnCubic, type Cubic, type Vec } from '../path/bezier.ts'
import { carveOutline } from '../carve/outline.ts'
import { offsetRecipe } from '../carve/offset.ts'
import { slabSpec, type CarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import type { Contour } from '../vector/types.ts'
import { offsetContours } from './offset.ts'

/** A recipe's outline as a free contour, as if drawn with the pen. */
function free(spec: CarveSpec): Contour {
  return segsToContour(carveOutline(spec).segs)
}

/** A contour's curves, from each point to the next, closing back to the first. */
function curvesOf(contour: Contour): Cubic[] {
  const n = contour.segments.length
  return contour.segments.map((segment, i) => {
    const next = contour.segments[(i + 1) % n]
    const p0 = segment.point
    const p3 = next.point
    const p1 = segment.handleOut ? { x: p0.x + segment.handleOut.x, y: p0.y + segment.handleOut.y } : p0
    const p2 = next.handleIn ? { x: p3.x + next.handleIn.x, y: p3.y + next.handleIn.y } : p3
    return [p0, p1, p2, p3] as Cubic
  })
}

function samples(curves: readonly Cubic[], per = 10): Vec[] {
  return curves.flatMap((curve) => Array.from({ length: per }, (_, i) => cubicPoint(curve, i / per)))
}

function distanceTo(curves: readonly Cubic[], p: Vec): number {
  return Math.min(...curves.map((curve) => projectOnCubic(curve, p).distance))
}

/** The furthest either outline strays from the other. */
function strayBetween(a: readonly Cubic[], b: readonly Cubic[]): number {
  return Math.max(...samples(a).map((p) => distanceTo(b, p)), ...samples(b).map((p) => distanceTo(a, p)))
}

const signedArea = (contour: Contour) => {
  const points = samples(curvesOf(contour), 8)
  let area = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]
    area += p.x * q.y - q.x * p.y
  })
  return area / 2
}


const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

/** Contours as one paper item, filled by a rule. */
function itemOf(contours: readonly Contour[], fillRule: 'nonzero' | 'evenodd'): paper.PathItem {
  scope.activate()
  const item = new scope.CompoundPath({
    children: contours.map((contour) => {
      const path = new scope.Path({ insert: false })
      for (const g of contour.segments) {
        path.add(new scope.Segment(new scope.Point(g.point.x, g.point.y), g.handleIn ? new scope.Point(g.handleIn.x, g.handleIn.y) : undefined, g.handleOut ? new scope.Point(g.handleOut.x, g.handleOut.y) : undefined))
      }
      path.closed = true
      return path
    }),
    insert: false,
  })
  item.fillRule = fillRule
  return item
}

/** Contours flattened finely, as rings of points, without resolving anything. */
function flatRings(contours: readonly Contour[]): Vec[][] {
  const item = itemOf(contours, 'nonzero')
  return (item.children as paper.Path[]).map((path) => {
    const flat = path.clone({ insert: false }) as paper.Path
    flat.flatten(0.01)
    return flat.segments.map((segment) => ({ x: segment.point.x, y: segment.point.y }))
  })
}

/** The winding of rings of points about a point. */
function windingOf(rings: readonly Vec[][], p: Vec): number {
  let w = 0
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
      if (a.y <= p.y) {
        if (b.y > p.y && side > 0) w++
      } else if (b.y <= p.y && side < 0) w--
    }
  }
  return w
}

/** Is a point filled by rings of points under a rule? */
function filledBy(rings: readonly Vec[][], fillRule: 'nonzero' | 'evenodd', p: Vec): boolean {
  const w = windingOf(rings, p)
  return fillRule === 'nonzero' ? w !== 0 : Math.abs(w) % 2 === 1
}

/**
 * The edge of what contours fill, read without paper's booleans: their
 * lines, flattened finely, cut into short pieces, kept where the winding
 * just off one side fills and just off the other does not. As short lines.
 */
function filledOutline(contours: readonly Contour[], fillRule: 'nonzero' | 'evenodd'): Vec[][] {
  const rings = flatRings(contours)
  const kept: Vec[][] = []
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1e-9) continue
      const n = { x: (-(b.y - a.y) / len) * 1e-4, y: ((b.x - a.x) / len) * 1e-4 }
      const pieces = Math.ceil(len / 0.25)
      let run: Vec[] | null = null
      for (let k = 0; k < pieces; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces }
        const q = { x: a.x + ((b.x - a.x) * (k + 1)) / pieces, y: a.y + ((b.y - a.y) * (k + 1)) / pieces }
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
        if (filledBy(rings, fillRule, { x: m.x + n.x, y: m.y + n.y }) !== filledBy(rings, fillRule, { x: m.x - n.x, y: m.y - n.y })) {
          if (run) run[1] = q
          else run = [p, q]
        } else if (run) {
          kept.push(run)
          run = null
        }
      }
      if (run) kept.push(run)
    }
  }
  return kept
}

/** How far a point lies from runs of points, each from one point to the next. */
function distanceToRuns(runs: readonly Vec[][], p: Vec): number {
  let best = Infinity
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i]
      const b = run[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t))
    }
  }
  return best
}

/**
 * The region oracle: on a lattice over the shape, a point is in the offset
 * exactly when it lies within d of what the source fills (outset), or
 * inside it and further than |d| from its edge (inset). Points within 0.6
 * of the true edge are not read. Every point of the result's outline lies
 * |d| from the source's within 0.5 as well. Fins, holes, notches and stray
 * islands all show as points on the wrong side.
 */
function expectRegion(contours: readonly Contour[], fillRule: 'nonzero' | 'evenodd', d: number, step = 3) {
  const result = offsetContours(contours, fillRule, d)
  const outline = filledOutline(contours, fillRule)
  const source = flatRings(contours)
  const made = result ? flatRings(result) : []
  const xs = source.flat().map((p) => p.x)
  const ys = source.flat().map((p) => p.y)
  const pad = Math.max(d, 0) + 5
  let wrong = 0
  for (let y = Math.min(...ys) - pad; y <= Math.max(...ys) + pad; y += step) {
    for (let x = Math.min(...xs) - pad; x <= Math.max(...xs) + pad; x += step) {
      const p = { x, y }
      const apart = distanceToRuns(outline, p)
      if (Math.abs(apart - Math.abs(d)) < 0.6) continue
      const inside = filledBy(source, fillRule, p)
      const want = d > 0 ? inside || apart < d : inside && apart > -d
      if (filledBy(made, 'evenodd', p) !== want) wrong++
    }
  }
  expect(wrong).toBe(0)
  for (const contour of result ?? []) {
    for (const p of samples(curvesOf(contour))) expect(Math.abs(distanceToRuns(outline, p) - Math.abs(d))).toBeLessThan(0.5)
  }
  return result
}

const sharp = (points: Array<[number, number]>): Contour => ({ closed: true, segments: points.map(([x, y]) => ({ point: { x, y }, handleIn: null, handleOut: null })) })

/** A closed smooth curve through points. */
function smooth(points: Array<[number, number]>): Contour {
  const n = points.length
  return {
    closed: true,
    segments: points.map(([x, y], i) => {
      const [ax, ay] = points[(i + n - 1) % n]
      const [bx, by] = points[(i + 1) % n]
      const t = { x: (bx - ax) / 6, y: (by - ay) / 6 }
      return { point: { x, y }, handleIn: { x: -t.x, y: -t.y }, handleOut: t }
    }),
  }
}

const circle = (c: Vec, r: number): CarveSpec => ({ v: 1, kind: 'punch', shape: 'circle', center: c, radius: r, rotation: 0 })

describe('the general offset', () => {
  it('stays within 0.5 units of the exact offset of a circle given as a free path', () => {
    const spec = circle({ x: 20, y: -30 }, 150)
    for (const d of [30, 7, -12, -90]) {
      const result = offsetContours([free(spec)], 'nonzero', d)
      expect(result).toHaveLength(1)
      for (const p of samples(curvesOf(result![0]))) expect(Math.abs(distance(p, { x: 20, y: -30 }) - (150 + d))).toBeLessThan(0.5)
      expect(strayBetween(curvesOf(result![0]), carveOutline(offsetRecipe(spec, d)!).curves)).toBeLessThan(0.5)
    }
  })

  it('stays within 0.5 units of the exact offset of a slab given as a free path, its sharp corners sharp', () => {
    for (const slab of [{ ...slabSpec('rounded'), rotation: 25 }, slabSpec('square'), slabSpec('tall')]) {
      for (const d of [40, -30, -100]) {
        const result = offsetContours([free(slab)], 'nonzero', d)
        expect(result).toHaveLength(1)
        expect(strayBetween(curvesOf(result![0]), carveOutline(offsetRecipe(slab, d)!).curves)).toBeLessThan(0.5)
      }
    }
    // An inset of a square keeps its four corners as points without handles.
    const inset = offsetContours([free(slabSpec('square'))], 'nonzero', -20)![0]
    const corners = inset.segments.filter((segment) => Math.abs(Math.abs(segment.point.x) - 170) < 0.01 && Math.abs(Math.abs(segment.point.y) - 170) < 0.01)
    expect(corners).toHaveLength(4)
    for (const corner of corners) expect(corner.handleIn === null && corner.handleOut === null).toBe(true)
  })

  it('keeps a hole as a contour of its own: an outset shrinks it, an inset grows it, and a large outset closes it', () => {
    // A ring as the editor stores one: the hole a second contour, read even-odd, whichever way it turns.
    const ring = [free(circle({ x: 0, y: 0 }, 200)), free(circle({ x: 0, y: 0 }, 100))]
    const out = offsetContours(ring, 'evenodd', 20)!
    expect(out).toHaveLength(2)
    const radii = out.map((contour) => Math.max(...samples(curvesOf(contour)).map((p) => Math.hypot(p.x, p.y)))).sort((a, b) => a - b)
    expect(radii[0]).toBeCloseTo(80, 0)
    expect(radii[1]).toBeCloseTo(220, 0)
    // The hole turns the other way from the outline, so either fill rule reads it as a hole.
    expect(Math.sign(signedArea(out[0]))).toBe(-Math.sign(signedArea(out[1])))
    const inset = offsetContours(ring, 'evenodd', -30)!
    expect(inset).toHaveLength(2)
    expect(offsetContours(ring, 'evenodd', 120)).toHaveLength(1)
  })

  it('drops the parts an inset takes away, and gives null when it takes everything', () => {
    // Two circles joined by a bar 20 wide: an inset of 15 leaves the circles apart, one of 70 only the larger.
    const big = free(circle({ x: -120, y: 0 }, 90))
    const small = free(circle({ x: 140, y: 0 }, 60))
    const bar = free({ v: 1, kind: 'channel', from: { x: -120, y: 0 }, to: { x: 140, y: 0 }, width: 20 })
    const united = offsetContours([big, bar, small], 'nonzero', 0)!
    expect(united).toHaveLength(1)
    expect(offsetContours([big, bar, small], 'nonzero', -15)).toHaveLength(2)
    expect(offsetContours([big, bar, small], 'nonzero', -70)).toHaveLength(1)
    expect(offsetContours([big, bar, small], 'nonzero', -95)).toBeNull()
    // An outset joins what was apart.
    expect(offsetContours([free(circle({ x: -60, y: 0 }, 50)), free(circle({ x: 60, y: 0 }, 50))], 'nonzero', 15)).toHaveLength(1)
  })

  it('reads a path that crosses itself by its fill rule, and leaves open contours out', () => {
    // A bow tie: two triangles meeting at the middle.
    const bow: Contour = {
      closed: true,
      segments: [
        { x: -100, y: -60 },
        { x: 100, y: 60 },
        { x: 100, y: -60 },
        { x: -100, y: 60 },
      ].map((point) => ({ point, handleIn: null, handleOut: null })),
    }
    expect(offsetContours([bow], 'nonzero', -5)).toHaveLength(2)
    expect(offsetContours([bow], 'nonzero', 10)).toHaveLength(1)
    expect(offsetContours([{ ...bow, closed: false }], 'nonzero', 10)).toBeNull()
  })
  it('fills the offsets of irregular stars whole: no notches or islands where short sides meet at the inner points', () => {
    const wide = sharp([[69.6, 5.6], [194.3, 59.7], [179.1, 113.8], [110, 125.2], [56.4, 120.4], [3.4, 43.9], [-18.2, 211.7], [-51.5, 132.2], [-103.5, 147.1], [-144.1, 121.4], [-191.8, 86.5], [-115.9, 20.3], [-107, -10.1], [-75.1, -25.8], [-89.4, -64.4], [-124.3, -166.1], [-76.2, -195.2], [-7.5, -40.8], [10.4, -66.5], [86.9, -173.7], [118.7, -127.9], [86.4, -51.8], [191, -50.2]])
    for (const d of [25, 105.6, -20]) expectRegion([wide], 'nonzero', d)
    const spiky = sharp([[215.6, 9.9], [176.2, 52.2], [52.7, 38], [125.6, 122.1], [23.4, 45.4], [27.5, 86.4], [4.5, 56], [-9.1, 78.8], [-55, 153.6], [-40.9, 67.1], [-62, 64.9], [-83.2, 53.9], [-92, 33.2], [-216.7, 10.2], [-205.4, -42.4], [-73, -28.2], [-47.9, -31.5], [-13.6, -8.3], [-40.9, -96.2], [-10.7, -64.8], [14.3, -120.4], [40.7, -99.9], [94.6, -127.6], [90.6, -72.8], [130.8, -59.3], [59.7, -4.9]])
    for (const d of [-33.4, -8, 104]) expectRegion([spiky], 'nonzero', d)
    // A path that crosses itself, inset until only part of it is left: not nothing.
    const crossing = sharp([[113, -162.1], [52.4, -1.4], [194.7, -82.1], [-123.4, 10.9], [-101.8, -138], [-74.9, 18], [-112.7, -76.3]])
    expect(expectRegion([crossing], 'nonzero', -36.8)).not.toBeNull()
  })

  it('offsets a pen bolt by 60, 80 and 120 without a notch', () => {
    const bolt = sharp([[-40, -150], [60, -150], [10, -30], [70, -30], [-50, 150], [0, 10], [-60, 10]])
    for (const d of [60, 80, 120, -8]) expectRegion([bolt], 'nonzero', d)
  })

  it('outsets a circle united with a turned square by 50: no fin and no hole where the circle meets the square', () => {
    const square = { v: 1, kind: 'slab', preset: 'square', center: { x: 120, y: 0 }, width: 120, height: 120, radius: 0, rotation: 30 } as CarveSpec
    const united = offsetContours([free(circle({ x: 0, y: 0 }, 100)), free(square)], 'nonzero', 0)!
    expect(united).toHaveLength(1)
    for (const d of [25, 50, -20]) expect(expectRegion(united, 'nonzero', d)).toHaveLength(1)
  })

  it('insets two overlapping blobs read as one shape, by either rule, without stray pieces', () => {
    const a = smooth([[-150, -20], [-90, -110], [10, -80], [30, 20], [-40, 90], [-130, 70]])
    const b = smooth([[150, 30], [110, 120], [10, 100], [-30, 10], [40, -70], [130, -60]].reverse() as Array<[number, number]>)
    for (const rule of ['nonzero', 'evenodd'] as const) for (const d of [-41.2, -15, 20]) expectRegion([a, b], rule, d)
  })

  it('insets two squares that meet along an edge as one shape, by either rule: neither part is lost', () => {
    const left = sharp([[0, 0], [50, 0], [50, 50], [0, 50]])
    const cases = [
      [left, sharp([[50, 0], [100, 0], [100, 50], [50, 50]])],
      [left, sharp([[50, 50], [100, 50], [100, 0], [50, 0]])],
      [left, sharp([[50, 20], [100, 20], [100, 70], [50, 70]])],
    ]
    for (const rule of ['nonzero', 'evenodd'] as const) {
      for (const contours of cases) {
        const inset = expectRegion(contours, rule, -5, 1)!
        expect(inset).toHaveLength(1)
        expect(Math.max(...inset[0].segments.map((segment) => segment.point.x))).toBeCloseTo(95, 1)
      }
    }
  })

  it('reads contours that share an edge and overlap as the mark fills them: no phantom holes, none lost', () => {
    const rect = (x: number, y: number, w: number, h: number) => sharp([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    // Two rectangles sharing part of an edge, and a third across the seam: once misread with a triangular hole.
    const seam = [rect(0, 0, 115.4, 110.1), rect(115.4, 35.3, 66.7, 93.9), rect(54.1, 110.1, 68.7, 68.5)]
    for (const d of [-23, -1.5, 10]) expect(expectRegion(seam, 'nonzero', d, 1.5)).toHaveLength(1)
    // Even-odd, where two of them overlap: the overlap is a rectangular hole, not a slanted one.
    const overlap = [rect(0, 0, 81.4, 47.5), rect(81.4, 14.3, 48, 102.5), rect(25.7, 47.5, 61.9, 44.5)]
    for (const d of [-23, -5.5, -1.5, 10]) expectRegion(overlap, 'evenodd', d, 1.5)
    // An L of two squares and a third over its inner corner: even-odd leaves the overlaps as one hole.
    const ell = [rect(0, 0, 100, 100), rect(0, 100, 50, 60), rect(30, 90, 50, 40)]
    for (const d of [-8, -1.5, 6]) expect(expectRegion(ell, 'evenodd', d, 1)).toHaveLength(2)
    for (const d of [-8, 6]) expect(expectRegion(ell, 'nonzero', d, 1)).toHaveLength(1)
  })

  it('keeps contours that nearly touch, thin strips and holes near an edge: no part lost, none read as empty', () => {
    const rect = (x: number, y: number, w: number, h: number) => sharp([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    // Two rectangles a hundredth apart, as two placed recipes rounded to hundredths can leave them.
    const apart = [rect(0, 0, 100, 100), rect(0, 100.01, 100, 99.99)]
    for (const rule of ['nonzero', 'evenodd'] as const) {
      expect(expectRegion(apart, rule, -5, 1.5)).toHaveLength(2)
      expect(expectRegion(apart, rule, 5, 1.5)).toHaveLength(1)
    }
    // A long, thin strip.
    expect(expectRegion([rect(0, 0, 600, 0.5)], 'nonzero', 2, 1)).toHaveLength(1)
    expect(expectRegion([rect(0, 0, 600, 0.5)], 'nonzero', 10, 2)).toHaveLength(1)
    // A hole 0.4 from a long edge.
    const holed = [rect(0, 0, 600, 100), rect(10, 0.4, 496, 20)]
    for (const d of [-0.1, 2, 10]) expectRegion(holed, 'evenodd', d, 2)
  })

  it('keeps contours a few hairs apart and circles that touch at a point: nothing read as empty', () => {
    const rect = (x: number, y: number, w: number, h: number) => sharp([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    // Two rectangles 2e-4 apart, as an imported mark rounded to four places can leave two edges that met.
    for (const gap of [0.00015, 0.0002, 0.00023]) {
      const apart = [rect(0, 0, 600, 150), rect(0, 150 + gap, 600, 150)]
      for (const rule of ['nonzero', 'evenodd'] as const) {
        expect(expectRegion(apart, rule, -5, 6)).toHaveLength(2)
        expect(expectRegion(apart, rule, 5, 6)).toHaveLength(1)
      }
    }
    // Two circles r 80 that touch, each drawn from its own start, whose flattened sides cross in a hair-thin lens.
    const turned = (c: Vec, r: number, start: number): Contour => ({
      closed: true,
      segments: [0, 1, 2, 3].map((i) => {
        const a = start + (i * Math.PI) / 2
        const t = { x: -Math.sin(a) * 0.5522847498 * r, y: Math.cos(a) * 0.5522847498 * r }
        return { point: { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }, handleIn: { x: -t.x, y: -t.y }, handleOut: t }
      }),
    })
    for (const [theta, s1, s2] of [[5.901255420872467, 0.21, 0.03], [5.035034013138727, 0.27, 1.11], [3.090695902873854, 0.78, 0.54]]) {
      const pair = [turned({ x: 300, y: 300 }, 80, s1), turned({ x: 300 + 160 * Math.cos(theta), y: 300 + 160 * Math.sin(theta) }, 80, s2)]
      expect(expectRegion(pair, 'nonzero', -10)).toHaveLength(2)
      expect(expectRegion(pair, 'nonzero', 6)).toHaveLength(1)
    }
  })

  it('outsets an S-bent channel by the general method, its spurs and all', () => {
    const bent: CarveSpec = { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 100, y: 0 }, width: 40, bend: { a1: 0, o1: 120, a2: 0, o2: -120 } }
    expect(expectRegion([free(bent)], 'nonzero', 40, 2)).toHaveLength(1)
  })

  it('closes a hole an outset passes the middle of, and empties a thin ring an inset passes', () => {
    const ring = [free(circle({ x: 0, y: 0 }, 150)), free(circle({ x: 10, y: 0 }, 60))]
    expect(expectRegion(ring, 'evenodd', 65)).toHaveLength(1)
    expect(offsetContours([free(circle({ x: 0, y: 0 }, 100)), free(circle({ x: 0, y: 0 }, 96))], 'evenodd', -2.5)).toBeNull()
  })

  it('takes tens of milliseconds, not seconds, for a wavy 400-point contour moved by 120', () => {
    const points: Array<[number, number]> = Array.from({ length: 400 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 400
      const r = 180 + 25 * Math.sin(80 * a)
      return [r * Math.cos(a), r * Math.sin(a)]
    })
    const wavy = smooth(points)
    offsetContours([wavy], 'nonzero', 5)
    const started = performance.now()
    expect(offsetContours([wavy], 'nonzero', 120)).toHaveLength(1)
    expect(offsetContours([wavy], 'nonzero', -60)).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})
