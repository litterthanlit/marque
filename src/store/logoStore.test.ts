import paper from 'paper'
import { compressToEncodedURIComponent } from 'lz-string'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogoStore } from './logoStore.ts'
import type { PunchSpec, SlabSpec } from '../engine/carve/spec.ts'
import { composeIllustratorMark } from '../engine/illustrator/compose.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { rollSparks } from '../engine/sparks/sparks.ts'
import { composeVectorMark, composeVectorMarkCached } from '../engine/vector/export.ts'
import { readLegacyLayers } from '../engine/vector/migrate.ts'
import { constructionLines, guideRows } from '../engine/vector/guides.ts'
import type { PathObject, VectorObject } from '../engine/vector/types.ts'
import { decodeLink, encodeLink } from '../engine/vector/link.ts'
import { createSavedVariation, type SavedVariation } from '../engine/vector/saved.ts'

/** A document the test expects to read. */
function readable<T>(value: T | null): T {
  if (value === null) throw new Error('could not be read')
  return value
}

function reset(viewport = { width: 600, height: 600 }) {
  const initial = useLogoStore.getInitialState()
  useLogoStore.setState({ ...initial, ui: { ...initial.ui, viewport } })
}

const layers = () => useLogoStore.getState().illustrator?.layers ?? []
const objects = () => useLogoStore.getState().vectorDocument.objects
const undoDepth = () => useLogoStore.getState().vectorUndoStack.length

const areaScope = new paper.PaperScope()
areaScope.setup(new paper.Size(1, 1))

/** The area of the composed mark. */
function markArea(): number {
  const { compoundPathData } = composeIllustratorMark(useLogoStore.getState().illustrator)
  areaScope.activate()
  const item = areaScope.PathItem.create(compoundPathData)
  const area = Math.abs((item as unknown as { area: number }).area)
  item.remove()
  return area
}

describe('a fresh store', () => {
  beforeEach(() => reset())

  it('opens in Vector Maker on an empty document, outside the browser too', () => {
    const state = useLogoStore.getInitialState()
    expect(state.vectorDocument?.objects).toEqual([])
    expect(state.illustrator?.layers).toEqual([])
    expect(state.vectorUndoStack).toHaveLength(0)
    expect(state.ui.theme).toBe('dark')
  })

  it('takes a pen shape, and undo empties it again', () => {
    useLogoStore.getState().addPenShape('M0,0L100,0L100,100Z')
    expect(layers().map((layer) => layer.operation)).toEqual(['add'])
    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toEqual([])
  })

  it('takes a punch, and undo empties it again', () => {
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 40 })
    expect(layers().map((layer) => layer.carve?.kind)).toEqual(['punch'])
    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toEqual([])
  })
})

describe('recipes in the store', () => {
  beforeEach(() => reset())

  it('slabs, cuts and duplicates carry recipes, never transforms', () => {
    useLogoStore.getState().addSlab('rounded')
    expect(layers()).toHaveLength(1)
    expect(layers()[0].carve?.kind).toBe('slab')

    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })
    const punch = layers()[1]
    expect(punch.operation).toBe('subtract')
    expect(punch.carve).toMatchObject({ kind: 'punch', center: { x: 20, y: 30 }, radius: 40 })

    useLogoStore.getState().duplicateIllustratorLayer(punch.id)
    const copy = layers()[2]
    expect(copy.transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
    expect(copy.carve).toMatchObject({ kind: 'punch', center: { x: 32, y: 42 } })
  })
})

describe('history', () => {
  beforeEach(() => reset())

  it('selection never enters the undo history, and redo survives it', () => {
    const store = useLogoStore.getState()
    store.addSlab('square')
    store.addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30 })
    expect(undoDepth()).toBe(2)

    const [slab, punch] = layers()
    useLogoStore.getState().selectIllustratorLayer(slab.id)
    useLogoStore.getState().setSelection([punch.id])
    useLogoStore.getState().setSelection([])
    expect(undoDepth()).toBe(2)

    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toHaveLength(1)
    useLogoStore.getState().setSelection([slab.id])
    expect(useLogoStore.getState().vectorRedoStack).toHaveLength(1)
    useLogoStore.getState().redoVectorCommand()
    expect(layers()).toHaveLength(2)
  })

  it('one commit is one step; a commit that changes nothing is none', () => {
    useLogoStore.getState().addSlab('rounded')
    const slab = layers()[0]
    const wider: SlabSpec = { ...(slab.carve as SlabSpec), width: 440 }
    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: slab.id, carve: wider }] })
    expect(undoDepth()).toBe(2)
    expect((layers()[0].carve as SlabSpec).width).toBe(440)

    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: slab.id, carve: wider }] })
    expect(undoDepth()).toBe(2)

    useLogoStore.getState().undoVectorCommand()
    expect((layers()[0].carve as SlabSpec).width).toBe(380)
  })

  describe('key edits in a row', () => {
    let now = 0
    beforeEach(() => {
      now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
    })
    afterEach(() => vi.restoreAllMocks())

    const nudge = (id: string, x: number, merge: 'nudge' | 'key-turn' = 'nudge') => {
      const spec = layers().find((layer) => layer.id === id)!.carve as SlabSpec
      useLogoStore.getState().commitLayerEdits({
        label: 'Move',
        edits: [{ layerId: id, carve: { ...spec, center: { x: spec.center.x + x, y: spec.center.y } } }],
        select: [id],
        merge,
      })
    }
    const centreX = (id: string) => (layers().find((layer) => layer.id === id)!.carve as SlabSpec).center.x

    it('join into one undo step that restores the objects array from before them', () => {
      useLogoStore.getState().addSlab('square')
      const [slab] = layers()
      const before = objects()
      const depth = undoDepth()
      for (let i = 0; i < 3; i++) {
        now += 400
        nudge(slab.id, 1)
      }
      expect(undoDepth()).toBe(depth + 1)
      expect(centreX(slab.id)).toBe((slab.carve as SlabSpec).center.x + 3)
      expect(useLogoStore.getState().vectorUndoStack.at(-1)!.label).toBe('Move')

      useLogoStore.getState().undoVectorCommand()
      expect(objects()).toBe(before)
      useLogoStore.getState().redoVectorCommand()
      expect(centreX(slab.id)).toBe((slab.carve as SlabSpec).center.x + 3)
    })

    it('start a new step a second after the last one', () => {
      useLogoStore.getState().addSlab('square')
      const [slab] = layers()
      const depth = undoDepth()
      nudge(slab.id, 1)
      now += 999
      nudge(slab.id, 1)
      expect(undoDepth()).toBe(depth + 1)
      now += 1000
      nudge(slab.id, 1)
      expect(undoDepth()).toBe(depth + 2)
      useLogoStore.getState().undoVectorCommand()
      expect(centreX(slab.id)).toBe((slab.carve as SlabSpec).center.x + 2)
    })

    it('start a new step for another selection or another kind of key', () => {
      useLogoStore.getState().addSlab('square')
      useLogoStore.getState().addSlab('circle')
      const [square, circle] = layers()
      const depth = undoDepth()
      nudge(square.id, 1)
      nudge(circle.id, 1)
      expect(undoDepth()).toBe(depth + 2)
      nudge(circle.id, 1, 'key-turn')
      expect(undoDepth()).toBe(depth + 3)
      nudge(circle.id, 1, 'key-turn')
      expect(undoDepth()).toBe(depth + 3)
    })

    it('start a new step after any other edit, or after an undo', () => {
      useLogoStore.getState().addSlab('square')
      const [slab] = layers()
      const depth = undoDepth()
      nudge(slab.id, 1)
      useLogoStore.getState().updateIllustratorLayer(slab.id, { name: 'Base' })
      nudge(slab.id, 1)
      expect(undoDepth()).toBe(depth + 3)

      useLogoStore.getState().undoVectorCommand()
      nudge(slab.id, 5)
      expect(undoDepth()).toBe(depth + 3)
      useLogoStore.getState().undoVectorCommand()
      expect(centreX(slab.id)).toBe((slab.carve as SlabSpec).center.x + 1)
      expect(layers()[0].name).toBe('Base')
    })

    it('start a new step after a redo, so one undo takes back only the new key', () => {
      useLogoStore.getState().addSlab('square')
      const [slab] = layers()
      const depth = undoDepth()
      nudge(slab.id, 1)
      useLogoStore.getState().undoVectorCommand()
      useLogoStore.getState().redoVectorCommand()
      nudge(slab.id, 1)
      expect(undoDepth()).toBe(depth + 2)
      useLogoStore.getState().undoVectorCommand()
      expect(centreX(slab.id)).toBe((slab.carve as SlabSpec).center.x + 1)
    })
  })

  it('Start over clears the mark and undo brings it back', () => {
    useLogoStore.getState().addSlab('circle')
    useLogoStore.getState().startOver()
    expect(layers()).toHaveLength(0)
    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toHaveLength(1)
  })
})

