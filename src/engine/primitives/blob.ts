import type { SeededRandom } from '../types.ts'

/**
 * Organic blob shape: N radial sample points displaced by seeded noise,
 * connected with smooth cubic Bezier curves.
 */
export function blobPath(
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  rng: SeededRandom,
  pointCount = 8,
  noiseAmount = 0.4,
): string {
  const points: { x: number; y: number }[] = []

  for (let i = 0; i < pointCount; i++) {
    const angle = rotation + (2 * Math.PI * i) / pointCount
    const displacement = 1 + (rng.nextFloat(-noiseAmount, noiseAmount))
    const r = radius * displacement
    points.push({
      x: Math.round((cx + r * Math.cos(angle)) * 1000) / 1000,
      y: Math.round((cy + r * Math.sin(angle)) * 1000) / 1000,
    })
  }

  // Closed smooth cubic Bezier through points (Catmull-Rom -> Bezier)
  return smoothClosedPath(points)
}

function smoothClosedPath(points: { x: number; y: number }[]): string {
  const n = points.length
  if (n < 3) return ''

  const tension = 0.3
  const segments: string[] = [`M ${points[0].x} ${points[0].y}`]

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]

    const cp1x = Math.round((p1.x + (p2.x - p0.x) * tension) * 1000) / 1000
    const cp1y = Math.round((p1.y + (p2.y - p0.y) * tension) * 1000) / 1000
    const cp2x = Math.round((p2.x - (p3.x - p1.x) * tension) * 1000) / 1000
    const cp2y = Math.round((p2.y - (p3.y - p1.y) * tension) * 1000) / 1000

    segments.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`)
  }

  segments.push('Z')
  return segments.join(' ')
}
