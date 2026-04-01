import type { GenerationResult } from '../engine/types.ts'
import type { DissolutionResult } from '../engine/effects/types.ts'

/**
 * Centers a path/compound path on the canvas by aligning its bounds center
 * with the canvas center. The engine generates shapes in a 500x500 coordinate
 * space centered at (250, 250), so we translate by the delta to canvas center.
 */
function centerOnCanvas(item: paper.Item, canvasCenter: paper.Point): void {
  const bounds = item.bounds
  const delta = canvasCenter.subtract(bounds.center)
  item.translate(delta)
}

/**
 * Renders the final composed logo mark
 */
export function renderFinalMark(
  scope: paper.PaperScope,
  result: GenerationResult,
  center: paper.Point,
  fillColor: string,
): void {
  scope.activate()

  if (!result.mark.compoundPathData) return

  try {
    const path = new scope.CompoundPath(result.mark.compoundPathData)
    centerOnCanvas(path, center)
    path.fillColor = new scope.Color(fillColor)
    path.fillRule = result.mark.fillRule
    path.strokeColor = null
  } catch {
    // Fallback: try as simple path
    try {
      const path = new scope.Path(result.mark.compoundPathData)
      centerOnCanvas(path, center)
      path.fillColor = new scope.Color(fillColor)
      path.strokeColor = null
    } catch {
      // Give up
    }
  }
}

export function renderDissolution(
  scope: paper.PaperScope,
  dissolution: DissolutionResult,
  center: paper.Point,
  fillColor: string,
): void {
  scope.activate()

  // Render solid core if present
  if (dissolution.solidCorePath) {
    try {
      const corePath = new scope.CompoundPath(dissolution.solidCorePath)
      centerOnCanvas(corePath, center)
      corePath.fillColor = new scope.Color(fillColor)
      corePath.fillRule = 'evenodd'
      corePath.strokeColor = null
    } catch {
      // Ignore invalid core path
    }
  }

  // Render particles
  if (dissolution.particlePathData) {
    try {
      const particles = new scope.CompoundPath(dissolution.particlePathData)
      centerOnCanvas(particles, center)
      particles.fillColor = new scope.Color(fillColor)
      particles.strokeColor = null
    } catch {
      // Ignore invalid particle path
    }
  }
}
