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
    for (const gridLine of result.constructionData.gridCircles) {
      const circle = new scope.Path.Circle(
        new scope.Point(center.x + gridLine.cx, center.y + gridLine.cy),
        gridLine.r,
      )
      circle.strokeColor = new scope.Color(0.85, 0.6, 0.6, 0.4)
      circle.strokeWidth = 0.5
      circle.fillColor = null
    }

    for (const guideLine of result.constructionData.guideLines) {
      const line = new scope.Path.Line(
        new scope.Point(
          center.x + guideLine.x1,
          center.y + guideLine.y1,
        ),
        new scope.Point(
          center.x + guideLine.x2,
          center.y + guideLine.y2,
        ),
      )
      line.strokeWidth = guideLine.kind === 'mirror' ? 0.75 : 0.5
      line.strokeColor =
        guideLine.kind === 'mirror'
          ? new scope.Color(0.18, 0.53, 0.92, 0.38)
          : guideLine.kind === 'frame'
            ? new scope.Color(0.4, 0.4, 0.4, 0.3)
            : new scope.Color(0.85, 0.6, 0.6, 0.22)
      if (guideLine.kind === 'mirror') {
        line.dashArray = [6, 5]
      }
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
    path.strokeWidth = shape.role === 'prototype' ? 0.85 : 0.45
    if (shape.role !== 'prototype') {
      path.dashArray = [4, 3]
    }

    if (shape.operation === 'add') {
      path.strokeColor =
        shape.role === 'prototype'
          ? new scope.Color(0.2, 0.32, 0.85, 0.55)
          : new scope.Color(0.3, 0.3, 0.8, 0.28)
      path.fillColor =
        shape.role === 'prototype'
          ? new scope.Color(0.2, 0.32, 0.85, 0.09)
          : new scope.Color(0.3, 0.3, 0.8, 0.04)
    } else {
      path.strokeColor =
        shape.role === 'prototype'
          ? new scope.Color(0.82, 0.24, 0.24, 0.55)
          : new scope.Color(0.8, 0.3, 0.3, 0.28)
      path.fillColor =
        shape.role === 'prototype'
          ? new scope.Color(0.82, 0.24, 0.24, 0.09)
          : new scope.Color(0.8, 0.3, 0.3, 0.04)
    }
  } catch {
    // Skip invalid paths
  }
}