describe('edits write the document directly', () => {
  beforeEach(() => {
    reset()
    const store = useLogoStore.getState()
    store.addSlab('square')
    store.addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 40 })
    store.addPenShape('M-150,-150L-60,-150L-60,-60Z')
  })

  it('moving one of three layers leaves the other two objects as they were, by reference', () => {
    const [slab, punch, shape] = objects()
    useLogoStore.getState().moveIllustratorLayer(slab.id, 'up')
    expect(objects()).toHaveLength(3)
    expect(objects()[0]).toBe(punch)
    expect(objects()[1]).toBe(slab)
    expect(objects()[2]).toBe(shape)
  })

  it('an edit to one object keeps every other object, and its layer view', () => {
    const [slab, punch, shape] = objects()
    const [, punchLayer, shapeLayer] = layers()
    useLogoStore.getState().toggleIllustratorLayerVisibility(slab.id)
    expect(objects()[0]).not.toBe(slab)
    expect(objects()[1]).toBe(punch)
    expect(objects()[2]).toBe(shape)
    expect(layers()[1]).toBe(punchLayer)
    expect(layers()[2]).toBe(shapeLayer)
  })

  it('a commit that changes nothing is no undo step and keeps the objects array', () => {
    const before = objects()
    const depth = undoDepth()
    const [slab, punch, shape] = layers()
    const store = useLogoStore.getState()
    store.commitLayerEdits({ label: 'Resize', edits: [{ layerId: slab.id, carve: slab.carve! }] })
    store.commitLayerEdits({ label: 'Bend', edits: [{ layerId: shape.id, pathData: shape.pathData }] })
    store.setIllustratorLayerOperation(punch.id, 'subtract')
    store.commitLayerEdits({ label: 'Rotate', edits: [{ layerId: shape.id, frameRotation: 0 }] })
    store.moveIllustratorLayer(shape.id, 'up')
    expect(objects()).toBe(before)
    expect(undoDepth()).toBe(depth)
  })

  it('undo puts back the very same objects array, and redo the one after it', () => {
    const before = objects()
    const selection = useLogoStore.getState().selection
    useLogoStore.getState().commitLayerEdits({
      label: 'Resize',
      edits: [{ layerId: before[0].id, carve: { ...(layers()[0].carve as SlabSpec), width: 300 } }],
    })
    const after = objects()
    expect(after).not.toBe(before)

    useLogoStore.getState().undoVectorCommand()
    expect(objects()).toBe(before)
    expect(useLogoStore.getState().selection).toEqual(selection)
    useLogoStore.getState().redoVectorCommand()
    expect(objects()).toBe(after)
  })

  it('a selection change keeps the objects array and the layers, and is no undo step', () => {
    const before = objects()
    const layerView = layers()
    const depth = undoDepth()
    useLogoStore.getState().setSelection([before[0].id, before[1].id])
    useLogoStore.getState().selectIllustratorLayer(before[2].id)
    expect(objects()).toBe(before)
    expect(layers()).toBe(layerView)
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([before[2].id])
    expect(undoDepth()).toBe(depth)
  })

  it('freezes every object it writes in development, so an edit in place throws', () => {
    const [slab] = objects()
    expect(import.meta.env.DEV).toBe(true)
    expect(() => {
      ;(slab as { name: string }).name = 'Changed'
    }).toThrow(TypeError)
    expect(() => {
      if (slab.type === 'path') slab.contours[0].segments[0].point.x = 999
    }).toThrow(TypeError)
    expect(slab.name).toBe('Slab')
  })

  it('a recipe edit rewrites the path from the recipe; a path edit drops the recipe', () => {
    const [slab] = layers()
    useLogoStore.getState().commitLayerEdits({
      label: 'Resize',
      edits: [{ layerId: slab.id, carve: { ...(slab.carve as SlabSpec), width: 300 } }],
    })
    expect(layers()[0].pathData).toContain('150')
    expect(layers()[0].carve).toMatchObject({ kind: 'slab', width: 300 })

    useLogoStore.getState().commitLayerEdits({ label: 'Bend', edits: [{ layerId: slab.id, pathData: 'M0,0L100,0L100,100Z' }] })
    expect(layers()[0].carve).toBeUndefined()
    expect(layers()[0].pathData).toBe('M0,0h100v100z')
    expect(layers()[0].transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
  })

  it('leaves no paper items behind in the scope that was active', () => {
    const canvas = new paper.PaperScope()
    canvas.setup(new paper.Size(1, 1))
    canvas.activate()
    useLogoStore.getState().toggleIllustratorLayerVisibility(layers()[0].id)
    useLogoStore.getState().commitLayerEdits({ label: 'Bend', edits: [{ layerId: layers()[2].id, pathData: 'M0,0L100,0L100,100Z' }] })
    expect(canvas.project.activeLayer.children).toHaveLength(0)
  })
})

describe("a free shape's frame", () => {
  beforeEach(() => reset())

  const frameOf = (id: string) => {
    const object = objects().find((candidate) => candidate.id === id)
    return object?.type === 'path' ? object.frame : undefined
  }

  it('keeps the turn a gesture gives it, through moves and point edits, until it turns back upright', () => {
    useLogoStore.getState().addPenShape('M0,0L100,0L100,60L0,60Z')
    const [shape] = layers()
    expect(frameOf(shape.id)).toBeUndefined()
    const depth = undoDepth()

    useLogoStore.getState().commitLayerEdits({
      label: 'Rotate',
      edits: [{ layerId: shape.id, pathData: 'M10,-20L96,30L66,82L-20,32Z', frameRotation: 390 }],
    })
    expect(frameOf(shape.id)).toEqual({ rotation: 30 })
    expect(layers()[0].frameRotation).toBe(30)
    expect(layers()[0].transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
    expect(undoDepth()).toBe(depth + 1)

    // A move or a point edit says nothing about the frame: it stays.
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: shape.id, pathData: 'M20,-20L106,30L76,82L-10,32Z' }] })
    expect(frameOf(shape.id)).toEqual({ rotation: 30 })

    // The same turn again is no step at all.
    const before = objects()
    useLogoStore.getState().commitLayerEdits({ label: 'Rotate', edits: [{ layerId: shape.id, frameRotation: 30 }] })
    expect(objects()).toBe(before)

    useLogoStore.getState().commitLayerEdits({ label: 'Rotate', edits: [{ layerId: shape.id, frameRotation: -360 }] })
    expect(frameOf(shape.id)).toBeUndefined()
    expect(layers()[0].frameRotation).toBeUndefined()

    useLogoStore.getState().undoVectorCommand()
    expect(frameOf(shape.id)).toEqual({ rotation: 30 })
  })

  it('goes with a copy, and never stays on a recipe', () => {
    useLogoStore.getState().addPenShape('M0,0L100,0L100,60Z')
    useLogoStore.getState().addSlab('square')
    const [shape, slab] = layers()
    useLogoStore.getState().commitLayerEdits({
      label: 'Rotate',
      edits: [
        { layerId: shape.id, pathData: 'M0,0L90,10L80,70Z', frameRotation: 15 },
        { layerId: slab.id, frameRotation: 15 },
      ],
    })
    expect(frameOf(shape.id)).toEqual({ rotation: 15 })
    expect(frameOf(slab.id)).toBeUndefined()

    useLogoStore.getState().duplicateIllustratorLayer(shape.id)
    expect(layers()[1].frameRotation).toBe(15)
    expect(frameOf(layers()[1].id)).toEqual({ rotation: 15 })
  })

  it('survives a link, and a frame that is not a finite turn is dropped when a document is opened', () => {
    useLogoStore.getState().addPenShape('M0,0L100,0L100,60Z')
    const [shape] = layers()
    useLogoStore.getState().commitLayerEdits({ label: 'Rotate', edits: [{ layerId: shape.id, pathData: 'M0,0L90,10L80,70Z', frameRotation: 45 }] })
    const document = useLogoStore.getState().vectorDocument
    const link = encodeLink(document, '#111111')
    const decoded = decodeLink(link)
    expect(decoded.kind).toBe('vector')
    if (decoded.kind !== 'vector') return
    useLogoStore.getState().setVectorDocument(decoded.document)
    expect(frameOf(shape.id)).toEqual({ rotation: 45 })

    const broken = {
      ...document,
      objects: document.objects.map((object) => ({ ...object, frame: { rotation: Number.NaN } })),
    }
    useLogoStore.getState().setVectorDocument(broken)
    expect(frameOf(shape.id)).toBeUndefined()
  })
})

