import {
  add,
  BEND_T_MAX,
  BEND_T_MIN,
  clamp,
  cubicPoint,
  distance,
  maxChordDeviation,
  normalizeDegrees,
  rotate,
  scale,
  sub,
  type Bounds,
  type Cubic,
  type Vec,
} from '../../engine/path/bezier.ts'
import {
  bendCurve,
  editablePathToPathData,
  insertPoint,
  isCurveStraight,
  moveAnchor,
  moveHandle,
  shapePathData,
  straightenCurve,
  translateShape,
  type EditablePath,
  type EditableShape,
} from '../../engine/path/editPath.ts'
import {
  bendCarve,
  carveHandles,
  carveUnderAffine,
  dragCarveHandle,
  isSideBent,
  RADIUS_DOT_RATE,
  rotateCarveAbout,
  scaleCarveAbout,
  straightenCarve,
  translateCarve,
  wholeCarveDrag,
  type CarveGrab,
  type CarveHandle,
  type HandleId,
  type HandleLayout,
} from '../../engine/carve/edit.ts'
import {
  boxFrameCorners,
  boxHandlePoint,
  evenFactorTo,
  evenScaleFloor,
  handleFraction,
  IDENTITY_AFFINE,
  isCornerHandle,
  resizeBox,
  rotateBox,
  rotationAbout,
  scaleBoxBy,
  scalesEvenly,
  scalingAbout,
  settleAngle,
  transformShape,
  wholeBoxResize,
  type Affine,
  type BoxResize,
  type OrientedBox,
} from '../../engine/box/box.ts'
import {
  carveKeyPoints,
  documentSizes,
  documentSnapIndex,
  freeBoxPoints,
  lineTouchHints,
  NO_SNAP,
  shapeContours,
  snapMoving,
  snapRadiusTangent,
  snapValue,
  type SnapHint,
  type SnapIndex,
  type SnapResult,
  type SnapTarget,
} from '../../engine/snap/snapping.ts'
import { asCircle, type Circle } from '../../engine/geometry/asCircle.ts'
import { roundPrimitives, tangentAtAngle, tangentThrough } from '../../engine/geometry/tangent.ts'
import { PIN_SLACK, recipeCentre, shapeCentre } from '../../engine/vector/pins.ts'
import { boxGeometryFor, carveOutline, grooveSpine, type SideRef } from '../../engine/carve/outline.ts'
import { bentEdgeCount, isGroove, polygonApothem, polygonCornerRadius, roundCarveSpec, type CarveSpec, type SlabSpec } from '../../engine/carve/spec.ts'
import { offsetRecipe, offsetsExactly } from '../../engine/carve/offset.ts'
import { followsAnyOf, offsetRoot } from '../../engine/vector/offsets.ts'
import { bandBetween, linkSources } from '../../engine/vector/bands.ts'
import { ancestorsOf, isInside, layerNumbers, parentsOf, selectionRoot } from '../../engine/vector/groups.ts'
import { bakedEditableShape } from '../../engine/illustrator/layerPath.ts'
import { createComposeSession, type ComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument, IllustratorLayer, MarkData } from '../../engine/illustrator/types.ts'
import { applyFillets, frameSources, type ResolvedFillet } from '../../engine/fillet/apply.ts'
import { filletCircles, filletDot, filletRadiusAt, filletSizes, radiusReadout, snapFilletRadius } from './filletEdit.ts'
import { filletRowHover } from './filletPreview.ts'
import { filletRadius, HISTORY_MERGE_MS, type AnchorRef, type HistoryMergeKind, type LayerEdit, type LayerEditCommit, type Refused } from '../../store/logoStore.ts'
import { drawLiveConstructionMarks, getInkItem, guidePointMarks, hideGuides, hideLayerOutlines, setSurvivalVisible, showFrame, showMark } from '../IllustratorRenderer.ts'
import type { Guide } from '../../engine/vector/types.ts'
import { constructionShape, guideAnchor, lineReading, lineShape, moveGuideShape, sameGuideShape, type GuideShape } from '../../engine/vector/guides.ts'
import { detachGuide } from '../../engine/vector/follow.ts'
import { pathDataToContours } from '../../engine/vector/pathSerialization.ts'
import { guideHandles, startOnGuides, type GuideHandle } from './guideEdit.ts'
import { GUIDE_LINE, guideDashAt, guidePathItem, styleGuideItem, visibleLayerRect } from '../guideItems.ts'
import { carriedCuts } from './carry.ts'
import { CURSORS, resizeCursor } from './cursors.ts'
import { hud } from './hud.ts'
import { REFUSAL_MS } from './refusal.ts'
import { EMPTY_ZONE, GUIDE_PX, findZone, freeCurve, zoneKey, type HitContext, type Zone } from './hitZones.ts'
import {
  boxHandleList,
  canvasPointer,
  groupOutline,
  hiddenRadiusDots,
  recipeFrame,
  scaledHandleLayout,
  selectionBox,
  selectionHandles,
  turnedGroupFrames,
  type HandleSet,
  type LiveHandles,
} from './handleSet.ts'
import { canvasOwnsArrowKeys, registerEditorKeys, setEditorInteracting } from './keyboard.ts'
import {
  drawAnchors,
  drawCarveHandles,
  drawFilletDot,
  drawCurves,
  addWithHalo,
  drawGhostPoint,
  drawGuideHandles,
  drawSnapHints,
  NO_FIT_COLOR,
  outlineCircle,
  outlineItem,
  outlinePathData,
  resetOverlay,
  setOverlayScale,
  type StrokeStyle,
} from './overlay.ts'
import { unitsPerCssPixel } from '../viewFit.ts'

export interface Modifiers {
  shift: boolean
  alt: boolean
  /** Cmd/Ctrl held: snapping off for this move. */
  noSnap: boolean
}

export type AnchorOp = 'toggle-smooth' | 'delete'

/** What the controller needs from the app, kept narrow so it can be tested and reused. */
export interface DirectEditHost {
  getDoc(): IllustratorDocument
  /** The committed mark, its fillets on (layer space), to restore after a cancelled gesture. */
  getMark(): MarkData
  /** The committed mark before its fillets: a fillet's radius is previewed on it. Missing is the mark itself. */
  getBaseMark?(): MarkData
  /** Do fillets draw on the canvas: the construction look? Missing is never. */
  filletsShown?(): boolean
  /** Select fillets, or none with null; `additive` toggles them among the selected fillets. */
  selectFillets?(ids: string[] | null, additive?: boolean): void
  /** A fillet's radius: one undo step. */
  setFilletRadius?(id: string, radius: number): void
  /** The panel's Snapping switch. */
  isSnapping(): boolean
  setSelection(ids: string[], anchor?: AnchorRef | null): void
  commitLayerEdits(commit: LayerEditCommit): void
  editAnchor(layerId: string, index: number, op: AnchorOp, contourIndex: number): void
  /** Are guides on the canvas: the construction look, with guides shown? Hidden guides take no presses. */
  guidesShown(): boolean
  /** Select guides, or none with null; `additive` toggles them among the selected guides. */
  selectGuides(ids: string[] | null, additive?: boolean): void
  /** The whole list of guides after a gesture: one undo step. */
  commitGuides(label: string, guides: Guide[], select?: string[]): void
  /** Move the selected guides that are shown and not locked by `d`: a burst of keys is one undo step. */
  nudgeGuides(d: Vec): void
  /** How far the floating bars cover the canvas from its top and its bottom, in CSS pixels. */
  coveredInsets?(): { top: number; bottom: number }
}

interface Session {
  update(p: Vec, mods: Modifiers): void
  commit(): void
  cancel(): void
  /** Layers the session draws itself (the controller skips their normal outline). */
  editedIds: Set<string>
  /** Guides the session draws itself: the drawn ones hide meanwhile. */
  guideIds?: Set<string>
  /** Where those guides are on the frame, for the marks where guides cross and touch their circles. */
  guideShapes?(): ReadonlyMap<string, GuideShape>
  drawOverlay(layer: paper.Layer): void
}

interface Press {
  point: Vec
  zone: Zone
  mods: Modifiers
  touch: boolean
}

type EdgeZone = Extract<Zone, { kind: 'edge' }>

/** A point about to be added where an edge was clicked, unless a double-click straightens it instead. */
interface PendingPoint {
  layerId: string
  /** The layer as it was clicked: if anything changes it first, the point is not added. */
  layer: IllustratorLayer
  contourIndex: number
  curveIndex: number
  t: number
  point: Vec
  timer: number
}

/** A move of some layers (and the cuts they carry), previewable and committable. */
interface MovePlan {
  preview(d: Vec): void
  /** Commit the move; `pins` pins (or with null lets go of) the recipes it names. */
  commit(d: Vec, pins?: Map<string, string | null>): void
  cancel(): void
  editedIds: Set<string>
  drawOverlay(layer: paper.Layer): void
  /** Points of the moved shapes (not the cuts they carry) that snap: corners, middles, centres. */
  keyPoints: Vec[]
  /** Which recipe's centre each key point is, if it is one that can be pinned. */
  keyCentres: Array<string | null>
  /** The one shape being moved, when it is a circle: it can snap to touch a line, an edge or a circle. */
  circle: Circle | null
}

/**
 * How a box gesture moves its members: free shapes take `affine`; recipes
 * scale evenly by `factor` about `pivot`, or turn by `turn` about `center`,
 * which is what `affine` does too.
 */
interface BoxMove {
  affine: Affine
  pivot: Vec
  factor: number
  turn: number
  center: Vec
}

/** A turn about a point: a box's centre, or where a burst of Alt+arrows turns. */
function turnMove(center: Vec, turn: number): BoxMove {
  return { affine: Math.abs(turn) > 1e-9 ? rotationAbout(center, turn) : IDENTITY_AFFINE, pivot: center, factor: 1, turn, center }
}

/** An even scale about a box's centre. */
function scaleMove(center: Vec, factor: number): BoxMove {
  return { affine: Math.abs(factor - 1) > 1e-9 ? scalingAbout(center, factor) : IDENTITY_AFFINE, pivot: center, factor, turn: 0, center }
}

/** A resize: an even one scales recipes too, by the factor of its width. */
function resizeMove(resized: BoxResize): BoxMove {
  const same = Math.abs(resized.sx - 1) <= 1e-9 && Math.abs(resized.sy - 1) <= 1e-9
  return { affine: same ? IDENTITY_AFFINE : resized.affine, pivot: resized.pivot, factor: resized.sx, turn: 0, center: resized.pivot }
}

/** Where a layer that an edit carries starts: its recipe, or its free shape and how far its frame is turned. */
interface MovedStart {
  carve?: CarveSpec
  path?: EditableShape
  frame: number
}

type Moved = { carve?: CarveSpec; path?: EditableShape }

/** A layer under an affine map: a free shape takes all of it, a recipe as much as keeps it a recipe. */
function underAffine(start: MovedStart, m: Affine): Moved {
  return start.carve ? { carve: carveUnderAffine(start.carve, m) } : { path: transformShape(start.path!, m) }
}

function movedPathData(next: Moved): string {
  return next.carve ? carveOutline(next.carve).pathData : shapePathData(next.path!)
}

/** The edit that stores a carried layer. A free shape turned by `turn` turns its frame with it. */
function movedEdit(layerId: string, start: MovedStart, next: Moved, turn: number): LayerEdit {
  if (next.carve) return { layerId, carve: next.carve }
  const pathData = shapePathData(next.path!)
  return Math.abs(turn) > 1e-9 ? { layerId, pathData, frameRotation: normalizeDegrees(start.frame + turn) } : { layerId, pathData }
}

/** Where the layers of a move start: the ones moved, then the cuts they carry. */
interface MoveStarts {
  starts: Map<string, { carve?: CarveSpec; path?: EditableShape }>
  carried: string[]
}

/** The commit that moves layers by `d`, leaving `ids` selected: the moved ones, not the cuts they carry. */
function moveCommit({ starts }: MoveStarts, ids: string[], d: Vec): LayerEditCommit {
  return {
    label: starts.size > 1 ? 'Move shapes' : 'Move',
    edits: [...starts.entries()].map(([layerId, start]) =>
      start.carve
        ? { layerId, carve: translateCarve(start.carve, d) }
        : { layerId, pathData: shapePathData(translateShape(start.path!, d)) },
    ),
    select: ids,
    anchor: null,
  }
}

/**
 * The members of a box, the cuts they carry along, and the bands between
 * them, whose settings it turns and scales as it does their circles: a
 * band whose circles are both carried takes the map as they do.
 */
interface BoxMembers {
  members: Map<string, MovedStart>
  carried: Map<string, MovedStart>
  bands: Map<string, MovedStart & { carried: boolean }>
}

/**
 * Every layer a box move changes, and where it goes. Recipes among the
 * members take only the even scale or the turn, so they stay recipes; a
 * carried recipe takes the similarity nearest the map.
 */
function boxMoved({ members, carried, bands }: BoxMembers, move: BoxMove): Array<{ id: string; from: MovedStart; next: Moved; carried: boolean }> {
  const member = (start: MovedStart): Moved => {
    if (!start.carve) return { path: transformShape(start.path!, move.affine) }
    const scaled = move.factor === 1 ? start.carve : scaleCarveAbout(start.carve, move.pivot, move.factor)
    return { carve: move.turn ? rotateCarveAbout(scaled, move.center, move.turn) : scaled }
  }
  return [
    ...[...members].map(([id, from]) => ({ id, from, next: member(from), carried: false })),
    ...[...carried].map(([id, from]) => ({ id, from, next: underAffine(from, move.affine), carried: true })),
    ...[...bands].map(([id, from]) => ({ id, from, next: from.carried ? underAffine(from, move.affine) : member(from), carried: true })),
  ]
}

function boxEdits(moved: BoxMembers, move: BoxMove): LayerEdit[] {
  return boxMoved(moved, move).map(({ id, from, next }) => movedEdit(id, from, next, move.turn))
}

/** How far outside a piece's frame the dashed box round the group it lies in goes, in CSS pixels. */
const ENTERED_GROUP_GAP_PX = 12

/** What the HUD says the first time a tap takes a whole group. */
const GROUP_TAP_HINT = 'Group selected: double-tap a piece to work on it alone'
/** How long it stays, three seconds to read its nine words: the next press takes it away sooner. */
const GROUP_TAP_HINT_MS = 3000

/**
 * The frames of the selected groups, and of the groups inside them, after a
 * turn of the selection that moved `moved`'s members: none for no turn.
 */
function groupFrameEdits(doc: IllustratorDocument, moved: BoxMembers, turn: number): LayerEdit[] {
  const ids = new Set([...moved.members.keys(), ...moved.carried.keys(), ...moved.bands.keys()])
  return turnedGroupFrames(doc, turn, ids).map(({ id, rotation }) => ({ layerId: id, frameRotation: rotation }))
}

/** The label of a box move's undo step. */
function boxLabel(turned: boolean, several: boolean): string {
  return turned ? (several ? 'Rotate shapes' : 'Rotate') : several ? 'Resize shapes' : 'Resize'
}

/** The members of a box, moved together by one map while a handle is dragged. */
interface BoxPlan {
  editedIds: Set<string>
  ids: string[]
  preview(move: BoxMove, box: OrientedBox, hotId: HandleId | null): void
  /** Commit the last preview as one undo step, or restore the ink if it changed nothing. */
  commit(label: string): void
  cancel(): void
  drawOverlay(layer: paper.Layer): void
}

/** The same recipe with every bend removed: drawn dashed behind a bent shape. */
function unbent(spec: CarveSpec): CarveSpec {
  switch (spec.kind) {
    case 'channel':
    case 'slice': {
      const next = { ...spec }
      delete next.bend
      return next
    }
    case 'slab':
    case 'punch': {
      const next = { ...spec }
      delete next.sides
      delete next.corners
      return next
    }
    case 'polygon':
    case 'band':
      return spec
    default:
      return spec satisfies never
  }
}

const r0 = (v: number) => Math.round(v)
const r2 = (v: number) => Math.round(v * 100) / 100 || 0

/**
 * The number that matters while dragging a handle, shown next to the
 * pointer. A polygon's corner scaled with Shift scales its rounding too, so
 * both read.
 */
function handleReadout(spec: CarveSpec, handle: CarveHandle, shift = false): string {
  switch (spec.kind) {
    case 'slab':
      if (handle.kind === 'radius') return `corner ${r0(Math.min(spec.radius, spec.width / 2, spec.height / 2))}`
      if (handle.kind === 'rotate') return `${r0(spec.rotation)}°`
      return `${r0(spec.width)} × ${r0(spec.height)}`
    case 'punch':
      if (handle.kind === 'rotate') return `${r0(spec.rotation)}°`
      return `${r0(spec.radius * 2)} across`
    case 'polygon':
      if (handle.kind === 'radius') return `corner ${r0(polygonCornerRadius(spec))}`
      if (handle.kind === 'rotate') return `${r0(spec.rotation)}°`
      return shift ? `r ${r0(spec.radius)} · corner ${r0(polygonCornerRadius(spec))}` : `r ${r0(spec.radius)}`
    case 'channel':
    case 'slice': {
      if (handle.kind === 'width') return `${r0(spec.width)} wide`
      const len = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y)
      const angle = (Math.atan2(spec.to.y - spec.from.y, spec.to.x - spec.from.x) * 180) / Math.PI
      return `${r0(len)} long · ${r0(angle)}°`
    }
    case 'band':
      // A band has no handles of its own.
      return ''
    default:
      return spec satisfies never
  }
}

function handleLabel(handle: CarveHandle): string {
  switch (handle.kind) {
    case 'radius':
      return 'Round corners'
    case 'rotate':
      return 'Rotate'
    case 'endpoint':
      return 'Move end'
    case 'width':
      return 'Change width'
    default:
      return 'Resize'
  }
}

/** The number that matters while bending: how deep the bend is, or how full a corner. */
function bendReadout(spec: CarveSpec, side: SideRef): string {
  switch (spec.kind) {
    case 'channel':
    case 'slice':
      return isSideBent(spec, side) ? `depth ${r0(maxChordDeviation(grooveSpine(spec)))}` : 'straight'
    case 'polygon':
    case 'band':
      return 'straight'
    case 'slab':
    case 'punch': {
      if (side.type === 'corner') {
        const fullness = spec.corners?.[side.id]
        return fullness ? `fullness ${r0(((fullness.k1 + fullness.k2) / 2) * 100)}%` : 'round'
      }
      if (!isSideBent(spec, side)) return 'straight'
      if (side.type === 'line') {
        const info = boxGeometryFor(spec).sides[side.id]
        return info ? `depth ${r0(maxChordDeviation(info.cubic))}` : ''
      }
      return ''
    }
    default:
      return spec satisfies never
  }
}

function bendLabel(spec: CarveSpec, side: SideRef): string {
  switch (spec.kind) {
    case 'channel':
      return 'Bend channel'
    case 'slice':
      return 'Bend slice'
    case 'slab':
    case 'punch':
    case 'polygon':
      return side.type === 'corner' ? 'Shape corner' : 'Bend edge'
    case 'band':
      return 'Move band'
    default:
      return spec satisfies never
  }
}

/** The point of a recipe that a handle drags: a box corner or side middle, or a groove end. */
function handleGeometry(spec: CarveSpec, id: HandleId): Vec | null {
  switch (spec.kind) {
    case 'channel':
    case 'slice':
      return id === 'from' ? spec.from : id === 'to' ? spec.to : null
    case 'slab':
    case 'punch':
    case 'polygon': {
      const f = handleFraction(id)
      if (!f) return null
      const frame = recipeFrame(spec)
      return add(spec.center, rotate({ x: (f.x * frame.width) / 2, y: (f.y * frame.height) / 2 }, spec.rotation))
    }
    case 'band':
      return null
    default:
      return spec satisfies never
  }
}

