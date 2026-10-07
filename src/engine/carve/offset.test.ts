import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { cubicPoint, projectOnCubic, type Cubic, type Vec } from '../path/bezier.ts'
import { carveOutline } from './outline.ts'
import { offsetRecipe, offsetsExactly, OFFSET_MIN_SIZE } from './offset.ts'
import { polygonApothem, polygonCornerRadius, roundCarveSpec, slabSpec, type CarveSpec, type PolygonSpec } from './spec.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

/** Is a point inside a recipe's outline? */
function inside(spec: CarveSpec, p: Vec): boolean {
  scope.activate()
  const item = scope.PathItem.create(carveOutline(spec).pathData)
  const hit = item.contains(new scope.Point(p.x, p.y))
  item.remove()
  return hit
}

/** Points along a recipe's outline: a few on every curve. */
function samples(spec: CarveSpec, per = 12): Vec[] {
  return carveOutline(spec).curves.flatMap((curve) => Array.from({ length: per }, (_, i) => cubicPoint(curve, (i + 0.5) / per)))
}

function distanceTo(curves: readonly Cubic[], p: Vec): number {
  return Math.min(...curves.map((curve) => projectOnCubic(curve, p).distance))
}

/**
 * The offset oracle: every point of the copy's outline lies |d| from the
 * source's outline, on the outside for an outset and the inside for an
 * inset; and no point of the source's outline comes nearer the copy than
 * |d|, so nothing of the copy is missing. Arcs drawn as cubics stray from a
 * true circle by about 0.03% of their radius, so the tolerance grows with
 * the shape.
 */
function expectOffset(source: CarveSpec, d: number, tolerance = 0.12) {
  const copy = offsetRecipe(source, d)
  expect(copy).not.toBeNull()
  const sourceCurves = carveOutline(source).curves
  for (const p of samples(copy!)) {
    expect(Math.abs(distanceTo(sourceCurves, p) - Math.abs(d))).toBeLessThan(tolerance)
    expect(inside(source, p)).toBe(d < 0)
  }
  const copyCurves = carveOutline(copy!).curves
  for (const p of samples(source, 6)) expect(distanceTo(copyCurves, p)).toBeGreaterThan(Math.abs(d) - tolerance)
  return copy!
}

const centre = { x: 31, y: -17 }
const hexagon: PolygonSpec = { v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius: 200, rotation: 0, cornerRadius: 60 }

