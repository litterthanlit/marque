import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDLE_LAYOUT } from '../../engine/box/box.ts'
import { carveOutline, outlineBounds } from '../../engine/carve/outline.ts'
import { slabSpec, type CarveSpec } from '../../engine/carve/spec.ts'
import { bakedEditableShape } from '../../engine/illustrator/layerPath.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { rotate } from '../../engine/path/bezier.ts'
import { scaledHandleLayout, selectionBox, selectionHandles, type LiveHandles } from './handleSet.ts'

function recipeLayer(id: string, spec: CarveSpec, operation: 'add' | 'subtract' = 'add'): IllustratorLayer {
  return {
    id,
    name: id,
    operation,
    visible: true,
    locked: false,
    pathData: carveOutline(spec).pathData,
    fillRule: 'evenodd',
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    carve: spec,
  }
}

function freeLayer(id: string, pathData: string, frameRotation?: number): IllustratorLayer {
  return {
    id,
    name: id,
    operation: 'add',
    visible: true,
    locked: false,
    pathData,
    fillRule: 'nonzero',
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...(frameRotation === undefined ? {} : { frameRotation }),
  }
}

/** A 100 × 60 rectangle about (200, 100), turned by `deg`. */
function turnedRectangle(deg: number): string {
  const corners = [
    { x: -50, y: -30 },
    { x: 50, y: -30 },
    { x: 50, y: 30 },
    { x: -50, y: 30 },
  ].map((p) => rotate(p, deg))
  return `M${corners.map((p) => `${200 + p.x},${100 + p.y}`).join('L')}Z`
}

const slab = recipeLayer('slab', slabSpec('square'))
const slice = recipeLayer('slice', { v: 1, kind: 'slice', from: { x: -100, y: -50 }, to: { x: 100, y: 50 }, width: 20 }, 'subtract')
const square = freeLayer('square', 'M-300,-250L-250,-250L-250,-200L-300,-200Z')
const turned = freeLayer('turned', turnedRectangle(30), 30)

function docOf(layers: IllustratorLayer[]): IllustratorDocument {
  return {
    id: 'doc',
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers,
    selectedLayerIds: [],
    pointSelection: null,
    mode: 'object',
  }
}

function handlesFor(selected: string[], layers: IllustratorLayer[] = [slab, slice, square, turned], live: LiveHandles = 'all') {
  return selectionHandles({ ...docOf(layers), selectedLayerIds: selected }, DEFAULT_HANDLE_LAYOUT, bakedEditableShape, live)
}

