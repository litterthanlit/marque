import { beforeEach, describe, expect, it } from 'vitest'
import { useLogoStore } from '../../store/logoStore.ts'
import { composeVectorMarkCached } from './export.ts'
import type { GroupObject, PathObject, VectorDocument } from './types.ts'

function reset() {
  useLogoStore.setState(useLogoStore.getInitialState())
}

const document = () => useLogoStore.getState().vectorDocument

/** The document with its first object changed; every other object is kept. */
function withFirst(doc: VectorDocument, change: (object: PathObject) => PathObject): VectorDocument {
  const [first, ...rest] = doc.objects
  return { ...doc, objects: [change(first as PathObject), ...rest] }
}

describe('the cached mark', () => {
  beforeEach(() => {
    reset()
    useLogoStore.getState().addSlab('rounded')
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })
  })

  it('is the same mark after a rename or a lock, which change nothing it draws', () => {
    const mark = composeVectorMarkCached(document())
    const renamed = withFirst(document(), (object) => ({ ...object, name: 'Base', locked: true }))
    expect(renamed.objects).not.toBe(document().objects)
    expect(composeVectorMarkCached(renamed)).toBe(mark)
  })

  it('is the same mark after a selection change', () => {
    const mark = composeVectorMarkCached(document())
    useLogoStore.getState().setSelection([document().objects[1].id])
    expect(composeVectorMarkCached(document())).toBe(mark)
  })

  it('is composed again when a shape moves', () => {
    const mark = composeVectorMarkCached(document())
    const moved = withFirst(document(), (object) => ({
      ...object,
      contours: object.contours.map((contour) => ({
        ...contour,
        segments: contour.segments.map((segment) => ({ ...segment, point: { x: segment.point.x + 25, y: segment.point.y } })),
      })),
    }))
    const next = composeVectorMarkCached(moved)
    expect(next).not.toBe(mark)
    expect(next.viewBox.x).toBeCloseTo(mark.viewBox.x + 25, 1)
  })

  it('is the same mark when its layers go into a shared group, and composed again when the group isolates or hides', () => {
    const mark = composeVectorMarkCached(document())
    const [slab, punch] = document().objects as PathObject[]
    const group: GroupObject = { type: 'group', id: 'g', name: 'Group', parentId: null, visible: true, locked: false, isolated: false, operation: 'add' }
    const grouped = (header: GroupObject): VectorDocument => ({
      ...document(),
      objects: [header, { ...slab, parentId: 'g' }, { ...punch, parentId: 'g' }],
    })
    expect(composeVectorMarkCached(grouped(group))).toBe(mark)
    expect(composeVectorMarkCached(grouped({ ...group, isolated: true }))).not.toBe(mark)
    expect(composeVectorMarkCached(grouped({ ...group, visible: false })).compoundPathData).toBe('')
  })

  it('is composed again when a shape is hidden', () => {
    const mark = composeVectorMarkCached(document())
    const hidden = withFirst(document(), (object) => ({ ...object, visible: false }))
    expect(composeVectorMarkCached(hidden)).not.toBe(mark)
    expect(composeVectorMarkCached(hidden).compoundPathData).toBe('')
  })

  it('is the very same mark object again after undo', () => {
    const mark = composeVectorMarkCached(document())
    useLogoStore.getState().toggleIllustratorLayerVisibility(document().objects[1].id)
    const hidden = composeVectorMarkCached(document())
    expect(hidden).not.toBe(mark)

    useLogoStore.getState().undoVectorCommand()
    expect(composeVectorMarkCached(document())).toBe(mark)
    useLogoStore.getState().redoVectorCommand()
    expect(composeVectorMarkCached(document())).toBe(hidden)
  })
})
