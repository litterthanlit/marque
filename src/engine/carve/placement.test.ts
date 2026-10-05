import { describe, expect, it } from 'vitest'
import { placeMark, placeSlab, type Box } from './placement.ts'

const SQUARE = { width: 500, height: 500 }
/** A square slab in the middle of the canvas. */
const INK: Box = { x: -190, y: -190, width: 380, height: 380 }

function boxOf(shape: { width: number; height: number }, placed: { center: { x: number; y: number }; span: number }): Box {
  const fit = placed.span / Math.max(shape.width, shape.height)
  const width = shape.width * fit
  const height = shape.height * fit
  return { x: placed.center.x - width / 2, y: placed.center.y - height / 2, width, height }
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function inside(box: Box, viewport: { width: number; height: number }, margin = 16): boolean {
  return (
    box.x >= -viewport.width / 2 + margin - 1e-9 &&
    box.x + box.width <= viewport.width / 2 - margin + 1e-9 &&
    box.y >= -viewport.height / 2 + margin - 1e-9 &&
    box.y + box.height <= viewport.height / 2 - margin + 1e-9
  )
}

describe('placing a dropped mark', () => {
  it('goes in the middle of an empty canvas at its full span', () => {
    expect(placeMark(SQUARE, 360, null, { width: 600, height: 600 })).toEqual({ center: { x: 0, y: 0 }, span: 360 })
  })

  it('goes to the right of the ink at its full span when the canvas is wide', () => {
    const viewport = { width: 1400, height: 1000 }
    const placed = placeMark(SQUARE, 360, INK, viewport)
    const box = boxOf(SQUARE, placed)
    expect(placed.span).toBe(360)
    expect(box.x).toBeCloseTo(190 + 24, 9)
    expect(placed.center.y).toBe(0)
    expect(inside(box, viewport)).toBe(true)
  })

  it('goes to the left when the ink sits against the right edge', () => {
    const viewport = { width: 1400, height: 1000 }
    const ink: Box = { x: 300, y: -190, width: 380, height: 380 }
    const box = boxOf(SQUARE, placeMark(SQUARE, 360, ink, viewport))
    expect(box.x + box.width).toBeCloseTo(300 - 24, 9)
    expect(inside(box, viewport)).toBe(true)
  })

  it('goes below the ink on a tall canvas', () => {
    const viewport = { width: 600, height: 1228 }
    const placed = placeMark(SQUARE, 360, INK, viewport)
    const box = boxOf(SQUARE, placed)
    expect(placed.span).toBe(360)
    expect(placed.center.x).toBe(0)
    expect(box.y).toBeCloseTo(190 + 24, 9)
    expect(inside(box, viewport)).toBe(true)
  })

  it('shrinks to fit the side with the most room when no side takes it whole', () => {
    // A 1440 by 900 window: 343 units of room to the right and left of the slab, and none above or below.
    const viewport = { width: 1117, height: 600 }
    const placed = placeMark(SQUARE, 360, INK, viewport)
    const box = boxOf(SQUARE, placed)
    expect(placed.span).toBeLessThan(360)
    expect(placed.span).toBeGreaterThan(300)
    expect(box.x).toBeCloseTo(190 + 24, 9)
    expect(overlap(box, INK)).toBe(false)
    expect(inside(box, viewport)).toBe(true)
  })

  it('measures the span along the longer side of the mark', () => {
    const wide = { width: 500, height: 250 }
    const viewport = { width: 600, height: 1228 }
    const placed = placeMark(wide, 360, INK, viewport)
    const box = boxOf(wide, placed)
    expect(placed.span).toBe(360)
    expect(box.height).toBeCloseTo(180, 9)
    expect(box.y).toBeCloseTo(190 + 24, 9)
  })

  it('tucks into the corner at half its span when there is no room beside the ink', () => {
    const viewport = { width: 600, height: 600 }
    const ink: Box = { x: -250, y: -250, width: 500, height: 500 }
    const placed = placeMark(SQUARE, 360, ink, viewport)
    const box = boxOf(SQUARE, placed)
    expect(placed.span).toBe(180)
    expect(placed.center.x).toBeGreaterThan(0)
    expect(placed.center.y).toBeGreaterThan(0)
    expect(inside(box, viewport)).toBe(true)
  })

  it('does not shrink below half its span to stay clear of the ink', () => {
    // 130 units of room on the roomiest side.
    const viewport = { width: 600, height: 720 }
    const placed = placeMark(SQUARE, 360, INK, viewport)
    expect(placed.span).toBe(180)
    expect(overlap(boxOf(SQUARE, placed), INK)).toBe(true)
  })
})

describe('placing a new slab', () => {
  it('tries right, left, below, then above', () => {
    const wide = { width: 1400, height: 1000 }
    expect(placeSlab('square', INK, wide).center).toEqual({ x: 190 + 24 + 95, y: 0 })
    expect(placeSlab('square', { ...INK, x: 300 }, wide).center).toEqual({ x: 300 - 24 - 95, y: 0 })

    const tall = { width: 600, height: 1228 }
    expect(placeSlab('square', INK, tall).center).toEqual({ x: 0, y: 190 + 24 + 95 })
    expect(placeSlab('square', { ...INK, y: 100 }, tall).center).toEqual({ x: 0, y: 100 - 24 - 95 })
  })
})