describe('the handles a selection gets', () => {
  it("keeps a single recipe's own handles", () => {
    const set = handlesFor(['slab'])!
    expect(set.kind).toBe('recipe')
    expect(set.list.map((h) => h.id)).toContain('radius')
    expect(handlesFor(['slice'])!.list.map((h) => h.id)).toEqual(['from', 'to', 'width'])
  })

  it('puts a free shape in a box turned with its frame, measured in that frame', () => {
    const set = handlesFor(['turned'])!
    expect(set.kind).toBe('box')
    expect(set.uniform).toBe(false)
    expect(set.box!.rotation).toBe(30)
    expect(set.box!.width).toBeCloseTo(100, 6)
    expect(set.box!.height).toBeCloseTo(60, 6)
    expect(set.box!.center.x).toBeCloseTo(200, 6)
    expect(set.box!.center.y).toBeCloseTo(100, 6)
    expect(set.list.map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'])
  })

  it('puts several free shapes in one upright box around them all', () => {
    const set = handlesFor(['square', 'turned'])!
    expect(set.kind).toBe('box')
    expect(set.ids).toEqual(['square', 'turned'])
    expect(set.box!.rotation).toBe(0)
    expect(set.box!.center.x - set.box!.width / 2).toBeCloseTo(-300, 6)
    expect(set.box!.center.y - set.box!.height / 2).toBeCloseTo(-250, 6)
    expect(set.list.some((h) => h.id === 'e')).toBe(true)
  })

  it('shows only corners when a recipe is among them, and leaves slices out of the box', () => {
    const set = handlesFor(['slab', 'slice', 'square'])!
    expect(set.uniform).toBe(true)
    expect(set.ids).toEqual(['slab', 'slice', 'square'])
    expect(set.list.map((h) => h.id)).toEqual(['nw', 'ne', 'se', 'sw', 'rotate'])
    // The slab reaches 190 right of the centre; the slice's path reaches thousands past its ends.
    expect(set.box!.center.x + set.box!.width / 2).toBeCloseTo(190, 6)
    expect(set.box!.center.x - set.box!.width / 2).toBeCloseTo(-300, 6)
  })

  it('gives nothing to slices alone, or to hidden and locked layers', () => {
    const otherSlice = recipeLayer('other', { v: 1, kind: 'slice', from: { x: 0, y: -100 }, to: { x: 0, y: 100 }, width: 20 }, 'subtract')
    expect(handlesFor(['slice', 'other'], [slice, otherSlice])).toBeNull()
    expect(handlesFor(['square'], [{ ...square, locked: true }])).toBeNull()
    expect(handlesFor(['slab'], [{ ...slab, visible: false }])).toBeNull()
    expect(handlesFor(['square', 'turned'], [square, { ...turned, locked: true }])!.ids).toEqual(['square'])
  })

  it('keeps a recipe its own handles when the other layers selected with it are hidden or locked', () => {
    const hidden = { ...square, visible: false }
    const sliceSet = handlesFor(['slice', 'square'], [slice, hidden])!
    expect(sliceSet.kind).toBe('recipe')
    expect(sliceSet.list.map((h) => h.id)).toEqual(['from', 'to', 'width'])
    // A slab bent on its right side: its own handles reach round the bulge.
    const bent = recipeLayer('bent', { ...slabSpec('square'), sides: { right: { a1: 0, o1: 80, a2: 0, o2: 80 } } })
    const alone = handlesFor(['bent'], [bent])!
    const withHidden = handlesFor(['bent', 'square'], [bent, { ...square, locked: true }])!
    expect(withHidden.kind).toBe('recipe')
    expect(withHidden.list).toEqual(alone.list)
  })

  it('hides the square of a side shorter than 48 pixels on screen with its padding, yet keeps it on a recipe', () => {
    // 20 units at one unit per pixel, 44 pixels padded: too short for side squares around a free shape.
    const small = freeLayer('small', 'M0,0L20,0L20,60L0,60Z')
    expect(handlesFor(['small'], [small])!.list.map((h) => h.id)).toEqual(['nw', 'ne', 'e', 'se', 'sw', 'w', 'rotate'])
    // At two pixels per unit the same shape is 64 pixels wide padded, and gets them all.
    const doc: IllustratorDocument = { ...docOf([small]), selectedLayerIds: ['small'] }
    expect(selectionHandles(doc, scaledHandleLayout(0.5), bakedEditableShape)!.list).toHaveLength(9)
    const smallSlab = recipeLayer('smallSlab', { ...slabSpec('square'), width: 20, height: 20 })
    expect(handlesFor(['smallSlab'], [smallSlab])!.list.map((h) => h.id)).toContain('e')
  })

  it('measures a bent slab among other layers by its outline, bends included', () => {
    const bent = recipeLayer('bent', { ...slabSpec('square'), sides: { right: { a1: 0, o1: 80, a2: 0, o2: 80 } } })
    const outline = outlineBounds(carveOutline(bent.carve!))
    expect(outline.maxX).toBeGreaterThan(slabSpec('square').width / 2 + 40)
    const set = handlesFor(['bent', 'square'], [bent, square])!
    expect(set.kind).toBe('box')
    expect(set.box!.center.x + set.box!.width / 2).toBeCloseTo(outline.maxX, 6)
    expect(set.box!.center.y - set.box!.height / 2).toBeCloseTo(Math.min(outline.minY, -250), 6)
  })
})

describe('the box around cuts', () => {
  const disc = freeLayer('disc', 'M-100,0A100,100 0 1,1 100,0A100,100 0 1,1 -100,0Z')
  // A cut circle that bites the disc's top and reaches 300 units above it.
  const bite: IllustratorLayer = { ...freeLayer('bite', 'M-200,-200A200,200 0 1,1 200,-200A200,200 0 1,1 -200,-200Z'), operation: 'subtract' }

  it('measures a cut only where it meets the shapes beside it', () => {
    const set = handlesFor(['disc', 'bite'], [disc, bite])!
    expect(set.ids).toEqual(['disc', 'bite'])
    expect(set.box!.center.y - set.box!.height / 2).toBeCloseTo(-100, 6)
    expect(set.box!.center.y + set.box!.height / 2).toBeCloseTo(100, 6)
  })

  it('measures cuts alone against every shape in the document', () => {
    const other: IllustratorLayer = { ...bite, id: 'other' }
    const set = handlesFor(['bite', 'other'], [disc, bite, other])!
    // The bite reaches y -400…0; the disc spans -100…100.
    expect(set.box!.width).toBeCloseTo(200, 6)
    expect(set.box!.center.y - set.box!.height / 2).toBeCloseTo(-100, 6)
    expect(set.box!.center.y + set.box!.height / 2).toBeCloseTo(0, 6)
  })

  it('measures a cut alone, or a cut over nothing, in full', () => {
    expect(handlesFor(['bite'], [disc, bite])!.box!.height).toBeCloseTo(400, 6)
    const far: IllustratorLayer = { ...bite, id: 'far', pathData: 'M1000,1000L1100,1000L1100,1100Z' }
    const set = handlesFor(['disc', 'far'], [disc, far])!
    expect(set.box!.center.x + set.box!.width / 2).toBeCloseTo(1100, 6)
  })
})

describe('the box Alt+arrows turn and scale', () => {
  function boxFor(selected: string[], layers: IllustratorLayer[]) {
    const doc: IllustratorDocument = {
      id: 'doc',
      source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
      layers,
      selectedLayerIds: selected,
      pointSelection: null,
      mode: 'object',
    }
    return selectionBox(doc, bakedEditableShape)
  }

  it("turns a lone punch about its own centre, even where half of it cuts nothing", () => {
    // The slab reaches x = 190: the punch sticks out half its width.
    const punch = recipeLayer('punch', { v: 1, kind: 'punch', shape: 'circle', center: { x: 190, y: 0 }, radius: 60, rotation: 0 }, 'subtract')
    const around = boxFor(['punch'], [slab, punch])!
    expect(around.ids).toEqual(['punch'])
    expect(around.uniform).toBe(true)
    expect(around.box).toEqual({ center: { x: 190, y: 0 }, width: 120, height: 120, rotation: 0 })
  })

  it('turns a lone slab about its own centre, even when a bend pushes its outline off it', () => {
    const spec: CarveSpec = {
      ...slabSpec('square'),
      center: { x: 40, y: -20 },
      sides: { right: { a1: 0, o1: 80, a2: 0, o2: 80 } },
    }
    const outline = outlineBounds(carveOutline(spec))
    expect((outline.minX + outline.maxX) / 2).toBeGreaterThan(60)
    const around = boxFor(['bent'], [recipeLayer('bent', spec)])!
    expect(around.box).toEqual({ center: { x: 40, y: -20 }, width: 380, height: 380, rotation: 0 })
  })

  it('turns a lone groove about the middle of its ends', () => {
    const around = boxFor(['slice'], [slab, slice])!
    expect(around.box.center).toEqual({ x: 0, y: 0 })
    expect(around.box.width).toBeCloseTo(Math.hypot(200, 100), 6)
    expect(around.box.rotation).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI, 6)
  })

  it('measures a lone free cut in full, and several layers as their handles do', () => {
    const disc: IllustratorLayer = { ...freeLayer('disc', 'M-100,0A100,100 0 1,1 100,0A100,100 0 1,1 -100,0Z'), operation: 'subtract' }
    expect(boxFor(['disc'], [slab, disc])!.box.width).toBeCloseTo(200, 6)
    expect(boxFor(['slab', 'square'], [slab, square])!.box).toEqual(handlesFor(['slab', 'square'], [slab, square])!.box)
  })

  it('leaves out a band that waits, empty: alone it has no box, beside a shape the box is the shape\'s', () => {
    const empty: IllustratorLayer = {
      ...recipeLayer('band', { v: 1, kind: 'band', a: { c: { x: 0, y: 0 }, r: 80 }, b: { c: { x: 0, y: 0 }, r: 80 }, fit: 'bar', width: 40 }),
      pathData: '',
      link: { kind: 'band', a: 'one', b: 'two' },
    }
    expect(boxFor(['band'], [empty])).toBeNull()
    expect(handlesFor(['band'], [empty])).toBeNull()
    const beside = boxFor(['slab', 'band'], [slab, empty])!
    expect(beside.ids).toEqual(['slab'])
    expect(beside.box).toEqual(boxFor(['slab'], [slab])!.box)
  })
})

describe('the handles while a tool is active', () => {
  it("keep a recipe's own handles under a carve tool, so the cut just made can be adjusted", () => {
    expect(handlesFor(['slab'], undefined, 'recipe')!.kind).toBe('recipe')
  })

  it('leave free shapes and several layers without a box under a carve tool, and everything bare under the pen', () => {
    expect(handlesFor(['turned'], undefined, 'recipe')).toBeNull()
    expect(handlesFor(['square', 'turned'], undefined, 'recipe')).toBeNull()
    expect(handlesFor(['slab'], undefined, 'none')).toBeNull()
  })
})
