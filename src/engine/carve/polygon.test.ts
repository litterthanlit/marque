import paper from 'paper'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { add, cross, distance, dot, normalize, rotate, scale, sub, type Vec } from '../path/bezier.ts'
import { DEFAULT_HANDLE_LAYOUT } from '../box/box.ts'
import type { IllustratorDocument, IllustratorLayer } from '../illustrator/types.ts'
import { DEFAULT_PARAMS } from '../types.ts'
import {
  bendCarve,
  carveHandles,
  carveUnderAffine,
  dragCarveHandle,
  foldTransform,
  isSideBent,
  locateCarveGrab,
  rotateCarveAbout,
  scaleCarveAbout,
  stepPolygonSides,
  translateCarve,
  wholeCarveDrag,
} from './edit.ts'
import { carveOutline, outlineBounds, polygonParts } from './outline.ts'
import { isMeaningfulCut, PUNCH_SHAPES, SLAB_KINDS, slabEntrySpec } from './geometry.ts'
import { placeSlab } from './placement.ts'
import {
  bentEdgeCount,
  carveFromCut,
  carveLayerName,
  carveThickness,
  describeCarve,
  isCarveSpec,
  polygonApothem,
  polygonCornerRadius,
  polygonSpec,
  roundCarveSpec,
  slabSpec,
  type CarveSpec,
  type PolygonSpec,
  type SlabSpec,
} from './spec.ts'
import { isObjectCarveValid, segsToContour, syncCarve } from './sync.ts'
import { asCircle } from '../geometry/asCircle.ts'
import { recipePrimitives } from '../geometry/primitives.ts'
import { carveKeyPoints, documentSizes } from '../snap/snapping.ts'
import { constructionLines } from '../vector/guides.ts'
import { recipeCentre, shapeCentre, takesPin } from '../vector/pins.ts'
import { createEmptyVectorDocument, repairVectorDocument } from '../vector/document.ts'
import { decodeLink, encodeLink } from '../vector/link.ts'
import { createSavedVariation, savedDocument } from '../vector/saved.ts'
import type { PathObject, VectorDocument } from '../vector/types.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

/** paper.d.ts only declares `area` on Path and CompoundPath. */
function areaOf(shape: paper.PathItem): number {
  return Math.abs((shape as unknown as { area: number }).area)
}

function differenceArea(a: paper.PathItem, b: paper.PathItem): number {
  scope.activate()
  return areaOf(a.subtract(b, { insert: false })) + areaOf(b.subtract(a, { insert: false }))
}

