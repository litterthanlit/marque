import { slabSpec, type SlabKind, type SlabSpec } from './spec.ts'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a new slab goes when the mark already has ink: half size, beside the
 * ink (right, left, below, above — the first that fits the canvas), or tucked
 * into the bottom-right corner when nothing fits. Layer space is centred on
 * the canvas, so the viewport spans ±width/2, ±height/2.
 */
export function placeSlab(
  preset: SlabKind,
  ink: Box,
  viewport: { width: number; height: number },
  margin = 16,
  gap = 24,
): SlabSpec {
  const half = slabSpec(preset, { x: 0, y: 0 }, 0.5)
  const w = half.width
  const h = half.height
  const limitX = viewport.width / 2 - margin
  const limitY = viewport.height / 2 - margin
  const cx = ink.x + ink.width / 2
  const cy = ink.y + ink.height / 2
  const candidates = [
    { x: ink.x + ink.width + gap + w / 2, y: cy },
    { x: ink.x - gap - w / 2, y: cy },
    { x: cx, y: ink.y + ink.height + gap + h / 2 },
    { x: cx, y: ink.y - gap - h / 2 },
  ]
  const fits = (c: { x: number; y: number }) => Math.abs(c.x) + w / 2 <= limitX && Math.abs(c.y) + h / 2 <= limitY
  const spot = candidates.find(fits) ?? {
    x: Math.max(0, limitX - w / 2),
    y: Math.max(0, limitY - h / 2),
  }
  return { ...half, center: spot }
}
