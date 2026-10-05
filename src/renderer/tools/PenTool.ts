import { add, BEND_T_MAX, BEND_T_MIN, clamp, cubicPoint, maxChordDeviation, sub, type Vec } from '../../engine/path/bezier.ts'
import { editablePathToPathData, isCurveStraight, straightenCurve } from '../../engine/path/editPath.ts'
import {
  bendDraftEdge,
  canClose,
  closeDraft,
  draftCurve,
  EMPTY_DRAFT,
  hitDraft,
  moveDraftPoint,
  placePoint,
  removeLastPoint,
  type DraftHit,
  type PenDraft,
} from '../../engine/path/penDraft.ts'
import type { SnapTarget } from '../../engine/snap/snapping.ts'
import { CURSORS } from '../directEdit/cursors.ts'
import { hud } from '../directEdit/hud.ts'
import { SELECTION_COLOR } from '../directEdit/overlay.ts'
import { unitsPerCssPixel } from '../viewFit.ts'

export interface PenCallbacks {
  /** The closed shape, as path data in layer space. */
  onShape(pathData: string): void
  /** Snap a point (layer space) with rays from `rays` and the draft's own points as extra targets. */
  snapPoint?(p: Vec, role: 'hover' | 'start' | 'end', rays: Vec[], extra: SnapTarget[]): Vec
  /** A press ended, or the pointer left: snap guides can go. */
  onGestureEnd?(): void
}

interface PenOptions {
  /** The colour the shape will fill with once closed. Asked on every draw: it follows the canvas's look. */
  fillColor(): string
}

type Gesture =
  /** The point just placed: it follows the pointer until release. */
  | { kind: 'place'; index: number }
  | { kind: 'move'; index: number; press: Vec; start: PenDraft; moved: boolean }
  | { kind: 'bend'; curveIndex: number; t: number; base: Vec; press: Vec; start: PenDraft }
  /** Pressed the first point: closes on release, unless dragged (then it moves). */
  | { kind: 'close'; press: Vec }

const LAYER_NAME = '__pen'
const DRAG_PX = 3
const HISTORY_LIMIT = 100

/**
 * The pen: place, then bend. Click to place corners, drag any edge (even
 * mid-drawing) to curve it, drag a point to move it, and close the shape by
 * clicking the first point, pressing Enter or double-clicking. Backspace
 * takes back the last point, Escape drops the drawing, and Cmd/Ctrl+Z undoes
 * pen steps while drawing. No handles to pull: curves come from bending.
 */
export class PenTool {
  private readonly scope: paper.PaperScope
  private readonly callbacks: PenCallbacks
  private readonly options: PenOptions
  private draft: PenDraft = EMPTY_DRAFT
  private history: PenDraft[] = []
  private gesture: Gesture | null = null
  /** Where the next point would go (snapped), and what a press there would grab. */
  private cursor: Vec | null = null
  private hit: DraftHit | null = null

  constructor(scope: paper.PaperScope, callbacks: PenCallbacks, options: PenOptions) {
    this.scope = scope
    this.callbacks = callbacks
    this.options = options
  }

  get isDrawing(): boolean {
    return this.draft.segs.length > 0
  }

  /* ─── Geometry helpers ─── */

  private toLocal(point: paper.Point): Vec {
    const center = this.scope.view.center
    return { x: point.x - center.x, y: point.y - center.y }
  }

  private px(value: number): number {
    return value * unitsPerCssPixel(this.scope)
  }

  private tolerances() {
    return { close: this.px(10), point: this.px(6), edge: this.px(6) }
  }

  private targets(except = -1): SnapTarget[] {
    return this.draft.segs.filter((_, i) => i !== except).map((seg) => ({ p: seg.p, kind: 'point' as const }))
  }

  /** Rays for a new point: from the last point and (to close square) from the first. */
  private placementRays(): Vec[] {
    const segs = this.draft.segs
    if (!segs.length) return []
    return segs.length > 1 ? [segs[segs.length - 1].p, segs[0].p] : [segs[0].p]
  }

  private snap(p: Vec, role: 'hover' | 'start' | 'end', rays: Vec[], except = -1): Vec {
    return this.callbacks.snapPoint?.(p, role, rays, this.targets(except)) ?? p
  }

  private remember() {
    this.history.push(this.draft)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
  }

  /* ─── Pointer ─── */

