import { distance, type Bounds, type Vec } from '../../engine/path/bezier.ts'
import { lineReading, lineShape, nearestOnGuide, type GuideShape } from '../../engine/vector/guides.ts'
import type { ConstructionRole } from '../../engine/vector/types.ts'
import type { Modifiers } from '../directEdit/DirectEditController.ts'
import { hud } from '../directEdit/hud.ts'
import { SELECTION_COLOR } from '../directEdit/overlay.ts'
import { guidePathItem, visibleLayerRect } from '../guideItems.ts'
import { unitsPerCssPixel } from '../viewFit.ts'

/** A construction line of a shape, with the shape it would follow, or a line it offers that follows nothing. */
export interface Ghost {
  of: string
  /** The construction line it would follow; null for a plain line, such as a tangent two selected circles share. */
  role: ConstructionRole | null
  /** Tells ghosts of one shape apart. */
  key: string
  shape: GuideShape
  /** What the guide would be called. */
  name: string
  /** Where a line touches the two shapes it is offered for: it draws from one to the other, a little past each, so it reaches both. */
  span?: readonly [Vec, Vec]
}

/** The construction lines of one shape that are not guides yet, and the shape's bounds (layer space). */
export interface GhostSet {
  of: string
  bounds: Bounds
  ghosts: Ghost[]
}

/** What a drag draws: a line, or a circle from its centre. */
export type GuideDraws = 'line' | 'circle'

export interface GuideCallbacks {
  /** A guide drawn by a drag: a line, or a circle. */
  onGuide(shape: GuideShape): void
  /** Construction lines picked from a shape: one with a click, all of them with Shift. */
  onGhosts(ghosts: Ghost[]): void
  /** The construction lines of the shape under `p` (layer space), or null off every shape. */
  ghostsAt(p: Vec, touch: boolean): GhostSet | null
  /** The construction lines of one shape as the document has it now, or null when it is gone or has none left. */
  ghostsOf(of: string): GhostSet | null
  /** A click on a guide that is not selected: select it, or with Shift toggle it among the selected. */
  selectGuide(id: string, additive: boolean): void
  /** Snap a point being placed, with 15° rays from `rays`. */
  snapPoint?(p: Vec, role: 'hover' | 'start' | 'end', rays: Vec[]): Vec
  /** Snap a circle's radius about its centre. */
  snapRadius?(center: Vec, radius: number): number
  /**
   * Snap a line drawn from `start` towards `current`: at `angle` when Shift
   * holds one, else turning about `start`. The line it lands on, or null.
   */
  snapLine?(start: Vec, current: Vec, angle: number | null): { p: Vec; angle: number } | null
  /** Is snapping on for these modifiers? Then angles land on whole degrees. */
  snaps(mods: Modifiers): boolean
  /** The press ended, or the pointer left: snap hints can go. */
  onGestureEnd?(): void
}

export interface GuideToolOptions {
  /** What a drag draws, read at each press. Alt draws the other for one drag. */
  draws(): GuideDraws
}

/** A press on a guide that is not selected: a click selects it, a drag draws a new line from `start` on it. */
export interface GuidePress {
  guideId: string
  start: Vec
}

interface Press {
  /** Where the press was, and where it snapped to. */
  raw: Vec
  start: Vec
  /** The construction line under the press, and the rest of its shape's. */
  ghost: Ghost | null
  set: GhostSet | null
  /** The guide pressed, when the press began on one. */
  guide: GuidePress | null
  /** The ghosts a tap had pinned when the press began. */
  pinned: GhostSet | null
  circle: boolean
  touch: boolean
  dragging: boolean
}

const LAYER_NAME = '__guide_tool'
const DRAG_PX = 3
/** How long a drag must be, in CSS pixels, before it gives a line an angle. */
const LINE_PX = 6
const GHOST_PX = 6
/** How far past its shape a ghost line draws, in CSS pixels: only the one under the pointer crosses the canvas. */
const GHOST_REACH_PX = 40
/** How far past the points it touches a line two shapes share draws, in CSS pixels. */
const SPAN_REACH_PX = 16
/** Within this many CSS pixels of each other, a circle ghost wins over a line one: the lines crowd its corners. */
const GHOST_TIE_PX = 1.5

/**
 * The ghosts a tap pinned on a touch screen, for the Guide tool's options
 * row to offer adding them all, as Shift-click does with a mouse. A tiny
 * external store, as the HUD is: the canvas updates it, the row reads it.
 */
export interface PinnedGhosts {
  count: number
  addAll(): void
}

