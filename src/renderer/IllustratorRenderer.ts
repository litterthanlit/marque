import type { IllustratorDocument, MarkData } from '../engine/illustrator/types.ts'
import { composeIllustratorMark, getLayerPathItem } from '../engine/illustrator/compose.ts'
import type { SurvivalResult } from '../engine/carve/survival.ts'
import type { CanvasLook } from '../store/logoStore.ts'
import { unitsPerCssPixel } from './viewFit.ts'

interface IllustratorRenderOptions {
  fillColor: string
  look: CanvasLook
  survival?: SurvivalResult | null
  /** The composed mark, shared with previews and export. Composed here only if missing. */
  mark?: MarkData
}

const INK_ITEM_NAME = '__illustrator_ink'
const OUTLINE_ITEM_NAME = '__illustrator_outline'
const SURVIVAL_ITEM_NAME = '__survival'
// Hit areas must have a fill to be hit-tested, but the fill should not be seen.
const HIT_AREA_ALPHA = 0.001

// A construction sheet: the mark in grey with a dark outline, the shapes it is
// built from as hairlines, the cutters dotted. Widths and dashes are CSS pixels.
export const CONSTRUCTION = {
  fill: '#e5e5e5',
  outline: { color: '#222222', width: 1.25 },
  add: { color: '#808080', width: 0.75, dash: [] as number[] },
  subtract: { color: '#444444', width: 1.25, dash: [1.25, 2.75] },
}

/** What a shape still being drawn previews in: the ink, or the construction sheet's line colour. */
export function previewColor(look: CanvasLook, inkColor: string): string {
  return look === 'construction' ? CONSTRUCTION.outline.color : inkColor
}

function getCenter(scope: paper.PaperScope): paper.Point {
  return scope.view.center
}

/**
 * Draw Vector Maker: the composed mark, the weak-spot overlay, and one hit
 * area per layer (named by layer id) for the editor to test against. The
 * final look is the solid ink, exactly as it exports. The construction look
 * also strokes each layer's own outline, with the mark's outline on top.
 * Editing overlays are drawn by the editor on its own layer.
 */
export function renderIllustratorOnScope(
  scope: paper.PaperScope,
  doc: IllustratorDocument,
  options: IllustratorRenderOptions,
): Map<string, paper.Item> {
  // Compose (if needed) first: it runs in its own headless scope and leaves that one active.
  const mark = options.mark ?? composeIllustratorMark(doc)

  scope.activate()
  scope.project.clear()

  const center = getCenter(scope)
  const itemMap = new Map<string, paper.Item>()

  const construction = options.look === 'construction'
  // Always present, even when empty, so live previews have something to update.
  const ink = new scope.CompoundPath(mark.compoundPathData)
  ink.name = INK_ITEM_NAME
  ink.fillRule = 'evenodd'
  ink.fillColor = new scope.Color(construction ? CONSTRUCTION.fill : options.fillColor)
  ink.translate(center)

  if (construction && options.survival && options.survival.weakRatio > 0) {
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
    item.strokeColor = construction ? new scope.Color(CONSTRUCTION[layer.operation].color) : null
    item.data = { illustratorLayerId: layer.id, operation: layer.operation }
    itemMap.set(layer.id, item)
  }

  if (construction) {
    // Above the layers' own lines: where they run along the mark's edge, the edge wins.
    const outline = ink.clone({ insert: false })
    outline.name = OUTLINE_ITEM_NAME
    outline.fillColor = null
    outline.strokeColor = new scope.Color(CONSTRUCTION.outline.color)
    outline.locked = true
    ink.parent.addChild(outline)
    scaleConstructionLines(scope)
  }

  scope.view.update()
  return itemMap
}

/** Give construction lines their weight on screen at the view's current size. */
export function scaleConstructionLines(scope: paper.PaperScope): void {
  const outline = scope.project.getItem({ name: OUTLINE_ITEM_NAME })
  if (!outline) return
  const u = unitsPerCssPixel(scope)
  outline.strokeWidth = CONSTRUCTION.outline.width * u
  for (const item of outline.parent.children) {
    const operation = (item.data as { operation?: 'add' | 'subtract' }).operation
    if (!operation) continue
    const line = CONSTRUCTION[operation]
    item.strokeWidth = line.width * u
    item.dashArray = line.dash.map((length) => length * u)
  }
}

/**
 * A drag that reshapes a layer leaves its hit area where the drag began, so
 * the layer's own outline would lag behind: the editor hides it meanwhile.
 */
export function hideLayerOutlines(items: Map<string, paper.Item>, hidden: Set<string>): void {
  for (const [id, item] of items) item.opacity = hidden.has(id) ? 0 : 1
}

/** Replace the drawn mark (layer-space path data) without a full re-render. */
export function setInkPathData(scope: paper.PaperScope, pathData: string): void {
  scope.activate()
  for (const name of [INK_ITEM_NAME, OUTLINE_ITEM_NAME]) {
    const item = scope.project.getItem({ name }) as paper.CompoundPath | null
    if (!item) continue
    item.pathData = pathData
    item.translate(scope.view.center)
  }
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
