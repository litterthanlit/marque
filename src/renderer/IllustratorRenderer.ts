import type { DissolutionResult } from '../engine/effects/types.ts'
import type { IllustratorDocument, MarkData } from '../engine/illustrator/types.ts'
import { composeIllustratorMark, getLayerPathItem } from '../engine/illustrator/compose.ts'
import type { SurvivalResult } from '../engine/carve/survival.ts'
import { renderDissolution } from './FinalView.ts'

interface IllustratorRenderOptions {
  fillColor: string
  dissolution?: DissolutionResult | null
  survival?: SurvivalResult | null
  /** The composed mark, shared with previews and export. Composed here only if missing. */
  mark?: MarkData | null
}

export interface IllustratorRenderCache {
  items: Map<string, paper.Item>
}

export function createIllustratorRenderCache(): IllustratorRenderCache {
  return { items: new Map() }
}

const INK_ITEM_NAME = '__illustrator_ink'
const SURVIVAL_ITEM_NAME = '__survival'
// Hit areas must have a fill to be hit-tested, but should not be seen:
// what you see is the composed ink, exactly as it exports.
const HIT_AREA_ALPHA = 0.001

function getCenter(scope: paper.PaperScope): paper.Point {
  return scope.view.center
}

/**
 * Draw Vector Maker: the composed ink, the weak-spot overlay, and one
 * invisible hit area per layer (named by layer id) for the editor to test
 * against. Editing overlays are drawn by the editor on its own layer.
 */
export function renderIllustratorOnScope(
  scope: paper.PaperScope,
  doc: IllustratorDocument,
  options: IllustratorRenderOptions,
  cache?: IllustratorRenderCache,
): Map<string, paper.Item> {
  // Compose (if needed) first: it runs in its own headless scope and leaves that one active.
  const mark = options.dissolution ? null : options.mark !== undefined ? options.mark : composeIllustratorMark(doc)

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

  // Always present, even when empty, so live previews have something to update.
  const ink = new scope.CompoundPath(mark?.compoundPathData ?? '')
  ink.name = INK_ITEM_NAME
  ink.fillRule = 'evenodd'
  ink.fillColor = new scope.Color(options.fillColor)
  ink.translate(center)

  if (options.survival && options.survival.weakRatio > 0) {
    const { overlay, bounds } = options.survival
    const raster = new scope.Raster(overlay)
    raster.name = SURVIVAL_ITEM_NAME
    raster.bounds = new scope.Rectangle(bounds.x + center.x, bounds.y + center.y, bounds.width, bounds.height)
    raster.opacity = 0.9
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue
    const item = getLayerPathItem(scope, layer, true)
    if (!item) continue
    item.translate(center)
    item.name = layer.id
    item.fillColor = new scope.Color(0, 0, 0, HIT_AREA_ALPHA)
    item.strokeColor = null
    item.data = { illustratorLayerId: layer.id, operation: layer.operation }
    itemMap.set(layer.id, item)
    cache?.items.set(layer.id, item)
  }

  scope.view.update()
  return itemMap
}

const inkFilters = new WeakMap<paper.PaperScope, (pathData: string) => string>()

/**
 * A look applied to every live frame of the ink (imperfection), so drags and
 * carves preview the mark as it will render. Pass null to draw the ink as is.
 */
export function setInkFilter(scope: paper.PaperScope, filter: ((pathData: string) => string) | null): void {
  if (filter) inkFilters.set(scope, filter)
  else inkFilters.delete(scope)
}

/** Replace the drawn ink (layer-space path data) without a full re-render. */
export function setInkPathData(scope: paper.PaperScope, pathData: string): void {
  const filter = inkFilters.get(scope)
  // The filter may use its own headless scope: run it before activating ours.
  const shown = filter ? filter(pathData) : pathData
  scope.activate()
  const ink = scope.project.getItem({ name: INK_ITEM_NAME }) as paper.CompoundPath | null
  if (!ink) return
  ink.pathData = shown
  ink.translate(scope.view.center)
  scope.view.update()
}

export function getInkItem(scope: paper.PaperScope): paper.PathItem | null {
  return (scope.project.getItem({ name: INK_ITEM_NAME }) as paper.PathItem | null) ?? null
}

/** Weak-spot highlights describe the committed mark, so they hide during a drag. */
export function setSurvivalVisible(scope: paper.PaperScope, visible: boolean): void {
  const raster = scope.project.getItem({ name: SURVIVAL_ITEM_NAME })
  if (raster) raster.visible = visible
}

/**
 * Recompose and redraw only the ink — used while dragging so the mark updates
 * live without committing an undo step on every mouse move.
 */
export function refreshIllustratorInk(scope: paper.PaperScope, doc: IllustratorDocument): void {
  const mark = composeIllustratorMark(doc)
  setInkPathData(scope, mark?.compoundPathData ?? '')
}