let pinnedState: PinnedGhosts | null = null
const pinnedListeners = new Set<() => void>()

export const pinnedGhosts = {
  get(): PinnedGhosts | null {
    return pinnedState
  },
  set(next: PinnedGhosts | null): void {
    if (next === pinnedState || (next && pinnedState && next.count === pinnedState.count && next.addAll === pinnedState.addAll)) return
    pinnedState = next
    for (const listener of pinnedListeners) listener()
  },
  subscribe(listener: () => void): () => void {
    pinnedListeners.add(listener)
    return () => pinnedListeners.delete(listener)
  },
}

const sameGhost = (a: Ghost | null, b: Ghost | null) => a !== null && b !== null && a.of === b.of && a.key === b.key

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * The Guide tool. A press-drag draws an infinite line through the press
 * point at the drag's angle (Shift in 15° steps), or a circle from its centre
 * when it draws circles; Alt draws the other for one drag. A drag can start
 * on a guide not selected, and a click on one selects it. Over a shape it
 * shows the shape's construction lines as ghosts, which stay while the
 * pointer follows one off the shape: a click adds the one under the pointer,
 * Shift-click anywhere on the shape every one, each linked to the shape. A
 * click on the empty canvas does nothing. The tool stays active. What it
 * draws in progress shows even while guides are hidden.
 *
 * A touch screen has no hover, so a tap on a shape pins its ghosts instead,
 * and a second tap on one adds it; the options row offers adding them all. A
 * tap off them drops them, as Escape does.
 *
 * Ghosts are read from the document as it was: after any change to it they
 * are read again from their shape, and go when it is gone.
 */
export class GuideTool {
  private readonly scope: paper.PaperScope
  private readonly callbacks: GuideCallbacks
  private readonly options: GuideToolOptions
  private press: Press | null = null
  private shape: GuideShape | null = null
  private set: GhostSet | null = null
  private hot: Ghost | null = null
  /**
   * The line ghost being followed: the last one under the pointer, kept while
   * the pointer stays on it, though a circle of its shape it crosses wins the
   * tie there, so it can still be followed past that circle.
   */
  private followed: Ghost | null = null
  /** The ghosts showing were pinned by a tap: they stay until a tap off them. */
  private pinned = false
  /** The HUD names the ghost under the pointer. */
  private namedHot = false
  private readonly addPinned = () => {
    if (this.pinned && this.set?.ghosts.length) this.callbacks.onGhosts(this.set.ghosts)
  }

  constructor(scope: paper.PaperScope, callbacks: GuideCallbacks, options: GuideToolOptions) {
    this.scope = scope
    this.callbacks = callbacks
    this.options = options
  }

  private toLocal(point: paper.Point): Vec {
    const center = this.scope.view.center
    return { x: point.x - center.x, y: point.y - center.y }
  }

  private px(value: number, touch: boolean): number {
    return value * unitsPerCssPixel(this.scope) * (touch ? 2 : 1)
  }

  /** Where a ghost line draws while it is not under the pointer: its shape's bounds, a little larger. */
  private ghostRect(set: GhostSet): Bounds {
    const pad = this.px(GHOST_REACH_PX, false)
    const { minX, minY, maxX, maxY } = set.bounds
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
  }

  /** Where a ghost line draws while it is not under the pointer: between the points it touches, a little past each, or else beside its shape. */
  private ghostBounds(set: GhostSet, ghost: Ghost): Bounds {
    if (!ghost.span) return this.ghostRect(set)
    const [a, b] = ghost.span
    const pad = this.px(SPAN_REACH_PX, false)
    const along = distance(a, b) > 1e-9 ? { x: (b.x - a.x) / distance(a, b), y: (b.y - a.y) / distance(a, b) } : { x: 0, y: 0 }
    const ends = [
      { x: a.x - along.x * pad, y: a.y - along.y * pad },
      { x: b.x + along.x * pad, y: b.y + along.y * pad },
    ]
    // A hair wider than the two ends, so a level or upright line is not clipped away.
    const hair = this.px(0.5, false)
    return {
      minX: Math.min(ends[0].x, ends[1].x) - hair,
      minY: Math.min(ends[0].y, ends[1].y) - hair,
      maxX: Math.max(ends[0].x, ends[1].x) + hair,
      maxY: Math.max(ends[0].y, ends[1].y) + hair,
    }
  }

