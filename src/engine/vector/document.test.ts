import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { createEmptyVectorDocument, MAX_GROUP_DEPTH, repairStructure, repairVectorDocument } from './document.ts'
import type { Contour, Fillet, GroupObject, Guide, PathObject, VectorDocument, VectorObject } from './types.ts'

const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const square: Contour = {
  closed: true,
  segments: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
    { point: { x: 100, y: 0 }, handleIn: null, handleOut: null },
    { point: { x: 100, y: 100 }, handleIn: null, handleOut: null },
  ],
}

function path(id: string, extra: Partial<PathObject> = {}): PathObject {
  return { id, name: id, parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours: [square], fillRule: 'nonzero', ...extra }
}

function group(id: string, extra: Partial<GroupObject> = {}): GroupObject {
  return { id, name: id, parentId: null, visible: true, locked: false, type: 'group', isolated: false, operation: 'add', ...extra }
}

function doc(objects: VectorObject[], extra: Partial<VectorDocument> = {}): VectorDocument {
  return stored({ ...createEmptyVectorDocument('Test'), objects, ...extra })
}

const repaired = (value: unknown) => repairVectorDocument(value)!
const ids = (document: VectorDocument) => document.objects.map((object) => `${object.id}${object.parentId ? `<${object.parentId}` : ''}`)