/** A seeded stream of numbers in [0, 1), so a failure can be run again. */
function numbers(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** The area of a regular n-gon of circumradius R with every corner rounded to ρ, from first principles. */
function roundedPolygonArea(n: number, R: number, rho: number): number {
  const turn = (2 * Math.PI) / n
  const sharp = (n / 2) * R * R * Math.sin(turn)
  // Each corner loses the kite between its tangent points less the sector of its circle.
  return sharp - n * (rho * rho * Math.tan(turn / 2) - (turn / 2) * rho * rho)
}

/**
 * The same polygon built another way: the hull of its corner circles, as the
 * polygon through their centres, a band of width ρ outside each side, and
 * each circle, united by paper.
 */
function hullOracle(spec: PolygonSpec): paper.PathItem {
  scope.activate()
  const n = spec.sides
  const rho = polygonCornerRadius(spec)
  const inner = spec.radius - rho / Math.cos(Math.PI / n)
  const centres = Array.from({ length: n }, (_, k) => add(spec.center, rotate({ x: 0, y: -inner }, spec.rotation + (360 * k) / n)))
  const point = (v: Vec) => new scope.Point(v.x, v.y)
  let shape: paper.PathItem = new scope.Path({ segments: centres.map(point), closed: true, insert: false })
  if (rho <= 1e-9) return shape
  centres.forEach((c, k) => {
    const next = centres[(k + 1) % n]
    const out = scale(normalize(rotate(sub(next, c), -90)), rho)
    const band = new scope.Path({ segments: [c, next, add(next, out), add(c, out)].map(point), closed: true, insert: false })
    const circle = new scope.Path.Circle({ center: point(c), radius: rho, insert: false })
    shape = shape.unite(band, { insert: false }).unite(circle, { insert: false })
  })
  return shape
}

const ref1: PolygonSpec = { v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius: 370, rotation: 0, cornerRadius: 60 }

describe('a polygon recipe', () => {
  it('names itself, reads out its numbers and counts no bent edges', () => {
    expect(carveLayerName(ref1)).toBe('Polygon · 6')
    expect(describeCarve({ ...ref1, radius: 200, rotation: 30 })).toBe('Polygon · 6 sides · r 200 · corner 60 · 30°')
    expect(describeCarve(polygonSpec({ x: 0, y: 0 }, 120, 5))).toBe('Polygon · 5 sides · r 120 · corner 0')
    // A corner larger than the apothem reads as the corner drawn.
    expect(describeCarve({ ...ref1, cornerRadius: 9999 })).toBe(`Polygon · 6 sides · r 370 · corner ${Math.round(polygonApothem(ref1))}`)
    expect(bentEdgeCount(ref1)).toBe(0)
    expect(carveThickness(ref1)).toBeCloseTo(2 * 370 * Math.cos(Math.PI / 6), 9)
  })

  it('is valid only with a whole number of sides from 3 to 12, a radius and a corner radius that is not negative', () => {
    expect(isCarveSpec(ref1)).toBe(true)
    for (const sides of [3, 12]) expect(isCarveSpec({ ...ref1, sides })).toBe(true)
    for (const sides of [2, 13, 6.5, NaN, '6']) expect(isCarveSpec({ ...ref1, sides })).toBe(false)
    expect(isCarveSpec({ ...ref1, radius: 0 })).toBe(false)
    expect(isCarveSpec({ ...ref1, cornerRadius: -1 })).toBe(false)
    expect(isCarveSpec({ ...ref1, rotation: Infinity })).toBe(false)
  })

  it('rounds to hundredths, keeping its sides', () => {
    expect(roundCarveSpec({ ...ref1, center: { x: 1.23456, y: -0.004 }, radius: 99.999, rotation: 12.3456, cornerRadius: 4.444 })).toEqual({
      v: 1,
      kind: 'polygon',
      center: { x: 1.23, y: 0 },
      sides: 6,
      radius: 100,
      rotation: 12.35,
      cornerRadius: 4.44,
    })
  })

  it('comes from the punch as a polygon that is upright and sharp', () => {
    const cut = { kind: 'polygon' as const, center: { x: 5, y: 6 }, radius: 40, sides: 7 }
    expect(carveFromCut(cut)).toEqual({ v: 1, kind: 'polygon', center: { x: 5, y: 6 }, sides: 7, radius: 40, rotation: 0, cornerRadius: 0 })
    expect(isMeaningfulCut(cut)).toBe(true)
    expect(isMeaningfulCut({ ...cut, radius: 3 })).toBe(false)
    expect(PUNCH_SHAPES.map((shape) => shape.id)).toContain('polygon')
  })

  it('is the slab row’s last entry: a hexagon of radius 200 with sharp corners, placed beside ink like a slab', () => {
    expect(SLAB_KINDS.at(-1)).toEqual({ id: 'polygon', label: 'Polygon' })
    expect(slabEntrySpec('polygon', 6)).toEqual(polygonSpec({ x: 0, y: 0 }, 200, 6))
    expect(slabEntrySpec('polygon', 8).sides).toBe(8)
    const placed = placeSlab('polygon', { x: -100, y: -100, width: 200, height: 200 }, { width: 2000, height: 600 })
    expect(placed.kind).toBe('polygon')
    // Half size, a gap of 24 to the right of the ink: the hexagon's flats are 100·sin 60° from its centre.
    const bounds = outlineBounds(carveOutline(placed))
    expect(bounds.minX).toBeCloseTo(100 + 24, 6)
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(0, 6)
  })
})

describe('a polygon outline', () => {
  it('matches the area of a rounded polygon and the hull of its corner circles, for 3 to 12 sides, sharp, half and fully rounded', () => {
    const next = numbers(20261006)
    for (let n = 3; n <= 12; n++) {
      for (const share of [0, 0.5, 1]) {
        const radius = 40 + next() * 300
        const spec: PolygonSpec = {
          v: 1,
          kind: 'polygon',
          center: { x: next() * 200 - 100, y: next() * 200 - 100 },
          sides: n,
          radius,
          rotation: next() * 360 - 180,
          cornerRadius: share * radius * Math.cos(Math.PI / n),
        }
        scope.activate()
        const drawn = scope.PathItem.create(carveOutline(spec).pathData)
        const expected = roundedPolygonArea(n, spec.radius, spec.cornerRadius)
        // A cubic quarter arc bulges out by up to 0.027% of its radius: a quarter-turn circle is 0.028% too large.
        expect(Math.abs(areaOf(drawn) - expected) / expected, `${n} sides at ${share}`).toBeLessThan(4e-4)
        // Both are drawn with cubics, the oracle's circles in quarters: they differ by the error of each.
        expect(differenceArea(drawn, hullOracle(spec)) / expected, `${n} sides at ${share}`).toBeLessThan(1e-3)
      }
    }
  })

  it('starts at its top corner, one anchor a corner when sharp and two when rounded, none on a side rounded away', () => {
    const sharp = carveOutline(polygonSpec({ x: 0, y: 0 }, 100, 6))
    expect(sharp.segs).toHaveLength(6)
    expect(sharp.segs[0].p.x).toBeCloseTo(0, 9)
    expect(sharp.segs[0].p.y).toBeCloseTo(-100, 9)
    expect(sharp.segs.every((seg) => seg.hIn === null && seg.hOut === null)).toBe(true)
    expect(carveOutline(ref1).segs).toHaveLength(12)
    // Rounded to its apothem, each side is gone: six arcs, a circle in all but name.
    const full = carveOutline({ ...ref1, cornerRadius: polygonApothem(ref1) })
    expect(full.segs).toHaveLength(6)
    expect(full.curveSides.every((side) => side.type === 'polygon-corner')).toBe(true)
  })

  it('clamps the corner radius to the apothem, where the tangent points of neighbouring corners meet', () => {
    expect(carveOutline({ ...ref1, cornerRadius: 1e6 }).pathData).toBe(carveOutline({ ...ref1, cornerRadius: polygonApothem(ref1) }).pathData)
    const parts = polygonParts({ ...ref1, cornerRadius: polygonApothem(ref1) })
    parts.corners.forEach((corner, k) => expect(distance(corner.b, parts.corners[(k + 1) % 6].a)).toBeLessThan(1e-9))
  })

  it('rounds each corner with a true arc: tangent points ρ·tan(α/2) from the corner, handles (4/3)·tan(α/4)·ρ long', () => {
    for (const n of [4, 5, 6, 12]) {
      const spec: PolygonSpec = { ...ref1, sides: n, radius: 200, cornerRadius: 30, rotation: 17 }
      const outline = carveOutline(spec)
      const parts = polygonParts(spec)
      const turn = (2 * Math.PI) / n
      const corners = outline.curves.filter((_, i) => outline.curveSides[i].type === 'polygon-corner')
      expect(corners).toHaveLength(n)
      corners.forEach((curve, k) => {
        expect(distance(curve[0], parts.vertices[k])).toBeCloseTo(30 * Math.tan(turn / 2), 9)
        expect(distance(curve[3], parts.vertices[k])).toBeCloseTo(30 * Math.tan(turn / 2), 9)
        expect(distance(curve[1], curve[0])).toBeCloseTo((4 / 3) * Math.tan(turn / 4) * 30, 9)
        expect(distance(curve[2], curve[3])).toBeCloseTo((4 / 3) * Math.tan(turn / 4) * 30, 9)
      })
    }
  })

  it("splits a triangle's corners, which turn 120°, into two arcs of 60° each", () => {
    const spec: PolygonSpec = { ...ref1, sides: 3, radius: 200, cornerRadius: 30, rotation: 17 }
    const outline = carveOutline(spec)
    const parts = polygonParts(spec)
    const corners = outline.curves.filter((_, i) => outline.curveSides[i].type === 'polygon-corner')
    expect(corners).toHaveLength(6)
    corners.forEach((curve, i) => {
      const corner = parts.corners[Math.floor(i / 2)]
      expect(distance(i % 2 ? curve[3] : curve[0], i % 2 ? corner.b : corner.a)).toBeLessThan(1e-9)
      for (const p of [curve[0], curve[3]]) expect(distance(p, corner.c)).toBeCloseTo(30, 9)
      expect(distance(curve[1], curve[0])).toBeCloseTo((4 / 3) * Math.tan(Math.PI / 12) * 30, 9)
    })
  })

  it("shows ref 1's six corner circles, radius 60, about 301 from the middle, each towards its corner and touching both sides", () => {
    const outline = carveOutline(ref1)
    if (outline.frame.kind !== 'box') throw new Error('a polygon has a box frame')
    const circles = outline.frame.cornerCircles
    expect(circles).toHaveLength(6)
    const parts = polygonParts(ref1)
    circles.forEach((circle, k) => {
      expect(circle.r).toBe(60)
      expect(distance(circle.c, ref1.center)).toBeCloseTo(370 - 60 / Math.cos(Math.PI / 6), 9)
      expect(distance(circle.c, ref1.center)).toBeCloseTo(300.72, 2)
      expect(Math.abs(cross(normalize(circle.c), normalize(parts.vertices[k])))).toBeLessThan(1e-9)
      expect(dot(circle.c, parts.vertices[k])).toBeGreaterThan(0)
      for (const [a, b] of [
        [parts.vertices[(k + 5) % 6], parts.vertices[k]],
        [parts.vertices[k], parts.vertices[(k + 1) % 6]],
      ]) {
        expect(Math.abs(cross(normalize(sub(b, a)), sub(circle.c, a)))).toBeCloseTo(60, 9)
      }
    })
    // Turned and moved, the circles go with it.
    const moved = carveOutline({ ...ref1, center: { x: 40, y: -30 }, rotation: 30 })
    if (moved.frame.kind !== 'box') throw new Error('a polygon has a box frame')
    expect(distance(moved.frame.cornerCircles[0].c, { x: 40, y: -30 })).toBeCloseTo(300.72, 2)
    expect(moved.frame.cornerCircles[0].c.x).toBeGreaterThan(40)
    // A sharp polygon has none.
    const sharp = carveOutline({ ...ref1, cornerRadius: 0 })
    expect(sharp.frame.kind === 'box' && sharp.frame.cornerCircles).toEqual([])
  })

  it('gives no corner circles to a slab, a punch, or a polygon rounded to a circle, and keeps a slab frame to its declared fields', () => {
    const rounded = carveOutline(slabSpec('rounded'))
    expect(rounded.frame.kind === 'box' && rounded.frame.cornerCircles).toEqual([])
    expect(Object.keys(rounded.frame).sort()).toEqual(['center', 'cornerCircles', 'extent', 'height', 'kind', 'radius', 'rotation', 'width'])
    const triangle: PolygonSpec = { ...ref1, sides: 3, radius: 200, cornerRadius: 100 }
    const circle = carveOutline(triangle)
    expect(circle.frame.kind === 'box' && circle.frame.cornerCircles).toEqual([])
    const almost = carveOutline({ ...triangle, cornerRadius: 99 })
    expect(almost.frame.kind === 'box' && almost.frame.cornerCircles).toHaveLength(3)
  })

  it('is fully round when its corner radius is stored within a hundredth of the apothem, as storage rounds it', () => {
    // A hexagon of radius 100: its apothem, 86.6025…, stores as 86.6.
    const hexagon: PolygonSpec = { ...ref1, radius: 100, cornerRadius: polygonApothem({ sides: 6, radius: 100 }) }
    const stored = roundCarveSpec(hexagon) as PolygonSpec
    expect(stored.cornerRadius).toBe(86.6)
    expect(polygonCornerRadius(stored)).toBe(polygonApothem(stored))
    const outline = carveOutline(stored)
    expect(outline.frame.kind === 'box' && outline.frame.cornerCircles).toEqual([])
    // Its corners' arcs meet: no flat between them.
    expect(outline.curveSides.every((side) => side.type === 'polygon-corner')).toBe(true)
    expect(polygonCornerRadius({ ...stored, cornerRadius: 86.59 })).toBe(86.59)
  })
})

describe('polygon handles', () => {
  const hexagon: PolygonSpec = { ...ref1, radius: 200, cornerRadius: 20 }
  const layout = DEFAULT_HANDLE_LAYOUT

  it('are four corners that scale, a rounding dot and a knob', () => {
    const handles = carveHandles(hexagon, layout)
    expect(handles.map((handle) => `${handle.id}:${handle.kind}`)).toEqual(['nw:scale', 'ne:scale', 'se:scale', 'sw:scale', 'radius:radius', 'rotate:rotate'])
    // The dot sits on the line from the top corner to the middle, inside the polygon.
    const dot = handles.find((handle) => handle.id === 'radius')!
    expect(dot.at.x).toBeCloseTo(0, 9)
    expect(dot.at.y).toBeGreaterThan(-200)
    expect(dot.at.y).toBeLessThan(0)
  })

  // Rewritten on purpose: the dot now keeps the layout's centreClear (16 CSS px, 32 under a finger) from the middle, not two insets.
  it("keep the rounding dot clear of the middle, twice as far under a finger, and leave it off a polygon too small for that", () => {
    const touch = { ...layout, centreClear: 2 * layout.centreClear }
    for (const each of [layout, touch]) {
      for (const sides of [3, 6, 12]) {
        for (const radius of [36, 60, 200]) {
          for (const cornerRadius of [0, 15, 1000]) {
            const spec: PolygonSpec = { ...hexagon, sides, radius, cornerRadius }
            const dot = carveHandles(spec, each).find((handle) => handle.id === 'radius')
            if (!dot) continue
            expect(Math.hypot(dot.at.x - spec.center.x, dot.at.y - spec.center.y)).toBeGreaterThanOrEqual(each.centreClear - 1e-9)
          }
        }
      }
      // From its corner the dot starts an inset in on each side; the polygon must reach that far and its clearance more.
      const least = each.radiusInset * Math.SQRT2 + each.centreClear
      expect(carveHandles({ ...hexagon, radius: least + 0.01 }, each).map((handle) => handle.id)).toContain('radius')
      expect(carveHandles({ ...hexagon, radius: least - 0.01 }, each).map((handle) => handle.id)).toEqual(['nw', 'ne', 'se', 'sw', 'rotate'])
    }
  })

  it("keep a slab's rounding dot clear of its middle, and leave it off a slab too small for that", () => {
    const touch = { ...layout, centreClear: 2 * layout.centreClear }
    for (const each of [layout, touch]) {
      for (const [width, height] of [
        [30, 30],
        [40, 60],
        [50, 200],
        [400, 300],
      ]) {
        for (const radius of [0, 10, 1000]) {
          const spec: SlabSpec = { ...slabSpec('square'), center: { x: 10, y: -20 }, width, height, radius, rotation: 30 }
          const dot = carveHandles(spec, each).find((handle) => handle.id === 'radius')
          if (!dot) continue
          expect(Math.hypot(dot.at.x - spec.center.x, dot.at.y - spec.center.y)).toBeGreaterThanOrEqual(each.centreClear - 1e-9)
        }
      }
      // A sharp slab's dot sits an inset in from each side of its corner.
      const least = (each.radiusInset + each.centreClear / Math.SQRT2) * 2
      expect(carveHandles({ ...slabSpec('square'), width: least + 0.02, height: least + 0.02 }, each).map((handle) => handle.id)).toContain('radius')
      expect(carveHandles({ ...slabSpec('square'), width: least - 0.02, height: least - 0.02 }, each).map((handle) => handle.id)).not.toContain('radius')
    }
    // A long slab's dot goes along its length, and stops short of the middle.
    const bar: SlabSpec = { ...slabSpec('square'), center: { x: 0, y: 0 }, width: 60, height: 20, radius: 1000, rotation: 0 }
    expect(carveHandles(bar, layout).find((handle) => handle.id === 'radius')!.at).toEqual({ x: -layout.centreClear, y: 0 })
  })

  it('stay fully round when the dot is pulled all the way in, at whole numbers and as stored, for 3 to 12 sides', () => {
    let checked = 0
    for (let sides = 3; sides <= 12; sides++) {
      for (let radius = 50; radius <= 300; radius += 5) {
        const spec: PolygonSpec = { ...ref1, sides, radius, cornerRadius: 0 }
        const dot = carveHandles(spec, layout).find((handle) => handle.id === 'radius')!
        const raw = dragCarveHandle(spec, 'radius', dot.at, add(dot.at, rotate({ x: 0, y: 2 * radius }, spec.rotation))) as PolygonSpec
        expect(raw.cornerRadius).toBe(polygonApothem(spec))
        const stored = roundCarveSpec(wholeCarveDrag(spec, raw, 'radius')) as PolygonSpec
        const outline = carveOutline(stored)
        expect(outline.frame.kind === 'box' && outline.frame.cornerCircles).toEqual([])
        checked++
      }
    }
    expect(checked).toBe(510)
  })

  const handleAt = (spec: CarveSpec, id: string): Vec => carveHandles(spec, layout).find((handle) => handle.id === id)!.at

  it('scale about the centre from a corner, keeping the rounding as a slab does, the corner handle on the pointer', () => {
    const ne = handleAt(hexagon, 'ne')
    const pointer = handleAt({ ...hexagon, radius: 300 }, 'ne')
    const grown = dragCarveHandle(hexagon, 'ne', ne, pointer) as PolygonSpec
    expect(grown.radius).toBeCloseTo(300, 1)
    expect(grown.cornerRadius).toBe(20)
    expect(grown.center).toEqual(hexagon.center)
    // Whole numbers with snapping on: the radius, the rounding as stored.
    const whole = wholeCarveDrag(hexagon, { ...grown, radius: 300.4 }, 'ne') as PolygonSpec
    expect(whole.radius).toBe(300)
    expect(whole.cornerRadius).toBe(20)
  })

  it('keep a corner handle under the pointer however rounded and turned, from triangles to hexagons, as far as its path lets it', () => {
    const shapes: PolygonSpec[] = [
      { ...ref1, center: { x: 30, y: -20 }, radius: 200, cornerRadius: 60, rotation: 17 },
      { ...ref1, sides: 3, radius: 200, cornerRadius: 50 },
      { ...ref1, sides: 3, radius: 200, cornerRadius: 100 },
      { ...ref1, sides: 5, radius: 200, cornerRadius: 0, rotation: -40 },
    ]
    for (const spec of shapes) {
      for (const id of ['nw', 'ne', 'se', 'sw'] as const) {
        const from = handleAt(spec, id)
        // Where a radius puts the handle, the drag gives that radius back.
        for (const radius of [120, 260, 410]) {
          const to = handleAt({ ...spec, radius }, id)
          const dragged = dragCarveHandle(spec, id, from, to) as PolygonSpec
          expect(dragged.radius).toBeCloseTo(radius, 1)
          expect(dragged.cornerRadius).toBe(spec.cornerRadius)
        }
        // Anywhere else, no radius puts the handle nearer the pointer.
        for (const f of [0.5, 2]) {
          const pointer = add(spec.center, scale(sub(from, spec.center), f))
          const dragged = dragCarveHandle(spec, id, from, pointer) as PolygonSpec
          const off = distance(handleAt(dragged, id), pointer)
          for (const nudge of [-2, 2]) expect(off).toBeLessThanOrEqual(distance(handleAt({ ...dragged, radius: dragged.radius + nudge }, id), pointer) + 0.05)
        }
      }
    }
    // Drawn out from the middle, the corner handle of a rounded hexagon stays as near the pointer as a punch's does.
    const punch = carveFromCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 200 })
    const punchFrom = handleAt(punch, 'ne')
    const punchOff = distance(handleAt(dragCarveHandle(punch, 'ne', punchFrom, scale(punchFrom, 2)), 'ne'), scale(punchFrom, 2))
    const rounded = shapes[0]
    const from = handleAt(rounded, 'ne')
    const pointer = add(rounded.center, scale(sub(from, rounded.center), 2))
    expect(distance(handleAt(dragCarveHandle(rounded, 'ne', from, pointer) as PolygonSpec, 'ne'), pointer)).toBeLessThan(punchOff)
  })

  it('scale the rounding along with Shift, the corner handle on the pointer', () => {
    const shift = { shift: true, alt: false }
    const ne = handleAt(hexagon, 'ne')
    const pointer = handleAt({ ...hexagon, radius: 300, cornerRadius: 30 }, 'ne')
    const even = dragCarveHandle(hexagon, 'ne', ne, pointer, shift) as PolygonSpec
    expect(even.radius).toBeCloseTo(300, 1)
    expect(even.cornerRadius / even.radius).toBeCloseTo(hexagon.cornerRadius / hexagon.radius, 12)
    const wholeEven = wholeCarveDrag(hexagon, { ...even, radius: 300.4, cornerRadius: 30.04 }, 'ne', shift) as PolygonSpec
    expect(wholeEven.radius).toBe(300)
    expect(wholeEven.cornerRadius).toBeCloseTo(30, 9)
  })

  it('round the corners by the dot, from sharp to the apothem and no further, in steps of 5 with Shift', () => {
    const turned: PolygonSpec = { ...hexagon, rotation: 90 }
    const dot = carveHandles(turned, layout).find((handle) => handle.id === 'radius')!
    // Turned a quarter, the dot moves towards the middle along −x.
    const inward = (d: number) => dragCarveHandle(turned, 'radius', dot.at, add(dot.at, { x: -d, y: 0 })) as PolygonSpec
    expect(inward(10).cornerRadius).toBeCloseTo(20 + (10 * Math.cos(Math.PI / 6)) / 0.5, 9)
    expect(inward(1000).cornerRadius).toBeCloseTo(polygonApothem(turned), 9)
    expect(inward(-1000).cornerRadius).toBe(0)
    expect((wholeCarveDrag(turned, { ...turned, cornerRadius: 40.4 }, 'radius') as PolygonSpec).cornerRadius).toBe(40)
    // Shift takes it in steps of 5.
    const stepped = dragCarveHandle(turned, 'radius', dot.at, add(dot.at, { x: -10, y: 0 }), { shift: true, alt: false }) as PolygonSpec
    expect(stepped.cornerRadius).toBe(35)
  })

  it('turn by the knob, in 15° steps with Shift', () => {
    const knob = carveHandles(hexagon, layout).find((handle) => handle.id === 'rotate')!
    const to = rotate(knob.at, 37)
    expect((dragCarveHandle(hexagon, 'rotate', knob.at, to) as PolygonSpec).rotation).toBeCloseTo(37, 6)
    expect((dragCarveHandle(hexagon, 'rotate', knob.at, to, { shift: true, alt: false }) as PolygonSpec).rotation).toBe(30)
  })

  it('take a side off and add one, from 3 to 12', () => {
    expect(stepPolygonSides(hexagon, 1).sides).toBe(7)
    expect(stepPolygonSides(hexagon, -1).sides).toBe(5)
    const triangle = { ...hexagon, sides: 3 }
    const dodecagon = { ...hexagon, sides: 12 }
    expect(stepPolygonSides(triangle, -1)).toBe(triangle)
    expect(stepPolygonSides(dodecagon, 1)).toBe(dodecagon)
  })

  it('do not bend: an edge is not a grab, and nothing is bent to straighten', () => {
    const edge = polygonParts(hexagon).midpoints[0]
    expect(locateCarveGrab(hexagon, edge)).toBeNull()
    expect(bendCarve(hexagon, { side: { type: 'polygon-side', index: 0 }, t: 0.5, point: edge }, add(edge, { x: 0, y: -30 }))).toBe(hexagon)
    expect(isSideBent(hexagon, { type: 'polygon-side', index: 0 })).toBe(false)
  })
})

