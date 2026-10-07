import type { IllustratorDocument, MarkData } from '../engine/illustrator/types.ts'
import { composeIllustratorMark, getLayerPathItem } from '../engine/illustrator/compose.ts'
import type { SurvivalResult } from '../engine/carve/survival.ts'
import type { CanvasLook } from '../store/logoStore.ts'
import type { Guide } from '../engine/vector/types.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { bandOuterPathData, carveOutline } from '../engine/carve/outline.ts'
import type { BandSpec, CarveSpec } from '../engine/carve/spec.ts'
import { unitsPerCssPixel } from './viewFit.ts'
import { guidePathItem, guideWidth, styleGuideItem, visibleLayerRect } from './guideItems.ts'

interface IllustratorRenderOptions {
  fillColor: string
  look: CanvasLook
  survival?: SurvivalResult | null
  /** The composed mark, shared with previews and export. Composed here only if missing. */
  mark?: MarkData
  /** The guides to draw, or null while they are hidden. They draw only in the construction look. */
  guides?: readonly Guide[] | null
}

const INK_ITEM_NAME = '__illustrator_ink'
const OUTLINE_ITEM_NAME = '__illustrator_outline'
const SURVIVAL_ITEM_NAME = '__survival'
const GUIDES_ITEM_NAME = '__guides'
const MARKS_ITEM_NAME = '__construction_marks'
const CENTRES_ITEM_NAME = '__construction_centres'
// Hit areas must have a fill to be hit-tested, but the fill should not be seen.
const HIT_AREA_ALPHA = 0.001

// A construction sheet: the mark in grey with a dark outline, the shapes it is
// built from as hairlines, the cutters dotted. Widths and dashes are CSS pixels.
export const CONSTRUCTION = {
  fill: '#e5e5e5',
  outline: { color: '#222222', width: 1.25 },
  add: { color: '#808080', width: 0.75, dash: [] as number[] },
  subtract: { color: '#444444', width: 1.25, dash: [1.25, 2.75] },
  /** A corner's circle: the faintest line on the sheet, lighter than any guide. */
  cornerCircle: { color: '#c8c8c8', width: 0.75 },
  /** A band its circles allow no fit: a dashed red line between their centres, where it would be. */
  noFit: { color: '#e11d48', width: 1, dash: [4, 3] },
  /** A centre: a ring that knocks out the lines under it, around a dot, in widths across. */
  centre: { color: '#444444', ring: 7, knockOut: 5, dot: 2 },
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
 * area per layer, tagged with its layer id, for the editor to test against. The
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
    // Found through the map and its data, never by name: paper refuses a name of digits alone, and an id may be one.
    item.fillColor = new scope.Color(0, 0, 0, HIT_AREA_ALPHA)
    item.strokeColor = construction ? new scope.Color(CONSTRUCTION[layer.operation].color) : null
    item.data = { illustratorLayerId: layer.id, operation: layer.operation }
    itemMap.set(layer.id, item)
    // A linked band's caps, ends and chords, and its sides' runs inside its circles, are buried in them: the sheet draws only what lies outside.
    const outer = construction && layer.carve?.kind === 'band' && layer.link?.kind === 'band' ? bandOuterPathData(layer.carve) : null
    if (outer !== null) item.strokeColor = null
    if (outer) {
      const edges = scope.PathItem.create(outer)
      edges.fillColor = null
      edges.strokeColor = new scope.Color(CONSTRUCTION[layer.operation].color)
      edges.data = { operation: layer.operation, edgesOf: layer.id }
      edges.locked = true
      edges.translate(center)
      edges.insertAbove(item)
    }
  }

  if (construction) {
    // Above the layers' own lines: where they run along the mark's edge, the edge wins.
    const outline = ink.clone({ insert: false })
    outline.name = OUTLINE_ITEM_NAME
    outline.fillColor = null
    outline.strokeColor = new scope.Color(CONSTRUCTION.outline.color)
    outline.locked = true
    ink.parent.addChild(outline)
    renderConstructionMarks(scope, doc.layers, outline)
    renderGuides(scope, options.guides ?? null)
    renderCentreMarks(scope, doc.layers, outline)
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
  const guides = scope.project.getItem({ name: GUIDES_ITEM_NAME })
  for (const item of guides?.children ?? []) {
    const style = (item.data as { guideStyle?: Guide['style'] }).guideStyle
    if (style) styleGuideItem(scope, item, style, u)
  }
  for (const name of [MARKS_ITEM_NAME, CENTRES_ITEM_NAME]) {
    const marks = scope.project.getItem({ name })
    for (const group of marks?.children ?? []) scaleMarks(group, u)
  }
}

