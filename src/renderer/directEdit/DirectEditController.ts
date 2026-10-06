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
  documentSnapTargets,
  freeBoxPoints,
  NO_SNAP,
  snapCircleTangent,
  snapMoving,
  snapValue,
  type EdgeHit,
  type SnapHint,
  type SnapIndex,
  type SnapResult,
  type SnapTarget,
} from '../../engine/snap/snapping.ts'
import { boxGeometryFor, carveOutline, grooveSpine, type SideRef } from '../../engine/carve/outline.ts'
import { bentEdgeCount, isGroove, type CarveSpec } from '../../engine/carve/spec.ts'
import { bakedEditableShape } from '../../engine/illustrator/layerPath.ts'
import { createComposeSession, type ComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { HISTORY_MERGE_MS, type AnchorRef, type HistoryMergeKind, type LayerEdit, type LayerEditCommit } from '../../store/logoStore.ts'
import { getInkItem, hideGuides, hideLayerOutlines, setInkPathData, setSurvivalVisible } from '../IllustratorRenderer.ts'
import type { Guide } from '../../engine/vector/types.ts'
import { constructionShape, guideAnchor, lineReading, lineShape, moveGuideShape, sameGuideShape, type GuideShape } from '../../engine/vector/guides.ts'
import { detachGuide } from '../../engine/vector/follow.ts'
import { pathDataToContours } from '../../engine/vector/pathSerialization.ts'
import { guideHandles, startOnGuides, type GuideHandle } from './guideEdit.ts'
import { GUIDE_LINE, guideDashAt, guidePathItem, styleGuideItem, visibleLayerRect } from '../guideItems.ts'
import { carriedCuts } from './carry.ts'
import { CURSORS, resizeCursor } from './cursors.ts'
import { hud } from './hud.ts'
import { EMPTY_ZONE, GUIDE_PX, findZone, freeCurve, zoneKey, type HitContext, type Zone } from './hitZones.ts'
import {
  boxHandleList,
  scaledHandleLayout,
  selectionBox,
  selectionHandles,
  type HandleSet,
  type LiveHandles,
} from './handleSet.ts'
import { canvasOwnsArrowKeys, registerEditorKeys, setEditorInteracting } from './keyboard.ts'
import {
  drawAnchors,
  drawCarveHandles,
  drawCurves,
  addWithHalo,
  drawGhostPoint,
  drawGuideHandles,
  drawSnapHints,
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
  /** The committed ink (layer space), to restore after a cancelled gesture. */
  getInkPathData(): string
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
  commit(d: Vec): void
  cancel(): void
  editedIds: Set<string>
  drawOverlay(layer: paper.Layer): void
  /** Points of the moved shapes (not the cuts they carry) that snap: corners, middles, centres. */
  keyPoints: Vec[]
  /** The one round punch being moved, if that's all it is: it can snap to touch an edge. */
  roundPunch: { center: Vec; radius: number } | null
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

/** The commit that moves layers by `d`, leaving the moved ones (not the cuts they carry) selected. */
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

/** The members of a box, and the cuts they carry along. */
interface BoxMembers {
  members: Map<string, MovedStart>
  carried: Map<string, MovedStart>
}

/**
 * Every layer a box move changes, and where it goes. Recipes among the
 * members take only the even scale or the turn, so they stay recipes; a
 * carried recipe takes the similarity nearest the map.
 */
function boxMoved({ members, carried }: BoxMembers, move: BoxMove): Array<{ id: string; from: MovedStart; next: Moved; carried: boolean }> {
  const member = (start: MovedStart): Moved => {
    if (!start.carve) return { path: transformShape(start.path!, move.affine) }
    const scaled = move.factor === 1 ? start.carve : scaleCarveAbout(start.carve, move.pivot, move.factor)
    return { carve: move.turn ? rotateCarveAbout(scaled, move.center, move.turn) : scaled }
  }
  return [
    ...[...members].map(([id, from]) => ({ id, from, next: member(from), carried: false })),
    ...[...carried].map(([id, from]) => ({ id, from, next: underAffine(from, move.affine), carried: true })),
  ]
}

function boxEdits(moved: BoxMembers, move: BoxMove): LayerEdit[] {
  return boxMoved(moved, move).map(({ id, from, next }) => movedEdit(id, from, next, move.turn))
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
  if (isGroove(spec)) {
    const next = { ...spec }
    delete next.bend
    return next
  }
  const next = { ...spec }
  delete next.sides
  delete next.corners
  return next
}

const r0 = (v: number) => Math.round(v)
const r2 = (v: number) => Math.round(v * 100) / 100 || 0

/** The number that matters while dragging a handle, shown next to the pointer. */
function handleReadout(spec: CarveSpec, handle: CarveHandle): string {
  if (spec.kind === 'slab') {
    if (handle.kind === 'radius') return `corner ${r0(Math.min(spec.radius, spec.width / 2, spec.height / 2))}`
    if (handle.kind === 'rotate') return `${r0(spec.rotation)}°`
    return `${r0(spec.width)} × ${r0(spec.height)}`
  }
  if (spec.kind === 'punch') {
    if (handle.kind === 'rotate') return `${r0(spec.rotation)}°`
    return `${r0(spec.radius * 2)} across`
  }
  if (handle.kind === 'width') return `${r0(spec.width)} wide`
  const len = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y)
  const angle = (Math.atan2(spec.to.y - spec.from.y, spec.to.x - spec.from.x) * 180) / Math.PI
  return `${r0(len)} long · ${r0(angle)}°`
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
  if (side.type === 'corner' && !isGroove(spec)) {
    const fullness = spec.corners?.[side.id]
    return fullness ? `fullness ${r0(((fullness.k1 + fullness.k2) / 2) * 100)}%` : 'round'
  }
  if (!isSideBent(spec, side)) return 'straight'
  if (isGroove(spec)) return `depth ${r0(maxChordDeviation(grooveSpine(spec)))}`
  if (side.type === 'line') {
    const info = boxGeometryFor(spec).sides[side.id]
    return info ? `depth ${r0(maxChordDeviation(info.cubic))}` : ''
  }
  return ''
}

function bendLabel(spec: CarveSpec, side: SideRef): string {
  if (isGroove(spec)) return spec.kind === 'channel' ? 'Bend channel' : 'Bend slice'
  return side.type === 'corner' ? 'Shape corner' : 'Bend edge'
}

/** The point of a recipe that a handle drags: a box corner or side middle, or a groove end. */
function handleGeometry(spec: CarveSpec, id: HandleId): Vec | null {
  if (isGroove(spec)) return id === 'from' ? spec.from : id === 'to' ? spec.to : null
  const f = handleFraction(id)
  if (!f) return null
  const hw = spec.kind === 'punch' ? spec.radius : spec.width / 2
  const hh = spec.kind === 'punch' ? spec.radius : spec.height / 2
  return add(spec.center, rotate({ x: f.x * hw, y: f.y * hh }, spec.rotation))
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

const DOUBLE_CLICK_MS = 300
const DOUBLE_CLICK_PX = 6
/** How long the size or angle that Alt with the arrow keys reached stays by the box. */
const KEY_CHIP_MS = 1000

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
  private keyBurst: KeyBurst | null = null
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
  private toolIndex: { doc: IllustratorDocument; index: SnapIndex } | null = null
  private toolStart: SnapResult | null = null
  private toolMods: Modifiers = { shift: false, alt: false, noSnap: false }
  /** Which handles take presses: fewer while a tool is active, so its presses reach it. */
  private live: LiveHandles = 'all'
  /** Under the Guide tool, guides take presses first. */
  private guidesFirst = false
  /** What the live frame of a gesture shows in place of some layers: their paths, and their recipes. */
  private preview: { paths: Map<string, string | null>; carves: Map<string, CarveSpec>; frames: Map<string, number> } | null = null
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
    this.destroyed = true
    hud.clear()
    resetOverlay(this.scope)
    this.scope.view.update()
  }

  /* ─── Pointer ─── */

  pointerDown(p: Vec, mods: Modifiers, touch: boolean): void {
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
        setEditorInteracting(true)
        setSurvivalVisible(this.scope, false)
        session.update(p, mods)
        this.placeHud(p, touch)
      }
      return
    }
    this.updateHover(p, touch)
  }

  pointerUp(): void {
    const session = this.session
    if (session) {
      this.session = null
      this.press = null
      session.commit()
      // What a keyboard edit read out before no longer holds.
      hud.silence()
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

  private selectedFreePath(doc: IllustratorDocument, selectedIds: string[]) {
    if (selectedIds.length !== 1) return null
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
    return scaledHandleLayout(this.unitsPerPx())
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
      freePathOf: (layer) => this.freePathOf(layer),
      guides: this.reachableGuides(doc),
      guideHandles: this.selectedGuideHandles(doc),
      guidesFirst: this.guidesFirst,
    }
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
      default:
        return CURSORS.default
    }
  }

  private isSelectedAlone(layerId: string): boolean {
    const doc = this.host.getDoc()
    return doc.selectedLayerIds.length === 1 && doc.selectedLayerIds[0] === layerId
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
   * What a drag can snap to: every visible shape except the edited ones, plus
   * the artboard centre. The edges of the rest of the ink are composed only
   * if something asks for them.
   */
  private makeSnapIndex(doc: IllustratorDocument, exclude: Set<string>, extra: SnapTarget[] = []): SnapIndex {
    const targets = [...documentSnapTargets(doc, exclude, (layer) => this.freePathOf(layer)), ...extra]
    let edges: paper.CompoundPath | null | undefined
    const nearestEdge = (p: Vec): EdgeHit | null => {
      if (edges === undefined) {
        const pathData = exclude.size
          ? createComposeSession(doc, exclude).compose(new Map([...exclude].map((id) => [id, null])))
          : this.host.getInkPathData()
        this.scope.activate()
        edges = pathData ? new this.scope.CompoundPath({ pathData, insert: false }) : null
      }
      if (!edges) return null
      const loc = edges.getNearestLocation(new this.scope.Point(p.x, p.y))
      if (!loc) return null
      const tangent = loc.tangent
      return { point: { x: loc.point.x, y: loc.point.y }, distance: loc.distance, tangent: { x: tangent.x, y: tangent.y } }
    }
    return { targets, nearestEdge }
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
    this.placeHud(p, touch)
  }

  /**
   * Snap a point a tool is placing (layer space). On hover it only shows
   * where a press would land; a press remembers its snap, so the label
   * stays while the rest is dragged out. Rays come from `rays` (the other
   * end of a channel, the pen's previous point); `extra` adds targets the
   * document doesn't have yet (the pen's own points).
   */
  snapToolPoint(p: Vec, role: 'hover' | 'start' | 'end', options: { rays?: Vec[]; extra?: SnapTarget[] } = {}): Vec {
    const result = this.toolSnap(role, (index) =>
      snapMoving(
        options.extra?.length ? { ...index, targets: [...index.targets, ...options.extra] } : index,
        [p],
        { tolerance: this.snapTolerance(), edges: true, rays: options.rays },
      ),
    )
    return add(p, result.d)
  }

  /** Snap the radius of a punch being drawn: the same size as another, or just touching an edge. */
  snapToolRadius(center: Vec, radius: number): number {
    let snapped = radius
    this.toolSnap('end', (index, doc) => {
      const tolerance = this.snapTolerance()
      const same = snapValue(radius, documentSizes(doc, new Set()).punchRadii, tolerance)
      if (same !== null) {
        snapped = same
        return { d: { x: 0, y: 0 }, label: 'same size', hints: [] }
      }
      const touch = snapCircleTangent(index, center, radius, tolerance, 'radius')
      if (touch) {
        snapped = touch.radius
        return { d: { x: 0, y: 0 }, label: 'tangent', hints: [{ kind: 'mark', p: touch.touch }] }
      }
      return NO_SNAP
    })
    return snapped
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
    if (this.toolIndex?.doc !== doc) this.toolIndex = { doc, index: this.makeSnapIndex(doc, new Set()) }
    const result = run(this.toolIndex.index, doc)
    if (role === 'start') this.toolStart = result
    const start = role === 'end' ? this.toolStart : null
    this.snapHints = [...(start?.hints ?? []), ...result.hints]
    hud.set({ label: result.label ?? start?.label ?? null })
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
        else this.host.setSelection([zone.layerId], null)
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
        this.host.setSelection([zone.layerId], null)
        return
      case 'frame':
        // A click inside the box, between its shapes, keeps the selection.
        return
      case 'guide':
        this.host.selectGuides([zone.guideId], press.mods.shift)
        return
      case 'empty':
        if (!press.mods.shift) this.host.setSelection([])
        return
      default:
        return
    }
  }

  private toggleSelected(doc: IllustratorDocument, layerId: string) {
    const has = doc.selectedLayerIds.includes(layerId)
    this.host.setSelection(has ? doc.selectedLayerIds.filter((id) => id !== layerId) : [...doc.selectedLayerIds, layerId])
  }

  private doubleAction(zone: Zone) {
    if (zone.kind === 'anchor') {
      this.dropPendingPoint()
      this.host.editAnchor(zone.layerId, zone.index, 'toggle-smooth', zone.contourIndex)
      return
    }
    if (zone.kind === 'edge') this.straightenEdge(zone)
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
      default:
        return null
    }
  }

  /** Layers a body drag moves: the selection if the pressed shape is in it, else just that shape. */
  private movingIds(doc: IllustratorDocument, pressedId: string): string[] {
    return doc.selectedLayerIds.includes(pressedId) ? this.usableSelection(doc) : [pressedId]
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

  private movePlan(ids: string[], carry: boolean): MovePlan | null {
    const doc = this.host.getDoc()
    if (!ids.length) return null
    const moved = this.moveStarts(doc, ids, carry)
    const { starts, carried } = moved
    if (!starts.size) return null
    const compose = createComposeSession(doc, starts.keys())
    const restore = () => setInkPathData(this.scope, this.host.getInkPathData())
    const pathFor = (id: string, d: Vec): string => {
      const start = starts.get(id)!
      return start.carve ? carveOutline(translateCarve(start.carve, d)).pathData : shapePathData(translateShape(start.path!, d))
    }
    const carriedSet = new Set(carried)
    const keyPoints: Vec[] = []
    for (const id of ids) {
      const start = starts.get(id)
      if (start?.carve) keyPoints.push(...carveKeyPoints(start.carve).map((target) => target.p))
      else if (start?.path) keyPoints.push(...freeBoxPoints(start.path))
    }
    const only = ids.length === 1 && !carried.length ? starts.get(ids[0])?.carve : undefined
    const roundPunch = only && only.kind === 'punch' && only.shape === 'circle' ? { center: only.center, radius: only.radius } : null

    return {
      keyPoints,
      roundPunch,
      editedIds: new Set(starts.keys()),
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
      commit: (d) => {
        if (Math.hypot(d.x, d.y) < 0.5) {
          restore()
          return
        }
        this.host.commitLayerEdits(moveCommit(moved, ids, d))
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
    this.preview = { paths: replacements, carves, frames }
    let ink: string
    try {
      ink = compose.compose(replacements)
    } catch {
      return
    }
    setInkPathData(this.scope, ink)
  }

  /**
   * Where the members of a box start, and the cuts they carry (with
   * `carry`): those given in `picked`, or else found now. Null when none can move.
   */
  private boxMembers(doc: IllustratorDocument, ids: string[], carry: boolean, picked?: readonly string[]): BoxMembers | null {
    const members = new Map<string, MovedStart>()
    for (const id of ids) {
      const layer = this.layer(id)
      if (!layer || layer.locked) continue
      if (layer.carve) {
        members.set(id, { carve: layer.carve, frame: 0 })
        continue
      }
      const path = this.freePathOf(layer)
      if (path) members.set(id, { path, frame: layer.frameRotation ?? 0 })
    }
    if (!members.size) return null
    const carried = carry ? this.carriedStarts(doc, members.keys(), new Set(members.keys()), picked) : new Map<string, MovedStart>()
    return { members, carried }
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
    // Alt moves the shape alone, leaving its holes where they are.
    const plan = this.movePlan(this.movingIds(doc, pressedId), !mods.alt)
    if (!plan) return null
    let index: SnapIndex | null = null
    let d: Vec = { x: 0, y: 0 }
    return {
      editedIds: plan.editedIds,
      update: (p, m) => {
        d = sub(p, press.point)
        // Shift keeps the move straight: horizontal or vertical, whichever is longer.
        const axes = m.shift ? (Math.abs(d.x) >= Math.abs(d.y) ? { x: true, y: false } : { x: false, y: true }) : undefined
        if (axes) d = { x: axes.x ? d.x : 0, y: axes.y ? d.y : 0 }
        let snap: SnapResult = NO_SNAP
        if (this.snapsOn(m)) {
          index ??= this.makeSnapIndex(doc, plan.editedIds)
          const tolerance = this.snapTolerance(press.touch)
          snap = snapMoving(index, plan.keyPoints.map((k) => add(k, d)), { tolerance, axes })
          if (!snap.label && !axes && plan.roundPunch) {
            const moved = add(plan.roundPunch.center, d)
            const touch = snapCircleTangent(index, moved, plan.roundPunch.radius, tolerance, 'move')
            if (touch) snap = { d: sub(touch.center, moved), label: 'tangent', hints: [{ kind: 'mark', p: touch.touch }] }
          }
          d = add(d, snap.d)
        }
        this.showSnap(snap)
        plan.preview(d)
        hud.set({ chip: `${Math.round(d.x)}, ${Math.round(d.y)}` })
      },
      commit: () => plan.commit(d),
      cancel: () => plan.cancel(),
      drawOverlay: (layer) => plan.drawOverlay(layer),
    }
  }

  /**
   * Drag one of a single recipe's own handles. The recipe alone changes:
   * cuts that belong to it stay where they are, unlike under a box.
   */
  private handleSession(press: Press, layerId: string, handle: CarveHandle): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!layer?.carve) return null
    const start = layer.carve
    const compose = createComposeSession(doc, [layerId])
    const center = this.center()
    const startLocal = sub(press.point, center)
    const exclude = new Set([layerId])
    let index: SnapIndex | null = null
    let current = start
    return {
      editedIds: exclude,
      update: (p, mods) => {
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
        this.showInk(compose, new Map([[layerId, carveOutline(current).pathData]]), new Map([[layerId, current]]))
        hud.set({ chip: handleReadout(current, handle) })
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        this.host.commitLayerEdits({ label: handleLabel(handle), edits: [{ layerId, carve: current }], select: [layerId] })
      },
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
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
    const editedIds = new Set([...members.keys(), ...moved.carried.keys()])
    const compose = createComposeSession(doc, editedIds)
    const center = this.center()
    let move: BoxMove = turnMove(box.center, 0)
    let current = box
    let hot: HandleId | null = null
    const everyEdit = () => boxMoved(moved, move)
    const restore = () => setInkPathData(this.scope, this.host.getInkPathData())

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
        this.host.commitLayerEdits({ label, edits: boxEdits(moved, move) })
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
          return
        }
        let resized = resizeBox(box, handle.id, startLocal, pointer, mods, evenly)
        if (this.snapsOn(mods)) {
          index ??= this.makeSnapIndex(doc, plan.editedIds)
          const snapped = this.snapBoxResize(index, box, resized, handle.id, startLocal, pointer, mods, evenly, press.touch)
          resized = snapped.resized
          snap = snapped.snap
        }
        if (this.snapsOn(mods) && !snap.label) {
          const even = scalesEvenly(handle.id, mods, evenly) || (!isCornerHandle(handle.id) && mods.shift)
          resized = wholeBoxResize(box, resized, even)
        }
        hud.set({ chip: `${r0(resized.box.width)} × ${r0(resized.box.height)}` })
        this.showSnap(snap)
        plan.preview(resizeMove(resized), resized.box, handle.id)
      },
      // A turned box around several layers comes back upright on release:
      // it is measured afresh around them, and they keep no shared frame.
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
    const sizes = () => documentSizes(doc, exclude)

    if (handle.kind === 'resize' || handle.kind === 'endpoint') {
      const point = handleGeometry(raw, handle.id)
      const axes = isGroove(raw) ? { x: true, y: true } : handleAxes(raw.rotation, handle.id)
      if (!point || !axes) return none
      const other = isGroove(raw) ? (handle.id === 'from' ? raw.to : raw.from) : null
      const snap = snapMoving(index, [point], {
        tolerance,
        axes,
        edges: handle.kind === 'endpoint',
        rays: other && !mods.shift ? [other] : undefined,
      })
      if (!snap.label) return none
      return { spec: dragCarveHandle(start, handle.id, startPointer, add(pointer, snap.d), mods), snap }
    }

    if (handle.kind === 'scale' && raw.kind === 'punch') {
      const same = snapValue(raw.radius, sizes().punchRadii, tolerance)
      if (same !== null) return { spec: { ...raw, radius: same }, snap: { ...NO_SNAP, label: 'same size' } }
      if (raw.shape === 'circle') {
        const touchEdge = snapCircleTangent(index, raw.center, raw.radius, tolerance, 'radius')
        if (touchEdge) {
          return {
            spec: { ...raw, radius: touchEdge.radius },
            snap: { d: { x: 0, y: 0 }, label: 'tangent', hints: [{ kind: 'mark', p: touchEdge.touch }] },
          }
        }
      }
      return none
    }

    if (handle.kind === 'radius' && raw.kind === 'slab') {
      const same = snapValue(raw.radius, sizes().radii, tolerance)
      return same === null ? none : { spec: { ...raw, radius: same }, snap: { ...NO_SNAP, label: 'same size' } }
    }

    if (handle.kind === 'width' && isGroove(raw)) {
      const same = snapValue(raw.width, sizes().widths, tolerance)
      return same === null ? none : { spec: { ...raw, width: same }, snap: { ...NO_SNAP, label: 'same size' } }
    }

    if (handle.kind === 'rotate' && !isGroove(raw) && !isGroove(start) && !mods.shift) {
      const rotation = settleAngle(raw.rotation, distance(pointer, start.center), tolerance)
      if (rotation === null) return none
      // The chip already reads the angle: no label repeats it.
      return { spec: { ...raw, rotation }, snap: NO_SNAP }
    }
    return none
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
    if (this.live === 'none' && !this.guidesFirst) return null
    const zone = findZone({ ...this.context(touch), edges: false }, p)
    if (zone.kind === 'handle' && !zone.ring) return zone
    if (this.guidesFirst && (zone.kind === 'guide' || zone.kind === 'guide-handle')) return zone
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
  toolPressTarget(p: Vec, touch: boolean): { kind: 'editor' } | { kind: 'guide'; guideId: string; start: Vec } | null {
    const zone = this.toolZone(p, touch)
    if (!zone) return null
    if (zone.kind !== 'guide' || this.isGuideSelected(zone.guideId)) return { kind: 'editor' }
    const reach = GUIDE_PX * this.unitsPerPx() * (touch ? 2 : 1)
    const start = startOnGuides(this.reachableGuides(this.host.getDoc()), sub(p, this.center()), reach) ?? zone.point
    return { kind: 'guide', guideId: zone.guideId, start }
  }

  /** Hover while a tool is active: only handles (and guides, under the Guide tool) react. Returns the cursor to show, if any. */
  toolHover(p: Vec, touch: boolean): string | null {
    this.resting = null
    const zone = this.toolZone(p, touch)
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
    const compose = createComposeSession(doc, exclude)
    let index: SnapIndex | null = null
    let current = start
    return {
      editedIds: exclude,
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
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
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
    const compose = createComposeSession(doc, exclude)
    const center = this.center()
    const wasStraight = isCurveStraight(start, curveIndex)
    let index: SnapIndex | null = null
    let current = start
    let straight = wasStraight
    return {
      editedIds: exclude,
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
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
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
    const compose = createComposeSession(doc, exclude)
    let index: SnapIndex | null = null
    let current = start
    const center = this.center()
    return {
      editedIds: exclude,
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
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
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
          index ??= this.makeSnapIndex(doc, new Set())
          snap = snapMoving(index, keyPoints.map((k) => add(k, d)), {
            tolerance: this.snapTolerance(press.touch),
            axes,
            edges: keyPoints.length === 1,
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
      drawOverlay: (overlay) => this.drawGuideOutlines(overlay, moved()),
    }
  }

  /**
   * Drag a handle of the selected guide: a line's knob turns it about its
   * pivot (Shift in 15° steps; with snapping on, settling on them and landing
   * on whole degrees), a circle's squares set its radius (the same size as a
   * punch, touching an edge, or else a whole unit). One commit per drag.
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
            index ??= this.makeSnapIndex(doc, new Set())
            const same = snapValue(r, documentSizes(doc, new Set()).punchRadii, tolerance)
            const touch = same === null ? snapCircleTangent(index, handle.pivot, r, tolerance, 'radius') : null
            if (same !== null) {
              r = same
              label = 'same size'
            } else if (touch) {
              r = touch.radius
              label = 'tangent'
            } else r = Math.max(1, Math.round(r))
            this.snapHints = touch && same === null ? [{ kind: 'mark', p: touch.touch }] : []
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
   * While a gesture reshapes some layers, the construction guides that
   * follow them are drawn where the follow pass will put them, from the live
   * frame; the drawn ones hide meanwhile. Returns the guides drawn so.
   */
  private drawFollowingGuides(overlay: paper.Layer): Set<string> {
    const drawn = new Set<string>()
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
      drawn.add(guide.id)
    }
    return drawn
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

  /* ─── Overlay ─── */

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

    if (this.hover.kind === 'body' && !selected.includes(this.hover.layerId) && !edited.has(this.hover.layerId)) {
      const item = this.items.get(this.hover.layerId)
      if (item) outlineItem(this.scope, layer, item, { dashed: true, width: 1.25 })
    }
    for (const id of selected) {
      if (edited.has(id)) continue
      const item = this.items.get(id)
      if (item) outlineItem(this.scope, layer, item)
    }

    // Guides: the one under the pointer, the selected ones, and those following a reshaped layer.
    const movingGuides = editing?.guideIds ?? new Set<string>()
    const shownGuides = this.host.guidesShown() ? (doc.guides ?? []).filter((guide) => guide.visible) : []
    const hoverGuide = this.hover.kind === 'guide' ? this.hover.guideId : null
    const selectedGuides = new Set(doc.selectedGuideIds ?? [])
    const hovered = shownGuides.filter((guide) => guide.id === hoverGuide && !selectedGuides.has(guide.id) && !movingGuides.has(guide.id))
    this.drawGuideOutlines(layer, hovered, { width: 1, opacity: 0.6 })
    const chosen = shownGuides.filter((guide) => selectedGuides.has(guide.id) && !movingGuides.has(guide.id))
    this.drawGuideOutlines(layer, chosen)
    const following = editing ? this.drawFollowingGuides(layer) : new Set<string>()
    hideGuides(this.scope, new Set([...movingGuides, ...following]))
    // A guide's handles show only where a press can reach them: under Select, or under the Guide tool.
    if (!editing && (this.live === 'all' || this.guidesFirst)) {
      const handles = this.selectedGuideHandles(doc)
      const hot = this.hover.kind === 'guide-handle' ? this.hover.handle.id : null
      if (handles.length) drawGuideHandles(this.scope, layer, handles, this.center(), hot)
    }

    if (editing) {
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
        this.host.setSelection(doc.selectedLayerIds, null)
        return true
      }
      if (doc.selectedLayerIds.length) {
        this.host.setSelection([])
        return true
      }
      if (doc.selectedGuideIds?.length) {
        this.host.selectGuides(null)
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
    const lone = around.ids.length === 1 && Boolean(this.layer(around.ids[0])?.carve)
    const going = this.burstGoing(doc, kind)
    const moved = this.boxMembers(doc, around.ids, !lone, going?.carried)
    return moved && { box: around.box, moved, going }
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
    const target = this.keyBox(this.host.getDoc(), 'key-turn')
    if (!target) return
    const { moved, going } = target
    const center = going?.turn ? going.turn.center : target.box.center
    const was = going?.turn ? going.turn.rotation : target.box.rotation
    const rotation = normalizeDegrees(Math.round(was + step))
    const move = turnMove(center, normalizeDegrees(rotation - was))
    this.host.commitLayerEdits({ label: boxLabel(true, moved.members.size > 1), edits: boxEdits(moved, move), merge: 'key-turn' })
    this.noteBurst('key-turn', [...moved.carried.keys()], { center, rotation })
    this.showKeyChip(`${r0(rotation)}°`)
    // Each key reads out where the selection now is, never how far the burst has gone.
    hud.announce(`Turned to ${r0(rotation)}°`)
  }

  /**
   * Alt with Up or Down: scale the selection evenly about its box's centre,
   * so the box's longer side grows or shrinks by `step` units and a whole
   * size stays whole. Written at once; a burst is one undo step.
   */
  private growBy(step: number) {
    const target = this.keyBox(this.host.getDoc(), 'key-scale')
    if (!target) return
    const { box, moved } = target
    const longer = Math.max(box.width, box.height)
    if (longer <= 1e-6) return
    // Paths are stored to a thousandth, so a whole side turned in its frame may read a hair off.
    const whole = Math.abs(longer - Math.round(longer)) < 0.01 ? Math.round(longer) : longer
    const factor = Math.max((whole + step) / longer, evenScaleFloor(box))
    const move = scaleMove(box.center, factor)
    this.host.commitLayerEdits({ label: boxLabel(false, moved.members.size > 1), edits: boxEdits(moved, move), merge: 'key-scale' })
    this.noteBurst('key-scale', [...moved.carried.keys()])
    const size = `${r0(box.width * factor)} × ${r0(box.height * factor)}`
    this.showKeyChip(size)
    hud.announce(`Size ${size}`)
  }

  /**
   * The number a key reached, by the top right corner of the selection's box
   * as it is now drawn, or by `at` (layer space), for a moment.
   */
  private showKeyChip(chip: string, at?: Vec, label: string | null = null) {
    if (at) this.placeHud(add(at, this.center()))
    else {
      const around = selectionBox(this.host.getDoc(), (layer) => this.freePathOf(layer))
      if (!around) return
      const corners = (['nw', 'ne', 'se', 'sw'] as const).map((id) => add(boxHandlePoint(around.box, id)!, this.center()))
      this.placeHud({ x: Math.max(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) })
    }
    this.readoutShown = false
    hud.set({ label, chip })
    this.keyChipLayers = this.host.getDoc().layers
    window.clearTimeout(this.keyChipTimer)
    // Only the chip waits: the edit is already written.
    this.keyChipTimer = window.setTimeout(() => this.dropKeyChip(), KEY_CHIP_MS)
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
    const moved = this.moveStarts(doc, ids, true, this.burstGoing(doc, 'nudge')?.carried)
    if (!moved.starts.size) return
    // A selected point stays selected: its shape moves whole, so it is still the same point.
    const point = doc.pointSelection
    const keepPoint = point && ids.length === 1 && point.layerId === ids[0]
    this.host.commitLayerEdits({ ...moveCommit(moved, ids, d), ...(keepPoint ? { anchor: undefined } : {}), merge: 'nudge' })
    this.noteBurst('nudge', moved.carried)
  }
}
