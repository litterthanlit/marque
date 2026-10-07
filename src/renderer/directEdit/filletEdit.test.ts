import { describe, expect, it } from 'vitest'
import type { ResolvedFillet } from '../../engine/fillet/apply.ts'
import { filletCircles, filletDot, filletRadiusAt, radiusReadout } from './filletEdit.ts'

/** A fillet of radius 20 in a right-angled corner at the origin, opening down and to the right. */
const fillet: Extract<ResolvedFillet, { lost: false }> = {
  id: 'f',
  lost: false,
  radius: 20,
  used: 20,
  corner: { x: 0, y: 0 },
  convex: true,
  centre: { x: 20, y: 20 },
  touches: [{ x: 20, y: 0 }, { x: 0, y: 20 }],
}

describe('a fillet on the canvas', () => {
  it('has its radius dot on its circle, the far side from its corner, and the dot gives back its radius', () => {
    const dot = filletDot(fillet)
    expect(Math.hypot(dot.x - 20, dot.y - 20)).toBeCloseTo(20, 9)
    expect(dot.x).toBeGreaterThan(20)
    expect(filletRadiusAt(fillet, dot)).toBeCloseTo(20, 9)
    // Pulled out along the bisector, the radius grows in step with the circle's far side.
    expect(filletRadiusAt(fillet, { x: dot.x * 1.5, y: dot.y * 1.5 })).toBeCloseTo(30, 9)
    expect(filletRadiusAt(fillet, { x: -10, y: -10 })).toBe(0)
  })

  it('is pressed by its circle, or while lost where its circle last was', () => {
    expect(filletCircles([fillet, { id: 'l', lost: true, radius: 8, at: { x: 5, y: 6 }, centre: { x: 9, y: 10 }, used: 7 }])).toEqual([
      { id: 'f', c: { x: 20, y: 20 }, r: 20 },
      { id: 'l', c: { x: 9, y: 10 }, r: 7 },
    ])
  })

  it('reads its radius, and says when its corner holds less', () => {
    expect(radiusReadout(20, fillet)).toBe('r 20')
    expect(radiusReadout(40, fillet)).toBe('r 20 · clamped from 40')
    expect(radiusReadout(12, null)).toBe('r 12')
    expect(radiusReadout(40, { ...fillet, byNeighbour: true })).toBe('r 20 · clamped by a neighbour')
  })
})
