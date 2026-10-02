/**
 * The canvas always shows the same design area, whatever its size on screen.
 * Generators draw in a 500-unit space; 600 units across leaves room around a
 * mark for handles. Project coordinates never depend on the canvas size (the
 * view centre stays at (300, 300) on a square canvas), so a resize only needs
 * a redraw, and both tabs show a mark at the same size.
 */
export const DESIGN_SPAN = 600

/** Animation applied on top of the fit, about the centre of the canvas. */
export interface ViewMotion {
  /** Degrees. */
  rotation: number
  scale: number
}

export const STILL: ViewMotion = { rotation: 0, scale: 1 }

interface FitState {
  zoom: number
  pixelRatio: number
}

const fits = new WeakMap<paper.PaperScope, FitState>()

/** Device pixel ratio, capped: sharper than 2× costs fill time for little gain. */
export function canvasPixelRatio(): number {
  return Math.min(2, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))
}

/**
 * Size the drawing buffer to the canvas in device pixels (crisp on retina
 * screens) and fit the design area to it.
 */
export function fitView(
  scope: paper.PaperScope,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  motion: ViewMotion = STILL,
): void {
  const view = scope.view
  const width = Math.max(1, Math.round(cssWidth * pixelRatio))
  const height = Math.max(1, Math.round(cssHeight * pixelRatio))
  if (view.viewSize.width !== width || view.viewSize.height !== height) {
    view.viewSize = new scope.Size(width, height)
  }
  const zoom = Math.min(width, height) / DESIGN_SPAN
  const half = new scope.Point(width / 2, height / 2)
  view.matrix = new scope.Matrix()
    .translate(half)
    .rotate(motion.rotation, new scope.Point(0, 0))
    .scale(zoom * motion.scale)
    .translate(half.divide(-zoom))
  fits.set(scope, { zoom, pixelRatio })
}

/** Layer units per CSS pixel: overlays multiply by this to keep a constant size on screen. */
export function unitsPerCssPixel(scope: paper.PaperScope): number {
  const fit = fits.get(scope)
  return fit ? fit.pixelRatio / fit.zoom : 1
}

/** The visible area in layer units (the design area, or more on a non-square canvas). */
export function visibleUnits(cssWidth: number, cssHeight: number): { width: number; height: number } {
  const unit = DESIGN_SPAN / Math.max(1, Math.min(cssWidth, cssHeight))
  return { width: Math.round(cssWidth * unit), height: Math.round(cssHeight * unit) }
}
