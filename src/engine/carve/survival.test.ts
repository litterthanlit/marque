import { describe, expect, it } from 'vitest'
import { findThinWalls } from './survival.ts'

const SIZE = 360
// The probe radius checkSurvival uses for a mark that fills the mask, at 16, 32 and 64 px.
const RADII = [10.04, 5.02, 2.51]

function mask(paint: (x: number, y: number) => boolean): Uint8Array {
  const ink = new Uint8Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) ink[y * SIZE + x] = paint(x, y) ? 1 : 0
  }
  return ink
}

function count(pixels: Uint8Array): number {
  return pixels.reduce((sum, value) => sum + value, 0)
}

describe('findThinWalls', () => {
  it('finds nothing weak in a plain square', () => {
    const square = mask((x, y) => x >= 20 && x < 340 && y >= 20 && y < 340)
    for (const radius of RADII) {
      expect(count(findThinWalls(square, SIZE, SIZE, radius))).toBe(0)
    }
  })

  it('reports a bridge thinner than the probe, and only the bridge', () => {
    const inBlock = (x: number, y: number) => y >= 60 && y < 300 && ((x >= 20 && x < 140) || (x >= 220 && x < 340))
    const inBridge = (x: number, y: number) => x >= 140 && x < 220 && y >= 178 && y < 182
    const ink = mask((x, y) => inBlock(x, y) || inBridge(x, y))

    const thin = findThinWalls(ink, SIZE, SIZE, 5.02)
    expect(count(thin)).toBeGreaterThan(200)
    for (let i = 0; i < thin.length; i++) {
      if (thin[i]) expect(inBridge(i % SIZE, Math.floor(i / SIZE))).toBe(true)
    }
  })
})
