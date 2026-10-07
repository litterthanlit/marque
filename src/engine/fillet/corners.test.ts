import { describe, expect, it } from 'vitest'
import { polygonSpec } from '../carve/spec.ts'
import { composeBaseMark } from '../vector/export.ts'
import { distance } from '../path/bezier.ts'
import type { BandSpec } from '../carve/spec.ts'
import { attributedCorners, cornerKind, inkGeometry, markGeometry } from './corners.ts'
import { cornerSources } from './apply.ts'
import { bar, block, circle, made, numbers, polyline, recipe } from './testShapes.ts'

const DEG = Math.PI / 180

describe('the corners of the ink', () => {
  it('are the four convex corners of a square, each a corner of the one slab', () => {
    const { objects } = made([block('s', { x: 0, y: 0 }, 200, 100)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    expect(corners).toHaveLength(4)
    for (const corner of corners) {
      expect(corner.convex).toBe(true)
      expect(corner.turn).toBeCloseTo(90 * DEG, 9)
      expect(corner.angle).toBeCloseTo(90 * DEG, 9)
      expect(corner.between).toEqual(['s', 's'])
      expect(cornerKind(corner)).toBe('slab corner')
      // The bisector points into the ink at a convex corner.
      const inward = { x: corner.p.x + 10 * corner.bisector.x, y: corner.p.y + 10 * corner.bisector.y }
      expect(Math.abs(inward.x) < 100 && Math.abs(inward.y) < 50).toBe(true)
    }
  })

  it('reads a square hole’s corners as concave, whichever way its contours wind', () => {
    const { objects } = made([block('s', { x: 0, y: 0 }, 300, 300), block('h', { x: 0, y: 0 }, 100, 100, 0, 'subtract')])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    const hole = corners.filter((corner) => corner.between[0] === 'h')
    expect(hole).toHaveLength(4)
    for (const corner of hole) {
      expect(corner.convex).toBe(false)
      expect(corner.turn).toBeCloseTo(-90 * DEG, 9)
      expect(cornerKind(corner)).toBe('cut slab corner')
    }
    // Wound against paper's habit, as a pen draws it: the same corners.
    const reversed = 'M150,-150L-150,-150L-150,150L150,150Z M-50,-50L50,-50L50,50L-50,50Z'
    expect(inkGeometry(reversed).corners.map((corner) => corner.convex).sort()).toEqual([false, false, false, false, true, true, true, true])
  })

  it('finds where a bar meets its circles, between the band and each circle, and nothing at the bar’s round ends', () => {
    const { objects } = made([circle('a', 0, 0, 100), circle('b', 400, 0, 70), bar('bar', 'a', 'b', 40)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    expect(corners).toHaveLength(4)
    for (const corner of corners) {
      expect(corner.convex).toBe(false)
      expect([...corner.between].sort()).toEqual(corner.p.x < 200 ? ['a', 'bar'] : ['b', 'bar'])
      expect(cornerKind(corner)).toBe('band · circle')
    }
  })

  it('takes a belt meeting its circle for a smooth join, not a corner', () => {
    const belt: BandSpec = { v: 1, kind: 'band', a: { c: { x: 0, y: 0 }, r: 1 }, b: { c: { x: 0, y: 0 }, r: 1 }, fit: 'belt' }
    const { objects } = made([circle('a', 0, 0, 100), circle('b', 300, 40, 60), { ...bar('belt', 'a', 'b', 0), carve: belt }])
    expect(markGeometry(composeBaseMark(objects)).corners).toEqual([])
  })

  it('takes a neck meeting its circles for a smooth join, though the boolean leaves a jog a hair long between them', () => {
    const neck = (radius: number): BandSpec => ({ v: 1, kind: 'band', a: { c: { x: 0, y: 0 }, r: 1 }, b: { c: { x: 0, y: 0 }, r: 1 }, fit: 'neck', radius })
    // Sizes that are not whole: the band stores its circles rounded, and its arc meets the circle 0.006 off.
    const odd = made([circle('a', -110, 0, 79.853), circle('b', 110, 20.011, 61.729), { ...bar('neck', 'a', 'b', 0), carve: neck(69.909) }]).objects
    expect(markGeometry(composeBaseMark(odd)).corners).toEqual([])
    const rand = numbers(55)
    for (let t = 0; t < 30; t++) {
      const objects = made([circle('a', -110, 0, 50 + rand() * 40), circle('b', 110, (rand() - 0.5) * 60, 40 + rand() * 50), { ...bar('neck', 'a', 'b', 0), carve: neck(30 + rand() * 40) }]).objects
      expect(markGeometry(composeBaseMark(objects)).corners).toEqual([])
    }
  })

  it('reads a step too short to see in an edge as part of the edge, and a joint too short to see that turns the outline as one corner', () => {
    // A step 0.02 high in a straight edge: the outline turns 90° one way and back, and goes on as it was.
    const step = polyline('step', [{ x: -100, y: 50 }, { x: -100, y: -50 }, { x: -10, y: -50 }, { x: -10, y: -49.98 }, { x: 100, y: -49.98 }, { x: 100, y: 50 }])
    const stepped = markGeometry(composeBaseMark(made([step]).objects)).corners
    expect(stepped.map((corner) => [Math.round(corner.p.x), Math.round(corner.p.y)])).toEqual([[-100, 50], [-100, -50], [100, -50], [100, 50]])
    // A peak flattened to an edge 0.03 long: the joint turns the outline 90° in all, one corner, not two.
    const peak = polyline('peak', [{ x: -100, y: 0 }, { x: 0, y: -100 }, { x: 0.03, y: -100 }, { x: 100, y: 0 }])
    const top = markGeometry(composeBaseMark(made([peak]).objects)).corners.filter((corner) => corner.p.y < -99)
    expect(top).toHaveLength(1)
    expect(Math.abs(top[0].turn)).toBeCloseTo(Math.PI / 2, 3)
    expect(top[0].angle).toBeCloseTo(Math.PI / 2, 3)
    // A short edge longer than a joint keeps a corner at each end.
    const flat = polyline('flat', [{ x: -100, y: 0 }, { x: 0, y: -100 }, { x: 0.3, y: -100 }, { x: 100, y: 0 }])
    expect(markGeometry(composeBaseMark(made([flat]).objects)).corners.filter((corner) => corner.p.y < -99)).toHaveLength(2)
  })

  it('gives a corner to the topmost object whose outline carries each curve', () => {
    // Two slabs on one another: every corner is the upper one's.
    const { objects } = made([block('low', { x: 0, y: 0 }, 200, 200), block('high', { x: 0, y: 0 }, 200, 200)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    expect(corners.map((corner) => corner.between)).toEqual([0, 1, 2, 3].map(() => ['high', 'high']))
    // A step where one slab stands out of the other is between them.
    const stepped = made([block('low', { x: 0, y: 0 }, 200, 200), block('high', { x: -50, y: -100 }, 100, 100)]).objects
    const step = attributedCorners(markGeometry(composeBaseMark(stepped)), cornerSources(stepped)).find((corner) => distance(corner.p, { x: 0, y: -100 }) < 1e-6)
    expect(step?.convex).toBe(false)
    expect([...step!.between].sort()).toEqual(['high', 'low'])
  })

  it('leaves hidden objects out of whose a corner is', () => {
    const { objects } = made([block('low', { x: 0, y: 0 }, 200, 200), { ...block('high', { x: -100, y: 0 }, 100, 100), visible: false }])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    expect(corners.every((corner) => corner.between[0] === 'low' && corner.between[1] === 'low')).toBe(true)
  })

  it('reads the hole corners of a hexagon ring crossed by a triangle as between the triangle and the cut', () => {
    const hexagon = recipe('hex', polygonSpec({ x: 0, y: 0 }, 370, 6, 60))
    const inset = recipe('inset', polygonSpec({ x: 0, y: 0 }, 370 - 55 / Math.cos(Math.PI / 6), 6, 5), 'subtract')
    const triangle = recipe('tri', { ...polygonSpec({ x: 0, y: 0 }, 370, 3), rotation: 180 })
    const { objects } = made([hexagon, inset, triangle])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    const holes = corners.filter((corner) => cornerKind(corner) === 'cut polygon · polygon')
    expect(holes).toHaveLength(6)
    expect(holes.every((corner) => !corner.convex)).toBe(true)
    const turns = holes.map((corner) => corner.turn)
    expect(Math.max(...turns) - Math.min(...turns)).toBeLessThan(1e-6)
  })
})
