import { describe, expect, it } from 'vitest'
import {
  cubicPoint,
  emptyBounds,
  includeCubic,
  projectOnCubic,
  solveBend,
  splitCubic,
  straightCubic,
  type Cubic,
} from './bezier.ts'

const curve: Cubic = [
  { x: 0, y: 0 },
  { x: 40, y: -60 },
  { x: 120, y: 80 },
  { x: 160, y: 0 },
]

describe('solveBend', () => {
  for (const t of [0.2, 0.5, 0.8]) {
    it(`passes exactly through the cursor at t=${t}`, () => {
      const target = { x: 70, y: -45 }
      const bent = solveBend(curve, t, target)
      const p = cubicPoint(bent, t)
      expect(p.x).toBeCloseTo(target.x, 6)
      expect(p.y).toBeCloseTo(target.y, 6)
      // End points never move.
      expect(bent[0]).toEqual(curve[0])
      expect(bent[3]).toEqual(curve[3])
    })
  }

  it('clamps t away from the ends so handles cannot explode', () => {
    const target = { x: 10, y: -70 }
    const bent = solveBend(curve, 0.02, target)
    const p = cubicPoint(bent, 0.1)
    expect(p.x).toBeCloseTo(target.x, 6)
    expect(p.y).toBeCloseTo(target.y, 6)
  })
})

describe('projectOnCubic', () => {
  it('is linear along a straight segment with thirds handles', () => {
    const line = straightCubic({ x: 0, y: 0 }, { x: 100, y: 0 })
    const hit = projectOnCubic(line, { x: 30, y: 12 })
    expect(hit.t).toBeCloseTo(0.3, 6)
    expect(hit.distance).toBeCloseTo(12, 6)
  })

  it('finds the nearest point on a curve', () => {
    const p = cubicPoint(curve, 0.63)
    const hit = projectOnCubic(curve, p)
    expect(hit.t).toBeCloseTo(0.63, 4)
    expect(hit.distance).toBeLessThan(1e-6)
  })
})

describe('splitCubic', () => {
  it('keeps the shape', () => {
    const [a, b] = splitCubic(curve, 0.4)
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const pa = cubicPoint(a, t)
      const pb = cubicPoint(b, t)
      const qa = cubicPoint(curve, t * 0.4)
      const qb = cubicPoint(curve, 0.4 + t * 0.6)
      expect(pa.x).toBeCloseTo(qa.x, 9)
      expect(pa.y).toBeCloseTo(qa.y, 9)
      expect(pb.x).toBeCloseTo(qb.x, 9)
      expect(pb.y).toBeCloseTo(qb.y, 9)
    }
  })
})

describe('includeCubic', () => {
  it('matches dense sampling', () => {
    const b = emptyBounds()
    includeCubic(b, curve)
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i <= 2000; i++) {
      const p = cubicPoint(curve, i / 2000)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    expect(b.minY).toBeCloseTo(minY, 3)
    expect(b.maxY).toBeCloseTo(maxY, 3)
    expect(b.minX).toBe(0)
    expect(b.maxX).toBe(160)
  })
})