/** Which axes a handle's geometry can move along, in layer space; null when it moves at an angle. */
function handleAxes(rotation: number, id: HandleId): { x: boolean; y: boolean } | null {
  const f = handleFraction(id)
  if (!f || (f.x !== 0 && f.y !== 0)) return { x: true, y: true }
  const dir = rotate(f, rotation)
  if (Math.abs(dir.x) > 0.9999) return { x: true, y: false }
  if (Math.abs(dir.y) > 0.9999) return { x: false, y: true }
  return null
}

/** A free shape's own anchors as snap targets, on every contour, except the one being dragged. */
function otherAnchors(shape: EditableShape, except: { contourIndex: number; index: number } | null): SnapTarget[] {
  return shape.flatMap((path, contourIndex) =>
    path.segs
      .filter((_, i) => !except || contourIndex !== except.contourIndex || i !== except.index)
      .map((seg) => ({ p: seg.p, kind: 'point' as const })),
  )
}

/** A shape with one contour put in place of another. */
function withContour(shape: EditableShape, contourIndex: number, path: EditablePath): EditableShape {
  return shape.map((each, index) => (index === contourIndex ? path : each))
}

/**
 * The last burst of arrow keys: what kind, on which layers, the cuts it
 * carries, when its last key came and the layers it left. A burst picks its
 * cuts once, as a drag does, so a hole goes the whole way or stays put. A
 * turn also keeps the point it turns about and how far the box has turned.
 */
interface KeyBurst {
  kind: HistoryMergeKind
  ids: string
  carried: string[]
  turn: { center: Vec; rotation: number } | null
  at: number
  layers: IllustratorLayer[]
}

/** The sizes in use that a rounding can be: none larger than `limit`, where it would be drawn smaller than stored. */
const drawable = (radii: readonly number[], limit: number): number[] => radii.filter((r) => r <= limit + 1e-9)

const usable = (layer: IllustratorLayer | undefined): boolean => Boolean(layer && layer.visible && !layer.locked)

/** The points of a guide that snap as it moves: where it was grabbed, a circle's centre, a path's points. */
function guideKeyPoints(shape: GuideShape, grab: Vec): Vec[] {
  switch (shape.kind) {
    case 'line':
      return [grab]
    case 'circle':
      return [shape.c, grab]
    case 'path':
      return shape.contour.segments.map((segment) => segment.point)
    default:
      return shape satisfies never
  }
}

/** The index of the point nearest `p`, or null when there are none. */
function nearestIndex(points: readonly Vec[], p: Vec): number | null {
  let best: number | null = null
  for (let i = 0; i < points.length; i++) if (best === null || distance(points[i], p) < distance(points[best], p)) best = i
  return best
}

/** The shape whose centre a snap landed a point on, for a pin: a shape's, never a guide's or the artboard's. */
function pinTargetOf(snap: SnapResult): string | null {
  const hit = snap.hit
  return hit && hit.kind === 'centre' && hit.owner !== null && !hit.guide ? hit.owner : null
}

/** A line snapped to touch circles, marked where it touches. */
function tangentResult(hints: SnapHint[]): SnapResult {
  return { d: { x: 0, y: 0 }, label: 'tangent', hints }
}

const DOUBLE_CLICK_MS = 300
const DOUBLE_CLICK_PX = 6
/** How long the size or angle that Alt with the arrow keys reached stays by the box. */
const KEY_CHIP_MS = 1000
/** Why a layer a move would take along stays, by the pointer and read out. */
interface Held {
  label: string
  sentence: string
}

/** How long "unpinned" shows over every other label when a pin is let go of. */
const UNPINNED_MS = 1000
/** How long a frame that leaves a band no fit keeps saying so: a little past the frame, so a drag shows it steadily. */
const NO_FIT_LIVE_MS = 400

/**
 * Direct editing for Vector Maker: one mode, where what you press decides what
 * happens. Bodies move, points move, handles reshape, and edges bend.
 * Nothing is written to the store until the pointer is released, so every
 * gesture is exactly one undo step. Keys write at once, every press; the
 * store joins a burst of them into one undo step.
 */
export class DirectEditController {
  private readonly scope: paper.PaperScope
  private readonly canvas: HTMLCanvasElement
  private readonly host: DirectEditHost
  private items = new Map<string, paper.PathItem>()
  private hover: Zone = EMPTY_ZONE
  private press: Press | null = null
  private session: Session | null = null
  private lastDown: { time: number; point: Vec; key: string } | null = null
  private readonly freePaths = new WeakMap<IllustratorLayer, EditableShape | null>()
  private parentCache: { layers: IllustratorLayer[]; groups: IllustratorDocument['groups']; parents: Map<string, string | null> } | null = null
  private keyBurst: KeyBurst | null = null
  /** What a refused command found in the way, outlined for a moment. */
  private blocker: { id: string; timer: number } | null = null
  /** A tap has taken a whole group, and the HUD has said how to reach one piece. */
  private groupTapTold = false
  private keyChipTimer = 0
  /** The layers the key chip's number is about: once they change by anything else, such as an undo, it goes. */
  private keyChipLayers: readonly IllustratorLayer[] | null = null
  /** The last burst of guide nudges: which guides, when, and whether it detached them. */
  private guideBurst: { ids: string; at: number; detached: boolean } | null = null
  /** Where the pointer rests over the canvas, so hover can be found again once a key or a drag moves what is under it. */
  private resting: { p: Vec; touch: boolean } | null = null
  private pendingPoint: PendingPoint | null = null
  /** A handle's number is showing by the resting pointer. */
  private readoutShown = false
  /** Pink hints of the snap in effect, drawn on top of everything. */
  private snapHints: SnapHint[] = []
  /** While a tool places something: its snap index (for one document), where it started, the modifiers held. */
  private toolIndex: { doc: IllustratorDocument; guides: boolean; index: SnapIndex } | null = null
  /** The shape a tool's press started on the centre of, when the tool pins what it places. */
  private startPin: string | null = null
  private toolStart: SnapResult | null = null
  private toolMods: Modifiers = { shift: false, alt: false, noSnap: false }
  /** Is the tool's pointer a finger? Then its snaps reach as far as a finger's. */
  private toolTouch = false
  /** Which handles take presses: fewer while a tool is active, so its presses reach it. */
  private live: LiveHandles = 'all'
  /** Under the Guide tool, guides take presses first. */
  private guidesFirst = false
  /** Under the Round tool, fillets take presses first. */
  private filletsFirst = false
  /** A fillet whose radius a gesture is setting, as the live frame shows it, with the radius asked for. */
  private filletPreview: { id: string; fillet: ResolvedFillet | null; radius: number } | null = null
  /** What the live frame of a gesture shows in place of some layers: their paths, and their recipes. */
  private preview: { paths: Map<string, string | null>; carves: Map<string, CarveSpec>; frames: Map<string, number> } | null = null
  /** Does the gesture going on edit an offset copy's own geometry, so that it stops following its source? */
  private sessionDetaches = false
  /** True while the controller writes an edit it reads out itself: what the edit lets go of is said then, once. */
  private sayingOwn = false
  /** What the last edit said of the bands it left no fit, kept so a drag's release does not clear it. */
  private emptied: Held | null = null
  /** The offset the bar is showing, drawn dashed (layer space), and the copy it stands in for. */
  private offsetOutline: { pathData: string; replaces: string | null } | null = null
  private readonly unregisterKeys: () => void
  private destroyed = false

  constructor(scope: paper.PaperScope, canvas: HTMLCanvasElement, host: DirectEditHost) {
    this.scope = scope
    this.canvas = canvas
    this.host = host
    this.unregisterKeys = registerEditorKeys((event) => this.onKey(event))
  }

  /** Called after every render with the fresh hit areas. */
  sync(itemMap: Map<string, paper.Item>): void {
    this.items = new Map([...itemMap].map(([id, item]) => [id, item as paper.PathItem]))
    if (this.session) {
      const gone = [...this.session.editedIds].some((id) => !this.items.has(id))
      if (gone) this.cancel()
    }
    this.dropStaleGuideSession()
    if (this.keyChipLayers && this.keyChipLayers !== this.host.getDoc().layers) this.dropKeyChip()
    // A key or a drag may have moved a shape out from under the resting pointer, or under it.
    // A tool shows its own cursor and hover, so only the editor's own mode looks again.
    // While a key's number shows, it keeps the place of a handle's number at the pointer.
    const resting = this.resting
    if (resting && !this.press && !this.session && this.live === 'all') this.updateHover(resting.p, resting.touch, !this.keyChipLayers)
    this.drawOverlay()
  }

  get isInteracting(): boolean {
    return this.session !== null
  }

  /** Redraw the overlay: after a selection or guide change, or when the canvas changed size and handles keep their on-screen size. */
  refresh(): void {
    this.dropStaleGuideSession()
    this.drawOverlay()
  }

  /** A gesture on guides that something else deleted, or took off the canvas, meanwhile ends without a commit. */
  private dropStaleGuideSession(): void {
    const ids = this.session?.guideIds
    if (!ids?.size) return
    const present = new Set((this.host.getDoc().guides ?? []).map((guide) => guide.id))
    if (!this.host.guidesShown() || [...ids].some((id) => !present.has(id))) this.cancel()
  }

  /** Show (and let presses reach) the selection's handles and points: all, only a recipe's own, or none. */
  setHandlesLive(live: LiveHandles): void {
    if (this.live === live) return
    this.live = live
    this.hover = EMPTY_ZONE
    this.drawOverlay()
  }

  /** Let fillets take presses before anything else (the Round tool), or only after every material zone (Select). */
  setFilletsFirst(first: boolean): void {
    if (this.filletsFirst === first) return
    this.filletsFirst = first
    this.hover = EMPTY_ZONE
    this.drawOverlay()
  }

  /** Let guides take presses before anything else (the Guide tool), or only after everything (Select). */
  setGuidesFirst(first: boolean): void {
    if (this.guidesFirst === first) return
    this.guidesFirst = first
    this.hover = EMPTY_ZONE
    this.drawOverlay()
  }

  destroy(): void {
    this.dropPendingPoint()
    this.cancel()
    this.unregisterKeys()
    window.clearTimeout(this.keyChipTimer)
    if (this.blocker) window.clearTimeout(this.blocker.timer)
    this.destroyed = true
    hiddenRadiusDots.set([])
    hud.clear()
    resetOverlay(this.scope)
    this.scope.view.update()
  }

  /* ─── Pointer ─── */

  pointerDown(p: Vec, mods: Modifiers, touch: boolean): void {
    // A new gesture: "unpinned" held from the last edit goes, so it never covers what this one shows.
    hud.letGo()
    this.notePointer(touch)
    this.resting = { p, touch }
    let ctx = this.context(touch)
    let zone = findZone(ctx, p)
    const key = zoneKey(zone)
    const now = performance.now()
    const last = this.lastDown
    const isDouble =
      last !== null && now - last.time < DOUBLE_CLICK_MS && distance(last.point, p) < DOUBLE_CLICK_PX && last.key === key
    this.lastDown = isDouble ? null : { time: now, point: p, key }
    if (isDouble) {
      this.press = null
      this.doubleAction(zone)
      return
    }
    // A point waiting to be added lands now, before anything else happens.
    if (this.pendingPoint) {
      this.flushPendingPoint()
      ctx = this.context(touch)
      zone = findZone(ctx, p)
    }
    this.press = { point: p, zone, mods, touch }
  }

  pointerMove(p: Vec, mods: Modifiers, touch: boolean): void {
    // Kept during a drag too, so hover is found where the pointer ends up once it commits.
    this.resting = { p, touch }
    if (this.session) {
      this.session.update(p, mods)
      // A copy's own geometry edited lets go of what it follows: the HUD says so all the way.
      if (this.sessionDetaches) hud.hold('detached', UNPINNED_MS)
      this.placeHud(p, touch)
      return
    }
    if (this.press) {
      const threshold = this.press.touch ? 6 : 3
      if (distance(p, this.press.point) >= threshold) {
        const session = this.startSession(this.press, mods)
        if (!session) {
          this.press = null
          return
        }
        this.session = session
        this.sessionDetaches = this.detaches(session.editedIds)
        setEditorInteracting(true)
        setSurvivalVisible(this.scope, false)
        session.update(p, mods)
        if (this.sessionDetaches) hud.hold('detached', UNPINNED_MS)
        this.placeHud(p, touch)
      }
      return
    }
    this.notePointer(touch)
    this.updateHover(p, touch)
  }

  /**
   * A finger or a pointer: handles are laid out for the one last used, so a
   * rounding dot keeps a finger's room from its recipe's centre.
   */
  private notePointer(touch: boolean): void {
    if (canvasPointer.touch() === touch) return
    canvasPointer.note(touch)
    if (!this.session) this.drawOverlay()
  }

  pointerUp(): void {
    const session = this.session
    if (session) {
      this.session = null
      this.press = null
      const before = this.host.getDoc()
      this.emptied = null
      this.saysOwn(() => session.commit())
      // A band the drag left no fit was said as it committed: that stays its moment.
      const emptied = this.emptied as Held | null
      this.emptied = null
      // What a keyboard edit read out before no longer holds.
      if (!emptied) hud.silence()
      // "unpinned" or "detached" stays its moment only if a pin or a link was let go of: one the drag showed letting go may have come back.
      if (this.noteUnpinned(before) || this.noteDetached(before)) this.announceEdit(before, emptied?.sentence ?? null)
      else if (!emptied) hud.letGo()
      if (emptied) hud.hold(emptied.label, UNPINNED_MS)
      this.endGesture()
      return
    }
    const press = this.press
    this.press = null
    if (press) this.clickAction(press)
  }

  /** Pointer cancelled, capture lost, window blurred, or Escape: undo the preview. */
  cancel(): void {
    const session = this.session
    this.session = null
    this.press = null
    if (session) {
      session.cancel()
      // Nothing was written: no pin was let go of, whatever the drag showed.
      hud.letGo()
      this.endGesture()
    }
  }

  private endGesture() {
    setEditorInteracting(false)
    this.preview = null
    hideGuides(this.scope, new Set())
    this.snapHints = []
    hud.clear()
    setSurvivalVisible(this.scope, true)
    this.drawOverlay()
  }

  /* ─── Context and hover ─── */

  private center(): Vec {
    return { x: this.scope.view.center.x, y: this.scope.view.center.y }
  }

  private layer(id: string): IllustratorLayer | undefined {
    return this.host.getDoc().layers.find((candidate) => candidate.id === id)
  }

  /** Each layer's and group's group, in a document with groups. */
  private parents(doc: IllustratorDocument): Map<string, string | null> {
    const cached = this.parentCache
    if (cached?.layers === doc.layers && cached.groups === doc.groups) return cached.parents
    const parents = parentsOf([...doc.layers, ...(doc.groups ?? [])])
    this.parentCache = { layers: doc.layers, groups: doc.groups, parents }
    return parents
  }

  /**
   * What a click on a layer selects: the outermost group around it that the
   * selection has not entered, or the layer itself.
   */
  private rootOf(doc: IllustratorDocument, layerId: string): string {
    if (!doc.groups?.length) return layerId
    return selectionRoot(this.parents(doc), layerId, doc.enteredGroupId ?? null)
  }

  /** The layers a selected object stands for: itself, or every layer inside a group. */
  private leavesUnder(doc: IllustratorDocument, id: string): string[] {
    if (!doc.groups?.some((group) => group.id === id)) return [id]
    const parents = this.parents(doc)
    return doc.layers.filter((layer) => isInside(parents, layer.id, id)).map((layer) => layer.id)
  }

  /** What the selection holds: layers and whole groups. */
  private selectedRoots(doc: IllustratorDocument): string[] {
    return doc.selectedRootIds ?? doc.selectedLayerIds
  }

  private selectedFreePath(doc: IllustratorDocument, selectedIds: string[]) {
    // A group of one is the group: its member's points wait until it is entered.
    if (selectedIds.length !== 1 || this.selectedRoots(doc)[0] !== selectedIds[0]) return null
    const layer = doc.layers.find((candidate) => candidate.id === selectedIds[0])
    if (!layer || layer.carve || !layer.visible) return null
    const shape = this.freePathOf(layer)
    return shape ? { layerId: layer.id, shape } : null
  }

  /** A free layer's contours with its transform baked in. Layers are immutable, so this caches by identity. */
  private freePathOf(layer: IllustratorLayer): EditableShape | null {
    if (layer.carve) return null
    if (!this.freePaths.has(layer)) this.freePaths.set(layer, bakedEditableShape(layer))
    // Baking runs in a headless scope; drawing must go back to ours.
    this.scope.activate()
    return this.freePaths.get(layer) ?? null
  }

  /** Layer units per CSS pixel, for sizes and tolerances that stay constant on screen. */
  private unitsPerPx(): number {
    return unitsPerCssPixel(this.scope)
  }

  private handleLayout(): HandleLayout {
    return scaledHandleLayout(this.unitsPerPx(), canvasPointer.touch())
  }

  /** The selection's handles: a single recipe's own, or a box around a free shape or several layers. */
  private handleSet(doc: IllustratorDocument): HandleSet | null {
    return selectionHandles(doc, this.handleLayout(), (layer) => this.freePathOf(layer), this.live)
  }

  private context(touch: boolean): HitContext {
    const doc = this.host.getDoc()
    const ids = new Set(doc.layers.map((layer) => layer.id))
    const selectedIds = doc.selectedLayerIds.filter((id) => ids.has(id))
    const freePath = this.selectedFreePath(doc, selectedIds)
    const handles = this.handleSet(doc)
    const point = doc.pointSelection
    const anchor = freePath && point && point.layerId === freePath.layerId ? { contourIndex: point.contourIndex, index: point.segmentIndex } : null
    this.scope.activate()
    return {
      doc,
      items: this.items,
      ink: getInkItem(this.scope),
      center: this.center(),
      selectedIds,
      freePath,
      anchor,
      handles,
      unitsPerPx: this.unitsPerPx(),
      touch,
      edges: true,
      bendable: (layerId) => this.rootOf(doc, layerId) === layerId,
      freePathOf: (layer) => this.freePathOf(layer),
      guides: this.reachableGuides(doc),
      guideHandles: this.selectedGuideHandles(doc),
      guidesFirst: this.guidesFirst,
      fillets: this.host.filletsShown?.() ? filletCircles(this.shownFillets()) : [],
      filletDot: this.selectedFilletDot(doc),
      filletsFirst: this.filletsFirst,
    }
  }

  /** How each fillet that shows resolved on the mark drawn now. */
  private shownFillets(): readonly ResolvedFillet[] {
    return this.sliderFillets ?? this.host.getMark().fillets ?? []
  }

  /** How the fillets resolve at the radius the selection bar's slider is showing, while its thumb moves; null otherwise. */
  private sliderFillets: readonly ResolvedFillet[] | null = null

  /**
   * Draw the fillets as the selection bar's slider shows them while its
   * thumb moves, the ink rounded to match; null goes back to the mark's.
   */
  showFilletPreview(fillets: readonly ResolvedFillet[] | null): void {
    if (fillets === this.sliderFillets) return
    this.sliderFillets = fillets
    this.drawOverlay()
  }

  /** The drawer's row hover moved on or off a fillet: draw it lit, or not. */
  showRowHover(): void {
    this.drawOverlay()
  }

  /** The one selected fillet's radius dot, where it has its corner and fillets are on the canvas. */
  private selectedFilletDot(doc: IllustratorDocument): { filletId: string; p: Vec } | null {
    const ids = doc.selectedFilletIds ?? []
    if (ids.length !== 1 || !this.host.filletsShown?.()) return null
    const fillet = this.shownFillets().find((each) => each.id === ids[0])
    return fillet && !fillet.lost ? { filletId: fillet.id, p: filletDot(fillet) } : null
  }

  /** Draw the committed mark again, its fillets' circles too, after a gesture that showed another. */
  private restoreInk(): void {
    showMark(this.scope, this.host.getMark())
  }

