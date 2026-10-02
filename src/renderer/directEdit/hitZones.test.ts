import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { carveOutline } from '../../engine/carve/outline.ts'
import { slabSpec, type CarveSpec } from '../../engine/carve/spec.ts'
import { composeIllustratorMark, getLayerPathItem } from '../../engine/illustrator/compose.ts'
import { bakedEditablePath } from '../../engine/illustrator/layerPath.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { findZone, type HitContext } from './hitZones.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function recipeLayer(id: string, spec: CarveSpec, operation: 'add' | 'subtract'): IllustratorLayer {
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

const slab = recipeLayer('slab', slabSpec('square'), 'add')
const punch = recipeLayer('punch', { v: 1, kind: 'punch', shape: 'circle', center: { x: -60, y: -60 }, radius: 40, rotation: 0 }, 'subtract')
const channel = recipeLayer('channel', { v: 1, kind: 'channel', from: { x: -100, y: 100 }, to: { x: 100, y: 100 }, width: 30 }, 'subtract')
const triangle: IllustratorLayer = {
  id: 'triangle',
  name: 'triangle',
  operation: 'add',
  visible: true,
  locked: false,
  pathData: 'M250,-100L290,-20L210,-20Z',
  fillRule: 'nonzero',
  transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
}

function context(selectedIds: string[]): HitContext {
  const doc: IllustratorDocument = {
    id: 'doc',
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers: [slab, punch, channel, triangle],
    selectedLayerIds: selectedIds,
    pointSelection: null,
    mode: 'object',
  }
  const mark = composeIllustratorMark(doc)
  scope.activate()
  scope.project.clear()
  const items = new Map<string, paper.PathItem>()
  for (const layer of doc.layers) {
    const item = getLayerPathItem(scope, layer, true)
    if (item) items.set(layer.id, item as paper.PathItem)
  }
  const ink = new scope.CompoundPath(mark?.compoundPathData ?? '')
  return {
    doc,
    items,
    ink,
    center: { x: 0, y: 0 },
    selectedIds,
    freePath: null,
    anchorIndex: null,
    handles: null,
    unitsPerPx: 1,
    touch: false,
    edges: true,
    freePathOf: (layer) => bakedEditablePath(layer),
  }
}

describe('edge hit zones', () => {
  it('bends a shape from the empty side of its visible edge, selected or not', () => {
    for (const selected of [[], ['slab']]) {
      const zone = findZone(context(selected), { x: 194, y: 20 })
      expect(zone.kind).toBe('edge')
      if (zone.kind === 'edge') {
        expect(zone.layerId).toBe('slab')
        expect(zone.carve?.side).toEqual({ type: 'line', id: 'right' })
      }
    }
  })

  it('grabs material just inside an edge, except in a thin band of the selected shape', () => {
    expect(findZone(context([]), { x: 188.5, y: 20 })).toEqual({ kind: 'body', layerId: 'slab' })
    expect(findZone(context(['slab']), { x: 188.5, y: 20 }).kind).toBe('edge')
    expect(findZone(context(['slab']), { x: 186, y: 20 })).toEqual({ kind: 'body', layerId: 'slab' })
  })

  it("bends a hole from inside it, and leaves the ink around it to the slab", () => {
    const inHole = findZone(context([]), { x: -60, y: -60 + 37 })
    expect(inHole.kind).toBe('edge')
    if (inHole.kind === 'edge') expect(inHole.layerId).toBe('punch')
    expect(findZone(context([]), { x: -60, y: -60 + 43 })).toEqual({ kind: 'body', layerId: 'slab' })
    // Once the cut is selected, a thin band on the ink side bends it too.
    const selected = findZone(context(['punch']), { x: -60, y: -60 + 41.5 })
    expect(selected.kind).toBe('edge')
    if (selected.kind === 'edge') expect(selected.layerId).toBe('punch')
  })

  it("leaves a channel's round ends to its handles and body", () => {
    const cap = findZone(context(['channel']), { x: 112, y: 100 })
    expect(cap).toEqual({ kind: 'body', layerId: 'channel' })
    const rail = findZone(context(['channel']), { x: 0, y: 100 + 12 })
    expect(rail.kind).toBe('edge')
    if (rail.kind === 'edge') expect(rail.carve?.side.type).toBe('rail')
  })

  it('finds the curve of a free shape and how far along it the pointer is', () => {
    // 3 units outside the bottom side (from (290,-20) to (210,-20)), a quarter of the way along.
    const zone = findZone(context(['triangle']), { x: 270, y: -17 })
    expect(zone.kind).toBe('edge')
    if (zone.kind === 'edge') {
      expect(zone.free?.curveIndex).toBe(1)
      expect(zone.free?.t).toBeCloseTo(0.25, 2)
      expect(zone.point.y).toBeCloseTo(-20, 3)
    }
  })

  it('ignores pointers far from every edge', () => {
    expect(findZone(context([]), { x: 0, y: -250 })).toEqual({ kind: 'empty' })
  })
})