describe('a document whose ids repeat', () => {
  beforeEach(() => reset())

  it('opens with every id once, and an edit adds one object, not copies of a group', () => {
    useLogoStore.getState().addPenShape('M0,0L100,0L100,100Z')
    const [shape] = objects()
    const document = useLogoStore.getState().vectorDocument
    const group = { id: 'g', name: 'Group', parentId: null, visible: true, locked: false, type: 'group', isolated: false, operation: 'add' }
    const member = (id: string) => ({ ...shape, id, parentId: 'g' })
    const raw = JSON.parse(JSON.stringify({ ...document, objects: [group, member('a'), group, member('b'), shape, shape] }))
    const decoded = decodeLink(`#vd=${compressToEncodedURIComponent(JSON.stringify(raw))}`)
    if (decoded.kind !== 'vector') throw new Error(decoded.kind)
    useLogoStore.getState().setVectorDocument(decoded.document)
    expect(objects()).toHaveLength(5)
    expect(new Set(objects().map((object) => object.id)).size).toBe(5)
    for (let i = 1; i <= 3; i++) {
      useLogoStore.getState().addPenShape('M200,0L300,0L300,100Z')
      expect(objects()).toHaveLength(5 + i)
    }
  })
})

describe('the other layer actions', () => {
  beforeEach(() => reset())

  it('turn a transform into a recipe or into the points of a free shape, and keep none', () => {
    const store = useLogoStore.getState()
    store.addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })
    store.addPenShape('M0,0L100,0L100,100Z')
    const [punch, shape] = layers()

    useLogoStore.getState().updateIllustratorLayer(punch.id, { transform: { dx: 10, dy: -5, scale: 1, rotation: 0 } })
    expect(layers()[0].transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
    expect(layers()[0].carve).toMatchObject({ kind: 'punch', center: { x: 30, y: 25 }, radius: 40 })

    // A copy is offset by moving its points: no object holds a transform.
    useLogoStore.getState().duplicateIllustratorLayer(shape.id)
    const copy = layers()[2]
    expect(copy.name).toBe('Shape 2 copy')
    expect(shape.pathData).toBe('M0,0h100v100z')
    expect(copy.pathData).toBe('M12,12h100v100z')
    expect(copy.transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([copy.id])

    useLogoStore.getState().updateIllustratorLayer(copy.id, { transform: { dx: -12, dy: -12, scale: 1, rotation: 0 } })
    expect(layers()[2].transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
    expect(layers()[2].pathData).toBe(shape.pathData)
    expect(undoDepth()).toBe(5)
  })

  it('rename, hide and switch to a cut without touching the path', () => {
    useLogoStore.getState().addSlab('square')
    const [slab] = objects()
    useLogoStore.getState().updateIllustratorLayer(slab.id, { name: 'Base' })
    useLogoStore.getState().toggleIllustratorLayerVisibility(slab.id)
    useLogoStore.getState().setIllustratorLayerOperation(slab.id, 'subtract')
    const [now] = objects()
    expect(now).toMatchObject({ name: 'Base', visible: false, operation: 'subtract' })
    expect(now.type === 'path' && slab.type === 'path' && now.contours).toBe(slab.type === 'path' && slab.contours)
    expect(undoDepth()).toBe(4)
  })

  it('combine the selection in the order it was picked, where the lowest of them sat, as the first one', () => {
    const store = useLogoStore.getState()
    store.addPenShape('M500,500L510,500L510,510Z')
    store.addCarveCut({ kind: 'punch', shape: 'square', center: { x: 50, y: 0 }, radius: 50 })
    store.addSlab('square')
    store.addPenShape('M600,600L610,600L610,610Z')
    const [bottom, punch, slab, top] = layers()

    useLogoStore.getState().setSelection([slab.id, punch.id])
    useLogoStore.getState().booleanIllustratorLayers('subtract')

    const after = layers()
    expect(after.map((layer) => layer.id)).toEqual([bottom.id, after[1].id, top.id])
    expect(after[1]).toMatchObject({ name: 'subtract result', operation: 'add' })
    expect(after[1].carve).toBeUndefined()
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([after[1].id])
  })

  it('combine into one layer that keeps its hole, and select it', () => {
    const store = useLogoStore.getState()
    store.addPenShape('M0,0L200,0L200,200L0,200Z')
    store.addPenShape('M50,50L150,50L150,150L50,150Z')
    const [outer, inner] = layers()
    useLogoStore.getState().setSelection([outer.id, inner.id])
    useLogoStore.getState().booleanIllustratorLayers('subtract')
    const [ring] = layers()
    expect(layers()).toHaveLength(1)
    expect(ring).toMatchObject({ name: 'subtract result', contourCount: 2 })
    const [object] = objects()
    expect(object.type === 'path' && object.contours).toHaveLength(2)
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([ring.id])
    // The hole stays empty: 200² less 100².
    expect(markArea()).toBeCloseTo(30000, 0)
  })

  it('make a point sharp or smooth, or delete it, as one step each', () => {
    useLogoStore.getState().addPenShape('M0,0L100,0L100,100L0,100Z')
    const [shape] = layers()
    useLogoStore.getState().editAnchor(shape.id, 1, 'toggle-smooth')
    expect(layers()[0].pathData).toContain('c')
    expect(useLogoStore.getState().illustrator.pointSelection).toMatchObject({ layerId: shape.id, segmentIndex: 1 })
    useLogoStore.getState().editAnchor(shape.id, 1, 'delete')
    expect(useLogoStore.getState().illustrator.pointSelection).toBeNull()
    expect(undoDepth()).toBe(3)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().undoVectorCommand()
    expect(layers()[0]).toBe(shape)
  })

  it('Start over gives an empty document, and undo brings the earlier one back whole', () => {
    useLogoStore.getState().addSlab('square')
    const before = useLogoStore.getState().vectorDocument
    useLogoStore.getState().startOver()
    expect(useLogoStore.getState().vectorDocument).toMatchObject({ name: 'Slab', objects: [] })
    expect(useLogoStore.getState().selection).toEqual({ targets: [] })
    useLogoStore.getState().undoVectorCommand()
    const restored = useLogoStore.getState().vectorDocument
    expect(restored.objects).toBe(before.objects)
    expect(restored).toMatchObject({ id: before.id, name: before.name, artboards: before.artboards })
  })
})

describe('a shape with a hole', () => {
  beforeEach(() => {
    reset()
    const store = useLogoStore.getState()
    store.addPenShape('M0,0L200,0L200,200L0,200Z')
    store.addPenShape('M50,50L150,50L150,150L50,150Z')
    const [outer, inner] = layers()
    useLogoStore.getState().setSelection([outer.id, inner.id])
    useLogoStore.getState().booleanIllustratorLayers('subtract')
  })

  const ring = () => objects()[0] as Extract<ReturnType<typeof objects>[number], { type: 'path' }>
  const hole = () => ring().contours[1]

  it('edits a point of its inner contour, and leaves the outer contour as it was', () => {
    const before = ring()
    const depth = undoDepth()
    const corner = hole().segments[0].point
    useLogoStore.getState().editAnchor(before.id, 0, 'toggle-smooth', 1)
    expect(ring().contours[0]).toBe(before.contours[0])
    expect(hole().segments[0].handleOut).not.toBeNull()
    expect(hole().segments[0].point).toEqual(corner)
    expect(useLogoStore.getState().illustrator.pointSelection).toMatchObject({ layerId: before.id, contourIndex: 1, segmentIndex: 0 })

    useLogoStore.getState().editAnchor(before.id, 0, 'delete', 1)
    expect(hole().segments).toHaveLength(3)
    expect(ring().contours[0]).toBe(before.contours[0])
    expect(undoDepth()).toBe(depth + 2)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().undoVectorCommand()
    expect(ring()).toBe(before)
  })

  it('moves one point of its inner contour with a commit that names the contour', () => {
    const before = ring()
    const moved = hole().segments.map((segment, index) => (index === 1 ? { x: segment.point.x + 20, y: segment.point.y - 10 } : segment.point))
    const pathData = `M${moved.map((p) => `${p.x},${p.y}`).join('L')}Z`
    useLogoStore.getState().commitLayerEdits({
      label: 'Move point',
      edits: [{ layerId: before.id, contourIndex: 1, pathData }],
      select: [before.id],
      anchor: { layerId: before.id, contourIndex: 1, segmentIndex: 1 },
    })
    expect(ring().contours[0]).toBe(before.contours[0])
    expect(hole().segments.map((segment) => segment.point)).toEqual(moved)
    expect(ring().contours).toHaveLength(2)
    expect(useLogoStore.getState().illustrator.pointSelection).toMatchObject({ contourIndex: 1, segmentIndex: 1 })
  })
})

describe('a shape with an empty contour from outside', () => {
  beforeEach(() => reset())

  it('opens without it, so a point edit on the hole writes the hole and not the outline', () => {
    const corner = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
    const rect = (h: number) => ({ closed: true, segments: [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)] })
    const document = useLogoStore.getState().vectorDocument
    useLogoStore.getState().setVectorDocument({
      ...document,
      objects: [
        { id: 'ring', name: 'Ring', parentId: null, visible: true, locked: false, type: 'path', operation: 'add', fillRule: 'evenodd', contours: [{ closed: true, segments: [] }, rect(200), rect(100)] },
      ],
    })
    // The hole is the second contour the editor counts.
    useLogoStore.getState().editAnchor('ring', 2, 'toggle-smooth', 1)
    const ring = objects()[0] as Extract<ReturnType<typeof objects>[number], { type: 'path' }>
    expect(ring.contours).toHaveLength(2)
    expect(ring.contours[0]).toEqual(rect(200))
    expect(ring.contours[1].segments[2].handleOut).not.toBeNull()
  })
})