  /** The guides a press can reach: on the canvas, visible and unlocked. */
  private reachableGuides(doc: IllustratorDocument): Guide[] {
    if (!this.host.guidesShown()) return []
    return (doc.guides ?? []).filter((guide) => guide.visible && !guide.locked)
  }

  /** The guides selected, in the document's order. */
  private selectedGuides(doc: IllustratorDocument): Guide[] {
    const ids = new Set(doc.selectedGuideIds ?? [])
    return ids.size ? (doc.guides ?? []).filter((guide) => ids.has(guide.id)) : []
  }

  /** The handles of the one selected guide, when guides are on the canvas. */
  private selectedGuideHandles(doc: IllustratorDocument): GuideHandle[] {
    const selected = this.selectedGuides(doc)
    if (selected.length !== 1 || !this.host.guidesShown() || !selected[0].visible) return []
    return guideHandles(selected[0], this.openLayerRect(), this.unitsPerPx())
  }

  /**
   * The part of the canvas in view that no floating bar covers, in layer
   * space, a little inside its edges: where a handle can be seen and grabbed.
   */
  private openLayerRect(): Bounds {
    const { left, top, right, bottom } = this.scope.view.bounds
    const c = this.center()
    const u = this.unitsPerPx()
    const covered = this.host.coveredInsets?.() ?? { top: 0, bottom: 0 }
    const pad = 16 * u
    const rect = {
      minX: left - c.x + pad,
      minY: top - c.y + covered.top * u + pad,
      maxX: right - c.x - pad,
      maxY: bottom - c.y - covered.bottom * u - pad,
    }
    // A canvas almost all covered keeps its whole view rather than none.
    return rect.minX < rect.maxX && rect.minY < rect.maxY ? rect : { minX: left - c.x, minY: top - c.y, maxX: right - c.x, maxY: bottom - c.y }
  }

  private updateHover(p: Vec, touch: boolean, readout = true) {
    this.resting = { p, touch }
    const zone = findZone(this.context(touch), p)
    if (zoneKey(zone) !== zoneKey(this.hover)) {
      this.hover = zone
      this.drawOverlay()
    }
    this.setCursor(this.cursorFor(zone))
    if (readout) this.showRestingReadout(zone, p, touch)
  }

  /**
   * Over a handle, the number it changes shows by the pointer before any
   * drag: the size of the box, or how far it is turned.
   */
  private showRestingReadout(zone: Zone, p: Vec, touch: boolean) {
    const readout = zone.kind === 'handle' ? this.restingReadout(zone.set, zone.handle) : null
    if (readout) {
      this.placeHud(p, touch)
      hud.set({ label: null, chip: readout })
      this.readoutShown = true
    } else if (this.readoutShown) {
      this.readoutShown = false
      hud.clear()
    }
  }

  private restingReadout(set: HandleSet, handle: CarveHandle): string | null {
    if (set.kind === 'recipe') {
      const spec = this.layer(set.ids[0])?.carve
      return spec ? handleReadout(spec, handle) : null
    }
    if (!set.box) return null
    if (handle.kind === 'rotate') return `${r0(set.box.rotation)}°`
    return `${r0(set.box.width)} × ${r0(set.box.height)}`
  }

  private cursorFor(zone: Zone): string {
    switch (zone.kind) {
      case 'handle':
        if (zone.handle.kind === 'rotate') return CURSORS.rotate
        if (zone.handle.kind === 'radius' || zone.handle.kind === 'endpoint') return CURSORS.point
        return resizeCursor(zone.handle.axisDeg)
      case 'body':
      case 'frame':
        return CURSORS.move
      case 'anchor':
      case 'bezier':
        return CURSORS.point
      case 'edge':
        // On the selected free shape a click adds a point; elsewhere edges only bend.
        return zone.free && this.isSelectedAlone(zone.layerId) ? CURSORS.bendOrAdd : CURSORS.bend
      case 'guide':
        return CURSORS.move
      case 'guide-handle':
        return zone.handle.id === 'rotate' ? CURSORS.rotate : resizeCursor(zone.handle.id === 'n' || zone.handle.id === 's' ? 90 : 0)
      case 'fillet-dot':
        return CURSORS.point
      case 'fillet':
        return 'pointer'
      default:
        return CURSORS.default
    }
  }

  /** Is this layer what is selected, on its own: not a member reached through its group? */
  private isSelectedAlone(layerId: string): boolean {
    const doc = this.host.getDoc()
    const roots = this.selectedRoots(doc)
    return roots.length === 1 && roots[0] === layerId && doc.selectedLayerIds.length === 1
  }

  private setCursor(cursor: string) {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor
  }

  /** Put the HUD by a point. Under a finger it goes above the point, where the hand does not cover it. */
  private placeHud(p: Vec, touch = false) {
    const view = this.scope.view.projectToView(new this.scope.Point(p.x, p.y))
    const rect = this.canvas.getBoundingClientRect()
    const sx = rect.width / this.scope.view.viewSize.width
    const sy = rect.height / this.scope.view.viewSize.height
    hud.set({ x: view.x * sx, y: view.y * sy, above: touch })
  }

  /* ─── Snapping ─── */

  private snapsOn(mods: Modifiers): boolean {
    return this.host.isSnapping() && !mods.noSnap
  }

  /** 8 screen pixels (12 for touch), in layer units. */
  private snapTolerance(touch = false): number {
    return (touch ? 12 : 8) * this.unitsPerPx()
  }

  /**
   * What a drag can snap to: every visible shape except the edited ones and
   * the recipes pinned to them, which move with them; the artboard centre;
   * and the guides on the canvas, except those in `guideExclude` and those
   * that follow an edited shape. Shapes and guides are read as pieces, so an
   * edge buried inside the ink is a target too.
   */
  private makeSnapIndex(
    doc: IllustratorDocument,
    exclude: Set<string>,
    extra: SnapTarget[] = [],
    guideExclude: ReadonlySet<string> = new Set(),
  ): SnapIndex {
    const left = new Set([...exclude, ...this.followersOf(doc, exclude)])
    const guides = this.shownGuides(doc, left, guideExclude)
    const index = documentSnapIndex({ doc, exclude: left, freePathOf: (layer) => this.freePathOf(layer), guides, extra })
    this.scope.activate()
    return index
  }

  /** The guides on the canvas that can be snapped to: none while guides are hidden; never those in `guideExclude` or following a shape in `left`. */
  private shownGuides(doc: IllustratorDocument, left: ReadonlySet<string> = new Set(), guideExclude: ReadonlySet<string> = new Set()): Guide[] {
    if (!this.host.guidesShown()) return []
    return (doc.guides ?? []).filter((guide) => guide.visible && !guideExclude.has(guide.id) && !(guide.link && left.has(guide.link.of)))
  }

  /** Sizes in use for "same size", leaving out `exclude`: of shapes, and of the circle guides on the canvas. */
  private sizesFor(doc: IllustratorDocument, exclude: ReadonlySet<string>) {
    return documentSizes(doc, exclude, (layer) => this.freePathOf(layer), this.shownGuides(doc, exclude, exclude))
  }

  /**
   * The recipes pinned to any of `ids`, the offset copies of them and the
   * bands between them or on their construction circles, and those that
   * follow them in turn: they move with them.
   */
  private followersOf(doc: IllustratorDocument, ids: Iterable<string>): string[] {
    const reached = new Set(ids)
    const out: string[] = []
    // A band may follow a construction circle of a shape that moves: through the guide, it follows the shape.
    const guideOf = new Map((doc.guides ?? []).flatMap((guide) => (guide.link ? [[guide.id, guide.link.of] as const] : [])))
    for (let grew = true; grew; ) {
      grew = false
      for (const layer of doc.layers) {
        const held = [...(layer.pin ? [layer.pin] : []), ...linkSources(layer.link).map((id) => guideOf.get(id) ?? id)]
        if (!held.some((id) => reached.has(id)) || reached.has(layer.id)) continue
        reached.add(layer.id)
        out.push(layer.id)
        grew = true
      }
    }
    return out
  }

  /** A live composition for a gesture on some layers, and on the recipes pinned to them, which move with them. */
  private composeFor(doc: IllustratorDocument, ids: Iterable<string>): ComposeSession {
    const list = [...ids]
    return createComposeSession(doc, [...list, ...this.followersOf(doc, list)])
  }

  /** The centre a pin holds to, of a layer as it is now. */
  private layerCentre(layer: IllustratorLayer): Vec | null {
    if (layer.carve) return recipeCentre(layer.carve)
    const shape = this.freePathOf(layer)
    return shape ? shapeCentre({ contours: shapeContours(shape), frame: { rotation: layer.frameRotation ?? 0 } }) : null
  }

  /** A layer read as a circle: a circle slab or punch, a spark circle. Null otherwise. */
  private layerCircle(layer: IllustratorLayer): Circle | null {
    if (layer.carve) return asCircle({ carve: layer.carve, contours: [] })
    const shape = this.freePathOf(layer)
    return shape ? asCircle({ contours: shapeContours(shape) }) : null
  }

  /**
   * What follows the layers a live frame replaces, put in the frame too: the
   * recipes pinned to them, moved as far as the centres they are pinned to
   * move, their offset copies, and the bands between them. A copy of a
   * recipe with an exact offset is made again from the live recipe; any
   * other copy moves with its source's centre, and the commit makes it
   * again. A band is made again from its circles as they are in the frame.
   * So the drag shows them where the follow pass will put them.
   */
  private withFollowers(replacements: Map<string, string | null>, carves: Map<string, CarveSpec>, frames: Map<string, number>): void {
    const doc = this.host.getDoc()
    if (!doc.layers.some((layer) => layer.pin || layer.link)) return
    const guideOf = (id: string) => (doc.guides ?? []).find((each) => each.id === id)
    /** A construction guide's shape as the frame has it, when the shape it follows is in the frame. */
    const liveGuideShape = (id: string) => {
      const link = guideOf(id)?.link
      if (!link || !replacements.has(link.of)) return undefined
      const carve = carves.get(link.of)
      const pathData = replacements.get(link.of)
      const rotation = frames.get(link.of) ?? this.layer(link.of)?.frameRotation ?? 0
      const source = carve ? { carve, contours: [] } : pathData ? { contours: pathDataToContours(pathData), frame: { rotation } } : null
      // A shape with no such line now keeps its guide where it was, as the follow pass does.
      return (source && constructionShape(source, link.role)) ?? undefined
    }
    /** Does a band's end change in the frame: a layer in it, or a guide that follows one? */
    const endMoves = (id: string) => replacements.has(id) || liveGuideShape(id) !== undefined
    /** A band's end as the frame has it: a live recipe or path, the layer as it is, or a circle guide, live when it follows a shape in the frame. */
    const liveCircle = (id: string): Circle | null => {
      const carve = carves.get(id)
      if (carve) return asCircle({ carve, contours: [] })
      const pathData = replacements.get(id)
      if (pathData !== undefined) return pathData ? asCircle({ contours: pathDataToContours(pathData) }) : null
      const layer = this.layer(id)
      if (layer) return layer.carve?.kind === 'band' ? null : this.layerCircle(layer)
      const shape = liveGuideShape(id) ?? guideOf(id)?.shape
      return shape?.kind === 'circle' && shape.r > 0 ? { c: shape.c, r: shape.r } : null
    }
    /** The bands this frame leaves no fit, said by the pointer while it does. */
    const lost: string[] = []
    const shifts = new Map<string, Vec | null>()
    const shiftOf = (id: string): Vec | null => {
      if (shifts.has(id)) return shifts.get(id)!
      const layer = this.layer(id)
      const pathData = replacements.get(id)
      const carve = carves.get(id)
      const before = layer ? this.layerCentre(layer) : null
      const rotation = frames.get(id) ?? layer?.frameRotation ?? 0
      const after = carve ? recipeCentre(carve) : pathData ? shapeCentre({ contours: pathDataToContours(pathData), frame: { rotation } }) : null
      this.scope.activate()
      const shift = before && after ? sub(after, before) : null
      shifts.set(id, shift)
      return shift
    }
    for (let grew = true; grew; ) {
      grew = false
      for (const layer of doc.layers) {
        if (replacements.has(layer.id)) continue
        if (layer.link?.kind === 'band' && layer.carve?.kind === 'band' && (endMoves(layer.link.a) || endMoves(layer.link.b))) {
          const a = liveCircle(layer.link.a)
          const b = liveCircle(layer.link.b)
          const made = a && b ? bandBetween(layer.carve, a, b) : null
          const outline = made && carveOutline(made)
          this.scope.activate()
          // A band its circles allow no fit has no recipe in the frame, so its copies empty with it.
          const filled = outline?.segs.length ? outline : null
          if (!filled && layer.pathData) lost.push(layer.id)
          replacements.set(layer.id, filled ? filled.pathData : null)
          if (made && filled) carves.set(layer.id, made)
          grew = true
          continue
        }
        if (layer.link?.kind === 'offset' && replacements.has(layer.link.of)) {
          // A source with nothing in the frame leaves its copy nothing, as the follow pass will.
          if (replacements.get(layer.link.of) === null) {
            replacements.set(layer.id, null)
            grew = true
            continue
          }
          const live = carves.get(layer.link.of)
          if (live && offsetsExactly(live)) {
            const offset = offsetRecipe(live, layer.link.distance)
            const made = offset && roundCarveSpec(offset)
            replacements.set(layer.id, made ? carveOutline(made).pathData : null)
            if (made) carves.set(layer.id, made)
          } else {
            const shift = shiftOf(layer.link.of)
            if (!shift) continue
            if (layer.carve) {
              const moved = translateCarve(layer.carve, shift)
              replacements.set(layer.id, carveOutline(moved).pathData)
              carves.set(layer.id, moved)
            } else {
              const shape = this.freePathOf(layer)
              replacements.set(layer.id, shape ? shapePathData(translateShape(shape, shift)) : null)
            }
            shifts.set(layer.id, shift)
          }
          grew = true
          continue
        }
        if (!layer.pin || !layer.carve || !replacements.has(layer.pin)) continue
        const shift = shiftOf(layer.pin)
        if (!shift) continue
        const moved = translateCarve(layer.carve, shift)
        replacements.set(layer.id, carveOutline(moved).pathData)
        carves.set(layer.id, moved)
        shifts.set(layer.id, shift)
        grew = true
      }
    }
    if (lost.length) {
      const numbers = lost.flatMap((id) => layerNumbers(doc).get(id) ?? [])
      hud.hold(`band ${numbers.join(', ')}: no fit`, NO_FIT_LIVE_MS)
    }
  }

  /**
   * Does the layer follow, as an offset copy or a band, directly or through
   * other copies and bands or a construction circle, one of `ids`?
   */
  private followsLayerOf(id: string, ids: ReadonlySet<string>): boolean {
    const doc = this.host.getDoc()
    return followsAnyOf(doc.layers, id, ids, doc.guides)
  }

  /**
   * What a move of `ids` moves: an offset copy moves its source instead,
   * and the source of that in turn; a band moves its circles that are
   * shapes, each as a move of it would, and not its circle guides; so a
   * copy of a band moves the band's circles. One whose source or circle
   * cannot move stays whole, and so does a band whose circles are both
   * guides. `redirected` says what a copy or band swapped for what it
   * follows moves, for the HUD; `held` says why each that stays stays.
   */
  private movedSources(ids: readonly string[]): { ids: string[]; redirected: string | null; held: Held[] } {
    const out: string[] = []
    const held: Held[] = []
    let redirected: string | null = null
    const doc = this.host.getDoc()
    const layers = doc.layers
    const bands = new Set<string>()
    /** What a move of `id` moves, or why it cannot; `chosen` when it is in the selection, which is usable already. */
    const resolve = (id: string, chosen: boolean, role: 'source' | 'circle'): string[] | Held => {
      if (!chosen && !usable(this.layer(id))) return this.heldSource(doc, id, role)
      const at = offsetRoot(layers, id)
      if (at !== id) {
        redirected ??= 'moves the source'
        if (!usable(this.layer(at))) return this.heldSource(doc, at)
      }
      const layer = this.layer(at)
      if (layer?.link?.kind !== 'band') return [at]
      // A band goes where its circles do: dragging it, or a copy of it, moves them, all or none.
      redirected = 'moves its circles'
      if (bands.has(at)) return []
      bands.add(at)
      const ends = [layer.link.a, layer.link.b].filter((end) => this.layer(end))
      if (!ends.length) return { label: 'follows guides: move them', sentence: 'Its circles are guides: move them to move the band' }
      const moved: string[] = []
      for (const end of ends) {
        const taken = resolve(end, false, 'circle')
        if (!Array.isArray(taken)) return taken
        moved.push(...taken)
      }
      return moved
    }
    for (const id of ids) {
      const taken = resolve(id, true, 'source')
      if (!Array.isArray(taken)) held.push(taken)
      else for (const each of taken) if (!out.includes(each)) out.push(each)
    }
    return { ids: out, redirected, held }
  }

  /** Why a layer a move would take along stays: the source of a copy, or a band's circle, locked or hidden. */
  private heldSource(doc: IllustratorDocument, id: string, role: 'source' | 'circle' = 'source'): Held {
    const locked = Boolean(this.layer(id)?.locked)
    // A layer takes its group's lock and visibility: the row to change is the outermost group that holds it, or else its own.
    const groups = new Map((doc.groups ?? []).map((group) => [group.id, group]))
    const holder =
      ancestorsOf(this.parents(doc), id)
        .reverse()
        .find((groupId) => (locked ? groups.get(groupId)?.locked : groups.get(groupId)?.visible === false)) ?? id
    const number = layerNumbers(doc).get(holder) ?? '—'
    return locked
      ? { label: `${role} is locked`, sentence: `${role} is locked: unlock ${number} to move it` }
      : { label: `${role} is hidden`, sentence: `${role} is hidden: show ${number} to move it` }
  }

  /** A drag of a copy or band whose source or circles cannot move: nothing moves, and the HUD says why all the way. */
  private heldSession(said: { label: string; sentence: string }): Session {
    // What an earlier edit held up goes: this drag's own word shows.
    hud.letGo()
    hud.announce(said.sentence)
    return {
      editedIds: new Set(),
      update: () => hud.set({ label: said.label, chip: null }),
      commit: () => {},
      cancel: () => {},
      drawOverlay: () => {},
    }
  }

  /** Show a snap: its hints on the canvas, its label by the pointer. */
  private showSnap(result: SnapResult | null, fallbackLabel: string | null = null) {
    this.snapHints = result?.hints ?? []
    hud.set({ label: result?.label ?? fallbackLabel })
  }

  /* ─── Tools: snapping what they place ─── */

  /** The pointer moved while a tool is active: remember the modifiers and keep the label by it. */
  toolPointer(p: Vec, mods: Modifiers, touch = false): void {
    this.toolMods = mods
    this.toolTouch = touch
    this.notePointer(touch)
    this.placeHud(p, touch)
  }

  /** A tool's press starts a gesture: "unpinned" held from the last edit goes, so it never covers what the tool shows. */
  toolDown(p: Vec, mods: Modifiers, touch = false): void {
    hud.letGo()
    this.toolPointer(p, mods, touch)
  }

  /**
   * Snap a point a tool is placing (layer space). On hover it only shows
   * where a press would land; a press remembers its snap, so the label
   * stays while the rest is dragged out. Rays come from `rays` (the other
   * end of a channel, the pen's previous point); `extra` adds targets the
   * document doesn't have yet (the pen's own points). With `pins`, a start
   * on a shape's centre says the new recipe will be pinned there: see
   * `toolStartPin`.
   */
  snapToolPoint(p: Vec, role: 'hover' | 'start' | 'end', options: { rays?: Vec[]; extra?: SnapTarget[]; pins?: boolean } = {}): Vec {
    if (role === 'start') this.startPin = null
    const result = this.toolSnap(role, (index) => {
      const found = snapMoving(index, [p], { tolerance: this.snapTolerance(this.toolTouch), edges: true, rays: options.rays, extra: options.extra })
      const target = options.pins && role !== 'end' ? pinTargetOf(found) : null
      if (!target) return found
      if (role === 'start') this.startPin = target
      return { ...found, label: 'pinned', hints: [{ kind: 'pin', p: add(p, found.d) }] }
    })
    return add(p, result.d)
  }

