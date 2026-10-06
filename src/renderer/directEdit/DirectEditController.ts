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
  straightenCurve,
  translatePath,
  type EditablePath,
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
  type CarveGrab,
  type CarveHandle,
  type HandleId,
  type HandleLayout,
} from '../../engine/carve/edit.ts'
import {
  boxHandlePoint,
  evenFactorTo,
  handleFraction,
  IDENTITY_AFFINE,
  isCornerHandle,
  resizeBox,
  rotateBox,
  rotationAbout,
  affineOf,
  applyAffine,
  evenScaleFloor,
  scaleBoxBy,
  scalesEvenly,
  scalingAbout,
  settleAngle,
  transformPath,
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
  type SnapGuide,
  type SnapIndex,
  type SnapResult,
  type SnapTarget,
} from '../../engine/snap/snapping.ts'
import { boxGeometryFor, carveOutline, grooveSpine, type SideRef } from '../../engine/carve/outline.ts'
import { bentEdgeCount, isGroove, type CarveSpec } from '../../engine/carve/spec.ts'
import { bakedEditablePath } from '../../engine/illustrator/layerPath.ts'
import { createComposeSession, type ComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import type { LayerEdit, LayerEditCommit } from '../../store/logoStore.ts'
import { getInkItem, hideLayerOutlines, setInkPathData, setSurvivalVisible } from '../IllustratorRenderer.ts'
import { carriedCuts } from './carry.ts'
import { CURSORS, resizeCursor } from './cursors.ts'
import { hud } from './hud.ts'
import { EMPTY_ZONE, findZone, freeCurve, zoneKey, type HitContext, type Zone } from './hitZones.ts'
import {
  boxHandleList,
  scaledHandleLayout,
  selectionBox,
  selectionHandles,
  type HandleSet,
  type LiveHandles,
} from './handleSet.ts'
import { canvasOwnsArrowKeys, registerEditorKeys, registerPendingEdits, setEditorInteracting } from './keyboard.ts'
import {
  drawAnchors,
  drawCarveHandles,
  drawCurves,
  drawGhostPoint,
  drawSnapGuides,
  outlineItem,
  outlinePathData,
  resetOverlay,
  setOverlayScale,
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
  setSelection(ids: string[], anchor?: { layerId: string; segmentIndex: number } | null): void
  commitLayerEdits(commit: LayerEditCommit): void
  editAnchor(layerId: string, index: number, op: AnchorOp): void
}

interface Session {
  update(p: Vec, mods: Modifiers): void
  commit(): void
  cancel(): void
  /** Layers the session draws itself (the controller skips their normal outline). */
  editedIds: Set<string>
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
 * scale evenly by `factor` about `pivot`, then turn by `turn` about the box
 * centre, which is what `affine` does too.
 */
interface BoxMove {
  affine: Affine
  pivot: Vec
  factor: number
  turn: number
}

/** A turn of a box about its centre. */
function turnMove(box: OrientedBox, turn: number): BoxMove {
  return { affine: Math.abs(turn) > 1e-9 ? rotationAbout(box.center, turn) : IDENTITY_AFFINE, pivot: box.center, factor: 1, turn }
}

/** Alt+arrows: an even scale about the box centre, then a turn about it. */
function keyMove(box: OrientedBox, turn: number, factor: number): BoxMove {
  const scaling = scalingAbout(box.center, factor)
  const turning = rotationAbout(box.center, turn)
  const same = Math.abs(turn) <= 1e-9 && Math.abs(factor - 1) <= 1e-9
  return {
    affine: same ? IDENTITY_AFFINE : affineOf((p) => applyAffine(turning, applyAffine(scaling, p))),
    pivot: box.center,
    factor,
    turn,
  }
}

/** A resize: an even one scales recipes too, by the factor of its width. */
function resizeMove(resized: BoxResize): BoxMove {
  const same = Math.abs(resized.sx - 1) <= 1e-9 && Math.abs(resized.sy - 1) <= 1e-9
  return { affine: same ? IDENTITY_AFFINE : resized.affine, pivot: resized.pivot, factor: resized.sx, turn: 0 }
}

/** Where a layer that an edit carries starts: its recipe, or its free path and how far its frame is turned. */
interface MovedStart {
  carve?: CarveSpec
  path?: EditablePath
  frame: number
}

type Moved = { carve?: CarveSpec; path?: EditablePath }

/** A layer under an affine map: a free path takes all of it, a recipe as much as keeps it a recipe. */
function underAffine(start: MovedStart, m: Affine): Moved {
  return start.carve ? { carve: carveUnderAffine(start.carve, m) } : { path: transformPath(start.path!, m) }
}

function movedPathData(next: Moved): string {
  return next.carve ? carveOutline(next.carve).pathData : editablePathToPathData(next.path!)
}

/** The edit that stores a carried layer. A free path turned by `turn` turns its frame with it. */
function movedEdit(layerId: string, start: MovedStart, next: Moved, turn: number): LayerEdit {
  if (next.carve) return { layerId, carve: next.carve }
  const pathData = editablePathToPathData(next.path!)
  return Math.abs(turn) > 1e-9 ? { layerId, pathData, frameRotation: normalizeDegrees(start.frame + turn) } : { layerId, pathData }
}

/** Hit areas that follow a preview: carry them by a layer-space map, or put them back. */
interface FollowingItems {
  map(m: Affine): void
  restore(): void
}

/** The members of a box, moved together by one map: by a drag, or by a burst of keys. */
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

/** A free shape's own anchors as snap targets, except the one being dragged. */
function otherAnchors(path: EditablePath, except: number): SnapTarget[] {
  return path.segs.filter((_, i) => i !== except).map((seg) => ({ p: seg.p, kind: 'point' as const }))
}

/** A burst of Alt+arrows: the turn and scale so far, about the box at its start, and the layers it started from. */
interface KeyTransform {
  plan: BoxPlan
  box: OrientedBox
  turn: number
  percent: number
  timer: number
  layers: IllustratorLayer[]
}

const DOUBLE_CLICK_MS = 300
const DOUBLE_CLICK_PX = 6
const NUDGE_COMMIT_MS = 450

/**
 * Direct editing for Vector Maker: one mode, where what you press decides what
 * happens. Bodies move, points move, handles reshape, and (in later phases)
 * edges bend. Nothing is written to the store until the pointer is released,
 * so every gesture is exactly one undo step.
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
  private readonly freePaths = new WeakMap<IllustratorLayer, EditablePath | null>()
  /** A burst of arrow keys: the move so far, and the layers it started from. */
  private nudge: { plan: MovePlan; d: Vec; timer: number; layers: IllustratorLayer[] } | null = null
  /** A burst of Alt+arrows: the turn and scale so far, about the box at its start. */
  private keyTransform: KeyTransform | null = null
  private pendingPoint: PendingPoint | null = null
  /** A handle's number is showing by the resting pointer. */
  private readoutShown = false
  /** Pink guides of the snap in effect, drawn on top of everything. */
  private snapGuides: SnapGuide[] = []
  /** While a tool places something: its snap index (for one document), where it started, the modifiers held. */
  private toolIndex: { doc: IllustratorDocument; index: SnapIndex } | null = null
  private toolStart: SnapResult | null = null
  private toolMods: Modifiers = { shift: false, alt: false, noSnap: false }
  /** Which handles take presses: fewer while a tool is active, so its presses reach it. */
  private live: LiveHandles = 'all'
  private readonly unregisterKeys: () => void
  private readonly unregisterPending: () => void
  private destroyed = false

  constructor(scope: paper.PaperScope, canvas: HTMLCanvasElement, host: DirectEditHost) {
    this.scope = scope
    this.canvas = canvas
    this.host = host
    this.unregisterKeys = registerEditorKeys((event) => this.onKey(event))
    this.unregisterPending = registerPendingEdits(() => {
      this.flushNudge(true)
      this.flushKeyTransform(true)
      this.flushPendingPoint()
      // An undo or redo follows: whatever was read out last no longer holds.
      hud.silence()
      // Undo may follow at once and bring back the very layers drawn before,
      // which renders nothing anew: draw the selection again once it has run.
      queueMicrotask(() => this.drawOverlay())
    })
  }

  /** Called after every render with the fresh hit areas. */
  sync(itemMap: Map<string, paper.Item>): void {
    this.items = new Map([...itemMap].map(([id, item]) => [id, item as paper.PathItem]))
    if (this.session) {
      const gone = [...this.session.editedIds].some((id) => !this.items.has(id))
      if (gone) this.cancel()
    }
    this.resumeBursts()
    this.drawOverlay()
  }

  /**
   * A render in the middle of a burst of keys draws the document, which
   * leaves the burst out: show its preview again. If the document changed
   * under the burst (an edit from elsewhere), commit the burst now instead.
   */
  private resumeBursts() {
    const layers = this.host.getDoc().layers
    const nudge = this.nudge
    if (nudge) {
      if (nudge.layers === layers) nudge.plan.preview(nudge.d)
      else this.flushNudge(true)
    }
    const t = this.keyTransform
    if (t) {
      if (t.layers === layers) this.previewKeyTransform(t)
      else this.flushKeyTransform(true)
    }
  }

  get isInteracting(): boolean {
    return this.session !== null
  }

  /** Redraw the overlay: after a selection change, or when the canvas changed size and handles keep their on-screen size. */
  refresh(): void {
    this.drawOverlay()
  }

  /** Show (and let presses reach) the selection's handles and points: all, only a recipe's own, or none. */
  setHandlesLive(live: LiveHandles): void {
    if (this.live === live) return
    this.live = live
    this.hover = EMPTY_ZONE
    this.drawOverlay()
  }

  destroy(): void {
    this.flushNudge()
    this.flushKeyTransform()
    this.dropPendingPoint()
    this.cancel()
    this.unregisterKeys()
    this.unregisterPending()
    this.destroyed = true
    hud.clear()
    resetOverlay(this.scope)
    this.scope.view.update()
  }

  /* ─── Pointer ─── */

  pointerDown(p: Vec, mods: Modifiers, touch: boolean): void {
    // A burst of keys lands first. Its ink and hit areas already show it, so
    // the press meets every shape where it is drawn.
    this.flushNudge()
    this.flushKeyTransform()
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
    this.snapGuides = []
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
    const path = this.freePathOf(layer)
    return path ? { layerId: layer.id, path } : null
  }

  /** A free layer's path with its transform baked in. Layers are immutable, so this caches by identity. */
  private freePathOf(layer: IllustratorLayer): EditablePath | null {
    if (layer.carve) return null
    if (!this.freePaths.has(layer)) this.freePaths.set(layer, bakedEditablePath(layer))
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
    const anchorIndex =
      freePath && doc.pointSelection && doc.pointSelection.layerId === freePath.layerId
        ? doc.pointSelection.segmentIndex
        : null
    this.scope.activate()
    return {
      doc,
      items: this.items,
      ink: getInkItem(this.scope),
      center: this.center(),
      selectedIds,
      freePath,
      anchorIndex,
      handles,
      unitsPerPx: this.unitsPerPx(),
      touch,
      edges: true,
      freePathOf: (layer) => this.freePathOf(layer),
    }
  }

  private updateHover(p: Vec, touch: boolean) {
    const zone = findZone(this.context(touch), p)
    if (zoneKey(zone) !== zoneKey(this.hover)) {
      this.hover = zone
      this.drawOverlay()
    }
    this.setCursor(this.cursorFor(zone))
    this.showRestingReadout(zone, p, touch)
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

  /** Show a snap: its guides on the canvas, its label by the pointer. */
  private showSnap(result: SnapResult | null, fallbackLabel: string | null = null) {
    this.snapGuides = result?.guides ?? []
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
        return { d: { x: 0, y: 0 }, label: 'same size', guides: [] }
      }
      const touch = snapCircleTangent(index, center, radius, tolerance, 'radius')
      if (touch) {
        snapped = touch.radius
        return { d: { x: 0, y: 0 }, label: 'tangent', guides: [{ kind: 'mark', p: touch.touch }] }
      }
      return NO_SNAP
    })
    return snapped
  }

  /** The tool's gesture ended, or the pointer left: drop its guides and label. */
  endToolSnap(): void {
    this.toolStart = null
    if (!this.snapGuides.length && !hud.get().label) return
    this.snapGuides = []
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
    this.snapGuides = [...(start?.guides ?? []), ...result.guides]
    hud.set({ label: result.label ?? start?.label ?? null })
    this.drawOverlay()
    return result
  }

  /** The pointer left the canvas: nothing is hovered any more. */
  pointerLeave(): void {
    if (this.press || this.session) return
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
        this.host.setSelection([zone.layerId], { layerId: zone.layerId, segmentIndex: zone.index })
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
      this.host.editAnchor(zone.layerId, zone.index, 'toggle-smooth')
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
    const path = this.freePathOf(layer)
    if (!path) return
    if (isCurveStraight(path, zone.free.curveIndex)) {
      // Nothing to straighten: the double-click was two clicks on the edge.
      if (this.pendingPoint) this.flushPendingPoint()
      return
    }
    this.dropPendingPoint()
    const doc = this.host.getDoc()
    this.host.commitLayerEdits({
      label: 'Straighten edge',
      edits: [{ layerId: layer.id, pathData: editablePathToPathData(straightenCurve(path, zone.free.curveIndex)) }],
      select: [layer.id],
      anchor: doc.pointSelection?.layerId === layer.id ? undefined : null,
    })
  }

  /* ─── Adding points ─── */

  private schedulePendingPoint(zone: EdgeZone) {
    if (!zone.free) return
    this.dropPendingPoint()
    this.pendingPoint = {
      layerId: zone.layerId,
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
    const layer = this.layer(pending.layerId)
    const path = layer ? this.freePathOf(layer) : null
    if (!layer || !path || pending.curveIndex >= path.segs.length) {
      this.drawOverlay()
      return
    }
    const { path: next, index } = insertPoint(path, pending.curveIndex, pending.t)
    this.host.commitLayerEdits({
      label: 'Add point',
      edits: [{ layerId: layer.id, pathData: editablePathToPathData(next) }],
      select: [layer.id],
      anchor: { layerId: layer.id, segmentIndex: index },
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
        return this.pointSession(press, zone.layerId, zone.index, 'anchor')
      case 'bezier':
        return this.pointSession(press, zone.layerId, zone.index, zone.which)
      default:
        return null
    }
  }

  /** Layers a body drag moves: the selection if the pressed shape is in it, else just that shape. */
  private movingIds(doc: IllustratorDocument, pressedId: string): string[] {
    const usable = (id: string) => {
      const layer = doc.layers.find((candidate) => candidate.id === id)
      return Boolean(layer && layer.visible && !layer.locked)
    }
    return doc.selectedLayerIds.includes(pressedId) ? doc.selectedLayerIds.filter(usable) : [pressedId]
  }

  private movePlan(ids: string[], carry: boolean): MovePlan | null {
    const doc = this.host.getDoc()
    if (!ids.length) return null
    const addIds = ids.filter((id) => doc.layers.find((layer) => layer.id === id)?.operation === 'add')
    const carried = carry ? carriedCuts(doc, addIds, this.items) : []
    const moving = [...ids, ...carried]
    const starts = new Map<string, { carve?: CarveSpec; path?: EditablePath }>()
    for (const id of moving) {
      const layer = doc.layers.find((candidate) => candidate.id === id)
      if (!layer) continue
      if (layer.carve) starts.set(id, { carve: layer.carve })
      else {
        const path = bakedEditablePath(layer)
        if (path) starts.set(id, { path })
      }
    }
    if (!starts.size) return null
    const compose = createComposeSession(doc, starts.keys())
    const items = this.followingItems(starts.keys())
    const restore = () => {
      items.restore()
      setInkPathData(this.scope, this.host.getInkPathData())
    }
    const pathFor = (id: string, d: Vec): string => {
      const start = starts.get(id)!
      return start.carve ? carveOutline(translateCarve(start.carve, d)).pathData : editablePathToPathData(translatePath(start.path!, d))
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
        for (const id of starts.keys()) replacements.set(id, pathFor(id, d))
        this.showInk(compose, replacements)
        items.map({ ...IDENTITY_AFFINE, e: d.x, f: d.y })
        this.drawOverlay()
      },
      commit: (d) => {
        if (Math.hypot(d.x, d.y) < 0.5) {
          restore()
          return
        }
        this.host.commitLayerEdits({
          label: starts.size > 1 ? 'Move shapes' : 'Move',
          edits: [...starts.entries()].map(([layerId, start]) =>
            start.carve
              ? { layerId, carve: translateCarve(start.carve, d) }
              : { layerId, pathData: editablePathToPathData(translatePath(start.path!, d)) },
          ),
          select: ids,
          anchor: null,
        })
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

  /** Show one live frame of the ink. A boolean hiccup mid-drag keeps the last good frame on screen. */
  private showInk(compose: ComposeSession, replacements: Map<string, string | null>) {
    let ink: string
    try {
      ink = compose.compose(replacements)
    } catch {
      return
    }
    setInkPathData(this.scope, ink)
  }

  /**
   * Hit areas that follow a preview, so a press or a hover in the middle of
   * a burst of keys meets each shape where it is drawn. Areas are known by
   * identity: a render mid-burst brings fresh ones, still where the
   * document has them, and those are carried from there.
   */
  private followingItems(ids: Iterable<string>): FollowingItems {
    const list = [...ids]
    const applied = new Map<string, { item: paper.PathItem; m: paper.Matrix }>()
    const carry = (id: string, next: paper.Matrix) => {
      const item = this.items.get(id)
      if (!item) return
      const was = applied.get(id)
      const undo = was?.item === item ? was.m.inverted() : null
      item.transform(undo ? next.appended(undo) : next)
      applied.set(id, { item, m: next })
    }
    return {
      map: (m) => {
        // The same map in project space, where the hit areas are.
        const c = this.center()
        const next = new this.scope.Matrix(m.a, m.b, m.c, m.d, m.e + c.x - (m.a * c.x + m.c * c.y), m.f + c.y - (m.b * c.x + m.d * c.y))
        for (const id of list) carry(id, next)
      },
      restore: () => {
        for (const [id, was] of applied) {
          if (this.items.get(id) === was.item) carry(id, new this.scope.Matrix())
        }
        applied.clear()
      },
    }
  }

  /** Where the cuts that some shapes carry start, leaving out layers the edit moves anyway. */
  private carriedStarts(doc: IllustratorDocument, shapeIds: Iterable<string>, moving: Set<string>): Map<string, MovedStart> {
    const addIds = [...shapeIds].filter((id) => this.layer(id)?.operation === 'add')
    const starts = new Map<string, MovedStart>()
    if (!addIds.length) return starts
    for (const id of carriedCuts(doc, addIds, this.items)) {
      const layer = this.layer(id)
      if (!layer || moving.has(id)) continue
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
            if (touch) snap = { d: sub(touch.center, moved), label: 'tangent', guides: [{ kind: 'mark', p: touch.touch }] }
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
        }
        this.showSnap(snap)
        this.showInk(compose, new Map([[layerId, carveOutline(current).pathData]]))
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
    const carried = this.carriedStarts(doc, members.keys(), new Set(members.keys()))
    const editedIds = new Set([...members.keys(), ...carried.keys()])
    const compose = createComposeSession(doc, editedIds)
    const items = this.followingItems(editedIds)
    const center = this.center()
    let move: BoxMove = { affine: IDENTITY_AFFINE, pivot: box.center, factor: 1, turn: 0 }
    let current = box
    let hot: HandleId | null = null

    const edited = (start: MovedStart): Moved => {
      if (start.carve) {
        const scaled = move.factor === 1 ? start.carve : scaleCarveAbout(start.carve, move.pivot, move.factor)
        return { carve: move.turn ? rotateCarveAbout(scaled, box.center, move.turn) : scaled }
      }
      return { path: transformPath(start.path!, move.affine) }
    }
    const everyEdit = (): Array<{ id: string; from: MovedStart; next: Moved; carried: boolean }> => [
      ...[...members].map(([id, from]) => ({ id, from, next: edited(from), carried: false })),
      ...[...carried].map(([id, from]) => ({ id, from, next: underAffine(from, move.affine), carried: true })),
    ]
    const restore = () => {
      items.restore()
      setInkPathData(this.scope, this.host.getInkPathData())
    }

    return {
      editedIds,
      ids: [...members.keys()],
      preview: (next, nextBox, hotId) => {
        move = next
        current = nextBox
        hot = hotId
        const replacements = new Map<string, string | null>()
        for (const { id, next: moved } of everyEdit()) replacements.set(id, movedPathData(moved))
        this.showInk(compose, replacements)
        items.map(move.affine)
        this.drawOverlay()
      },
      commit: (label) => {
        const changed = Math.abs(move.turn) > 1e-9 || move.affine !== IDENTITY_AFFINE
        if (!changed) {
          restore()
          return
        }
        this.host.commitLayerEdits({ label, edits: everyEdit().map(({ id, from, next }) => movedEdit(id, from, next, move.turn)) })
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
          plan.preview(turnMove(box, turn), { ...box, rotation }, handle.id)
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
      commit: () => {
        const several = plan.ids.length > 1
        // A turned box around several layers comes back upright on release:
        // it is measured afresh around them, and they keep no shared frame.
        plan.commit(rotating ? (several ? 'Rotate shapes' : 'Rotate') : several ? 'Resize shapes' : 'Resize')
      },
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
            snap: { d: { x: 0, y: 0 }, label: 'tangent', guides: [{ kind: 'mark', p: touchEdge.touch }] },
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
   * The handle a tool's press or hover would reach, if any. Box handles stay
   * out of a tool's way, and so does the turning ring outside a recipe's
   * corners: nothing is drawn there, so a press there starts the tool.
   */
  private toolHandle(p: Vec, touch: boolean): Extract<Zone, { kind: 'handle' }> | null {
    if (this.live === 'none') return null
    const zone = findZone({ ...this.context(touch), edges: false }, p)
    return zone.kind === 'handle' && !zone.ring ? zone : null
  }

  /** While a tool is active: is the pointer over a handle of the selected cut? */
  handleAt(p: Vec, touch: boolean): boolean {
    return this.toolHandle(p, touch) !== null
  }

  /** Hover while a tool is active: only handles react. Returns the cursor to show, if any. */
  toolHover(p: Vec, touch: boolean): string | null {
    if (this.live === 'none') return null
    const zone = this.toolHandle(p, touch)
    const hot = zone ?? EMPTY_ZONE
    if (zoneKey(hot) !== zoneKey(this.hover)) {
      this.hover = hot
      this.drawOverlay()
    }
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
        this.showInk(compose, new Map([[layerId, carveOutline(current).pathData]]))
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
    const start = this.freePathOf(layer)
    if (!start || zone.free.curveIndex >= start.segs.length) return null
    const { curveIndex } = zone.free
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
          index ??= this.makeSnapIndex(doc, exclude, otherAnchors(start, -1))
          snap = snapMoving(index, [target], { tolerance: this.snapTolerance(press.touch) })
          target = add(target, snap.d)
        }
        const bent = bendCurve(start, curveIndex, t, target)
        // Close to the chord counts as straight: the bend removes itself.
        straight = maxChordDeviation(freeCurve(bent, curveIndex)) < 2 * this.unitsPerPx()
        current = straight ? (wasStraight ? start : straightenCurve(start, curveIndex)) : bent
        this.showSnap(straight ? null : snap, straight ? 'straight' : null)
        this.showInk(compose, new Map([[layer.id, editablePathToPathData(current)]]))
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
          edits: [{ layerId: layer.id, pathData: editablePathToPathData(current) }],
          select: [layer.id],
          anchor: point?.layerId === layer.id ? undefined : null,
        })
      },
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
      drawOverlay: (overlay) => {
        outlinePathData(this.scope, overlay, editablePathToPathData(current), center)
        drawCurves(this.scope, overlay, [freeCurve(current, curveIndex)], center)
        drawAnchors(this.scope, overlay, current, center, null, null, layer.frameRotation ?? 0)
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

  /** Drag one anchor of a free shape, or one of its Bézier handles. */
  private pointSession(press: Press, layerId: string, anchorIndex: number, which: 'anchor' | 'in' | 'out'): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!layer || layer.carve) return null
    const start = this.freePathOf(layer)
    if (!start || !start.segs[anchorIndex]) return null
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
            index ??= this.makeSnapIndex(doc, exclude, otherAnchors(start, anchorIndex))
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
        this.showInk(compose, new Map([[layerId, editablePathToPathData(current)]]))
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        this.host.commitLayerEdits({
          label: which === 'anchor' ? 'Move point' : 'Shape curve',
          edits: [{ layerId, pathData: editablePathToPathData(current) }],
          select: [layerId],
          anchor: { layerId, segmentIndex: anchorIndex },
        })
      },
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
      drawOverlay: (overlay) => {
        outlinePathData(this.scope, overlay, editablePathToPathData(current), center)
        drawAnchors(this.scope, overlay, current, center, anchorIndex, null, layer.frameRotation ?? 0)
      },
    }
  }

  /* ─── Overlay ─── */

  private drawOverlay(): void {
    if (this.destroyed) return
    const doc = this.host.getDoc()
    this.scope.activate()
    setOverlayScale(this.unitsPerPx())
    const layer = resetOverlay(this.scope)
    const editing = this.session ?? this.nudge?.plan ?? this.keyTransform?.plan ?? null
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
        const anchorIndex = doc.pointSelection?.layerId === free.layerId ? doc.pointSelection.segmentIndex : null
        const hoverIndex = this.hover.kind === 'anchor' ? this.hover.index : null
        this.scope.activate()
        layer.activate()
        drawAnchors(this.scope, layer, free.path, this.center(), anchorIndex, hoverIndex, this.layer(free.layerId)?.frameRotation ?? 0)
      }
      if (this.pendingPoint) drawGhostPoint(this.scope, layer, this.pendingPoint.point, this.center())
    }
    if (this.snapGuides.length) {
      this.scope.activate()
      layer.activate()
      drawSnapGuides(this.scope, layer, this.snapGuides, this.center())
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
    const path = zone.free ? this.freePathOf(layer) : null
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
      return false
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
      const point = doc.pointSelection
      const layer = point ? this.layer(point.layerId) : undefined
      if (point && layer && !layer.carve) {
        this.host.editAnchor(point.layerId, point.segmentIndex, 'delete')
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
      if (!canvasOwnsArrowKeys() || !doc.selectedLayerIds.length || this.session) return false
      if (event.altKey) {
        // Left and right turn by 1° (15° with Shift); up and down scale by 1% (10%).
        if (step.x) this.transformBy(step.x * (event.shiftKey ? 15 : 1), 0)
        else this.transformBy(0, -step.y * (event.shiftKey ? 10 : 1))
        return true
      }
      const amount = event.shiftKey ? 10 : 1
      this.nudgeBy({ x: step.x * amount, y: step.y * amount })
      return true
    }
    return false
  }

  /**
   * Alt+arrows turn or scale the selection about its box's centre, evenly,
   * so recipes stay recipes. Like a nudge, a burst previews at once and
   * commits once. A nudge still pending lands first, so the ink never
   * shows one burst without the other.
   */
  private transformBy(turn: number, percent: number) {
    this.flushNudge()
    if (!this.keyTransform) {
      const doc = this.host.getDoc()
      const around = selectionBox(doc, (layer) => this.freePathOf(layer))
      const plan = around ? this.boxPlan(around.ids, around.box, around.uniform) : null
      if (!around || !plan) return
      this.keyTransform = { plan, box: around.box, turn: 0, percent: 100, timer: 0, layers: doc.layers }
    }
    const t = this.keyTransform
    t.turn = normalizeDegrees(t.turn + turn)
    t.percent = Math.max(t.percent + percent, evenScaleFloor(t.box) * 100)
    const next = this.previewKeyTransform(t)
    // The number that changed, by the box's top right corner.
    const corners = (['nw', 'ne', 'se', 'sw'] as const).map((id) => add(boxHandlePoint(next, id)!, this.center()))
    this.placeHud({ x: Math.max(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) })
    hud.set({ label: null, chip: turn ? `${r0(next.rotation)}°` : `${r0(next.width)} × ${r0(next.height)}` })
    // Each key reads out where the selection now is, never how far the burst has gone.
    hud.announce(turn ? `Turned to ${r0(next.rotation)}°` : `Size ${r0(next.width)} × ${r0(next.height)}`)
    window.clearTimeout(t.timer)
    t.timer = window.setTimeout(() => this.flushKeyTransform(), NUDGE_COMMIT_MS)
  }

  /**
   * The box a burst of Alt+arrows has reached, and the map there. A turn
   * lands on a whole degree, so the angle read out is the angle stored.
   */
  private keyStep(t: KeyTransform): { move: BoxMove; next: OrientedBox } {
    const box = t.box
    const turn = Math.abs(t.turn) > 1e-9 ? normalizeDegrees(Math.round(box.rotation + t.turn) - box.rotation) : 0
    const factor = t.percent / 100
    return {
      move: keyMove(box, turn, factor),
      next: { ...box, width: box.width * factor, height: box.height * factor, rotation: normalizeDegrees(box.rotation + turn) },
    }
  }

  private previewKeyTransform(t: KeyTransform): OrientedBox {
    const { move, next } = this.keyStep(t)
    t.plan.preview(move, next, null)
    return next
  }

  /**
   * Commit a burst of Alt+arrows. The ink and hit areas already show the
   * burst, so a press straight after meets the shapes where they are drawn.
   * When an undo may follow at once (`restore`), they go back to the
   * document first: the undo can restore the very layers drawn before,
   * which renders nothing anew, and the ink must not keep the burst.
   */
  private flushKeyTransform(restore = false) {
    const t = this.keyTransform
    if (!t) return
    this.keyTransform = null
    window.clearTimeout(t.timer)
    hud.clear()
    const turned = Math.abs(t.turn) > 1e-9
    const several = t.plan.ids.length > 1
    if (restore) t.plan.cancel()
    t.plan.commit(turned ? (several ? 'Rotate shapes' : 'Rotate') : several ? 'Resize shapes' : 'Resize')
    this.drawOverlay()
  }

  /** Arrow keys preview immediately and commit once per burst. A pending Alt+arrow burst lands first. */
  private nudgeBy(d: Vec) {
    this.flushKeyTransform()
    if (!this.nudge) {
      const doc = this.host.getDoc()
      const plan = this.movePlan(
        doc.selectedLayerIds.filter((id) => {
          const layer = doc.layers.find((candidate) => candidate.id === id)
          return Boolean(layer && layer.visible && !layer.locked)
        }),
        true,
      )
      if (!plan) return
      this.nudge = { plan, d: { x: 0, y: 0 }, timer: 0, layers: doc.layers }
    }
    const nudge = this.nudge
    nudge.d = add(nudge.d, d)
    nudge.plan.preview(nudge.d)
    window.clearTimeout(nudge.timer)
    nudge.timer = window.setTimeout(() => this.flushNudge(), NUDGE_COMMIT_MS)
  }

  /** Commit a burst of nudges, putting the ink and hit areas back first when an undo may follow (see `flushKeyTransform`). */
  private flushNudge(restore = false) {
    const nudge = this.nudge
    if (!nudge) return
    this.nudge = null
    window.clearTimeout(nudge.timer)
    if (restore) nudge.plan.cancel()
    nudge.plan.commit(nudge.d)
  }
}
