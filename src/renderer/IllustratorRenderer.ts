import type { DissolutionResult } from '../engine/effects/types.ts'
import type { IllustratorDocument, IllustratorLayer } from '../engine/illustrator/types.ts'
import { composeIllustratorMark, getLayerPathItem } from '../engine/illustrator/compose.ts'
import type { SurvivalResult } from '../engine/carve/survival.ts'
import { renderDissolution } from './FinalView.ts'

interface IllustratorRenderOptions {
  fillColor: string
  dissolution?: DissolutionResult | null
  survival?: SurvivalResult | null
}

const INK_ITEM_NAME = '__illustrator_ink'
// Hit areas must have a fill to be hit-tested, but should not be seen:
// what you see is the composed ink, exactly as it exports.
const HIT_AREA_ALPHA = 0.001

export interface IllustratorRenderCache {
  items: Map<string, paper.Item>
}

export function createIllustratorRenderCache(): IllustratorRenderCache {
  return { items: new Map() }
}

export interface IllustratorControlData {
  layerId: string
  segmentIndex: number
  handle: 'anchor' | 'in' | 'out'
}

function getCenter(scope: paper.PaperScope): paper.Point {
  return scope.view.center
}

function applyCanvasTranslation(item: paper.Item, center: paper.Point): void {
  item.translate(center)
}

export function layerCanvasPointToLocal(
  scope: paper.PaperScope,
  layer: IllustratorLayer,
  canvasPoint: paper.Point,
  canvasCenter: paper.Point,
): paper.Point {
  const baseItem = getLayerPathItem(scope, layer, false)
  const pivot = baseItem?.bounds.center ?? new scope.Point(0, 0)
  baseItem?.remove()

  let point = canvasPoint.subtract(canvasCenter)
  point = point.subtract(new scope.Point(layer.transform.dx, layer.transform.dy))

  if (layer.transform.rotation !== 0) {
    point = point.rotate(-layer.transform.rotation, pivot)
  }

  if (layer.transform.scale !== 1) {
    point = pivot.add(point.subtract(pivot).divide(layer.transform.scale))
  }

  return point
}

export function renderIllustratorOnScope(
  scope: paper.PaperScope,
  doc: IllustratorDocument,
  options: IllustratorRenderOptions,
  cache?: IllustratorRenderCache,
): Map<string, paper.Item> {
  // Compose first: it runs in its own headless scope and leaves that one active.
  const mark = options.dissolution ? null : composeIllustratorMark(doc)

  scope.activate()
  scope.project.clear()
  cache?.items.clear()

  const center = getCenter(scope)
  const itemMap = new Map<string, paper.Item>()

  if (options.dissolution) {
    renderDissolution(scope, options.dissolution, center, options.fillColor)
    scope.view.update()
    return itemMap
  }

  if (mark?.compoundPathData) {
    const ink = new scope.CompoundPath(mark.compoundPathData)
    ink.name = INK_ITEM_NAME
    ink.fillRule = 'evenodd'
    ink.fillColor = new scope.Color(options.fillColor)
    applyCanvasTranslation(ink, center)
  }

  if (options.survival && options.survival.weakRatio > 0) {
    const { overlay, bounds } = options.survival
    const raster = new scope.Raster(overlay)
    raster.bounds = new scope.Rectangle(bounds.x + center.x, bounds.y + center.y, bounds.width, bounds.height)
    raster.opacity = 0.9
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue
    const item = getLayerPathItem(scope, layer, true)
    if (!item) continue
    applyCanvasTranslation(item, center)
    item.name = layer.id
    item.fillColor = new scope.Color(0, 0, 0, HIT_AREA_ALPHA)
    item.strokeColor = null
    item.data = { illustratorLayerId: layer.id, operation: layer.operation }
    itemMap.set(layer.id, item)
    cache?.items.set(layer.id, item)
  }

  if (doc.mode !== 'object' || doc.selectedLayerIds.length > 1) {
    for (const layerId of doc.selectedLayerIds) {
      const item = itemMap.get(layerId)
      if (!item || !item.visible) continue
      new scope.Path.Rectangle({
        rectangle: item.bounds.expand(5),
        strokeColor: new scope.Color('#4A90D9'),
        strokeWidth: 1.25,
        dashArray: [4, 3],
        fillColor: null,
      })
    }
  }

  if (doc.mode === 'points' && doc.selectedLayerIds.length === 1) {
    const selectedLayer = doc.layers.find((layer) => layer.id === doc.selectedLayerIds[0])
    if (selectedLayer?.visible) {
      renderPointControls(scope, selectedLayer, center, doc.pointSelection)
    }
  }

  scope.view.update()
  return itemMap
}

/**
 * Recompose and redraw only the ink — used while dragging so the mark updates
 * live without committing an undo step on every mouse move.
 */
export function refreshIllustratorInk(scope: paper.PaperScope, doc: IllustratorDocument): void {
  const mark = composeIllustratorMark(doc)
  scope.activate()
  const ink = scope.project.getItem({ name: INK_ITEM_NAME }) as paper.CompoundPath | null
  if (!ink) return
  ink.pathData = mark?.compoundPathData ?? ''
  applyCanvasTranslation(ink, getCenter(scope))
  scope.view.update()
}

function renderPointControls(
  scope: paper.PaperScope,
  layer: IllustratorLayer,
  center: paper.Point,
  selection: IllustratorDocument['pointSelection'],
): void {
  const item = getLayerPathItem(scope, layer, true)
  if (!item) return
  applyCanvasTranslation(item, center)

  let segmentIndex = 0
  const paths = item.getItems({ class: scope.Path })
  for (const path of paths) {
    if (!(path instanceof scope.Path)) continue
    for (const segment of path.segments) {
      const anchor = segment.point
      const selectedAnchor =
        selection?.layerId === layer.id &&
        selection.segmentIndex === segmentIndex &&
        selection.handle === 'anchor'

      drawControl(scope, anchor, {
        layerId: layer.id,
        segmentIndex,
        handle: 'anchor',
      }, selectedAnchor, 4.5)

      if (segment.handleIn.length > 0) {
        const handlePoint = anchor.add(segment.handleIn)
        drawHandle(scope, anchor, handlePoint)
        drawControl(scope, handlePoint, {
          layerId: layer.id,
          segmentIndex,
          handle: 'in',
        }, selection?.segmentIndex === segmentIndex && selection.handle === 'in', 3.5)
      }

      if (segment.handleOut.length > 0) {
        const handlePoint = anchor.add(segment.handleOut)
        drawHandle(scope, anchor, handlePoint)
        drawControl(scope, handlePoint, {
          layerId: layer.id,
          segmentIndex,
          handle: 'out',
        }, selection?.segmentIndex === segmentIndex && selection.handle === 'out', 3.5)
      }

      segmentIndex += 1
    }
  }

  item.remove()
}

function drawHandle(scope: paper.PaperScope, from: paper.Point, to: paper.Point): void {
  const line = new scope.Path.Line(from, to)
  line.strokeColor = new scope.Color('#4A90D9')
  line.strokeWidth = 1
}

function drawControl(
  scope: paper.PaperScope,
  point: paper.Point,
  data: IllustratorControlData,
  selected: boolean,
  radius: number,
): void {
  const control = new scope.Path.Circle(point, radius)
  control.fillColor = new scope.Color(selected ? '#4A90D9' : '#ffffff')
  control.strokeColor = new scope.Color('#4A90D9')
  control.strokeWidth = 1.25
  control.data = { illustratorControl: data }
}
