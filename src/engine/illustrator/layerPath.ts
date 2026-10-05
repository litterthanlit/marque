import paper from 'paper'
import type { EditablePath } from '../path/editPath.ts'
import { getLayerPathItem } from './compose.ts'
import type { IllustratorLayer, MarkData } from './types.ts'

let scope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope()
    scope.setup(new paper.Size(1, 1))
  }
  scope.activate()
  return scope
}

/**
 * A layer's single path with its transform baked in, as plain data. Direct
 * edits work on this and write the result back with an identity transform.
 * Multi-part layers return null (the document adapter keeps one path per
 * layer, so this only happens for unusual imported data).
 */
export function bakedEditablePath(layer: IllustratorLayer): EditablePath | null {
  const s = getScope()
  s.project.clear()
  const item = getLayerPathItem(s, layer, true)
  if (!item) return null
  const paths =
    item instanceof s.Path
      ? [item]
      : item.getItems({ class: s.Path }).filter((p): p is paper.Path => p instanceof s.Path)
  if (paths.length !== 1) {
    s.project.clear()
    return null
  }
  const path = paths[0]
  const out: EditablePath = {
    closed: path.closed,
    segs: path.segments.map((seg) => ({
      p: { x: seg.point.x, y: seg.point.y },
      hIn: seg.handleIn.isZero() ? null : { x: seg.handleIn.x, y: seg.handleIn.y },
      hOut: seg.handleOut.isZero() ? null : { x: seg.handleOut.x, y: seg.handleOut.y },
    })),
  }
  s.project.clear()
  return out
}

function drawnItems(s: paper.PaperScope, layers: IllustratorLayer[]): Array<{ layer: IllustratorLayer; item: paper.PathItem }> {
  s.project.clear()
  return layers.flatMap((layer) => {
    const item = getLayerPathItem(s, layer, true)
    return item ? [{ layer, item }] : []
  })
}

function boundsOf(drawn: Array<{ item: paper.PathItem }>): paper.Rectangle | null {
  return drawn.reduce<paper.Rectangle | null>((box, { item }) => (box ? box.unite(item.bounds) : item.bounds), null)
}

/** The box around the layers together, as they are drawn. Null when none of them has a path. */
export function layersBounds(layers: IllustratorLayer[]): MarkData['viewBox'] | null {
  const s = getScope()
  const box = boundsOf(drawnItems(s, layers))
  s.project.clear()
  return box && { x: box.x, y: box.y, width: box.width, height: box.height }
}

/**
 * The layers scaled as one piece about the middle of the box around them.
 * The result is baked into each path, as a move on the canvas is. A layer
 * transform scales about the layer's own middle, so it would also need an
 * offset, which the Move sliders can neither show nor reach.
 */
export function scaleLayers(layers: IllustratorLayer[], factor: number): Array<{ layerId: string; pathData: string }> {
  const s = getScope()
  const drawn = drawnItems(s, layers)
  const box = boundsOf(drawn)
  if (!box) return []
  const edits = drawn.map(({ layer, item }) => {
    item.scale(factor, box.center)
    return { layerId: layer.id, pathData: item.pathData }
  })
  s.project.clear()
  return edits
}
