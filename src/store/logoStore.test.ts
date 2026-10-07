import paper from 'paper'
import { compressToEncodedURIComponent } from 'lz-string'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupRefusalOf, ungroupRefusalOf, useLogoStore } from './logoStore.ts'
import { rotateCarveAbout, scaleCarveAbout, translateCarve } from '../engine/carve/edit.ts'
import { describeCarve, polygonApothem, type BandSpec, type PolygonSpec, type PunchSpec, type SlabSpec } from '../engine/carve/spec.ts'
import { composeIllustratorMark } from '../engine/illustrator/compose.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { rollSparks } from '../engine/sparks/sparks.ts'
import { composeVectorMark, composeVectorMarkCached } from '../engine/vector/export.ts'
import { readLegacyLayers } from '../engine/vector/migrate.ts'
import { constructionLines, guideRows } from '../engine/vector/guides.ts'
import type { PathObject, VectorDocument, VectorObject } from '../engine/vector/types.ts'
import { decodeLink, encodeLink } from '../engine/vector/link.ts'
import { sanitizeVectorDocument } from '../engine/vector/document.ts'
import { createSavedVariation, savedDocument, type SavedVariation } from '../engine/vector/saved.ts'
import { pinsLostWithTarget } from '../engine/vector/pins.ts'

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

