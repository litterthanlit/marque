import type { Cubic, Vec } from '../../engine/path/bezier.ts'
import type { EditableShape } from '../../engine/path/editPath.ts'
import type { CarveHandle } from '../../engine/carve/edit.ts'
import type { SnapHint } from '../../engine/snap/snapping.ts'

export const SELECTION_COLOR = '#3b82f6'
export const HINT_COLOR = '#ec4899'

// Layer units per CSS pixel: overlay marks keep a constant on-screen size
// whatever the view zoom.
let u = 1

export function setOverlayScale(unitsPerPx: number): void {
  u = unitsPerPx
}
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

export interface StrokeStyle {
  dashed?: boolean
  /** A dash pattern of its own, in CSS pixels, in place of `dashed`'s. */
  dash?: number[]
  /** Round ends, for a dotted line. */
  round?: boolean
  width?: number
  color?: string
  opacity?: number
}

function styleStroke(scope: paper.PaperScope, item: paper.Item, style: StrokeStyle) {
  item.fillColor = null
  item.strokeColor = new scope.Color(style.color ?? SELECTION_COLOR)
  item.strokeWidth = (style.width ?? 1.5) * u
  item.dashArray = style.dash ? style.dash.map((length) => length * u) : style.dashed ? [4 * u, 4 * u] : []
  if (style.round) item.strokeCap = 'round'
  item.opacity = style.opacity ?? 1
  item.locked = true
}

/**
 * A white halo under the stroke keeps outlines readable where an edge runs
 * along the black-on-white boundary of the ink.
 */
export function addWithHalo(scope: paper.PaperScope, layer: paper.Layer, item: paper.Item, style: StrokeStyle) {
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

/** Emphasise the curves that a drag would bend (or is bending), in layer space. */
export function drawCurves(scope: paper.PaperScope, layer: paper.Layer, curves: Cubic[], center: Vec) {
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  for (const c of curves) {
    const path = new scope.Path({ insert: false })
    const none = new scope.Point(0, 0)
    path.add(new scope.Segment(at(c[0]), none, new scope.Point(c[1].x - c[0].x, c[1].y - c[0].y)))
    path.add(new scope.Segment(at(c[3]), new scope.Point(c[2].x - c[3].x, c[2].y - c[3].y), none))
    path.strokeCap = 'round'
    addWithHalo(scope, layer, path, { width: 3 })
  }
}

/** Where a point is about to be added: a hollow dot that firms up when it lands. */
export function drawGhostPoint(scope: paper.PaperScope, layer: paper.Layer, point: Vec, center: Vec) {
  const size = 7 * u
  const square = new scope.Path.Rectangle({
    point: [point.x + center.x - size / 2, point.y + center.y - size / 2],
    size: [size, size],
    insert: false,
  })
  square.fillColor = new scope.Color('#ffffff')
  square.strokeColor = new scope.Color(SELECTION_COLOR)
  square.strokeWidth = 1.25 * u
  square.dashArray = [2 * u, 1.5 * u]
  square.locked = true
  layer.addChild(square)
}

/** Snap hints: pink alignment lines, and a cross where the geometry landed. */
export function drawSnapHints(scope: paper.PaperScope, layer: paper.Layer, hints: SnapHint[], center: Vec) {
  const pink = new scope.Color(HINT_COLOR)
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  for (const hint of hints) {
    if (hint.kind === 'line') {
      const line = new scope.Path.Line({ from: at(hint.a), to: at(hint.b), insert: false })
      line.strokeColor = pink
      line.strokeWidth = u
      line.dashArray = [3 * u, 3 * u]
      line.locked = true
      layer.addChild(line)
      continue
    }
    const p = at(hint.p)
    const r = 4 * u
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
    ]) {
      const arm = new scope.Path.Line({
        from: p.add(new scope.Point(-r * dx, -r * dy)),
        to: p.add(new scope.Point(r * dx, r * dy)),
        insert: false,
      })
      arm.strokeColor = pink
      arm.strokeWidth = 1.5 * u
      arm.locked = true
      layer.addChild(arm)
    }
  }
}

