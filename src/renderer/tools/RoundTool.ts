import { distance, type Vec } from '../../engine/path/bezier.ts'
import type { AttributedCorner } from '../../engine/fillet/corners.ts'
import { cornerSpan, type ResolvedFillet } from '../../engine/fillet/apply.ts'
import { hud } from '../directEdit/hud.ts'
import { HINT_COLOR } from '../directEdit/overlay.ts'
import { radiusAt, radiusReadout } from '../directEdit/filletEdit.ts'
import { unitsPerCssPixel } from '../viewFit.ts'

export interface RoundCallbacks {
  /** The corners of the mark with no fillet on them yet, layer space. */
  corners(): readonly AttributedCorner[]
  /** The fillet a corner would take at `radius`, as the mark would round it; null when the mark cannot be made. */
  preview(corner: AttributedCorner, radius: number): { fillet: ResolvedFillet | null } | null
  /** The radius the tool's options set for new fillets. */
  radius(): number
  /** The radius the last fillet made took, which Alt-click reuses; null before any. */
  lastRadius(): number | null
  /** A dragged radius in whole units, or the same size as another nearby; `same` when it snapped to one. */
  snapRadius(radius: number, touch: boolean, free: boolean): { radius: number; same: boolean }
  /** A fillet of `radius` on a corner. */
  onFillet(corner: AttributedCorner, radius: number): void
}

const LAYER_NAME = '__round_tool'
/** How near a corner the pointer must be, in CSS pixels, to round it (doubled under a finger). */
export const CORNER_PX = 10
/** How far a press may move, in CSS pixels, and still be a click. */
const CLICK_PX = 4
/** How far, in CSS pixels, the preview leads each side on past its touch point. */
const LEAD_PX = 12
/** How far past a fillet's circle, in CSS pixels, the HUD's row is put. */
const HUD_CLEAR_PX = 6
/** How long the words a tap or a refusal gives stay, in milliseconds. */
const HOLD_MS = 1200

/** The corner nearest `p` within `reach`, or null. */
export function cornerAt(corners: readonly AttributedCorner[], p: Vec, reach: number): AttributedCorner | null {
  let best: AttributedCorner | null = null
  for (const corner of corners) {
    const d = distance(corner.p, p)
    if (d <= reach && (!best || d < distance(best.p, p))) best = corner
  }
  return best
}

/**
 * Why a click cannot round a corner, from the fillet the mark would give
 * it: a neighbour's fillet leaves it no room, or no fillet fits it; null
 * when one fits, or when the mark could not be made to tell.
 */
export function refusalOf(preview: { fillet: ResolvedFillet | null } | null): string | null {
  if (!preview) return null
  const fillet = preview.fillet
  if (fillet && !fillet.lost) return null
  return fillet?.lost && fillet.noRoom === 'neighbour' ? 'too close to a neighbour' : 'no fillet fits'
}

/** How far out of its corner a fillet's centre sits per unit of radius, between two straight sides. */
function reachPerRadius(corner: AttributedCorner): number {
  return 1 / Math.max(1e-6, Math.sin(corner.angle / 2))
}

/**
 * The Round tool. A dot marks the corner of the mark nearest the pointer,
 * within 10 px, with the two sides it rounds off as far as the touch points
 * and the fillet's circle at the tool's radius; the HUD gives the radius,
 * and says so when the corner holds less, or why it holds none: a click
 * there rounds nothing.
 * A click rounds the corner (Alt reuses the last radius); a drag from a
 * corner sets the radius by how far the pointer pulls the circle out of
 * it. The tool stays on. A press on a fillet's circle is the editor's: it
 * selects the fillet.
 */
export class RoundTool {
  private readonly scope: paper.PaperScope
  private readonly callbacks: RoundCallbacks
  private hot: AttributedCorner | null = null
  private press: { at: Vec; corner: AttributedCorner | null; alt: boolean; touch: boolean; dragged: boolean } | null = null
  /** The radius a drag from a corner sets, while it does. */
  private dragRadius: number | null = null
  private alt = false