describe('polygons in the store', () => {
  beforeEach(() => reset())

  it('the slab row adds a hexagon with the sides last chosen, and the punch cuts one', () => {
    useLogoStore.getState().addSlab('polygon')
    expect(layers()[0].carve).toEqual({ v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius: 200, rotation: 0, cornerRadius: 0 })
    expect(layers()[0].name).toBe('Polygon · 6')
    useLogoStore.getState().setCarveSettings({ polygonSides: 8 })
    useLogoStore.getState().addSlab('polygon')
    expect(layers()[1].carve).toMatchObject({ kind: 'polygon', sides: 8, radius: 100 })
    useLogoStore.getState().addCarveCut({ kind: 'polygon', center: { x: 10, y: 0 }, radius: 50, sides: 5 })
    expect(layers()[2].operation).toBe('subtract')
    expect(layers()[2].carve).toMatchObject({ kind: 'polygon', sides: 5, radius: 50 })
  })

  it('[ and ] take a side off the selected polygons and add one, one undo step each, from 3 to 12, and leave other shapes', () => {
    const store = useLogoStore.getState()
    store.addSlab('polygon')
    store.addSlab('rounded')
    store.addCarveCut({ kind: 'polygon', center: { x: 10, y: 0 }, radius: 50, sides: 4 })
    const [hexagon, slab, square] = layers()
    useLogoStore.getState().setSelection([hexagon.id, slab.id, square.id])
    const depth = undoDepth()
    const slabObject = objects()[1]

    useLogoStore.getState().stepPolygonSides(1)
    expect(layers().map((layer) => (layer.carve?.kind === 'polygon' ? layer.carve.sides : null))).toEqual([7, null, 5])
    expect(layers().map((layer) => layer.name)).toEqual(['Polygon · 7', 'Slab', 'Polygon · 5'])
    expect(objects()[1]).toBe(slabObject)
    expect(undoDepth()).toBe(depth + 1)
    expect(useLogoStore.getState().ui.carve.polygonSides).toBe(5)

    useLogoStore.getState().stepPolygonSides(-1)
    expect(undoDepth()).toBe(depth + 2)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().undoVectorCommand()
    expect(layers().map((layer) => (layer.carve?.kind === 'polygon' ? layer.carve.sides : null))).toEqual([6, null, 4])

    useLogoStore.getState().setSelection([square.id])
    for (let i = 0; i < 5; i++) useLogoStore.getState().stepPolygonSides(-1)
    expect((layers()[2].carve as { sides: number }).sides).toBe(3)
    // Only the step that took a side off is an undo step: at 3 it goes no further.
    expect(undoDepth()).toBe(depth + 1)
  })

  it('[ and ] step the sides of the next polygon when no polygon is selected, with no undo step, and keep a name the polygon was given', () => {
    useLogoStore.getState().addSlab('rounded')
    const depth = undoDepth()
    const slab = objects()[0]
    useLogoStore.getState().stepPolygonSides(1)
    expect(undoDepth()).toBe(depth)
    expect(objects()[0]).toBe(slab)
    expect(useLogoStore.getState().ui.carve.polygonSides).toBe(7)
    useLogoStore.getState().addSlab('polygon')
    expect(layers()[1].carve).toMatchObject({ kind: 'polygon', sides: 7 })
    useLogoStore.getState().setSelection([])
    for (let i = 0; i < 12; i++) useLogoStore.getState().stepPolygonSides(-1)
    expect(useLogoStore.getState().ui.carve.polygonSides).toBe(3)
    for (let i = 0; i < 12; i++) useLogoStore.getState().stepPolygonSides(1)
    expect(useLogoStore.getState().ui.carve.polygonSides).toBe(12)
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().setCarveSettings({ polygonSides: 6 })
    useLogoStore.getState().addSlab('polygon')
    const id = layers()[2].id
    useLogoStore.getState().updateIllustratorLayer(id, { name: 'Nut' })
    useLogoStore.getState().setSelection([id])
    useLogoStore.getState().stepPolygonSides(1)
    expect(layers()[2].name).toBe('Nut')
  })

  it("[ and ] make a polygon's spokes again for its new count of corners, in the same undo step, none left behind", () => {
    const store = () => useLogoStore.getState()
    const guides = () => store().vectorDocument.guides
    store().addSlab('polygon')
    const hexagon = layers()[0]
    store().addConstructionGuides()
    const spokes = () => guides().filter((guide) => guide.link?.role.startsWith('axis-'))
    const angles = () => spokes().map((guide) => (guide.shape.kind === 'line' ? Math.round(guide.shape.angle) : null))
    expect(spokes().map((guide) => guide.link!.role)).toEqual(['axis-1', 'axis-2'])
    store().setGuidesStyle(spokes().map((guide) => guide.id), 'solid')
    const before = guides()
    const depth = undoDepth()

    // A heptagon has a spoke through each corner, the top one being the upright centre line.
    store().setSelection([hexagon.id])
    store().stepPolygonSides(1)
    expect(undoDepth()).toBe(depth + 1)
    expect(spokes().map((guide) => guide.link!.role)).toEqual(['axis-1', 'axis-2', 'axis-3', 'axis-4', 'axis-5', 'axis-6'])
    expect(spokes().every((guide) => guide.link!.of === hexagon.id && guide.style === 'solid')).toBe(true)
    expect(guides().filter((guide) => !guide.link)).toEqual([])
    expect(guides().filter((guide) => guide.link?.role === 'centre-y')).toHaveLength(1)
    // An octagon's level spoke is the level centre line, offered once.
    store().stepPolygonSides(1)
    expect(angles().sort((a, b) => a! - b!)).toEqual([45, 135])
    // Back to a pentagon and up again to a hexagon: four spokes, then two, and none detached.
    store().stepPolygonSides(-1)
    store().stepPolygonSides(-1)
    store().stepPolygonSides(-1)
    expect(spokes()).toHaveLength(4)
    store().stepPolygonSides(1)
    expect(spokes().map((guide) => guide.link!.role)).toEqual(['axis-1', 'axis-2'])
    expect(angles()).toEqual([150, 30])
    expect(guides().filter((guide) => !guide.link)).toEqual([])

    expect(undoDepth()).toBe(depth + 6)
    for (let i = 0; i < 6; i++) store().undoVectorCommand()
    expect(guides()).toBe(before)
  })

  it("[ and ] keep a polygon's spokes through a square, whose spokes are its centre lines, one undo step each", () => {
    const store = () => useLogoStore.getState()
    const guides = () => store().vectorDocument.guides
    store().addSlab('polygon')
    const hexagon = layers()[0]
    store().addConstructionGuides()
    // Spokes made again take the look of the polygon's other construction guides.
    store().setGuidesStyle(guides().map((guide) => guide.id), 'dashed')
    store().setSelection([hexagon.id])
    const spokes = () => guides().filter((guide) => guide.link?.role.startsWith('axis-'))
    // Every spoke the polygon has, but those on its centre lines, each through its corners and named in order.
    const expected = () =>
      constructionLines(objects()[0] as PathObject)
        .filter((line) => line.role.startsWith('axis-'))
        .map(({ role, shape, name }) => ({ role, shape, name }))
    const actual = () => spokes().map((guide) => ({ role: guide.link!.role, shape: guide.shape, name: guide.name }))
    const history = [guides()]
    const seen: Array<{ sides: number; roles: string[] }> = []
    for (const delta of [-1, -1, -1, 1, 1, 1] as const) {
      store().stepPolygonSides(delta)
      expect(actual()).toEqual(expected())
      expect(spokes().every((guide) => guide.link!.of === hexagon.id && guide.style === 'dashed')).toBe(true)
      expect(guides().filter((guide) => !guide.link)).toEqual([])
      seen.push({ sides: (layers()[0].carve as { sides: number }).sides, roles: spokes().map((guide) => guide.link!.role) })
      history.push(guides())
    }
    expect(seen).toEqual([
      { sides: 5, roles: ['axis-1', 'axis-2', 'axis-3', 'axis-4'] },
      { sides: 4, roles: [] },
      { sides: 3, roles: ['axis-1', 'axis-2'] },
      { sides: 4, roles: [] },
      { sides: 5, roles: ['axis-1', 'axis-2', 'axis-3', 'axis-4'] },
      { sides: 6, roles: ['axis-1', 'axis-2'] },
    ])
    expect(spokes().map((guide) => (guide.shape.kind === 'line' ? Math.round(guide.shape.angle) : null))).toEqual([150, 30])
    expect(spokes().map((guide) => guide.name)).toEqual(['Spoke 1', 'Spoke 2'])
    // Each undo takes back one step, guides and all.
    for (let i = history.length - 2; i >= 0; i--) {
      store().undoVectorCommand()
      expect(guides()).toBe(history[i])
    }
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

  it('joins nothing when the selection holds a group, which would lose its isolation and its pieces\' Add or Cut', () => {
    open([
      group('one', { isolated: true }),
      path('a', 100, { parentId: 'one' }),
      path('cut a', 40, { parentId: 'one', operation: 'subtract' }),
      group('two', { isolated: true }),
      path('b', 100, { parentId: 'two' }),
      path('cut b', 40, { parentId: 'two', operation: 'subtract' }),
      path('x', 200),
    ])
    for (const selection of [['one', 'two'], ['one', 'x']]) {
      useLogoStore.getState().setSelection(selection)
      const before = objects()
      for (const op of ['unite', 'subtract', 'intersect'] as const) useLogoStore.getState().booleanIllustratorLayers(op)
      expect(objects()).toBe(before)
      expect(undoDepth()).toBe(0)
    }
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

describe('centre pins', () => {
  beforeEach(() => reset())

  const punchOf = () => layers().find((layer) => layer.carve?.kind === 'punch')!
  const carveOf = (id: string) => layers().find((layer) => layer.id === id)!.carve!

  it('places a punch pinned to a circle slab, and the punch follows a resize of the slab in the same undo step', () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30 }, slab.id)
    expect(punchOf().pin).toBe(slab.id)
    const depth = undoDepth()
    const grown: SlabSpec = { ...(slab.carve as SlabSpec), center: { x: 40, y: 40 }, width: 480, height: 480, radius: 240 }
    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: slab.id, carve: grown }] })
    expect((punchOf().carve as PunchSpec).center).toEqual({ x: 40, y: 40 })
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().undoVectorCommand()
    expect((punchOf().carve as PunchSpec).center).toEqual({ x: 0, y: 0 })
  })

  it('pins, re-pins and lets go through a gesture’s edits, and Unpin is one undo step', () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30 })
    const punch = punchOf()
    expect(punch.pin).toBeUndefined()
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: punch.id, carve: punch.carve!, pin: slab.id }] })
    expect(punchOf().pin).toBe(slab.id)
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: punch.id, carve: { ...punch.carve!, center: { x: 90, y: 0 } } as PunchSpec, pin: null }] })
    expect(punchOf().pin).toBeUndefined()
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: punch.id, carve: punch.carve!, pin: slab.id }] })
    useLogoStore.getState().setSelection([punch.id])
    const depth = undoDepth()
    useLogoStore.getState().unpinSelection()
    expect(punchOf().pin).toBeUndefined()
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().undoVectorCommand()
    expect(punchOf().pin).toBe(slab.id)
    expect(carveOf(slab.id)).toEqual(slab.carve)
  })

  it('lets go of every pin held to a shape at once, in one undo step', () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30 }, slab.id)
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'square', center: { x: 0, y: 0 }, radius: 10 }, slab.id)
    expect(layers().map((layer) => layer.pin)).toEqual([undefined, slab.id, slab.id])
    const depth = undoDepth()
    useLogoStore.getState().releasePinsTo(slab.id)
    expect(layers().map((layer) => layer.pin)).toEqual([undefined, undefined, undefined])
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().undoVectorCommand()
    expect(layers().map((layer) => layer.pin)).toEqual([undefined, slab.id, slab.id])
  })

  it('a free shape turned with the punch pinned to it keeps the punch where the turn put it, on the centre of its turned box', () => {
    useLogoStore.getState().addPenShape('M-150,-100L150,-100L-150,131Z')
    const shape = layers()[0]
    // The middle of its box, where the punch is pinned.
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 15.5 }, radius: 20 }, shape.id)
    const punch = punchOf()
    expect(punch.pin).toBe(shape.id)
    // Both turned 30° about a point off the centre, as a box turn of the two does.
    const pivot = { x: 40, y: -20 }
    const turn = (p: { x: number; y: number }) => {
      const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]
      const d = { x: p.x - pivot.x, y: p.y - pivot.y }
      return { x: pivot.x + d.x * c - d.y * s, y: pivot.y + d.x * s + d.y * c }
    }
    const [a, b, c] = [{ x: -150, y: -100 }, { x: 150, y: -100 }, { x: -150, y: 131 }].map(turn)
    const centre = turn({ x: 0, y: 15.5 })
    useLogoStore.getState().commitLayerEdits({
      label: 'Turn',
      edits: [
        { layerId: shape.id, pathData: `M${a.x},${a.y}L${b.x},${b.y}L${c.x},${c.y}Z`, frameRotation: 30 },
        { layerId: punch.id, carve: { ...(punch.carve as PunchSpec), center: centre } },
      ],
    })
    const after = (punchOf().carve as PunchSpec).center
    expect(Math.hypot(after.x - centre.x, after.y - centre.y)).toBeLessThan(0.02)
    expect(punchOf().pin).toBe(shape.id)
    // Turned alone, the shape takes the punch along, turned as its box turns.
    const [a2, b2, c2] = [a, b, c].map(turn)
    useLogoStore.getState().commitLayerEdits({
      label: 'Turn',
      edits: [{ layerId: shape.id, pathData: `M${a2.x},${a2.y}L${b2.x},${b2.y}L${c2.x},${c2.y}Z`, frameRotation: 60 }],
    })
    const again = (punchOf().carve as PunchSpec).center
    const twice = turn(centre)
    expect(Math.hypot(again.x - twice.x, again.y - twice.y)).toBeLessThan(0.02)
  })

  it('deleting the object a punch is pinned to lets go of the pin in the same undo step', () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 30 }, slab.id)
    const depth = undoDepth()
    useLogoStore.getState().deleteIllustratorLayers([slab.id])
    expect(punchOf().pin).toBeUndefined()
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().undoVectorCommand()
    expect(punchOf().pin).toBe(slab.id)
  })

  it('pins a channel or a slice by its middle: both ends move as far as the centre it is pinned to', () => {
    useLogoStore.getState().addSlab('circle')
    const slab = layers()[0]
    useLogoStore.getState().addCarveCut({ kind: 'channel', from: { x: -50, y: 0 }, to: { x: 50, y: 0 }, width: 20 }, slab.id)
    useLogoStore.getState().addCarveCut({ kind: 'slice', from: { x: 0, y: -40 }, to: { x: 0, y: 40 }, width: 4 }, slab.id)
    const [, channel, slice] = layers()
    expect([channel.pin, slice.pin]).toEqual([slab.id, slab.id])
    const moved: SlabSpec = { ...(slab.carve as SlabSpec), center: { x: 40, y: -30 } }
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: slab.id, carve: moved }] })
    expect(carveOf(channel.id)).toMatchObject({ from: { x: -10, y: -30 }, to: { x: 90, y: -30 }, width: 20 })
    expect(carveOf(slice.id)).toMatchObject({ from: { x: 40, y: -70 }, to: { x: 40, y: 10 } })
  })
})

