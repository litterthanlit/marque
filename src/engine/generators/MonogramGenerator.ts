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
import { getGlyph } from '../monogram/glyphs.ts'

const GRID_COLUMNS = 5
const GRID_ROWS = 7
const CELL_SIZE = 34

export const MonogramGenerator: LogoGenerator = {
  id: 'monogram',
  modeId: 'monogram',
  name: 'Monogram',
  description: 'Interlocked initials built from a deterministic cell skeleton.',
  version: '1.0',
  extraParams: [],
  generate(params: LogoParams, rng: SeededRandom): GenerationResult {
    const initials = (params.brandInput.initials ?? 'MM').slice(0, 3) || 'MM'
    const modeParams = (params.modeParams.monogram ?? {}) as Record<string, number>
    const strokeWeight = modeParams.strokeWeight ?? 1.15
    const contrast = modeParams.contrast ?? 0.45
    const cornerStyle = Math.round(modeParams.cornerStyle ?? 0)
    const interlockStrength = modeParams.interlockStrength ?? 0.45
    const symmetryBias = modeParams.symmetryBias ?? 0.4
    const frameMode = Math.round(modeParams.frameMode ?? 0)

    const shapes: ShapeNode[] = []
    const guideLines: ConstructionLine[] = []
    const addCell = buildCellCollector(initials, interlockStrength, symmetryBias)

    const occupied = new Map<string, { x: number; y: number; role: ShapeNode['role'] }>()

    initials.split('').forEach((letter, index) => {
      const glyph = getGlyph(letter)
      const offset = addCell(index, glyph)
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let column = 0; column < GRID_COLUMNS; column++) {
          if (glyph[row][column] !== '1') continue
          const x = offset.x + column
          const y = offset.y + row
          const key = `${x}:${y}`
          if (!occupied.has(key)) {
            occupied.set(key, {
              x,
              y,
              role: index === 0 ? 'prototype' : 'symmetry-instance',
            })
          }
        }
      }
    })

    const bounds = computeCellBounds(Array.from(occupied.values()))
    const centerOffsetX = -((bounds.minX + bounds.maxX + 1) / 2) * CELL_SIZE
    const centerOffsetY = -((bounds.minY + bounds.maxY + 1) / 2) * CELL_SIZE
    const baseScale = 0.64 + strokeWeight * 0.22

    for (const cell of occupied.values()) {
      const neighbors = getNeighborCount(occupied, cell.x, cell.y)
      const isVertical = neighbors.vertical >= neighbors.horizontal
      const type = cornerStyle === 2 ? 'circle' : cornerStyle === 1 ? 'polygon' : 'rectangle'
      const widthScale =
        type === 'rectangle'
          ? isVertical
            ? 0.62 + contrast * 0.12
            : 0.9 + contrast * 0.24
          : 1
      const heightScale =
        type === 'rectangle'
          ? isVertical
            ? 0.9 + contrast * 0.24
            : 0.62 + contrast * 0.12
          : 1
      shapes.push({
        id: `mono_${cell.x}_${cell.y}`,
        type,
        role: cell.role,
        operation: 'add',
        center: {
          x: centerOffsetX + cell.x * CELL_SIZE + CELL_SIZE / 2,
          y: centerOffsetY + cell.y * CELL_SIZE + CELL_SIZE / 2,
        },
        radius: (CELL_SIZE / 2) * baseScale,
        rotation:
          type === 'polygon' ? Math.PI / 8 : 0,
        params:
          type === 'polygon'
            ? { sides: 8 }
            : { widthScale, heightScale },
      })
    }

    const frameShapes = buildFrameShapes(frameMode, bounds, centerOffsetX, centerOffsetY)
    const allShapes = [...shapes, ...frameShapes]
    const rotatedShapes = applyRotation(allShapes, params.rotation)
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

    const boolResult = composeBooleanResult(booleanInputs)

    for (let column = bounds.minX; column <= bounds.maxX + 1; column++) {
      const x = centerOffsetX + column * CELL_SIZE
      guideLines.push({
        x1: x,
        y1: centerOffsetY + bounds.minY * CELL_SIZE,
        x2: x,
        y2: centerOffsetY + (bounds.maxY + 1) * CELL_SIZE,
        kind: 'grid',
      })
    }

    for (let row = bounds.minY; row <= bounds.maxY + 1; row++) {
      const y = centerOffsetY + row * CELL_SIZE
      guideLines.push({
        x1: centerOffsetX + bounds.minX * CELL_SIZE,
        y1: y,
        x2: centerOffsetX + (bounds.maxX + 1) * CELL_SIZE,
        y2: y,
        kind: 'grid',
      })
    }

    guideLines.push({
      x1: 0,
      y1: centerOffsetY + bounds.minY * CELL_SIZE - CELL_SIZE,
      x2: 0,
      y2: centerOffsetY + (bounds.maxY + 1) * CELL_SIZE + CELL_SIZE,
      kind: 'mirror',
    })

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
        guideLines,
        stats: {
          totalShapes: rotatedShapes.length,
          additiveCount: rotatedShapes.filter((shape) => shape.operation === 'add').length,
          subtractiveCount: rotatedShapes.filter(
            (shape) => shape.operation === 'subtract',
          ).length,
          symmetryFolds: 1,
        },
      },
      warnings: boolResult.warnings,
    }
  },
}

