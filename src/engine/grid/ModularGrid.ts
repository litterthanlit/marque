import type { GridPoint, SeededRandom } from '../types.ts'

export interface ModularGridParams {
  columns: number
  rows: number
  canvasSize: number
  baseRadius: number
  radiusVariation: number
}

/**
 * Generates placement points on a tile/repeat grid.
 */
export function generateModularGrid(
  params: ModularGridParams,
  rng: SeededRandom,
): GridPoint[] {
  const { columns, rows, canvasSize, baseRadius, radiusVariation } = params
  const points: GridPoint[] = []

  const cellW = (canvasSize * 0.8) / columns
  const cellH = (canvasSize * 0.8) / rows
  const startX = -(canvasSize * 0.4)
  const startY = -(canvasSize * 0.4)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cx = startX + cellW * (col + 0.5)
      const cy = startY + cellH * (row + 0.5)

      // Add slight random jitter
      const jitterX = rng.nextFloat(-cellW * 0.1, cellW * 0.1)
      const jitterY = rng.nextFloat(-cellH * 0.1, cellH * 0.1)

      const shapeRadius =
        canvasSize * baseRadius * 0.12 * (1 + rng.nextFloat(-radiusVariation, radiusVariation) * 0.5)

      points.push({
        ring: row,
        angle: (2 * Math.PI * col) / columns,
        x: Math.round((cx + jitterX) * 1000) / 1000,
        y: Math.round((cy + jitterY) * 1000) / 1000,
        ringRadius: Math.round(shapeRadius * 1000) / 1000,
      })
    }
  }

  return points
}
