import paper from 'paper'
import type { EditablePath } from '../path/editPath.ts'
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