function buildCellCollector(
  initials: string,
  interlockStrength: number,
  symmetryBias: number,
) {
  const glyphWidth = GRID_COLUMNS + 1
  const overlap = Math.round(interlockStrength * 3)
  const spacing = glyphWidth - overlap
  const totalWidth = spacing * (initials.length - 1) + GRID_COLUMNS
  const centeredStart = -Math.floor(totalWidth / 2)

  return (index: number, glyph: string[]) => {
    const yOffset = Math.round((index % 2 === 0 ? -1 : 1) * symmetryBias)
    return {
      x: centeredStart + index * spacing,
      y: -Math.floor(glyph.length / 2) + yOffset,
    }
  }
}

function getNeighborCount(
  occupied: Map<string, { x: number; y: number; role: ShapeNode['role'] }>,
  x: number,
  y: number,
) {
  const vertical = Number(occupied.has(`${x}:${y - 1}`)) + Number(occupied.has(`${x}:${y + 1}`))
  const horizontal =
    Number(occupied.has(`${x - 1}:${y}`)) + Number(occupied.has(`${x + 1}:${y}`))

  return { vertical, horizontal }
}

function computeCellBounds(cells: Array<{ x: number; y: number }>) {
  return cells.reduce(
    (bounds, cell) => ({
      minX: Math.min(bounds.minX, cell.x),
      maxX: Math.max(bounds.maxX, cell.x),
      minY: Math.min(bounds.minY, cell.y),
      maxY: Math.max(bounds.maxY, cell.y),
    }),
    { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  )
}

function buildFrameShapes(
  frameMode: number,
  bounds: ReturnType<typeof computeCellBounds>,
  centerOffsetX: number,
  centerOffsetY: number,
): ShapeNode[] {
  if (frameMode === 0) return []

  const width = (bounds.maxX - bounds.minX + 1) * CELL_SIZE
  const height = (bounds.maxY - bounds.minY + 1) * CELL_SIZE
  const center = {
    x: centerOffsetX + (bounds.minX + bounds.maxX + 1) * (CELL_SIZE / 2),
    y: centerOffsetY + (bounds.minY + bounds.maxY + 1) * (CELL_SIZE / 2),
  }

  if (frameMode === 2) {
    return [
      {
        id: 'monogram_badge_outer',
        type: 'circle',
        role: 'prototype',
        operation: 'add',
        center,
        radius: Math.max(width, height) * 0.42,
        rotation: 0,
        params: {},
      },
      {
        id: 'monogram_badge_inner',
        type: 'circle',
        role: 'prototype',
        operation: 'subtract',
        center,
        radius: Math.max(width, height) * 0.34,
        rotation: 0,
        params: {},
      },
    ]
  }

  return [
    {
      id: 'monogram_frame_outer',
      type: 'rectangle',
      role: 'prototype',
      operation: 'add',
      center,
      radius: Math.max(width, height) * 0.56,
      rotation: 0,
      params: {
        widthScale: width > height ? 1 : width / height,
        heightScale: height > width ? 1 : height / width,
      },
    },
    {
      id: 'monogram_frame_inner',
      type: 'rectangle',
      role: 'prototype',
      operation: 'subtract',
      center,
      radius: Math.max(width, height) * 0.46,
      rotation: 0,
      params: {
        widthScale: width > height ? 1 : width / height,
        heightScale: height > width ? 1 : height / width,
      },
    },
  ]
}

function applyRotation(shapes: ShapeNode[], rotationDegrees: number): ShapeNode[] {
  const globalRotation = (rotationDegrees * Math.PI) / 180
  if (globalRotation === 0) return shapes

  return shapes.map((shape) => {
    const cos = Math.cos(globalRotation)
    const sin = Math.sin(globalRotation)
    return {
      ...shape,
      center: {
        x: Math.round((shape.center.x * cos - shape.center.y * sin) * 1000) / 1000,
        y: Math.round((shape.center.x * sin + shape.center.y * cos) * 1000) / 1000,
      },
      rotation: shape.rotation + globalRotation,
    }
  })
}
