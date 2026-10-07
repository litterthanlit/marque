import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { carveOutline } from '../../engine/carve/outline.ts'
import { slabSpec, type CarveSpec } from '../../engine/carve/spec.ts'
import { composeIllustratorMark, getLayerPathItem } from '../../engine/illustrator/compose.ts'
import { bakedEditableShape } from '../../engine/illustrator/layerPath.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { DEFAULT_HANDLE_LAYOUT } from '../../engine/box/box.ts'
import { scaledHandleLayout, selectionHandles } from './handleSet.ts'
import { findZone, zoneKey, type HitContext } from './hitZones.ts'
import { carriedCuts } from './carry.ts'
import type { Guide } from '../../engine/vector/types.ts'

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

function context(selectedIds: string[], layers: IllustratorLayer[] = [slab, punch, channel, triangle]): HitContext {
  const doc: IllustratorDocument = {
    id: 'doc',
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers,
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
    anchor: null,
    handles: null,
    unitsPerPx: 1,
    touch: false,
    edges: true,
    freePathOf: (layer) => bakedEditableShape(layer),
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

  it('takes a piece reached through its group by its edge as by its body, to move the group, never to bend the piece', () => {
    const throughGroup = (layerId: string) => layerId !== 'slab'
    for (const selected of [[], ['slab']]) {
      expect(findZone({ ...context(selected), bendable: throughGroup }, { x: 194, y: 20 })).toEqual({ kind: 'body', layerId: 'slab' })
    }
    // Once it can be pressed on its own, at the root or inside the group the selection has entered, it bends again.
    expect(findZone({ ...context([]), bendable: () => true }, { x: 194, y: 20 }).kind).toBe('edge')
  })

  it('ignores pointers far from every edge', () => {
    expect(findZone(context([]), { x: 0, y: -250 })).toEqual({ kind: 'empty' })
  })
})

describe('a cut over nothing', () => {
  const lone = recipeLayer('lone', { v: 1, kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 40, rotation: 0 }, 'subtract')
  const over = recipeLayer('over', { v: 1, kind: 'punch', shape: 'circle', center: { x: 10, y: 0 }, radius: 40, rotation: 0 }, 'subtract')
  // Crosses the slab's right edge (x = 190): half of it has nothing below.
  const straddling = recipeLayer('straddling', { v: 1, kind: 'punch', shape: 'circle', center: { x: 190, y: 0 }, radius: 40, rotation: 0 }, 'subtract')

  it('is picked up by its body on an empty canvas, the topmost first', () => {
    expect(findZone(context([], [lone]), { x: 0, y: 0 })).toEqual({ kind: 'body', layerId: 'lone' })
    expect(findZone(context([], [lone]), { x: 0, y: 30 })).toEqual({ kind: 'body', layerId: 'lone' })
    expect(findZone(context([], [lone, over]), { x: 5, y: 0 })).toEqual({ kind: 'body', layerId: 'over' })
    expect(findZone(context([], [lone, over]), { x: -35, y: 0 })).toEqual({ kind: 'body', layerId: 'lone' })
    expect(findZone(context([], [lone]), { x: 60, y: 0 })).toEqual({ kind: 'empty' })
  })

  it('is picked up where it sticks out of the shape it cuts', () => {
    expect(findZone(context([], [slab, straddling]), { x: 210, y: 0 })).toEqual({ kind: 'body', layerId: 'straddling' })
    expect(findZone(context([], [slab, straddling]), { x: 170, y: 0 })).toEqual({ kind: 'body', layerId: 'straddling' })
  })

  it('stays out of the way when it is hidden or locked', () => {
    expect(findZone(context([], [{ ...lone, visible: false }]), { x: 0, y: 0 })).toEqual({ kind: 'empty' })
    expect(findZone(context([], [{ ...lone, locked: true }]), { x: 0, y: 0 })).toEqual({ kind: 'empty' })
  })

  it('never takes a press from a shape under the pointer', () => {
    // A cut below the slab removes nothing from it: the ink there is still the slab's.
    expect(findZone(context([], [lone, slab]), { x: 0, y: 0 })).toEqual({ kind: 'body', layerId: 'slab' })
    // A locked shape is not picked up, and the cut beneath it is not offered in its place.
    expect(findZone(context([], [lone, { ...slab, locked: true }]), { x: 0, y: 0 })).toEqual({ kind: 'empty' })
    // A locked cut keeps its hole: an older cut under the same shape does not answer for it.
    expect(findZone(context([], [lone, slab, { ...over, locked: true }]), { x: 5, y: 0 })).toEqual({ kind: 'empty' })
  })
})