  /** How far `p` is from a ghost where it draws, or Infinity off the part of a line that draws. */
  private ghostDistance(set: GhostSet, ghost: Ghost, p: Vec): number {
    const { point, distance } = nearestOnGuide(ghost.shape, p)
    if (ghost.shape.kind !== 'line' || sameGhost(ghost, this.hot) || sameGhost(ghost, this.followed)) return distance
    const rect = this.ghostBounds(set, ghost)
    const inside = point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
    return inside ? distance : Infinity
  }

  /** The ghost nearest `p`, close enough to pick; a circle wins a near tie with a line. */
  private ghostAt(set: GhostSet | null, p: Vec, touch: boolean): Ghost | null {
    if (!set) return null
    const reach = this.px(GHOST_PX, touch)
    const tie = this.px(GHOST_TIE_PX, touch)
    let best: Ghost | null = null
    let bestScore = Infinity
    for (const ghost of set.ghosts) {
      const d = this.ghostDistance(set, ghost, p)
      if (d > reach) continue
      const score = ghost.shape.kind === 'circle' ? d - tie : d
      if (score < bestScore) {
        best = ghost
        bestScore = score
      }
    }
    return best
  }

  /**
   * The ghosts to show at `p`: the ones already showing while the pointer
   * stays on one of them, even over another shape, so a ghost that runs off
   * its shape can be followed and picked there; else the shape's under it.
   */
  private ghostsNear(p: Vec, touch: boolean): GhostSet | null {
    const kept = this.set
    const reach = this.px(GHOST_PX, touch)
    if (kept && kept.ghosts.some((ghost) => this.ghostDistance(kept, ghost, p) <= reach)) return kept
    const fresh = this.callbacks.ghostsAt(p, touch)
    return fresh?.ghosts.length ? fresh : null
  }

  /** Pin the ghosts showing, or let them go. */
  private pin(pinned: boolean) {
    this.pinned = pinned && this.set !== null && this.set.ghosts.length > 0
    pinnedGhosts.set(this.pinned ? { count: this.set!.ghosts.length, addAll: this.addPinned } : null)
  }

  /** A press. `guide` is the guide under it, when it is one not selected: see `GuidePress`. */
  onMouseDown(point: paper.Point, mods: Modifiers, touch = false, guide: GuidePress | null = null) {
    const raw = this.toLocal(point)
    this.unnameHot()
    // On a guide, the guide takes the click: no ghost is picked.
    const set = guide ? null : this.ghostsNear(raw, touch)
    const ghost = this.ghostAt(set, raw, touch)
    const start = guide ? this.startOn(guide, raw) : (this.callbacks.snapPoint?.(raw, 'start', []) ?? raw)
    const circle = (this.options.draws() === 'circle') !== mods.alt
    const pinned = this.pinned ? this.set : null
    this.press = { raw, start: { x: round2(start.x), y: round2(start.y) }, ghost, set, guide, pinned, circle, touch, dragging: false }
    this.shape = null
    this.set = set
    this.hot = ghost
    this.followed = null
    this.draw()
  }

  /** Where a line drawn out of a guide starts: a point the press snapped to on it, or else its point under the press. */
  private startOn(guide: GuidePress, raw: Vec): Vec {
    const snapped = this.callbacks.snapPoint?.(raw, 'start', []) ?? raw
    const moved = snapped.x !== raw.x || snapped.y !== raw.y
    return moved && distance(snapped, guide.start) < 1e-3 ? snapped : guide.start
  }

  /** Pointer moves with or without a press (the canvas routes both here). Over a guide, a press would take the guide, so no ghost lights. */
  onMouseDrag(point: paper.Point, mods: Modifiers, touch = false, overGuide = false) {
    const local = this.toLocal(point)
    const press = this.press
    if (!press) {
      this.hoverAt(local, touch, overGuide)
      return
    }
    if (!press.dragging && distance(local, press.raw) < this.px(DRAG_PX, press.touch)) return
    press.dragging = true
    this.set = null
    this.hot = null
    this.followed = null
    this.pin(false)
    this.shape = press.circle ? this.circleTo(press.start, local, mods) : this.lineTo(press.start, local, mods)
    this.draw()
  }