describe('polygons under moves and maps', () => {
  const spec: PolygonSpec = { ...ref1, center: { x: 10, y: -20 }, radius: 150, cornerRadius: 25, rotation: 12, sides: 5 }

  function sameShape(a: CarveSpec, b: CarveSpec) {
    scope.activate()
    const pa = scope.PathItem.create(carveOutline(a).pathData)
    const pb = scope.PathItem.create(carveOutline(b).pathData)
    expect(differenceArea(pa, pb)).toBeLessThan(0.5)
  }

  it('move, turn and scale as their outline does', () => {
    expect(translateCarve(spec, { x: 5, y: 5 })).toEqual({ ...spec, center: { x: 15, y: -15 } })
    const turned = rotateCarveAbout(spec, { x: 0, y: 0 }, 30) as PolygonSpec
    expect(turned.rotation).toBeCloseTo(42, 9)
    expect(distance(turned.center, rotate(spec.center, 30))).toBeLessThan(1e-9)
    const scaled = scaleCarveAbout(spec, { x: 0, y: 0 }, 2) as PolygonSpec
    expect(scaled).toEqual({ ...spec, center: { x: 20, y: -40 }, radius: 300, cornerRadius: 50 })
  })

  it('fold a similarity into the recipe exactly', () => {
    const t = { dx: 30, dy: -20, scale: 1.3, rotation: 25 }
    const pivot = { x: 4, y: 7 }
    const folded = foldTransform(spec, t, pivot)
    scope.activate()
    const original = scope.PathItem.create(carveOutline(spec).pathData)
    original.scale(t.scale, new scope.Point(pivot.x, pivot.y))
    original.rotate(t.rotation, new scope.Point(pivot.x, pivot.y))
    original.translate(new scope.Point(t.dx, t.dy))
    expect(differenceArea(original, scope.PathItem.create(carveOutline(folded).pathData))).toBeLessThan(0.5)
  })

  it('stay fully round when a fully round polygon is scaled, however its corner was rounded for storage', () => {
    const round: PolygonSpec = { ...spec, cornerRadius: Math.floor(polygonApothem(spec) * 100) / 100 - 0.004 }
    for (const factor of [0.3, 1.7, 4, 9.5]) {
      const scaled = scaleCarveAbout(round, { x: 0, y: 0 }, factor) as PolygonSpec
      expect(polygonCornerRadius(scaled)).toBe(polygonApothem(scaled))
      expect(carveOutline(scaled).frame).not.toHaveProperty('cornerCircles.length', spec.sides)
    }
  })

  it('stay polygons under an uneven map, as the similarity nearest it, as every recipe does', () => {
    const stretched = carveUnderAffine(spec, { a: 2, b: 0, c: 0, d: 0.5, e: 3, f: 4 }) as PolygonSpec
    expect(stretched.kind).toBe('polygon')
    expect(stretched.radius).toBeCloseTo(150, 9)
    expect(stretched.sides).toBe(5)
    sameShape(carveUnderAffine(spec, { a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 }), translateCarve(spec, { x: 3, y: 4 }))
  })
})

