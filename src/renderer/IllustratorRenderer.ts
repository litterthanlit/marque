import type { IllustratorDocument, MarkData } from '../engine/illustrator/types.ts'
import { composeIllustratorMark, getLayerPathItem } from '../engine/illustrator/compose.ts'
import type { SurvivalResult } from '../engine/carve/survival.ts'
import type { CanvasLook } from '../store/logoStore.ts'
import type { Guide } from '../engine/vector/types.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { bandOuterPathData, carveOutline, polygonParts } from '../engine/carve/outline.ts'
import type { BandSpec, CarveSpec } from '../engine/carve/spec.ts'
import { bandParts } from '../engine/carve/band.ts'
import { asCircle } from '../engine/geometry/asCircle.ts'
import { guidePrimitives, intersectPrimitives } from '../engine/geometry/primitives.ts'
import type { ResolvedFillet } from '../engine/fillet/apply.ts'
import type { Vec } from '../engine/path/bezier.ts'
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
const FILLETS_ITEM_NAME = '__construction_fillets'
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
  noFit: { color: '#d93036', width: 1, dash: [4, 3] },
  /** A centre: a ring that knocks out the lines under it, around a dot, in widths across. */
  centre: { color: '#444444', ring: 7, knockOut: 5, dot: 2 },
  /** A fillet's circle: whole, solid at a concave corner and dashed at a convex one; red and dashed while it has lost its corner. */
  fillet: { color: '#a3a3a3', width: 0.75, dash: [4, 3], lost: '#d93036' },
  /** An open circle where a band or a fillet touches, and a small square at a sharp corner of the ink or where guides cross, in widths across. */
  point: { color: '#8a8a8a', outer: 6, inner: 4.25 },
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
    renderCentreMarks(scope, doc.layers, outline)
    // After the centres and vertices, whose marks a crossing of guides at the same place gives way to.
    renderGuides(scope, options.guides ?? null, doc.layers)
    setFilletMarks(scope, mark.fillets ?? null)
    scaleConstructionLines(scope)
  } else {
    // The final look draws no fillet circles, and no vertex squares.
    drawnFillets = []
    sheetVertices = []
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
  for (const name of [MARKS_ITEM_NAME, CENTRES_ITEM_NAME, FILLETS_ITEM_NAME]) {
    const marks = scope.project.getItem({ name })
    for (const group of marks?.children ?? []) scaleMarks(group, u)
  }
  // Where guides cross, a small square among them, and where a guide touches its circle, an open circle.
  for (const item of guides?.children ?? []) if ((item.data as { pointMarks?: true }).pointMarks) scaleMarks(item, u)
}