  /** The shape the last tool press started on the centre of, when it asked for pins: what a punch placed there is pinned to. */
  toolStartPin(): string | null {
    return this.startPin
  }

  /**
   * Snap the radius of a shape a tool is drawing about its centre. A circle
   * (a round punch, a circle guide) takes the size of another circle or
   * punch, or just touches an edge, a guide or another circle. Any other
   * punch, whose sides are not where a circle of its radius would be, takes
   * only the radius of another punch, and a polygon only another polygon's.
   */
  snapToolRadius(center: Vec, radius: number, like: 'circle' | 'punch' | 'polygon' = 'circle'): number {
    let snapped = radius
    this.toolSnap('end', (index, doc) => {
      const sizes = this.sizesFor(doc, new Set())
      const tolerance = this.snapTolerance(this.toolTouch)
      if (like !== 'circle') {
        const same = snapValue(radius, like === 'polygon' ? sizes.polygonRadii : sizes.punchRadii, tolerance)
        if (same === null) return NO_SNAP
        snapped = same
        return { ...NO_SNAP, label: 'same size' }
      }
      const found = this.snapCircleSize(index, [...sizes.punchRadii, ...sizes.circleRadii], { c: center, r: radius }, center, tolerance)
      if (!found) return NO_SNAP
      snapped = found.radius
      return found.snap
    })
    return snapped
  }

  /**
   * Snap a guide line the Guide tool draws from `start` towards `current`.
   * With `angle` (Shift's 15° steps) the line keeps it, and moves across
   * itself to touch a circle, unless `start` snapped: then the line stays
   * through it, as point snaps rank above tangency. Otherwise its far end lands on a point, or the
   * line turns about `start` to touch a circle, or its end lands on an
   * alignment, an edge or a 15° ray. Null when nothing snaps: the line then
   * runs through `current`.
   */
  snapGuideLine(start: Vec, current: Vec, angle: number | null): { p: Vec; angle: number } | null {
    let line: { p: Vec; angle: number } | null = null
    this.toolSnap('end', (index) => {
      const tolerance = this.snapTolerance(this.toolTouch)
      const rounds = roundPrimitives(index.primitives ?? [])
      if (angle !== null) {
        // A start that snapped (to a point, an edge or an alignment) stays on the line: only a free one moves across.
        if (this.toolStart?.label) return NO_SNAP
        const touch = tangentAtAngle(start, angle, rounds, tolerance)
        if (!touch) return NO_SNAP
        line = { p: touch.p, angle }
        return tangentResult(lineTouchHints(rounds, touch.p, angle, touch.touch))
      }
      const end = snapMoving(index, [current], { tolerance, edges: true, rays: [start] })
      const onPoint = end.hit && end.hit.kind !== 'edge' && end.hit.kind !== 'tangent'
      const touch = onPoint ? null : tangentThrough(start, current, rounds, tolerance)
      if (touch) {
        line = { p: start, angle: touch.angle }
        return tangentResult(lineTouchHints(rounds, start, touch.angle, touch.touch))
      }
      if (!end.label) return NO_SNAP
      const to = add(current, end.d)
      if (distance(to, start) < 1e-6) return NO_SNAP
      line = { p: start, angle: (Math.atan2(to.y - start.y, to.x - start.x) * 180) / Math.PI }
      return end
    })
    return line
  }

  /**
   * Snap the radius of a circle sized about `pivot`: to the size of another
   * ("same size"), else to touch a piece ("tangent"). Null when nothing is in reach.
   */
  private snapCircleSize(index: SnapIndex, sizes: number[], circle: Circle, pivot: Vec, tolerance: number): { radius: number; snap: SnapResult } | null {
    const same = snapValue(circle.r, sizes, tolerance)
    if (same !== null) return { radius: same, snap: { ...NO_SNAP, label: 'same size' } }
    const touch = snapRadiusTangent(index, circle, pivot, tolerance)
    return touch && { radius: touch.radius, snap: touch.snap }
  }

  /** The tool's gesture ended, or the pointer left: drop its hints and label. */
  endToolSnap(): void {
    this.toolStart = null
    if (!this.snapHints.length && !hud.get().label) return
    this.snapHints = []
    hud.clear()
    this.drawOverlay()
  }

  private toolSnap(role: 'hover' | 'start' | 'end', run: (index: SnapIndex, doc: IllustratorDocument) => SnapResult): SnapResult {
    const doc = this.host.getDoc()
    if (!this.snapsOn(this.toolMods)) {
      if (role === 'start') this.toolStart = null
      this.showSnap(null)
      this.drawOverlay()
      return NO_SNAP
    }
    const guides = this.host.guidesShown()
    if (this.toolIndex?.doc !== doc || this.toolIndex.guides !== guides) this.toolIndex = { doc, guides, index: this.makeSnapIndex(doc, new Set()) }
    const result = run(this.toolIndex.index, doc)
    if (role === 'start') this.toolStart = result
    const start = role === 'end' ? this.toolStart : null
    this.snapHints = [...(start?.hints ?? []), ...result.hints]
    // A start that will be pinned keeps saying so while the rest snaps too.
    const pinned = start?.label === 'pinned' && result.label !== null && result.label !== 'pinned'
    hud.set({ label: pinned ? `${result.label} · pinned` : (result.label ?? start?.label ?? null) })
    this.drawOverlay()
    return result
  }

  /** The pointer left the canvas: nothing is hovered any more. */
  pointerLeave(): void {
    if (this.press || this.session) return
    this.resting = null
    this.hover = EMPTY_ZONE
    if (this.readoutShown) {
      this.readoutShown = false
      hud.clear()
    }
    this.endToolSnap()
    this.drawOverlay()
  }

  /* ─── Clicks ─── */

  private clickAction(press: Press) {
    const doc = this.host.getDoc()
    const zone = press.zone
    switch (zone.kind) {
      case 'handle':
        // Just outside a corner, a drag turns the box; a click there is a click on the empty canvas.
        if (zone.ring && !press.mods.shift) this.host.setSelection([])
        return
      case 'body':
        if (press.mods.shift) this.toggleSelected(doc, zone.layerId)
        else this.selectRootOf(doc, zone.layerId)
        return
      case 'anchor':
        this.host.setSelection([zone.layerId], { layerId: zone.layerId, contourIndex: zone.contourIndex, segmentIndex: zone.index })
        return
      case 'edge':
        if (press.mods.shift) {
          this.toggleSelected(doc, zone.layerId)
          return
        }
        // Clicking the selected free shape's edge adds a point there (after a
        // moment, so a double-click can straighten instead). Otherwise it selects.
        if (zone.free && this.isSelectedAlone(zone.layerId)) {
          this.schedulePendingPoint(zone)
          return
        }
        this.selectRootOf(doc, zone.layerId)
        return
      case 'frame':
        // A click inside the box, between its shapes, keeps the selection.
        return
      case 'guide':
        this.host.selectGuides([zone.guideId], press.mods.shift)
        return
      case 'fillet':
        this.host.selectFillets?.([zone.filletId], press.mods.shift)
        return
      case 'empty':
        if (!press.mods.shift) this.host.setSelection([])
        return
      default:
        return
    }
  }

  /**
   * A click on a layer: it, or its outermost group not entered. The first
   * time a tap takes a whole group, the HUD says how to reach one piece:
   * touch has no tooltips to say it.
   */
  private selectRootOf(doc: IllustratorDocument, layerId: string) {
    const root = this.rootOf(doc, layerId)
    this.host.setSelection([root], null)
    if (root === layerId || !canvasPointer.touch() || this.groupTapTold) return
    this.groupTapTold = true
    if (!this.placeKeyHud()) return
    hud.hold(GROUP_TAP_HINT, GROUP_TAP_HINT_MS)
    hud.announce(GROUP_TAP_HINT)
  }

  /** Shift-click: the layer, or the group a click on it selects, in or out of the selection. */
  private toggleSelected(doc: IllustratorDocument, layerId: string) {
    const root = this.rootOf(doc, layerId)
    const roots = this.selectedRoots(doc)
    this.host.setSelection(roots.includes(root) ? roots.filter((id) => id !== root) : [...roots, root])
  }

  /**
   * A double-click on a member of a group selects the piece itself, entering
   * its group; on an edge it straightens the edge only once that layer is
   * selected on its own, so a double-click into a group never straightens a
   * piece by accident.
   */
  private doubleAction(zone: Zone) {
    if (zone.kind === 'anchor') {
      this.dropPendingPoint()
      this.host.editAnchor(zone.layerId, zone.index, 'toggle-smooth', zone.contourIndex)
      return
    }
    if ((zone.kind === 'body' || zone.kind === 'edge') && this.entersPiece(zone.layerId)) return
    if (zone.kind === 'edge') this.straightenEdge(zone)
  }

  /** Select a group's member on its own, entering its group, unless it already is: true when it did. */
  private entersPiece(layerId: string): boolean {
    const layer = this.layer(layerId)
    if (!layer?.parentId || this.isSelectedAlone(layerId)) return false
    this.dropPendingPoint()
    this.host.setSelection([layerId], null)
    // Done as the hint said: it goes.
    if (hud.get().label === GROUP_TAP_HINT) hud.letGo()
    return true
  }

  /** Double-click on an edge: straighten it if it's bent; on a straight free edge, add the point now. */
  private straightenEdge(zone: EdgeZone) {
    const layer = this.layer(zone.layerId)
    if (!layer || layer.locked) return
    if (layer.carve && zone.carve) {
      this.dropPendingPoint()
      if (!isSideBent(layer.carve, zone.carve.side)) return
      const straight = straightenCarve(layer.carve, zone.carve.side)
      this.host.commitLayerEdits({
        label: zone.carve.side.type === 'corner' ? 'Round corner' : 'Straighten edge',
        edits: [{ layerId: layer.id, carve: straight }],
        select: [layer.id],
      })
      return
    }
    if (!zone.free) return
    const { contourIndex, curveIndex } = zone.free
    const path = this.freePathOf(layer)?.[contourIndex]
    if (!path || curveIndex >= path.segs.length) return
    if (isCurveStraight(path, curveIndex)) {
      // Nothing to straighten: the double-click was two clicks on the edge.
      if (this.pendingPoint) this.flushPendingPoint()
      return
    }
    this.dropPendingPoint()
    const doc = this.host.getDoc()
    this.host.commitLayerEdits({
      label: 'Straighten edge',
      edits: [{ layerId: layer.id, contourIndex, pathData: editablePathToPathData(straightenCurve(path, curveIndex)) }],
      select: [layer.id],
      anchor: doc.pointSelection?.layerId === layer.id ? undefined : null,
    })
  }

  /* ─── Adding points ─── */

  private schedulePendingPoint(zone: EdgeZone) {
    if (!zone.free) return
    this.dropPendingPoint()
    const layer = this.layer(zone.layerId)
    if (!layer) return
    this.pendingPoint = {
      layerId: zone.layerId,
      layer,
      contourIndex: zone.free.contourIndex,
      curveIndex: zone.free.curveIndex,
      t: zone.free.t,
      point: zone.point,
      timer: window.setTimeout(() => this.flushPendingPoint(), DOUBLE_CLICK_MS),
    }
    this.drawOverlay()
  }

  private dropPendingPoint() {
    const pending = this.pendingPoint
    if (!pending) return
    this.pendingPoint = null
    window.clearTimeout(pending.timer)
    this.drawOverlay()
  }

  private flushPendingPoint() {
    const pending = this.pendingPoint
    if (!pending) return
    this.pendingPoint = null
    window.clearTimeout(pending.timer)
    // The shape changed first, by an undo from the toolbar say: where the click was no longer holds.
    const layer = this.layer(pending.layerId)
    const { contourIndex } = pending
    const path = layer && layer === pending.layer ? this.freePathOf(layer)?.[contourIndex] : null
    if (!layer || !path || pending.curveIndex >= path.segs.length) {
      this.drawOverlay()
      return
    }
    const { path: next, index } = insertPoint(path, pending.curveIndex, pending.t)
    this.host.commitLayerEdits({
      label: 'Add point',
      edits: [{ layerId: layer.id, contourIndex, pathData: editablePathToPathData(next) }],
      select: [layer.id],
      anchor: { layerId: layer.id, contourIndex, segmentIndex: index },
    })
  }

  /* ─── Sessions ─── */

  private startSession(press: Press, mods: Modifiers): Session | null {
    const zone = press.zone
    switch (zone.kind) {
      case 'handle':
        return zone.set.kind === 'recipe' ? this.handleSession(press, zone.set.ids[0], zone.handle) : this.boxSession(press, zone.set, zone.handle)
      case 'body':
        return this.moveSession(press, zone.layerId, mods)
      case 'frame':
        // Every member is selected, so the whole selection moves.
        return this.moveSession(press, zone.set.ids[0], mods)
      case 'edge':
        return zone.carve ? this.carveBendSession(press, zone.layerId, zone.carve) : this.freeBendSession(press, zone)
      case 'anchor':
        return this.pointSession(press, zone.layerId, zone.contourIndex, zone.index, 'anchor')
      case 'bezier':
        return this.pointSession(press, zone.layerId, zone.contourIndex, zone.index, zone.which)
      case 'guide':
        return this.guideMoveSession(press, zone.guideId, zone.point)
      case 'guide-handle':
        return this.guideHandleSession(press, zone.handle)
      case 'fillet-dot':
        return this.filletRadiusSession(press, zone.filletId)
      default:
        return null
    }
  }

  /**
   * Drag a fillet's radius dot: the radius follows the dot out of the corner
   * or into it, in whole units from 2 to 200, snapping to the size of
   * another fillet or a radius on the sheet. The mark shows it live, from
   * the base mark, which a radius never changes; one undo step on release.
   */
  private filletRadiusSession(press: Press, filletId: string): Session | null {
    const start = this.shownFillets().find((each) => each.id === filletId)
    const doc = this.host.getDoc()
    const stored = (doc.fillets ?? []).find((each) => each.id === filletId)
    if (!start || start.lost || !stored) return null
    const base = this.host.getBaseMark?.() ?? this.host.getMark()
    const sources = frameSources(doc.layers, new Map(), new Map())
    const sizes = filletSizes(doc, this.sizesFor(doc, new Set()), filletId)
    const center = this.center()
    let radius = stored.radius
    const show = (fillet: ResolvedFillet | null) => {
      this.filletPreview = { id: filletId, fillet, radius }
      hud.set({ chip: radiusReadout(radius, fillet) })
    }
    return {
      editedIds: new Set(),
      update: (p, mods) => {
        const raw = filletRadiusAt(start, sub(p, center))
        const same = this.snapsOn(mods) ? snapFilletRadius(raw, sizes, this.snapTolerance(press.touch)) : null
        radius = filletRadius(same ?? raw)
        hud.set({ label: same !== null ? 'same size' : null })
        const fillets = (doc.fillets ?? []).map((each) => (each.id === filletId ? { ...each, radius } : each))
        let mark: MarkData
        try {
          mark = applyFillets(base, fillets, sources)
        } catch {
          return // a boolean hiccup mid-drag: keep the last good frame
        }
        showMark(this.scope, mark)
        show(mark.fillets?.find((each) => each.id === filletId) ?? null)
        this.drawOverlay()
      },
      commit: () => {
        this.filletPreview = null
        if (radius === stored.radius) this.restoreInk()
        else this.host.setFilletRadius?.(filletId, radius)
      },
      cancel: () => {
        this.filletPreview = null
        this.restoreInk()
      },
      drawOverlay: (overlay) => {
        const fillet = this.filletPreview?.fillet
        if (fillet && !fillet.lost) this.drawFillet(overlay, fillet, true, false)
      },
    }
  }

  /** A fillet in the selection colour: its circle, and with `dot` its radius dot. */
  private drawFillet(overlay: paper.Layer, fillet: ResolvedFillet, dot: boolean, hot: boolean, style: { width?: number; opacity?: number; color?: string } = {}) {
    const center = this.center()
    this.scope.activate()
    overlay.activate()
    outlineCircle(this.scope, overlay, fillet.centre, fillet.used, center, { width: style.width ?? 1.5, opacity: style.opacity, color: style.color, dashed: fillet.lost || fillet.convex })
    if (dot && !fillet.lost) drawFilletDot(this.scope, overlay, filletDot(fillet), center, hot)
  }

  /**
   * Layers a body drag moves: the selection if the pressed shape is in it,
   * else what a click on it would select: the shape, or its whole group.
   */
  private movingIds(doc: IllustratorDocument, pressedId: string): string[] {
    if (doc.selectedLayerIds.includes(pressedId)) return this.usableSelection(doc)
    const root = this.rootOf(doc, pressedId)
    return root === pressedId ? [pressedId] : this.leavesUnder(doc, root).filter((id) => usable(this.layer(id)))
  }

  /** The selected layers that take part in an edit: hidden and locked ones stay selected but stay put. */
  private usableSelection(doc: IllustratorDocument): string[] {
    return doc.selectedLayerIds.filter((id) => usable(this.layer(id)))
  }

  /** Where some layers start, and the cuts they carry (with `carry`): those given in `picked`, or else found now. */
  private moveStarts(doc: IllustratorDocument, ids: string[], carry: boolean, picked?: readonly string[]): MoveStarts {
    const addIds = ids.filter((id) => this.layer(id)?.operation === 'add')
    const carried = !carry || !addIds.length ? [] : picked ? [...picked] : carriedCuts(doc, addIds, this.items, ids)
    const starts = new Map<string, { carve?: CarveSpec; path?: EditableShape }>()
    for (const id of [...ids, ...carried]) {
      const layer = this.layer(id)
      if (!layer) continue
      if (layer.carve) starts.set(id, { carve: layer.carve })
      else {
        const path = this.freePathOf(layer)
        if (path) starts.set(id, { path })
      }
    }
    return { starts, carried }
  }

  private movePlan(ids: string[], carry: boolean, select: string[] = ids): MovePlan | null {
    const doc = this.host.getDoc()
    if (!ids.length) return null
    const moved = this.moveStarts(doc, ids, carry)
    const { starts, carried } = moved
    if (!starts.size) return null
    const compose = this.composeFor(doc, starts.keys())
    const restore = () => this.restoreInk()
    const pathFor = (id: string, d: Vec): string => {
      const start = starts.get(id)!
      return start.carve ? carveOutline(translateCarve(start.carve, d)).pathData : shapePathData(translateShape(start.path!, d))
    }
    const carriedSet = new Set(carried)
    const keyPoints: Vec[] = []
    const keyCentres: Array<string | null> = []
    const lone = ids.length === 1 ? this.layer(ids[0]) : undefined
    const circle = lone ? this.layerCircle(lone) : null
    for (const id of ids) {
      const start = starts.get(id)
      if (circle) {
        // A circle snaps by its centre and its quadrants: the corners of its box are off its ink.
        keyPoints.push(circle.c, ...[0, 90, 180, 270].map((deg) => add(circle.c, rotate({ x: 0, y: -circle.r }, deg))))
        keyCentres.push(start?.carve ? id : null, null, null, null, null)
      } else if (start?.carve) {
        const targets = carveKeyPoints(start.carve)
        keyPoints.push(...targets.map((target) => target.p))
        // A recipe's centre, or a groove's middle, is what a pin holds.
        keyCentres.push(...targets.map((target) => (target.kind === 'centre' ? id : null)))
      } else if (start?.path) {
        const points = freeBoxPoints(start.path)
        keyPoints.push(...points)
        keyCentres.push(...points.map(() => null))
      }
    }

    return {
      keyPoints,
      keyCentres,
      circle,
      editedIds: new Set([...starts.keys(), ...this.followersOf(doc, starts.keys())]),
      preview: (d) => {
        const replacements = new Map<string, string | null>()
        const carves = new Map<string, CarveSpec>()
        for (const [id, start] of starts) {
          replacements.set(id, pathFor(id, d))
          if (start.carve) carves.set(id, translateCarve(start.carve, d))
        }
        this.showInk(compose, replacements, carves)
        this.drawOverlay()
      },
      commit: (d, asked = new Map<string, string | null>()) => {
        const still = Math.hypot(d.x, d.y) < 0.5
        // Dropped about where it was, nothing lets go; but a new pin is written, the move with it, so the centre
        // lands exactly on the one it is pinned to, as for a recipe near a centre dropped back on it.
        const pins = still ? new Map([...asked].filter(([layerId, pin]) => pin !== null && this.layer(layerId)?.pin !== pin)) : asked
        if (still && !pins.size) {
          restore()
          return
        }
        const commit = { ...moveCommit(moved, select, d), ...(still ? { label: 'Pin' } : {}) }
        this.host.commitLayerEdits(pins.size ? { ...commit, edits: commit.edits.map((edit) => (pins.has(edit.layerId) ? { ...edit, pin: pins.get(edit.layerId) } : edit)) } : commit)
      },
      cancel: restore,
      drawOverlay: (layer) => {
        for (const id of starts.keys()) {
          const item = this.items.get(id)
          if (item) outlineItem(this.scope, layer, item, carriedSet.has(id) ? { dashed: true, width: 1.5 } : {})
        }
      },
    }
  }

