import paper from 'paper'
import { affineOf, pathBoundsInFrame, transformPath } from '../box/box.ts'
import { add, boundsCenter, rotate, scale, sub } from '../path/bezier.ts'
import type { EditablePath } from '../path/editPath.ts'
import type { VectorPath } from '../vector/types.ts'
import { getLayerPathItem } from './compose.ts'
import type { IllustratorLayer, IllustratorTransform } from './types.ts'

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

/**
 * A document path with a layer's transform baked in, as `bakedEditablePath`
 * gives it, but worked out without paper: it never switches the active
 * scope, so a component can measure a layer as it renders. The transform
 * scales and turns about the middle of the path's bounds, then moves.
 */
export function bakedObjectPath(path: VectorPath, transform: IllustratorTransform): EditablePath {
  const editable: EditablePath = {
    closed: path.closed,
    segs: path.segments.map((seg) => ({ p: seg.point, hIn: seg.handleIn, hOut: seg.handleOut })),
  }
  const { dx, dy, scale: factor, rotation } = transform
  if (dx === 0 && dy === 0 && factor === 1 && rotation === 0) return editable
  const pivot = boundsCenter(pathBoundsInFrame(editable))
  return transformPath(editable, affineOf((p) => add(add(pivot, rotate(scale(sub(p, pivot), factor), rotation)), { x: dx, y: dy })))
}
