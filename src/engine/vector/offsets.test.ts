import { describe, expect, it, vi } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { rotateCarveAbout, scaleCarveAbout, translateCarve } from '../carve/edit.ts'
import { polygonApothem, roundCarveSpec, slabSpec, type CarveSpec, type PolygonSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { DEFAULT_PARAMS } from '../types.ts'
import { writeContours, writeRecipe } from '../../store/objectEdits.ts'
import { createEmptyVectorDocument, repairVectorDocument } from './document.ts'
import { follow, type DocumentLists } from './follow.ts'
import { decodeLink, encodeLink } from './link.ts'
import { MAX_OFFSET, breakOffsetLoops, detachOffset, followOffsets, isOffsetCopy, offsetDistanceText, offsetIsQuick, offsetName, offsetRoot, type OffsetCopy } from './offsets.ts'
import { createSavedVariation, savedDocument } from './saved.ts'
import { offsetContours } from '../geometry/offset.ts'
import type { Contour, PathObject, VectorDocument, VectorObject } from './types.ts'

// The general method, counted: an edit makes each copy once.
vi.mock('../geometry/offset.ts', async (original) => {
  const actual = await original<typeof import('../geometry/offset.ts')>()
  return { ...actual, offsetContours: vi.fn(actual.offsetContours) }
})

function recipe(id: string, carve: CarveSpec, operation: 'add' | 'subtract' = 'add'): PathObject {
  const rounded = roundCarveSpec(carve)
  return { id, name: id, parentId: null, type: 'path', visible: true, locked: false, operation, fillRule: 'evenodd', contours: [segsToContour(carveOutline(rounded).segs)], carve: rounded }
}

function copyOf(id: string, of: string, distance: number, operation: 'add' | 'subtract' = 'subtract'): OffsetCopy {
  return { id, name: offsetName(distance), parentId: null, type: 'path', visible: true, locked: false, operation, fillRule: 'evenodd', contours: [], link: { kind: 'offset', of, distance } }
}

/** The lists after adding `objects` to an empty document: the follow pass makes every copy. */
function made(objects: VectorObject[]): DocumentLists {
  return follow({ objects: [], guides: [], fillets: [] }, { objects, guides: [], fillets: [] })
}

/** An edit of one object, the others as they were: the lists the follow pass leaves. */
function edit(before: DocumentLists, id: string, update: (object: PathObject) => PathObject | null): DocumentLists {
  const objects = before.objects.flatMap((object) => {
    if (object.id !== id || object.type !== 'path') return [object]
    const next = update(object)
    return next ? [next] : []
  })
  return follow(before, { ...before, objects })
}

const byId = (lists: DocumentLists, id: string) => lists.objects.find((object) => object.id === id) as PathObject

const hexagon: PolygonSpec = { v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius: 200, rotation: 0, cornerRadius: 60 }

/** A free closed contour through some points, without handles. */
function polygonContour(points: Array<[number, number]>): Contour {
  return { closed: true, segments: points.map(([x, y]) => ({ point: { x, y }, handleIn: null, handleOut: null })) }
}

describe('an offset copy', () => {
  it('is made from its source as it is added: ref 1’s inset as a cut is a hexagon 55 in, its corners rounded to 5', () => {
    const lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
    const ring = byId(lists, 'ring')
    expect(ring.carve).toMatchObject({ kind: 'polygon', sides: 6, cornerRadius: 5 })
    expect(polygonApothem(hexagon) - polygonApothem(ring.carve as PolygonSpec)).toBeCloseTo(55, 2)
    expect(ring.contours).toEqual([segsToContour(carveOutline(ring.carve!).segs)])
    expect(ring.link).toEqual({ kind: 'offset', of: 'hex', distance: -55 })
    expect(ring.operation).toBe('subtract')
  })

  it('follows its source as it is resized, moved and turned, keeping its distance', () => {
    let lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
    const steps: Array<(carve: CarveSpec) => CarveSpec> = [
      (carve) => scaleCarveAbout(carve, { x: -170, y: -100 }, 1.37),
      (carve) => translateCarve(carve, { x: 41, y: -12 }),
      (carve) => rotateCarveAbout(carve, { x: 10, y: 10 }, 23),
    ]
    for (const step of steps) {
      lists = edit(lists, 'hex', (object) => writeRecipe(object, step(object.carve!)))
      const source = byId(lists, 'hex').carve as PolygonSpec
      const copy = byId(lists, 'ring').carve as PolygonSpec
      expect(Math.abs(polygonApothem(source) - polygonApothem(copy) - 55)).toBeLessThanOrEqual(0.01)
      expect(copy.cornerRadius).toBeCloseTo(Math.max(source.cornerRadius - 55, 0), 2)
      expect(copy.center).toEqual(source.center)
      expect(copy.rotation).toBe(source.rotation)
    }
  })

  it('stays the very same object when its source changes in a way it does not see', () => {
    const lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
    const renamed = edit(lists, 'hex', (object) => ({ ...object, name: 'Hexagon' }))
    expect(byId(renamed, 'ring')).toBe(byId(lists, 'ring'))
    const other = made([...lists.objects, recipe('dot', slabSpec('circle'))])
    expect(followOffsets(other.objects, new Set(['dot']))).toBe(other.objects)
  })

  it('follows a free source by the general method, and is empty while nothing is left at its distance', () => {
    const square = polygonContour([[-100, -100], [100, -100], [100, 100], [-100, 100]])
    const free: PathObject = { id: 'free', name: 'Shape 1', parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'nonzero', contours: [square] }
    let lists = made([free, copyOf('inner', 'free', -30)])
    const inner = byId(lists, 'inner')
    expect(inner.carve).toBeUndefined()
    const xs = inner.contours[0].segments.map((segment) => Math.abs(segment.point.x))
    expect(Math.max(...xs)).toBeCloseTo(70, 1)
    // Shrunk below twice the distance, nothing is left: the copy keeps its link and empties.
    lists = edit(lists, 'free', (object) => writeContours(object, [polygonContour([[-20, -20], [20, -20], [20, 20], [-20, 20]])]))
    expect(byId(lists, 'inner').contours).toEqual([])
    expect(byId(lists, 'inner').link).toEqual({ kind: 'offset', of: 'free', distance: -30 })
    lists = edit(lists, 'free', (object) => writeContours(object, [square]))
    expect(byId(lists, 'inner').contours).toHaveLength(1)
  })

  it('takes an exact recipe while its source has one, and free contours once the source is bent', () => {
    let lists = made([recipe('slab', slabSpec('rounded')), copyOf('out', 'slab', 20, 'add')])
    expect(byId(lists, 'out').carve).toMatchObject({ kind: 'slab', width: 420, radius: 110 })
    lists = edit(lists, 'slab', (object) => writeRecipe(object, { ...object.carve!, sides: { top: { a1: 0, o1: 40, a2: 0, o2: 40 } } } as CarveSpec))
    expect(byId(lists, 'out').carve).toBeUndefined()
    expect(byId(lists, 'out').contours).toHaveLength(1)
    expect(byId(lists, 'out').link?.kind).toBe('offset')
  })

  it('detaches, keeping its geometry, when its source is deleted, in the same edit', () => {
    const lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
    const ring = byId(lists, 'ring')
    const after = edit(lists, 'hex', () => null)
    expect(after.objects).toHaveLength(1)
    const kept = byId(after, 'ring')
    expect(kept.link).toBeUndefined()
    expect(kept.carve).toEqual(ring.carve)
    expect(kept.contours).toBe(ring.contours)
  })

  it('detaches when its own geometry is edited: a recipe of its own, or a path edit', () => {
    const lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
    const turned = edit(lists, 'ring', (object) => writeRecipe(object, rotateCarveAbout(object.carve!, { x: 0, y: 0 }, 10)))
    expect(byId(turned, 'ring').link).toBeUndefined()
    expect((byId(turned, 'ring').carve as PolygonSpec).rotation).toBe(10)
    const pointEdited = edit(lists, 'ring', (object) => writeContours(object, [polygonContour([[0, 0], [10, 0], [0, 10]])]))
    expect(byId(pointEdited, 'ring').link).toBeUndefined()
    // Detached, it no longer follows the hexagon.
    const resized = edit(turned, 'hex', (object) => writeRecipe(object, scaleCarveAbout(object.carve!, { x: 0, y: 0 }, 2)))
    expect(byId(resized, 'ring')).toBe(byId(turned, 'ring'))
  })

  it('follows through a chain: an offset of an offset of a circle', () => {
    let lists = made([copyOf('c', 'b', 10, 'add'), recipe('a', slabSpec('circle')), copyOf('b', 'a', -40, 'add')])
    expect(byId(lists, 'b').carve).toMatchObject({ width: 320, radius: 160 })
    expect(byId(lists, 'c').carve).toMatchObject({ width: 340, radius: 170 })
    lists = edit(lists, 'a', (object) => writeRecipe(object, scaleCarveAbout(object.carve!, { x: 0, y: 0 }, 0.5)))
    expect(byId(lists, 'b').carve).toMatchObject({ width: 120, radius: 60 })
    expect(byId(lists, 'c').carve).toMatchObject({ width: 140, radius: 70 })
    expect(offsetRoot(lists.objects, 'c')).toBe('a')
    expect(offsetRoot(lists.objects, 'a')).toBe('a')
  })

  it('follows through a pin in the chain: an offset of a recipe pinned to a copy’s centre moves when the first source does', () => {
    const punch: CarveSpec = { v: 1, kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30, rotation: 0 }
    let lists = made([recipe('a', slabSpec('circle')), copyOf('c', 'a', -40)])
    lists = follow(lists, { ...lists, objects: [...lists.objects, { ...recipe('p', punch), pin: { centreOf: 'c' } }] })
    lists = follow(lists, { ...lists, objects: [...lists.objects, copyOf('d', 'p', 10)] })
    lists = edit(lists, 'a', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 100, y: 50 })))
    expect(byId(lists, 'c').carve).toMatchObject({ center: { x: 100, y: 50 } })
    expect(byId(lists, 'p').carve).toMatchObject({ center: { x: 100, y: 50 } })
    expect(byId(lists, 'd').carve).toMatchObject({ center: { x: 100, y: 50 }, radius: 40 })
  })

  it('keeps a recipe pinned to it pinned when both move with its source, as select all and an arrow move them', () => {
    const punch: CarveSpec = { v: 1, kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 10, rotation: 0 }
    let lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
    lists = follow(lists, { ...lists, objects: [...lists.objects, { ...recipe('p', punch), pin: { centreOf: 'ring' } }] })
    const by = { x: 1, y: 0 }
    const objects = lists.objects.map((object) => (object.type === 'path' && (object.id === 'hex' || object.id === 'p') ? writeRecipe(object, translateCarve(object.carve!, by)) : object))
    lists = follow(lists, { ...lists, objects })
    expect(byId(lists, 'ring').carve).toMatchObject({ center: by })
    expect(byId(lists, 'p').carve).toMatchObject({ center: by })
    expect(byId(lists, 'p').pin).toEqual({ centreOf: 'ring' })
    // Moved alone, off the copy's centre, it lets go.
    lists = edit(lists, 'p', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 30, y: 0 })))
    expect(byId(lists, 'p').pin).toBeUndefined()
  })

  it('is made once per edit by the general method, however many copies follow: fourteen insets of one free shape', () => {
    const square = (half: number) => polygonContour([[-half, -half], [half, -half], [half, half], [-half, half]])
    const free: PathObject = { id: 'free', name: 'Shape 1', parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'nonzero', contours: [square(300)] }
    const copies = Array.from({ length: 14 }, (_, k) => copyOf(`c${k}`, 'free', -10 * (k + 1)))
    let lists = made([free, ...copies])
    const counted = vi.mocked(offsetContours)
    for (const half of [310, 320]) {
      counted.mockClear()
      lists = edit(lists, 'free', (object) => writeContours(object, [square(half)]))
      expect(counted).toHaveBeenCalledTimes(14)
      const last = byId(lists, 'c13').contours[0].segments.map((segment) => segment.point.x)
      expect(Math.max(...last)).toBeCloseTo(half - 140, 1)
    }
    // Moved, every copy is the kept one moved alike: none is made again.
    counted.mockClear()
    lists = edit(lists, 'free', (object) => writeContours(object, [polygonContour(object.contours[0].segments.map((segment) => [segment.point.x + 5, segment.point.y]))]))
    expect(counted).not.toHaveBeenCalled()
  })

  it('takes no pin: it goes where its source puts it', () => {
    const lists = made([recipe('hex', hexagon), { ...copyOf('ring', 'hex', -55), pin: { centreOf: 'hex' } }])
    expect(byId(lists, 'ring').pin).toBeUndefined()
  })

  it('makes a bent slice’s copy as the slice 2d wider, at once and with handles, as a bent channel’s', () => {
    const slice: CarveSpec = { v: 1, kind: 'slice', from: { x: -150, y: 0 }, to: { x: 150, y: 20 }, width: 30, bend: { a1: 0, o1: 60, a2: 0, o2: 60 } }
    for (const kind of ['slice', 'channel'] as const) {
      const source = recipe('s', { ...slice, kind }, 'subtract')
      const started = performance.now()
      const copy = made([source, copyOf('c', 's', 20)]).objects[1] as PathObject
      expect(performance.now() - started).toBeLessThan(50)
      expect(copy.carve).toEqual({ ...slice, kind, width: 70 })
      expect(offsetIsQuick(source, -14)).toBe(true)
    }
  })

  it('is named for its distance, with a true minus sign', () => {
    expect(offsetName(-55)).toBe('Inset −55')
    expect(offsetName(12)).toBe('Outset 12')
    expect(offsetDistanceText(-7.5)).toBe('−7.5')
    expect(isOffsetCopy(copyOf('x', 'y', 3))).toBe(true)
    expect(isOffsetCopy(detachOffset(copyOf('x', 'y', 3)))).toBe(false)
  })
})

