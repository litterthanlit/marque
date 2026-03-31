import type {
  LogoGenerator,
  LogoParams,
  SeededRandom,
  GenerationResult,
  ShapeNode,
} from '../types.ts'
import { generateConcentricGrid } from '../grid/ConcentricGrid.ts'
import { pickPrimitiveType, createPrimitivePath, type PrimitiveType } from '../primitives/index.ts'
import { applyRadialSymmetry } from '../symmetry/radial.ts'
import { composeBooleanResult } from '../boolean/operations.ts'

const CANVAS_SIZE = 500

export const GeometricRadialGenerator: LogoGenerator = {
  id: 'geometric-radial',
  name: 'Geometric Radial',
  description:
    'Concentric grid with N-fold radial symmetry and boolean composition',
  version: '1.0',
  extraParams: [],

  generate(params: LogoParams, rng: SeededRandom): GenerationResult {
    const gridPoints = generateConcentricGrid(
      {
        gridRings: params.gridRings,
        symmetryFolds: params.symmetryFolds,
        canvasSize: CANVAS_SIZE,
        baseRadius: params.baseRadius,
        radiusVariation: params.radiusVariation,
      },
      rng,
    )

    // Create prototype shapes (single wedge)
    const prototypes: ShapeNode[] = gridPoints.map((point, i) => {
      const type = pickPrimitiveType(rng)
      const operation: 'add' | 'subtract' = rng.nextBool(params.additiveRatio)
        ? 'add'
        : 'subtract'
      const shapeRotation = rng.nextFloat(0, Math.PI * 2)

      const shapeParams: Record<string, number> =
        type === 'polygon' ? { sides: rng.nextInt(4, 7) } : {}

      return {
        id: `shape_${i}`,
        type,
        role: 'prototype' as const,
        operation,
        center: { x: point.x, y: point.y },
        radius: point.ringRadius,
        rotation: shapeRotation,
        params: shapeParams,
      }
    })

    // Apply symmetry
    const allShapes = applyRadialSymmetry(prototypes, params.symmetryFolds)

    // Apply global rotation
    const globalRotation = (params.rotation * Math.PI) / 180
    const rotatedShapes: ShapeNode[] =
      globalRotation === 0
        ? allShapes
        : allShapes.map((shape) => {
            const cos = Math.cos(globalRotation)
            const sin = Math.sin(globalRotation)
            const x = shape.center.x * cos - shape.center.y * sin
            const y = shape.center.x * sin + shape.center.y * cos
            return {
              ...shape,
              center: {
                x: Math.round(x * 1000) / 1000,
                y: Math.round(y * 1000) / 1000,
              },
              rotation: shape.rotation + globalRotation,
            }
          })

    // Build path data for each shape
    const booleanInputs = rotatedShapes.map((shape) => ({
      pathData: createPrimitivePath(
        shape.type as PrimitiveType,
        shape.center.x,
        shape.center.y,
        shape.radius,
        shape.rotation,
        shape.params,
        rng,
      ),
      operation: shape.operation,
    }))

    // Compose boolean result
    const boolResult = composeBooleanResult(booleanInputs)

    // Build construction data
    const gridLines = Array.from({ length: params.gridRings }, (_, i) => {
      const ring = i + 1
      const ringRadius = (CANVAS_SIZE * 0.4 * ring) / params.gridRings
      return { cx: 0, cy: 0, r: Math.round(ringRadius * 100) / 100 }
    })

    const addCount = rotatedShapes.filter((s) => s.operation === 'add').length
    const subCount = rotatedShapes.filter(
      (s) => s.operation === 'subtract',
    ).length

    return {
      shapes: rotatedShapes,
      mark: {
        layers: [],
        compoundPathData: boolResult.compoundPathData,
        fillRule: boolResult.fillRule as 'nonzero' | 'evenodd',
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridLines,
        stats: {
          totalShapes: rotatedShapes.length,
          additiveCount: addCount,
          subtractiveCount: subCount,
          symmetryFolds: params.symmetryFolds,
        },
      },
      warnings: boolResult.warnings,
    }
  },
}