  onMouseUp(point: paper.Point, mods: Modifiers) {
    const press = this.press
    this.press = null
    // The last frame is snapped before the gesture's snapping ends, while what its start snapped to still holds.
    const end = this.toLocal(point)
    const shape = press?.dragging ? (press.circle ? this.circleTo(press.start, end, mods) : this.lineTo(press.start, end, mods)) : null
    this.callbacks.onGestureEnd?.()
    if (!press) return
    if (press.dragging) {
      this.shape = null
      hud.clear()
      this.draw()
      if (shape) this.callbacks.onGuide(shape)
      return
    }
    // A click: on a guide it selects it; on a ghost it adds that line; with Shift on the
    // shape or its ghosts, all of the shape's; elsewhere nothing.
    if (press.guide) {
      if (this.pinned) this.pin(false)
      this.draw()
      this.callbacks.selectGuide(press.guide.guideId, mods.shift)
    } else if (press.touch) this.tap(press, mods)
    else {
      this.draw()
      if (mods.shift && press.set?.ghosts.length) this.callbacks.onGhosts(press.set.ghosts)
      else if (press.ghost) this.callbacks.onGhosts([press.ghost])
    }
  }

  /**
   * A tap. It adds only a ghost already pinned, which the finger was aimed
   * at; on a shape it pins the shape's ghosts, and off them it lets them go.
   */
  private tap(press: Press, mods: Modifiers) {
    const pinnedSet = press.pinned
    const onPinned = pinnedSet !== null && press.set === pinnedSet
    this.hot = null
    if (onPinned && mods.shift) this.callbacks.onGhosts(pinnedSet.ghosts)
    else if (onPinned && press.ghost) this.callbacks.onGhosts([press.ghost])
    else {
      this.set = press.set?.ghosts.length ? press.set : null
      this.pin(this.set !== null)
    }
    this.draw()
  }

  private lineTo(start: Vec, current: Vec, mods: Modifiers): GuideShape | null {
    // Until the drag is long enough, its angle means nothing: no line yet, and nothing to read.
    if (distance(start, current) < this.px(LINE_PX, false)) {
      hud.set({ label: null, chip: null })
      return null
    }
    const raw = (Math.atan2(current.y - start.y, current.x - start.x) * 180) / Math.PI
    let through = start
    let angle: number
    if (mods.shift) {
      // Shift keeps 15° steps; the line may still move across itself to touch a circle.
      angle = Math.round(raw / 15) * 15
      through = this.callbacks.snapLine?.(start, current, angle)?.p ?? start
    } else {
      // A snapped line is exact: through a point, or touching a circle. A free one lands on a whole degree.
      const snapped = this.callbacks.snapLine?.(start, current, null)
      angle = snapped ? snapped.angle : this.callbacks.snaps(mods) ? Math.round(raw) : raw
      if (snapped) through = snapped.p
    }
    const shape = lineShape(through, angle)
    if (shape.kind === 'line') {
      // A ray snap's label reads as a protractor does elsewhere; here the line's own reading stands for it.
      const label = hud.asked()
      hud.set({ chip: `${lineReading(shape.angle)}°`, label: label?.endsWith('°') ? null : label })
    }
    return shape
  }

  /** A circle about `center` through `current`: the radius snaps, or with snapping on lands on a whole unit, as a resize does. */
  private circleTo(center: Vec, current: Vec, mods: Modifiers): GuideShape | null {
    const raw = distance(center, current)
    const snapped = this.callbacks.snapRadius?.(center, raw) ?? raw
    const r = snapped === raw && this.callbacks.snaps(mods) ? Math.round(raw) : round2(snapped)
    if (r < 1) return null
    hud.set({ chip: `r ${Math.round(r * 100) / 100}` })
    return { kind: 'circle', c: center, r }
  }

  private hoverAt(local: Vec, touch: boolean, overGuide: boolean) {
    // A mouse moving again: what a tap pinned gives way to hovering.
    if (this.pinned) this.pin(false)
    this.set = this.ghostsNear(local, touch)
    this.hot = overGuide ? null : this.ghostAt(this.set, local, touch)
    this.follow(local, touch)
    // Where a press would start a line, unless it would pick a ghost or a guide.
    if (!this.hot && !overGuide) {
      this.unnameHot()
      this.callbacks.snapPoint?.(local, 'hover', [])
    } else {
      this.callbacks.onGestureEnd?.()
      this.nameHot()
    }
    this.draw()
  }

  /** A line under the pointer is the one followed; a circle that wins the tie on it leaves it followed, while the pointer stays on it. */
  private follow(p: Vec, touch: boolean) {
    const hot = this.hot
    const followed = this.followed
    if (hot?.shape.kind === 'line') this.followed = hot
    else {
      const stays = hot !== null && followed !== null && this.set?.of === followed.of && nearestOnGuide(followed.shape, p).distance <= this.px(GHOST_PX, touch)
      this.followed = stays ? followed : null
    }
  }

