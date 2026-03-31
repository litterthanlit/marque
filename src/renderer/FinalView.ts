import type { GenerationResult } from '../engine/types.ts'

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