describe('handles and points', () => {
  // The triangle's box: x 210…290, y -100…-20. Its handles sit 12 units out.
  function withBox(selectedIds: string[], anchor: HitContext['anchor'] = null): HitContext {
    const ctx = context(selectedIds)
    const handles = selectionHandles(ctx.doc, DEFAULT_HANDLE_LAYOUT, (layer) => bakedEditableShape(layer))
    const shape = bakedEditableShape(triangle)!
    return {
      ...ctx,
      handles,
      freePath: selectedIds.length === 1 && selectedIds[0] === 'triangle' ? { layerId: 'triangle', shape } : null,
      anchor,
    }
  }

  it("put a free shape's box handles above its body and edges", () => {
    const ctx = withBox(['triangle'])
    const east = ctx.handles!.list.find((h) => h.id === 'e')!
    expect(east.at).toEqual({ x: 302, y: -60 })
    const zone = findZone(ctx, east.at)
    expect(zone.kind).toBe('handle')
    if (zone.kind === 'handle') {
      expect(zone.handle.id).toBe('e')
      expect(zone.set.ids).toEqual(['triangle'])
    }
    expect(zoneKey(zone)).toBe('handle:box:triangle:e')
  })

  it('reach every point and every handle on its own centre: the nearer wins, and a point wins a tie', () => {
    const ctx = withBox(['triangle'])
    // The apex (250, -100) sits 12 units under the north handle (250, -112).
    expect(findZone(ctx, { x: 250, y: -100 })).toEqual({ kind: 'anchor', layerId: 'triangle', contourIndex: 0, index: 0 })
    const north = findZone(ctx, { x: 250, y: -112 })
    expect(north.kind === 'handle' && north.handle.id).toBe('n')
    // Halfway between, the point wins.
    expect(findZone(ctx, { x: 250, y: -106 })).toEqual({ kind: 'anchor', layerId: 'triangle', contourIndex: 0, index: 0 })
    expect(findZone(ctx, { x: 250, y: -107 }).kind).toBe('handle')
  })

  it('target every layer of a selection from one box', () => {
    const ctx = withBox(['slab', 'triangle'])
    expect(ctx.handles!.uniform).toBe(true)
    const corner = ctx.handles!.list.find((h) => h.id === 'ne')!
    const zone = findZone(ctx, corner.at)
    expect(zone.kind === 'handle' && zone.set.ids).toEqual(['slab', 'triangle'])
    expect(zoneKey(zone)).toBe('handle:box:slab,triangle:ne')
  })
})

describe('a free shape on touch', () => {
  function free(id: string, pathData: string): IllustratorLayer {
    return { ...triangle, id, name: id, pathData }
  }
  const rect = free('rect', 'M-100,-50L100,-50L100,50L-100,50Z')
  const tiny = free('tiny', 'M300,300L315,300L315,315L300,315Z')

  function touchContext(selectedIds: string[], layers: IllustratorLayer[]): HitContext {
    const ctx = { ...context(selectedIds, layers), touch: true }
    const only = selectedIds.length === 1 ? layers.find((layer) => layer.id === selectedIds[0]) : undefined
    return {
      ...ctx,
      handles: selectionHandles(ctx.doc, DEFAULT_HANDLE_LAYOUT, (layer) => bakedEditableShape(layer)),
      freePath: only ? { layerId: only.id, shape: bakedEditableShape(only)! } : null,
    }
  }

  it('bends the middle of a side, and resizes from the side handle on its own centre', () => {
    const ctx = touchContext(['rect'], [rect])
    for (const p of [
      { x: 0, y: -50 },
      { x: 0, y: -52 },
      { x: 0, y: -48 },
      { x: 5, y: -50 },
    ]) {
      expect(zoneKey(findZone(ctx, p))).toBe('edge:rect:0:0')
    }
    expect(zoneKey(findZone(ctx, { x: 0, y: -62 }))).toBe('handle:box:rect:n')
    expect(zoneKey(findZone({ ...ctx, touch: false }, { x: 0, y: -62 }))).toBe('handle:box:rect:n')
  })

  it('moves a shape small on screen from its middle, and still reaches its points from their centres', () => {
    const ctx = touchContext(['tiny'], [rect, tiny])
    expect(findZone(ctx, { x: 307.5, y: 307.5 })).toEqual({ kind: 'body', layerId: 'tiny' })
    expect(findZone(ctx, { x: 300, y: 300 })).toEqual({ kind: 'anchor', layerId: 'tiny', contourIndex: 0, index: 0 })
    expect(findZone(ctx, { x: 296, y: 296 })).toEqual({ kind: 'anchor', layerId: 'tiny', contourIndex: 0, index: 0 })
  })
})

