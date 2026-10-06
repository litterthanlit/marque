import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { rollSparks, sparkLayers } from '../sparks/sparks.ts'
import { objectFromLayer } from '../../store/objectEdits.ts'
import { circleContour } from '../vector/guides.ts'
import type { Contour } from '../vector/types.ts'
import { asCircle, fitCircle } from './asCircle.ts'

const recipe = (carve: CarveSpec) => ({ carve, contours: [segsToContour(carveOutline(carve).segs)] })
const free = (contours: Contour[]) => ({ contours })

describe('reading an object as a circle', () => {
  it('reads a circle slab by its recipe, wherever it sits', () => {
    const spec = { ...slabSpec('circle'), center: { x: 40, y: -20 } }
    expect(asCircle(recipe(spec))).toEqual({ c: { x: 40, y: -20 }, r: 200 })
  })

  it('reads a square slab whose corner radius is at least half its width as a circle', () => {
    expect(asCircle(recipe({ ...slabSpec('square'), radius: 400 }))).toEqual({ c: { x: 0, y: 0 }, r: 190 })
    expect(asCircle(recipe(slabSpec('rounded')))).toBeNull()
    expect(asCircle(recipe(slabSpec('tall')))).toBeNull()
  })

  it('reads an unbent circle punch, and no other punch', () => {
    const punch: CarveSpec = { v: 1, kind: 'punch', shape: 'circle', center: { x: 5, y: 6 }, radius: 30, rotation: 0 }
    expect(asCircle(recipe(punch))).toEqual({ c: { x: 5, y: 6 }, r: 30 })
    expect(asCircle(recipe({ ...punch, shape: 'square' }))).toBeNull()
    expect(asCircle(recipe({ ...punch, shape: 'triangle' }))).toBeNull()
    expect(asCircle(recipe({ ...punch, sides: { top: { a1: 0, o1: 10, a2: 0, o2: 10 } } }))).toBeNull()
  })

  it('reads a free closed contour of circular arcs as a circle, and a polygon or an open arc as none', () => {
    const circle = asCircle(free([circleContour({ x: 100, y: 50 }, 80)]))
    expect(circle?.c.x).toBeCloseTo(100, 6)
    expect(circle?.c.y).toBeCloseTo(50, 6)
    expect(circle?.r).toBeCloseTo(80, 6)
    const square: Contour = {
      closed: true,
      segments: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
        { point: { x: 10, y: 0 }, handleIn: null, handleOut: null },
        { point: { x: 10, y: 10 }, handleIn: null, handleOut: null },
        { point: { x: 0, y: 10 }, handleIn: null, handleOut: null },
      ],
    }
    expect(asCircle(free([square]))).toBeNull()
    expect(asCircle(free([{ ...circleContour({ x: 0, y: 0 }, 80), closed: false }]))).toBeNull()
    expect(asCircle(free([circleContour({ x: 0, y: 0 }, 80), circleContour({ x: 0, y: 0 }, 40)]))).toBeNull()
  })

  it('reads a circle drawn slightly squashed as none, past the tolerance', () => {
    const contour = circleContour({ x: 0, y: 0 }, 100)
    const squashed: Contour = { ...contour, segments: contour.segments.map((s) => ({ ...s, point: { x: s.point.x, y: s.point.y * 1.01 } })) }
    expect(asCircle(free([squashed]))).toBeNull()
  })

  it('reads a spark circle, which carries no recipe, as a circle', () => {
    const found = rollSparks(8, 1)
      .concat(rollSparks(8, 2))
      .flatMap((spark) => sparkLayers(spark, { center: { x: 0, y: 0 }, span: 360 }))
      .map((layer) => objectFromLayer(layer))
      .map((object) => ({ object, circle: asCircle(object) }))
      .filter((entry) => entry.circle !== null)
    expect(found.length).toBeGreaterThan(0)
    for (const { object, circle } of found) {
      expect(object.carve).toBeUndefined()
      const xs = object.contours[0].segments.map((segment) => segment.point.x)
      // The anchors of a spark circle reach out to its rim on both sides.
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * circle!.r, 0)
    }
  })

  it('fits no circle to points in a line', () => {
    expect(fitCircle([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull()
  })
})