describe('offset copies', () => {
  beforeEach(() => reset())

  /** A hexagon slab rounded to 60, as ref 1 starts, and its id. */
  function hexagon(): string {
    useLogoStore.getState().addSlab('polygon')
    const id = layers()[0].id
    const carve: PolygonSpec = { ...(layers()[0].carve as PolygonSpec), cornerRadius: 60 }
    useLogoStore.getState().commitLayerEdits({ label: 'Round corners', edits: [{ layerId: id, carve }] })
    return id
  }
  const object = (id: string) => objects().find((each) => each.id === id) as PathObject

  it('adds ref 1’s ring as one undo step: a cut directly above its source, selected, 55 in with corners of 5', () => {
    const id = hexagon()
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 250, y: 0 }, radius: 10 })
    const depth = undoDepth()
    useLogoStore.getState().addOffset(id, -55, true)
    expect(undoDepth()).toBe(depth + 1)
    const [, copy, punch] = objects() as PathObject[]
    expect(punch.carve?.kind).toBe('punch')
    expect(copy).toMatchObject({ operation: 'subtract', name: 'Inset \u221255', link: { kind: 'offset', of: id, distance: -55 } })
    expect(copy.carve).toMatchObject({ kind: 'polygon', cornerRadius: 5 })
    expect(polygonApothem(object(id).carve as PolygonSpec) - polygonApothem(copy.carve as PolygonSpec)).toBeCloseTo(55, 2)
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([copy.id])
    expect(layers()[1].link).toEqual({ kind: 'offset', of: id, distance: -55 })
    // The ring: the hexagon less the inset, as the mark draws it.
    const hexArea = (spec: PolygonSpec) => {
      const a = polygonApothem(spec)
      const rho = spec.cornerRadius
      return 6 * a * a * Math.tan(Math.PI / 6) - 6 * rho * rho * Math.tan(Math.PI / 6) + Math.PI * rho * rho
    }
    const ring = hexArea(object(id).carve as PolygonSpec) - hexArea(copy.carve as PolygonSpec)
    expect(Math.abs(markArea() - ring) / ring).toBeLessThan(0.002)
    useLogoStore.getState().undoVectorCommand()
    expect(objects()).toHaveLength(2)
    useLogoStore.getState().redoVectorCommand()
    expect(object(copy.id)).toBe(copy)
  })

  it('adds an outset with the source’s own operation unless it is a cut, and nothing for a distance of 0', () => {
    useLogoStore.getState().addSlab('circle')
    const id = layers()[0].id
    const depth = undoDepth()
    useLogoStore.getState().addOffset(id, 0, false)
    expect(undoDepth()).toBe(depth)
    useLogoStore.getState().addOffset(id, 12, false)
    expect(objects()[1]).toMatchObject({ operation: 'add', name: 'Outset 12', carve: { width: 424, radius: 212 } })
  })

  it('keeps the copy in its source’s group, directly above it', () => {
    const corner = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
    const square = { closed: true, segments: [corner(-100, -100), corner(100, -100), corner(100, 100), corner(-100, 100)] }
    useLogoStore.getState().setVectorDocument({
      ...useLogoStore.getState().vectorDocument,
      objects: [
        { id: 'g', name: 'g', parentId: null, visible: true, locked: false, type: 'group', isolated: true, operation: 'add' },
        { id: 'a', name: 'a', parentId: 'g', visible: true, locked: false, type: 'path', operation: 'add', contours: [square], fillRule: 'evenodd' },
        { id: 'b', name: 'b', parentId: 'g', visible: true, locked: false, type: 'path', operation: 'add', contours: [square], fillRule: 'evenodd' },
      ],
    })
    useLogoStore.getState().addOffset('a', -20, true)
    const order = objects().map((each) => [each.id, each.parentId])
    expect(order.slice(0, 2)).toEqual([['g', null], ['a', 'g']])
    expect(order[2][1]).toBe('g')
    expect(order[3]).toEqual(['b', 'g'])
    // A free source takes the general method: a square 20 in.
    const copy = objects()[2] as PathObject
    expect(copy.carve).toBeUndefined()
    expect(Math.max(...copy.contours[0].segments.map((segment) => Math.abs(segment.point.x)))).toBeCloseTo(80, 1)
  })

  it('follows its source in the same undo step as the source’s edit, keeping ref 1’s ring 55 thick', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    const depth = undoDepth()
    const grown: PolygonSpec = { ...(object(id).carve as PolygonSpec), radius: 263.4, center: { x: 12, y: -8 } }
    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: id, carve: grown }] })
    expect(undoDepth()).toBe(depth + 1)
    const copy = object(copyId).carve as PolygonSpec
    expect(Math.abs(polygonApothem(grown) - polygonApothem(copy) - 55)).toBeLessThanOrEqual(0.01)
    expect(copy).toMatchObject({ center: { x: 12, y: -8 }, cornerRadius: 5 })
    useLogoStore.getState().undoVectorCommand()
    expect((object(copyId).carve as PolygonSpec).radius).toBeCloseTo(200 - 55 / Math.cos(Math.PI / 6), 2)
  })

  it('sets the distance as one undo step, its name following, and detaches as another', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    const depth = undoDepth()
    useLogoStore.getState().setOffsetDistance(copyId, -30)
    expect(undoDepth()).toBe(depth + 1)
    expect(object(copyId)).toMatchObject({ name: 'Inset \u221230', link: { distance: -30 }, carve: { cornerRadius: 30 } })
    useLogoStore.getState().setOffsetDistance(copyId, -30)
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().detachOffsets([copyId])
    expect(undoDepth()).toBe(depth + 2)
    const detached = object(copyId)
    expect(detached.link).toBeUndefined()
    expect(detached.carve).toMatchObject({ cornerRadius: 30 })
    // Detached, it stays put when the hexagon grows.
    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: id, carve: { ...(object(id).carve as PolygonSpec), radius: 300 } }] })
    expect(object(copyId)).toBe(detached)
  })

  it('joins a burst of arrow keys on the distance into one undo step, which undo takes back whole', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    const depth = undoDepth()
    useLogoStore.getState().setOffsetDistance(copyId, -54, 'offset-distance')
    useLogoStore.getState().setOffsetDistance(copyId, -53, 'offset-distance')
    useLogoStore.getState().setOffsetDistance(copyId, -52, 'offset-distance')
    expect(undoDepth()).toBe(depth + 1)
    expect(object(copyId).link).toMatchObject({ distance: -52 })
    // A release of the pointer is a step of its own.
    useLogoStore.getState().setOffsetDistance(copyId, -40)
    expect(undoDepth()).toBe(depth + 2)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().undoVectorCommand()
    expect(object(copyId).link).toMatchObject({ distance: -55 })
  })

  it('detaches, keeping its geometry, when its source is deleted, in the same undo step, and undo brings both back', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copy = objects()[1] as PathObject
    const depth = undoDepth()
    useLogoStore.getState().deleteIllustratorLayers([id])
    expect(undoDepth()).toBe(depth + 1)
    expect(objects()).toHaveLength(1)
    expect((objects()[0] as PathObject).link).toBeUndefined()
    expect((objects()[0] as PathObject).carve).toEqual(copy.carve)
    useLogoStore.getState().undoVectorCommand()
    expect(object(copy.id)).toBe(copy)
  })

  it('follows, still linked, when a box edit scales it with its source: the source scales and the ring stays 55 thick', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copy = object(objects()[1].id)
    const scaled = (spec: PolygonSpec): PolygonSpec => ({ ...spec, radius: spec.radius * 1.5, cornerRadius: spec.cornerRadius * 1.5 })
    useLogoStore.getState().commitLayerEdits({
      label: 'Resize shapes',
      edits: [
        { layerId: id, carve: scaled(object(id).carve as PolygonSpec) },
        { layerId: copy.id, carve: scaled(copy.carve as PolygonSpec) },
      ],
    })
    const after = object(copy.id)
    expect(after.link).toEqual(copy.link)
    expect(Math.abs(polygonApothem(object(id).carve as PolygonSpec) - polygonApothem(after.carve as PolygonSpec) - 55)).toBeLessThanOrEqual(0.01)
    expect(after.carve).toMatchObject({ cornerRadius: 35 })
  })

  it('stops following when its own recipe or its points are edited, or a layer view gives it new geometry', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copy = objects()[1] as PathObject
    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: copy.id, carve: { ...(copy.carve as PolygonSpec), radius: 100 } }] })
    expect(object(copy.id).link).toBeUndefined()
    expect((object(copy.id).carve as PolygonSpec).radius).toBe(100)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().commitLayerEdits({ label: 'Move point', edits: [{ layerId: copy.id, pathData: 'M0,0L50,0L0,50Z' }] })
    expect(object(copy.id).link).toBeUndefined()
    useLogoStore.getState().undoVectorCommand()
    // Renamed, hidden or made to add, it still follows.
    useLogoStore.getState().setIllustratorLayerOperation(copy.id, 'add')
    useLogoStore.getState().toggleIllustratorLayerVisibility(copy.id)
    expect(object(copy.id).link).toEqual(copy.link)
  })

  it('names a copy that stops following as a new layer of its kind, unless it was named by hand', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    useLogoStore.getState().detachOffsets([copyId])
    expect(object(copyId).name).toBe('Polygon · 6')
    useLogoStore.getState().undoVectorCommand()
    expect(object(copyId).name).toBe('Inset −55')
    // Its source deleted, or its own recipe edited, the same.
    useLogoStore.getState().deleteIllustratorLayers([id])
    expect(object(copyId).name).toBe('Polygon · 6')
    expect(object(copyId).link).toBeUndefined()
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().commitLayerEdits({ label: 'Resize', edits: [{ layerId: copyId, carve: { ...(object(copyId).carve as PolygonSpec), radius: 100 } }] })
    expect(object(copyId).name).toBe('Polygon · 6')
    useLogoStore.getState().undoVectorCommand()
    // A copy of the copy follows nothing, and is named so.
    useLogoStore.getState().duplicateIllustratorLayer(copyId)
    expect(objects()[2].name).toBe('Polygon · 6')
    expect((objects()[2] as PathObject).link).toBeUndefined()
    useLogoStore.getState().undoVectorCommand()
    // A free copy takes the next shape name; a name given by hand stays.
    useLogoStore.getState().commitLayerEdits({ label: 'Move point', edits: [{ layerId: copyId, pathData: 'M0,0L50,0L0,50Z' }] })
    expect(object(copyId).name).toMatch(/^Shape \d+$/)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().updateIllustratorLayer(copyId, { name: 'Rim' })
    useLogoStore.getState().detachOffsets([copyId])
    expect(object(copyId).name).toBe('Rim')
  })

  it('opens a saved mark with its copies as stored, not made again from their sources', () => {
    const corner = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
    const square = (r: number) => ({ closed: true, segments: [corner(-r, -r), corner(r, -r), corner(r, r), corner(-r, r)] })
    const document = {
      ...useLogoStore.getState().vectorDocument,
      objects: [
        { id: 'a', name: 'a', parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours: [square(150)], fillRule: 'evenodd' },
        { id: 'c', name: 'Inset −25', parentId: null, visible: true, locked: false, type: 'path', operation: 'subtract', contours: [square(10)], fillRule: 'evenodd', link: { kind: 'offset', of: 'a', distance: -25 } },
      ],
    } as VectorDocument
    const { params } = useLogoStore.getState()
    useLogoStore.getState().openSaved(JSON.parse(JSON.stringify(createSavedVariation(document, params))))
    expect(object('c').contours).toEqual([square(10)])
    expect(object('c').link).toEqual({ kind: 'offset', of: 'a', distance: -25 })
    // The next edit of its source makes it again.
    useLogoStore.getState().commitLayerEdits({ label: 'Move point', edits: [{ layerId: 'a', pathData: 'M-160,-150L150,-150L150,150L-150,150Z' }] })
    expect(Math.max(...object('c').contours[0].segments.map((segment) => segment.point.x))).toBeCloseTo(125, 1)
  })

  it('keeps a pin and guides on a copy while its distance leaves nothing, and they follow it when it comes back', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }, copyId)
    const punchId = useLogoStore.getState().illustrator.selectedLayerIds[0]
    useLogoStore.getState().addConstructionGuides([copyId])
    const onCopy = () => useLogoStore.getState().vectorDocument.guides.filter((guide) => guide.link?.of === copyId)
    const count = onCopy().length
    expect(count).toBeGreaterThan(0)
    useLogoStore.getState().setOffsetDistance(copyId, -199)
    expect(object(copyId).contours).toEqual([])
    expect(object(copyId).link).toMatchObject({ distance: -199 })
    expect(object(punchId).pin).toEqual({ centreOf: copyId })
    expect(onCopy()).toHaveLength(count)
    // The hexagon moves while the copy is empty: the punch waits, and joins the copy when it comes back.
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: id, carve: translateCarve(object(id).carve!, { x: 50, y: 0 }) }] })
    expect(object(punchId).carve).toMatchObject({ center: { x: 0, y: 0 } })
    useLogoStore.getState().setOffsetDistance(copyId, -55)
    expect(object(copyId).carve).toMatchObject({ center: { x: 50, y: 0 } })
    expect(object(punchId).pin).toEqual({ centreOf: copyId })
    expect(object(punchId).carve).toMatchObject({ center: { x: 50, y: 0 } })
    expect(onCopy()).toHaveLength(count)
    expect(onCopy().map((guide) => guide.shape)).toEqual(constructionLines(object(copyId)).map((line) => line.shape))
  })

  it('lets a recipe pinned to an empty copy go when its own edit moves it, as from any copy, and keeps it through one that does not', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }, copyId)
    const punchId = useLogoStore.getState().illustrator.selectedLayerIds[0]
    useLogoStore.getState().setOffsetDistance(copyId, -199)
    // A new radius leaves the punch where it is: it keeps waiting.
    useLogoStore.getState().commitLayerEdits({ label: 'Radius', edits: [{ layerId: punchId, carve: { ...(object(punchId).carve as PunchSpec), radius: 14 } }] })
    expect(object(punchId).pin).toEqual({ centreOf: copyId })
    // Nudged, as the arrow keys write it, with no word on its pin: it lets go.
    for (let i = 0; i < 3; i++) {
      useLogoStore.getState().commitLayerEdits({ label: 'Nudge', edits: [{ layerId: punchId, carve: translateCarve(object(punchId).carve!, { x: 10, y: 0 }) }], merge: 'nudge' })
    }
    expect(object(punchId).pin).toBeUndefined()
    expect(object(punchId).carve).toMatchObject({ center: { x: 30, y: 0 } })
    // The copy comes back, and the punch stays where it was put.
    useLogoStore.getState().setOffsetDistance(copyId, -55)
    expect(object(punchId).pin).toBeUndefined()
    expect(object(punchId).carve).toMatchObject({ center: { x: 30, y: 0 } })
  })

  it('makes no copy of an empty copy, as Detach keeps none: it has no geometry to copy', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    useLogoStore.getState().setOffsetDistance(copyId, -199)
    const depth = undoDepth()
    useLogoStore.getState().duplicateIllustratorLayer(copyId)
    expect(undoDepth()).toBe(depth)
    expect(objects().map((each) => each.id)).toEqual([id, copyId])
    // Back at a distance that leaves something, it copies as any copy does: whole, and following nothing.
    useLogoStore.getState().setOffsetDistance(copyId, -55)
    useLogoStore.getState().duplicateIllustratorLayer(copyId)
    const [, , duplicate] = objects()
    expect(duplicate.type === 'path' && duplicate.contours.length).toBeGreaterThan(0)
    expect(duplicate.type === 'path' && duplicate.link).toBeUndefined()
  })

  it('takes an empty copy away with its source, and the pin on it goes as a pin on any deleted shape does', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }, copyId)
    const punchId = useLogoStore.getState().illustrator.selectedLayerIds[0]
    useLogoStore.getState().setOffsetDistance(copyId, -199)
    // Detach waits: an empty copy has nothing to keep.
    const depth = undoDepth()
    useLogoStore.getState().detachOffsets([copyId])
    expect(undoDepth()).toBe(depth)
    expect(object(copyId).link).toMatchObject({ kind: 'offset', of: id })
    useLogoStore.getState().setSelection([id, copyId])
    const before = objects()
    useLogoStore.getState().deleteIllustratorLayers([id])
    expect(objects().map((each) => each.id)).toEqual([punchId])
    expect(object(punchId).pin).toBeUndefined()
    expect(pinsLostWithTarget(before, objects())).toEqual([punchId])
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([])
    // One undo step brings all three back, the pin too.
    useLogoStore.getState().undoVectorCommand()
    expect(objects().map((each) => each.id)).toEqual(before.map((each) => each.id))
    expect(object(punchId).pin).toEqual({ centreOf: copyId })
  })

  it('steps the sides of the polygon a selected copy follows, and the copy follows it', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    const depth = undoDepth()
    useLogoStore.getState().stepPolygonSides(1)
    expect(undoDepth()).toBe(depth + 1)
    expect((object(id).carve as PolygonSpec).sides).toBe(7)
    expect((object(copyId).carve as PolygonSpec).sides).toBe(7)
    expect(object(copyId).link).toMatchObject({ of: id, distance: -55 })
    expect(useLogoStore.getState().ui.carve.polygonSides).toBe(7)
  })

  it('steps nothing with a copy of anything but a polygon selected, not even the next polygon’s sides', () => {
    useLogoStore.getState().addSlab('rounded')
    const id = objects()[0].id
    useLogoStore.getState().addOffset(id, 12, false)
    const copyId = objects()[1].id
    useLogoStore.getState().setSelection([copyId])
    const depth = undoDepth()
    const sides = useLogoStore.getState().ui.carve.polygonSides
    useLogoStore.getState().stepPolygonSides(1)
    expect(undoDepth()).toBe(depth)
    expect(useLogoStore.getState().ui.carve.polygonSides).toBe(sides)
  })

  it('keeps a punch pinned to the copy pinned when select all and an arrow move it with the hexagon', () => {
    const id = hexagon()
    useLogoStore.getState().addOffset(id, -55, true)
    const copyId = objects()[1].id
    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }, copyId)
    const punchId = useLogoStore.getState().illustrator.selectedLayerIds[0]
    expect(object(punchId).pin).toEqual({ centreOf: copyId })
    // A nudge of all three moves the hexagon (for the copy) and the punch, as one commit.
    const by = { x: 1, y: 0 }
    useLogoStore.getState().commitLayerEdits({
      label: 'Move shapes',
      edits: [id, punchId].map((each) => ({ layerId: each, carve: translateCarve(object(each).carve!, by) })),
      select: [id, copyId, punchId],
      merge: 'nudge',
    })
    expect(object(copyId).carve).toMatchObject({ center: by })
    expect(object(punchId).carve).toMatchObject({ center: by })
    expect(object(punchId).pin).toEqual({ centreOf: copyId })
  })
})

