import type { SeededRandom } from '../types.ts'
import { circlePath } from './circle.ts'
import { rectanglePath } from './rectangle.ts'
import { trianglePath } from './triangle.ts'
import { polygonPath } from './polygon.ts'
import { blobPath } from './blob.ts'

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
      if (!rng) return circlePath(cx, cy, radius) // fallback if no rng
      return blobPath(cx, cy, radius, rotation, rng)
    default:
      return circlePath(cx, cy, radius)
  }
}