/** Give a group of construction marks their widths at `u` units to the CSS pixel. */
function scaleMarks(group: paper.Item, u: number): void {
  for (const item of group.children ?? []) {
    const mark = item.data as { cornerCircle?: true; centreWidth?: number; noFit?: true; filletLine?: 'solid' | 'dashed' }
    // Never under one device pixel, as guides.
    if (mark.cornerCircle) item.strokeWidth = guideWidth('solid') * u
    if (mark.centreWidth) item.strokeWidth = mark.centreWidth * u
    if (mark.noFit) {
      item.strokeWidth = CONSTRUCTION.noFit.width * u
      item.dashArray = CONSTRUCTION.noFit.dash.map((length) => length * u)
    }
    if (mark.filletLine) {
      item.strokeWidth = guideWidth('solid') * u
      item.dashArray = mark.filletLine === 'dashed' ? CONSTRUCTION.fillet.dash.map((length) => length * u) : []
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
 * The small marks the sheets carry, above the guides, whose spokes and
 * centre lines all cross at a centre, so a ring's white knocks them out;
 * below the mark's outline: a ringed dot at the centre of each polygon,
 * slab and circle made from a recipe, and an open circle where a band
 * touches its circles. Only the construction look draws them.
 */
function renderCentreMarks(scope: paper.PaperScope, layers: readonly IllustratorLayer[], outline: paper.Item): void {
  const group = new scope.Group({ insert: false })
  group.name = CENTRES_ITEM_NAME
  group.locked = true
  group.insertBelow(outline)
  const center = scope.view.center
  sheetVertices = []
  for (const layer of layers) {
    if (!layer.visible || !layer.carve) continue
    // A linked offset copy shares its source's centre and vertices: only the source marks them.
    const own = layer.link?.kind !== 'offset'
    const marks = [own ? centreMark(scope, layer.carve, center) : null, own ? vertexMarks(scope, layer.carve, center) : null, layer.link?.kind === 'band' ? touchMarks(scope, layer.carve, center) : null]
    for (const each of marks) {
      if (!each) continue
      each.data = { marksOf: layer.id }
      group.addChild(each)
    }
    if (own) for (const p of recipeVertices(layer.carve)) sheetVertices.push({ id: layer.id, p })
  }
}

/**
 * The corner points of a recipe's own construction, as the sheets square
 * them: a slab's four and a polygon's, at the vertex of the sharp shape
 * whether the corner is rounded or not. A circle has none, nor do other
 * recipes.
 */
export function recipeVertices(spec: CarveSpec): Vec[] {
  switch (spec.kind) {
    case 'slab': {
      if (asCircle({ carve: spec, contours: [] })) return []
      const turn = (spec.rotation * Math.PI) / 180
      const at = (x: number, y: number): Vec => ({ x: spec.center.x + x * Math.cos(turn) - y * Math.sin(turn), y: spec.center.y + x * Math.sin(turn) + y * Math.cos(turn) })
      const w = spec.width / 2
      const h = spec.height / 2
      return [at(-w, -h), at(w, -h), at(w, h), at(-w, h)]
    }
    case 'polygon':
      return polygonParts(spec).vertices
    default:
      return []
  }
}

/** A small square at each corner point of a recipe's own construction, about `center`; null when it has none. */
function vertexMarks(scope: paper.PaperScope, spec: CarveSpec, center: { x: number; y: number }): paper.Group | null {
  const vertices = recipeVertices(spec)
  if (!vertices.length) return null
  const marks = new scope.Group({ insert: false })
  for (const p of vertices) marks.addChildren(pointMark(scope, p, center, 'square'))
  return marks
}

/** The vertex squares the sheet draws, by the layer they mark, layer space. */
let sheetVertices: Array<{ id: string; p: Vec }> = []
/** The layers whose marks a gesture hides while it draws them live. */
let hiddenVertices: ReadonlySet<string> = new Set()
/** The vertex squares a gesture draws live, layer space. */
let liveVertices: Vec[] = []

/** Where the vertex squares show now, layer space, for the end-to-end checks: the sheet's, and a gesture's live ones in place of those it moves. */
export function vertexSquaresDrawn(): readonly Vec[] {
  return [...sheetVertices.filter((vertex) => !hiddenVertices.has(vertex.id)).map((vertex) => vertex.p), ...liveVertices]
}

/**
 * A ringed dot at the centre of a polygon, a slab or a circle made from a
 * recipe, about `center`, or null for other recipes. Each part is a round cap on a
 * line too short to see, so it scales by its width alone.
 */
function centreMark(scope: paper.PaperScope, spec: CarveSpec, center: { x: number; y: number }): paper.Group | null {
  const at = spec.kind === 'polygon' || spec.kind === 'slab' ? spec.center : asCircle({ carve: spec, contours: [] })?.c
  if (!at) return null
  const { color, ring, knockOut, dot } = CONSTRUCTION.centre
  const marks = new scope.Group({ insert: false })
  const point = new scope.Point(at.x + center.x, at.y + center.y)
  for (const [width, stroke] of [[ring, color], [knockOut, '#ffffff'], [dot, color]] as const) {
    const item = new scope.Path.Line({ from: point, to: point.add(new scope.Point(0.001, 0)), insert: false })
    item.strokeColor = new scope.Color(stroke)
    item.strokeCap = 'round'
    item.data = { centreWidth: width }
    marks.addChild(item)
  }
  return marks
}

/** An open circle at each point where a band touches its circles, about `center`. */
function touchMarks(scope: paper.PaperScope, spec: CarveSpec, center: { x: number; y: number }): paper.Group | null {
  const touches = spec.kind === 'band' ? (bandParts(spec)?.touches ?? []) : []
  if (!touches.length) return null
  const marks = new scope.Group({ insert: false })
  for (const touch of touches) marks.addChildren(pointMark(scope, touch, center, 'circle'))
  return marks
}

/**
 * A small mark at a point, about `center`: an open circle, or a small
 * square. Each is a cap on a line too short to see, grey round white, so it
 * scales by its width alone.
 */
function pointMark(scope: paper.PaperScope, p: Vec, center: { x: number; y: number }, shape: 'circle' | 'square'): paper.Item[] {
  const { color, outer, inner } = CONSTRUCTION.point
  const at = new scope.Point(p.x + center.x, p.y + center.y)
  return ([[outer, color], [inner, '#ffffff']] as const).map(([width, stroke]) => {
    const item = new scope.Path.Line({ from: at, to: at.add(new scope.Point(0.001, 0)), insert: false })
    item.strokeColor = new scope.Color(stroke)
    item.strokeCap = shape === 'circle' ? 'round' : 'square'
    item.data = { centreWidth: width }
    return item
  })
}

/**
 * Draw the fillets' circles, or none: each whole, in a neutral grey, solid
 * at a concave corner and dashed at a convex one, with an open circle where
 * it touches once the circle is 18 px across on screen; red and dashed
 * where its circle last was while its corner is gone. A circle under 6 px
 * across is not drawn. Above the ink, below the mark's outline. Only the
 * construction look draws them; a live frame of a drag draws its own over
 * them.
 */
export function setFilletMarks(scope: paper.PaperScope, fillets: readonly ResolvedFillet[] | null): void {
  scope.activate()
  const outline = scope.project.getItem({ name: OUTLINE_ITEM_NAME })
  let group = scope.project.getItem({ name: FILLETS_ITEM_NAME }) as paper.Group | null
  drawnFillets = []
  if (!outline) {
    group?.remove()
    return
  }
  if (!group) {
    group = new scope.Group({ insert: false })
    group.name = FILLETS_ITEM_NAME
    group.locked = true
    group.insertBelow(scope.project.getItem({ name: CENTRES_ITEM_NAME }) ?? outline)
  }
  group.removeChildren()
  const center = scope.view.center
  const u = unitsPerCssPixel(scope)
  for (const fillet of fillets ?? []) {
    // A circle a few pixels across reads as a bead on the outline, not a construction: it is left out.
    if ((2 * fillet.used) / u < CIRCLE_FROM_PX) continue
    const marks = new scope.Group({ insert: false })
    const c = fillet.centre
    const circle = new scope.Path.Circle({ center: new scope.Point(c.x + center.x, c.y + center.y), radius: fillet.used, insert: false })
    circle.fillColor = null
    circle.strokeColor = new scope.Color(fillet.lost ? CONSTRUCTION.fillet.lost : CONSTRUCTION.fillet.color)
    circle.data = { filletLine: fillet.lost || fillet.convex ? 'dashed' : 'solid' }
    marks.addChild(circle)
    // A small fillet's touch points would hide it: they show only on a circle three of their marks across.
    if (!fillet.lost && (2 * fillet.used) / u >= TOUCH_MARKS_FROM * CONSTRUCTION.point.outer) {
      for (const touch of fillet.touches) marks.addChildren(pointMark(scope, touch, center, 'circle'))
    }
    marks.data = { filletId: fillet.id }
    scaleMarks(marks, u)
    group.addChild(marks)
    drawnFillets.push({ id: fillet.id, line: fillet.lost ? 'lost' : fillet.convex ? 'dashed' : 'solid', color: (circle.strokeColor as paper.Color).toCSS(true) })
  }
  scope.view.update()
}

/** How many touch marks across, on screen, a fillet's circle must be for its touch points to be marked: 18 px. */
const TOUCH_MARKS_FROM = 3

/** How many pixels across, on screen, a fillet's circle must be to be drawn at all. */
const CIRCLE_FROM_PX = 6

/** How the fillets' circles were last drawn, for the end-to-end checks: each solid, dashed or lost, and its colour. */
let drawnFillets: Array<{ id: string; line: 'solid' | 'dashed' | 'lost'; color: string }> = []

export function filletMarksDrawn(): ReadonlyArray<{ id: string; line: 'solid' | 'dashed' | 'lost'; color: string }> {
  return drawnFillets
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
  liveVertices = []
  for (const spec of specs) {
    liveVertices.push(...recipeVertices(spec))
    for (const marks of [cornerCircleMarks(scope, spec, center), centreMark(scope, spec, center), vertexMarks(scope, spec, center)]) {
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
export function renderGuides(scope: paper.PaperScope, guides: readonly Guide[] | null, layers: readonly IllustratorLayer[] = []): void {
  scope.activate()
  const outline = scope.project.getItem({ name: OUTLINE_ITEM_NAME })
  let group = scope.project.getItem({ name: GUIDES_ITEM_NAME }) as paper.Group | null
  if (!outline) {
    group?.remove()
    sheetPoints = { crossings: [], touches: [] }
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
  const shown = (guides ?? []).filter((guide) => guide.visible)
  for (const guide of shown) {
    const item = guidePathItem(scope, guide.shape, { x: center.x, y: center.y }, rect)
    if (!item) continue
    styleGuideItem(scope, item, guide.style, u)
    item.data = { guideId: guide.id, guideStyle: guide.style }
    group.addChild(item)
  }
  const points = guidePointMarks(scope, shown, (id) => {
    const source = layers.find((layer) => layer.id === id)
    return source?.visible && source.carve ? asCircle({ carve: source.carve, contours: [] }) : null
  })
  if (points) group.addChild(points)
  scope.view.update()
}

/**
 * The marks guides make, as the sheets do: a small square where two shown
 * line guides cross about the mark (none where a centre or a vertex is
 * marked already), and an open circle where a straight guide made from a
 * circle's frame touches that circle, `circleOf` giving the circle a shape
 * is. Null when there are none. A drag that moves guides draws them again
 * from the guides as they are on its frame.
 */
export function guidePointMarks(scope: paper.PaperScope, shown: readonly Guide[], circleOf: (id: string) => { c: Vec; r: number } | null, live = false): paper.Group | null {
  const center = scope.view.center
  const rect = visibleLayerRect(scope)
  const u = unitsPerCssPixel(scope)
  // Crossings only about the mark, as the sheets mark them, and none where a centre or a vertex is marked already.
  const ink = scope.project.getItem({ name: INK_ITEM_NAME })
  const near = ink && !ink.isEmpty() ? ink.bounds : null
  const grow = near ? 0.1 * Math.max(near.width, near.height) : 0
  const around = near && {
    minX: Math.max(rect.minX, near.left - center.x - grow),
    minY: Math.max(rect.minY, near.top - center.y - grow),
    maxX: Math.min(rect.maxX, near.right - center.x + grow),
    maxY: Math.min(rect.maxY, near.bottom - center.y + grow),
  }
  const marked = markedPoints(scope)
  const crossings = around ? guideCrossings(shown, around).filter((p) => !marked.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < MERGE_PX * u)) : []
  const touches = circleTouches(shown, circleOf)
  if (live) livePoints = { crossings, touches }
  else sheetPoints = { crossings, touches }
  if (!crossings.length && !touches.length) return null
  const points = new scope.Group({ insert: false })
  for (const p of crossings) points.addChildren(pointMark(scope, p, center, 'square'))
  for (const p of touches) points.addChildren(pointMark(scope, p, center, 'circle'))
  points.data = { pointMarks: true }
  scaleMarks(points, u)
  return points
}

/** Where guides cross and touch their circles, layer space, as the sheet marks them and as a gesture moving guides marks them. */
interface GuidePoints {
  crossings: Vec[]
  touches: Vec[]
}

let sheetPoints: GuidePoints = { crossings: [], touches: [] }
let livePoints: GuidePoints | null = null

/** Where the canvas last marked guides crossing and touching their circles, layer space: a live frame's while a gesture moves guides. */
export function guidePointsDrawn(): GuidePoints {
  return livePoints ?? sheetPoints
}

/**
 * How near, in CSS pixels, a crossing of guides may be to a centre or a
 * vertex already marked and give way to it: two marks' width, so two marks
 * never touch or crowd into one smudge.
 */
const MERGE_PX = 2 * CONSTRUCTION.point.outer

/** Where the centres and the recipes' vertices are marked, layer space. */
function markedPoints(scope: paper.PaperScope): Vec[] {
  const center = scope.view.center
  const points: Vec[] = []
  const visit = (item: paper.Item) => {
    if (item.children) for (const child of item.children) visit(child)
    else if (item instanceof scope.Path && item.firstSegment) points.push({ x: item.firstSegment.point.x - center.x, y: item.firstSegment.point.y - center.y })
  }
  for (const name of [CENTRES_ITEM_NAME]) {
    const group = scope.project.getItem({ name })
    if (group) visit(group)
  }
  return points
}

/**
 * Where each straight guide made from a circle's frame touches that circle,
 * as the sheets mark with an open circle: its top, bottom, left and right
 * lines, and any other line of it that runs along the circle.
 */
function circleTouches(guides: readonly Guide[], circleOf: (id: string) => { c: Vec; r: number } | null): Vec[] {
  const points: Vec[] = []
  for (const guide of guides) {
    if (guide.shape.kind !== 'line' || guide.link?.kind !== 'construction') continue
    const circle = circleOf(guide.link.of)
    if (!circle) continue
    const turn = (guide.shape.angle * Math.PI) / 180
    const along = { x: Math.cos(turn), y: Math.sin(turn) }
    const t = (circle.c.x - guide.shape.p.x) * along.x + (circle.c.y - guide.shape.p.y) * along.y
    const foot = { x: guide.shape.p.x + along.x * t, y: guide.shape.p.y + along.y * t }
    if (Math.abs(Math.hypot(foot.x - circle.c.x, foot.y - circle.c.y) - circle.r) <= 0.01 * Math.max(1, circle.r)) points.push(foot)
  }
  return points
}

/**
 * Is a guide a line of a frame: one drawn by hand, a side of a shape's
 * bounds, or a side of a tangent frame? The sheets square the corners of
 * frames, never where a centre line or a spoke meets another line.
 */
function isFrameLine(guide: Guide): boolean {
  if (guide.shape.kind !== 'line') return false
  const role = guide.link?.role
  return role === undefined || role === 'top' || role === 'right' || role === 'bottom' || role === 'left'
}

/** Where shown frame lines cross one another within `rect` (layer space), each point once. */
function guideCrossings(guides: readonly Guide[], rect: { minX: number; minY: number; maxX: number; maxY: number }): Vec[] {
  const points: Vec[] = []
  const pieces = guides.filter(isFrameLine).map((guide) => guidePrimitives(guide))
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      for (const a of pieces[i]) {
        for (const b of pieces[j]) {
          for (const p of intersectPrimitives(a, b)) {
            if (p.x < rect.minX || p.x > rect.maxX || p.y < rect.minY || p.y > rect.maxY) continue
            if (!points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.5)) points.push(p)
          }
        }
      }
    }
  }
  return points
}

/** Hide the drawn guides that a gesture redraws itself, as it previews them; show the rest. */
export function hideGuides(scope: paper.PaperScope, hidden: ReadonlySet<string>): void {
  if (!hidden.size) livePoints = null
  const group = scope.project.getItem({ name: GUIDES_ITEM_NAME })
  if (!group) return
  for (const item of group.children) {
    const data = item.data as { guideId?: string; pointMarks?: true }
    // The crossings and touch points would stay where the moving guides were: the gesture draws them again itself.
    if (data.pointMarks) item.opacity = hidden.size ? 0 : 1
    else item.opacity = data.guideId && hidden.has(data.guideId) ? 0 : 1
  }
}

/**
 * A drag that reshapes a layer leaves its hit area where the drag began, so
 * the layer's own outline would lag behind: the editor hides it meanwhile.
 */
export function hideLayerOutlines(items: Map<string, paper.Item>, hidden: Set<string>): void {
  hiddenVertices = new Set(hidden)
  liveVertices = []
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

/** Draw a composed mark in place of the one drawn, its fillets' circles too, without a full re-render. */
export function showMark(scope: paper.PaperScope, mark: MarkData): void {
  setInkPathData(scope, mark.compoundPathData)
  setFilletMarks(scope, mark.fillets ?? null)
}

/**
 * Draw a live frame of a gesture in place of the mark: its ink, and its
 * fillets' circles as the frame resolved them (null keeps those drawn).
 */
export function showFrame(scope: paper.PaperScope, ink: string, fillets: readonly ResolvedFillet[] | null): void {
  setInkPathData(scope, ink)
  if (fillets) setFilletMarks(scope, fillets)
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
