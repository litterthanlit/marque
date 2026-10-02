import { add, distance, sub, type Vec } from '../../engine/path/bezier.ts'
import {
  editablePathToPathData,
  moveAnchor,
  moveHandle,
  translatePath,
  type EditablePath,
} from '../../engine/path/editPath.ts'
import { translateCarve } from '../../engine/carve/edit.ts'
import { carveOutline } from '../../engine/carve/outline.ts'
import type { CarveSpec } from '../../engine/carve/spec.ts'
import { bakedEditablePath } from '../../engine/illustrator/layerPath.ts'
import { createComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import type { LayerEditCommit } from '../../store/logoStore.ts'
import { getInkItem, setInkPathData, setSurvivalVisible } from '../IllustratorRenderer.ts'
import { carriedCuts } from './carry.ts'
import { CURSORS } from './cursors.ts'
import { hud } from './hud.ts'
import { EMPTY_ZONE, findZone, zoneKey, type HitContext, type Zone } from './hitZones.ts'
import { canvasOwnsArrowKeys, registerEditorKeys, setEditorInteracting } from './keyboard.ts'
import { drawAnchors, outlineItem, outlinePathData, resetOverlay } from './overlay.ts'

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

/** A move of some layers (and the cuts they carry), previewable and committable. */
interface MovePlan {
  preview(d: Vec): void
  commit(d: Vec): void
  cancel(): void
  editedIds: Set<string>
  drawOverlay(layer: paper.Layer): void
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
  private freeCache: { layerId: string; key: string; path: EditablePath } | null = null
  private nudge: { plan: MovePlan; d: Vec; timer: number } | null = null
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

  destroy(): void {
    this.flushNudge()
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
    const ctx = this.context(touch)
    if (!ctx) return
    const zone = findZone(ctx, p)
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
    return this.freePathFor(layer)
  }

  private freePathFor(layer: IllustratorLayer): { layerId: string; path: EditablePath } | null {
    const key = `${layer.pathData}|${JSON.stringify(layer.transform)}`
    if (this.freeCache && this.freeCache.layerId === layer.id && this.freeCache.key === key) return this.freeCache
    const path = bakedEditablePath(layer)
    if (!path) return null
    this.freeCache = { layerId: layer.id, key, path }
    return this.freeCache
  }

  private context(touch: boolean): HitContext | null {
    const doc = this.host.getDoc()
    if (!doc) return null
    const ids = new Set(doc.layers.map((layer) => layer.id))
    const selectedIds = doc.selectedLayerIds.filter((id) => ids.has(id))
    const freePath = this.selectedFreePath(doc, selectedIds)
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
      handles: null,
      unitsPerPx: 1 / this.scope.view.zoom,
      touch,
      edges: false,
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
      case 'body':
        return CURSORS.move
      case 'anchor':
      case 'bezier':
        return CURSORS.point
      default:
        return CURSORS.default
    }
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
      case 'body': {
        if (press.mods.shift) {
          const has = doc.selectedLayerIds.includes(zone.layerId)
          this.host.setSelection(
            has ? doc.selectedLayerIds.filter((id) => id !== zone.layerId) : [...doc.selectedLayerIds, zone.layerId],
          )
        } else {
          this.host.setSelection([zone.layerId], null)
        }
        return
      }
      case 'anchor':
        this.host.setSelection([zone.layerId], { layerId: zone.layerId, segmentIndex: zone.index })
        return
      case 'empty':
        if (!press.mods.shift) this.host.setSelection([])
        return
      default:
        return
    }
  }

  private doubleAction(zone: Zone) {
    if (zone.kind === 'anchor') this.host.editAnchor(zone.layerId, zone.index, 'toggle-smooth')
  }

  /* ─── Sessions ─── */

  private startSession(press: Press, mods: Modifiers): Session | null {
    const zone = press.zone
    switch (zone.kind) {
      case 'body':
        return this.moveSession(press, zone.layerId, mods)
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

  private pointSession(
    press: Press,
    layerId: string,
    apply: (start: EditablePath, d: Vec, mods: Modifiers) => EditablePath,
    anchorIndex: number,
  ): Session | null {
    const doc = this.host.getDoc()
    const layer = this.layer(layerId)
    if (!doc || !layer || layer.carve) return null
    const free = this.freePathFor(layer)
    if (!free) return null
    const start = free.path
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
      const free = this.selectedFreePath(doc, selected)
      if (free) {
        const anchorIndex = doc.pointSelection?.layerId === free.layerId ? doc.pointSelection.segmentIndex : null
        const hoverIndex = this.hover.kind === 'anchor' ? this.hover.index : null
        // freePathFor may have activated a headless scope; draw back into ours.
        this.scope.activate()
        layer.activate()
        drawAnchors(this.scope, layer, free.path, this.center(), anchorIndex, hoverIndex)
      }
    }
    this.scope.view.update()
  }

  /* ─── Keys ─── */

  private onKey(event: KeyboardEvent): boolean {
    if (!this.host.isEnabled()) return false
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