describe('layer order', () => {
  beforeEach(() => reset())

  const order = () => layers().map((layer) => layer.id)

  it('up is towards the top of the stack, where later layers sit, and down is back', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 40 })
    const [slab, punch] = order()

    useLogoStore.getState().moveIllustratorLayer(slab, 'up')
    expect(order()).toEqual([punch, slab])

    useLogoStore.getState().moveIllustratorLayer(slab, 'down')
    expect(order()).toEqual([slab, punch])
  })

  it('the top layer has nowhere further up to go, and trying is not an undo step', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addSlab('circle')
    const [bottom, top] = order()
    const depth = undoDepth()

    useLogoStore.getState().moveIllustratorLayer(top, 'up')
    useLogoStore.getState().moveIllustratorLayer(bottom, 'down')

    expect(order()).toEqual([bottom, top])
    expect(undoDepth()).toBe(depth)
  })
})

describe('layer order with groups', () => {
  beforeEach(() => reset())

  const corner = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
  const square = (h: number) => ({ closed: true, segments: [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)] })
  const path = (id: string, h: number, extra: Partial<VectorObject> = {}): VectorObject => ({
    id, name: id, parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours: [square(h)], fillRule: 'evenodd', ...extra,
  } as VectorObject)
  const group = (id: string, extra: Partial<VectorObject> = {}): VectorObject => ({
    id, name: id, parentId: null, visible: true, locked: false, type: 'group', isolated: true, operation: 'add', ...extra,
  } as VectorObject)
  const open = (objects: VectorObject[]) =>
    useLogoStore.getState().setVectorDocument({ ...useLogoStore.getState().vectorDocument, objects })
  const order = () => objects().map((object) => object.id)
  /** The document as a link reopens it. */
  const reopened = () => {
    const link = decodeLink(encodeLink(useLogoStore.getState().vectorDocument, '#111111'))
    if (link.kind !== 'vector') throw new Error(`decoded as ${link.kind}`)
    return link.document
  }

  it('steps an object over a whole group, and the link reopens what the editor draws', () => {
    open([group('iso'), path('a', 120, { parentId: 'iso' }), path('x', 50, { operation: 'subtract' })])
    useLogoStore.getState().moveIllustratorLayer('x', 'down')
    expect(order()).toEqual(['x', 'iso', 'a'])
    const document = reopened()
    expect(document.objects.map((object) => object.id)).toEqual(order())
    expect(composeVectorMark(document).compoundPathData).toBe(composeVectorMark(useLogoStore.getState().vectorDocument).compoundPathData)

    useLogoStore.getState().moveIllustratorLayer('x', 'up')
    expect(order()).toEqual(['iso', 'a', 'x'])
  })

  it('keeps a member in its group: at the edge of the run it stays, and it is no undo step', () => {
    open([path('r', 200), group('g'), path('a', 120, { parentId: 'g' }), path('b', 60, { parentId: 'g' })])
    const depth = undoDepth()
    useLogoStore.getState().moveIllustratorLayer('a', 'down')
    useLogoStore.getState().moveIllustratorLayer('b', 'up')
    expect(order()).toEqual(['r', 'g', 'a', 'b'])
    expect(undoDepth()).toBe(depth)
    useLogoStore.getState().moveIllustratorLayer('a', 'up')
    expect(order()).toEqual(['r', 'g', 'b', 'a'])
  })

  it('gives a boolean result the group its inputs share, and gathers one made across groups after the group', () => {
    open([group('g'), path('a', 120, { parentId: 'g' }), path('b', 60, { parentId: 'g' }), path('c', 30, { parentId: 'g' }), path('x', 200)])
    useLogoStore.getState().setSelection(['a', 'b'])
    useLogoStore.getState().booleanIllustratorLayers('unite')
    const [, made] = objects()
    expect(made.parentId).toBe('g')
    expect(order()).toEqual(['g', made.id, 'c', 'x'])

    // Made where the member was, but at the root: it goes after the group's run, not inside it.
    useLogoStore.getState().setSelection([made.id, 'x'])
    useLogoStore.getState().booleanIllustratorLayers('unite')
    const across = objects().at(-1)!
    expect(across.parentId).toBeNull()
    expect(order()).toEqual(['g', 'c', across.id])
    expect(reopened().objects.map((object) => object.id)).toEqual(order())
  })
})