/** One anchor of a free shape: point `index` on contour `contourIndex`. */
export interface AnchorAt {
  contourIndex: number
  index: number
}

/**
 * Anchors of a free shape, on every contour; the selected one is filled and
 * shows its handles. They are smaller and lighter than the resize squares
 * of a box, which sit close by at every corner, so the two never read as one
 * family. They turn by `turn` (the shape's frame), so they square up with
 * the box's handles.
 */
export function drawAnchors(
  scope: paper.PaperScope,
  layer: paper.Layer,
  shape: EditableShape,
  center: Vec,
  selected: AnchorAt | null,
  hover: AnchorAt | null,
  turn = 0,
) {
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  const seg = selected ? shape[selected.contourIndex]?.segs[selected.index] : undefined
  if (seg) {
    for (const h of [seg.hIn, seg.hOut]) {
      if (!h) continue
      const end = at({ x: seg.p.x + h.x, y: seg.p.y + h.y })
      const line = new scope.Path.Line(at(seg.p), end)
      line.strokeColor = new scope.Color(SELECTION_COLOR)
      line.strokeWidth = u
      line.locked = true
      layer.addChild(line)
      const dot = new scope.Path.Circle(end, 3.5 * u)
      dot.fillColor = new scope.Color('#ffffff')
      dot.strokeColor = new scope.Color(SELECTION_COLOR)
      dot.strokeWidth = 1.25 * u
      dot.locked = true
      layer.addChild(dot)
    }
  }
  const is = (anchor: AnchorAt | null, contourIndex: number, i: number) =>
    anchor !== null && anchor.contourIndex === contourIndex && anchor.index === i
  shape.forEach((path, contourIndex) =>
    path.segs.forEach((each, i) => {
      const chosen = is(selected, contourIndex, i)
      const size = (chosen || is(hover, contourIndex, i) ? 8 : 6.5) * u
      const square = new scope.Path.Rectangle({
        point: [each.p.x + center.x - size / 2, each.p.y + center.y - size / 2],
        size: [size, size],
      })
      if (turn) square.rotate(turn, at(each.p))
      square.fillColor = new scope.Color(chosen ? SELECTION_COLOR : '#ffffff')
      square.strokeColor = new scope.Color(SELECTION_COLOR)
      square.strokeWidth = 1.25 * u
      square.locked = true
      layer.addChild(square)
    }),
  )
}

/**
 * Handles of the selection: resize squares on a frame just outside the
 * shape, a rounding dot, a rotate dot on a short stem, end points and a width
 * dot for grooves. The frame line ties the handles together visually. Resize
 * squares turn with their box and stand out with a soft shadow, larger than
 * a free shape's anchors.
 */
