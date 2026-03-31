import type { GridPoint, SeededRandom } from '../types.ts'

export interface ConcentricGridParams {
  gridRings: number
  symmetryFolds: number
  canvasSize: number
  baseRadius: number
  radiusVariation: number
}

/**
 * Generates placement points on concentric rings within a single symmetry wedge.
 * The wedge spans [0, 2π / symmetryFolds).
 * Symmetry replication happens separately.
 */
export function generateConcentricGrid(
  params: ConcentricGridParams,
  rng: SeededRandom,
): GridPoint[] {
  const { gridRings, symmetryFolds, canvasSize, baseRadius, radiusVariation } =
    params
  const points: GridPoint[] = []
  const maxRadius = canvasSize * 0.4
  const wedgeAngle = (2 * Math.PI) / symmetryFolds

  for (let ring = 1; ring <= gridRings; ring++) {
    const ringFraction = ring / gridRings
    const ringRadius = maxRadius * ringFraction

    // More shapes on outer rings
    const shapesInWedge = Math.max(1, Math.round(ring * 1.2))

    for (let i = 0; i < shapesInWedge; i++) {
      const angle = rng.nextFloat(0, wedgeAngle)
      const x = Math.cos(angle) * ringRadius
      const y = Math.sin(angle) * ringRadius

      const shapeRadius =
        canvasSize * baseRadius * 0.15 * (1 + radiusVariation * (1 - ringFraction))

      points.push({
        ring,
        angle,
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        ringRadius: Math.round(shapeRadius * 1000) / 1000,
      })
    }
  }

  return points
}
