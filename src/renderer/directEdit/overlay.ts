import type { Vec } from '../../engine/path/bezier.ts'
import type { EditablePath } from '../../engine/path/editPath.ts'

export const SELECTION_COLOR = '#3b82f6'
export const GUIDE_COLOR = '#ec4899'
const OVERLAY_NAME = '__overlay'

/** The editor's own layer, on top of everything, emptied for a redraw. */
export function resetOverlay(scope: paper.PaperScope): paper.Layer {
  scope.activate()
  let layer = scope.project.layers.find((candidate) => candidate.name === OVERLAY_NAME) as paper.Layer | undefined
  if (layer) {
    layer.removeChildren()
  } else {
    layer = new scope.Layer()
    layer.name = OVERLAY_NAME
  }
  layer.bringToFront()
  layer.activate()
  return layer
}

interface StrokeStyle {
  dashed?: boolean
  width?: number
  color?: string
  opacity?: number
}

function styleStroke(scope: paper.PaperScope, item: paper.Item, style: StrokeStyle) {
  item.fillColor = null
  item.strokeColor = new scope.Color(style.color ?? SELECTION_COLOR)
  item.strokeWidth = style.width ?? 1.5
  item.dashArray = style.dashed ? [4, 4] : []
  item.opacity = style.opacity ?? 1
  item.locked = true
}

/**
 * A white halo under the stroke keeps outlines readable where an edge runs
 * along the black-on-white boundary of the ink.
 */
function addWithHalo(scope: paper.PaperScope, layer: paper.Layer, item: paper.Item, style: StrokeStyle) {
  const halo = item.clone({ insert: false })
  layer.addChild(halo)
  styleStroke(scope, halo, { width: (style.width ?? 1.5) + 2, color: '#ffffff', opacity: 0.85 })
  layer.addChild(item)
  styleStroke(scope, item, style)
}

/** Trace an existing shape (a hit area) in the overlay. */
export function outlineItem(scope: paper.PaperScope, layer: paper.Layer, item: paper.Item, style: StrokeStyle = {}) {
  const copy = item.clone({ insert: false })
  copy.name = ''
  copy.data = {}
  addWithHalo(scope, layer, copy, style)
}

/** Trace path data given in layer space. */
export function outlinePathData(
  scope: paper.PaperScope,
  layer: paper.Layer,
  pathData: string,
  center: Vec,
  style: StrokeStyle = {},
) {
  if (!pathData) return
  const item = new scope.CompoundPath({ pathData, insert: false })
  item.translate(new scope.Point(center.x, center.y))
  addWithHalo(scope, layer, item, style)
}

/** Anchors of a free shape; the selected one is filled and shows its handles. */
export function drawAnchors(
  scope: paper.PaperScope,
  layer: paper.Layer,
  path: EditablePath,
  center: Vec,
  selectedIndex: number | null,
  hoverIndex: number | null,
) {
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  if (selectedIndex !== null && path.segs[selectedIndex]) {
    const seg = path.segs[selectedIndex]
    for (const h of [seg.hIn, seg.hOut]) {
      if (!h) continue
      const end = at({ x: seg.p.x + h.x, y: seg.p.y + h.y })
      const line = new scope.Path.Line(at(seg.p), end)
      line.strokeColor = new scope.Color(SELECTION_COLOR)
      line.strokeWidth = 1
      line.locked = true
      layer.addChild(line)
      const dot = new scope.Path.Circle(end, 3.5)
      dot.fillColor = new scope.Color('#ffffff')
      dot.strokeColor = new scope.Color(SELECTION_COLOR)
      dot.strokeWidth = 1.25
      dot.locked = true
      layer.addChild(dot)
    }
  }
  path.segs.forEach((seg, i) => {
    const size = i === hoverIndex || i === selectedIndex ? 8 : 6.5
    const square = new scope.Path.Rectangle({
      point: [seg.p.x + center.x - size / 2, seg.p.y + center.y - size / 2],
      size: [size, size],
    })
    square.fillColor = new scope.Color(i === selectedIndex ? SELECTION_COLOR : '#ffffff')
    square.strokeColor = new scope.Color(SELECTION_COLOR)
    square.strokeWidth = 1.25
    square.locked = true
    layer.addChild(square)
  })
}