  /** By the pointer, the ghost under it and what a click does: it adds that one, Shift-click every one. */
  private nameHot() {
    const hot = this.hot
    const count = this.set?.ghosts.length ?? 0
    if (hot) hud.set({ chip: null, label: `${hot.name} · click adds${count > 1 ? ` · Shift-click adds all ${count}` : ''}` })
    else this.unnameHot()
    this.namedHot = hot !== null
  }

  /** The ghost the HUD named is no longer under the pointer. */
  private unnameHot() {
    if (!this.namedHot) return
    this.namedHot = false
    hud.set({ chip: null, label: null })
  }

  /** The pointer left the canvas: the ghosts go, unless a tap pinned them (a finger leaves as it lifts). */
  pointerLeave() {
    if (this.press || this.pinned) return
    this.set = null
    this.hot = null
    this.followed = null
    this.unnameHot()
    this.draw()
  }

  /** The press was interrupted (cancelled, or its capture lost): drop the line being drawn. Returns whether there was one. */
  cancel(): boolean {
    const had = this.press !== null
    this.press = null
    this.shape = null
    hud.clear()
    this.callbacks.onGestureEnd?.()
    this.draw()
    return had
  }

  /** Escape: drop the line being drawn, or else the ghosts a tap pinned. Returns whether there was either. */
  dismiss(): boolean {
    if (this.cancel()) return true
    if (!this.pinned) return false
    this.set = null
    this.hot = null
    this.followed = null
    this.pin(false)
    this.draw()
    return true
  }

  destroy() {
    this.press = null
    this.shape = null
    this.set = null
    this.hot = null
    this.followed = null
    this.unnameHot()
    this.pin(false)
    this.layer()?.remove()
    this.scope.view.update()
  }

  /**
   * Draw again after the canvas re-rendered (a render clears the project), or
   * after the document changed: ghosts showing are read again from their
   * shape as it is now, so they never outlive the document they came from.
   */
  redraw() {
    if (!this.press && this.set) {
      const fresh = this.callbacks.ghostsOf(this.set.of)
      this.set = fresh?.ghosts.length ? fresh : null
      // The pointer may no longer be on the one it was on: the next move finds it again.
      this.hot = null
      this.followed = null
      this.unnameHot()
      if (this.pinned) this.pin(this.set !== null)
    }
    this.draw()
  }

  private layer(): paper.Layer | null {
    return (this.scope.project.layers.find((candidate) => candidate.name === LAYER_NAME) as paper.Layer | undefined) ?? null
  }

  private draw() {
    this.scope.activate()
    const previous = this.scope.project.activeLayer
    let layer = this.layer()
    if (layer) layer.removeChildren()
    else {
      layer = new this.scope.Layer()
      layer.name = LAYER_NAME
    }
    layer.bringToFront()
    const u = unitsPerCssPixel(this.scope)
    const center = { x: this.scope.view.center.x, y: this.scope.view.center.y }
    const rect = visibleLayerRect(this.scope)
    const put = (shape: GuideShape, within: Bounds, alpha: number, width: number, dash: number[]) => {
      const item = guidePathItem(this.scope, shape, center, within)
      if (!item) return
      const color = new this.scope.Color(SELECTION_COLOR)
      color.alpha = alpha
      item.strokeColor = color
      item.strokeWidth = width * u
      item.dashArray = dash.map((length) => length * u)
      item.locked = true
      layer!.addChild(item)
    }

    // Ghosts are previews, never guides: in the selection's blue, faint and short beside their
    // shape; the one under the pointer solid and across the canvas, as it would be added.
    const set = this.set
    if (set) {
      // A line being followed while a circle it crosses is under the pointer still runs across the canvas.
      for (const ghost of set.ghosts) {
        if (!sameGhost(ghost, this.hot)) put(ghost.shape, sameGhost(ghost, this.followed) ? rect : this.ghostBounds(set, ghost), 0.4, 1, [3, 3])
      }
    }
    if (this.hot) put(this.hot.shape, rect, 1, 1.25, [])
    if (this.shape) {
      put(this.shape, rect, 1, 1, [])
      const start = this.press?.start
      if (start) {
        const dot = new this.scope.Path.Circle({ center: [start.x + center.x, start.y + center.y], radius: 3 * u, insert: false })
        dot.fillColor = new this.scope.Color(SELECTION_COLOR)
        dot.locked = true
        layer.addChild(dot)
      }
    }

    previous?.activate()
    this.scope.view.update()
  }
}
