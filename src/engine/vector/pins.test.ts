import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec, type PunchSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { rotate } from '../path/bezier.ts'
import { follow, type DocumentLists } from './follow.ts'
import { constructionShape } from './guides.ts'
import { breakPinLoops, pinLoops, pinsLostWithTarget, shapeCentre } from './pins.ts'
import type { Guide, PathObject, VectorObject } from './types.ts'

function recipe(id: string, carve: CarveSpec, pin?: string): PathObject {
  return {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: false,
    type: 'path',
    operation: carve.kind === 'slab' ? 'add' : 'subtract',
    contours: [segsToContour(carveOutline(carve).segs)],
    fillRule: 'nonzero',
    carve,
    ...(pin ? { pin: { centreOf: pin } } : {}),
  }
}

const punch = (center = { x: 0, y: 0 }, radius = 30): PunchSpec => ({ v: 1, kind: 'punch', shape: 'circle', center, radius, rotation: 0 })
const circle = recipe('circle', slabSpec('circle'))
const pinned = recipe('punch', punch(), 'circle')

function lists(objects: VectorObject[], guides: Guide[] = []): DocumentLists {
  return { objects, guides, fillets: [] }
}

const carveOf = (after: DocumentLists, id: string) => (after.objects.find((object) => object.id === id) as PathObject).carve!