describe('bands', () => {
  beforeEach(() => reset())

  const object = (id: string) => objects().find((each) => each.id === id) as PathObject

  /** Circle slabs at the given centres and radii: their ids, bottom first. */
  function circles(...list: Array<[number, number, number]>): string[] {
    return list.map(([x, y, r]) => {
      useLogoStore.getState().addSlab('circle')
      const id = objects().at(-1)!.id
      const carve: SlabSpec = { ...(object(id).carve as SlabSpec), center: { x, y }, width: 2 * r, height: 2 * r, radius: r }
      useLogoStore.getState().commitLayerEdits({ label: 'Place', edits: [{ layerId: id, carve }] })
      return id
    })
  }

  it("adds ref 4's strip as one undo step, directly above the higher circle, selected, the tool's fit and setting in it", () => {
    const [a, other, c] = circles([-150, -100, 100], [200, 200, 30], [-125, 111, 65])
    useLogoStore.getState().setBandSettings({ fit: 'strip', angle: 60 })
    const depth = undoDepth()
    useLogoStore.getState().addBand(c, a)
    expect(undoDepth()).toBe(depth + 1)
    const ids = objects().map((each) => each.id)
    const band = objects()[3] as PathObject
    expect(ids).toEqual([a, other, c, band.id])
    expect(band).toMatchObject({ name: 'Band · strip', operation: 'add', link: { kind: 'band', a: c, b: a }, carve: { kind: 'band', fit: 'strip', angle: 60 } })
    expect(useLogoStore.getState().illustrator.selectedLayerIds).toEqual([band.id])
    // Picked from C, the strip's first edge would fall on C's other side, where it has no fit: it takes the side that fits.
    expect(band.carve).toMatchObject({ side: -1 })
    expect(band.contours).toHaveLength(1)
    expect(describeCarve(band.carve!)).toBe('Band · strip · 60° · 81 wide')
    // Turned half round it is the same strip: its side is up to its circles, so nothing changes.
    useLogoStore.getState().setBand(band.id, { angle: 240 })
    expect(object(band.id)).toBe(band)
    expect(undoDepth()).toBe(depth + 1)
    // Flat, these circles allow it none: refused, as its controls never empty a band.
    useLogoStore.getState().setBand(band.id, { angle: 0 })
    expect(object(band.id)).toBe(band)
    expect(undoDepth()).toBe(depth + 1)
    useLogoStore.getState().undoVectorCommand()
    expect(objects()).toHaveLength(3)
  })

  it('cuts when both circles cut, joins a circle guide, and makes nothing from one circle or no circle', () => {
    const [a, b] = circles([-150, 0, 60], [150, 0, 60])
    useLogoStore.getState().setIllustratorLayerOperation(a, 'subtract')
    useLogoStore.getState().setIllustratorLayerOperation(b, 'subtract')
    useLogoStore.getState().addBand(a, b)
    expect(objects().at(-1)).toMatchObject({ operation: 'subtract', name: 'Band · bar' })
    useLogoStore.getState().addGuides([{ kind: 'circle', c: { x: 0, y: 200 }, r: 40 }])
    const guide = useLogoStore.getState().vectorDocument.guides[0].id
    useLogoStore.getState().addBand(guide, a)
    // Directly above its one circle that is a shape: under the first band, which sits above b.
    expect(objects()[1]).toMatchObject({ operation: 'add', link: { kind: 'band', a: guide, b: a } })
    const count = objects().length
    useLogoStore.getState().addBand(a, a)
    useLogoStore.getState().addBand(a, objects().at(-1)!.id)
    expect(objects()).toHaveLength(count)
  })

  it('follows a circle moved as one undo step with it, and a fit or setting is one step, a burst of keys one too', () => {
    const [a, b] = circles([-150, 0, 60], [150, 0, 60])
    useLogoStore.getState().addBand(a, b)
    const band = objects().at(-1)!.id
    const depth = undoDepth()
    const moved = translateCarve(object(b).carve!, { x: 20, y: 30 })
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: b, carve: moved }] })
    expect(undoDepth()).toBe(depth + 1)
    expect(object(band).carve).toMatchObject({ b: { c: { x: 170, y: 30 } } })
    useLogoStore.getState().undoVectorCommand()
    expect(object(band).carve).toMatchObject({ b: { c: { x: 150, y: 0 } } })
    // A neck of 30, the tool's, cannot reach across 300 and keep a waist: switched to, it takes the nearest radius that can.
    useLogoStore.getState().setBand(band, { fit: 'neck' })
    expect(object(band)).toMatchObject({ name: 'Band · neck', carve: { fit: 'neck', radius: 158 } })
    // A setting it allows none is refused: of 30 it would empty. Of 170 it can, and keeps a waist.
    const unchanged = object(band)
    useLogoStore.getState().setBand(band, { radius: 30 })
    expect(object(band)).toBe(unchanged)
    useLogoStore.getState().setBand(band, { fit: 'neck', radius: 170 })
    expect(object(band)).toMatchObject({ name: 'Band · neck', carve: { fit: 'neck', radius: 170 } })
    const before = undoDepth()
    useLogoStore.getState().setBand(band, { radius: 171 }, 'band-setting')
    useLogoStore.getState().setBand(band, { radius: 172 }, 'band-setting')
    expect(undoDepth()).toBe(before + 1)
    expect(object(band).carve).toMatchObject({ radius: 172 })
  })

  it('is detached by deleting a circle, in the same undo step, and undo restores both', () => {
    const [a, b] = circles([-150, 0, 60], [150, 0, 60])
    useLogoStore.getState().addBand(a, b)
    const band = objects().at(-1) as PathObject
    useLogoStore.getState().deleteIllustratorLayers([b])
    expect(object(band.id).link).toBeUndefined()
    expect(object(band.id).contours).toBe(band.contours)
    useLogoStore.getState().undoVectorCommand()
    expect(object(band.id)).toBe(band)
    expect(object(b)).toBeDefined()
  })

  it('is not made where its circles allow no fit; empties while they allow none, keeps its link, and Detach waits for it', () => {
    const [a, b] = circles([0, 0, 100], [20, 0, 30])
    useLogoStore.getState().setBandSettings({ fit: 'belt' })
    const count = objects().length
    useLogoStore.getState().addBand(a, b)
    expect(objects()).toHaveLength(count)
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: b, carve: translateCarve(object(b).carve!, { x: 200, y: 0 }) }] })
    useLogoStore.getState().addBand(a, b)
    const band = objects().at(-1)!.id
    expect(object(band).contours).toHaveLength(1)
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: b, carve: translateCarve(object(b).carve!, { x: -200, y: 0 }) }] })
    expect(object(band).contours).toEqual([])
    expect(object(band).link).toEqual({ kind: 'band', a, b })
    useLogoStore.getState().detachBands([band])
    expect(object(band).link).toBeDefined()
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: b, carve: translateCarve(object(b).carve!, { x: 200, y: 0 }) }] })
    expect(object(band).contours).toHaveLength(1)
    useLogoStore.getState().detachBands([band])
    expect(object(band).link).toBeUndefined()
    expect(object(band).carve?.kind).toBe('band')
  })

  it('waits, empty and linked, through a box or key edit of its own: nothing is written and no step is made, and it comes back with its circles', () => {
    const [a, b, other] = circles([0, 0, 80], [200, 0, 80], [400, 400, 30])
    useLogoStore.getState().setBandSettings({ fit: 'bar' })
    useLogoStore.getState().addBand(a, b)
    const band = objects().find((each) => each.type === 'path' && each.carve?.kind === 'band')!.id
    const moveB = (x: number) =>
      useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: b, carve: translateCarve(object(b).carve!, { x, y: 0 }) }] })
    moveB(-200)
    expect(object(band).contours).toEqual([])
    const waiting = object(band)
    const depth = undoDepth()
    // What Alt with an arrow would write to it alone: turned about its middle.
    const turned = { layerId: band, carve: rotateCarveAbout(object(band).carve!, { x: 0, y: 0 }, 1) }
    useLogoStore.getState().commitLayerEdits({ label: 'Turn', edits: [turned] })
    expect(undoDepth()).toBe(depth)
    expect(object(band)).toBe(waiting)
    // Boxed with a shape it does not follow, the shape is edited and the band waits.
    const shifted = { layerId: other, carve: translateCarve(object(other).carve!, { x: 10, y: 0 }) }
    useLogoStore.getState().commitLayerEdits({ label: 'Turn', edits: [turned, shifted] })
    expect(undoDepth()).toBe(depth + 1)
    expect((object(other).carve as SlabSpec).center).toEqual({ x: 410, y: 400 })
    expect(object(band)).toBe(waiting)
    // It keeps its recipe through a reload, and comes back when its circles allow it.
    expect(readable(sanitizeVectorDocument(useLogoStore.getState().vectorDocument)).objects.some((each) => each.id === band)).toBe(true)
    moveB(200)
    expect(object(band).contours).toHaveLength(1)
    expect(object(band).link).toEqual({ kind: 'band', a, b })
  })

  it('edited with its circles by a box follows them; edited alone, it is detached', () => {
    const [a, b] = circles([-150, 0, 60], [150, 0, 60])
    useLogoStore.getState().addBand(a, b)
    const band = objects().at(-1)!.id
    const shift = (id: string) => ({ layerId: id, carve: translateCarve(object(id).carve!, { x: 0, y: 40 }) })
    useLogoStore.getState().commitLayerEdits({ label: 'Box', edits: [shift(a), shift(b), shift(band)] })
    expect(object(band).link).toBeDefined()
    expect(object(band).carve).toMatchObject({ a: { c: { y: 40 } }, b: { c: { y: 40 } } })
    useLogoStore.getState().commitLayerEdits({ label: 'Box', edits: [shift(band)] })
    expect(object(band).link).toBeUndefined()
  })

  it('turned or scaled whole by a box with both its circles, takes the turn into its angle and the scale into its width or radius', () => {
    // Ref 4's A and C, and their strip: turned 15° about their middle, as a box around all three turns them.
    const [a, c] = circles([-77, -88, 100], [-52, 123, 65])
    useLogoStore.getState().setBandSettings({ fit: 'strip', angle: 60 })
    useLogoStore.getState().addBand(a, c)
    const strip = objects().at(-1)!.id
    const width = describeCarve(object(strip).carve!)
    const middle = { x: -64.5, y: 17.5 }
    const turn = (id: string) => ({ layerId: id, carve: rotateCarveAbout(object(id).carve!, middle, 15) })
    useLogoStore.getState().commitLayerEdits({ label: 'Rotate shapes', edits: [turn(a), turn(c), turn(strip)] })
    expect(object(strip).link).toEqual({ kind: 'band', a, b: c })
    expect(object(strip).carve).toMatchObject({ angle: 75 })
    expect(describeCarve(object(strip).carve!)).toBe(width.replace('60°', '75°'))
    // Ref 2's right and bottom circles and their neck of 38, scaled twice as large.
    reset()
    const towards = { x: -136 / Math.hypot(136, 200), y: 200 / Math.hypot(136, 200) }
    const gap = 91 + 110 + 40.9
    const [right, low] = circles([143, -110, 91], [143 + towards.x * gap, -110 + towards.y * gap, 110])
    useLogoStore.getState().setBandSettings({ fit: 'neck', radius: 38 })
    useLogoStore.getState().addBand(right, low)
    const neck = objects().at(-1)!.id
    const grow = (id: string) => ({ layerId: id, carve: scaleCarveAbout(object(id).carve!, { x: 0, y: 0 }, 2) })
    useLogoStore.getState().commitLayerEdits({ label: 'Resize shapes', edits: [grow(right), grow(low), grow(neck)] })
    expect(object(neck).link).toEqual({ kind: 'band', a: right, b: low })
    expect(object(neck).carve).toMatchObject({ radius: 76 })
    expect((object(neck).carve as BandSpec).a.r).toBe(182)
    expect(object(neck).contours).toHaveLength(1)
  })

  it('keeps its link through a link of the document, and through a saved mark', () => {
    const [a, b] = circles([-150, 0, 60], [150, 0, 60])
    useLogoStore.getState().addBand(a, b)
    const document = useLogoStore.getState().vectorDocument
    const decoded = decodeLink(encodeLink(document, '#000000'))
    expect(decoded.kind === 'vector' && decoded.document.objects).toEqual(document.objects)
  })
})