  constructor(scope: paper.PaperScope, callbacks: RoundCallbacks) {
    this.scope = scope
    this.callbacks = callbacks
    this.draw()
  }

  private toLocal(point: paper.Point): Vec {
    const center = this.scope.view.center
    return { x: point.x - center.x, y: point.y - center.y }
  }

  private px(value: number, touch: boolean): number {
    return value * unitsPerCssPixel(this.scope) * (touch ? 2 : 1)
  }

  /** The radius a click would give now: the last one with Alt, else the tool's. */
  private clickRadius(alt: boolean): number {
    return (alt ? this.callbacks.lastRadius() : null) ?? this.callbacks.radius()
  }

  /** How far the corner to round under the pointer is from it, in layer units; null when there is none within reach. */
  cornerDistance(point: paper.Point, touch = false): number | null {
    const at = this.toLocal(point)
    const corner = cornerAt(this.callbacks.corners(), at, this.px(CORNER_PX, touch))
    return corner ? distance(corner.p, at) : null
  }

  onMouseDown(point: paper.Point, mods: { alt: boolean }, touch = false) {
    const at = this.toLocal(point)
    const corner = cornerAt(this.callbacks.corners(), at, this.px(CORNER_PX, touch))
    this.press = { at, corner, alt: mods.alt, touch, dragged: false }
    this.hot = corner
    this.dragRadius = null
    this.draw()
  }

  /**
   * Pointer moves with or without a press: the corner under it lights, with
   * its fillet; a drag from a corner sets the radius. With `yields`, what is
   * under the pointer is the editor's, as a press there would be, and no
   * corner lights.
   */
  onMouseDrag(point: paper.Point, mods: { alt: boolean; noSnap: boolean }, touch = false, yields = false) {
    const p = this.toLocal(point)
    this.alt = mods.alt
    const press = this.press
    if (press?.corner) {
      if (!press.dragged && distance(p, press.at) > this.px(CLICK_PX, press.touch)) press.dragged = true
      if (press.dragged) {
        const corner = press.corner
        const raw = radiusAt(corner.p, corner.bisector, reachPerRadius(corner), p)
        const snapped = this.callbacks.snapRadius(raw, press.touch, mods.noSnap)
        this.dragRadius = snapped.radius
        const preview = this.callbacks.preview(corner, snapped.radius)
        const refusal = refusalOf(preview)
        hud.set({ label: refusal ?? (snapped.same ? 'same size' : null), chip: refusal ? null : radiusReadout(snapped.radius, preview?.fillet) })
        this.placeHud(preview?.fillet ?? null, press.touch)
        this.draw()
      }
      return
    }
    if (press) return
    this.hot = touch || yields ? null : cornerAt(this.callbacks.corners(), p, this.px(CORNER_PX, false))
    this.say()
    this.draw()
  }

  onMouseUp(point: paper.Point) {
    const press = this.press
    this.press = null
    if (!press) return
    const radius = press.dragged ? this.dragRadius : this.clickRadius(press.alt)
    this.dragRadius = null
    if (!press.corner) {
      if (distance(this.toLocal(point), press.at) <= this.px(CLICK_PX, press.touch)) {
        hud.hold('point at a corner', HOLD_MS)
        hud.announce('No corner here: point at a corner of the mark to round it')
      }
      this.draw()
      return
    }
    if (radius === null) return
    const corner = press.corner
    // A corner a neighbour leaves no room, or one no fillet fits, takes none: the HUD says why.
    const refusal = refusalOf(this.callbacks.preview(corner, radius))
    if (refusal) {
      hud.hold(refusal, HOLD_MS)
      hud.announce(`Corner not rounded: ${refusal}`)
      this.draw()
      return
    }
    this.hot = null
    this.callbacks.onFillet(corner, radius)
    hud.announce(`Corner rounded, radius ${radius}`)
    if (press.touch) hud.hold(`r ${radius}`, HOLD_MS)
    this.draw()
  }

