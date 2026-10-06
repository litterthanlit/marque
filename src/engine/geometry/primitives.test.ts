import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec, type GrooveSpec, type PunchSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { circleContour } from '../vector/guides.ts'
import type { Contour, Guide } from '../vector/types.ts'
import {
  arcHas,
  guidePrimitives,
  intersectPrimitives,
  nearestOnPrimitive,
  outlinePrimitives,
  type Primitive,
} from './primitives.ts'

const object = (id: string, carve: CarveSpec) => ({ id, carve, contours: [segsToContour(carveOutline(carve).segs)] })
const kinds = (primitives: readonly Primitive[]) => primitives.map((primitive) => primitive.kind)
const punch = (shape: PunchSpec['shape'], extra: Partial<PunchSpec> = {}): PunchSpec => ({
  v: 1,
  kind: 'punch',
  shape,
  center: { x: 10, y: 20 },
  radius: 40,
  rotation: 0,
  ...extra,
})
const groove = (kind: GrooveSpec['kind'], extra: Partial<GrooveSpec> = {}): GrooveSpec => ({
  v: 1,
  kind,
  from: { x: -100, y: 0 },
  to: { x: 100, y: 0 },
  width: 40,
  ...extra,
})

describe('outline primitives', () => {
  it('reads a rounded slab as four sides and four corner arcs, each named for the slab', () => {
    const pieces = outlinePrimitives(object('s', slabSpec('rounded')))
    expect(kinds(pieces)).toEqual(['segment', 'arc', 'segment', 'arc', 'segment', 'arc', 'segment', 'arc'])
    expect(pieces.every((piece) => piece.owner === 's' && !piece.guide)).toBe(true)
    const [top, corner] = pieces
    expect(top).toMatchObject({ a: { x: -100, y: -190 }, b: { x: 100, y: -190 } })
    if (corner.kind !== 'arc') throw new Error('not an arc')
    expect(corner.c.x).toBeCloseTo(100, 6)
    expect(corner.c.y).toBeCloseTo(-100, 6)
    expect(corner.r).toBeCloseTo(90, 6)
    // The top right corner runs from straight up round to the right.
    expect(corner.start).toBeCloseTo(-Math.PI / 2, 9)
    expect(corner.end).toBeCloseTo(0, 9)
  })

  it('reads a square slab as four sides, and a circle slab as one circle', () => {
    expect(kinds(outlinePrimitives(object('s', slabSpec('square'))))).toEqual(['segment', 'segment', 'segment', 'segment'])
    expect(outlinePrimitives(object('c', { ...slabSpec('circle'), center: { x: 5, y: 6 } }))).toEqual([{ kind: 'circle', c: { x: 5, y: 6 }, r: 200, owner: 'c' }])
  })

  it('keeps a turned slab exact: its sides and arcs turn with it', () => {
    const pieces = outlinePrimitives(object('s', { ...slabSpec('rounded'), rotation: 30 }))
    expect(kinds(pieces)).toEqual(['segment', 'arc', 'segment', 'arc', 'segment', 'arc', 'segment', 'arc'])
  })

  it('reads a bent side, and a corner that is not a true quarter circle, as cubics', () => {
    const bent = outlinePrimitives(object('s', { ...slabSpec('rounded'), sides: { top: { a1: 0, o1: 30, a2: 0, o2: 30 } } }))
    expect(bent[0].kind).toBe('cubic')
    // The corners either side of a bent side take their handles from it.
    expect(kinds(bent).filter((kind) => kind === 'arc')).toHaveLength(2)
    const fuller = outlinePrimitives(object('s', { ...slabSpec('rounded'), corners: { tr: { k1: 1.4, k2: 1.4 } } }))
    expect(fuller[1].kind).toBe('cubic')
    expect(kinds(fuller).filter((kind) => kind === 'arc')).toHaveLength(3)
  })

  it('reads a circle punch as a circle, and a square or triangle punch as its sides', () => {
    expect(outlinePrimitives(object('p', punch('circle')))).toEqual([{ kind: 'circle', c: { x: 10, y: 20 }, r: 40, owner: 'p' }])
    expect(kinds(outlinePrimitives(object('p', punch('square'))))).toEqual(['segment', 'segment', 'segment', 'segment'])
    expect(kinds(outlinePrimitives(object('p', punch('triangle'))))).toEqual(['segment', 'segment', 'segment'])
  })

  it('reads a channel as two sides and two round caps, and a slice as four lines', () => {
    const channel = outlinePrimitives(object('g', groove('channel')))
    expect(kinds(channel)).toEqual(['segment', 'arc', 'segment', 'arc'])
    const [, end, , start] = channel
    if (end.kind !== 'arc' || start.kind !== 'arc') throw new Error('not arcs')
    expect(end.c.x).toBeCloseTo(100, 9)
    expect(end.c.y).toBeCloseTo(0, 9)
    expect(end.r).toBeCloseTo(20, 9)
    expect(end.end - end.start).toBeCloseTo(Math.PI, 9)
    // The end cap bulges to the right, the start cap to the left.
    expect(arcHas(end, 0)).toBe(true)
    expect(arcHas(end, Math.PI)).toBe(false)
    expect(arcHas(start, Math.PI)).toBe(true)
    expect(kinds(outlinePrimitives(object('g', groove('slice'))))).toEqual(['segment', 'segment', 'segment', 'segment'])
  })

  it('reads a bent channel as curved sides with round caps', () => {
    const pieces = outlinePrimitives(object('g', groove('channel', { bend: { a1: 0, o1: 40, a2: 0, o2: 40 } })))
    expect(kinds(pieces)).toContain('cubic')
    expect(kinds(pieces).filter((kind) => kind === 'arc')).toHaveLength(2)
  })

  it('reads a free path as segments and cubics, and a spark circle as one circle', () => {
    const contour: Contour = {
      closed: true,
      segments: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: { x: 30, y: 40 } },
        { point: { x: 100, y: 100 }, handleIn: { x: 20, y: -30 }, handleOut: null },
      ],
    }
    expect(kinds(outlinePrimitives({ id: 'f', contours: [contour] }))).toEqual(['segment', 'cubic', 'segment'])
    const [circle] = outlinePrimitives({ id: 'spark', contours: [circleContour({ x: 30, y: 40 }, 50)] })
    if (circle.kind !== 'circle') throw new Error('not a circle')
    expect(circle.c.x).toBeCloseTo(30, 6)
    expect(circle.r).toBeCloseTo(50, 6)
  })

  it('keeps the pieces of an object as long as the object', () => {
    const slab = object('s', slabSpec('rounded'))
    expect(outlinePrimitives(slab)).toBe(outlinePrimitives(slab))
  })

  it('reads a guide as an infinite line, a circle or its path, marked as a guide', () => {
    const guide = (shape: Guide['shape']): Guide => ({ id: 'g', name: 'g', visible: true, locked: false, style: 'solid', shape })
    const [line] = guidePrimitives(guide({ kind: 'line', p: { x: 0, y: 50 }, angle: 90 }))
    expect(line).toMatchObject({ kind: 'line', p: { x: 0, y: 50 }, owner: 'g', guide: true })
    if (line.kind !== 'line') throw new Error('not a line')
    expect(line.d.x).toBeCloseTo(0, 12)
    expect(line.d.y).toBeCloseTo(1, 12)
    expect(guidePrimitives(guide({ kind: 'circle', c: { x: 1, y: 2 }, r: 3 }))).toEqual([{ kind: 'circle', c: { x: 1, y: 2 }, r: 3, owner: 'g', guide: true }])
    const open: Contour = {
      closed: false,
      segments: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
        { point: { x: 50, y: 50 }, handleIn: null, handleOut: null },
      ],
    }
    expect(guidePrimitives(guide({ kind: 'path', contour: open }))).toEqual([{ kind: 'segment', a: { x: 0, y: 0 }, b: { x: 50, y: 50 }, owner: 'g', guide: true }])
  })
})

