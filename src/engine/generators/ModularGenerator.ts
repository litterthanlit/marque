import type {
  LogoGenerator,
  LogoParams,
  SeededRandom,
  GenerationResult,
  ShapeNode,
  ParamDefinition,
} from '../types.ts'
import { generateModularGrid } from '../grid/ModularGrid.ts'
import { pickPrimitiveType, createPrimitivePath, type PrimitiveType } from '../primitives/index.ts'
import { createBlobParams } from '../primitives/blob.ts'
import { composeBooleanResult } from '../boolean/operations.ts'
import { generateModularKeyframes } from '../animation/keyframes.ts'

const CANVAS_SIZE = 500
const MAX_SHAPES = 256

export const ModularGenerator: LogoGenerator = {
  id: 'modular',
  modeId: 'modular',
  name: 'Modular Grid',
  description: 'Tile/repeat grid patterns with optional circular clipping',
  version: '1.0',
  extraParams: [
    { key: 'columns', label: 'Columns', min: 2, max: 8, step: 1, default: 4 },
    { key: 'rows', label: 'Rows', min: 2, max: 8, step: 1, default: 4 },
    { key: 'circleClip', label: 'Circle Clip', min: 0, max: 1, step: 1, default: 1 },
  ] satisfies ParamDefinition[],
  getAnimationKeyframes: generateModularKeyframes,

  generate(params: LogoParams, rng: SeededRandom): GenerationResult {
    const modularParams = (params.modeParams.modular ?? {}) as Record<string, number>
    const columns = modularParams.columns ?? 4
    const rows = modularParams.rows ?? 4
    const useClip = (modularParams.circleClip ?? 1) > 0.5

    const gridPoints = generateModularGrid(
      {
        columns,
        rows,
        canvasSize: CANVAS_SIZE,
        baseRadius: params.baseRadius,
        radiusVariation: params.radiusVariation,
      },
      rng,
    )

    const allShapes: ShapeNode[] = gridPoints.map((point, i) => {
      const type = pickPrimitiveType(rng, params.enabledShapes)
      const operation: 'add' | 'subtract' = rng.nextBool(params.additiveRatio)
        ? 'add'
        : 'subtract'
      const shapeRotation = rng.nextFloat(0, Math.PI * 2)

      const shapeParams: Record<string, number> =
        type === 'polygon'
          ? { sides: rng.nextInt(3, 6) }
          : type === 'blob'
            ? createBlobParams(rng)
            : {}

      return {
        id: `mod_${i}`,
        type,
        role: 'prototype' as const,
        operation,
        center: { x: point.x, y: point.y },
        radius: point.ringRadius,
        rotation: shapeRotation,
        params: shapeParams,
      }
    })

    const warnings: string[] = []
    const boundedShapes = allShapes.slice(0, MAX_SHAPES)
    if (allShapes.length > MAX_SHAPES) {
      warnings.push(
        `Shape count capped at ${MAX_SHAPES} to keep generation responsive`,
      )
    }

    // Apply global rotation
    const globalRotation = (params.rotation * Math.PI) / 180
    const rotatedShapes: ShapeNode[] =
      globalRotation === 0
        ? boundedShapes
        : boundedShapes.map((shape) => {
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

    // Build path data
    const booleanInputs = rotatedShapes.map((shape) => {
      const pathData = createPrimitivePath(
        shape.type as PrimitiveType,
        shape.center.x,
        shape.center.y,
        shape.radius,
        shape.rotation,
        shape.params,
        rng,
      )
      shape.pathData = pathData
      return { pathData, operation: shape.operation }
    })

    // If circle clip, add a large circle as the first additive shape
    if (useClip) {
      const clipRadius = CANVAS_SIZE * 0.38
      const clipPath = `M ${-clipRadius} 0 A ${clipRadius} ${clipRadius} 0 1 0 ${clipRadius} 0 A ${clipRadius} ${clipRadius} 0 1 0 ${-clipRadius} 0 Z`
      booleanInputs.unshift({ pathData: clipPath, operation: 'add' })
    }

    const boolResult = composeBooleanResult(booleanInputs)

    const addCount = rotatedShapes.filter((s) => s.operation === 'add').length
    const subCount = rotatedShapes.filter((s) => s.operation === 'subtract').length

    return {
      shapes: rotatedShapes,
      mark: {
        layers: boolResult.layers,
        compoundPathData: boolResult.compoundPathData,
        fillRule: boolResult.fillRule as 'nonzero' | 'evenodd',
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridCircles: [],
        guideLines: buildGridGuideLines(columns, rows, CANVAS_SIZE),
        stats: {
          totalShapes: rotatedShapes.length,
          additiveCount: addCount,
          subtractiveCount: subCount,
          symmetryFolds: 1,
        },
      },
      warnings: [...warnings, ...boolResult.warnings],
    }
  },
}

function buildGridGuideLines(
  columns: number,
  rows: number,
  canvasSize: number,
): GenerationResult['constructionData']['guideLines'] {
  const width = canvasSize * 0.72
  const height = canvasSize * 0.72
  const cellWidth = width / columns
  const cellHeight = height / rows
  const left = -width / 2
  const top = -height / 2
  const lines: GenerationResult['constructionData']['guideLines'] = []

  for (let column = 0; column <= columns; column++) {
    const x = Math.round((left + cellWidth * column) * 100) / 100
    lines.push({
      x1: x,
      y1: top,
      x2: x,
      y2: top + height,
      kind: 'grid',
    })
  }

  for (let row = 0; row <= rows; row++) {
    const y = Math.round((top + cellHeight * row) * 100) / 100
    lines.push({
      x1: left,
      y1: y,
      x2: left + width,
      y2: y,
      kind: 'grid',
    })
  }

  return lines
}