describe('what reads a polygon', () => {
  const spec: PolygonSpec = { ...ref1, center: { x: 30, y: 40 }, radius: 100, cornerRadius: 20 }

  it('is never a circle, even rounded all the way', () => {
    expect(asCircle({ carve: spec, contours: [] })).toBeNull()
    expect(asCircle({ carve: { ...spec, cornerRadius: 1e6 }, contours: [] })).toBeNull()
  })

  it('gives snapping its sides as segments and its corners as arcs of their circles', () => {
    const pieces = recipePrimitives(spec, 'p')
    expect(pieces.map((piece) => piece.kind)).toEqual(Array.from({ length: 6 }, () => ['arc', 'segment']).flat())
    const outline = carveOutline(spec)
    if (outline.frame.kind !== 'box') throw new Error('a polygon has a box frame')
    pieces.forEach((piece, i) => {
      expect(piece.owner).toBe('p')
      if (piece.kind !== 'arc') return
      const circle = outline.frame.kind === 'box' ? outline.frame.cornerCircles[i / 2] : null
      expect(distance(piece.c, circle!.c)).toBeLessThan(1e-9)
      expect(piece.r).toBe(20)
      expect(piece.end - piece.start).toBeCloseTo(Math.PI / 3, 12)
    })
    expect(recipePrimitives({ ...spec, cornerRadius: 0 }, 'p').map((piece) => piece.kind)).toEqual(Array(6).fill('segment'))
  })

  it('offers its centre, corners, side middles and tangent points as snap points', () => {
    const points = carveKeyPoints(spec, 'p')
    const parts = polygonParts(spec)
    expect(points[0]).toEqual({ p: spec.center, kind: 'centre', owner: 'p' })
    expect(points).toHaveLength(1 + 6 + 6 + 12)
    for (const p of [...parts.vertices, ...parts.midpoints, parts.corners[2].a, parts.corners[2].b]) {
      expect(points.some((target) => target.kind === 'point' && distance(target.p, p) < 1e-9)).toBe(true)
    }
  })

  it('offers its radius and corner radius as sizes in use', () => {
    const layer = (id: string, carve: CarveSpec): IllustratorLayer => ({
      id,
      name: id,
      operation: 'add',
      visible: true,
      locked: false,
      pathData: '',
      fillRule: 'nonzero',
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      carve,
    })
    const doc: IllustratorDocument = {
      id: 'doc',
      source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
      layers: [layer('a', spec), layer('b', { ...spec, cornerRadius: 0, radius: 80 }), layer('c', slabSpec('rounded'))],
      selectedLayerIds: [],
      pointSelection: null,
      mode: 'object',
    }
    const sizes = documentSizes(doc, new Set())
    expect(sizes.polygonRadii).toEqual([100, 80])
    expect(sizes.radii).toEqual([20, 90])
    expect(sizes.punchRadii).toEqual([])
    expect(sizes.widths).toEqual([])
    expect(documentSizes(doc, new Set(['a'])).polygonRadii).toEqual([80])
  })

  it('offers construction lines: centre lines, bounds, circumcircle, incircle and a spoke through each pair of corners', () => {
    const lines = constructionLines({ carve: spec, contours: [] })
    expect(lines.map((line) => line.role)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle', 'incircle', 'axis-1', 'axis-2'])
    expect(lines.find((line) => line.role === 'circumcircle')!.shape).toEqual({ kind: 'circle', c: spec.center, r: 100 })
    const incircle = lines.find((line) => line.role === 'incircle')!.shape
    expect(incircle.kind === 'circle' && incircle.r).toBeCloseTo(100 * Math.cos(Math.PI / 6), 9)
    // A pentagon has a spoke through every corner, the first its upright centre line.
    const pentagon = constructionLines({ carve: { ...spec, sides: 5 }, contours: [] })
    expect(pentagon.filter((line) => line.role.startsWith('axis-'))).toHaveLength(4)
  })

  it('takes a pin by its centre, and gives its centre to a pin', () => {
    expect(recipeCentre(spec)).toEqual(spec.center)
    expect(shapeCentre({ carve: spec, contours: [] })).toEqual(spec.center)
    const object: PathObject = {
      id: 'p',
      name: 'Polygon · 6',
      parentId: null,
      type: 'path',
      visible: true,
      locked: false,
      operation: 'add',
      fillRule: 'nonzero',
      contours: [segsToContour(carveOutline(spec).segs)],
      carve: spec,
    }
    expect(takesPin(object)).toBe(true)
  })

  it('stays with its path when it matches it, and folds a legacy transform in', () => {
    const contour = segsToContour(carveOutline(spec).segs)
    expect(isObjectCarveValid(spec, [contour])).toBe(true)
    expect(isObjectCarveValid({ ...spec, sides: 7 }, [contour])).toBe(false)
    const synced = syncCarve(spec, contour, { dx: 10, dy: 0, scale: 2, rotation: 0 })
    expect(synced?.carve).toMatchObject({ kind: 'polygon', sides: 6, radius: 200, cornerRadius: 40 })
  })
})

describe('polygons in stored documents', () => {
  const spec = roundCarveSpec({ ...ref1, center: { x: 12.5, y: -3 }, rotation: 15 }) as PolygonSpec
  const object: PathObject = {
    id: 'hex',
    name: 'Polygon · 6',
    parentId: null,
    type: 'path',
    visible: true,
    locked: false,
    operation: 'add',
    fillRule: 'evenodd',
    contours: [segsToContour(carveOutline(spec).segs)],
    carve: spec,
  }
  const document: VectorDocument = JSON.parse(JSON.stringify({ ...createEmptyVectorDocument('Polygons'), objects: [object] }))

  it('keeps the recipe through the repairing read, a link and a saved mark', () => {
    expect(repairVectorDocument(document)).toBe(document)
    const decoded = decodeLink(encodeLink(document, '#123456'))
    expect(decoded.kind === 'vector' && decoded.document.objects).toEqual([object])
    const entry = JSON.parse(JSON.stringify(createSavedVariation(document, { ...DEFAULT_PARAMS, fillColor: '#123456' })))
    expect(savedDocument(entry)?.document.objects).toEqual([object])
  })

  it('drops a recipe with a count of sides it cannot draw, and keeps the shape as its path', () => {
    for (const sides of [2, 13, 6.5]) {
      const broken = JSON.parse(JSON.stringify({ ...document, objects: [{ ...object, carve: { ...spec, sides } }] }))
      const repaired = repairVectorDocument(broken)!.objects[0] as PathObject
      expect(repaired.carve).toBeUndefined()
      expect(repaired.contours).toEqual(object.contours)
    }
  })
})

describe('every recipe kind', () => {
  it('is one of six, so a dispatcher that forgets one does not compile', () => {
    expectTypeOf<CarveSpec['kind']>().toEqualTypeOf<'slab' | 'punch' | 'polygon' | 'channel' | 'slice' | 'band'>()
  })

  it('goes through every dispatcher, a polygon never down another kind’s branch', () => {
    const samples: CarveSpec[] = [
      slabSpec('rounded'),
      { v: 1, kind: 'punch', shape: 'triangle', center: { x: 0, y: 0 }, radius: 40, rotation: 0 },
      ref1,
      { v: 1, kind: 'channel', from: { x: -50, y: 0 }, to: { x: 50, y: 0 }, width: 20 },
      { v: 1, kind: 'slice', from: { x: -50, y: 0 }, to: { x: 50, y: 0 }, width: 20 },
    ]
    for (const sample of samples) {
      expect(isCarveSpec(sample)).toBe(true)
      expect(carveLayerName(sample)).not.toBe('')
      expect(describeCarve(sample).split(' · ')[0]).toBe(carveLayerName(sample).split(' · ')[0])
      expect(roundCarveSpec(sample).kind).toBe(sample.kind)
      expect(carveOutline(sample).segs.length).toBeGreaterThan(2)
      expect(carveHandles(sample).length).toBeGreaterThan(0)
      expect(recipePrimitives(sample, 'x').length).toBeGreaterThan(0)
      expect(carveKeyPoints(sample).length).toBeGreaterThan(0)
    }
    expect(carveOutline(ref1).curveSides.every((side) => side.type === 'polygon-side' || side.type === 'polygon-corner')).toBe(true)
  })
})