describe('adding slabs', () => {
  it('goes on top, selected, beside the existing ink when there is room', () => {
    reset({ width: 1400, height: 1000 })
    useLogoStore.getState().addSlab('rounded')
    useLogoStore.getState().addSlab('square')
    const all = layers()
    expect(all).toHaveLength(2)
    const added = all[1]
    expect(useLogoStore.getState().illustrator?.selectedLayerIds).toEqual([added.id])
    const spec = added.carve as SlabSpec
    expect(spec.width).toBe(190)
    // To the right of the first slab (which spans ±190), with a gap.
    expect(spec.center.x - spec.width / 2).toBeGreaterThanOrEqual(190 + 24 - 1e-6)
  })

  it('tucks into a corner when nothing fits', () => {
    reset({ width: 478, height: 478 })
    useLogoStore.getState().addSlab('rounded')
    useLogoStore.getState().addSlab('square')
    const spec = layers()[1].carve as SlabSpec
    expect(spec.center.x).toBeGreaterThan(0)
    expect(spec.center.y).toBeGreaterThan(0)
  })
})

describe('a slab on a converted mark', () => {
  it('goes on top and keeps the mark; undo takes only the slab away', () => {
    reset()
    const generated = readable(readLegacyLayers({
      id: 'gen',
      source: { seed: 42, modeId: 'geometric-radial', generatorId: 'geometric-radial', generatorVersion: 'v1' },
      layers: [
        {
          id: 'g1',
          name: 'Generated Polygon 01',
          operation: 'add',
          visible: true,
          locked: false,
          pathData: 'M-50,-50L50,-50L50,50L-50,50Z',
          fillRule: 'evenodd',
          transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
        },
      ],
      selectedLayerIds: [],
      pointSelection: null,
      mode: 'object',
    }))
    useLogoStore.getState().setVectorDocument(generated)
    useLogoStore.getState().addSlab('rounded')
    expect(layers().map((layer) => layer.carve?.kind ?? layer.name)).toEqual(['Generated Polygon 01', 'slab'])
    useLogoStore.getState().undoVectorCommand()
    expect(layers().map((layer) => layer.name)).toEqual(['Generated Polygon 01'])
  })
})

describe('saved marks', () => {
  beforeEach(() => reset())

  const recipes = () => layers().map(({ id, name, operation, pathData, carve }) => ({ id, name, operation, pathData, carve }))
  // As localStorage hands it back.
  const saveCurrent = (): SavedVariation => {
    const { vectorDocument, params } = useLogoStore.getState()
    return JSON.parse(JSON.stringify(createSavedVariation(vectorDocument!, params)))
  }

  it('come back with their layers and ink after Start over, as one undo step', () => {
    useLogoStore.getState().setParam('fillColor', '#ff3300')
    useLogoStore.getState().addSlab('rounded')
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })
    const drawn = recipes()
    const entry = saveCurrent()

    useLogoStore.getState().startOver()
    useLogoStore.getState().setParam('fillColor', '#0000ff')
    const depth = undoDepth()
    useLogoStore.getState().openSaved(entry)

    expect(recipes()).toEqual(drawn)
    expect(drawn.map((layer) => layer.carve?.kind)).toEqual(['slab', 'punch'])
    expect(useLogoStore.getState().params.fillColor).toBe('#ff3300')
    expect(undoDepth()).toBe(depth + 1)

    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toEqual([])
    useLogoStore.getState().redoVectorCommand()
    expect(recipes()).toEqual(drawn)
  })

  it('open as layers in Vector Maker when they were saved on the Generate screen', () => {
    useLogoStore.getState().addSlab('square')
    const { params } = useLogoStore.getState()
    useLogoStore.getState().openSaved({
      id: 'old',
      name: 'geometric-radial #42',
      savedAt: '2026-09-01T10:00:00.000Z',
      params,
      activeSurface: 'generated',
      vectorDocument: null,
      illustrator: null,
    } as SavedVariation)

    const state = useLogoStore.getState()
    expect(state.vectorDocument?.objects.length).toBeGreaterThan(1)
    expect(layers().some((layer) => layer.carve)).toBe(false)
    expect(state.error).toBeNull()
  })

  it('leave the open document alone and say so when they cannot be read', () => {
    useLogoStore.getState().addSlab('square')
    const open = useLogoStore.getState().vectorDocument
    const depth = undoDepth()
    useLogoStore.getState().openSaved({ ...saveCurrent(), vectorDocument: { kind: 'something-else' } } as never)

    const state = useLogoStore.getState()
    expect(state.vectorDocument).toBe(open)
    expect(undoDepth()).toBe(depth)
    expect(state.error).toEqual(expect.any(String))
  })
})

describe('the pen', () => {
  beforeEach(() => reset())

  it('adds a closed, filled shape on top as one step, selects it and puts the pen down', () => {
    const store = useLogoStore.getState()
    store.addSlab('square')
    store.setActiveTool('pen')
    const before = undoDepth()
    useLogoStore.getState().addPenShape('M0,0L100,0L100,100Z')
    const added = layers().at(-1)!
    expect(added.operation).toBe('add')
    expect(added.name).toBe('Shape 2')
    expect(added.carve).toBeUndefined()
    expect(useLogoStore.getState().illustrator?.selectedLayerIds).toEqual([added.id])
    expect(useLogoStore.getState().ui.activeTool).toBeNull()
    expect(undoDepth()).toBe(before + 1)
  })
})

describe('the look', () => {
  beforeEach(() => reset())

  it('opens on the construction look, and the switch goes to the final look and back', () => {
    expect(useLogoStore.getInitialState().ui.look).toBe('construction')
    useLogoStore.getState().toggleLook()
    expect(useLogoStore.getState().ui.look).toBe('final')
    useLogoStore.getState().toggleLook()
    expect(useLogoStore.getState().ui.look).toBe('construction')
  })

  it('is a view setting: no undo step, the same document, the same link', () => {
    const store = useLogoStore.getState()
    store.addSlab('square')
    store.addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30 })
    store.undoVectorCommand()
    const before = useLogoStore.getState()
    const link = encodeLink(before.vectorDocument!, before.params.fillColor)

    useLogoStore.getState().toggleLook()

    const after = useLogoStore.getState()
    expect(after.ui.look).toBe('final')
    expect(after.vectorUndoStack).toBe(before.vectorUndoStack)
    expect(after.vectorRedoStack).toBe(before.vectorRedoStack)
    expect(after.vectorDocument).toBe(before.vectorDocument)
    expect(after.illustrator).toBe(before.illustrator)
    expect(after.params).toBe(before.params)
    expect(encodeLink(after.vectorDocument!, after.params.fillColor)).toBe(link)
  })
})

describe('the ink', () => {
  beforeEach(() => reset())

  it('belongs to the document, not its objects: a new ink changes no object and is no undo step', () => {
    useLogoStore.getState().setParam('fillColor', '#ff3300')
    useLogoStore.getState().addSlab('rounded')
    const before = objects()
    const depth = undoDepth()
    useLogoStore.getState().setParam('fillColor', '#0055ff')
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })

    expect(objects()[0]).toBe(before[0])
    expect(objects().every((object) => !('appearance' in object))).toBe(true)
    expect(undoDepth()).toBe(depth + 1)
  })
})

