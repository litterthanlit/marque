import type { SeededRandom } from '../types.ts'
import { circlePath } from './circle.ts'
import { rectanglePath } from './rectangle.ts'
import { trianglePath } from './triangle.ts'
import { polygonPath } from './polygon.ts'
import { blobPath, blobPathFromDisplacements } from './blob.ts'

export type PrimitiveType = 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'blob'

const PRIMITIVE_TYPES: PrimitiveType[] = [
  'circle',
  'rectangle',
  'triangle',
  'polygon',
  'blob',
]

export function pickPrimitiveType(rng: SeededRandom): PrimitiveType {
  return PRIMITIVE_TYPES[rng.nextInt(0, PRIMITIVE_TYPES.length - 1)]
}

export function createPrimitivePath(
  type: PrimitiveType,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  params: Record<string, number>,
  rng?: SeededRandom,
): string {
  switch (type) {
    case 'circle':
      return circlePath(cx, cy, radius)
    case 'rectangle':
      return rectanglePath(cx, cy, radius, rotation)
    case 'triangle':
      return trianglePath(cx, cy, radius, rotation)
    case 'polygon':
      return polygonPath(cx, cy, radius, rotation, params.sides ?? 5)
    case 'blob':
      if (params.pointCount && params.blobDisp0) {
        const pointCount = Math.max(5, Math.round(params.pointCount))
        const displacements = Array.from({ length: pointCount }, (_, index) => {
          const value = params[`blobDisp${index}`]
          return value && value > 0 ? value : 1
        })
        return blobPathFromDisplacements(cx, cy, radius, rotation, displacements)
      }
      if (!rng) return circlePath(cx, cy, radius)
      return blobPath(cx, cy, radius, rotation, rng)
    default:
      return circlePath(cx, cy, radius)
  }
}
