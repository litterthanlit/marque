import type {
  ConstructionLine,
  GenerationResult,
  LogoGenerator,
  LogoParams,
  ShapeNode,
  SeededRandom,
} from '../types.ts'
import { composeBooleanResult } from '../boolean/operations.ts'
import { createPrimitivePath, type PrimitiveType } from '../primitives/index.ts'

const CANVAS_SIZE = 500
const GRID_SPAN = CANVAS_SIZE * 0.7

export const GridSystemGenerator: LogoGenerator = {
  id: 'grid-system',
  modeId: 'grid-system',
  name: 'Grid System',
  description: 'Structured grid logos with mirrored cells, corridors, and optional framing.',
  version: '1.0',
  extraParams: [],
  generate(params: LogoParams, rng: SeededRandom): GenerationResult {
    const modeParams = (params.modeParams['grid-system'] ?? {}) as Record<string, number>
    const columns = Math.round(modeParams.columns ?? 6)
    const rows = Math.round(modeParams.rows ?? 6)
    const density = modeParams.density ?? 0.55
    const cellInset = modeParams.cellInset ?? 0.12
    const strokeBias = modeParams.strokeBias ?? 0.5
    const mirrorX = (modeParams.mirrorX ?? 1) > 0.5
    const mirrorY = (modeParams.mirrorY ?? 0) > 0.5
    const frameMode = Math.round(modeParams.frameMode ?? 1)

    const grid = createGrid(columns, rows)
    seedCells(grid, columns, rows, density, strokeBias, mirrorX, mirrorY, rng)
    ensureActiveCenter(grid, columns, rows)
    carveCuts(grid, columns, rows, 1 - params.additiveRatio, mirrorX, mirrorY, rng)

    const cellSize = GRID_SPAN / Math.max(columns, rows)
    const left = -(columns * cellSize) / 2
    const top = -(rows * cellSize) / 2
    const shapes: ShapeNode[] = []

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const cell = grid[row][column]
        if (!cell.active && !cell.cut) continue

        const kind = cell.cut ? 'subtract' : 'add'
        shapes.push({
          id: `grid_${row}_${column}_${kind}`,
          type: cell.cut ? 'circle' : 'rectangle',
          role: cell.role,
          operation: cell.cut ? 'subtract' : 'add',
          center: {
            x: left + column * cellSize + cellSize / 2,
            y: top + row * cellSize + cellSize / 2,
          },
          radius: (cellSize / 2) * (cell.cut ? 0.52 : 1 - cellInset),
          rotation: 0,
          params: cell.cut
            ? {}
            : {
                widthScale: 1 - cellInset,
                heightScale: 1 - cellInset,
              },
        })
      }
    }

    const framedShapes = [...shapes, ...buildGridFrame(frameMode, columns, rows, cellSize)]
    const rotatedShapes = applyRotation(framedShapes, params.rotation)

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

    const boolResult = composeBooleanResult(booleanInputs)

    return {
      shapes: rotatedShapes,
      mark: {
        layers: boolResult.layers,
        compoundPathData: boolResult.compoundPathData,
        fillRule: boolResult.fillRule,
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridCircles: [],
        guideLines: buildGuideLines(columns, rows, cellSize, mirrorX, mirrorY, frameMode),
        stats: {
          totalShapes: rotatedShapes.length,
          additiveCount: rotatedShapes.filter((shape) => shape.operation === 'add').length,
          subtractiveCount: rotatedShapes.filter(
            (shape) => shape.operation === 'subtract',
          ).length,
          symmetryFolds: mirrorX && mirrorY ? 4 : mirrorX || mirrorY ? 2 : 1,
        },
      },
      warnings: boolResult.warnings,
    }
  },
}

type GridCell = {
  active: boolean
  cut: boolean
  role: ShapeNode['role']
}

function createGrid(columns: number, rows: number): GridCell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({
      active: false,
      cut: false,
      role: 'prototype' as const,
    })),
  )
}