describe('dropping a spark', () => {
  const WIDE = { width: 1400, height: 1000 }
  const spark = rollSparks(1, 3)[0]
  const withCuts = rollSparks(8, 1).find((rolled) => rolled.shapes.some((shape) => shape.operation === 'subtract'))!
  const selected = () => useLogoStore.getState().illustrator?.selectedLayerIds ?? []
  /** The box around what these layers leave on the canvas. A cut's own outline can reach past it. */
  const inkBox = (list: IllustratorLayer[]) =>
    composeIllustratorMark({ ...useLogoStore.getState().illustrator!, layers: list })!.viewBox
  const apart = (a: ReturnType<typeof inkBox>, b: ReturnType<typeof inkBox>) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

  beforeEach(() => reset(WIDE))

  it('fills an empty canvas: one layer per shape, 360 units across in the middle, all selected, back on Select', () => {
    useLogoStore.getState().setActiveTool('pen')
    useLogoStore.getState().dropSpark(withCuts)

    const dropped = layers()
    expect(dropped.map((layer) => layer.operation)).toEqual(withCuts.shapes.map((shape) => shape.operation))
    expect(dropped.every((layer) => !layer.carve)).toBe(true)
    expect(selected()).toEqual(dropped.map((layer) => layer.id))
    expect(useLogoStore.getState().ui.activeTool).toBeNull()

    const box = inkBox(dropped)
    expect(Math.max(box.width, box.height)).toBeCloseTo(360, 1)
    expect(box.x + box.width / 2).toBeCloseTo(0, 1)
    expect(box.y + box.height / 2).toBeCloseTo(0, 1)
  })

  it('is one undo step, and redo brings the same layers back', () => {
    useLogoStore.getState().dropSpark(spark)
    const dropped = layers()
    expect(undoDepth()).toBe(1)

    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toEqual([])
    useLogoStore.getState().redoVectorCommand()
    expect(layers()).toEqual(dropped)
    expect(selected()).toEqual(dropped.map((layer) => layer.id))
  })

  it('goes below what is there and beside it, and leaves it exactly as it was', () => {
    const store = useLogoStore.getState()
    store.setParam('fillColor', '#ff3300')
    store.addSlab('rounded')
    store.addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })
    store.addPenShape('M-150,-150L-60,-150L-60,-60Z')
    store.selectIllustratorLayer(layers()[2].id)
    store.updateIllustratorLayer(layers()[2].id, { transform: { dx: 0, dy: 0, rotation: 20, scale: 1.2 } })
    store.setSelection([layers()[2].id], { layerId: layers()[2].id, segmentIndex: 1 })
    expect(useLogoStore.getState().illustrator?.pointSelection).not.toBeNull()
    const before = layers()
    const depth = undoDepth()

    useLogoStore.getState().dropSpark(withCuts)

    const after = layers()
    expect(useLogoStore.getState().illustrator?.pointSelection).toBeNull()
    const count = withCuts.shapes.length
    expect(after).toHaveLength(before.length + count)
    expect(after.slice(count)).toEqual(before)
    expect(after.slice(count).map((layer) => layer.carve?.kind)).toEqual(['slab', 'punch', undefined])
    expect(selected()).toEqual(after.slice(0, count).map((layer) => layer.id))
    expect(apart(inkBox(after.slice(0, count)), inkBox(before))).toBe(true)

    const state = useLogoStore.getState()
    expect(state.params.fillColor).toBe('#ff3300')
    expect(undoDepth()).toBe(depth + 1)

    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toEqual(before)
  })

  it('twice gives two sets with their own ids, side by side', () => {
    useLogoStore.getState().dropSpark(spark)
    const first = layers()
    useLogoStore.getState().dropSpark(spark)
    const all = layers()
    const second = all.slice(0, spark.shapes.length)

    expect(all).toHaveLength(spark.shapes.length * 2)
    expect(new Set(all.map((layer) => layer.id)).size).toBe(all.length)
    expect(all.slice(spark.shapes.length)).toEqual(first)
    expect(selected()).toEqual(second.map((layer) => layer.id))
    expect(apart(inkBox(second), inkBox(first))).toBe(true)
    expect(undoDepth()).toBe(2)
  })

  it('still lands inside a canvas with no room beside the ink', () => {
    reset({ width: 600, height: 600 })
    useLogoStore.getState().addSlab('circle')
    useLogoStore.getState().dropSpark(spark)
    const box = inkBox(layers().slice(0, spark.shapes.length))
    expect(Math.max(box.width, box.height)).toBeCloseTo(180, 1)
    expect(box.x + box.width).toBeLessThanOrEqual(300)
    expect(box.y + box.height).toBeLessThanOrEqual(300)
  })
})

describe('the spark shuffle', () => {
  beforeEach(() => reset())

  it('deals a different set each time', () => {
    useLogoStore.getState().setSparkSeed(7)
    expect(useLogoStore.getState().ui.sparkSeed).toBe(7)
    useLogoStore.getState().shuffleSparks()
    const second = useLogoStore.getState().ui.sparkSeed
    useLogoStore.getState().shuffleSparks()
    const third = useLogoStore.getState().ui.sparkSeed
    expect(new Set([7, second, third]).size).toBe(3)
  })

  it('is a view setting: no undo step, the same document, the same link', () => {
    useLogoStore.getState().addSlab('square')
    const before = useLogoStore.getState()
    const link = encodeLink(before.vectorDocument!, before.params.fillColor)

    useLogoStore.getState().shuffleSparks()
    useLogoStore.getState().setSparkSeed(99)

    const after = useLogoStore.getState()
    expect(after.vectorUndoStack).toBe(before.vectorUndoStack)
    expect(after.vectorDocument).toBe(before.vectorDocument)
    expect(after.params).toBe(before.params)
    expect(encodeLink(after.vectorDocument!, after.params.fillColor)).toBe(link)
  })

  it('starts somewhere different on each load', async () => {
    const load = async () => {
      vi.resetModules()
      return (await import('./logoStore.ts')).useLogoStore.getInitialState().ui.sparkSeed
    }
    const seeds = [await load(), await load(), await load()]
    expect(seeds.every(Number.isSafeInteger)).toBe(true)
    expect(new Set(seeds).size).toBe(3)
  })
})

