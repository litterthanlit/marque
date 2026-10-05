import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogoStore } from './logoStore.ts'
import type { SlabSpec } from '../engine/carve/spec.ts'
import { composeIllustratorMark } from '../engine/illustrator/compose.ts'
import { layersBounds } from '../engine/illustrator/layerPath.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { rollSparks } from '../engine/sparks/sparks.ts'
import { illustratorDocumentToVectorDocument } from '../engine/vector/legacyIllustratorAdapter.ts'
import { encodeLink } from '../engine/vector/link.ts'
import { createSavedVariation, type SavedVariation } from '../engine/vector/saved.ts'

function reset(viewport = { width: 600, height: 600 }) {
  const initial = useLogoStore.getInitialState()
  useLogoStore.setState({ ...initial, ui: { ...initial.ui, viewport } })
}

const layers = () => useLogoStore.getState().illustrator?.layers ?? []
const undoDepth = () => useLogoStore.getState().vectorUndoStack.length

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

  it('Start over clears the mark and undo brings it back', () => {
    useLogoStore.getState().addSlab('circle')
    useLogoStore.getState().startOver()
    expect(layers()).toHaveLength(0)
    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toHaveLength(1)
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
    const generated = illustratorDocumentToVectorDocument({
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
    })
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
    store.updateIllustratorLayerTransform(layers()[2].id, { rotation: 20, scale: 1.2 })
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
    expect(state.vectorDocument?.objects.map((object) => object.appearance?.fill)).toEqual(
      after.map(() => ({ type: 'solid', color: '#ff3300' })),
    )
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

describe('scaling the selection', () => {
  const spark = rollSparks(1, 3)[0]
  const centre = (list: IllustratorLayer[]) => {
    const box = layersBounds(list)!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  beforeEach(() => {
    reset({ width: 1400, height: 1000 })
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().dropSpark(spark)
  })

  it('resizes every selected layer about the middle of their box, as one undo step', () => {
    const before = layers()
    const pieces = before.slice(0, spark.shapes.length)
    const was = layersBounds(pieces)!
    const depth = undoDepth()

    useLogoStore.getState().scaleSelection(0.5)

    const after = layers()
    const now = layersBounds(after.slice(0, spark.shapes.length))!
    expect(now.width).toBeCloseTo(was.width / 2, 2)
    expect(now.height).toBeCloseTo(was.height / 2, 2)
    expect(centre(after.slice(0, spark.shapes.length)).x).toBeCloseTo(centre(pieces).x, 2)
    expect(centre(after.slice(0, spark.shapes.length)).y).toBeCloseTo(centre(pieces).y, 2)
    expect(after.map((layer) => layer.id)).toEqual(before.map((layer) => layer.id))
    expect(after.at(-1)).toEqual(before.at(-1))
    expect(useLogoStore.getState().illustrator?.selectedLayerIds).toEqual(pieces.map((layer) => layer.id))
    expect(undoDepth()).toBe(depth + 1)

    useLogoStore.getState().undoVectorCommand()
    expect(layers()).toEqual(before)
    useLogoStore.getState().redoVectorCommand()
    expect(layers()).toEqual(after)
  })

  it('leaves recipes alone: a selection with a slab in it does not scale', () => {
    const before = layers()
    useLogoStore.getState().setSelection(before.map((layer) => layer.id))
    const depth = undoDepth()

    useLogoStore.getState().scaleSelection(2)

    expect(layers()).toEqual(before)
    expect(undoDepth()).toBe(depth)
  })

  it.each([1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY])('by %f is no change and no undo step', (factor) => {
    const before = layers()
    const depth = undoDepth()
    useLogoStore.getState().scaleSelection(factor)
    expect(layers()).toEqual(before)
    expect(undoDepth()).toBe(depth)
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
