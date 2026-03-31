import type { GenerationResult, ShapeNode } from '../engine/types.ts'
import { createPrimitivePath, type PrimitiveType } from '../engine/primitives/index.ts'

/**
 * Renders the construction overlay: grid circles, radial guides, individual shapes
 */
export function renderConstruction(
  scope: paper.PaperScope,
  result: GenerationResult,
  center: paper.Point,
  showGrid: boolean,
): void {
  scope.activate()

  if (showGrid) {
    // Draw concentric grid circles
    for (const gridLine of result.constructionData.gridLines) {
      const circle = new scope.Path.Circle(
        new scope.Point(center.x + gridLine.cx, center.y + gridLine.cy),
        gridLine.r,
      )
      circle.strokeColor = new scope.Color(0.85, 0.6, 0.6, 0.4)
      circle.strokeWidth = 0.5
      circle.fillColor = null
    }

    // Draw radial guide lines
    const maxR =
      result.constructionData.gridLines[
        result.constructionData.gridLines.length - 1
      ]?.r ?? 100
    const folds = result.constructionData.stats.symmetryFolds
    for (let i = 0; i < folds; i++) {
      const angle = (2 * Math.PI * i) / folds
      const line = new scope.Path.Line(
        center,
        new scope.Point(
          center.x + Math.cos(angle) * maxR,
          center.y + Math.sin(angle) * maxR,
        ),
      )
      line.strokeColor = new scope.Color(0.85, 0.6, 0.6, 0.25)
      line.strokeWidth = 0.5
    }
  }

  // Draw individual shapes
  for (const shape of result.shapes) {
    renderShapeOutline(scope, shape, center)
  }
}

function renderShapeOutline(
  scope: paper.PaperScope,
  shape: ShapeNode,
  center: paper.Point,
): void {
  const pathData = createPrimitivePath(
    shape.type as PrimitiveType,
    center.x + shape.center.x,
    center.y + shape.center.y,
    shape.radius,
    shape.rotation,
    shape.params,
  )

  try {
    const path = new scope.Path(pathData)
    path.strokeWidth = 0.5

    if (shape.operation === 'add') {
      path.strokeColor = new scope.Color(0.3, 0.3, 0.8, 0.3)
      path.fillColor = new scope.Color(0.3, 0.3, 0.8, 0.05)
    } else {
      path.strokeColor = new scope.Color(0.8, 0.3, 0.3, 0.3)
      path.fillColor = new scope.Color(0.8, 0.3, 0.3, 0.05)
    }
  } catch {
    // Skip invalid paths
  }
}
