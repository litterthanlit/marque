import type { GenerationResult } from '../engine/types.ts'
import type { DissolutionResult } from '../engine/effects/types.ts'
import type { DrawnShape } from '../store/logoStore.ts'
import { renderConstruction } from './ConstructionView.ts'
import { renderFinalMark, renderDissolution } from './FinalView.ts'
import { createPrimitivePath, type PrimitiveType } from '../engine/primitives/index.ts'


interface RenderOptions {
  showGrid: boolean
  showConstruction: boolean
  fillColor: string
  dissolution?: DissolutionResult | null
  drawnShapes?: DrawnShape[]
}

/**
 * Returns the center of the Paper.js view in project coordinates.
 * Using view.center accounts for any CSS/pixel scaling Paper.js applies.
 */
function getCenter(scope: paper.PaperScope): paper.Point {
  return scope.view.center
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

  const center = getCenter(scope)

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

  // Draw user-placed shapes on top
  if (options.drawnShapes && options.drawnShapes.length > 0) {
    renderDrawnShapes(scope, options.drawnShapes, center, options.fillColor)
  }

  scope.view.update()
}

/**
 * Renders user-drawn shapes overlaid on the logo
 */
function renderDrawnShapes(
  scope: paper.PaperScope,
  shapes: DrawnShape[],
  center: paper.Point,
  fillColor: string,
): void {
  for (const shape of shapes) {
    const pathData = createPrimitivePath(
      shape.type as PrimitiveType,
      shape.x,
      shape.y,
      shape.radius,
      0,
      shape.type === 'polygon' ? { sides: 5 } : {},
    )

    try {
      const path = new scope.Path(pathData)
      path.translate(center)

      if (shape.operation === 'add') {
        path.fillColor = new scope.Color(fillColor)
        path.strokeColor = null
      } else {
        path.fillColor = new scope.Color(1, 1, 1)
        path.strokeColor = new scope.Color(0.8, 0.2, 0.2, 0.5)
        path.strokeWidth = 1
      }
    } catch {
      // Skip invalid paths
    }
  }
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

  const center = getCenter(scope)

  renderFinalMark(scope, result, center, fillColor)

  scope.view.update()
}