describe('measuring primitives', () => {
  it('finds the nearest point on an arc, or its nearer end beyond it', () => {
    const arc: Primitive = { kind: 'arc', c: { x: 0, y: 0 }, r: 10, start: 0, end: Math.PI / 2, owner: 'a' }
    const on = nearestOnPrimitive(arc, { x: 20, y: 20 })
    expect(on.point.x).toBeCloseTo(Math.SQRT1_2 * 10, 9)
    expect(on.distance).toBeCloseTo(Math.hypot(20, 20) - 10, 9)
    const off = nearestOnPrimitive(arc, { x: 0, y: -30 })
    expect(off.point.x).toBeCloseTo(10, 9)
    expect(off.point.y).toBeCloseTo(0, 9)
  })

  it('crosses lines, circles, arcs and cubics where they meet', () => {
    const across: Primitive = { kind: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 }, owner: 'a' }
    const upright: Primitive = { kind: 'segment', a: { x: 30, y: -50 }, b: { x: 30, y: 50 }, owner: 'b' }
    expect(intersectPrimitives(across, upright)).toEqual([{ x: 30, y: 0 }])
    const circle: Primitive = { kind: 'circle', c: { x: 0, y: 0 }, r: 50, owner: 'c' }
    const points = intersectPrimitives(across, circle).map((p) => p.x).sort((a, b) => a - b)
    expect(points[0]).toBeCloseTo(-50, 9)
    expect(points[1]).toBeCloseTo(50, 9)
    const half: Primitive = { kind: 'arc', c: { x: 0, y: 0 }, r: 50, start: 0, end: Math.PI, owner: 'd' }
    const other: Primitive = { kind: 'circle', c: { x: 60, y: 0 }, r: 50, owner: 'e' }
    const meet = intersectPrimitives(half, other)
    expect(meet).toHaveLength(1)
    expect(meet[0].x).toBeCloseTo(30, 9)
    expect(meet[0].y).toBeCloseTo(40, 9)
    const wave: Primitive = { kind: 'cubic', curve: [{ x: -100, y: -40 }, { x: -30, y: 80 }, { x: 30, y: -80 }, { x: 100, y: 40 }], owner: 'f' }
    expect(intersectPrimitives(wave, across)).toHaveLength(3)
    const flipped: Primitive = { kind: 'cubic', curve: [{ x: -100, y: 40 }, { x: -30, y: -80 }, { x: 30, y: 80 }, { x: 100, y: -40 }], owner: 'g' }
    const crossings = intersectPrimitives(wave, flipped)
    expect(crossings.length).toBeGreaterThanOrEqual(1)
    for (const p of crossings) expect(nearestOnPrimitive(flipped, p).distance).toBeLessThan(1e-3)
  })
})