describe('centre pins', () => {
  it('moves a pinned punch with its circle when the circle moves', () => {
    const before = lists([circle, pinned])
    const moved = recipe('circle', { ...slabSpec('circle'), center: { x: 120, y: -40 } })
    const after = follow(before, lists([moved, pinned]))
    expect((carveOf(after, 'punch') as PunchSpec).center).toEqual({ x: 120, y: -40 })
    expect((after.objects[1] as PathObject).pin).toEqual({ centreOf: 'circle' })
    // Its outline moves with its recipe.
    expect(after.objects[1].type === 'path' && after.objects[1].contours).toEqual(recipe('x', punch({ x: 120, y: -40 })).contours)
  })

  it('keeps it centred when the circle is resized from a corner, which moves the centre', () => {
    const before = lists([circle, pinned])
    const grown = recipe('circle', { ...slabSpec('circle'), center: { x: 25.5, y: 25.5 }, width: 451, height: 451, radius: 225.5 })
    const after = follow(before, lists([grown, pinned]))
    expect((carveOf(after, 'punch') as PunchSpec).center).toEqual({ x: 25.5, y: 25.5 })
    expect((carveOf(after, 'punch') as PunchSpec).radius).toBe(30)
  })

  it('lets go when the pinned punch itself is moved off the centre, and holds when it is only resized', () => {
    const before = lists([circle, pinned])
    const dragged = recipe('punch', punch({ x: 80, y: 0 }), 'circle')
    const away = follow(before, lists([circle, dragged]))
    expect((away.objects[1] as PathObject).pin).toBeUndefined()
    expect((carveOf(away, 'punch') as PunchSpec).center).toEqual({ x: 80, y: 0 })
    const larger = recipe('punch', punch({ x: 0, y: 0 }, 50), 'circle')
    const resized = follow(before, lists([circle, larger]))
    expect(resized.objects[1]).toBe(larger)
  })

  it('moves the two together, pinned to each other in a chain, and what follows the last moves too', () => {
    const inner = recipe('inner', punch({ x: 0, y: 0 }, 10), 'punch')
    const rim: Guide = {
      id: 'rim',
      name: 'Circumcircle',
      visible: true,
      locked: false,
      style: 'solid',
      shape: constructionShape(inner, 'circumcircle')!,
      link: { kind: 'construction', of: 'inner', role: 'circumcircle' },
    }
    const before = lists([circle, pinned, inner], [rim])
    const moved = recipe('circle', { ...slabSpec('circle'), center: { x: -60, y: 10 } })
    const after = follow(before, lists([moved, pinned, inner], [rim]))
    expect((carveOf(after, 'inner') as PunchSpec).center).toEqual({ x: -60, y: 10 })
    expect(after.guides[0].shape).toEqual({ kind: 'circle', c: { x: -60, y: 10 }, r: 10 })
  })

  it('drops a pin to an object that is deleted, in the same edit', () => {
    const before = lists([circle, pinned])
    const after = follow(before, lists([pinned]))
    expect((after.objects[0] as PathObject).pin).toBeUndefined()
    expect((after.objects[0] as PathObject).carve).toEqual(pinned.carve)
  })

  it('names the recipes let go of because their target went, so the canvas can say so', () => {
    const before = lists([circle, pinned])
    const after = follow(before, lists([pinned]))
    expect(pinsLostWithTarget(before.objects, after.objects)).toEqual(['punch'])
    // Dragged away with its target still there, or gone with it: not this.
    const dragged = follow(before, lists([circle, recipe('punch', punch({ x: 80, y: 0 }), 'circle')]))
    expect(pinsLostWithTarget(before.objects, dragged.objects)).toEqual([])
    expect(pinsLostWithTarget(before.objects, [])).toEqual([])
  })

  it('reads the centre of a recipe, a circle and a free shape', () => {
    expect(shapeCentre(circle)).toEqual({ x: 0, y: 0 })
    expect(shapeCentre({ carve: { v: 1, kind: 'channel', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, width: 20 }, contours: [] })).toEqual({ x: 50, y: 25 })
    const free = { contours: [{ closed: true, segments: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 60 }].map((point) => ({ point, handleIn: null, handleOut: null })) }] }
    expect(shapeCentre(free)).toEqual({ x: 50, y: 30 })
  })

  it('reads a turned free shape’s centre in its frame, so the centre turns with it', () => {
    const points = [{ x: -150, y: -100 }, { x: 150, y: -100 }, { x: -150, y: 131 }]
    const shape = (turn: number) => ({
      contours: [{ closed: true, segments: points.map((point) => ({ point: rotate(point, turn), handleIn: null, handleOut: null })) }],
      frame: { rotation: turn },
    })
    expect(shapeCentre(shape(0))).toEqual({ x: 0, y: 15.5 })
    const turned = shapeCentre(shape(30))!
    const expected = rotate({ x: 0, y: 15.5 }, 30)
    expect(turned.x).toBeCloseTo(expected.x, 9)
    expect(turned.y).toBeCloseTo(expected.y, 9)
  })

  it('breaks a loop of pins, and a pin on what cannot take one', () => {
    const a = recipe('a', punch(), 'b')
    const b = recipe('b', punch(), 'a')
    expect(pinLoops([a, { ...b, pin: undefined }], 'b', 'a')).toBe(true)
    const broken = breakPinLoops([a, b])
    expect(broken.map((object) => (object as PathObject).pin?.centreOf)).toEqual([undefined, 'a'])
    // A free shape stores no centre, so it holds no pin.
    const { carve: _carve, ...free } = recipe('f', punch(), 'b')
    expect((breakPinLoops([free, recipe('b', punch())])[0] as PathObject).pin).toBeUndefined()
    const fine = [circle, pinned]
    expect(breakPinLoops(fine)).toBe(fine)
  })

  it('pins a groove by its middle, and moves it with its target', () => {
    const channel = recipe('g', { v: 1, kind: 'channel', from: { x: -50, y: 0 }, to: { x: 50, y: 0 }, width: 20 }, 'circle')
    const kept = [circle, channel]
    expect(breakPinLoops(kept)).toBe(kept)
    const moved = recipe('circle', slabSpec('circle', { x: 30, y: -20 }))
    const after = follow(lists(kept), lists([moved, channel]))
    expect(carveOf(after, 'g')).toMatchObject({ from: { x: -20, y: -20 }, to: { x: 80, y: -20 } })
    expect((after.objects[1] as PathObject).pin).toEqual({ centreOf: 'circle' })
  })
})