describe('reading a version 2 document', () => {
  it('gives back the very same document when nothing needs repair', () => {
    const spec = slabSpec('square')
    const document = doc([
      group('g', { isolated: true }),
      path('a', { parentId: 'g', carve: spec, contours: [segsToContour(carveOutline(spec).segs)], pin: { centreOf: 'b' } }),
      path('b', { parentId: 'g', frame: { rotation: 30 }, link: { kind: 'offset', of: 'a', distance: -10 } }),
    ])
    expect(repairVectorDocument(document)).toBe(document)
  })

  it('refuses one that lacks what every document needs', () => {
    const document = doc([path('a')])
    expect(repairVectorDocument(null)).toBeNull()
    expect(repairVectorDocument({ ...document, schemaVersion: 3 })).toBeNull()
    expect(repairVectorDocument({ ...document, artboards: [] })).toBeNull()
    expect(repairVectorDocument({ ...document, objects: 'none' })).toBeNull()
    expect(repairVectorDocument({ ...document, objects: [{ ...path('a'), contours: [{ closed: true, segments: [{ point: { x: 'a' } }] }] }] })).toBeNull()
    expect(repairVectorDocument({ ...document, objects: [{ ...path('a'), contours: 'none' }] })).toBeNull()
    expect(repairVectorDocument({ ...document, objects: ['a'] })).toBeNull()
  })

  it('drops an object of a type it does not know, and keeps the rest', () => {
    const document = repaired({ ...doc([path('a'), path('b')]), objects: [path('a'), { ...path('t'), type: 'text' }, path('b')] })
    expect(ids(document)).toEqual(['a', 'b'])
  })

  it('gives an object the values a new one has for flags, names, rules and operations that are missing or of the wrong type', () => {
    const { name: _name, visible: _visible, locked: _locked, parentId: _parentId, fillRule: _fillRule, ...bare } = path('a')
    const { operation: _operation, isolated: _isolated, ...bareGroup } = group('g')
    const document = repaired({
      ...doc([]),
      objects: [{ ...bare, operation: 'xor' }, bareGroup, { ...path('m'), parentId: 'g', visible: 'yes', id: 7 }],
    })
    expect(document.objects).toEqual([
      path('a', { name: '', fillRule: 'evenodd' }),
      group('g'),
      path('7', { name: 'm', parentId: 'g' }),
    ])
  })

  it('drops a contour with no points, so the contours a point edit counts are the ones it writes', () => {
    const empty: Contour = { closed: true, segments: [] }
    const document = repaired(doc([path('a', { contours: [empty, square, empty] })]))
    expect((document.objects[0] as PathObject).contours).toEqual([square])
  })

  it('drops a recipe of a kind it does not know, or one that no longer matches, and keeps the geometry', () => {
    const spec = slabSpec('square')
    const outline = segsToContour(carveOutline(spec).segs)
    const document = repaired(
      doc([
        path('unknown', { carve: { v: 1, kind: 'polygon', sides: 6 } as never, contours: [outline] }),
        path('stale', { carve: { ...spec, width: 10 }, contours: [outline] }),
        path('two', { carve: spec, contours: [outline, square] }),
      ]),
    )
    for (const object of document.objects as PathObject[]) expect(object.carve).toBeUndefined()
    expect((document.objects[0] as PathObject).contours).toEqual([outline])
    expect((document.objects[2] as PathObject).contours).toHaveLength(2)
  })

  it('drops a frame that is not a turn, or that sits on a recipe', () => {
    const spec = slabSpec('square')
    const document = repaired(
      doc([
        path('nan', { frame: { rotation: Number.NaN } }),
        path('recipe', { carve: spec, contours: [segsToContour(carveOutline(spec).segs)], frame: { rotation: 15 } }),
        path('fine', { frame: { rotation: 15 } }),
      ]),
    )
    expect(document.objects.map((object) => object.frame)).toEqual([undefined, undefined, { rotation: 15 }])
  })

  it('detaches a link of a kind it does not know, or to an object that is not there, and a pin likewise', () => {
    const spec = slabSpec('circle')
    const circle = segsToContour(carveOutline(spec).segs)
    const document = repaired(
      doc([
        path('a', { link: { kind: 'fillet', a: 'b' } as never }),
        path('b', { link: { kind: 'band', a: 'a', b: 'gone' } }),
        path('c', { link: { kind: 'offset', of: 'c', distance: 4 } }),
        path('d', { link: { kind: 'offset', of: 'a', distance: 4 } }),
        path('e', { carve: spec, contours: [circle], pin: { centreOf: 'gone' } }),
        path('f', { pin: { centreOf: 'a' } }),
        path('g', { carve: spec, contours: [circle], pin: { centreOf: 'a' } }),
      ]),
    )
    const [a, b, c, d, e, f, g] = document.objects as PathObject[]
    expect([a.link, b.link, c.link]).toEqual([undefined, undefined, undefined])
    expect(d.link).toEqual({ kind: 'offset', of: 'a', distance: 4 })
    // A pin holds a recipe's centre: on a free path it holds nothing.
    expect([e.pin, f.pin]).toEqual([undefined, undefined])
    expect(g.pin).toEqual({ centreOf: 'a' })
    expect(a.contours).toEqual([square])
  })

  it('moves an object whose group is not there to the root, and breaks a loop of groups', () => {
    const document = repaired(
      doc([
        path('lost', { parentId: 'nowhere' }),
        path('under-path', { parentId: 'lost' }),
        group('x', { parentId: 'y' }),
        group('y', { parentId: 'x' }),
        path('in-y', { parentId: 'y' }),
      ]),
    )
    expect(document.objects.find((object) => object.id === 'lost')?.parentId).toBeNull()
    expect(document.objects.find((object) => object.id === 'under-path')?.parentId).toBeNull()
    // Every chain of parents ends at the root.
    const byId = new Map(document.objects.map((object) => [object.id, object]))
    for (const object of document.objects) {
      const seen = new Set<string>()
      let parent = object.parentId
      while (parent) {
        expect(seen.has(parent)).toBe(false)
        seen.add(parent)
        parent = byId.get(parent)!.parentId
      }
    }
  })

  it('reads ten thousand nested groups, or a loop of them, in either order, quickly and no deeper than the deepest nesting', () => {
    const count = 10_000
    const chain = Array.from({ length: count }, (_, i) => group(`g${i}`, i === 0 ? {} : { parentId: `g${i - 1}` }))
    const loop = chain.map((each, i) => (i === 0 ? { ...each, parentId: `g${count - 1}` } : each))
    const inside = [path('deep', { parentId: `g${count - 1}` }), path('top', { parentId: 'g0' })]
    const depthOf = (document: VectorDocument, object: VectorObject) => {
      const byId = new Map(document.objects.map((each) => [each.id, each]))
      let depth = 0
      for (let parent = object.parentId; parent !== null; parent = byId.get(parent)!.parentId) depth++
      return depth
    }
    for (const groups of [chain, [...chain].reverse(), loop, [...loop].reverse()]) {
      const started = performance.now()
      const document = repaired(doc([...groups, ...inside]))
      expect(performance.now() - started).toBeLessThan(1000)
      expect(document.objects.filter((object) => object.type === 'path').map((object) => object.id).sort()).toEqual(['deep', 'top'])
      expect(Math.max(...document.objects.map((object) => depthOf(document, object)))).toBeLessThanOrEqual(MAX_GROUP_DEPTH)
      // Read again, it stays as it is.
      expect(repaired(document)).toBe(document)
    }
  })

  it('breaks a loop of groups at its first group in the stack, and keeps what hangs below the loop in place', () => {
    const objects = [group('tail', { parentId: 'y' }), group('x', { parentId: 'y' }), group('y', { parentId: 'x' }), path('a', { parentId: 'tail' })]
    expect(ids(repaired(doc(objects)))).toEqual(['x', 'y<x', 'tail<y', 'a<tail'])
  })

  it("gathers a group's members right after its header, in the order they were in", () => {
    const document = repaired(
      doc([path('m1', { parentId: 'g' }), path('loose'), group('g'), path('m2', { parentId: 'g' }), group('inner', { parentId: 'g' }), path('i1', { parentId: 'inner' })]),
    )
    expect(ids(document)).toEqual(['loose', 'g', 'm1<g', 'm2<g', 'inner<g', 'i1<inner'])
  })

  it('keeps the first object with an id as that object, and gives a later one a fresh id', () => {
    const document = repaired(doc([group('g'), path('a', { parentId: 'g' }), group('g'), path('b', { parentId: 'g' }), path('m'), path('m')]))
    expect(ids(document).slice(0, 4)).toEqual(['g', 'a<g', 'b<g', 'm'])
    expect(document.objects).toHaveLength(5)
    expect(document.objects[4].id).not.toBe('m')
    expect(new Set(document.objects.map((object) => object.id)).size).toBe(5)
    // Read again, it stays as it is.
    expect(repaired(document)).toBe(document)
  })

  it("gives a group's members once when two headers share its id", () => {
    const objects = [group('g'), path('a', { parentId: 'g' }), group('g'), path('b', { parentId: 'g' })]
    expect(repairStructure(objects).map((object) => object.id)).toEqual(['g', 'a', 'b'])
  })

  it('removes an empty group, and a group that holds only empty groups', () => {
    const document = repaired(doc([group('empty'), group('outer'), group('hollow', { parentId: 'outer' }), path('a')]))
    expect(ids(document)).toEqual(['a'])
  })

  it('drops a guide of a shape it does not know, detaches a guide link to a missing object, and reads an unknown style as solid', () => {
    const guides = [
      { id: 'line', name: 'Line', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 60 } },
      { id: 'spiral', name: 'Spiral', visible: true, locked: false, style: 'solid', shape: { kind: 'spiral', turns: 3 } },
      {
        id: 'circle',
        name: 'Circle',
        visible: true,
        locked: false,
        style: 'wavy',
        shape: { kind: 'circle', c: { x: 0, y: 0 }, r: 40 },
        link: { kind: 'construction', of: 'gone', role: 'circumcircle' },
      },
      {
        id: 'axis',
        name: 'Axis',
        visible: true,
        locked: false,
        style: 'dashed',
        shape: { kind: 'line', p: { x: 50, y: 50 }, angle: 0 },
        link: { kind: 'construction', of: 'a', role: 'centre-y' },
      },
    ]
    const document = repaired(doc([path('a')], { guides: guides as Guide[] }))
    expect(document.guides.map((guide) => guide.id)).toEqual(['line', 'circle', 'axis'])
    expect(document.guides[1]).toEqual({ id: 'circle', name: 'Circle', visible: true, locked: false, style: 'solid', shape: guides[2].shape })
    expect(document.guides[2].link).toEqual({ kind: 'construction', of: 'a', role: 'centre-y' })
  })

  it('rebuilds a construction guide from its shape as it opens, and detaches one whose line the shape does not have', () => {
    const guides: Guide[] = [
      // Written by hand, out of step with the triangle it follows.
      { id: 'top', name: 'Top', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: -40 }, angle: 0 }, link: { kind: 'construction', of: 'a', role: 'top' } },
      // A free triangle has no spokes.
      { id: 'axis', name: 'Axis 3', visible: true, locked: false, style: 'dashed', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 30 }, link: { kind: 'construction', of: 'a', role: 'axis-2' } },
    ]
    const document = repaired(doc([path('a')], { guides }))
    expect(document.guides[0].shape).toEqual({ kind: 'line', p: { x: 50, y: 0 }, angle: 0 })
    expect(document.guides[0].link).toEqual({ kind: 'construction', of: 'a', role: 'top' })
    expect(document.guides[1]).toEqual({ id: 'axis', name: 'Axis 3', visible: true, locked: false, style: 'dashed', shape: guides[1].shape })
  })

  it('gives back the very same document when its construction guides already follow their shapes', () => {
    const guides: Guide[] = [
      { id: 'top', name: 'Top', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 50, y: 0 }, angle: 0 }, link: { kind: 'construction', of: 'a', role: 'top' } },
    ]
    const document = doc([path('a')], { guides })
    expect(repairVectorDocument(document)).toBe(document)
  })

  it('drops a guide or a fillet that is null, as JSON writes a gap in a list', () => {
    const guide: Guide = { id: 'line', name: 'Line', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 60 } }
    const document = repaired(doc([path('a')], { guides: [null, guide] as unknown as Guide[], fillets: [null] as unknown as Fillet[] }))
    expect(document.guides).toEqual([guide])
    expect(document.fillets).toEqual([])
  })

  it('removes a fillet between objects that are not there', () => {
    const fillets: Fillet[] = [
      { id: 'kept', visible: true, radius: 20, at: { x: 100, y: 0 }, between: ['a', 'b'] },
      { id: 'own', visible: true, radius: 5, at: { x: 0, y: 0 }, between: ['a', 'a'] },
      { id: 'gone', visible: true, radius: 20, at: { x: 0, y: 0 }, between: ['a', 'deleted'] },
    ]
    const document = repaired(doc([path('a'), path('b')], { fillets }))
    expect(document.fillets.map((fillet) => fillet.id)).toEqual(['kept', 'own'])
  })

  it('drops fields it does not know, on the document, its objects and their points', () => {
    const document = doc([path('a')])
    const raw = stored({
      ...document,
      selection: { targets: [{ type: 'object', objectId: 'a' }] },
      future: 1,
      objects: [
        {
          ...document.objects[0],
          appearance: { fill: 'red' },
          contours: [{ ...square, id: 'p', segments: square.segments.map((segment) => ({ ...segment, pointType: 'corner' })) }],
        },
      ],
    })
    expect(repaired(raw)).toEqual(document)
  })
})
