import type { CarveTool as CarveToolKind, CutSpec, PunchShape, Vec } from '../../engine/carve/geometry.ts'
import { cutPathData, isMeaningfulCut } from '../../engine/carve/geometry.ts'

interface CarveCallbacks {
  /** A finished cut, in layer space (centred on 0,0). */
  onCut: (spec: CutSpec) => void
  /** The cut being dragged right now, or null when it ends — for live ink preview. */
  onPreview: (spec: CutSpec | null) => void
}

interface CarveOptions {
  kind: CarveToolKind
  punchShape: PunchShape
  cutWidth: number
}

// A click without a drag stamps a punch of this radius.
const DEFAULT_PUNCH_RADIUS = 36
const PREVIEW_COLOR = '#3b82f6'

/**
 * Punch, Channel and Slice. Press to start, drag to size, release to cut.
 * Hold Shift while dragging a channel or slice to lock its angle to 15° steps.
 */
export class CarveTool {
  private scope: paper.PaperScope
  private callbacks: CarveCallbacks
  private options: CarveOptions
  private start: Vec | null = null
  private spec: CutSpec | null = null
  private outline: paper.Item | null = null
  private shift = false
  private readonly onKey = (e: KeyboardEvent) => { this.shift = e.shiftKey }

  constructor(scope: paper.PaperScope, callbacks: CarveCallbacks, options: CarveOptions) {
    this.scope = scope
    this.callbacks = callbacks
    this.options = options
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
  }

  private toLocal(point: paper.Point): Vec {
    const center = this.scope.view.center
    return { x: Math.round(point.x - center.x), y: Math.round(point.y - center.y) }
  }

  private specFor(start: Vec, current: Vec): CutSpec {
    if (this.options.kind === 'punch') {
      return {
        kind: 'punch',
        shape: this.options.punchShape,
        center: start,
        radius: Math.round(Math.hypot(current.x - start.x, current.y - start.y)),
      }
    }
    let end = current
    if (this.shift) {
      const length = Math.hypot(current.x - start.x, current.y - start.y)
      const angle = Math.round(Math.atan2(current.y - start.y, current.x - start.x) / (Math.PI / 12)) * (Math.PI / 12)
      end = { x: Math.round(start.x + Math.cos(angle) * length), y: Math.round(start.y + Math.sin(angle) * length) }
    }
    return { kind: this.options.kind, from: start, to: end, width: this.options.cutWidth }
  }

  onMouseDown(point: paper.Point) {
    this.start = this.toLocal(point)
    this.update(this.start)
  }

  onMouseDrag(point: paper.Point) {
    // The canvas routes plain pointer moves here too; only act while pressed.
    if (!this.start) return
    this.update(this.toLocal(point))
  }

  onMouseUp(point: paper.Point) {
    if (!this.start) return
    let spec = this.specFor(this.start, this.toLocal(point))
    if (spec.kind === 'punch' && !isMeaningfulCut(spec)) spec = { ...spec, radius: DEFAULT_PUNCH_RADIUS }
    this.reset()
    this.callbacks.onPreview(null)
    if (isMeaningfulCut(spec)) this.callbacks.onCut(spec)
  }

  private update(current: Vec) {
    if (!this.start) return
    this.spec = this.specFor(this.start, current)
    const meaningful = isMeaningfulCut(this.spec)
    this.callbacks.onPreview(meaningful ? this.spec : null)
    this.drawOutline(meaningful ? cutPathData(this.spec) : '')
  }

  private drawOutline(pathData: string) {
    // cutPathData runs in a headless scope; draw back into ours.
    this.scope.activate()
    this.outline?.remove()
    this.outline = null
    if (pathData) {
      const outline = new this.scope.CompoundPath(pathData)
      outline.translate(this.scope.view.center)
      outline.fillColor = null
      outline.strokeColor = new this.scope.Color(PREVIEW_COLOR)
      outline.strokeWidth = 1.25
      outline.locked = true
      this.outline = outline
    }
    this.scope.view.update()
  }

  private reset() {
    this.start = null
    this.spec = null
    this.outline?.remove()
    this.outline = null
  }

  cancel() {
    if (this.start) this.callbacks.onPreview(null)
    this.reset()
    this.scope.view.update()
  }

  destroy() {
    this.cancel()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
  }
}