describe('a long thin shape', () => {
  const at = (pathData: string, id = 'bar'): IllustratorLayer => ({ ...triangle, id, name: id, pathData })

  /** A selected bar at a zoom of `unitsPerPx`, on touch or with a mouse. */
  function barContext(layer: IllustratorLayer, unitsPerPx: number, touch: boolean): HitContext {
    const ctx = { ...context([layer.id], [layer]), unitsPerPx, touch }
    return {
      ...ctx,
      handles: selectionHandles(ctx.doc, scaledHandleLayout(unitsPerPx), (candidate) => bakedEditableShape(candidate)),
      freePath: { layerId: layer.id, shape: bakedEditableShape(layer)! },
    }
  }

  it('keeps the full reach of its points from inside it', () => {
    // 300 × 12, at 1.6 units per pixel: about 7.5 pixels tall on screen.
    const bar = at('M-150,-6L150,-6L150,6L-150,6Z')
    expect(findZone(barContext(bar, 1.6, true), { x: 144, y: 2 })).toEqual({ kind: 'anchor', layerId: 'bar', contourIndex: 0, index: 2 })
    expect(findZone(barContext(bar, 1.6, false), { x: 147, y: 3 })).toEqual({ kind: 'anchor', layerId: 'bar', contourIndex: 0, index: 2 })
  })

  it('is not resized by a side handle reaching onto it', () => {
    const bar = at('M-150,-6L150,-6L150,6L-150,6Z')
    // The north handle sits 19.2 units above the top and reaches 22.4 on touch: past the edge's thin band.
    expect(findZone(barContext(bar, 1.6, true), { x: 0, y: -3.2 })).toEqual({ kind: 'body', layerId: 'bar' })
  })

  it('stretches along its length from the short sides of its frame, where no side handle shows', () => {
    // 240 × 2: the east and west handles are hidden, the frame's short sides are 26 units long.
    const bar = at('M-120,-1L120,-1L120,1L-120,1Z')
    for (const touch of [false, true]) {
      const ctx = barContext(bar, 1, touch)
      expect(ctx.handles!.list.map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'se', 's', 'sw', 'rotate'])
      expect(zoneKey(findZone(ctx, { x: 132, y: 0 }))).toBe('handle:box:bar:e')
      expect(zoneKey(findZone(ctx, { x: -132, y: 0 }))).toBe('handle:box:bar:w')
      expect(zoneKey(findZone(ctx, { x: 132, y: -13 }))).toBe('handle:box:bar:ne')
    }
  })
})