describe('groups in the store', () => {
  beforeEach(() => reset())

  const corner = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
  const square = (cx: number, cy: number, h: number) => ({
    closed: true,
    segments: [corner(cx - h, cy - h), corner(cx + h, cy - h), corner(cx + h, cy + h), corner(cx - h, cy + h)],
  })
  const path = (id: string, cx: number, cy: number, h: number, extra: Partial<PathObject> = {}): PathObject => ({
    id, name: id, parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours: [square(cx, cy, h)], fillRule: 'evenodd', ...extra,
  })
  const group = (id: string, extra: Partial<VectorObject> = {}): VectorObject =>
    ({ id, name: id, parentId: null, visible: true, locked: false, type: 'group', isolated: false, operation: 'add', ...extra }) as VectorObject
  const open = (list: VectorObject[]) => useLogoStore.getState().setVectorDocument({ ...useLogoStore.getState().vectorDocument, objects: list })
  const order = () => objects().map((object) => object.id)
  const roots = () => useLogoStore.getState().illustrator.selectedRootIds
  const leaves = () => useLogoStore.getState().illustrator.selectedLayerIds
  const entered = () => useLogoStore.getState().illustrator.enteredGroupId ?? null

  it('groups the selection with Cmd+G as one undo step, selected, and ungroups it back', () => {
    open([path('a', -100, 0, 50), path('x', 0, 300, 20), path('b', 100, 0, 50)])
    useLogoStore.getState().setSelection(['a', 'b'])
    useLogoStore.getState().groupSelection()
    const made = objects().find((object) => object.type === 'group')!
    expect(made).toMatchObject({ name: 'Group 1', isolated: false, operation: 'add' })
    expect(order()).toEqual(['x', made.id, 'a', 'b'])
    expect(roots()).toEqual([made.id])
    expect(leaves()).toEqual(['a', 'b'])
    expect(undoDepth()).toBe(1)

    useLogoStore.getState().ungroupSelection()
    expect(order()).toEqual(['x', 'a', 'b'])
    expect(roots()).toEqual(['a', 'b'])
    expect(undoDepth()).toBe(2)

    useLogoStore.getState().undoVectorCommand()
    expect(roots()).toEqual([made.id])
    useLogoStore.getState().undoVectorCommand()
    expect(order()).toEqual(['a', 'x', 'b'])
    expect(roots()).toEqual(['a', 'b'])
  })

  it('refuses Cmd+G with a cut between that gathering would let change the mark, and says which', () => {
    open([path('a', -100, 0, 50), path('cut', -100, 0, 20, { operation: 'subtract' }), path('b', 100, 0, 50)])
    useLogoStore.getState().setSelection(['a', 'b'])
    expect(groupRefusalOf(useLogoStore.getState())).toEqual({ words: 'Cut 02 lies between them', blocker: 'cut' })
    const before = objects()
    useLogoStore.getState().groupSelection()
    expect(objects()).toBe(before)
    expect(undoDepth()).toBe(0)
    useLogoStore.getState().setSelection(['a'])
    expect(groupRefusalOf(useLogoStore.getState())).toEqual({ words: 'Select two or more to group', blocker: null })
  })

  it('refuses to ungroup an isolated group whose cuts would reach what lies below, leaving the mark as it was', () => {
    open([path('below', 0, 0, 100), group('g', { isolated: true }), path('a', 200, 0, 50, { parentId: 'g' }), path('cut', 60, 0, 60, { parentId: 'g', operation: 'subtract' })])
    const area = markArea()
    useLogoStore.getState().setSelection(['g'])
    expect(ungroupRefusalOf(useLogoStore.getState())).toEqual({ words: 'Its cuts would reach Shape 01', blocker: 'below' })
    const before = objects()
    useLogoStore.getState().ungroupSelection()
    expect(objects()).toBe(before)
    expect(undoDepth()).toBe(0)
    expect(markArea()).toBeCloseTo(area, 3)
  })

  it('refuses to ungroup an isolated group that cuts as one, which would turn its pieces to ink', () => {
    open([path('below', 0, 0, 100), group('g', { isolated: true, operation: 'subtract' }), path('a', 0, 0, 50, { parentId: 'g' })])
    const area = markArea()
    useLogoStore.getState().setSelection(['g'])
    expect(ungroupRefusalOf(useLogoStore.getState())?.words).toBe('Group 02 cuts as one: set it to Add first')
    useLogoStore.getState().ungroupSelection()
    expect(undoDepth()).toBe(0)
    expect(markArea()).toBeCloseTo(area, 3)
  })

  it('ungroups a hidden group with its pieces hidden, shared or isolated, leaving the mark as it was', () => {
    for (const isolated of [false, true]) {
      open([path('below', 0, 0, 100), group('g', { isolated, visible: false }), path('a', 300, 0, 50, { parentId: 'g' })])
      const area = markArea()
      useLogoStore.getState().setSelection(['g'])
      expect(ungroupRefusalOf(useLogoStore.getState())).toBeNull()
      useLogoStore.getState().ungroupSelection()
      expect(objects().map((object) => [object.id, object.visible])).toEqual([['below', true], ['a', false]])
      expect(markArea()).toBeCloseTo(area, 3)
    }
  })

  it('refuses to ungroup a locked group, keeping its pieces held, and says to unlock it first', () => {
    open([group('g', { locked: true }), path('a', -100, 0, 50, { parentId: 'g' }), path('b', 100, 0, 50, { parentId: 'g' })])
    useLogoStore.getState().setSelection(['g'])
    expect(ungroupRefusalOf(useLogoStore.getState())).toEqual({ words: 'Group 01 is locked: unlock it first', blocker: null })
    const before = objects()
    useLogoStore.getState().ungroupSelection()
    expect(objects()).toBe(before)
    expect(undoDepth()).toBe(0)
  })

  it('steps no polygon in a locked or a hidden group', () => {
    for (const held of [{ locked: true }, { visible: false }]) {
      reset()
      useLogoStore.getState().addSlab('polygon')
      const polygon = objects()[0]
      open([group('g', held), { ...polygon, parentId: 'g' }])
      const depth = undoDepth()
      useLogoStore.getState().setSelection(['g'])
      useLogoStore.getState().stepPolygonSides(1)
      expect(objects()[1]).toEqual({ ...polygon, parentId: 'g' })
      useLogoStore.getState().setSelection([polygon.id])
      useLogoStore.getState().stepPolygonSides(1)
      expect((objects()[1] as PathObject).carve).toEqual((polygon as PathObject).carve)
      expect(undoDepth()).toBe(depth)
    }
  })

  it('isolates a group’s cuts as one undo step', () => {
    open([path('left', -150, 0, 100), group('g'), path('right', 150, 0, 100, { parentId: 'g' }), path('cut', 0, 0, 120, { parentId: 'g', operation: 'subtract' })])
    const shared = markArea()
    useLogoStore.getState().setGroupIsolated('g', true)
    expect(undoDepth()).toBe(1)
    expect(markArea()).toBeGreaterThan(shared + 1000)
    useLogoStore.getState().setGroupIsolated('g', true)
    expect(undoDepth()).toBe(1)
    useLogoStore.getState().undoVectorCommand()
    expect(markArea()).toBeCloseTo(shared, 3)
  })

  it('keeps a group selected through a move of its layers, and undo brings the group selection back', () => {
    open([group('g'), path('a', 0, 0, 50, { parentId: 'g' }), path('b', 100, 0, 50, { parentId: 'g' })])
    useLogoStore.getState().setSelection(['g'])
    useLogoStore.getState().commitLayerEdits({
      label: 'Move shapes',
      edits: [
        { layerId: 'a', pathData: 'M10,10L20,10L20,20Z' },
        { layerId: 'b', pathData: 'M30,30L40,30L40,40Z' },
      ],
      select: ['a', 'b'],
    })
    expect(roots()).toEqual(['g'])
    useLogoStore.getState().commitLayerEdits({ label: 'Rotate', edits: [{ layerId: 'g', frameRotation: 30 }] })
    expect(objects()[0]).toMatchObject({ type: 'group', frame: { rotation: 30 } })
    expect(useLogoStore.getState().illustrator.groups?.[0].frameRotation).toBe(30)
    useLogoStore.getState().setSelection([])
    useLogoStore.getState().undoVectorCommand()
    expect(roots()).toEqual(['g'])
  })

  it('enters a group when a piece in it is selected, and a group selected alone enters none', () => {
    open([group('g'), path('a', 0, 0, 50, { parentId: 'g' }), path('b', 100, 0, 50, { parentId: 'g' }), path('c', 300, 0, 20)])
    useLogoStore.getState().setSelection(['a'])
    expect(entered()).toBe('g')
    expect(leaves()).toEqual(['a'])
    useLogoStore.getState().setSelection(['g'])
    expect(entered()).toBeNull()
    useLogoStore.getState().selectIllustratorLayer('b')
    expect(entered()).toBe('g')
  })

  it('deletes a group with everything in it, and detaches what followed its members', () => {
    open([group('g'), path('a', 0, 0, 50, { parentId: 'g' }), path('b', 100, 0, 50, { parentId: 'g' }), path('ring', 0, 0, 10, { link: { kind: 'offset', of: 'a', distance: 5 } })])
    const ring = objects().at(-1) as PathObject
    useLogoStore.getState().setSelection(['g'])
    useLogoStore.getState().deleteIllustratorLayers()
    expect(order()).toEqual(['ring'])
    const kept = objects()[0] as PathObject
    expect(kept.link).toBeUndefined()
    expect(kept.contours).toEqual(ring.contours)
    expect(roots()).toEqual([])
    useLogoStore.getState().undoVectorCommand()
    expect(order()).toEqual(['g', 'a', 'b', 'ring'])
    expect(objects().at(-1)).toBe(ring)
    expect(roots()).toEqual(['g'])
  })

  it('copies a group whole, its band between its own circles following the copies', () => {
    useLogoStore.getState().addSlab('circle')
    const first = objects()[0] as PathObject
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: first.id, carve: translateCarve(first.carve!, { x: -150, y: 0 }) }] })
    useLogoStore.getState().addSlab('circle')
    const second = objects()[1] as PathObject
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: second.id, carve: translateCarve(second.carve!, { x: 150 - (second.carve as SlabSpec).center.x, y: -(second.carve as SlabSpec).center.y }) }] })
    useLogoStore.getState().addBand(first.id, second.id)
    useLogoStore.getState().setSelection(objects().map((object) => object.id))
    useLogoStore.getState().groupSelection()
    const g = objects()[0]
    expect(g.type).toBe('group')
    useLogoStore.getState().duplicateIllustratorLayer(g.id)
    const copies = objects().slice(4)
    expect(copies[0]).toMatchObject({ type: 'group', name: `${g.name} copy` })
    expect(roots()).toEqual([copies[0].id])
    const band = copies.find((object) => object.type === 'path' && object.link?.kind === 'band') as PathObject
    expect(band.link).toEqual({ kind: 'band', a: copies[1].id, b: copies[2].id })
    // The copy's band follows its own circles: moving one changes the copy's band, not the original's.
    const original = objects().find((object) => object.type === 'path' && object.link?.kind === 'band' && object.parentId === g.id) as PathObject
    const circle = copies[1] as PathObject
    useLogoStore.getState().commitLayerEdits({ label: 'Move', edits: [{ layerId: circle.id, carve: translateCarve(circle.carve!, { x: 0, y: 60 }) }] })
    expect(objects().find((object) => object.id === original.id)).toBe(original)
    expect(objects().find((object) => object.id === band.id)).not.toBe(band)
    useLogoStore.getState().undoVectorCommand()
    useLogoStore.getState().undoVectorCommand()
    expect(objects()).toHaveLength(4)
  })
})

