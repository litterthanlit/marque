import type { GenerationResult } from '../engine/types.ts'
import type { DissolutionResult } from '../engine/effects/types.ts'

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

    // Translate to center
    path.translate(center)

    // Parse fill color
    path.fillColor = new scope.Color(fillColor)
    path.fillRule = result.mark.fillRule
    path.strokeColor = null
  } catch {
    // Fallback: try as simple path
    try {
      const path = new scope.Path(result.mark.compoundPathData)
      path.translate(center)
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
      corePath.translate(center)
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
      particles.translate(center)
      particles.fillColor = new scope.Color(fillColor)
      particles.strokeColor = null
    } catch {
      // Ignore invalid particle path
    }
  }
}
