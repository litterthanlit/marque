import { beforeEach, describe, expect, it } from 'vitest'
import { useLogoStore } from './logoStore.ts'
import type { SlabSpec } from '../engine/carve/spec.ts'
import { illustratorDocumentToVectorDocument } from '../engine/vector/legacyIllustratorAdapter.ts'

function reset(viewport = { width: 600, height: 600 }) {
  const state = useLogoStore.getState()
  useLogoStore.setState({
    activeSurface: 'generated',
    vectorDocument: null,
    illustrator: null,
    vectorUndoStack: [],
    vectorRedoStack: [],
    ui: { ...state.ui, viewport, activeTool: null },
  })
}

const layers = () => useLogoStore.getState().illustrator?.layers ?? []
const undoDepth = () => useLogoStore.getState().vectorUndoStack.length

describe('logo store', () => {
  it('loads outside the browser with Vector Maker empty', () => {
    const state = useLogoStore.getState()
    expect(state.activeSurface).toBe('generated')
    expect(state.vectorDocument).toBeNull()
    expect(state.vectorUndoStack).toHaveLength(0)
    expect(state.ui.theme).toBe('dark')
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
    expect(undoDepth()).toBe(1)

    const [slab, punch] = layers()
    useLogoStore.getState().selectIllustratorLayer(slab.id)
    useLogoStore.getState().setSelection([punch.id])
    useLogoStore.getState().setSelection([])
    expect(undoDepth()).toBe(1)

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
    expect(undoDepth()).toBe(1)
    expect((layers()[0].carve as SlabSpec).width).toBe(440)

    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: slab.id, carve: wider }] })
    expect(undoDepth()).toBe(1)

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

  it("Generate's history ignores Vector Maker edits", () => {
    const before = useLogoStore.temporal.getState().pastStates.length
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().addCarveCut({ kind: 'slice', from: { x: -50, y: 0 }, to: { x: 50, y: 0 }, width: 20 })
    useLogoStore.getState().setSelection([])
    expect(useLogoStore.temporal.getState().pastStates.length).toBe(before)
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

describe('slabs and the auto-converted generated mark', () => {
  it('a slab replaces an untouched conversion; undo brings the mark back', () => {
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
    expect(layers()).toHaveLength(1)
    expect(layers()[0].carve?.kind).toBe('slab')
    expect((layers()[0].carve as SlabSpec).width).toBe(380)
    useLogoStore.getState().undoVectorCommand()
    expect(layers()[0].name).toBe('Generated Polygon 01')
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