  /**
   * Show one live frame of the ink. A boolean hiccup mid-drag keeps the last
   * good frame on screen. `carves` are the recipes of the replaced layers
   * that have one: the guides that follow them are drawn from these.
   */
  private showInk(
    compose: ComposeSession,
    replacements: Map<string, string | null>,
    carves = new Map<string, CarveSpec>(),
    frames = new Map<string, number>(),
  ) {
    this.withFollowers(replacements, carves, frames)
    this.preview = { paths: replacements, carves, frames }
    let ink: string
    try {
      ink = compose.compose(replacements, carves)
    } catch {
      return
    }
    showFrame(this.scope, ink, compose.fillets)
  }

  /**
   * Where the members of a box start, and the cuts they carry (with
   * `carry`): those given in `picked`, or else found now. Null when none can move.
   */
  private boxMembers(doc: IllustratorDocument, ids: string[], carry: boolean, picked?: readonly string[]): BoxMembers | null {
    const members = new Map<string, MovedStart>()
    const all = new Set(ids)
    for (const id of ids) {
      const layer = this.layer(id)
      if (!layer || layer.locked) continue
      // An offset copy boxed with its source follows it, made again from it, rather than scaling or turning itself.
      if (this.followsLayerOf(id, all)) continue
      if (layer.carve) {
        members.set(id, { carve: layer.carve, frame: 0 })
        continue
      }
      const path = this.freePathOf(layer)
      if (path) members.set(id, { path, frame: layer.frameRotation ?? 0 })
    }
    if (!members.size) return null
    const carried = carry ? this.carriedStarts(doc, members.keys(), new Set(members.keys()), picked) : new Map<string, MovedStart>()
    return { members, carried, bands: this.boxedBands(doc, new Set(members.keys()), new Set(carried.keys())) }
  }

  /**
   * The bands a box turns and scales along with both their circles: those
   * whose two ends are shapes the box moves, follow them, or are
   * construction circles of them. Each takes the
   * box's turn and scale into its angle, width and radius, and keeps
   * following its circles, so a mark turned or scaled whole keeps its bands.
   */
  private boxedBands(doc: IllustratorDocument, members: ReadonlySet<string>, carried: ReadonlySet<string>): BoxMembers['bands'] {
    const bands: BoxMembers['bands'] = new Map()
    const moving = new Set([...members, ...carried])
    // An end on a construction circle moves with the shape the guide follows.
    const guideOf = new Map((doc.guides ?? []).flatMap((guide) => (guide.link ? [[guide.id, guide.link.of] as const] : [])))
    const moves = (end: string, among: ReadonlySet<string>) => {
      const id = guideOf.get(end) ?? end
      return this.layer(id) !== undefined && (among.has(id) || this.followsLayerOf(id, among))
    }
    for (const layer of doc.layers) {
      if (layer.link?.kind !== 'band' || layer.carve?.kind !== 'band' || moving.has(layer.id)) continue
      const { a, b } = layer.link
      if (!moves(a, moving) || !moves(b, moving)) continue
      bands.set(layer.id, { carve: layer.carve, frame: 0, carried: moves(a, carried) && moves(b, carried) })
    }
    return bands
  }

  /** Where the cuts that some shapes carry start, leaving out layers the edit moves anyway: `picked`, or else found now. */
  private carriedStarts(
    doc: IllustratorDocument,
    shapeIds: Iterable<string>,
    moving: Set<string>,
    picked?: readonly string[],
  ): Map<string, MovedStart> {
    const addIds = [...shapeIds].filter((id) => this.layer(id)?.operation === 'add')
    const starts = new Map<string, MovedStart>()
    if (!addIds.length) return starts
    for (const id of picked ?? carriedCuts(doc, addIds, this.items, moving)) {
      const layer = this.layer(id)
      if (!layer) continue
      if (layer.carve) starts.set(id, { carve: layer.carve, frame: 0 })
      else {
        const path = this.freePathOf(layer)
        if (path) starts.set(id, { path, frame: layer.frameRotation ?? 0 })
      }
    }
    return starts
  }

  private moveSession(press: Press, pressedId: string, mods: Modifiers): Session | null {
    const doc = this.host.getDoc()
    // An offset copy goes where its source puts it: dragging it moves the source, and the HUD says so.
    const selected = this.movingIds(doc, pressedId)
    const sources = this.movedSources(selected)
    // A group dragged before it was selected is left selected, as a click on it would leave it.
    const root = doc.selectedLayerIds.includes(pressedId) ? null : this.rootOf(doc, pressedId)
    // Alt moves the shape alone, leaving its holes where they are.
    const plan = this.movePlan(sources.ids, !mods.alt, root !== null && root !== pressedId ? [root] : selected)
    if (!plan) return sources.held.length ? this.heldSession(sources.held[0]) : null
    const fallback = sources.redirected
    let index: SnapIndex | null = null
    let d: Vec = { x: 0, y: 0 }
    // The recipes moved that are pinned to something staying put: dragged, they let go, unless dropped back on a centre.
    const pinned = plan.keyCentres.filter((id): id is string => {
      const pin = id === null ? undefined : this.layer(id)?.pin
      return pin !== undefined && !plan.editedIds.has(pin)
    })
    let pinTo: { id: string; target: string } | null = null
    const letGo = this.letGoWatch()
    // Only the key point nearest where the press grabbed lands where edges cross: finding crossings costs too much for every point.
    const primary = nearestIndex(plan.keyPoints, sub(press.point, this.center()))
    return {
      editedIds: plan.editedIds,
      update: (p, m) => {
        d = sub(p, press.point)
        // Shift keeps the move straight: horizontal or vertical, whichever is longer.
        const axes = m.shift ? (Math.abs(d.x) >= Math.abs(d.y) ? { x: true, y: false } : { x: false, y: true }) : undefined
        if (axes) d = { x: axes.x ? d.x : 0, y: axes.y ? d.y : 0 }
        let snap: SnapResult = NO_SNAP
        pinTo = null
        if (this.snapsOn(m)) {
          index ??= this.makeSnapIndex(doc, plan.editedIds)
          const tolerance = this.snapTolerance(press.touch)
          const circle = plan.circle && { c: add(plan.circle.c, d), r: plan.circle.r }
          snap = snapMoving(index, plan.keyPoints.map((k) => add(k, d)), { tolerance, axes, circle: circle ?? undefined, primary })
          d = add(d, snap.d)
          // A recipe's centre dropped on another shape's centre is pinned there.
          const target = pinTargetOf(snap)
          const id = target && snap.hit ? plan.keyCentres[snap.hit.moving] : null
          if (id && target && this.canPin(doc, id, target)) {
            pinTo = { id, target }
            snap = { ...snap, label: 'pinned', hints: [{ kind: 'pin', p: add(plan.keyPoints[snap.hit!.moving], d) }] }
          }
        }
        // A copy dragged says it moves its source, whatever it snaps to.
        this.showSnap(fallback && snap.label ? { ...snap, label: `${fallback} · ${snap.label}` } : snap, fallback)
        letGo.update(Math.hypot(d.x, d.y) >= 0.5 && pinned.some((id) => pinTo?.id !== id))
        plan.preview(d)
        hud.set({ chip: `${Math.round(d.x)}, ${Math.round(d.y)}` })
      },
      commit: () => {
        const pins = new Map<string, string | null>(pinned.map((id) => [id, null]))
        if (pinTo) pins.set(pinTo.id, pinTo.target)
        plan.commit(d, pins)
      },
      cancel: () => plan.cancel(),
      drawOverlay: (layer) => plan.drawOverlay(layer),
    }
  }

  /** Can `id`'s centre be pinned to `target`'s: is it a recipe, and would the pin not hold in a loop? */
  private canPin(doc: IllustratorDocument, id: string, target: string): boolean {
    const layer = this.layer(id)
    if (!layer?.carve || id === target) return false
    const byId = new Map(doc.layers.map((each) => [each.id, each]))
    const seen = new Set<string>()
    for (let at: string | undefined = target; at !== undefined && !seen.has(at); at = byId.get(at)?.pin) {
      if (at === id) return false
      seen.add(at)
    }
    return true
  }

  /**
   * Would a live frame let go of a pin: does a pinned recipe among `carves`,
   * whose target is not among `edited`, have its centre off its target's?
   */
  private unpinning(carves: ReadonlyMap<string, CarveSpec>, edited: ReadonlySet<string>): boolean {
    for (const [id, spec] of carves) {
      const pin = this.layer(id)?.pin
      if (pin === undefined || edited.has(pin)) continue
      const target = this.layer(pin)
      const centre = target ? this.layerCentre(target) : null
      if (centre && distance(recipeCentre(spec), centre) > PIN_SLACK) return true
    }
    return false
  }

  /** Did the edit since `before` let go of a pin, on a recipe that is still there? */
  private noteUnpinned(before: IllustratorDocument): boolean {
    const after = new Map(this.host.getDoc().layers.map((layer) => [layer.id, layer]))
    return before.layers.some((layer) => layer.pin !== undefined && after.has(layer.id) && after.get(layer.id)!.pin === undefined)
  }

  /**
   * Watches a gesture's frames for a pin it would let go of: the moment one
   * starts to, "unpinned" shows over any other label for a moment; when the
   * gesture comes back onto the centre, the label goes at once.
   */
  private letGoWatch(): { update(lettingGo: boolean): void } {
    let was = false
    return {
      update: (lettingGo) => {
        if (lettingGo && !was) hud.hold('unpinned', UNPINNED_MS)
        else if (!lettingGo && was) hud.letGo()
        was = lettingGo
      },
    }
  }

  /**
   * After an edit: read `status` out, and if the edit let go of a pin, show
   * "unpinned" over any other label for a moment and say so too. A pin is
   * never let go of without a word.
   */
  private announceEdit(before: IllustratorDocument, status: string | null) {
    const unpinned = this.noteUnpinned(before)
    const detached = this.noteDetached(before)
    if (!unpinned && !detached) {
      if (status) hud.announce(status)
      return
    }
    hud.hold(unpinned ? 'unpinned' : 'detached', UNPINNED_MS)
    const said = [
      ...(unpinned ? ['Unpinned: it no longer stays on the centre it was pinned to'] : []),
      ...(detached ? ['Detached: it no longer follows its shape'] : []),
    ].join('. ')
    hud.announce(status ? `${status}. ${said}` : said)
  }

  /** Did the last edit end an offset copy's or a band's link: its own geometry edited, so it no longer follows what it did? */
  private noteDetached(before: IllustratorDocument): boolean {
    const after = new Map(this.host.getDoc().layers.map((layer) => [layer.id, layer]))
    return before.layers.some((layer) => layer.link !== undefined && after.has(layer.id) && after.get(layer.id)!.link === undefined)
  }

  /** Would an edit of these layers end a link: a copy or band among them edited without what it follows? */
  private detaches(ids: ReadonlySet<string>): boolean {
    return [...ids].some((id) => this.layer(id)?.link !== undefined && !this.followsLayerOf(id, ids))
  }

  /** Run an edit whose read-out the controller gives itself, after it. */
  private saysOwn(commit: () => void) {
    this.sayingOwn = true
    try {
      commit()
    } finally {
      this.sayingOwn = false
    }
  }

  /**
   * What an edit made off the canvas let go of, or one the controller does
   * not read out itself: `unpinned`, recipes whose pin went with what they
   * were pinned to (deleted, made a guide, merged); `gone`, offset copies
   * whose source went so; `edited`, copies whose own points were edited, by
   * a double-click, a key or the bar. "unpinned" or "detached" shows by them
   * for a moment and all of it is read out, so no pin and no link goes
   * without a word.
   */
  noteLetGo({
    unpinned = [],
    gone = [],
    edited = [],
    emptied = [],
  }: {
    unpinned?: readonly string[]
    gone?: readonly string[]
    edited?: readonly string[]
    emptied?: readonly string[]
  }) {
    const doc = this.host.getDoc()
    // Numbered as the drawer numbers them, from 01 at the bottom.
    const numbered = (ids: readonly string[]) => ids.flatMap((id) => layerNumbers(doc).get(id) ?? [])
    // A band its circles now allow no fit vanishes from the canvas: said whoever made the edit, as nothing else shows it.
    const lost = numbered(emptied)
    if (lost.length) {
      this.emptied = { label: `band ${lost.join(', ')}: no fit`, sentence: `No fit: band ${lost.join(', ')} waits until its circles allow it` }
      hud.hold(this.emptied.label, UNPINNED_MS)
      hud.announce(this.emptied.sentence)
    }
    if (this.sayingOwn) return
    const said = (ids: readonly string[], one: string, many: string, verb: string) => {
      const numbers = numbered(ids)
      return numbers.length ? [`${verb} ${numbers.join(', ')}: ${numbers.length > 1 ? many : one}`] : []
    }
    const sentences = [
      ...said(unpinned, 'the shape it was pinned to is gone', 'the shape they were pinned to is gone', 'Unpinned'),
      ...said(gone, 'the shape it followed is gone', 'the shapes they followed are gone', 'Detached'),
      ...said(edited, 'it no longer follows its shape', 'they no longer follow their shapes', 'Detached'),
    ]
    if (!sentences.length) return
    const ids = [...unpinned, ...gone, ...edited]
    // Measured as layers of their own: a group selected now has no say in their box or its frame.
    const around = selectionBox({ ...doc, selectedLayerIds: ids, selectedRootIds: ids }, (layer) => this.freePathOf(layer))
    if (around) {
      const corners = (['nw', 'ne', 'se', 'sw'] as const).map((id) => add(boxHandlePoint(around.box, id)!, this.center()))
      this.placeHud({ x: Math.max(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) })
    }
    hud.hold(numbered(unpinned).length ? 'unpinned' : 'detached', UNPINNED_MS)
    hud.announce(sentences.join('. '))
  }