export function drawCarveHandles(
  scope: paper.PaperScope,
  layer: paper.Layer,
  handles: CarveHandle[],
  center: Vec,
  hoverId: string | null,
) {
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  const byId = new Map(handles.map((h) => [h.id, h]))
  const blue = new scope.Color(SELECTION_COLOR)
  const white = new scope.Color('#ffffff')

  const corners = (['nw', 'ne', 'se', 'sw'] as const).map((id) => byId.get(id)).filter((h): h is CarveHandle => Boolean(h))
  if (corners.length === 4) {
    const frame = new scope.Path({ segments: corners.map((h) => at(h.at)), closed: true })
    frame.strokeColor = blue
    frame.strokeWidth = u
    frame.opacity = 0.55
    frame.locked = true
    layer.addChild(frame)
  }

  // The rotate stem starts at the top edge's handle, or the middle of the top edge if that's hidden.
  const rotate = byId.get('rotate')
  if (rotate) {
    const top = byId.get('n')
    const anchor = top
      ? at(top.at)
      : corners.length === 4
        ? at({ x: (corners[0].at.x + corners[1].at.x) / 2, y: (corners[0].at.y + corners[1].at.y) / 2 })
        : null
    if (anchor) {
      const stem = new scope.Path.Line(anchor, at(rotate.at))
      stem.strokeColor = blue
      stem.strokeWidth = u
      stem.locked = true
      layer.addChild(stem)
    }
  }

  const width = byId.get('width')
  const from = byId.get('from')
  const to = byId.get('to')
  if (width && from && to) {
    const mid = at({ x: (from.at.x + to.at.x) / 2, y: (from.at.y + to.at.y) / 2 })
    const stem = new scope.Path.Line(mid, at(width.at))
    stem.strokeColor = blue
    stem.strokeWidth = u
    stem.dashArray = [3 * u, 3 * u]
    stem.locked = true
    layer.addChild(stem)
  }

  for (const handle of handles) {
    const hot = handle.id === hoverId
    const p = at(handle.at)
    let shape: paper.Path
    if (handle.kind === 'resize' || handle.kind === 'scale') {
      const size = (hot ? 9.5 : 8) * u
      shape = new scope.Path.Rectangle({ point: [p.x - size / 2, p.y - size / 2], size: [size, size] })
      if (handle.turn) shape.rotate(handle.turn, p)
      shape.fillColor = white
      // Canvas shadows ignore the view's scale: the blur is given in device pixels.
      shape.shadowColor = new scope.Color(0, 0, 0, 0.28)
      shape.shadowBlur = 3 * scope.view.pixelRatio
    } else if (handle.kind === 'radius') {
      shape = new scope.Path.Circle(p, (hot ? 5.5 : 4.5) * u)
      shape.fillColor = blue
    } else if (handle.kind === 'endpoint') {
      shape = new scope.Path.Circle(p, (hot ? 6 : 5) * u)
      shape.fillColor = white
    } else {
      shape = new scope.Path.Circle(p, (hot ? 5 : 4) * u)
      shape.fillColor = white
    }
    shape.strokeColor = handle.kind === 'radius' ? white : blue
    shape.strokeWidth = 1.5 * u
    shape.locked = true
    layer.addChild(shape)
  }
}

/**
 * The selected guide's handles: a line's turning knob on a stem from its
 * pivot, or a circle's four radius squares, styled as a recipe's are.
 */
export function drawGuideHandles(
  scope: paper.PaperScope,
  layer: paper.Layer,
  handles: ReadonlyArray<{ id: string; at: Vec; pivot: Vec }>,
  center: Vec,
  hoverId: string | null,
) {
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  const blue = new scope.Color(SELECTION_COLOR)
  const white = new scope.Color('#ffffff')
  for (const handle of handles) {
    const hot = handle.id === hoverId
    let shape: paper.Path
    if (handle.id === 'rotate') {
      const stem = new scope.Path.Line(at(handle.pivot), at(handle.at))
      stem.strokeColor = blue
      stem.strokeWidth = u
      stem.locked = true
      layer.addChild(stem)
      const pivot = new scope.Path.Circle(at(handle.pivot), 2.5 * u)
      pivot.fillColor = blue
      pivot.locked = true
      layer.addChild(pivot)
      shape = new scope.Path.Circle(at(handle.at), (hot ? 5 : 4) * u)
    } else {
      const size = (hot ? 9.5 : 8) * u
      const p = at(handle.at)
      shape = new scope.Path.Rectangle({ point: [p.x - size / 2, p.y - size / 2], size: [size, size] })
      shape.shadowColor = new scope.Color(0, 0, 0, 0.28)
      shape.shadowBlur = 3 * scope.view.pixelRatio
    }
    shape.fillColor = white
    shape.strokeColor = blue
    shape.strokeWidth = 1.5 * u
    shape.locked = true
    layer.addChild(shape)
  }
}