describe('inside a box', () => {
  const left: IllustratorLayer = { ...triangle, id: 'left', name: 'left', pathData: 'M-200,-20L-160,-20L-160,20L-200,20Z' }
  const right: IllustratorLayer = { ...triangle, id: 'right', name: 'right', pathData: 'M160,-20L200,-20L200,20L160,20Z' }

  function boxContext(selectedIds: string[]): HitContext {
    const ctx = context(selectedIds, [left, right])
    return { ...ctx, handles: selectionHandles(ctx.doc, DEFAULT_HANDLE_LAYOUT, (layer) => bakedEditableShape(layer)) }
  }

  it('moves the selection from the empty space between its shapes, up to its frame', () => {
    const ctx = boxContext(['left', 'right'])
    expect(zoneKey(findZone(ctx, { x: 0, y: 0 }))).toBe('frame:left,right')
    expect(zoneKey(findZone(ctx, { x: 100, y: -27 }))).toBe('frame:left,right')
    expect(findZone(ctx, { x: -180, y: 0 })).toEqual({ kind: 'body', layerId: 'left' })
  })

  it('resizes from anywhere along a side of its frame, and the corners keep their own squares', () => {
    const ctx = boxContext(['left', 'right'])
    // The frame runs 12 units outside the shapes: x -212…212, y -32…32.
    for (const p of [
      { x: 100, y: -32 },
      { x: 100, y: -35 },
      { x: -150, y: -29 },
    ]) {
      expect(zoneKey(findZone(ctx, p))).toBe('handle:box:left,right:n')
    }
    expect(zoneKey(findZone(ctx, { x: 212, y: 10 }))).toBe('handle:box:left,right:e')
    expect(zoneKey(findZone(ctx, { x: 207, y: -32 }))).toBe('handle:box:left,right:ne')
  })

  it('turns from just outside a corner, and a click there is a click on the empty canvas', () => {
    const ctx = boxContext(['left', 'right'])
    // The north-east corner square sits at (212, -32).
    const ring = findZone(ctx, { x: 224, y: -42 })
    expect(zoneKey(ring)).toBe('handle:box:left,right:rotate:ring')
    expect(ring.kind === 'handle' && ring.handle.kind).toBe('rotate')
    expect(findZone(ctx, { x: 240, y: -50 })).toEqual({ kind: 'empty' })
    // Inside the frame it is still the frame.
    expect(zoneKey(findZone(ctx, { x: 206, y: -26 }))).toBe('frame:left,right')
  })

  it('is empty outside the frame, or with nothing selected', () => {
    expect(findZone(boxContext(['left', 'right']), { x: 0, y: 40 })).toEqual({ kind: 'empty' })
    expect(findZone(boxContext([]), { x: 0, y: 0 })).toEqual({ kind: 'empty' })
  })
})

describe('a recipe that turns', () => {
  function recipeContext(layer: IllustratorLayer): HitContext {
    const ctx = context([layer.id], [layer])
    return { ...ctx, handles: selectionHandles(ctx.doc, DEFAULT_HANDLE_LAYOUT, (candidate) => bakedEditableShape(candidate)) }
  }

  it('turns from just outside a corner of its own handles, like a box does', () => {
    for (const rotation of [0, 30]) {
      const turnedSlab = recipeLayer('slab', { ...slabSpec('square'), rotation }, 'add')
      const ctx = recipeContext(turnedSlab)
      const at = (id: string) => ctx.handles!.list.find((h) => h.id === id)!.at
      const se = at('se')
      const out = { x: se.x - at('nw').x, y: se.y - at('nw').y }
      const reach = Math.hypot(out.x, out.y)
      // 10 units further out along the diagonal.
      const ring = findZone(ctx, { x: se.x + (out.x / reach) * 10, y: se.y + (out.y / reach) * 10 })
      expect(zoneKey(ring)).toBe('handle:recipe:slab:rotate:ring')
      expect(ring.kind === 'handle' && ring.handle.kind).toBe('rotate')
    }
  })

  it('has no ring when it does not turn, such as a round punch', () => {
    const round = recipeLayer('round', { v: 1, kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 50, rotation: 0 }, 'subtract')
    const ctx = recipeContext(round)
    const se = ctx.handles!.list.find((h) => h.id === 'se')!.at
    expect(findZone(ctx, { x: se.x + 7, y: se.y + 7 })).toEqual({ kind: 'empty' })
  })
})

describe('a free shape with a hole', () => {
  // A square ring: the outer contour x/y ±100, the hole ±40, as one layer.
  const ring: IllustratorLayer = {
    ...triangle,
    id: 'ring',
    name: 'ring',
    pathData: 'M-100,-100L100,-100L100,100L-100,100Z M-40,-40L-40,40L40,40L40,-40Z',
    fillRule: 'evenodd',
    contourCount: 2,
  }

  function ringContext(anchor: HitContext['anchor'] = null): HitContext {
    const ctx = context(['ring'], [ring])
    return {
      ...ctx,
      handles: selectionHandles(ctx.doc, DEFAULT_HANDLE_LAYOUT, (layer) => bakedEditableShape(layer)),
      freePath: { layerId: 'ring', shape: bakedEditableShape(ring)! },
      anchor,
    }
  }

  it('reaches the points of its inner contour, by contour', () => {
    const ctx = ringContext()
    expect(findZone(ctx, { x: 40, y: 40 })).toEqual({ kind: 'anchor', layerId: 'ring', contourIndex: 1, index: 2 })
    expect(findZone(ctx, { x: 100, y: 100 })).toEqual({ kind: 'anchor', layerId: 'ring', contourIndex: 0, index: 2 })
    expect(zoneKey(findZone(ctx, { x: 40, y: 40 }))).toBe('anchor:ring:1:2')
  })

  it("bends the inner contour's edges, and the hole is no part of the shape", () => {
    const ctx = ringContext()
    // From the hole, the empty side of that edge.
    const edge = findZone(ctx, { x: 37, y: 0 })
    expect(edge.kind === 'edge' && edge.free).toMatchObject({ contourIndex: 1 })
    expect(findZone(ctx, { x: 0, y: 0 }).kind).not.toBe('body')
    expect(findZone(ctx, { x: 70, y: 0 })).toEqual({ kind: 'body', layerId: 'ring' })
  })

  it('shows the handles of a selected point on the inner contour', () => {
    const curved: IllustratorLayer = { ...ring, pathData: 'M-100,-100L100,-100L100,100L-100,100Z M-40,-40C-60,0 -60,0 -40,40L40,40L40,-40Z' }
    const ctx = { ...ringContext({ contourIndex: 1, index: 0 }), freePath: { layerId: 'ring', shape: bakedEditableShape(curved)! } }
    expect(findZone(ctx, { x: -60, y: 0 })).toEqual({ kind: 'bezier', layerId: 'ring', contourIndex: 1, index: 0, which: 'out' })
  })
})