  /**
   * Drag one of a single recipe's own handles. The recipe alone changes:
   * cuts that belong to it stay where they are, unlike under a box. A
   * pinned recipe resizes about its centre, as with Alt, so its pin holds.
   * On touch, where there is no Shift, a circle slab's corner keeps it a
   * circle.
   */
  private handleSession(press: Press, layerId: string, handle: CarveHandle): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!layer?.carve) return null
    const start = layer.carve
    const compose = this.composeFor(doc, [layerId])
    const center = this.center()
    const startLocal = sub(press.point, center)
    const exclude = new Set([layerId])
    const editedIds = new Set([...exclude, ...this.followersOf(doc, exclude)])
    const aboutCentre = layer.pin !== undefined && (handle.kind === 'resize' || handle.kind === 'endpoint')
    const evenCorner = press.touch && start.kind === 'slab' && isCornerHandle(handle.id) && asCircle({ carve: start, contours: [] }) !== null
    let index: SnapIndex | null = null
    let current = start
    const letGo = this.letGoWatch()
    return {
      editedIds,
      update: (p, given) => {
        const mods = { ...given, alt: given.alt || aboutCentre, shift: given.shift || evenCorner }
        const pointer = sub(p, center)
        current = dragCarveHandle(start, handle.id, startLocal, pointer, mods)
        let snap: SnapResult = NO_SNAP
        if (this.snapsOn(mods)) {
          index ??= this.makeSnapIndex(doc, exclude)
          const snapped = this.snapHandle(index, doc, exclude, start, current, handle, startLocal, pointer, mods, press.touch)
          current = snapped.spec
          snap = snapped.snap
          // As on a box: with nothing to snap to, whole numbers, so the number shown is the number stored.
          if (!snap.label) current = wholeCarveDrag(start, current, handle.id, mods)
        }
        this.showSnap(snap)
        const carves = new Map([[layerId, current]])
        letGo.update(this.unpinning(carves, editedIds))
        this.showInk(compose, new Map([[layerId, carveOutline(current).pathData]]), carves)
        hud.set({ chip: handleReadout(current, handle, mods.shift) })
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        this.host.commitLayerEdits({ label: handleLabel(handle), edits: [{ layerId, carve: current }], select: [layerId] })
      },
      cancel: () => this.restoreInk(),
      drawOverlay: (overlay) => this.drawRecipe(overlay, current, handle.id),
    }
  }

  /**
   * Move the members of a box with one map. Free shapes take the whole
   * affine; recipes only a similarity (an even scale, or a turn), so they
   * stay recipes. Every free shape a turn moves turns its frame with it: a
   * single free shape keeps its box turned, while the box around several
   * layers is upright again after the commit. Cuts that belong to the
   * members go with them, as they do when the members are dragged, and
   * always: Alt already means "about the centre" here. A carried free cut
   * takes the whole affine; a carried recipe the similarity nearest it.
   */
  private boxPlan(ids: string[], box: OrientedBox, uniform: boolean): BoxPlan | null {
    const doc = this.host.getDoc()
    const moved = this.boxMembers(doc, ids, true)
    if (!moved) return null
    const { members } = moved
    const changing = [...members.keys(), ...moved.carried.keys()]
    const editedIds = new Set([...changing, ...this.followersOf(doc, changing)])
    const compose = this.composeFor(doc, editedIds)
    const center = this.center()
    let move: BoxMove = turnMove(box.center, 0)
    let current = box
    let hot: HandleId | null = null
    const everyEdit = () => boxMoved(moved, move)
    const restore = () => this.restoreInk()

    return {
      editedIds,
      ids: [...members.keys()],
      preview: (next, nextBox, hotId) => {
        move = next
        current = nextBox
        hot = hotId
        const replacements = new Map<string, string | null>()
        const carves = new Map<string, CarveSpec>()
        const frames = new Map<string, number>()
        for (const { id, from, next: moved } of everyEdit()) {
          replacements.set(id, movedPathData(moved))
          if (moved.carve) carves.set(id, moved.carve)
          else frames.set(id, normalizeDegrees(from.frame + move.turn))
        }
        this.showInk(compose, replacements, carves, frames)
        this.drawOverlay()
      },
      commit: (label) => {
        const changed = Math.abs(move.turn) > 1e-9 || move.affine !== IDENTITY_AFFINE
        if (!changed) {
          restore()
          return
        }
        this.host.commitLayerEdits({ label, edits: [...boxEdits(moved, move), ...groupFrameEdits(doc, moved, move.turn)] })
      },
      cancel: restore,
      drawOverlay: (overlay) => {
        const all = everyEdit()
        this.scope.activate()
        overlay.activate()
        for (const { next } of all.filter((edit) => edit.carried)) {
          outlinePathData(this.scope, overlay, movedPathData(next), center, { dashed: true, width: 1.5 })
        }
        // A recipe alone keeps its own handles, turning and scaling with it.
        const lone = members.size === 1 ? all[0].next.carve : undefined
        if (lone) {
          this.drawRecipe(overlay, lone, null)
          return
        }
        for (const { next } of all.filter((edit) => !edit.carried)) outlinePathData(this.scope, overlay, movedPathData(next), center)
        drawCarveHandles(this.scope, overlay, boxHandleList(current, this.handleLayout(), uniform), center, hot)
      },
    }
  }

  /** Drag a box handle: resize squares map the box onto the dragged one, the knob turns it. One commit per drag. */
  private boxSession(press: Press, set: HandleSet, handle: CarveHandle): Session | null {
    const doc = this.host.getDoc()
    const box = set.box
    if (!box) return null
    const plan = this.boxPlan(set.ids, box, set.uniform)
    if (!plan) return null
    const center = this.center()
    const startLocal = sub(press.point, center)
    const rotating = handle.kind === 'rotate'
    // On touch there is no Shift: corners keep the proportions, and sides stretch one way.
    const evenly = set.uniform || press.touch
    let index: SnapIndex | null = null
    const lone = plan.ids.length === 1 ? this.layer(plan.ids[0]) : undefined
    const circle = lone ? this.layerCircle(lone) : null
    let sizes: number[] | null = null
    const letGo = this.letGoWatch()
    // With snapping on, a gesture lands on whole degrees and whole units, so
    // the number shown is the number stored. A snap lands exactly.

    return {
      editedIds: plan.editedIds,
      update: (p, mods) => {
        const pointer = sub(p, center)
        let snap: SnapResult = NO_SNAP
        if (rotating) {
          let rotation = rotateBox(box.rotation, box.center, startLocal, pointer, mods.shift)
          if (this.snapsOn(mods) && !mods.shift) {
            // Settled on a 15° step, the chip already reads the angle: no label repeats it.
            rotation = settleAngle(rotation, distance(pointer, box.center), this.snapTolerance(press.touch)) ?? rotation
            rotation = normalizeDegrees(Math.round(rotation))
          }
          const turn = normalizeDegrees(rotation - box.rotation)
          hud.set({ chip: `${r0(rotation)}°` })
          this.showSnap(null)
          plan.preview(turnMove(box.center, turn), { ...box, rotation }, handle.id)
          letGo.update(this.preview !== null && this.unpinning(this.preview.carves, plan.editedIds))
          return
        }
        let resized = resizeBox(box, handle.id, startLocal, pointer, mods, evenly)
        if (this.snapsOn(mods)) {
          index ??= this.makeSnapIndex(doc, plan.editedIds)
          const snapped = this.snapBoxResize(index, box, resized, handle.id, startLocal, pointer, mods, evenly, press.touch)
          resized = snapped.resized
          snap = snapped.snap
          // A circle alone, scaled evenly, takes another circle's size or grows until it touches.
          const onPoint = snap.hit && snap.hit.kind !== 'edge'
          if (circle && !onPoint && isCornerHandle(handle.id) && scalesEvenly(handle.id, mods, evenly)) {
            const f = resized.sx
            const now = { c: add(resized.pivot, scale(sub(circle.c, resized.pivot), f)), r: circle.r * f }
            sizes ??= this.sizesFor(doc, plan.editedIds).circleRadii
            const found = this.snapCircleSize(index, sizes, now, resized.pivot, this.snapTolerance(press.touch))
            if (found) {
              resized = scaleBoxBy(box, handle.id, found.radius / circle.r, mods.alt)
              snap = found.snap
            }
          }
        }
        if (this.snapsOn(mods) && !snap.label) {
          const even = scalesEvenly(handle.id, mods, evenly) || (!isCornerHandle(handle.id) && mods.shift)
          resized = wholeBoxResize(box, resized, even)
        }
        hud.set({ chip: `${r0(resized.box.width)} × ${r0(resized.box.height)}` })
        this.showSnap(snap)
        plan.preview(resizeMove(resized), resized.box, handle.id)
        // The frame just shown holds the recipes as they would land: one pinned to a shape left behind lets go.
        letGo.update(this.preview !== null && this.unpinning(this.preview.carves, plan.editedIds))
      },
      // A turned box around several layers comes back upright on release:
      // it is measured afresh around them, and they keep no shared frame. A
      // group's box keeps the turn: the group's frame stores it.
      commit: () => plan.commit(boxLabel(rotating, plan.ids.length > 1)),
      cancel: () => plan.cancel(),
      drawOverlay: (overlay) => plan.drawOverlay(overlay),
    }
  }

  /**
   * Snap the corner or side a box handle drags. A free corner or a side
   * lands on points, alignments and edges: the pointer is nudged by the
   * snap, which moves it exactly as far. A corner that scales evenly can
   * only travel along its diagonal, so it lands on an alignment instead:
   * the factor is solved so its coordinate on that axis matches, and the
   * snap is kept only if the corner moves no further than the tolerance.
   */
  private snapBoxResize(
    index: SnapIndex,
    box: OrientedBox,
    raw: BoxResize,
    id: HandleId,
    startPointer: Vec,
    pointer: Vec,
    mods: Modifiers,
    uniform: boolean,
    touch: boolean,
  ): { resized: BoxResize; snap: SnapResult } {
    const tolerance = this.snapTolerance(touch)
    const none = { resized: raw, snap: NO_SNAP }
    const point = boxHandlePoint(raw.box, id)
    if (!point) return none

    if (scalesEvenly(id, mods, uniform)) {
      let best: { resized: BoxResize; axis: 'x' | 'y'; moved: number } | null = null
      for (const axis of ['x', 'y'] as const) {
        const found = snapMoving(index, [point], { tolerance, axes: { x: axis === 'x', y: axis === 'y' } })
        if (!found.label) continue
        const target = point[axis] + found.d[axis]
        const factor = evenFactorTo(box, id, mods.alt, axis, target)
        if (factor === null) continue
        const resized = scaleBoxBy(box, id, factor, mods.alt)
        const corner = boxHandlePoint(resized.box, id)!
        const moved = distance(corner, point)
        // Held back by the smallest size, or pulled too far along the diagonal: no snap.
        if (Math.abs(corner[axis] - target) > 1e-6 || moved > tolerance) continue
        if (!best || moved < best.moved) best = { resized, axis, moved }
      }
      if (!best) return none
      const corner = boxHandlePoint(best.resized.box, id)!
      const snap = snapMoving(index, [corner], { tolerance, axes: { x: best.axis === 'x', y: best.axis === 'y' } })
      return { resized: best.resized, snap: snap.label ? { ...snap, d: { x: 0, y: 0 } } : NO_SNAP }
    }

    const axes = isCornerHandle(id) ? { x: true, y: true } : handleAxes(box.rotation, id)
    if (!axes) return none
    const found = snapMoving(index, [point], { tolerance, axes, edges: true })
    if (!found.label) return none
    return { resized: resizeBox(box, id, startPointer, add(pointer, found.d), mods, uniform), snap: found }
  }

  /**
   * Snap what a handle drags. Corners, sides and groove ends land on points,
   * alignments and edges (the pointer is nudged by the snap, so the recipe's
   * own rules still apply); sizes match sizes already in use; rotation
   * settles on 15° steps.
   */
  private snapHandle(
    index: SnapIndex,
    doc: IllustratorDocument,
    exclude: Set<string>,
    start: CarveSpec,
    raw: CarveSpec,
    handle: CarveHandle,
    startPointer: Vec,
    pointer: Vec,
    mods: Modifiers,
    touch: boolean,
  ): { spec: CarveSpec; snap: SnapResult } {
    const tolerance = this.snapTolerance(touch)
    const none = { spec: raw, snap: NO_SNAP }
    const sizes = () => this.sizesFor(doc, exclude)
    // A band has no handles of its own: nothing of it snaps.
    if (raw.kind === 'band' || start.kind === 'band') return none

    if (handle.kind === 'resize' || handle.kind === 'endpoint') {
      const point = handleGeometry(raw, handle.id)
      const axes = isGroove(raw) ? { x: true, y: true } : handleAxes(raw.rotation, handle.id)
      if (!point || !axes) return none
      // A groove's end follows 15° rays from what stays put: its other end, or with Alt its middle.
      const origin = isGroove(raw) ? (mods.alt ? scale(add(raw.from, raw.to), 0.5) : handle.id === 'from' ? raw.to : raw.from) : null
      const snap = snapMoving(index, [point], {
        tolerance,
        axes,
        edges: handle.kind === 'endpoint',
        rays: origin && !mods.shift ? [origin] : undefined,
      })
      const onPoint = snap.hit && snap.hit.kind !== 'edge' && snap.hit.kind !== 'tangent'
      const pointed = () => ({ spec: dragCarveHandle(start, handle.id, startPointer, add(pointer, snap.d), mods), snap })
      if (onPoint || start.kind !== 'slab' || raw.kind !== 'slab') return snap.label ? pointed() : none
      const sized = this.snapSlabSize(index, sizes(), start, raw, handle.id, startPointer, pointer, mods, tolerance)
      return sized ?? (snap.label ? pointed() : none)
    }

    if (handle.kind === 'rotate') {
      if (isGroove(raw) || isGroove(start) || mods.shift) return none
      const rotation = settleAngle(raw.rotation, distance(pointer, start.center), tolerance)
      if (rotation === null) return none
      // The chip already reads the angle: no label repeats it.
      return { spec: { ...raw, rotation }, snap: NO_SNAP }
    }

    const same = (value: number, among: number[], write: (value: number) => CarveSpec) => {
      const found = snapValue(value, among, tolerance)
      return found === null ? none : { spec: write(found), snap: { ...NO_SNAP, label: 'same size' } }
    }
    switch (raw.kind) {
      case 'punch': {
        if (handle.kind !== 'scale') return none
        const all = sizes()
        if (raw.shape !== 'circle' || bentEdgeCount(raw)) return same(raw.radius, all.punchRadii, (radius) => ({ ...raw, radius }))
        const found = this.snapCircleSize(index, [...all.punchRadii, ...all.circleRadii], { c: raw.center, r: raw.radius }, raw.center, tolerance)
        return found ? { spec: { ...raw, radius: found.radius }, snap: found.snap } : none
      }
      case 'polygon':
        // A polygon takes another's radius by its corners (with Shift, its rounding scaled along), and a corner radius in use by its dot.
        if (handle.kind === 'scale') {
          const rounding = (radius: number) => (mods.shift ? raw.cornerRadius * (radius / raw.radius) : raw.cornerRadius)
          return same(raw.radius, sizes().polygonRadii, (radius) => ({ ...raw, radius, cornerRadius: rounding(radius) }))
        }
        if (handle.kind === 'radius') {
          // The dot all the way in, to within the snap's reach of where it stops: fully round, not a whole number short.
          const apothem = polygonApothem(raw)
          if (((apothem - raw.cornerRadius) * RADIUS_DOT_RATE) / Math.cos(Math.PI / raw.sides) <= tolerance) {
            return { spec: { ...raw, cornerRadius: apothem }, snap: { ...NO_SNAP, label: 'fully round' } }
          }
          // Only a corner radius the polygon can draw: no larger than its apothem.
          return same(raw.cornerRadius, drawable(sizes().radii, apothem), (cornerRadius) => ({ ...raw, cornerRadius }))
        }
        return none
      case 'slab':
        // Nor a slab: no larger than half its shorter side.
        if (handle.kind !== 'radius') return none
        return same(raw.radius, drawable(sizes().radii, Math.min(raw.width, raw.height) / 2), (radius) => ({ ...raw, radius }))
      case 'channel':
      case 'slice':
        return handle.kind === 'width' ? same(raw.width, sizes().widths, (width) => ({ ...raw, width })) : none
      default:
        return raw satisfies never
    }
  }

  /**
   * A slab's own resize handle, with no point to land on. A circle slab
   * pulled evenly by a corner stays a circle: it takes the size of another
   * circle ("same size"), or grows about the corner that stays put until it
   * touches a line, an edge or a circle ("tangent"). A side takes the width
   * or height of another slab ("same size"). Null when nothing is in reach.
   */
  private snapSlabSize(
    index: SnapIndex,
    sizes: ReturnType<typeof documentSizes>,
    start: SlabSpec,
    raw: SlabSpec,
    id: HandleId,
    startPointer: Vec,
    pointer: Vec,
    mods: Modifiers,
    tolerance: number,
  ): { spec: CarveSpec; snap: SnapResult } | null {
    const f = handleFraction(id)
    if (!f) return null
    const corner = f.x !== 0 && f.y !== 0
    const circle = asCircle({ carve: raw, contours: [] })
    if (corner && mods.shift && circle && asCircle({ carve: start, contours: [] })) {
      const pivot = mods.alt ? start.center : add(start.center, rotate({ x: (-f.x * start.width) / 2, y: (-f.y * start.height) / 2 }, start.rotation))
      const found = this.snapCircleSize(index, sizes.circleRadii, circle, pivot, tolerance)
      if (!found) return null
      return { spec: scaleCarveAbout(start, pivot, found.radius / (start.width / 2)), snap: found.snap }
    }
    if (corner) return null
    const along = f.x !== 0 ? 'width' : 'height'
    const same = snapValue(raw[along], sizes.slabSides, tolerance)
    if (same === null) return null
    // The pointer moves as far as the side must: half as far with Alt, which moves both sides.
    const dir = rotate(f, start.rotation)
    const nudged = add(pointer, scale(dir, (same - raw[along]) / (mods.alt ? 2 : 1)))
    const spec = dragCarveHandle(start, id, startPointer, nudged, mods)
    return spec.kind === 'slab' && Math.abs(spec[along] - same) < 1e-6 ? { spec, snap: { ...NO_SNAP, label: 'same size' } } : null
  }

  /** Outline, unbent ghost (if bent) and handles of a recipe being shown or edited. */
  private drawRecipe(overlay: paper.Layer, spec: CarveSpec, hotHandle: string | null, outline = true) {
    const center = this.center()
    this.scope.activate()
    overlay.activate()
    if (bentEdgeCount(spec)) {
      outlinePathData(this.scope, overlay, carveOutline(unbent(spec)).pathData, center, { dashed: true, width: 1, opacity: 0.6 })
    }
    if (outline) outlinePathData(this.scope, overlay, carveOutline(spec).pathData, center)
    drawCarveHandles(this.scope, overlay, carveHandles(spec, this.handleLayout()), center, hotHandle)
  }

  /**
   * What a tool's press or hover would reach instead of the tool, if
   * anything. Box handles stay out of a tool's way, and so does the turning
   * ring outside a recipe's corners: nothing is drawn there, so a press there
   * starts the tool. Under the Guide tool, guides and the selected guide's
   * handles come first.
   */
  private toolZone(p: Vec, touch: boolean): Zone | null {
    if (this.live === 'none' && !this.guidesFirst && !this.filletsFirst) return null
    const zone = findZone({ ...this.context(touch), edges: false }, p)
    if (zone.kind === 'handle' && !zone.ring) return zone
    if (this.guidesFirst && (zone.kind === 'guide' || zone.kind === 'guide-handle')) return zone
    if (this.filletsFirst && (zone.kind === 'fillet' || zone.kind === 'fillet-dot')) return zone
    return null
  }

  /** Is this guide one of the selected? */
  private isGuideSelected(id: string): boolean {
    return (this.host.getDoc().selectedGuideIds ?? []).includes(id)
  }

  /**
   * What a tool's press reaches while a tool is active: the editor (a handle,
   * or a selected guide, which a drag moves), or under the Guide tool a guide
   * not selected. A click on that selects it, but a drag draws a new line from
   * it, starting where it was pressed on it (or where two lines cross there),
   * so new guides can start on guides. Null leaves the press to the tool.
   */
  toolPressTarget(p: Vec, touch: boolean): { kind: 'editor'; zone: Zone['kind'] } | { kind: 'guide'; guideId: string; start: Vec } | null {
    const zone = this.toolZone(p, touch)
    if (!zone) return null
    if (zone.kind !== 'guide' || this.isGuideSelected(zone.guideId)) return { kind: 'editor', zone: zone.kind }
    const reach = GUIDE_PX * this.unitsPerPx() * (touch ? 2 : 1)
    const start = startOnGuides(this.reachableGuides(this.host.getDoc()), sub(p, this.center()), reach) ?? zone.point
    return { kind: 'guide', guideId: zone.guideId, start }
  }

  /**
   * A radius the Round tool's drag gives: the same size as another fillet or
   * a radius on the sheet within the snap distance, unless snapping is off or
   * `free` (Cmd held); else whole units. From 2 to 200 either way.
   */
  snapToolFilletRadius(radius: number, touch: boolean, free: boolean): { radius: number; same: boolean } {
    const doc = this.host.getDoc()
    const same = this.host.isSnapping() && !free ? snapFilletRadius(radius, filletSizes(doc, this.sizesFor(doc, new Set()), null), this.snapTolerance(touch)) : null
    return { radius: filletRadius(same ?? radius), same: same !== null }
  }

  /**
   * Hover while a tool is active: only handles (and guides, under the Guide
   * tool) react. Returns the cursor to show, if any. With `cornerFirst` a
   * fillet's circle or radius dot gives way, as a press there rounds the
   * corner under it.
   */
  toolHover(p: Vec, touch: boolean, cornerFirst = false): string | null {
    this.resting = null
    const found = this.toolZone(p, touch)
    const zone = cornerFirst && (found?.kind === 'fillet' || found?.kind === 'fillet-dot') ? null : found
    const hot = zone ?? EMPTY_ZONE
    if (zoneKey(hot) !== zoneKey(this.hover)) {
      this.hover = hot
      this.drawOverlay()
    }
    // A guide not selected lights up, but a drag from it draws: the tool's cursor stays.
    if (zone?.kind === 'guide' && !this.isGuideSelected(zone.guideId)) return null
    return zone ? this.cursorFor(zone) : null
  }

  /** Drag a recipe's edge: its side bends, its corner fills out, or its groove's spine curves. */
  private carveBendSession(press: Press, layerId: string, grab: CarveGrab): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!layer?.carve || layer.locked) return null
    const start = layer.carve
    const exclude = new Set([layerId])
    const compose = this.composeFor(doc, exclude)
    let index: SnapIndex | null = null
    let current = start
    return {
      editedIds: new Set([...exclude, ...this.followersOf(doc, exclude)]),
      update: (p, mods) => {
        // The grabbed point follows the pointer's movement, wherever on the band it was pressed.
        let target = add(grab.point, sub(p, press.point))
        let snap: SnapResult = NO_SNAP
        if (this.snapsOn(mods)) {
          index ??= this.makeSnapIndex(doc, exclude)
          snap = snapMoving(index, [target], { tolerance: this.snapTolerance(press.touch) })
          target = add(target, snap.d)
        }
        current = bendCarve(start, grab, target)
        const settled = grab.side.type === 'corner' ? 'round' : 'straight'
        this.showSnap(snap, isSideBent(current, grab.side) ? null : settled)
        this.showInk(compose, new Map([[layerId, carveOutline(current).pathData]]), new Map([[layerId, current]]))
        hud.set({ chip: bendReadout(current, grab.side) })
        this.drawOverlay()
      },
      commit: () => {
        if (JSON.stringify(current) === JSON.stringify(start)) return
        this.host.commitLayerEdits({ label: bendLabel(start, grab.side), edits: [{ layerId, carve: current }], select: [layerId] })
      },
      cancel: () => this.restoreInk(),
      drawOverlay: (overlay) => {
        this.drawRecipe(overlay, current, null)
        this.drawSide(overlay, current, grab.side)
      },
    }
  }

  /** Drag a free shape's edge: the curve passes through the pointer, smooth neighbours stay smooth. */
  private freeBendSession(press: Press, zone: EdgeZone): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(zone.layerId)
    if (!layer || layer.carve || layer.locked || !zone.free) return null
    const { contourIndex, curveIndex } = zone.free
    const shape = this.freePathOf(layer)
    const start = shape?.[contourIndex]
    if (!shape || !start || curveIndex >= start.segs.length) return null
    const t = clamp(zone.free.t, BEND_T_MIN, BEND_T_MAX)
    const base = cubicPoint(freeCurve(start, curveIndex), t)
    const exclude = new Set([layer.id])
    const compose = this.composeFor(doc, exclude)
    const center = this.center()
    const wasStraight = isCurveStraight(start, curveIndex)
    let index: SnapIndex | null = null
    let current = start
    let straight = wasStraight
    return {
      editedIds: new Set([...exclude, ...this.followersOf(doc, exclude)]),
      update: (p, mods) => {
        let target = add(base, sub(p, press.point))
        let snap: SnapResult = NO_SNAP
        if (this.snapsOn(mods)) {
          index ??= this.makeSnapIndex(doc, exclude, otherAnchors(shape, null))
          snap = snapMoving(index, [target], { tolerance: this.snapTolerance(press.touch) })
          target = add(target, snap.d)
        }
        const bent = bendCurve(start, curveIndex, t, target)
        // Close to the chord counts as straight: the bend removes itself.
        straight = maxChordDeviation(freeCurve(bent, curveIndex)) < 2 * this.unitsPerPx()
        current = straight ? (wasStraight ? start : straightenCurve(start, curveIndex)) : bent
        this.showSnap(straight ? null : snap, straight ? 'straight' : null)
        this.showInk(compose, new Map([[layer.id, shapePathData(withContour(shape, contourIndex, current))]]))
        hud.set({
          chip: straight ? 'straight' : `depth ${r0(maxChordDeviation(freeCurve(current, curveIndex)))}`,
        })
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        const point = this.host.getDoc().pointSelection
        this.host.commitLayerEdits({
          label: straight ? 'Straighten edge' : 'Bend edge',
          edits: [{ layerId: layer.id, contourIndex, pathData: editablePathToPathData(current) }],
          select: [layer.id],
          anchor: point?.layerId === layer.id ? undefined : null,
        })
      },
      cancel: () => this.restoreInk(),
      drawOverlay: (overlay) => {
        const whole = withContour(shape, contourIndex, current)
        outlinePathData(this.scope, overlay, shapePathData(whole), center)
        drawCurves(this.scope, overlay, [freeCurve(current, curveIndex)], center)
        drawAnchors(this.scope, overlay, whole, center, null, null, layer.frameRotation ?? 0)
      },
    }
  }

  /** Highlight every outline curve belonging to one side of a recipe. */
  private drawSide(overlay: paper.Layer, spec: CarveSpec, side: SideRef) {
    const outline = carveOutline(spec)
    const key = JSON.stringify(side)
    const curves: Cubic[] = outline.curves.filter((_, i) => JSON.stringify(outline.curveSides[i]) === key)
    this.scope.activate()
    drawCurves(this.scope, overlay, curves, this.center())
  }

  /** Drag one anchor of a free shape, on any of its contours, or one of its Bézier handles. */
  private pointSession(
    press: Press,
    layerId: string,
    contourIndex: number,
    anchorIndex: number,
    which: 'anchor' | 'in' | 'out',
  ): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!layer || layer.carve) return null
    const shape = this.freePathOf(layer)
    const start = shape?.[contourIndex]
    if (!shape || !start || !start.segs[anchorIndex]) return null
    const seg = start.segs[anchorIndex]
    const handle = which === 'anchor' ? null : ((which === 'in' ? seg.hIn : seg.hOut) ?? { x: 0, y: 0 })
    const startPoint = handle ? add(seg.p, handle) : seg.p
    const count = start.segs.length
    // An anchor follows 15° rays from its neighbours; a handle, from its own anchor.
    const neighbours =
      which === 'anchor'
        ? [anchorIndex - 1, anchorIndex + 1]
            .filter((i) => start.closed || (i >= 0 && i < count))
            .map((i) => start.segs[(i + count) % count].p)
        : [seg.p]
    const exclude = new Set([layerId])
    const compose = this.composeFor(doc, exclude)
    let index: SnapIndex | null = null
    let current = start
    const center = this.center()
    return {
      editedIds: new Set([...exclude, ...this.followersOf(doc, exclude)]),
      update: (p, mods) => {
        let d = sub(p, press.point)
        let snap: SnapResult = NO_SNAP
        if (this.snapsOn(mods)) {
          const tolerance = this.snapTolerance(press.touch)
          if (which === 'anchor') {
            index ??= this.makeSnapIndex(doc, exclude, otherAnchors(shape, { contourIndex, index: anchorIndex }))
            snap = snapMoving(index, [add(startPoint, d)], { tolerance, edges: true, rays: neighbours })
          } else {
            snap = snapMoving({ targets: [] }, [add(startPoint, d)], { tolerance, rays: neighbours })
          }
          d = add(d, snap.d)
        }
        current =
          which === 'anchor'
            ? moveAnchor(start, anchorIndex, add(seg.p, d))
            : moveHandle(start, anchorIndex, which, add(startPoint, d), { breakSmooth: mods.alt })
        this.showSnap(snap)
        this.showInk(compose, new Map([[layerId, shapePathData(withContour(shape, contourIndex, current))]]))
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        // Only this contour is written: the others keep what they were.
        this.host.commitLayerEdits({
          label: which === 'anchor' ? 'Move point' : 'Shape curve',
          edits: [{ layerId, contourIndex, pathData: editablePathToPathData(current) }],
          select: [layerId],
          anchor: { layerId, contourIndex, segmentIndex: anchorIndex },
        })
      },
      cancel: () => this.restoreInk(),
      drawOverlay: (overlay) => {
        const whole = withContour(shape, contourIndex, current)
        outlinePathData(this.scope, overlay, shapePathData(whole), center)
        drawAnchors(this.scope, overlay, whole, center, { contourIndex, index: anchorIndex }, null, layer.frameRotation ?? 0)
      },
    }
  }

  /* ─── Guides ─── */

  /**
   * Drag a guide: it moves, and the other selected guides with it when it is
   * one of them. Its grabbed point (a circle's centre too, a path's points)
   * snaps as a shape's points do. A guide that followed a shape no longer
   * does once it is moved by hand: the HUD says so. One commit per drag.
   */
  private guideMoveSession(press: Press, pressedId: string, grab: Vec): Session | null {
    const doc = this.host.getDoc()
    const all = doc.guides ?? []
    const reachable = new Set(this.reachableGuides(doc).map((guide) => guide.id))
    const selected = doc.selectedGuideIds ?? []
    const ids = new Set(selected.includes(pressedId) ? selected.filter((id) => reachable.has(id)) : [pressedId])
    const starts = all.filter((guide) => ids.has(guide.id))
    if (!starts.length) return null
    const detaches = starts.some((guide) => guide.link)
    const keyPoints = starts.length === 1 ? guideKeyPoints(starts[0].shape, grab) : [grab]
    // One circle or line moved alone can snap to touch.
    const lone = starts.length === 1 && starts[0].shape.kind !== 'path' ? starts[0].shape : null
    const primary = nearestIndex(keyPoints, grab)
    let index: SnapIndex | null = null
    let d: Vec = { x: 0, y: 0 }
    // Stored to hundredths, as shapes are: what the drag shows is what lands.
    const moved = () => starts.map((guide) => ({ ...detachGuide(guide), shape: moveGuideShape(guide.shape, d) }))
    return {
      editedIds: new Set(),
      guideIds: ids,
      update: (p, mods) => {
        d = sub(p, press.point)
        const axes = mods.shift ? (Math.abs(d.x) >= Math.abs(d.y) ? { x: true, y: false } : { x: false, y: true }) : undefined
        if (axes) d = { x: axes.x ? d.x : 0, y: axes.y ? d.y : 0 }
        let snap: SnapResult = NO_SNAP
        if (this.snapsOn(mods)) {
          index ??= this.makeSnapIndex(doc, new Set(), [], ids)
          const tolerance = this.snapTolerance(press.touch)
          snap = snapMoving(index, keyPoints.map((k) => add(k, d)), {
            tolerance,
            axes,
            edges: keyPoints.length === 1,
            primary,
            circle: lone?.kind === 'circle' ? { c: add(lone.c, d), r: lone.r } : undefined,
            // A line moved touches a circle, as a circle moved touches a line.
            line: lone?.kind === 'line' ? { p: add(lone.p, d), angle: lone.angle } : undefined,
          })
          d = add(d, snap.d)
          // With nothing to snap to, whole units, so the number shown is the number the guide moves.
          if (!snap.label) d = { x: Math.round(d.x), y: Math.round(d.y) }
        }
        this.showSnap(snap)
        if (detaches) hud.set({ label: snap.label ? `${snap.label} · detached` : 'detached' })
        hud.set({ chip: `${r2(d.x)}, ${r2(d.y)}` })
        this.drawOverlay()
      },
      commit: () => {
        if (Math.hypot(d.x, d.y) < 0.5) return
        const next = new Map(moved().map((guide) => [guide.id, guide.shape]))
        this.commitOntoCurrent(next.size > 1 ? 'Move guides' : 'Move guide', next)
      },
      cancel: () => {},
      guideShapes: () => new Map(moved().map((guide) => [guide.id, guide.shape])),
      drawOverlay: (overlay) => this.drawGuideOutlines(overlay, moved()),
    }
  }

  /**
   * Drag a handle of the selected guide: a line's knob turns it about its
   * pivot (Shift in 15° steps; with snapping on, settling on them and landing
   * on whole degrees), a circle's squares set its radius (the same size as a
   * punch or another circle, touching an edge, a guide or a circle, or else
   * a whole unit). One commit per drag.
   */
  private guideHandleSession(press: Press, handle: GuideHandle): Session | null {
    const doc = this.host.getDoc()
    const all = doc.guides ?? []
    const guide = all.find((candidate) => candidate.id === handle.guideId)
    if (!guide || guide.locked) return null
    const turning = handle.id === 'rotate'
    let shape: GuideShape = guide.shape
    let index: SnapIndex | null = null
    const center = this.center()
    return {
      editedIds: new Set(),
      guideIds: new Set([guide.id]),
      update: (p, mods) => {
        const pointer = sub(p, center)
        const reach = distance(pointer, handle.pivot)
        const tolerance = this.snapTolerance(press.touch)
        let label: string | null = null
        if (turning) {
          let angle = (Math.atan2(pointer.y - handle.pivot.y, pointer.x - handle.pivot.x) * 180) / Math.PI
          if (mods.shift) angle = Math.round(angle / 15) * 15
          else if (this.snapsOn(mods)) angle = settleAngle(angle, reach, tolerance) ?? Math.round(angle)
          // Stored to hundredths, as a shape's turn is.
          shape = lineShape({ x: r2(handle.pivot.x), y: r2(handle.pivot.y) }, r2(angle))
          hud.set({ chip: shape.kind === 'line' ? `${lineReading(shape.angle)}°` : null })
        } else {
          let r = reach
          if (this.snapsOn(mods)) {
            const own = new Set([guide.id])
            index ??= this.makeSnapIndex(doc, new Set(), [], own)
            const sizes = this.sizesFor(doc, own)
            const found = this.snapCircleSize(index, [...sizes.punchRadii, ...sizes.circleRadii], { c: handle.pivot, r }, handle.pivot, tolerance)
            r = found ? found.radius : Math.max(1, Math.round(r))
            label = found?.snap.label ?? null
            this.snapHints = found?.snap.hints ?? []
          }
          r = r2(r)
          shape = { kind: 'circle', c: handle.pivot, r }
          hud.set({ chip: `r ${r2(r)}` })
        }
        if (guide.link) label = label ? `${label} · detached` : 'detached'
        hud.set({ label })
        this.drawOverlay()
      },
      commit: () => {
        if (sameGuideShape(shape, guide.shape)) return
        this.commitOntoCurrent(turning ? 'Turn guide' : 'Resize guide', new Map([[guide.id, shape]]))
      },
      cancel: () => {},
      guideShapes: () => new Map([[guide.id, shape]]),
      drawOverlay: (overlay) => this.drawGuideOutlines(overlay, [{ shape, style: guide.style }]),
    }
  }

  /**
   * Commit the shapes a gesture gave some guides onto the document's guides
   * as they are now, not as they were at the press: a guide deleted meanwhile
   * stays gone, and other changes made meanwhile stay. Moved by hand, a guide
   * no longer follows a shape.
   */
  private commitOntoCurrent(label: string, shapes: Map<string, GuideShape>): void {
    const current = this.host.getDoc().guides ?? []
    const kept = current.filter((guide) => shapes.has(guide.id)).map((guide) => guide.id)
    if (!kept.length) return
    const next = current.map((guide) => {
      const shape = shapes.get(guide.id)
      return shape ? { ...detachGuide(guide), shape } : guide
    })
    this.host.commitGuides(label, next, kept)
  }

  /**
   * Guides in the selection colour, over a white halo: the selected ones, or
   * the ones a drag moves, or fainter, the one under the pointer. Each keeps
   * its own style, dashed or dotted, so a change of style shows at once.
   */
  private drawGuideOutlines(overlay: paper.Layer, guides: ReadonlyArray<Pick<Guide, 'shape' | 'style'>>, look: StrokeStyle = { width: 1.25 }) {
    const center = this.center()
    const rect = visibleLayerRect(this.scope)
    this.scope.activate()
    overlay.activate()
    for (const { shape, style } of guides) {
      const item = guidePathItem(this.scope, shape, center, rect)
      const width = Math.max(look.width ?? 1.25, GUIDE_LINE[style].width)
      if (item) addWithHalo(this.scope, overlay, item, { ...look, width, ...guideDashAt(style, width) })
    }
  }

  /**
   * The recipes of the layers a gesture reshapes, as they are now: from the
   * preview once it has one, else as they were. A layer the preview has
   * made free has none.
   */
  private liveCarves(edited: ReadonlySet<string>): CarveSpec[] {
    const preview = this.preview
    const carves: CarveSpec[] = []
    for (const id of edited) {
      const layer = this.layer(id)
      if (!layer?.visible) continue
      const carve = preview?.paths.has(id) ? preview.carves.get(id) : layer.carve
      if (carve) carves.push(carve)
    }
    return carves
  }

  /**
   * While a gesture reshapes some layers, the construction guides that
   * follow them are drawn where the follow pass will put them, from the live
   * frame; the drawn ones hide meanwhile. Returns the guides drawn so.
   */
  private drawFollowingGuides(overlay: paper.Layer): Map<string, GuideShape> {
    const drawn = new Map<string, GuideShape>()
    const preview = this.preview
    if (!preview || !this.host.guidesShown()) return drawn
    const center = this.center()
    const rect = visibleLayerRect(this.scope)
    const u = this.unitsPerPx()
    for (const guide of this.host.getDoc().guides ?? []) {
      const link = guide.link
      if (!link || !guide.visible || !preview.paths.has(link.of)) continue
      const carve = preview.carves.get(link.of)
      const pathData = preview.paths.get(link.of)
      // A free shape is measured in its frame: turned with it in a box turn, else as it was.
      const rotation = preview.frames.get(link.of) ?? this.layer(link.of)?.frameRotation ?? 0
      const source = carve ? { carve, contours: [] } : pathData ? { contours: pathDataToContours(pathData), frame: { rotation } } : null
      const shape = source && constructionShape(source, link.role)
      if (!shape) continue
      this.scope.activate()
      const item = guidePathItem(this.scope, shape, center, rect)
      if (!item) continue
      styleGuideItem(this.scope, item, guide.style, u)
      item.locked = true
      overlay.addChild(item)
      drawn.set(guide.id, shape)
    }
    return drawn
  }

  /**
   * The marks where guides cross and where a frame guide touches its
   * circle, drawn again from the guides and shapes as they are on this
   * frame, while a gesture moves some: the sheet's own stay hidden meanwhile.
   */
  private drawLiveGuidePoints(overlay: paper.Layer, shown: readonly Guide[], live: ReadonlyMap<string, GuideShape>): void {
    const guides = shown.map((guide) => {
      const shape = live.get(guide.id)
      return shape ? { ...guide, shape } : guide
    })
    const carves = this.preview?.carves
    const points = guidePointMarks(this.scope, guides, (id) => {
      const layer = this.layer(id)
      if (!layer?.visible) return null
      const carve = carves?.get(id) ?? layer.carve
      return carve ? asCircle({ carve, contours: [] }) : null
    }, true)
    if (!points) return
    points.locked = true
    overlay.addChild(points)
  }

  /**
   * The topmost shape under the pointer or just beside its outline, for the
   * Guide tool to show its construction lines: null over the empty canvas.
   */
  shapeAt(p: Vec, touch: boolean): string | null {
    const layers = this.host.getDoc().layers
    const reach = 6 * this.unitsPerPx() * (touch ? 2 : 1)
    const point = new this.scope.Point(p.x, p.y)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]
      const item = this.items.get(layer.id)
      if (!layer.visible || !item) continue
      // Measured only near its bounds: on a mark of hundreds of layers, a hover stays cheap.
      const { left, top, right, bottom } = item.bounds
      if (p.x < left - reach || p.x > right + reach || p.y < top - reach || p.y > bottom + reach) continue
      if (item.contains(point)) return layer.id
      const near = item.getNearestLocation(point)
      if (near && near.distance <= reach) return layer.id
    }
    return null
  }

  /** A shape's drawn bounds in layer space, or null when it draws nothing. */
  shapeBounds(id: string): Bounds | null {
    const item = this.items.get(id)
    if (!item) return null
    const { left, top, right, bottom } = item.bounds
    const c = this.center()
    return { minX: left - c.x, minY: top - c.y, maxX: right - c.x, maxY: bottom - c.y }
  }

  /**
   * Show the outline of an offset the selection bar is setting, dashed over
   * the ink, in place of the copy it stands in for; null shows none.
   */
  showOffsetOutline(pathData: string | null, replaces: string | null = null): void {
    const next = pathData === null ? null : { pathData, replaces }
    if (next?.pathData === this.offsetOutline?.pathData && next?.replaces === this.offsetOutline?.replaces) return
    this.offsetOutline = next
    this.drawOverlay()
  }

  /**
   * Say why a command did nothing, by the selection's box, and outline
   * what is in the way, a layer or every piece of a group, for a moment.
   */
  showRefusal(refused: Refused): void {
    if (this.destroyed) return
    this.placeKeyHud()
    hud.hold(refused.words, REFUSAL_MS)
    hud.announce(refused.words)
    if (this.blocker) window.clearTimeout(this.blocker.timer)
    this.blocker = null
    if (refused.blocker) {
      const timer = window.setTimeout(() => {
        this.blocker = null
        this.drawOverlay()
      }, REFUSAL_MS)
      this.blocker = { id: refused.blocker, timer }
    }
    this.drawOverlay()
  }

  /* ─── Overlay ─── */

  /** The one selected slab or polygon, when it is too small on screen for its rounding dot to keep clear of its centre. */
  private dotlessRecipes(selected: readonly string[]): string[] {
    if (selected.length !== 1) return []
    const carve = this.layer(selected[0])?.carve
    if (carve?.kind !== 'slab' && carve?.kind !== 'polygon') return []
    return carveHandles(carve, this.handleLayout()).some((handle) => handle.kind === 'radius') ? [] : [selected[0]]
  }

  private drawOverlay(): void {
    if (this.destroyed) return
    const doc = this.host.getDoc()
    this.scope.activate()
    setOverlayScale(this.unitsPerPx())
    const layer = resetOverlay(this.scope)
    const editing = this.session
    const edited = editing?.editedIds ?? new Set<string>()
    hideLayerOutlines(this.items, edited)
    const ids = new Set(doc.layers.map((candidate) => candidate.id))
    const selected = doc.selectedLayerIds.filter((id) => ids.has(id))
    if (!editing) hiddenRadiusDots.set(this.dotlessRecipes(selected))

    // A press there takes what a click would select: the layer, or every piece of its group.
    if (this.hover.kind === 'body' && !selected.includes(this.hover.layerId) && !edited.has(this.hover.layerId)) {
      for (const id of this.leavesUnder(doc, this.rootOf(doc, this.hover.layerId))) {
        const item = edited.has(id) || selected.includes(id) || !this.layer(id)?.visible ? undefined : this.items.get(id)
        if (item) outlineItem(this.scope, layer, item, { dashed: true, width: 1.25 })
      }
    }
    if (!editing) this.drawEnteredGroup(doc, layer)
    if (this.blocker) {
      for (const id of this.leavesUnder(doc, this.blocker.id)) {
        const item = this.layer(id)?.visible ? this.items.get(id) : undefined
        if (item) outlineItem(this.scope, layer, item, { dashed: true, width: 1.5, color: NO_FIT_COLOR })
      }
    }
    const offset = editing ? null : this.offsetOutline
    for (const id of selected) {
      if (edited.has(id) || id === offset?.replaces) continue
      const item = this.items.get(id)
      if (item) outlineItem(this.scope, layer, item)
    }
    if (offset) outlinePathData(this.scope, layer, offset.pathData, this.center(), { dashed: true, width: 1.5 })
    if (!editing) for (const id of selected) this.drawBandCircles(doc, layer, id)

    // Guides: the one under the pointer, the selected ones, and those following a reshaped layer.
    const movingGuides = editing?.guideIds ?? new Set<string>()
    const shownGuides = this.host.guidesShown() ? (doc.guides ?? []).filter((guide) => guide.visible) : []
    const hoverGuide = this.hover.kind === 'guide' ? this.hover.guideId : null
    const selectedGuides = new Set(doc.selectedGuideIds ?? [])
    const hovered = shownGuides.filter((guide) => guide.id === hoverGuide && !selectedGuides.has(guide.id) && !movingGuides.has(guide.id))
    this.drawGuideOutlines(layer, hovered, { width: 1, opacity: 0.6 })
    const chosen = shownGuides.filter((guide) => selectedGuides.has(guide.id) && !movingGuides.has(guide.id))
    this.drawGuideOutlines(layer, chosen)
    const following = editing ? this.drawFollowingGuides(layer) : new Map<string, GuideShape>()
    const hidden = new Set([...movingGuides, ...following.keys()])
    hideGuides(this.scope, hidden)
    if (hidden.size) this.drawLiveGuidePoints(layer, shownGuides, new Map([...following, ...(editing?.guideShapes?.() ?? [])]))
    // Fillets: the one under the pointer, and the selected ones with the radius dot of one alone.
    if (this.host.filletsShown?.() && !this.filletPreview) {
      const shown = this.shownFillets()
      const chosen = new Set(doc.selectedFilletIds ?? [])
      const hoverFillet = this.hover.kind === 'fillet' ? this.hover.filletId : filletRowHover.get()
      for (const fillet of shown) {
        if (fillet.id === hoverFillet && !chosen.has(fillet.id)) this.drawFillet(layer, fillet, false, false, { width: 1, opacity: 0.6 })
        if (chosen.has(fillet.id)) this.drawFillet(layer, fillet, chosen.size === 1 && !editing, this.hover.kind === 'fillet-dot', fillet.lost ? { color: NO_FIT_COLOR } : {})
      }
    }
    // A guide's handles show only where a press can reach them: under Select, or under the Guide tool.
    if (!editing && (this.live === 'all' || this.guidesFirst)) {
      const handles = this.selectedGuideHandles(doc)
      const hot = this.hover.kind === 'guide-handle' ? this.hover.handle.id : null
      if (handles.length) drawGuideHandles(this.scope, layer, handles, this.center(), hot)
    }

    if (editing) {
      drawLiveConstructionMarks(this.scope, layer, this.liveCarves(edited), this.center())
      editing.drawOverlay(layer)
    } else if (this.live !== 'none') {
      const set = this.handleSet(doc)
      const hot = this.hover.kind === 'handle' ? this.hover.handle.id : null
      const recipe = set?.kind === 'recipe' ? this.layer(set.ids[0]) : undefined
      if (recipe?.carve) this.drawRecipe(layer, recipe.carve, hot, false)
      if (set?.kind === 'box') {
        this.scope.activate()
        layer.activate()
        drawCarveHandles(this.scope, layer, set.list, this.center(), hot)
      }
      const free = this.selectedFreePath(doc, selected)
      // The curve that would bend under the pointer.
      if (this.hover.kind === 'edge') this.drawEdgeHover(layer, this.hover)
      if (free) {
        const point = doc.pointSelection
        const selected = point?.layerId === free.layerId ? { contourIndex: point.contourIndex, index: point.segmentIndex } : null
        const hover = this.hover.kind === 'anchor' ? { contourIndex: this.hover.contourIndex, index: this.hover.index } : null
        this.scope.activate()
        layer.activate()
        drawAnchors(this.scope, layer, free.shape, this.center(), selected, hover, this.layer(free.layerId)?.frameRotation ?? 0)
      }
      if (this.pendingPoint) drawGhostPoint(this.scope, layer, this.pendingPoint.point, this.center())
    }
    if (this.snapHints.length) {
      this.scope.activate()
      layer.activate()
      drawSnapHints(this.scope, layer, this.snapHints, this.center())
    }
    this.scope.view.update()
  }

  /**
   * The group the selection has entered, a faint dashed box round its
   * pieces, so a piece inside a group never looks like a layer at the root.
   * Each piece counts in full, a cut too, so the selected one always lies
   * inside its group's box.
   */
  private drawEnteredGroup(doc: IllustratorDocument, overlay: paper.Layer) {
    const group = doc.enteredGroupId ? doc.groups?.find((each) => each.id === doc.enteredGroupId) : undefined
    if (!group) return
    const pieces = new Set(this.leavesUnder(doc, group.id))
    const layers = doc.layers.filter((layer) => pieces.has(layer.id) && layer.visible)
    const box = groupOutline(layers, (layer) => this.freePathOf(layer), group.frameRotation ?? 0)
    if (!box) return
    // Clear of the piece's own frame by a set step, so it reads as the group's, on touch too, where that frame stands further out.
    const corners = boxFrameCorners(box, (this.handleLayout().pad + ENTERED_GROUP_GAP_PX) * this.unitsPerPx())
    const pathData = `M${corners.map((p) => `${p.x},${p.y}`).join('L')}Z`
    outlinePathData(this.scope, overlay, pathData, this.center(), { dash: [2, 4], width: 1, opacity: 0.7 })
  }

  /**
   * A selected band marks the circles it follows, dashed; one they allow no
   * fit shows where it would run, a dashed red line between their centres.
   */
  private drawBandCircles(doc: IllustratorDocument, overlay: paper.Layer, id: string) {
    const band = this.layer(id)
    if (band?.link?.kind !== 'band' || band.carve?.kind !== 'band') return
    for (const end of [band.link.a, band.link.b]) {
      const layer = this.layer(end)
      const guide = layer ? undefined : (doc.guides ?? []).find((each) => each.id === end)?.shape
      const circle = layer ? this.layerCircle(layer) : guide?.kind === 'circle' ? guide : null
      if (circle) outlineCircle(this.scope, overlay, circle.c, circle.r, this.center(), { dashed: true, width: 1.25 })
    }
    if (band.pathData) return
    const { a, b } = band.carve
    outlinePathData(this.scope, overlay, `M${a.c.x},${a.c.y}L${b.c.x},${b.c.y}`, this.center(), { dash: [5, 4], width: 1.5, color: NO_FIT_COLOR })
  }

  private drawEdgeHover(overlay: paper.Layer, zone: EdgeZone) {
    const layer = this.layer(zone.layerId)
    if (!layer) return
    if (layer.carve && zone.carve) {
      this.drawSide(overlay, layer.carve, zone.carve.side)
      return
    }
    const path = zone.free ? this.freePathOf(layer)?.[zone.free.contourIndex] : null
    if (!path || !zone.free || zone.free.curveIndex >= path.segs.length) return
    drawCurves(this.scope, overlay, [freeCurve(path, zone.free.curveIndex)], this.center())
  }

  /* ─── Keys ─── */

  private onKey(event: KeyboardEvent): boolean {
    // A point waiting to be added: Escape drops it, any other key lets it land first.
    if (this.pendingPoint) {
      if (event.key === 'Escape') {
        this.dropPendingPoint()
        return true
      }
      this.flushPendingPoint()
    }
    const doc = this.host.getDoc()

    if (event.key === 'Escape') {
      if (this.session) {
        this.cancel()
        return true
      }
      if (doc.pointSelection) {
        this.host.setSelection(this.selectedRoots(doc), null)
        return true
      }
      // Back one level: from a piece to its group, from the group to nothing.
      if (doc.selectedLayerIds.length) {
        this.host.setSelection(doc.enteredGroupId ? [doc.enteredGroupId] : [])
        return true
      }
      if (doc.selectedGuideIds?.length) {
        this.host.selectGuides(null)
        return true
      }
      if (doc.selectedFilletIds?.length) {
        this.host.selectFillets?.(null)
        return true
      }
      return false
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
      const point = doc.pointSelection
      const layer = point ? this.layer(point.layerId) : undefined
      if (point && layer && !layer.carve) {
        this.host.editAnchor(point.layerId, point.segmentIndex, 'delete', point.contourIndex)
        return true
      }
      return false
    }

    const arrows: Record<string, Vec> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }
    const step = arrows[event.key]
    if (step && !event.metaKey && !event.ctrlKey) {
      if (!canvasOwnsArrowKeys() || this.session || this.press) return false
      if (!doc.selectedLayerIds.length && doc.selectedGuideIds?.length && !event.altKey) {
        const amount = event.shiftKey ? 10 : 1
        this.nudgeGuidesBy({ x: step.x * amount, y: step.y * amount })
        return true
      }
      if (!doc.selectedLayerIds.length) return false
      if (event.altKey) {
        // Left and right turn by 1° (15° with Shift); up and down grow or shrink the longer side by 1 unit (10).
        if (step.x) this.turnBy(step.x * (event.shiftKey ? 15 : 1))
        else this.growBy(-step.y * (event.shiftKey ? 10 : 1))
        return true
      }
      const amount = event.shiftKey ? 10 : 1
      this.nudgeBy({ x: step.x * amount, y: step.y * amount })
      return true
    }
    return false
  }

  /**
   * The box Alt with the arrow keys turns and scales, and what it moves. A
   * recipe alone turns and scales as its own knob and handles do, so the
   * cuts in it stay where they are; any other box carries its cuts, as a
   * drag of its handles does: those its burst picked at its first key.
   */
  private keyBox(
    doc: IllustratorDocument,
    kind: HistoryMergeKind,
  ): { box: OrientedBox; moved: BoxMembers; going: KeyBurst | null } | null {
    const around = selectionBox(doc, (layer) => this.freePathOf(layer))
    if (!around) return null
    const lone = around.ids.length === 1 && Boolean(this.layer(around.ids[0])?.carve) && !around.group
    const going = this.burstGoing(doc, kind)
    const moved = this.boxMembers(doc, around.ids, !lone, going?.carried)
    return moved && { box: around.box, moved, going }
  }

  /**
   * A key that finds nothing to turn or scale because the selection waits,
   * empty, says so: a band "no fit", a copy "empty". It writes nothing.
   */
  private sayWaiting(doc: IllustratorDocument) {
    const selected = new Set(doc.selectedLayerIds)
    const waiting = doc.layers.flatMap((layer) =>
      selected.has(layer.id) && layer.link && !layer.pathData ? [{ band: layer.link.kind === 'band', number: layerNumbers(doc).get(layer.id) ?? '—' }] : [],
    )
    if (!waiting.length) return
    const numbers = waiting.map((one) => one.number).join(', ')
    const bands = waiting.every((one) => one.band)
    hud.hold(bands ? `band ${numbers}: no fit` : `${numbers}: empty`, UNPINNED_MS)
    hud.announce(bands ? `No fit: band ${numbers} waits until its circles allow it` : `Nothing to turn or scale: ${numbers} waits, empty`)
  }

  /**
   * The burst a key of `kind` goes on with: the last one, if it was of the
   * same kind on the same selection, nothing else has changed the layers
   * since, and its last key came within the time the store joins a burst
   * into one undo step.
   */
  private burstGoing(doc: IllustratorDocument, kind: HistoryMergeKind): KeyBurst | null {
    const last = this.keyBurst
    const going =
      last?.kind === kind &&
      last.ids === doc.selectedLayerIds.join(' ') &&
      last.layers === doc.layers &&
      Date.now() - last.at < HISTORY_MERGE_MS
    return going ? last : null
  }

  /** Note the burst a key just wrote to, so the next key of it goes on from there. */
  private noteBurst(kind: HistoryMergeKind, carried: string[], turn: KeyBurst['turn'] = null) {
    const doc = this.host.getDoc()
    this.keyBurst = { kind, ids: doc.selectedLayerIds.join(' '), carried, turn, at: Date.now(), layers: doc.layers }
  }

  /**
   * Alt with Left or Right: turn the selection about its box's centre, so
   * the box lands on a whole degree. Each key is written at once, and the
   * store joins a burst into one undo step. The keys of a burst turn about
   * the point the first one did, though the box around several layers is
   * measured upright again after each, and read out how far the box has
   * turned since it began.
   */
  private turnBy(step: number) {
    const doc = this.host.getDoc()
    const target = this.keyBox(doc, 'key-turn')
    if (!target) return this.sayWaiting(doc)
    const { moved, going } = target
    const center = going?.turn ? going.turn.center : target.box.center
    const was = going?.turn ? going.turn.rotation : target.box.rotation
    const rotation = normalizeDegrees(Math.round(was + step))
    const move = turnMove(center, normalizeDegrees(rotation - was))
    const edits = [...boxEdits(moved, move), ...groupFrameEdits(doc, moved, move.turn)]
    this.saysOwn(() => this.host.commitLayerEdits({ label: boxLabel(true, moved.members.size > 1), edits, merge: 'key-turn' }))
    this.noteBurst('key-turn', [...moved.carried.keys()], { center, rotation })
    this.showKeyChip(`${r0(rotation)}°`)
    // Each key reads out where the selection now is, never how far the burst has gone.
    this.announceEdit(doc, `Turned to ${r0(rotation)}°`)
  }

  /**
   * Alt with Up or Down: scale the selection evenly about its box's centre,
   * so the box's longer side grows or shrinks by `step` units and a whole
   * size stays whole. Written at once; a burst is one undo step.
   */
  private growBy(step: number) {
    const doc = this.host.getDoc()
    const target = this.keyBox(doc, 'key-scale')
    if (!target) return this.sayWaiting(doc)
    const { box, moved } = target
    const longer = Math.max(box.width, box.height)
    if (longer <= 1e-6) return
    // Paths are stored to a thousandth, so a whole side turned in its frame may read a hair off.
    const whole = Math.abs(longer - Math.round(longer)) < 0.01 ? Math.round(longer) : longer
    const factor = Math.max((whole + step) / longer, evenScaleFloor(box))
    const move = scaleMove(box.center, factor)
    this.saysOwn(() => this.host.commitLayerEdits({ label: boxLabel(false, moved.members.size > 1), edits: boxEdits(moved, move), merge: 'key-scale' }))
    this.noteBurst('key-scale', [...moved.carried.keys()])
    const size = `${r0(box.width * factor)} × ${r0(box.height * factor)}`
    this.showKeyChip(size)
    this.announceEdit(doc, `Size ${size}`)
  }

  /**
   * The number a key reached, by the top right corner of the selection's box
   * as it is now drawn, or by `at` (layer space), for a moment.
   */
  private showKeyChip(chip: string, at?: Vec, label: string | null = null) {
    if (at) this.placeHud(add(at, this.center()))
    else if (!this.placeKeyHud()) return
    this.readoutShown = false
    hud.set({ label, chip })
    this.keyChipLayers = this.host.getDoc().layers
    window.clearTimeout(this.keyChipTimer)
    // Only the chip waits: the edit is already written.
    this.keyChipTimer = window.setTimeout(() => this.dropKeyChip(), KEY_CHIP_MS)
  }

  /** Put the HUD by the top right corner of the selection's box as it is now drawn. False when nothing is selected. */
  private placeKeyHud(): boolean {
    const around = selectionBox(this.host.getDoc(), (layer) => this.freePathOf(layer))
    if (!around) return false
    const corners = (['nw', 'ne', 'se', 'sw'] as const).map((id) => add(boxHandlePoint(around.box, id)!, this.center()))
    this.placeHud({ x: Math.max(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) })
    return true
  }

  /** The key's number goes; a press that is not yet a drag shows none of its own, so it goes then too. */
  private dropKeyChip() {
    window.clearTimeout(this.keyChipTimer)
    this.keyChipLayers = null
    if (this.session || this.readoutShown) return
    hud.clear()
    // A pointer resting on a handle reads out that handle's number again.
    const resting = this.resting
    if (resting && !this.press && this.live === 'all') this.showRestingReadout(this.hover, resting.p, resting.touch)
  }

  /**
   * Arrow keys move the selected guides that are not locked, written at
   * once, a burst one undo step as a layer nudge is. A guide that followed a
   * shape no longer does once nudged: the HUD says so.
   */
  private nudgeGuidesBy(d: Vec) {
    const doc = this.host.getDoc()
    const selected = new Set(doc.selectedGuideIds ?? [])
    const moving = this.reachableGuides(doc).filter((guide) => selected.has(guide.id))
    if (!moving.length) return
    // The burst says so as long as it goes on, though only its first key detached them.
    const ids = moving.map((guide) => guide.id).join(' ')
    const last = this.guideBurst
    const going = last?.ids === ids && Date.now() - last.at < HISTORY_MERGE_MS
    const detaches = moving.some((guide) => guide.link) || (going && last.detached)
    this.host.nudgeGuides(d)
    this.guideBurst = { ids, at: Date.now(), detached: detaches }
    const first = (this.host.getDoc().guides ?? []).find((guide) => guide.id === moving[0].id)
    if (!first) return
    const visible = visibleLayerRect(this.scope)
    const middle = { x: (visible.minX + visible.maxX) / 2, y: (visible.minY + visible.maxY) / 2 }
    this.showKeyChip(`${r2(d.x)}, ${r2(d.y)}`, guideAnchor(first.shape, middle), detaches ? 'detached' : null)
    hud.announce(detaches ? 'Guide moved: it no longer follows its shape' : 'Guide moved')
  }

  /** Arrow keys move the selection, and the cuts it carries, at once: every key is written, and a burst is one undo step. */
  private nudgeBy(d: Vec) {
    const doc = this.host.getDoc()
    const ids = this.usableSelection(doc)
    if (!ids.length) return
    // An offset copy nudges its source, as a drag of it does, and the HUD says so.
    const { ids: sources, redirected, held } = this.movedSources(ids)
    const moved = this.moveStarts(doc, sources, true, this.burstGoing(doc, 'nudge')?.carried)
    if (!moved.starts.size) {
      // A copy whose shape is locked or hidden stays, and says why: a label over any other, without a chip, as nothing moved.
      if (!held.length || !this.placeKeyHud()) return
      const said = held[0]
      hud.hold(said.label, KEY_CHIP_MS)
      hud.announce(said.sentence)
      return
    }
    // A selected point stays selected: its shape moves whole, so it is still the same point.
    const point = doc.pointSelection
    const keepPoint = point && ids.length === 1 && point.layerId === ids[0]
    this.saysOwn(() => this.host.commitLayerEdits({ ...moveCommit(moved, ids, d), ...(keepPoint ? { anchor: undefined } : {}), merge: 'nudge' }))
    this.noteBurst('nudge', moved.carried)
    if (redirected) {
      this.showKeyChip(`${r2(d.x)}, ${r2(d.y)}`, undefined, redirected)
      this.announceEdit(doc, redirected === 'moves its circles' ? 'Moved its circles' : 'Moved the source')
      return
    }
    if (!this.noteUnpinned(doc)) return
    // Nothing else is shown for a nudge: the label goes by the selection.
    this.placeKeyHud()
    this.announceEdit(doc, null)
  }
}
