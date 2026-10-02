import {
  add,
  BEND_T_MAX,
  BEND_T_MIN,
  clamp,
  cubicPoint,
  distance,
  maxChordDeviation,
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
  DEFAULT_HANDLE_LAYOUT,
  dragCarveHandle,
  isSideBent,
  straightenCarve,
  translateCarve,
  type CarveGrab,
  type CarveHandle,
  type HandleLayout,
} from '../../engine/carve/edit.ts'
import { boxGeometryFor, carveOutline, grooveSpine, type SideRef } from '../../engine/carve/outline.ts'
import { bentEdgeCount, isGroove, type CarveSpec } from '../../engine/carve/spec.ts'
import { bakedEditablePath } from '../../engine/illustrator/layerPath.ts'
import { createComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import type { LayerEditCommit } from '../../store/logoStore.ts'
import { getInkItem, setInkPathData, setSurvivalVisible } from '../IllustratorRenderer.ts'
import { carriedCuts } from './carry.ts'
import { CURSORS, resizeCursor } from './cursors.ts'
import { hud } from './hud.ts'
import { EMPTY_ZONE, findZone, freeCurve, zoneKey, type HitContext, type Zone } from './hitZones.ts'
import { canvasOwnsArrowKeys, registerEditorKeys, setEditorInteracting } from './keyboard.ts'
import {
  drawAnchors,
  drawCarveHandles,
  drawCurves,
  drawGhostPoint,
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
  getDoc(): IllustratorDocument | null
  /** The committed ink (layer space), to restore after a cancelled gesture. */
  getInkPathData(): string
  isEnabled(): boolean
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
  private nudge: { plan: MovePlan; d: Vec; timer: number } | null = null
  private pendingPoint: PendingPoint | null = null
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
    this.drawOverlay()
  }

  get isInteracting(): boolean {
    return this.session !== null
  }

  /** The canvas changed size on screen: redraw handles at their constant on-screen size. */
  refresh(): void {
    this.drawOverlay()
  }

  destroy(): void {
    this.flushNudge()
    this.dropPendingPoint()
    this.cancel()
    this.unregisterKeys()
    this.destroyed = true
    hud.clear()
    resetOverlay(this.scope)
    this.scope.view.update()
  }

  /* ─── Pointer ─── */

  pointerDown(p: Vec, mods: Modifiers, touch: boolean): void {
    if (!this.host.isEnabled()) return
    this.flushNudge()
    let ctx = this.context(touch)
    if (!ctx) return
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
      if (!ctx) return
      zone = findZone(ctx, p)
    }
    this.press = { point: p, zone, mods, touch }
  }

  pointerMove(p: Vec, mods: Modifiers, touch: boolean): void {
    if (this.session) {
      this.session.update(p, mods)
      this.placeHud(p)
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
        this.placeHud(p)
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
    hud.clear()
    setSurvivalVisible(this.scope, true)
    this.drawOverlay()
  }

  /* ─── Context and hover ─── */

  private center(): Vec {
    return { x: this.scope.view.center.x, y: this.scope.view.center.y }
  }

  private layer(id: string): IllustratorLayer | undefined {
    return this.host.getDoc()?.layers.find((candidate) => candidate.id === id)
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
    const u = this.unitsPerPx()
    return {
      pad: DEFAULT_HANDLE_LAYOUT.pad * u,
      rotateOffset: DEFAULT_HANDLE_LAYOUT.rotateOffset * u,
      minEdgeHandleSize: DEFAULT_HANDLE_LAYOUT.minEdgeHandleSize * u,
    }
  }

  /** The single selected recipe layer, if any: it gets handles. */
  private selectedRecipe(doc: IllustratorDocument, selectedIds: string[]): IllustratorLayer | null {
    if (selectedIds.length !== 1) return null
    const layer = doc.layers.find((candidate) => candidate.id === selectedIds[0])
    return layer && layer.carve && layer.visible && !layer.locked ? layer : null
  }

  private context(touch: boolean): HitContext | null {
    const doc = this.host.getDoc()
    if (!doc) return null
    const ids = new Set(doc.layers.map((layer) => layer.id))
    const selectedIds = doc.selectedLayerIds.filter((id) => ids.has(id))
    const freePath = this.selectedFreePath(doc, selectedIds)
    const recipe = this.selectedRecipe(doc, selectedIds)
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
      handles: recipe ? { layerId: recipe.id, list: carveHandles(recipe.carve!, this.handleLayout()) } : null,
      unitsPerPx: this.unitsPerPx(),
      touch,
      edges: true,
      freePathOf: (layer) => this.freePathOf(layer),
    }
  }

  private updateHover(p: Vec, touch: boolean) {
    if (!this.host.isEnabled()) {
      this.setCursor(CURSORS.default)
      return
    }
    const ctx = this.context(touch)
    const zone = ctx ? findZone(ctx, p) : EMPTY_ZONE
    if (zoneKey(zone) !== zoneKey(this.hover)) {
      this.hover = zone
      this.drawOverlay()
    }
    this.setCursor(this.cursorFor(zone))
  }

  private cursorFor(zone: Zone): string {
    switch (zone.kind) {
      case 'handle':
        if (zone.handle.kind === 'rotate') return CURSORS.rotate
        if (zone.handle.kind === 'radius' || zone.handle.kind === 'endpoint') return CURSORS.point
        return resizeCursor(zone.handle.axisDeg)
      case 'body':
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
    return Boolean(doc && doc.selectedLayerIds.length === 1 && doc.selectedLayerIds[0] === layerId)
  }

  private setCursor(cursor: string) {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor
  }

  private placeHud(p: Vec) {
    const view = this.scope.view.projectToView(new this.scope.Point(p.x, p.y))
    const rect = this.canvas.getBoundingClientRect()
    const sx = rect.width / this.scope.view.viewSize.width
    const sy = rect.height / this.scope.view.viewSize.height
    hud.set({ x: view.x * sx, y: view.y * sy })
  }

  /* ─── Clicks ─── */

  private clickAction(press: Press) {
    const doc = this.host.getDoc()
    if (!doc) return
    const zone = press.zone
    switch (zone.kind) {
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
      anchor: doc?.pointSelection?.layerId === layer.id ? undefined : null,
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
        return this.handleSession(press, zone.layerId, zone.handle)
      case 'body':
        return this.moveSession(press, zone.layerId, mods)
      case 'edge':
        return zone.carve ? this.carveBendSession(press, zone.layerId, zone.carve) : this.freeBendSession(press, zone)
      case 'anchor':
        return this.pointSession(press, zone.layerId, (start, d) => moveAnchor(start, zone.index, add(start.segs[zone.index].p, d)), zone.index)
      case 'bezier':
        return this.pointSession(
          press,
          zone.layerId,
          (start, d, m) => {
            const seg = start.segs[zone.index]
            const handle = (zone.which === 'in' ? seg.hIn : seg.hOut) ?? { x: 0, y: 0 }
            return moveHandle(start, zone.index, zone.which, add(add(seg.p, handle), d), { breakSmooth: m.alt })
          },
          zone.index,
        )
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
    if (!doc || !ids.length) return null
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
    const itemStarts = new Map<string, paper.Point>()
    for (const id of starts.keys()) {
      const item = this.items.get(id)
      if (item) itemStarts.set(id, item.position.clone())
    }
    const pathFor = (id: string, d: Vec): string => {
      const start = starts.get(id)!
      return start.carve ? carveOutline(translateCarve(start.carve, d)).pathData : editablePathToPathData(translatePath(start.path!, d))
    }
    const carriedSet = new Set(carried)

    return {
      editedIds: new Set(starts.keys()),
      preview: (d) => {
        const replacements = new Map<string, string | null>()
        for (const id of starts.keys()) replacements.set(id, pathFor(id, d))
        const ink = compose.compose(replacements)
        setInkPathData(this.scope, ink)
        for (const [id, position] of itemStarts) {
          const item = this.items.get(id)
          if (item) item.position = position.add(new this.scope.Point(d.x, d.y))
        }
        this.drawOverlay()
      },
      commit: (d) => {
        if (Math.hypot(d.x, d.y) < 0.5) {
          this.restore(itemStarts)
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
      cancel: () => this.restore(itemStarts),
      drawOverlay: (layer) => {
        for (const id of starts.keys()) {
          const item = this.items.get(id)
          if (item) outlineItem(this.scope, layer, item, carriedSet.has(id) ? { dashed: true, width: 1.5 } : {})
        }
      },
    }
  }

  private restore(itemStarts: Map<string, paper.Point>) {
    for (const [id, position] of itemStarts) {
      const item = this.items.get(id)
      if (item) item.position = position
    }
    setInkPathData(this.scope, this.host.getInkPathData())
  }

  private moveSession(press: Press, pressedId: string, mods: Modifiers): Session | null {
    const doc = this.host.getDoc()
    if (!doc) return null
    // Alt moves the shape alone, leaving its holes where they are.
    const plan = this.movePlan(this.movingIds(doc, pressedId), !mods.alt)
    if (!plan) return null
    let d: Vec = { x: 0, y: 0 }
    return {
      editedIds: plan.editedIds,
      update: (p) => {
        d = sub(p, press.point)
        plan.preview(d)
        hud.set({ chip: `${Math.round(d.x)}, ${Math.round(d.y)}` })
      },
      commit: () => plan.commit(d),
      cancel: () => plan.cancel(),
      drawOverlay: (layer) => plan.drawOverlay(layer),
    }
  }

  private handleSession(press: Press, layerId: string, handle: CarveHandle): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!doc || !layer?.carve) return null
    const start = layer.carve
    const compose = createComposeSession(doc, [layerId])
    const center = this.center()
    const startLocal = sub(press.point, center)
    let current = start
    return {
      editedIds: new Set([layerId]),
      update: (p, mods) => {
        current = dragCarveHandle(start, handle.id, startLocal, sub(p, center), mods)
        setInkPathData(this.scope, compose.compose(new Map([[layerId, carveOutline(current).pathData]])))
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

  /** While a tool is active: is the pointer over a handle of the selected cut? */
  handleAt(p: Vec, touch: boolean): boolean {
    if (!this.host.isEnabled()) return false
    const ctx = this.context(touch)
    return Boolean(ctx && findZone({ ...ctx, edges: false }, p).kind === 'handle')
  }

  /** Hover while a tool is active: only handles react. Returns the cursor to show, if any. */
  toolHover(p: Vec, touch: boolean): string | null {
    if (!this.host.isEnabled()) return null
    const ctx = this.context(touch)
    if (!ctx) return null
    const zone = findZone({ ...ctx, edges: false }, p)
    const hot = zone.kind === 'handle' ? zone : EMPTY_ZONE
    if (zoneKey(hot) !== zoneKey(this.hover)) {
      this.hover = hot
      this.drawOverlay()
    }
    return zone.kind === 'handle' ? this.cursorFor(zone) : null
  }

  /** Drag a recipe's edge: its side bends, its corner fills out, or its groove's spine curves. */
  private carveBendSession(press: Press, layerId: string, grab: CarveGrab): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!doc || !layer?.carve || layer.locked) return null
    const start = layer.carve
    const compose = createComposeSession(doc, [layerId])
    let current = start
    return {
      editedIds: new Set([layerId]),
      update: (p) => {
        // The grabbed point follows the pointer's movement, wherever on the band it was pressed.
        current = bendCarve(start, grab, add(grab.point, sub(p, press.point)))
        setInkPathData(this.scope, compose.compose(new Map([[layerId, carveOutline(current).pathData]])))
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
    if (!doc || !layer || layer.carve || layer.locked || !zone.free) return null
    const start = this.freePathOf(layer)
    if (!start || zone.free.curveIndex >= start.segs.length) return null
    const { curveIndex } = zone.free
    const t = clamp(zone.free.t, BEND_T_MIN, BEND_T_MAX)
    const base = cubicPoint(freeCurve(start, curveIndex), t)
    const compose = createComposeSession(doc, [layer.id])
    const center = this.center()
    const wasStraight = isCurveStraight(start, curveIndex)
    let current = start
    let straight = wasStraight
    return {
      editedIds: new Set([layer.id]),
      update: (p) => {
        const bent = bendCurve(start, curveIndex, t, add(base, sub(p, press.point)))
        // Close to the chord counts as straight: the bend removes itself.
        straight = maxChordDeviation(freeCurve(bent, curveIndex)) < 2 * this.unitsPerPx()
        current = straight ? (wasStraight ? start : straightenCurve(start, curveIndex)) : bent
        setInkPathData(this.scope, compose.compose(new Map([[layer.id, editablePathToPathData(current)]])))
        hud.set({
          chip: straight ? 'straight' : `depth ${r0(maxChordDeviation(freeCurve(current, curveIndex)))}`,
        })
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        const point = this.host.getDoc()?.pointSelection
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
        drawAnchors(this.scope, overlay, current, center, null, null)
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

  private pointSession(
    press: Press,
    layerId: string,
    apply: (start: EditablePath, d: Vec, mods: Modifiers) => EditablePath,
    anchorIndex: number,
  ): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!doc || !layer || layer.carve) return null
    const start = this.freePathOf(layer)
    if (!start) return null
    const compose = createComposeSession(doc, [layerId])
    let current = start
    const center = this.center()
    return {
      editedIds: new Set([layerId]),
      update: (p, mods) => {
        current = apply(start, sub(p, press.point), mods)
        const pathData = editablePathToPathData(current)
        setInkPathData(this.scope, compose.compose(new Map([[layerId, pathData]])))
        this.drawOverlay()
      },
      commit: () => {
        if (current === start) return
        this.host.commitLayerEdits({
          label: 'Move point',
          edits: [{ layerId, pathData: editablePathToPathData(current) }],
          select: [layerId],
          anchor: { layerId, segmentIndex: anchorIndex },
        })
      },
      cancel: () => setInkPathData(this.scope, this.host.getInkPathData()),
      drawOverlay: (overlay) => {
        outlinePathData(this.scope, overlay, editablePathToPathData(current), center)
        drawAnchors(this.scope, overlay, current, center, anchorIndex, null)
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
    if (!doc || !this.host.isEnabled()) {
      this.scope.view.update()
      return
    }
    const editing = this.session ?? (this.nudge ? this.nudge.plan : null)
    const edited = editing?.editedIds ?? new Set<string>()
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
    } else {
      const recipe = this.selectedRecipe(doc, selected)
      if (recipe?.carve) {
        this.drawRecipe(layer, recipe.carve, this.hover.kind === 'handle' ? this.hover.handle.id : null, false)
      }
      const free = this.selectedFreePath(doc, selected)
      // The curve that would bend under the pointer.
      if (this.hover.kind === 'edge') this.drawEdgeHover(layer, this.hover)
      if (free) {
        const anchorIndex = doc.pointSelection?.layerId === free.layerId ? doc.pointSelection.segmentIndex : null
        const hoverIndex = this.hover.kind === 'anchor' ? this.hover.index : null
        this.scope.activate()
        layer.activate()
        drawAnchors(this.scope, layer, free.path, this.center(), anchorIndex, hoverIndex)
      }
      if (this.pendingPoint) drawGhostPoint(this.scope, layer, this.pendingPoint.point, this.center())
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
    if (!this.host.isEnabled()) return false
    // A point waiting to be added: Escape drops it, any other key lets it land first.
    if (this.pendingPoint) {
      if (event.key === 'Escape') {
        this.dropPendingPoint()
        return true
      }
      this.flushPendingPoint()
    }
    const doc = this.host.getDoc()
    if (!doc) return false

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
    if (step && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!canvasOwnsArrowKeys() || !doc.selectedLayerIds.length || this.session) return false
      const amount = event.shiftKey ? 10 : 1
      this.nudgeBy({ x: step.x * amount, y: step.y * amount })
      return true
    }
    return false
  }

  /** Arrow keys preview immediately and commit once per burst. */
  private nudgeBy(d: Vec) {
    if (!this.nudge) {
      const doc = this.host.getDoc()
      if (!doc) return
      const plan = this.movePlan(
        doc.selectedLayerIds.filter((id) => {
          const layer = doc.layers.find((candidate) => candidate.id === id)
          return Boolean(layer && layer.visible && !layer.locked)
        }),
        true,
      )
      if (!plan) return
      this.nudge = { plan, d: { x: 0, y: 0 }, timer: 0 }
    }
    const nudge = this.nudge
    nudge.d = add(nudge.d, d)
    nudge.plan.preview(nudge.d)
    window.clearTimeout(nudge.timer)
    nudge.timer = window.setTimeout(() => this.flushNudge(), NUDGE_COMMIT_MS)
  }

  private flushNudge() {
    const nudge = this.nudge
    if (!nudge) return
    this.nudge = null
    window.clearTimeout(nudge.timer)
    nudge.plan.commit(nudge.d)
  }
}
