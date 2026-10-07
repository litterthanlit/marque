import { describe, expect, it } from 'vitest'
import { arcHandleRatio, arcToCubics, KAPPA } from './arc.ts'
import { cubicPoint, distance } from './bezier.ts'

describe('arcs as cubics', () => {
  it('give a quarter turn exactly the handle ratio quarter arcs have always had', () => {
    expect(arcHandleRatio(Math.PI / 2)).toBe(KAPPA)
    expect(arcHandleRatio(-Math.PI / 2)).toBe(-KAPPA)
    expect(arcHandleRatio(Math.PI / 3)).toBeCloseTo((4 / 3) * Math.tan(Math.PI / 12), 12)
  })

  it('split an arc into pieces of at most 90°, end to end, on the circle', () => {
    const centre = { x: 30, y: -20 }
    for (const [sweep, count] of [
      [Math.PI / 3, 1],
      [Math.PI / 2, 1],
      [Math.PI, 2],
      [1.5 * Math.PI + 0.1, 4],
      [-2 * Math.PI, 4],
    ] as const) {
      const pieces = arcToCubics(centre, 50, 0.4, sweep)
      expect(pieces).toHaveLength(count)
      pieces.forEach((piece, i) => {
        if (i > 0) expect(distance(piece[0], pieces[i - 1][3])).toBeLessThan(1e-9)
        for (let k = 0; k <= 8; k++) expect(Math.abs(distance(cubicPoint(piece, k / 8), centre) - 50)).toBeLessThan(0.02)
      })
      const end = pieces.at(-1)![3]
      expect(end.x).toBeCloseTo(centre.x + 50 * Math.cos(0.4 + sweep), 9)
      expect(end.y).toBeCloseTo(centre.y + 50 * Math.sin(0.4 + sweep), 9)
    }
  })

  it('turn clockwise on screen for a positive sweep, and draw nothing for no sweep or no radius', () => {
    const [piece] = arcToCubics({ x: 0, y: 0 }, 10, -Math.PI / 2, Math.PI / 2)
    // From the top to the right: clockwise with y down.
    expect(piece[0].y).toBeCloseTo(-10, 12)
    expect(piece[3].x).toBeCloseTo(10, 12)
    expect(piece[1].x).toBeGreaterThan(0)
    expect(arcToCubics({ x: 0, y: 0 }, 10, 0, 0)).toEqual([])
    expect(arcToCubics({ x: 0, y: 0 }, 0, 0, 1)).toEqual([])
  })
})