/** Give a group of construction marks their widths at `u` units to the CSS pixel. */
function scaleMarks(group: paper.Item, u: number): void {
  for (const item of group.children ?? []) {
    const mark = item.data as { cornerCircle?: true; centreWidth?: number; noFit?: true }
    // Never under one device pixel, as guides.
    if (mark.cornerCircle) item.strokeWidth = guideWidth('solid') * u
    if (mark.centreWidth) item.strokeWidth = mark.centreWidth * u
    if (mark.noFit) {
      item.strokeWidth = CONSTRUCTION.noFit.width * u
      item.dashArray = CONSTRUCTION.noFit.dash.map((length) => length * u)
    }
  }
}

/**
 * The circles of a polygon's rounded corners and of a neck's arcs: solid
 * hairlines in the lightest grey on the sheet, so they never read as a guide
 * or an edge; and a red dashed line where a band its circles allow no fit
 * would be. Above the ink and the layers' own lines, below the guides and the mark's
 * outline. Only the construction look draws them; they never reach the ink,
 * the export or anything composed.
 */
function renderConstructionMarks(scope: paper.PaperScope, layers: readonly IllustratorLayer[], outline: paper.Item): void {
  const group = new scope.Group({ insert: false })
  group.name = MARKS_ITEM_NAME
  group.locked = true
  group.insertBelow(outline)
  for (const layer of layers) {
    // A band its circles allow no fit is marked where it would be, so it is not lost from the sheet.
    const lost = layer.visible && layer.carve?.kind === 'band' && layer.link?.kind === 'band' && !layer.pathData ? noFitMark(scope, layer.carve, scope.view.center) : null
    if (lost) {
      lost.data = { marksOf: layer.id }
      group.addChild(lost)
      continue
    }
    // A linked offset copy's corners share its source's centres: only the source draws them.
    const marks = layer.visible && layer.carve && layer.link?.kind !== 'offset' ? cornerCircleMarks(scope, layer.carve, scope.view.center) : null
    if (!marks) continue
    marks.data = { marksOf: layer.id }
    group.addChild(marks)
  }
}

/** A band with no fit as a dashed red line between its circles' centres, as last seen, about `center`. */
function noFitMark(scope: paper.PaperScope, spec: BandSpec, center: { x: number; y: number }): paper.Group {
  const marks = new scope.Group({ insert: false })
  const line = new scope.Path.Line({
    from: new scope.Point(spec.a.c.x + center.x, spec.a.c.y + center.y),
    to: new scope.Point(spec.b.c.x + center.x, spec.b.c.y + center.y),
    insert: false,
  })
  line.strokeColor = new scope.Color(CONSTRUCTION.noFit.color)
  line.data = { noFit: true }
  marks.addChild(line)
  return marks
}

/** A recipe's corner circles as a group of hairlines, about `center`, or null when its corners have none. */
function cornerCircleMarks(scope: paper.PaperScope, spec: CarveSpec, center: { x: number; y: number }): paper.Group | null {
  const frame = carveOutline(spec).frame
  // A polygon's corner circles, and a neck's arcs drawn whole, as ref 2 shows them.
  if (frame.kind === 'groove' || !frame.cornerCircles.length) return null
  const marks = new scope.Group({ insert: false })
  for (const circle of frame.cornerCircles) {
    const item = new scope.Path.Circle({ center: new scope.Point(circle.c.x + center.x, circle.c.y + center.y), radius: circle.r, insert: false })
    item.fillColor = null
    item.strokeColor = new scope.Color(CONSTRUCTION.cornerCircle.color)
    item.data = { cornerCircle: true }
    marks.addChild(item)
  }
  return marks
}

/**
 * A ringed dot at each polygon's centre, as the sheets mark one: above the
 * guides, whose spokes and centre lines all cross there, so the ring's white
 * knocks them out; below the mark's outline. Only the construction look
 * draws them.
 */
function renderCentreMarks(scope: paper.PaperScope, layers: readonly IllustratorLayer[], outline: paper.Item): void {
  const group = new scope.Group({ insert: false })
  group.name = CENTRES_ITEM_NAME
  group.locked = true
  group.insertBelow(outline)
  for (const layer of layers) {
    const marks = layer.visible && layer.carve ? centreMark(scope, layer.carve, scope.view.center) : null
    if (!marks) continue
    marks.data = { marksOf: layer.id }
    group.addChild(marks)
  }
}

/**
 * A polygon's ringed centre dot, about `center`, or null for other recipes.
 * Each part is a round cap on a line too short to see, so it scales by its
 * width alone.
 */