describe('guide hit zones', () => {
  // A guide lying exactly along the slab's right edge, x = 190, and one across empty canvas.
  const onEdge: Guide = { id: 'edge-guide', name: 'Line', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 190, y: 0 }, angle: 90 } }
  const apart: Guide = { id: 'apart', name: 'Line', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: 260 }, angle: 0 } }
  const withGuides = (guidesFirst: boolean, guides: Guide[] = [onEdge, apart]): HitContext => ({ ...context([]), guides, guidesFirst })

  it('under Select, leaves a press on a guide that lies along an edge to the edge', () => {
    const zone = findZone(withGuides(false), { x: 192, y: 20 })
    expect(zone.kind).toBe('edge')
    if (zone.kind === 'edge') expect(zone.layerId).toBe('slab')
  })

  it('under Select, gives a guide the press where nothing else is', () => {
    expect(findZone(withGuides(false), { x: -250, y: 262 })).toEqual({ kind: 'guide', guideId: 'apart', point: { x: -250, y: 260 } })
  })

  it('under the Guide tool, gives the guide on the edge the press first', () => {
    const zone = findZone(withGuides(true), { x: 192, y: 20 })
    expect(zone.kind).toBe('guide')
    if (zone.kind === 'guide') expect(zone.guideId).toBe('edge-guide')
  })

  it('reaches a guide within 4 pixels, twice that on touch', () => {
    expect(findZone(withGuides(true), { x: -250, y: 265 }).kind).toBe('empty')
    expect(findZone({ ...withGuides(true), touch: true }, { x: -250, y: 267 }).kind).toBe('guide')
  })

  it('never reaches a guide it is not given, as a locked or hidden one is not', () => {
    expect(findZone(withGuides(true, []), { x: 192, y: 20 }).kind).toBe('edge')
  })

  it("puts the selected guide's handles before everything", () => {
    const handle = { guideId: 'apart', id: 'rotate' as const, at: { x: 190, y: 40 }, pivot: { x: 190, y: 0 } }
    expect(findZone({ ...withGuides(false), guideHandles: [handle] }, { x: 191, y: 41 })).toEqual({ kind: 'guide-handle', handle })
  })
})

describe('a band over its circles', () => {
  const a = recipeLayer('A', slabSpec('circle', { x: -100, y: 0 }, 0.5), 'add')
  const b = recipeLayer('B', slabSpec('circle', { x: 150, y: 0 }, 0.2), 'add')
  const beltSpec: CarveSpec = { v: 1, kind: 'band', a: { c: { x: -100, y: 0 }, r: 100 }, b: { c: { x: 150, y: 0 }, r: 40 }, fit: 'belt' }
  const belt: IllustratorLayer = { ...recipeLayer('belt', beltSpec, 'add'), link: { kind: 'band', a: 'A', b: 'B' } }

  it('gives a press inside either circle to that circle, even the selected one, and the band only between them', () => {
    expect(findZone(context([], [a, b, belt]), { x: 150, y: 0 })).toEqual({ kind: 'body', layerId: 'B' })
    expect(findZone(context(['B'], [a, b, belt]), { x: 160, y: 10 })).toEqual({ kind: 'body', layerId: 'B' })
    expect(findZone(context(['belt'], [a, b, belt]), { x: -100, y: 0 })).toEqual({ kind: 'body', layerId: 'A' })
    expect(findZone(context([], [a, b, belt]), { x: 50, y: 50 })).toEqual({ kind: 'body', layerId: 'belt' })
  })

  it('keeps a press inside a locked circle for the band, which says why it stays', () => {
    expect(findZone(context([], [a, { ...b, locked: true }, belt]), { x: 150, y: 0 })).toEqual({ kind: 'body', layerId: 'belt' })
  })

  it('leaves a detached band its whole body', () => {
    const detached = { ...belt, link: undefined }
    expect(findZone(context([], [a, b, detached]), { x: 150, y: 0 })).toEqual({ kind: 'body', layerId: 'belt' })
  })
})