describe('guides', () => {
  beforeEach(() => reset())

  const guides = () => useLogoStore.getState().vectorDocument.guides
  const selectedGuides = () => useLogoStore.getState().illustrator.selectedGuideIds
  const line = (y: number) => ({ kind: 'line' as const, p: { x: 0, y }, angle: 0 })

  it('adds a guide as one undo step, selected, and undo and redo put back the very same guides array', () => {
    useLogoStore.getState().addSlab('square')
    const before = guides()
    const depth = undoDepth()
    useLogoStore.getState().addGuides([line(40)])
    const after = guides()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ name: 'Line', style: 'solid', visible: true, locked: false, shape: line(40) })
    expect(selectedGuides()).toEqual([after[0].id])
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([])
    expect(undoDepth()).toBe(depth + 1)

    useLogoStore.getState().undoVectorCommand()
    expect(guides()).toBe(before)
    expect(selectedGuides()).toEqual([])
    useLogoStore.getState().redoVectorCommand()
    expect(guides()).toBe(after)
    expect(selectedGuides()).toEqual([after[0].id])
  })

  it('a guide edit keeps the objects array, so the mark is not composed again', () => {
    useLogoStore.getState().addSlab('square')
    const objectsBefore = objects()
    const mark = composeVectorMarkCached(useLogoStore.getState().vectorDocument)
    useLogoStore.getState().addGuides([line(40), line(80)])
    const ids = guides().map((guide) => guide.id)
    useLogoStore.getState().setGuidesStyle(ids, 'dotted')
    useLogoStore.getState().setGuidesLocked([ids[0]], true)
    useLogoStore.getState().toggleGuideVisibility(ids[1])
    useLogoStore.getState().deleteGuides([ids[1]])
    expect(objects()).toBe(objectsBefore)
    expect(composeVectorMarkCached(useLogoStore.getState().vectorDocument)).toBe(mark)
    expect(guides()).toMatchObject([{ style: 'dotted', locked: true }])
  })

  it('deleting a guide by id keeps a selection of shapes, and drops it from a selection of guides', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addGuides([line(10), line(20)])
    const [a, b] = guides().map((guide) => guide.id)
    const slab = layers()[0].id
    useLogoStore.getState().setSelection([slab])
    useLogoStore.getState().deleteGuides([a])
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([slab])
    useLogoStore.getState().selectGuides([b])
    useLogoStore.getState().deleteGuides([b])
    expect(selectedGuides()).toEqual([])
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([])
  })

  it('a guide edit that changes nothing is no undo step', () => {
    useLogoStore.getState().addGuides([line(40)])
    const id = guides()[0].id
    const depth = undoDepth()
    const before = guides()
    useLogoStore.getState().setGuidesStyle([id], 'solid')
    useLogoStore.getState().setGuidesLocked([id], false)
    useLogoStore.getState().commitGuides('Move guide', [...guides()])
    useLogoStore.getState().detachGuides([id])
    expect(undoDepth()).toBe(depth)
    expect(guides()).toBe(before)
  })

  it("a circle slab's construction guides follow a resize of the slab, in the same undo step", () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addConstructionGuides()
    const before = guides()
    expect(before.map((guide) => guide.link?.role)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle'])
    const depth = undoDepth()
    useLogoStore.getState().commitLayerEdits({
      label: 'Resize',
      edits: [{ layerId: slab.id, carve: { ...(slab.carve as SlabSpec), width: 500, height: 500, radius: 250, center: { x: 10, y: 0 } } }],
    })
    expect(undoDepth()).toBe(depth + 1)
    expect(guides().find((guide) => guide.link?.role === 'circumcircle')!.shape).toEqual({ kind: 'circle', c: { x: 10, y: 0 }, r: 250 })
    expect(guides().find((guide) => guide.link?.role === 'right')!.shape).toEqual({ kind: 'line', p: { x: 260, y: 0 }, angle: 90 })
    useLogoStore.getState().undoVectorCommand()
    expect(guides()).toBe(before)
  })

  it("keeps a slab's top guide on the slab's own top side as it turns from 0° to 90° in 5° steps", () => {
    const store = () => useLogoStore.getState()
    store().addSlab('tall')
    const slab = layers()[0]
    const spec = slab.carve as SlabSpec
    store().addConstructionGuides()
    const half = spec.height / 2
    for (let rotation = 0; rotation <= 90; rotation += 5) {
      store().commitLayerEdits({ label: 'Turn', edits: [{ layerId: slab.id, carve: { ...spec, rotation } }] })
      const top = guides().find((guide) => guide.link?.role === 'top')!
      if (top.shape.kind !== 'line') throw new Error('no line')
      // Along its own top: at its turn, half its height from its centre, on the side its top turned to.
      expect(top.link).toEqual({ kind: 'construction', of: slab.id, role: 'top' })
      expect(top.shape.angle).toBeCloseTo(rotation, 6)
      const up = { x: Math.sin((rotation * Math.PI) / 180), y: -Math.cos((rotation * Math.PI) / 180) }
      const off = { x: top.shape.p.x - spec.center.x, y: top.shape.p.y - spec.center.y }
      expect(off.x * up.x + off.y * up.y).toBeCloseTo(half, 6)
    }
  })

  it('names construction guides for where they lie, renaming them as their shape turns, so guides made before and after a turn never read the same', () => {
    const store = () => useLogoStore.getState()
    store().addSlab('tall')
    const slab = layers()[0]
    const spec = slab.carve as SlabSpec
    const top = constructionLines(store().vectorDocument.objects[0] as PathObject).find((line) => line.role === 'top')!
    store().addGuides([{ shape: top.shape, link: { kind: 'construction', of: slab.id, role: 'top' }, name: top.name }])
    store().commitLayerEdits({ label: 'Turn', edits: [{ layerId: slab.id, carve: { ...spec, rotation: 90 } }] })
    store().addConstructionGuides([slab.id])
    const named = guides().map((guide) => [guide.link?.role, guide.name])
    // A quarter turn on, its own top is the line on the right, and its upright centre line is flat.
    expect(named.slice(0, 7)).toEqual([
      ['top', 'Right'],
      ['centre-x', 'Centre ↔'],
      ['centre-y', 'Centre ↕'],
      ['right', 'Bottom'],
      ['bottom', 'Left'],
      ['left', 'Top'],
      ['circumcircle', 'Circumcircle'],
    ])
    const rows = guideRows(guides(), (id) => (id === slab.id ? '01' : null)).map(({ label, tag }) => `${label} · ${tag}`)
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('nudges the selected guides at once, a burst one undo step, each detached from its shape and stored to hundredths', () => {
    const store = () => useLogoStore.getState()
    store().addSlab('square')
    store().addConstructionGuides()
    const linked = guides().find((guide) => guide.link?.role === 'circumcircle')!
    store().addGuides([{ kind: 'line', p: { x: 0.004, y: 10 }, angle: 0 }])
    const plain = guides().at(-1)!
    store().selectGuides([linked.id, plain.id])
    const before = guides()
    const depth = undoDepth()
    store().nudgeGuides({ x: 1, y: 0 })
    store().nudgeGuides({ x: 0, y: 10 })
    expect(undoDepth()).toBe(depth + 1)
    const moved = guides().find((guide) => guide.id === plain.id)!
    expect(moved.shape).toEqual({ kind: 'line', p: { x: 1, y: 20 }, angle: 0 })
    const circle = guides().find((guide) => guide.id === linked.id)!
    expect(circle.link).toBeUndefined()
    expect(circle.shape).toMatchObject({ kind: 'circle', c: { x: 1, y: 10 } })
    store().undoVectorCommand()
    expect(guides()).toBe(before)

    // A locked guide stays put, and hidden guides take no nudge.
    store().setGuidesLocked([plain.id], true)
    store().selectGuides([plain.id])
    const locked = guides()
    store().nudgeGuides({ x: 1, y: 0 })
    expect(guides()).toBe(locked)
  })

  it('deleting a shape detaches its guides in the same undo step, and undo links them again', () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addConstructionGuides([slab.id])
    const linkedGuides = guides()
    const depth = undoDepth()
    useLogoStore.getState().deleteIllustratorLayers([slab.id])
    expect(undoDepth()).toBe(depth + 1)
    expect(guides()).toHaveLength(linkedGuides.length)
    expect(guides().every((guide) => guide.link === undefined)).toBe(true)
    expect(guides().map((guide) => guide.shape)).toEqual(linkedGuides.map((guide) => guide.shape))
    useLogoStore.getState().undoVectorCommand()
    expect(guides()).toBe(linkedGuides)
  })

  it('a construction guide added from a stale reading of its shape lands on the shape as it is now, and one linked to a shape gone lands as a plain guide', () => {
    useLogoStore.getState().addSlab('square')
    const slab = layers()[0]
    useLogoStore.getState().addGuides([
      { shape: { kind: 'line', p: { x: 0, y: 80 }, angle: 0 }, link: { kind: 'construction', of: slab.id, role: 'centre-y' } },
      { shape: { kind: 'line', p: { x: 0, y: 40 }, angle: 0 }, link: { kind: 'construction', of: 'gone', role: 'top' } },
    ])
    const [stale, dangling] = guides()
    expect(stale.shape).toEqual({ kind: 'line', p: { x: 0, y: 0 }, angle: 0 })
    expect(stale.link).toEqual({ kind: 'construction', of: slab.id, role: 'centre-y' })
    expect(dangling.shape).toEqual({ kind: 'line', p: { x: 0, y: 40 }, angle: 0 })
    expect(dangling.link).toBeUndefined()
  })

  it('adds no construction guide twice', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addConstructionGuides()
    const count = guides().length
    const depth = undoDepth()
    useLogoStore.getState().setSelection([layers()[0].id])
    useLogoStore.getState().addConstructionGuides()
    expect(guides()).toHaveLength(count)
    expect(undoDepth()).toBe(depth)
  })

  it('makes a tangent frame only for two or more circles, linked so it keeps touching them', () => {
    const store = () => useLogoStore.getState()
    store().addPenShape('M0,0L100,0L100,100Z')
    store().addSlab('circle')
    const circle = layers()[1]
    const spec = circle.carve as SlabSpec
    store().setSelection([circle.id])
    store().addTangentFrame()
    expect(guides()).toEqual([])
    store().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 300, y: 0 }, radius: 50 })
    const punch = layers()[2]
    store().setSelection([circle.id, punch.id, layers()[0].id])
    store().addTangentFrame()
    expect(guides()).toEqual([])
    store().setSelection([circle.id, punch.id])
    store().addTangentFrame()
    const frame = guides().map((guide) => ({ ...guide.link, shape: guide.shape }))
    expect(frame).toEqual([
      { kind: 'construction', of: circle.id, role: 'top', shape: { kind: 'line', p: { x: spec.center.x, y: spec.center.y - spec.width / 2 }, angle: 0 } },
      { kind: 'construction', of: punch.id, role: 'right', shape: { kind: 'line', p: { x: 350, y: 0 }, angle: 90 } },
      expect.objectContaining({ of: circle.id, role: 'bottom' }),
      expect.objectContaining({ of: circle.id, role: 'left' }),
    ])
    // The punch moves right: the right line keeps touching it.
    store().commitLayerEdits({ label: 'Move', edits: [{ layerId: punch.id, carve: { ...(punch.carve as PunchSpec), center: { x: 340, y: 20 } } }] })
    expect(guides()[1].shape).toEqual({ kind: 'line', p: { x: 390, y: 20 }, angle: 90 })
  })

  it('makes a guide of each contour of the selected paths, and a shape of each closed guide, and back', () => {
    const store = () => useLogoStore.getState()
    store().addSlab('square')
    store().addPenShape('M0,0L100,0L100,100Z')
    const contours = objects().map((object) => (object.type === 'path' ? object.contours : []))
    store().setSelection(layers().map((layer) => layer.id))
    const depth = undoDepth()
    store().makeGuidesFromSelection()
    expect(undoDepth()).toBe(depth + 1)
    expect(objects()).toEqual([])
    expect(guides().map((guide) => guide.shape)).toEqual(contours.flat().map((contour) => ({ kind: 'path', contour })))
    expect(selectedGuides()).toEqual(guides().map((guide) => guide.id))

    store().makeShapeFromGuides()
    expect(guides()).toEqual([])
    expect(objects().map((object) => (object.type === 'path' ? object.contours : []))).toEqual(contours)
    expect(objects().every((object) => object.type === 'path' && object.operation === 'add' && !object.carve)).toBe(true)
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual(objects().map((object) => object.id))
    store().undoVectorCommand()
    store().undoVectorCommand()
    expect(objects()).toHaveLength(2)
    expect(guides()).toEqual([])
  })

  it('makes no shape of an open path guide or a line', () => {
    const open = { kind: 'path' as const, contour: { closed: false, segments: [{ point: { x: 0, y: 0 }, handleIn: null, handleOut: null }, { point: { x: 50, y: 0 }, handleIn: null, handleOut: null }] } }
    useLogoStore.getState().addGuides([open, line(10)])
    useLogoStore.getState().makeShapeFromGuides()
    expect(objects()).toEqual([])
    expect(guides()).toHaveLength(2)
  })

  it('keeps a pen path as a guide and goes back to selecting', () => {
    useLogoStore.getState().setActiveTool('pen')
    const contour = { closed: false, segments: [{ point: { x: 0, y: 0 }, handleIn: null, handleOut: null }, { point: { x: 50, y: 20 }, handleIn: null, handleOut: null }] }
    useLogoStore.getState().addPenGuide(contour)
    expect(guides()).toMatchObject([{ name: 'Path', shape: { kind: 'path', contour } }])
    expect(objects()).toEqual([])
    expect(useLogoStore.getState().ui.activeTool).toBeNull()
  })

  it('selects guides and shapes apart: a guide selection drops the shapes, and Shift toggles among guides', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addGuides([line(10), line(20)])
    const [a, b] = guides().map((guide) => guide.id)
    useLogoStore.getState().setSelection([layers()[0].id])
    useLogoStore.getState().selectGuides([a])
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([])
    useLogoStore.getState().selectGuides([b], true)
    expect(selectedGuides()).toEqual([a, b])
    useLogoStore.getState().selectGuides([a], true)
    expect(selectedGuides()).toEqual([b])
    useLogoStore.getState().setSelection([layers()[0].id])
    expect(selectedGuides()).toEqual([])
  })

  it('Start over clears the guides as one undo step, and undo brings them back', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addGuides([line(10)])
    const before = guides()
    const depth = undoDepth()
    useLogoStore.getState().startOver()
    expect(guides()).toEqual([])
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().undoVectorCommand()
    expect(guides()).toBe(before)
  })

  it('shows and hides guides outside the history', () => {
    const depth = undoDepth()
    expect(useLogoStore.getState().ui.showGuides).toBe(true)
    useLogoStore.getState().toggleShowGuides()
    expect(useLogoStore.getState().ui.showGuides).toBe(false)
    expect(undoDepth()).toBe(depth)
  })

  it('drops guides from the selection when they leave the canvas, and picks none while they are hidden', () => {
    const store = () => useLogoStore.getState()
    store().addSlab('square')
    const slab = layers()[0].id
    store().addGuides([line(10), line(20)])
    const [a, b] = guides().map((guide) => guide.id)
    store().selectGuides([a])
    store().toggleShowGuides()
    expect(selectedGuides()).toEqual([])
    // Delete then has nothing to act on: no guide goes unseen.
    store().deleteGuides()
    expect(guides()).toHaveLength(2)

    store().toggleShowGuides()
    store().selectGuides([b])
    store().toggleLook()
    expect(selectedGuides()).toEqual([])

    // A selection of shapes stays as the guides leave.
    store().toggleLook()
    store().setSelection([slab])
    store().toggleShowGuides()
    expect(store().illustrator.selectedLayerIds).toEqual([slab])

    // An undo while hidden does not select a guide back.
    store().toggleShowGuides()
    store().selectGuides([a])
    store().deleteGuides()
    store().toggleShowGuides()
    store().undoVectorCommand()
    expect(guides()).toHaveLength(2)
    expect(selectedGuides()).toEqual([])

    // Nothing picks a guide while guides are hidden, and the view stays as it is.
    store().selectGuides([a])
    expect(selectedGuides()).toEqual([])
    expect(store().ui.showGuides).toBe(false)
    store().toggleShowGuides()
    store().toggleLook()
    store().selectGuides([a])
    expect(selectedGuides()).toEqual([])
    expect(store().ui.look).toBe('final')

    // A guide turned off leaves the selection, and one off cannot be picked.
    store().toggleLook()
    store().selectGuides([a, b])
    store().toggleGuideVisibility(a)
    expect(selectedGuides()).toEqual([b])
    store().selectGuides([a])
    expect(selectedGuides()).toEqual([b])
    // The drawer still deletes a guide while it is off.
    store().deleteGuides([a])
    expect(guides().map((guide) => guide.id)).toEqual([b])

    // A gesture that commits after the guides left the canvas does not select them back.
    store().selectGuides(null)
    store().toggleShowGuides()
    store().commitGuides('Move guide', guides().map((guide) => ({ ...guide, shape: line(40) })), [b])
    expect(selectedGuides()).toEqual([])
  })

  it('puts guides on the canvas when the Guide tool is picked or a guide is made, so nothing is made unseen', () => {
    const store = () => useLogoStore.getState()
    const view = () => ({ look: store().ui.look, showGuides: store().ui.showGuides })
    store().toggleLook()
    store().toggleShowGuides()
    store().setActiveTool('guide')
    expect(view()).toEqual({ look: 'construction', showGuides: true })

    store().setActiveTool(null)
    store().toggleLook()
    store().addGuides([line(10)])
    expect(view()).toEqual({ look: 'construction', showGuides: true })

    store().toggleShowGuides()
    store().setActiveTool('pen')
    expect(view().showGuides).toBe(false)
    store().setPenDraws('guide')
    expect(view()).toEqual({ look: 'construction', showGuides: true })

    // Showing, hiding or deleting guides leaves the view as it is.
    store().toggleLook()
    store().deleteGuides([guides()[0].id])
    expect(view()).toEqual({ look: 'final', showGuides: true })
  })

  it('freezes a guide as it enters the document in development, so an edit in place throws', () => {
    useLogoStore.getState().addGuides([line(10)])
    expect(Object.isFrozen(guides()[0].shape)).toBe(true)
  })

  it('writes guides into the link and reads them back, still following their shape', () => {
    useLogoStore.getState().addSlab('circle')
    useLogoStore.getState().addConstructionGuides()
    const state = useLogoStore.getState()
    const decoded = decodeLink(encodeLink(state.vectorDocument, state.params.fillColor))
    expect(decoded.kind).toBe('vector')
    if (decoded.kind === 'vector') expect(decoded.document.guides).toEqual(guides())
  })
})