function centreMark(scope: paper.PaperScope, spec: CarveSpec, center: { x: number; y: number }): paper.Group | null {
  if (spec.kind !== 'polygon') return null
  const { color, ring, knockOut, dot } = CONSTRUCTION.centre
  const marks = new scope.Group({ insert: false })
  const at = new scope.Point(spec.center.x + center.x, spec.center.y + center.y)
  for (const [width, stroke] of [[ring, color], [knockOut, '#ffffff'], [dot, color]] as const) {
    const item = new scope.Path.Line({ from: at, to: at.add(new scope.Point(0.001, 0)), insert: false })
    item.strokeColor = new scope.Color(stroke)
    item.strokeCap = 'round'
    item.data = { centreWidth: width }
    marks.addChild(item)
  }
  return marks
}

/**
 * The construction marks of recipes a gesture is reshaping, drawn from
 * their live specs into `overlay`, as the sheet draws them: their own marks
 * hide meanwhile (see `hideLayerOutlines`), and would lag behind. Only in the
 * construction look; in the final look this does nothing.
 */
export function drawLiveConstructionMarks(scope: paper.PaperScope, overlay: paper.Layer, specs: Iterable<CarveSpec>, center: { x: number; y: number }): void {
  if (!scope.project.getItem({ name: OUTLINE_ITEM_NAME })) return
  const u = unitsPerCssPixel(scope)
  for (const spec of specs) {
    for (const marks of [cornerCircleMarks(scope, spec, center), centreMark(scope, spec, center)]) {
      if (!marks) continue
      marks.locked = true
      scaleMarks(marks, u)
      overlay.addChild(marks)
    }
  }
}

/**
 * Draw the guides, or none: above the ink and the layers' own lines, below
 * the mark's outline, so where a guide runs along the edge the edge wins.
 * Only the construction look draws them: in the final look there is no
 * outline to sit under, and this does nothing. Hidden guides do not draw.
 * Lines are clipped to the view, so call this again when the view changes.
 * Guides never reach the ink, the export or anything composed.
 */
export function renderGuides(scope: paper.PaperScope, guides: readonly Guide[] | null): void {
  scope.activate()
  const outline = scope.project.getItem({ name: OUTLINE_ITEM_NAME })
  let group = scope.project.getItem({ name: GUIDES_ITEM_NAME }) as paper.Group | null
  if (!outline) {
    group?.remove()
    return
  }
  if (!group) {
    group = new scope.Group({ insert: false })
    group.name = GUIDES_ITEM_NAME
    group.locked = true
    // Below the centres' rings, which knock the guides out.
    group.insertBelow(scope.project.getItem({ name: CENTRES_ITEM_NAME }) ?? outline)
  }
  group.removeChildren()
  const center = scope.view.center
  const rect = visibleLayerRect(scope)
  const u = unitsPerCssPixel(scope)
  for (const guide of guides ?? []) {
    if (!guide.visible) continue
    const item = guidePathItem(scope, guide.shape, { x: center.x, y: center.y }, rect)
    if (!item) continue
    styleGuideItem(scope, item, guide.style, u)
    item.data = { guideId: guide.id, guideStyle: guide.style }
    group.addChild(item)
  }
  scope.view.update()
}

/** Hide the drawn guides that a gesture redraws itself, as it previews them; show the rest. */
export function hideGuides(scope: paper.PaperScope, hidden: ReadonlySet<string>): void {
  const group = scope.project.getItem({ name: GUIDES_ITEM_NAME })
  if (!group) return
  for (const item of group.children) {
    const id = (item.data as { guideId?: string }).guideId
    item.opacity = id && hidden.has(id) ? 0 : 1
  }
}

/**
 * A drag that reshapes a layer leaves its hit area where the drag began, so
 * the layer's own outline would lag behind: the editor hides it meanwhile.
 */
export function hideLayerOutlines(items: Map<string, paper.Item>, hidden: Set<string>): void {
  for (const [id, item] of items) {
    item.opacity = hidden.has(id) ? 0 : 1
    // A band strokes its edges as an item of their own, just above it.
    const edges = item.nextSibling
    if ((edges?.data as { edgesOf?: string } | undefined)?.edgesOf === id) edges!.opacity = item.opacity
  }
  // A layer's construction marks would lag behind as well.
  const first = items.values().next().value
  for (const name of [MARKS_ITEM_NAME, CENTRES_ITEM_NAME]) {
    const marks = first?.project?.getItem({ name })
    for (const group of marks?.children ?? []) {
      const id = (group.data as { marksOf?: string }).marksOf
      group.opacity = id && hidden.has(id) ? 0 : 1
    }
  }
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
