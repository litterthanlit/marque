import {
  boxFromBounds,
  boxHandles,
  boxRotateHandle,
  DEFAULT_HANDLE_LAYOUT,
  intersectBounds,
  shapeBoundsInFrame,
  TOUCH_CENTRE_CLEAR,
  unionBounds,
  type CarveHandle,
  type HandleLayout,
  type OrientedBox,
} from '../../engine/box/box.ts'
import { carveHandles } from '../../engine/carve/edit.ts'
import { carveOutline, outlineBounds } from '../../engine/carve/outline.ts'
import type { CarveSpec } from '../../engine/carve/spec.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { emptyBounds, type Bounds, type Vec } from '../../engine/path/bezier.ts'
import type { EditableShape } from '../../engine/path/editPath.ts'

/**
 * The handles the selection gets. A single recipe keeps its own handles. A
 * single free shape gets a box around its frame, turned as far as the frame
 * is. Two or more layers get one upright box around them all.
 */
export interface HandleSet {
  /** 'recipe' handles reshape one recipe; 'box' handles move every member with one map. */
  kind: 'recipe' | 'box'
  /** The layers the handles act on. Slices are members, but a box's bounds leave them out. */
  ids: string[]
  list: CarveHandle[]
  /** What a box's handles sit around. Null for a recipe's own handles. */
  box: OrientedBox | null
  /** A recipe is among the members: only corners show, and they scale uniformly. */
  uniform: boolean
}

/**
 * The handle layout at the current zoom: sizes stay constant on screen. Under
 * a finger a rounding dot keeps twice as far from its recipe's centre.
 */
export function scaledHandleLayout(unitsPerPx: number, touch = false): HandleLayout {
  return {
    pad: DEFAULT_HANDLE_LAYOUT.pad * unitsPerPx,
    rotateOffset: DEFAULT_HANDLE_LAYOUT.rotateOffset * unitsPerPx,
    minEdgeHandleSize: DEFAULT_HANDLE_LAYOUT.minEdgeHandleSize * unitsPerPx,
    radiusInset: DEFAULT_HANDLE_LAYOUT.radiusInset * unitsPerPx,
    minBoxSide: DEFAULT_HANDLE_LAYOUT.minBoxSide * unitsPerPx,
    centreClear: (touch ? TOUCH_CENTRE_CLEAR : DEFAULT_HANDLE_LAYOUT.centreClear) * unitsPerPx,
  }
}

let lastTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/**
 * Was the last pointer on the canvas a finger? Handles are laid out for it,
 * so the canvas, its tests and the bar agree on where a dot is. It starts
 * from the device's main pointer.
 */
export const canvasPointer = {
  touch(): boolean {
    return lastTouch
  },
  note(touch: boolean): void {
    lastTouch = touch
  },
}

let dotless = ''
const dotlessListeners = new Set<() => void>()

/**
 * The selected recipes whose rounding dot is hidden, too small on screen to
 * keep it clear of their centre, as ids joined by spaces: the selection bar
 * offers a Corner control for them instead.
 */
export const hiddenRadiusDots = {
  get(): string {
    return dotless
  },
  set(ids: readonly string[]): void {
    const next = ids.join(' ')
    if (next === dotless) return
    dotless = next
    for (const listener of dotlessListeners) listener()
  },
  subscribe(listener: () => void): () => void {
    dotlessListeners.add(listener)
    return () => dotlessListeners.delete(listener)
  },
}

/**
 * A box's handles as drawn: resize squares (only corners, scaling evenly,
 * when a recipe is among the members) and the rotate knob. A side's square
 * hides on a short side; the side of the frame still resizes there.
 */
export function boxHandleList(box: OrientedBox, layout: HandleLayout, uniform: boolean): CarveHandle[] {
  return [
    ...boxHandles(box, layout, { kind: uniform ? 'scale' : 'resize', edges: !uniform, minSide: layout.minBoxSide }),
    boxRotateHandle(box, layout),
  ]
}

/** A layer a box takes in: not hidden or locked, and not a copy or band that waits, empty, with nothing to turn or scale. */
const usable = (layer: IllustratorLayer | undefined): layer is IllustratorLayer =>
  Boolean(layer && layer.visible && !layer.locked && !(layer.link && !layer.pathData))

/**
 * The box around some layers, with the layers it moves. A slice is moved but
 * not measured: its path reaches far past both ends. A free shape alone is
 * measured in its own frame; anything else upright. A layer alone is
 * measured in full. Among several layers, a cut counts only where it meets
 * the material it can remove (the shapes among them, or else every shape in
 * `material`), so a cut circle that sticks far out of a spark does not
 * stretch the box past the ink. Null when nothing is left to measure.
 */