  onMouseDown(point: paper.Point) {
    const local = this.toLocal(point)
    const hit = hitDraft(this.draft, local, this.tolerances())
    if (hit?.kind === 'close') {
      this.gesture = { kind: 'close', press: local }
    } else if (hit?.kind === 'point') {
      this.remember()
      this.gesture = { kind: 'move', index: hit.index, press: local, start: this.draft, moved: false }
    } else if (hit?.kind === 'edge') {
      this.remember()
      const t = clamp(hit.t, BEND_T_MIN, BEND_T_MAX)
      this.gesture = {
        kind: 'bend',
        curveIndex: hit.curveIndex,
        t,
        base: cubicPoint(draftCurve(this.draft, hit.curveIndex), t),
        press: local,
        start: this.draft,
      }
    } else {
      this.remember()
      const p = this.snap(local, 'start', this.placementRays())
      this.draft = placePoint(this.draft, p)
      this.gesture = { kind: 'place', index: this.draft.segs.length - 1 }
    }
    this.hit = hit
    this.cursor = null
    this.draw()
  }

  /** Pointer moves with or without a press (the canvas routes both here). */
  onMouseDrag(point: paper.Point) {
    const local = this.toLocal(point)
    const gesture = this.gesture
    if (!gesture) {
      this.hoverAt(local)
      return
    }
    switch (gesture.kind) {
      case 'place': {
        // Rays from the point before it, and from the first point to close square.
        const segs = this.draft.segs
        const rays = [gesture.index - 1, gesture.index >= 2 ? 0 : -1].filter((i) => i >= 0).map((i) => segs[i].p)
        const p = this.snap(local, 'end', rays, gesture.index)
        this.draft = moveDraftPoint(this.draft, gesture.index, p)
        break
      }
      case 'close':
        if (Math.hypot(local.x - gesture.press.x, local.y - gesture.press.y) < this.px(DRAG_PX)) return
        // Dragging the first point moves it instead of closing.
        this.remember()
        this.gesture = { kind: 'move', index: 0, press: gesture.press, start: this.draft, moved: true }
        this.onMouseDrag(point)
        return
      case 'move': {
        if (!gesture.moved && Math.hypot(local.x - gesture.press.x, local.y - gesture.press.y) < this.px(DRAG_PX)) return
        gesture.moved = true
        const startPoint = gesture.start.segs[gesture.index].p
        const p = this.snap(add(startPoint, sub(local, gesture.press)), 'end', this.raysAround(gesture.index), gesture.index)
        this.draft = moveDraftPoint(gesture.start, gesture.index, p)
        break
      }
      case 'bend': {
        const target = this.snap(add(gesture.base, sub(local, gesture.press)), 'end', [])
        const bent = bendDraftEdge(gesture.start, gesture.curveIndex, gesture.t, target)
        // Close to the chord counts as straight.
        const straight = maxChordDeviation(draftCurve(bent, gesture.curveIndex)) < this.px(2)
        this.draft = straight
          ? isCurveStraight(gesture.start, gesture.curveIndex)
            ? gesture.start
            : straightenCurve(gesture.start, gesture.curveIndex)
          : bent
        if (straight) hud.set({ label: 'straight' })
        break
      }
    }
    this.draw()
  }

  onMouseUp(point: paper.Point) {
    const gesture = this.gesture
    this.gesture = null
    this.callbacks.onGestureEnd?.()
    if (!gesture) return
    if (gesture.kind === 'close') {
      this.finalize()
      return
    }
    if (gesture.kind === 'move' && !gesture.moved) this.history.pop()
    if (gesture.kind === 'bend' && this.draft === gesture.start) this.history.pop()
    this.hoverAt(this.toLocal(point))
  }

  private raysAround(index: number): Vec[] {
    const segs = this.draft.segs
    return [index - 1, index + 1].filter((i) => i >= 0 && i < segs.length).map((i) => segs[i].p)
  }

  private hoverAt(local: Vec) {
    const hit = hitDraft(this.draft, local, this.tolerances())
    this.hit = hit
    if (hit?.kind === 'close') {
      this.cursor = this.draft.segs[0].p
      this.callbacks.onGestureEnd?.()
      hud.set({ label: 'close' })
    } else if (hit) {
      this.cursor = null
      this.callbacks.onGestureEnd?.()
    } else {
      this.cursor = this.snap(local, 'hover', this.placementRays())
    }
    this.draw()
  }

  /** The cursor for a hover position: what a press there would do. */
  cursorAt(point: paper.Point): string | null {
    const hit = hitDraft(this.draft, this.toLocal(point), this.tolerances())
    if (!hit) return null
    if (hit.kind === 'edge') return CURSORS.bend
    return CURSORS.point
  }

  /* ─── Commands ─── */

