import type { Vec } from '../path/bezier.ts'
import { slabSpec, type SlabKind, type SlabSpec } from './spec.ts'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Size {
  width: number
  height: number
}

/** The sides of the ink a new piece tries, in order: right, left, below, above. */
const SIDES: Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Layer space is centred on the canvas, so the viewport spans ±width/2, ±height/2. */
function limits(viewport: Size, margin: number): Vec {
  return { x: viewport.width / 2 - margin, y: viewport.height / 2 - margin }
}

/** A box of `size` on one side of the ink, a gap away and level with the ink's middle. */
function beside(side: Vec, size: Size, ink: Box, gap: number): Vec {
  return {
    x: ink.x + ink.width / 2 + side.x * (ink.width / 2 + gap + size.width / 2),
    y: ink.y + ink.height / 2 + side.y * (ink.height / 2 + gap + size.height / 2),
  }
}

function fits(center: Vec, size: Size, limit: Vec): boolean {
  return Math.abs(center.x) + size.width / 2 <= limit.x && Math.abs(center.y) + size.height / 2 <= limit.y
}

function bottomRightCorner(size: Size, limit: Vec): Vec {
  return { x: Math.max(0, limit.x - size.width / 2), y: Math.max(0, limit.y - size.height / 2) }
}

/**
 * Where a new slab goes when the mark already has ink: half size, beside the
 * ink on the first side that fits the canvas, or tucked into the bottom-right
 * corner when nothing fits.
 */
export function placeSlab(
  preset: SlabKind,
  ink: Box,
  viewport: Size,
  margin = 16,
  gap = 24,
): SlabSpec {
  const half = slabSpec(preset, { x: 0, y: 0 }, 0.5)
  const limit = limits(viewport, margin)
  const spot =
    SIDES.map((side) => beside(side, half, ink, gap)).find((center) => fits(center, half, limit)) ??
    bottomRightCorner(half, limit)
  return { ...half, center: spot }
}

/**
 * Where a dropped mark goes. `span` is the length of its longer side. On an
 * empty canvas it sits in the middle. Beside ink it takes the first side with
 * room for all of it, and otherwise shrinks into the side with the most room.
 * Below half its span it would be too small to read, so it stays at half and
 * overlaps the ink from the bottom-right corner.
 */
export function placeMark(
  shape: Size,
  span: number,
  ink: Box | null,
  viewport: Size,
  margin = 16,
  gap = 24,
): { center: Vec; span: number } {
  if (!ink) return { center: { x: 0, y: 0 }, span }

  const longer = Math.max(shape.width, shape.height)
  const sized = (length: number): Size => ({
    width: (shape.width / longer) * length,
    height: (shape.height / longer) * length,
  })
  const limit = limits(viewport, margin)
  const unit = sized(1)
  const middle = { x: ink.x + ink.width / 2, y: ink.y + ink.height / 2 }
  // The longest the mark can be on one axis. Towards the side it runs from the gap to the canvas edge.
  // Across the side it is centred on the ink and has to stay inside both edges.
  const longest = (direction: number, inkMiddle: number, inkHalf: number, edge: number, perUnit: number): number =>
    (direction ? edge - (direction * inkMiddle + inkHalf + gap) : 2 * (edge - Math.abs(inkMiddle))) / perUnit

  let best: { center: Vec; span: number } | null = null
  for (const side of SIDES) {
    const length = Math.floor(
      Math.min(
        span,
        longest(side.x, middle.x, ink.width / 2, limit.x, unit.width),
        longest(side.y, middle.y, ink.height / 2, limit.y, unit.height),
      ),
    )
    if (length < span / 2 || (best && length <= best.span)) continue
    const size = sized(length)
    const center = beside(side, size, ink, gap)
    if (fits(center, size, limit)) best = { center, span: length }
  }
  if (best) return best

  return { center: bottomRightCorner(sized(span / 2), limit), span: span / 2 }
}
