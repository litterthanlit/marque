import { distance, type Vec } from '../../engine/path/bezier.ts'
import type { Circle } from '../../engine/geometry/asCircle.ts'
import { hud } from '../directEdit/hud.ts'
import { HINT_COLOR } from '../directEdit/overlay.ts'
import { unitsPerCssPixel } from '../viewFit.ts'

/** A circle a band can join: an object `asCircle` reads, or a circle guide on the canvas. */
export interface BandCircle {
  id: string
  circle: Circle
  guide: boolean
}

export interface BandCallbacks {
  /** The circles a band can join now, layer space, the topmost object first and the guides after. */
  circles(): BandCircle[]
  /**
   * The band the tool would make from `a` to `b` (layer space): its outline,
   * and its edges without the parts inside the circles when it has any
   * (null strokes the outline whole). Null when they allow it no fit.
   */
  preview(a: Circle, b: Circle): { outline: string; edges: string | null } | null
  /** A band from circle `a` to circle `b`. */
  onBand(a: string, b: string): void
}

const LAYER_NAME = '__band_tool'
/** How near a circle's rim, in CSS pixels, a press picks it from outside; inside an object's circle always does. */
const RIM_PX = 6
/** How far a press may move, in CSS pixels, and still be a click. */
const CLICK_PX = 6
/** How long the words a tap gives, or a refusal, stay past the pointer leaving, in milliseconds. */
const HOLD_MS = 1200

/**
 * The circle under `p`. An object's circle `p` is inside, the topmost, comes
 * before a neighbour's rim in reach: a press in the middle of a circle picks
 * it. A rim in reach, the nearest, picks its circle otherwise, and a circle
 * guide's always, as a guide has no inside to press.
 */
export function circleAt(circles: readonly BandCircle[], p: Vec, reach: number): BandCircle | null {
  let rim: BandCircle | null = null
  let gap = Infinity
  for (const entry of circles) {
    const off = Math.abs(distance(p, entry.circle.c) - entry.circle.r)
    if (off <= reach && off < gap) {
      rim = entry
      gap = off
    }
  }
  const inside = circles.find((entry) => !entry.guide && distance(p, entry.circle.c) < entry.circle.r) ?? null
  if (!inside || rim?.guide) return rim ?? inside
  return inside
}

/**
 * The Band tool. Every circle a band can join is ringed in the hint colour,
 * just outside its outline. A click on one picks circle a, which stays lit; the band then
 * shows from it to the circle under the pointer, or to a circle of a's size
 * at the pointer while none is under it, and a click on a second circle
 * makes it, one undo step. The tool stays on for the next band. A click off
 * every circle picks nothing and says so, and so does a click on a circle
 * the band has no fit to, which keeps circle a; a click on circle a again,
 * or Escape, lets it go.
 *
 * A touch screen has no hover: a tap picks a, and a tap on another circle
 * makes the band.
 */
export class BandTool {
  private readonly scope: paper.PaperScope
  private readonly callbacks: BandCallbacks
  private picked: BandCircle | null = null
  private hot: BandCircle | null = null
  private pointer: Vec | null = null
  private press: { at: Vec; touch: boolean } | null = null