  /** What the HUD says by the pointer over a corner: the radius a click gives, and how much of it the corner holds. */
  private say() {
    if (!this.hot) {
      hud.set({ label: null, chip: null })
      return
    }
    const radius = this.clickRadius(this.alt)
    const preview = this.callbacks.preview(this.hot, radius)
    const refusal = refusalOf(preview)
    hud.set({ label: refusal ?? 'round this corner', chip: refusal ? null : radiusReadout(radius, preview?.fillet) })
    this.placeHud(preview?.fillet ?? null, false)
  }

  /**
   * Put the HUD's row clear of the fillet it previews: by the corner of the
   * circle's box the row runs away from, below and to the right (above and
   * to the right under a finger, where the row goes above its point).
   */
  private placeHud(fillet: ResolvedFillet | null, touch: boolean) {
    if (!fillet || fillet.lost) return
    const element = this.scope.view.element as HTMLCanvasElement | null
    if (!element) return
    const reach = fillet.used + HUD_CLEAR_PX * unitsPerCssPixel(this.scope)
    const center = this.scope.view.center
    const at = this.scope.view.projectToView(new this.scope.Point(fillet.centre.x + reach + center.x, fillet.centre.y + (touch ? -reach : reach) + center.y))
    const rect = element.getBoundingClientRect()
    const sx = rect.width / Math.max(1, this.scope.view.viewSize.width)
    const sy = rect.height / Math.max(1, this.scope.view.viewSize.height)
    hud.set({ x: at.x * sx, y: at.y * sy, above: touch })
  }

  pointerLeave() {
    if (this.press) return
    this.hot = null
    hud.clear()
    this.draw()
  }

  /** The press was interrupted: nothing is made. */
  cancel() {
    this.press = null
    this.dragRadius = null
    this.draw()
  }

  /** Escape: nothing to let go of, so the tool goes. */
  dismiss(): boolean {
    this.cancel()
    return false
  }

  /** Draw again after the canvas re-rendered or the document changed: a corner that is gone is let go. */
  redraw() {
    if (this.hot) this.hot = this.callbacks.corners().find((corner) => distance(corner.p, this.hot!.p) < 1e-6) ?? null
    this.draw()
  }

  destroy() {
    this.hot = null
    this.press = null
    hud.clear()
    this.layer()?.remove()
    this.scope.view.update()
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
    const center = new this.scope.Point(this.scope.view.center.x, this.scope.view.center.y)
    const pink = new this.scope.Color(HINT_COLOR)
    const corner = this.press?.corner ?? this.hot
    if (corner) {
      const radius = this.dragRadius ?? this.clickRadius(this.alt)
      const preview = this.callbacks.preview(corner, radius)
      const fillet = preview?.fillet
      if (fillet && !fillet.lost) {
        // What the click changes: the two sides from the corner to their touch points, each led a little way on; and the fillet's circle, dashed at a convex corner, as the sheet draws it.
        const outline = new this.scope.Path({ pathData: cornerSpan(corner, fillet.touches, LEAD_PX * u), insert: false })
        outline.translate(center)
        outline.fillColor = null
        outline.strokeColor = pink
        outline.strokeWidth = 1.5 * u
        outline.locked = true
        layer.addChild(outline)
        const circle = new this.scope.Path.Circle({ center: new this.scope.Point(fillet.centre.x, fillet.centre.y).add(center), radius: fillet.used, insert: false })
        circle.strokeColor = pink
        circle.strokeWidth = u
        circle.dashArray = fillet.convex ? [4 * u, 3 * u] : []
        circle.locked = true
        layer.addChild(circle)
      }
      const dot = new this.scope.Path.Circle({ center: new this.scope.Point(corner.p.x, corner.p.y).add(center), radius: 4 * u, insert: false })
      dot.fillColor = pink
      dot.strokeColor = new this.scope.Color('#ffffff')
      dot.strokeWidth = 1.5 * u
      dot.locked = true
      layer.addChild(dot)
    }
    previous?.activate()
    this.scope.view.update()
  }
}