describe('groups through links and saved marks', () => {
  beforeEach(() => reset({ width: 1400, height: 1000 }))

  it('keep their members, isolation, operation and turned frame', () => {
    const spark = rollSparks(8, 1).find((rolled) => rolled.shapes.some((shape) => shape.operation === 'subtract'))!
    useLogoStore.getState().dropSpark(spark)
    const [group] = objects()
    useLogoStore.getState().commitLayerEdits({ label: 'Rotate', edits: [{ layerId: group.id, frameRotation: 15 }] })
    useLogoStore.getState().setGroupOperation(group.id, 'subtract')
    const document = useLogoStore.getState().vectorDocument
    const link = decodeLink(encodeLink(document, '#111111'))
    if (link.kind !== 'vector') throw new Error(`decoded as ${link.kind}`)
    expect(link.document.objects).toEqual(document.objects)
    expect(link.document.objects[0]).toMatchObject({ type: 'group', isolated: true, operation: 'subtract', frame: { rotation: 15 } })
    const saved = savedDocument(JSON.parse(JSON.stringify(createSavedVariation(document, useLogoStore.getState().params))))
    expect(saved?.document.objects).toEqual(document.objects)
    expect(composeVectorMark(saved!.document).compoundPathData).toBe(composeVectorMark(document).compoundPathData)
  })
})

