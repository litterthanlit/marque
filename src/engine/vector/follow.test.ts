import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type SlabSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { changedIds, follow, type DocumentLists } from './follow.ts'
import { constructionShape } from './guides.ts'
import type { ConstructionRole, Guide, PathObject } from './types.ts'

function slab(id: string, spec: SlabSpec): PathObject {
  return {
    id,
    name: id,
    parentId: null,
    visible: true,
    locked: false,
    type: 'path',
    operation: 'add',
    contours: [segsToContour(carveOutline(spec).segs)],
    fillRule: 'evenodd',
    carve: spec,
  }
}

function linked(id: string, of: PathObject, role: ConstructionRole): Guide {
  return { id, name: id, visible: true, locked: false, style: 'dashed', shape: constructionShape(of, role)!, link: { kind: 'construction', of: of.id, role } }
}

const circle = slab('circle', slabSpec('circle'))
const square = slab('square', { ...slabSpec('square'), center: { x: 300, y: 0 } })

function lists(): DocumentLists {
  return {
    objects: [circle, square],
    guides: [
      linked('rim', circle, 'circumcircle'),
      linked('upright', circle, 'centre-x'),
      linked('across', circle, 'centre-y'),
      linked('top', circle, 'top'),
      linked('diagonal', square, 'axis-0'),
      { id: 'free', name: 'Line', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 30 } },
    ],
    fillets: [],
  }
}

describe('the follow pass', () => {
  it('rebuilds the construction guides of a circle slab that grows: its circle and centre lines follow it', () => {
    const before = lists()
    const grown = slab('circle', { ...slabSpec('circle'), center: { x: 20, y: 10 }, width: 500, height: 500, radius: 250 })
    const after = follow(before, { ...before, objects: [grown, square] })
    const byId = new Map(after.guides.map((guide) => [guide.id, guide]))
    expect(byId.get('rim')!.shape).toEqual({ kind: 'circle', c: { x: 20, y: 10 }, r: 250 })
    expect(byId.get('upright')!.shape).toEqual({ kind: 'line', p: { x: 20, y: 10 }, angle: 90 })
    expect(byId.get('across')!.shape).toEqual({ kind: 'line', p: { x: 20, y: 10 }, angle: 0 })
    expect(byId.get('top')!.shape).toEqual({ kind: 'line', p: { x: 20, y: -240 }, angle: 0 })
    expect(byId.get('rim')!.link).toEqual({ kind: 'construction', of: 'circle', role: 'circumcircle' })
    // What follows the square, and the free guide, are the very same guides.
    expect(byId.get('diagonal')).toBe(before.guides[4])
    expect(byId.get('free')).toBe(before.guides[5])
    expect(after.objects).toEqual([grown, square])
  })

  it('detaches the guides of a shape that is deleted, keeping where they are', () => {
    const before = lists()
    const after = follow(before, { ...before, objects: [square] })
    for (const id of ['rim', 'upright', 'across', 'top']) {
      const guide = after.guides.find((each) => each.id === id)!
      const was = before.guides.find((each) => each.id === id)!
      expect(guide.link).toBeUndefined()
      expect(guide.shape).toBe(was.shape)
    }
    expect(after.guides[4]).toBe(before.guides[4])
  })

  it('detaches a guide whose line the shape no longer has: a square slab rounded into a circle has no diagonal', () => {
    const before = lists()
    const round = slab('square', { ...slabSpec('square'), center: { x: 300, y: 0 }, radius: 190 })
    const after = follow(before, { ...before, objects: [circle, round] })
    expect(after.guides[4].link).toBeUndefined()
    expect(after.guides[4].shape).toBe(before.guides[4].shape)
  })

  it('hands back the very same lists when no object changed, or when what changed has no followers', () => {
    const before = lists()
    const same = { ...before }
    expect(follow(before, same)).toBe(same)
    const renamed = { ...before, objects: [circle, { ...square, name: 'renamed' }] }
    const after = follow(before, renamed)
    expect(after.guides).toBe(renamed.guides)
  })

  it('sets right a linked guide added in an edit that changes no object: read from its source as it is now, or detached when the source is gone', () => {
    const before = lists()
    const stale: Guide = { ...linked('stale', circle, 'centre-y'), shape: { kind: 'line', p: { x: 0, y: 80 }, angle: 0 } }
    const dangling: Guide = { ...linked('dangling', circle, 'top'), link: { kind: 'construction', of: 'gone', role: 'top' } }
    const after = follow(before, { ...before, guides: [...before.guides, stale, dangling] })
    expect(after.guides.slice(0, 6)).toEqual(before.guides)
    after.guides.slice(0, 6).forEach((guide, i) => expect(guide).toBe(before.guides[i]))
    // Rebuilt, and named for where its line now lies.
    expect(after.guides[6]).toEqual({ ...stale, name: 'Centre ↔', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 0 } })
    expect(after.guides[7].link).toBeUndefined()
    expect(after.guides[7].shape).toBe(dangling.shape)
  })

  it("keeps a turning slab's top guide on its top side as the turn goes past 45°, named for where it lies", () => {
    const strip = (rotation: number) => slab('strip', { ...slabSpec('square'), width: 120, height: 230, radius: 0, rotation })
    const at40 = strip(40)
    const before: DocumentLists = { objects: [at40], guides: [linked('top', at40, 'top')], fillets: [] }
    for (const [rotation, name] of [
      [44, 'Top'],
      [46, 'Right'],
      [50, 'Right'],
    ] as const) {
      const after = follow(before, { ...before, objects: [strip(rotation)] })
      expect(after.guides[0].name).toBe(name)
      const top = after.guides[0].shape
      if (top.kind !== 'line') throw new Error('no line')
      expect(top.angle).toBeCloseTo(rotation, 9)
      expect(Math.hypot(top.p.x, top.p.y)).toBeCloseTo(115, 6)
      expect(after.guides[0].link).toEqual({ kind: 'construction', of: 'strip', role: 'top' })
    }
  })

  it('counts an object as changed when it is new, replaced or gone', () => {
    const moved = { ...square }
    expect([...changedIds([circle, square], [moved])].sort()).toEqual(['circle', 'square'])
    expect([...changedIds([circle], [circle, square])]).toEqual(['square'])
  })
})
