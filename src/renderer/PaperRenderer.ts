import type { GenerationResult } from '../engine/types.ts'
import type { DissolutionResult } from '../engine/effects/types.ts'
import { renderConstruction } from './ConstructionView.ts'
import { renderFinalMark, renderDissolution } from './FinalView.ts'

interface RenderOptions {
  showGrid: boolean
  showConstruction: boolean
  fillColor: string
  dissolution?: DissolutionResult | null
}

/**
 * Renders the full construction + final mark on a Paper.js scope
 */
export function renderLogoOnScope(
  scope: paper.PaperScope,
  result: GenerationResult,
  options: RenderOptions,
): void {
  scope.activate()
  scope.project.clear()

  const canvasSize = scope.view.size
  const center = new scope.Point(canvasSize.width / 2, canvasSize.height / 2)

  // Draw construction view first (behind the mark)
  if (options.showConstruction) {
    renderConstruction(scope, result, center, options.showGrid)
  }

  // Draw the composed mark — use dissolution if active
  if (options.dissolution) {
    renderDissolution(scope, options.dissolution, center, options.fillColor)
  } else {
    renderFinalMark(scope, result, center, options.fillColor)
  }

  scope.view.update()
}

/**
 * Renders only the final mark on a scope (for preview)
 */
export function renderPreviewOnScope(
  scope: paper.PaperScope,
  result: GenerationResult,
  fillColor: string,
): void {
  scope.activate()
  scope.project.clear()

  const canvasSize = scope.view.size
  const center = new scope.Point(canvasSize.width / 2, canvasSize.height / 2)

  renderFinalMark(scope, result, center, fillColor)

  scope.view.update()
}