describe('an exact offset of a recipe', () => {
  it('grows and shrinks a circle slab and a circle punch by their radius', () => {
    const slab = slabSpec('circle', centre)
    expect(expectOffset(slab, 25)).toMatchObject({ kind: 'slab', width: 450, height: 450, radius: 225 })
    expect(expectOffset(slab, -55)).toMatchObject({ kind: 'slab', width: 290, height: 290, radius: 145 })
    const punch: CarveSpec = { v: 1, kind: 'punch', shape: 'circle', center: centre, radius: 48, rotation: 0 }
    expect(expectOffset(punch, 12)).toMatchObject({ kind: 'punch', shape: 'circle', radius: 60 })
    expect(expectOffset(punch, -20)).toMatchObject({ kind: 'punch', shape: 'circle', radius: 28 })
  })

  it('moves an unbent slab’s sides by d and its corners’ radius with them, sharp once an inset passes the radius', () => {
    const rounded = { ...slabSpec('rounded', centre), rotation: 20 }
    expect(expectOffset(rounded, 30)).toMatchObject({ width: 440, height: 440, radius: 120, rotation: 20 })
    expect(expectOffset(rounded, -40)).toMatchObject({ width: 300, height: 300, radius: 50 })
    expect(expectOffset(rounded, -120)).toMatchObject({ width: 140, height: 140, radius: 0 })
    const tall = slabSpec('tall', centre)
    expect(expectOffset(tall, -50)).toMatchObject({ width: 150, height: 330, radius: 75 })
    // A square's outset is rounded by the distance; its inset stays square.
    expect(expectOffset(slabSpec('square'), 18)).toMatchObject({ width: 416, height: 416, radius: 18 })
    expect(expectOffset(slabSpec('square'), -18)).toMatchObject({ width: 344, height: 344, radius: 0 })
    // A radius stored past half the shorter side counts as the radius drawn.
    expect(offsetRecipe({ ...tall, radius: 999 }, 10)).toMatchObject({ radius: 135 })
  })

  it('keeps a polygon’s corner centres: its radius moves by d / cos(π/n) and its rounding by d', () => {
    for (const sides of [3, 4, 5, 6, 8, 12]) {
      const polygon: PolygonSpec = { ...hexagon, center: centre, sides, rotation: 13, cornerRadius: 20 }
      for (const d of [35, -15, -45]) {
        const copy = expectOffset(polygon, d, 0.15) as PolygonSpec
        expect(copy.radius).toBeCloseTo(polygon.radius + d / Math.cos(Math.PI / sides), 9)
        expect(copy.cornerRadius).toBe(Math.max(20 + d, 0))
        expect(polygonApothem(copy) - polygonApothem(polygon)).toBeCloseTo(d, 9)
      }
    }
    // A fully round polygon stays fully round: a circle grows by d.
    const round = { ...hexagon, cornerRadius: polygonApothem(hexagon) }
    const grown = offsetRecipe(round, 30) as PolygonSpec
    expect(polygonCornerRadius(grown)).toBeCloseTo(polygonApothem(grown), 9)
  })

  it('makes ref 1’s ring: an inset of 55 on a hexagon rounded to 60 is 55 thick, its corners rounded to 5', () => {
    for (const radius of [200, 370, 260.5]) {
      const source = { ...hexagon, radius }
      const copy = roundCarveSpec(expectOffset(source, -55, 0.15)) as PolygonSpec
      expect(copy.cornerRadius).toBe(5)
      expect(Math.abs(polygonApothem(source) - polygonApothem(copy) - 55)).toBeLessThanOrEqual(0.01)
      // The corner circles stay where the source's are.
      const before = carveOutline(source).frame
      const after = carveOutline(copy).frame
      if (before.kind !== 'box' || after.kind !== 'box') throw new Error('a polygon has a box frame')
      before.cornerCircles.forEach((circle, k) => {
        expect(after.cornerCircles[k].c.x).toBeCloseTo(circle.c.x, 1)
        expect(after.cornerCircles[k].c.y).toBeCloseTo(circle.c.y, 1)
      })
    }
  })

  it('treats a square punch as a slab and a triangle punch as the polygon it draws', () => {
    const square: CarveSpec = { v: 1, kind: 'punch', shape: 'square', center: centre, radius: 40, rotation: 30 }
    expect(expectOffset(square, -10)).toMatchObject({ kind: 'punch', shape: 'square', radius: 30, rotation: 30 })
    expect(expectOffset(square, 10)).toMatchObject({ kind: 'slab', width: 100, height: 100, radius: 10, rotation: 30 })
    const triangle: CarveSpec = { v: 1, kind: 'punch', shape: 'triangle', center: centre, radius: 48, rotation: 15 }
    const grown = expectOffset(triangle, 9, 0.15) as PolygonSpec
    expect(grown).toMatchObject({ kind: 'polygon', sides: 3, rotation: 15, cornerRadius: 9 })
    expect(grown.radius).toBeCloseTo(60 + 9 / Math.cos(Math.PI / 3), 9)
    expect(expectOffset(triangle, -8, 0.15)).toMatchObject({ kind: 'polygon', sides: 3, cornerRadius: 0 })
  })

  it('widens and narrows a channel and slice by 2d, bent or not', () => {
    const channel: CarveSpec = { v: 1, kind: 'channel', from: { x: -120, y: 10 }, to: { x: 140, y: -30 }, width: 44 }
    expect(expectOffset(channel, 8)).toMatchObject({ width: 60 })
    expect(expectOffset(channel, -12)).toMatchObject({ width: 20 })
    expect(offsetRecipe({ ...channel, kind: 'slice' }, 5)).toMatchObject({ kind: 'slice', width: 54 })
    // A bent groove keeps its spine and bend: the copy is the groove 2d wider, as a bent channel draws it.
    const bend = { a1: 0, o1: 40, a2: 0, o2: 40 }
    for (const kind of ['channel', 'slice'] as const) {
      const bent: CarveSpec = { ...channel, kind, bend }
      expect(offsetsExactly(bent)).toBe(true)
      expect(offsetRecipe(bent, 6)).toEqual({ ...bent, width: 56 })
      expect(offsetRecipe(bent, -10)).toEqual({ ...bent, width: 24 })
      expect(offsetRecipe(bent, -22)).toBeNull()
    }
  })

  it('leaves nothing when an inset takes the whole shape, and leaves bent slabs and punches to the general method', () => {
    expect(offsetRecipe(slabSpec('circle'), -200)).toBeNull()
    expect(offsetRecipe(slabSpec('tall'), -125 + OFFSET_MIN_SIZE / 4)).toBeNull()
    expect(offsetRecipe({ v: 1, kind: 'punch', shape: 'circle', center: centre, radius: 10, rotation: 0 }, -9.8)).toBeNull()
    expect(offsetRecipe(hexagon, -polygonApothem(hexagon))).toBeNull()
    expect(offsetRecipe({ v: 1, kind: 'channel', from: centre, to: centre, width: 20 }, -10)).toBeNull()

    const bentSlab = { ...slabSpec('rounded'), sides: { top: { a1: 0, o1: 30, a2: 0, o2: 30 } } }
    const fullerCorner = { ...slabSpec('rounded'), corners: { tr: { k1: 1.4, k2: 1.4 } } }
    for (const spec of [bentSlab, fullerCorner]) {
      expect(offsetsExactly(spec)).toBe(false)
      expect(offsetRecipe(spec, 10)).toBeNull()
    }
    expect(offsetsExactly(hexagon)).toBe(true)
  })
})
