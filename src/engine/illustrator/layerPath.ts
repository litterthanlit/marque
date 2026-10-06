import paper from 'paper'
import type { EditablePath, EditableShape } from '../path/editPath.ts'
import type { Contour } from '../vector/types.ts'
import { getLayerPathItem } from './compose.ts'
import type { IllustratorLayer } from './types.ts'

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
 * A layer's contours with its transform baked in, as plain data, in the
 * order the document holds them. Direct edits work on these and write the
 * result back: the whole shape, or one contour of it.
 */
export function bakedEditableShape(layer: IllustratorLayer): EditableShape | null {
  const s = getScope()
  s.project.clear()
  const item = getLayerPathItem(s, layer, true)
  if (!item) return null
  const paths =
    item instanceof s.Path
      ? [item]
      : item.getItems({ class: s.Path }).filter((p): p is paper.Path => p instanceof s.Path)
  const shape = paths
    .filter((path) => path.segments.length > 0)
    .map(
      (path): EditablePath => ({
        closed: path.closed,
        segs: path.segments.map((seg) => ({
          p: { x: seg.point.x, y: seg.point.y },
          hIn: seg.handleIn.isZero() ? null : { x: seg.handleIn.x, y: seg.handleIn.y },
          hOut: seg.handleOut.isZero() ? null : { x: seg.handleOut.x, y: seg.handleOut.y },
        })),
      }),
    )
  s.project.clear()
  return shape.length ? shape : null
}

/** A layer of one contour as a single editable path; null for a layer of several. */
export function bakedEditablePath(layer: IllustratorLayer): EditablePath | null {
  const shape = bakedEditableShape(layer)
  return shape?.length === 1 ? shape[0] : null
}

/**
 * Contours as an editable shape, read without paper: it never switches the
 * active scope, so a component can measure an object as it renders.
 */
export function editableShapeOf(contours: readonly Contour[]): EditableShape {
  return contours.map((contour) => ({
    closed: contour.closed,
    segs: contour.segments.map((seg) => ({ p: seg.point, hIn: seg.handleIn, hOut: seg.handleOut })),
  }))
}