describe('hits with isolated groups', () => {
  // Two squares side by side; a cut wide enough to reach both sits inside an isolated group with the right one.
  const square = (id: string, x: number, half: number, operation: 'add' | 'subtract', parentId?: string): IllustratorLayer => ({
    ...recipeLayer(id, { ...slabSpec('square', { x, y: 0 }), width: 2 * half, height: 2 * half }, operation),
    ...(parentId ? { parentId } : {}),
  })
  const left = square('left', -150, 100, 'add')
  const right = square('right', 150, 100, 'add', 'g')
  const cut = square('cut', 0, 120, 'subtract', 'g')
  const isolated = (on: boolean): HitContext => {
    const ctx = context([], [left, right, cut])
    const doc: IllustratorDocument = { ...ctx.doc, groups: [{ id: 'g', name: 'g', visible: true, locked: false, isolated: on, operation: 'add' }] }
    const mark = composeIllustratorMark(doc)
    scope.activate()
    return { ...ctx, doc, ink: new scope.CompoundPath(mark.compoundPathData) }
  }

  it('find the shape outside the group where its cut makes no hole', () => {
    expect(findZone(isolated(true), { x: -80, y: 0 })).toEqual({ kind: 'body', layerId: 'left' })
    // Shared, the same cut makes a hole there, and the hole is the cut's.
    expect(findZone(isolated(false), { x: -80, y: 0 })).toEqual({ kind: 'body', layerId: 'cut' })
  })

  it('give the cut the hole it makes inside the group', () => {
    expect(findZone(isolated(true), { x: 80, y: 0 })).toEqual({ kind: 'body', layerId: 'cut' })
  })

  it('do not hand a press to a member cut away inside its group over a shape below that shows', () => {
    // Under the group, a shape the cut cannot reach shows through where the group's member is cut away.
    const under = square('under', 100, 60, 'add')
    const ctx = context([], [under, right, cut])
    const doc: IllustratorDocument = { ...ctx.doc, groups: [{ id: 'g', name: 'g', visible: true, locked: false, isolated: true, operation: 'add' }] }
    const mark = composeIllustratorMark(doc)
    scope.activate()
    expect(findZone({ ...ctx, doc, ink: new scope.CompoundPath(mark.compoundPathData) }, { x: 100, y: 0 })).toEqual({ kind: 'body', layerId: 'under' })
  })
})

describe('cuts a move carries, with isolated groups', () => {
  it('measure a cut inside an isolated group against its members alone', () => {
    const square = (id: string, x: number, half: number, operation: 'add' | 'subtract', parentId?: string): IllustratorLayer => ({
      ...recipeLayer(id, { ...slabSpec('square', { x, y: 0 }), width: 2 * half, height: 2 * half }, operation),
      ...(parentId ? { parentId } : {}),
    })
    const layers = [square('left', -150, 100, 'add'), square('right', 150, 100, 'add', 'g'), square('cut', 0, 120, 'subtract', 'g')]
    const doc = (on: boolean): IllustratorDocument => ({
      ...context([], layers).doc,
      groups: [{ id: 'g', name: 'g', visible: true, locked: false, isolated: on, operation: 'add' }],
    })
    scope.activate()
    scope.project.clear()
    const items = new Map(layers.map((layer) => [layer.id, getLayerPathItem(scope, layer, true) as paper.PathItem]))
    // Shared, the cut also bites the shape on the left: it stays when the right one moves.
    expect(carriedCuts(doc(false), ['right'], items)).toEqual([])
    // Isolated, it can cut only the right one, so it goes with it.
    expect(carriedCuts(doc(true), ['right'], items)).toEqual(['cut'])
  })
})