function seedCells(
  grid: GridCell[][],
  columns: number,
  rows: number,
  density: number,
  strokeBias: number,
  mirrorX: boolean,
  mirrorY: boolean,
  rng: SeededRandom,
) {
  const maxRow = mirrorY ? Math.ceil(rows / 2) : rows
  const maxColumn = mirrorX ? Math.ceil(columns / 2) : columns

  for (let row = 0; row < maxRow; row++) {
    for (let column = 0; column < maxColumn; column++) {
      const centerBias =
        1 -
        (Math.abs(column - (columns - 1) / 2) + Math.abs(row - (rows - 1) / 2)) /
          (columns + rows)
      const activeChance = clamp(density + centerBias * 0.22 + rng.nextFloat(-0.12, 0.12), 0.1, 0.92)
      const active = rng.nextBool(activeChance)
      if (!active) continue

      paintCell(grid, row, column, 'prototype', mirrorX, mirrorY)

      const corridorChance = clamp(strokeBias + centerBias * 0.2, 0.1, 0.95)
      if (!rng.nextBool(corridorChance)) continue

      const horizontal = rng.nextBool(0.5)
      const length = rng.nextInt(1, 2)
      for (let step = 1; step <= length; step++) {
        const targetRow = horizontal ? row : row + step
        const targetColumn = horizontal ? column + step : column
        if (targetRow >= rows || targetColumn >= columns) break
        paintCell(grid, targetRow, targetColumn, 'prototype', mirrorX, mirrorY)
      }
    }
  }
}

function carveCuts(
  grid: GridCell[][],
  columns: number,
  rows: number,
  cutBias: number,
  mirrorX: boolean,
  mirrorY: boolean,
  rng: SeededRandom,
) {
  const maxRow = mirrorY ? Math.ceil(rows / 2) : rows
  const maxColumn = mirrorX ? Math.ceil(columns / 2) : columns

  for (let row = 1; row < maxRow - 1; row++) {
    for (let column = 1; column < maxColumn - 1; column++) {
      if (!grid[row][column].active) continue
      if (!rng.nextBool(clamp(cutBias * 0.42, 0.04, 0.22))) continue
      paintCut(grid, row, column, mirrorX, mirrorY)
    }
  }
}

function ensureActiveCenter(grid: GridCell[][], columns: number, rows: number) {
  const hasActive = grid.some((row) => row.some((cell) => cell.active))
  if (hasActive) return
  const centerRow = Math.floor(rows / 2)
  const centerColumn = Math.floor(columns / 2)
  grid[centerRow][centerColumn] = {
    active: true,
    cut: false,
    role: 'prototype',
  }
}

function paintCell(
  grid: GridCell[][],
  row: number,
  column: number,
  role: ShapeNode['role'],
  mirrorX: boolean,
  mirrorY: boolean,
) {
  for (const [targetRow, targetColumn, targetRole] of mirroredCoordinates(
    row,
    column,
    grid[0].length,
    grid.length,
    role,
    mirrorX,
    mirrorY,
  )) {
    grid[targetRow][targetColumn] = {
      active: true,
      cut: false,
      role: targetRole,
    }
  }
}

function paintCut(
  grid: GridCell[][],
  row: number,
  column: number,
  mirrorX: boolean,
  mirrorY: boolean,
) {
  for (const [targetRow, targetColumn, targetRole] of mirroredCoordinates(
    row,
    column,
    grid[0].length,
    grid.length,
    'prototype',
    mirrorX,
    mirrorY,
  )) {
    if (!grid[targetRow][targetColumn].active) continue
    grid[targetRow][targetColumn] = {
      active: false,
      cut: true,
      role: targetRole,
    }
  }
}

function mirroredCoordinates(
  row: number,
  column: number,
  columns: number,
  rows: number,
  sourceRole: ShapeNode['role'],
  mirrorX: boolean,
  mirrorY: boolean,
): Array<[number, number, ShapeNode['role']]> {
  const coordinates: Array<[number, number, ShapeNode['role']]> = [[row, column, sourceRole]]
  const mirroredColumns = mirrorX ? [column, columns - 1 - column] : [column]
  const mirroredRows = mirrorY ? [row, rows - 1 - row] : [row]

  for (const targetRow of mirroredRows) {
    for (const targetColumn of mirroredColumns) {
      const exists = coordinates.some(([existingRow, existingColumn]) => (
        existingRow === targetRow && existingColumn === targetColumn
      ))
      if (!exists) {
        coordinates.push([targetRow, targetColumn, 'symmetry-instance'])
      }
    }
  }

  return coordinates
}