describe('sparks as groups', () => {
  beforeEach(() => reset({ width: 1400, height: 1000 }))
  const withCuts = rollSparks(8, 1).find((rolled) => rolled.shapes.some((shape) => shape.operation === 'subtract'))!

  it('drops a spark as one isolated group named after it, below the work there, selected as the group', () => {
    useLogoStore.getState().addSlab('square')
    useLogoStore.getState().dropSpark(withCuts)
    const [group, ...rest] = objects()
    expect(group).toMatchObject({ type: 'group', isolated: true, operation: 'add', parentId: null })
    expect(group.name).toMatch(/^Spark · /)
    expect(rest.slice(0, withCuts.shapes.length).every((object) => object.parentId === group.id)).toBe(true)
    expect((rest.at(-1) as PathObject).carve?.kind).toBe('slab')
    const state = useLogoStore.getState()
    expect(state.illustrator.selectedRootIds).toEqual([group.id])
    expect(state.illustrator.selectedLayerIds).toEqual(rest.slice(0, withCuts.shapes.length).map((object) => object.id))
  })

  it('keeps two sparks from cutting each other', () => {
    useLogoStore.getState().dropSpark(withCuts)
    const alone = markArea()
    useLogoStore.getState().dropSpark(withCuts)
    // Two of the same spark side by side: twice the ink, none of it cut by the other's cuts.
    expect(markArea()).toBeCloseTo(2 * alone, -1)
  })
})