describe('offset links read from outside the editor', () => {
  const lists = made([recipe('hex', hexagon), copyOf('ring', 'hex', -55)])
  const document: VectorDocument = JSON.parse(JSON.stringify({ ...createEmptyVectorDocument('Ring'), objects: lists.objects }))

  it('keep the copy and its link through the repairing read, a link and a saved mark', () => {
    expect(repairVectorDocument(document)).toBe(document)
    const decoded = decodeLink(encodeLink(document, '#123456'))
    expect(decoded.kind === 'vector' && decoded.document.objects).toEqual(lists.objects)
    const entry = JSON.parse(JSON.stringify(createSavedVariation(document, { ...DEFAULT_PARAMS, fillColor: '#123456' })))
    expect(savedDocument(entry)?.document.objects).toEqual(lists.objects)
  })

  it('lose a link to an object that is not there, to a group, or that closes a loop', () => {
    const [hex, ring] = lists.objects as PathObject[]
    const group = { id: 'g', type: 'group', name: 'Group', parentId: null, visible: true, locked: false, isolated: false, operation: 'add' }
    const looped = [
      { ...hex, link: { kind: 'offset', of: 'ring', distance: 55 } },
      ring,
      { ...ring, id: 'gone', link: { kind: 'offset', of: 'nobody', distance: 3 } },
      group,
      { ...ring, id: 'grouped', parentId: 'g', link: { kind: 'offset', of: 'g', distance: 3 } },
    ]
    const repaired = repairVectorDocument(JSON.parse(JSON.stringify({ ...document, objects: looped })))!
    const links = Object.fromEntries(repaired.objects.map((object) => [object.id, object.type === 'path' ? object.link : undefined]))
    // Walking from the bottom, the hexagon's link closes the loop and goes; the ring keeps following it.
    expect(links).toEqual({ hex: undefined, ring: { kind: 'offset', of: 'hex', distance: -55 }, gone: undefined, g: undefined, grouped: undefined })
    expect(breakOffsetLoops(lists.objects)).toBe(lists.objects)
  })

  it('read a distance further than any copy may lie at the furthest, and lose a link with no finite distance', () => {
    const [hex, ring] = lists.objects as PathObject[]
    const far = [
      hex,
      { ...ring, link: { kind: 'offset', of: 'hex', distance: 1e7 } },
      { ...ring, id: 'near', link: { kind: 'offset', of: 'hex', distance: -MAX_OFFSET } },
      { ...ring, id: 'in', link: { kind: 'offset', of: 'hex', distance: -1e9 } },
      { ...ring, id: 'nan', link: { kind: 'offset', of: 'hex', distance: 'NaN' } },
      { ...ring, id: 'none', link: { kind: 'offset', of: 'hex', distance: null } },
    ]
    const repaired = repairVectorDocument(JSON.parse(JSON.stringify({ ...document, objects: far })))!
    const links = repaired.objects.map((object) => (object as PathObject).link)
    expect(MAX_OFFSET).toBe(600)
    expect(links.slice(1)).toEqual([
      { kind: 'offset', of: 'hex', distance: 600 },
      { kind: 'offset', of: 'hex', distance: -600 },
      { kind: 'offset', of: 'hex', distance: -600 },
      undefined,
      undefined,
    ])
    // Read as stored: the copies keep their geometry, linked or not.
    for (const object of repaired.objects.slice(1)) expect((object as PathObject).contours).toEqual(ring.contours)
    expect(offsetContours(ring.contours, 'evenodd', 1e7)).toBeNull()
  })
})