function buildGridFrame(
  frameMode: number,
  columns: number,
  rows: number,
  cellSize: number,
): ShapeNode[] {
  if (frameMode === 0) return []

  const width = columns * cellSize
  const height = rows * cellSize
  const radius = Math.max(width, height) / 2

  if (frameMode === 2) {
    return [
      {
        id: 'grid_badge_outer',
        type: 'circle',
        role: 'prototype',
        operation: 'add',
        center: { x: 0, y: 0 },
        radius: radius * 1.08,
        rotation: 0,
        params: {},
      },
      {
        id: 'grid_badge_inner',
        type: 'circle',
        role: 'prototype',
        operation: 'subtract',
        center: { x: 0, y: 0 },
        radius: radius * 0.92,
        rotation: 0,
        params: {},
      },
    ]
  }

  return [
    {
      id: 'grid_frame_outer',
      type: 'rectangle',
      role: 'prototype',
      operation: 'add',
      center: { x: 0, y: 0 },
      radius: radius * 1.1,
      rotation: 0,
      params: {
        widthScale: width > height ? 1 : width / height,
        heightScale: height > width ? 1 : height / width,
      },
    },
    {
      id: 'grid_frame_inner',
      type: 'rectangle',
      role: 'prototype',
      operation: 'subtract',
      center: { x: 0, y: 0 },
      radius: radius * 0.92,
      rotation: 0,
      params: {
        widthScale: width > height ? 1 : width / height,
        heightScale: height > width ? 1 : height / width,
      },
    },
  ]
}

function buildGuideLines(
  columns: number,
  rows: number,
  cellSize: number,
  mirrorX: boolean,
  mirrorY: boolean,
  frameMode: number,
): ConstructionLine[] {
  const lines: ConstructionLine[] = []
  const left = -(columns * cellSize) / 2
  const top = -(rows * cellSize) / 2
  const width = columns * cellSize
  const height = rows * cellSize

  for (let column = 0; column <= columns; column++) {
    const x = left + column * cellSize
    lines.push({ x1: x, y1: top, x2: x, y2: top + height, kind: 'grid' })
  }

  for (let row = 0; row <= rows; row++) {
    const y = top + row * cellSize
    lines.push({ x1: left, y1: y, x2: left + width, y2: y, kind: 'grid' })
  }

  if (mirrorX) {
    lines.push({ x1: 0, y1: top - cellSize, x2: 0, y2: top + height + cellSize, kind: 'mirror' })
  }

  if (mirrorY) {
    lines.push({ x1: left - cellSize, y1: 0, x2: left + width + cellSize, y2: 0, kind: 'mirror' })
  }

  if (frameMode !== 0) {
    lines.push(
      { x1: left, y1: top, x2: left + width, y2: top, kind: 'frame' },
      { x1: left + width, y1: top, x2: left + width, y2: top + height, kind: 'frame' },
      { x1: left + width, y1: top + height, x2: left, y2: top + height, kind: 'frame' },
      { x1: left, y1: top + height, x2: left, y2: top, kind: 'frame' },
    )
  }

  return lines
}

function applyRotation(shapes: ShapeNode[], rotationDegrees: number): ShapeNode[] {
  const rotation = (rotationDegrees * Math.PI) / 180
  if (rotation === 0) return shapes

  return shapes.map((shape) => {
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return {
      ...shape,
      center: {
        x: Math.round((shape.center.x * cos - shape.center.y * sin) * 1000) / 1000,
        y: Math.round((shape.center.x * sin + shape.center.y * cos) * 1000) / 1000,
      },
      rotation: shape.rotation + rotation,
    }
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