export function boxAround(
  layers: IllustratorLayer[],
  freePathOf: (layer: IllustratorLayer) => EditableShape | null,
  material: () => Bounds = emptyBounds,
): { box: OrientedBox; ids: string[]; uniform: boolean } | null {
  const alone = layers.length === 1
  const rotation = alone && !layers[0].carve ? (layers[0].frameRotation ?? 0) : 0
  let shapes = emptyBounds()
  const cuts: Bounds[] = []
  const ids: string[] = []
  let uniform = false
  for (const layer of layers) {
    let bounds: Bounds
    if (layer.carve) {
      ids.push(layer.id)
      uniform = true
      if (layer.carve.kind === 'slice') continue
      bounds = outlineBounds(carveOutline(layer.carve))
    } else {
      const path = freePathOf(layer)
      if (!path) continue
      ids.push(layer.id)
      bounds = shapeBoundsInFrame(path, rotation)
    }
    if (layer.operation === 'subtract' && !alone) cuts.push(bounds)
    else shapes = unionBounds(shapes, bounds)
  }
  const removable = Number.isFinite(shapes.minX) || !cuts.length ? shapes : material()
  let measured = shapes
  for (const cut of cuts) {
    const shared = intersectBounds(cut, removable)
    // A cut over nothing still counts in full: it is there to be picked up.
    measured = unionBounds(measured, Number.isFinite(shared.minX) ? shared : cut)
  }
  const box = boxFromBounds(measured, rotation)
  return box && ids.length ? { box, ids, uniform } : null
}

/**
 * Which of the selection's handles take presses. 'all' while editing;
 * 'recipe' while a carve tool is active, so a press beside a selected
 * shape starts a cut, yet the cut just made can still be adjusted; 'none'
 * while the pen draws.
 */
export type LiveHandles = 'all' | 'recipe' | 'none'

/**
 * A recipe's own frame, about the point its knob turns it: the centre of a
 * slab or punch (a bent one too), the middle of a groove's ends.
 */
export function recipeFrame(spec: CarveSpec): OrientedBox {
  switch (spec.kind) {
    case 'channel':
    case 'slice': {
      const along: Vec = { x: spec.to.x - spec.from.x, y: spec.to.y - spec.from.y }
      return {
        center: { x: (spec.from.x + spec.to.x) / 2, y: (spec.from.y + spec.to.y) / 2 },
        width: Math.hypot(along.x, along.y),
        height: spec.width,
        rotation: (Math.atan2(along.y, along.x) * 180) / Math.PI,
      }
    }
    case 'punch':
    case 'polygon':
      return { center: spec.center, width: spec.radius * 2, height: spec.radius * 2, rotation: spec.rotation }
    case 'slab':
      return { center: spec.center, width: spec.width, height: spec.height, rotation: spec.rotation }
    case 'band': {
      // Along the line between its circles, about its middle, as wide as its wider circle.
      const along: Vec = { x: spec.b.c.x - spec.a.c.x, y: spec.b.c.y - spec.a.c.y }
      return {
        center: { x: (spec.a.c.x + spec.b.c.x) / 2, y: (spec.a.c.y + spec.b.c.y) / 2 },
        width: Math.hypot(along.x, along.y),
        height: 2 * Math.max(spec.a.r, spec.b.r),
        rotation: (Math.atan2(along.y, along.x) * 180) / Math.PI,
      }
    }
    default:
      return spec satisfies never
  }
}

/**
 * The box around the selection's usable layers: what Alt+arrows turn and
 * scale. A single recipe turns and scales in its own frame, about the point
 * its knob turns it, so a lone cut is never measured against the shape it
 * cuts. Null when nothing is left to measure.
 */
export function selectionBox(
  doc: IllustratorDocument,
  freePathOf: (layer: IllustratorLayer) => EditableShape | null,
): { box: OrientedBox; ids: string[]; uniform: boolean } | null {
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]))
  const members = doc.selectedLayerIds.map((id) => byId.get(id)).filter(usable)
  if (!members.length) return null
  if (members.length === 1 && members[0].carve) {
    return { box: recipeFrame(members[0].carve), ids: [members[0].id], uniform: true }
  }
  // Every shape in the document, measured only for a selection of cuts alone.
  const material = () => {
    let bounds = emptyBounds()
    for (const layer of doc.layers) {
      if (!layer.visible || layer.operation !== 'add') continue
      if (layer.carve) bounds = unionBounds(bounds, outlineBounds(carveOutline(layer.carve)))
      else {
        const path = freePathOf(layer)
        if (path) bounds = unionBounds(bounds, shapeBoundsInFrame(path))
      }
    }
    return bounds
  }
  return boxAround(members, freePathOf, material)
}

/** The handles for the document's selection, in layer space, or null when it gets none. */
export function selectionHandles(
  doc: IllustratorDocument,
  layout: HandleLayout,
  freePathOf: (layer: IllustratorLayer) => EditableShape | null,
  live: LiveHandles = 'all',
): HandleSet | null {
  if (live === 'none') return null
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]))
  // Hidden, locked and empty layers stay selected but take no part.
  const members = doc.selectedLayerIds.map((id) => byId.get(id)).filter(usable)
  if (!members.length) return null
  const lone = members.length === 1 ? members[0] : null
  if (lone?.carve) return { kind: 'recipe', ids: [lone.id], list: carveHandles(lone.carve, layout), box: null, uniform: false }
  if (live === 'recipe') return null
  const around = selectionBox(doc, freePathOf)
  if (!around) return null
  const { box, ids, uniform } = around
  return { kind: 'box', ids, list: boxHandleList(box, layout, uniform), box, uniform }
}