  /** Enter or double-click: close the shape if it can be. Returns whether it closed. */
  finalize(): boolean {
    const shape = closeDraft(this.draft)
    if (!shape) return false
    const pathData = editablePathToPathData(shape)
    this.reset()
    this.callbacks.onShape(pathData)
    return true
  }

  /** Backspace: take back the last point. */
  removeLastPoint(): boolean {
    if (!this.isDrawing) return false
    this.remember()
    this.draft = removeLastPoint(this.draft)
    this.draw()
    return true
  }

  /** Cmd/Ctrl+Z while drawing: undo the last pen step. */
  undo(): boolean {
    const previous = this.history.pop()
    if (!previous) return false
    this.draft = previous
    this.gesture = null
    this.draw()
    return true
  }

  /** Escape: drop the drawing. */
  cancel() {
    this.reset()
    this.draw()
  }

  private reset() {
    this.draft = EMPTY_DRAFT
    this.history = []
    this.gesture = null
    this.cursor = null
    this.hit = null
    this.callbacks.onGestureEnd?.()
  }

  /** The pointer left the canvas: hide the rubber band. */
  pointerLeave() {
    if (this.gesture) return
    this.cursor = null
    this.hit = null
    this.draw()
  }

  destroy() {
    this.reset()
    this.layer()?.remove()
    this.scope.view.update()
  }

  /* ─── Drawing ─── */

  /** Draw again after the canvas re-rendered (a render clears the project). */
  redraw() {
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
    const center = this.scope.view.center
    const at = (v: Vec) => new this.scope.Point(v.x + center.x, v.y + center.y)
    const blue = new this.scope.Color(SELECTION_COLOR)
    const segs = this.draft.segs
    const put = (item: paper.Item) => {
      item.locked = true
      layer!.addChild(item)
    }

    if (segs.length) {
      // What the shape will be once closed, faintly filled.
      if (canClose(this.draft) || (this.cursor && segs.length >= 2)) {
        const preview = this.cursor ? placePoint(this.draft, this.cursor) : this.draft
        const ghost = new this.scope.CompoundPath({ pathData: editablePathToPathData({ ...preview, closed: true }), insert: false })
        ghost.translate(center)
        ghost.fillColor = new this.scope.Color(this.options.fillColor())
        ghost.fillColor.alpha = 0.14
        put(ghost)
      }

      const line = new this.scope.CompoundPath({ pathData: editablePathToPathData(this.draft), insert: false })
      line.translate(center)
      line.strokeColor = blue
      line.strokeWidth = 1.5 * u
      line.fillColor = null
      put(line)

      // The edge a press would bend, or is bending.
      const bending = this.gesture?.kind === 'bend' ? this.gesture.curveIndex : this.hit?.kind === 'edge' ? this.hit.curveIndex : -1
      if (bending >= 0 && bending < segs.length - 1) {
        const c = draftCurve(this.draft, bending)
        const path = new this.scope.Path({ insert: false })
        path.add(new this.scope.Segment(at(c[0]), new this.scope.Point(0, 0), at(c[1]).subtract(at(c[0]))))
        path.add(new this.scope.Segment(at(c[3]), at(c[2]).subtract(at(c[3])), new this.scope.Point(0, 0)))
        path.strokeColor = blue
        path.strokeWidth = 3 * u
        path.strokeCap = 'round'
        put(path)
      }

      // Rubber band to where the next point would go.
      if (this.cursor && !this.gesture) {
        const last = segs[segs.length - 1].p
        const band = new this.scope.Path.Line({ from: at(last), to: at(this.cursor), insert: false })
        band.strokeColor = blue
        band.strokeWidth = u
        band.dashArray = [4 * u, 3 * u]
        put(band)
      }

      segs.forEach((seg, i) => {
        const first = i === 0
        const closing = first && this.hit?.kind === 'close'
        const size = (closing ? 11 : first ? 8 : 6.5) * u
        const mark = first
          ? new this.scope.Path.Circle({ center: at(seg.p), radius: size / 2, insert: false })
          : new this.scope.Path.Rectangle({ point: at(seg.p).subtract(size / 2), size: [size, size], insert: false })
        mark.fillColor = new this.scope.Color(closing ? SELECTION_COLOR : '#ffffff')
        mark.strokeColor = blue
        mark.strokeWidth = 1.25 * u
        put(mark)
      })
    }

    // Where a press would place a point.
    if (this.cursor && !this.gesture && this.hit?.kind !== 'close') {
      const dot = new this.scope.Path.Circle({ center: at(this.cursor), radius: 3 * u, insert: false })
      dot.fillColor = blue
      put(dot)
    }

    previous?.activate()
    this.scope.view.update()
  }
}