  constructor(scope: paper.PaperScope, callbacks: BandCallbacks) {
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

  /** The circle picked first, while there is one. */
  get first(): string | null {
    return this.picked?.id ?? null
  }

  onMouseDown(point: paper.Point, touch = false) {
    this.press = { at: this.toLocal(point), touch }
  }

  /** Pointer moves with or without a press: the circle under it lights, and the band shows to it. */
  onMouseDrag(point: paper.Point, touch = false) {
    const p = this.toLocal(point)
    this.pointer = touch ? null : p
    this.hot = touch ? null : circleAt(this.callbacks.circles(), p, this.px(RIM_PX, false))
    this.say()
    this.draw()
  }

  onMouseUp(point: paper.Point) {
    const press = this.press
    this.press = null
    if (!press) return
    const p = this.toLocal(point)
    if (distance(p, press.at) > this.px(CLICK_PX, press.touch)) return
    const target = circleAt(this.callbacks.circles(), p, this.px(RIM_PX, press.touch))
    if (!target) {
      this.tell('pick a circle', press.touch)
      hud.announce(this.picked ? 'Pick a second circle for the band' : 'Pick a circle to start a band')
      return
    }
    if (!this.picked || this.picked.id === target.id) {
      // A click on the circle picked lets it go again.
      this.picked = this.picked ? null : target
      if (this.picked) hud.announce('Circle picked: now pick the circle the band goes to')
    } else if (!this.callbacks.preview(this.picked.circle, target.circle)) {
      // No fit to it: nothing is made, circle a stays, and the words hold past the pointer moving on.
      hud.hold('no fit', HOLD_MS)
      hud.announce('No fit: these circles leave no room for the band. Try another fit, or another circle')
      return
    } else {
      const from = this.picked.id
      this.picked = null
      this.hot = null
      this.callbacks.onBand(from, target.id)
    }
    this.say()
    // A tap has no hover to keep the words by it: they stay a moment past the pointer leaving.
    if (press.touch && this.picked) this.tell('pick a second circle', true)
    this.draw()
  }

  /** Say `label` by the pointer; after a tap, held a moment, as the pointer leaves as the finger lifts. */
  private tell(label: string, touch: boolean) {
    if (touch) hud.hold(label, HOLD_MS)
    else hud.set({ label, chip: null })
  }

  /** What the HUD says by the pointer: where the band goes, or what to pick. */
  private say() {
    if (!this.picked) {
      hud.set({ label: this.hot ? 'start a band here' : null, chip: null })
      return
    }
    if (this.hot && this.hot.id !== this.picked.id) {
      const fits = this.callbacks.preview(this.picked.circle, this.hot.circle) !== null
      hud.set({ label: fits ? 'band to here' : 'no fit', chip: null })
    } else hud.set({ label: 'pick a second circle', chip: null })
  }

  /**
   * The pointer left the canvas: circle a stays picked, and so does the
   * circle last under the pointer while there is one, so the band to it
   * shows as the pill's settings change.
   */
  pointerLeave() {
    if (this.press) return
    if (!this.picked) this.hot = null
    this.pointer = null
    hud.clear()
    this.draw()
  }

  /** The press was interrupted: nothing is made. */
  cancel() {
    this.press = null
  }

  /** Escape: let circle a go. Returns whether one was picked. */
  dismiss(): boolean {
    this.press = null
    if (!this.picked) return false
    this.picked = null
    hud.clear()
    hud.announce('Band dropped')
    this.draw()
    return true
  }

  /** Draw again after the canvas re-rendered or the document changed: a circle picked that is gone is let go. */
  redraw() {
    if (this.picked) {
      const now = this.callbacks.circles().find((entry) => entry.id === this.picked!.id)
      this.picked = now ?? null
    }
    if (this.hot) this.hot = this.callbacks.circles().find((entry) => entry.id === this.hot!.id) ?? null
    this.draw()
  }

  destroy() {
    this.picked = null
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
    const center = { x: this.scope.view.center.x, y: this.scope.view.center.y }
    const colour = (alpha: number) => {
      const color = new this.scope.Color(HINT_COLOR)
      color.alpha = alpha
      return color
    }
    const ring = (circle: Circle, alpha: number, width: number, dash: number[] = [], out = 0) => {
      const item = new this.scope.Path.Circle({ center: [circle.c.x + center.x, circle.c.y + center.y], radius: circle.r + out * u, insert: false })
      item.fillColor = null
      item.strokeColor = colour(alpha)
      item.strokeWidth = width * u
      item.dashArray = dash.map((length) => length * u)
      item.locked = true
      layer!.addChild(item)
    }

    // Every circle a band can join, ringed 2 px wide just outside its outline in the hint colour, so it reads apart
    // from the outline in either look; a circle guide dashed. The one under the pointer and circle a strong.
    const OUT = 2.5
    for (const entry of this.callbacks.circles()) {
      if (entry.id === this.picked?.id || entry.id === this.hot?.id) continue
      ring(entry.circle, 0.55, 2, entry.guide ? [4, 3] : [], OUT)
    }
    if (this.hot && this.hot.id !== this.picked?.id) ring(this.hot.circle, 1, 3, this.hot.guide ? [6, 3] : [], OUT)
    if (this.picked) {
      ring(this.picked.circle, 1, 3, this.picked.guide ? [6, 3] : [], OUT)
      const to = this.hot && this.hot.id !== this.picked.id ? this.hot.circle : this.pointer ? { c: this.pointer, r: this.picked.circle.r } : null
      if (to && !(this.hot && this.hot.id !== this.picked.id)) ring(to, 0.6, 1, [4, 3])
      const band = to ? this.callbacks.preview(this.picked.circle, to) : null
      if (band) {
        // Filled whole; stroked only where it lies outside the circles, as the sheet draws it.
        const fill = new this.scope.CompoundPath({ pathData: band.outline, insert: false })
        const stroke = band.edges !== null ? this.scope.PathItem.create(band.edges) : fill
        for (const item of new Set([fill, stroke])) {
          item.translate(new this.scope.Point(center.x, center.y))
          item.locked = true
          layer.addChild(item)
        }
        fill.fillColor = colour(0.18)
        stroke.strokeColor = colour(1)
        stroke.strokeWidth = 1.5 * u
      }
    }

    previous?.activate()
    this.scope.view.update()
  }
}
