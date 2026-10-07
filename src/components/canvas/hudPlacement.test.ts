import { describe, expect, it } from 'vitest'
import { HUD_EDGE, hudPlace } from './hudPlacement.ts'

const phone = { width: 388, height: 600 }
const hint = { width: 276, height: 18 }

/** Does the row lie wholly inside the frame? */
function inside(place: { left: number; top: number }, row: { width: number; height: number }, frame: { width: number; height: number }) {
  return place.left >= 0 && place.top >= 0 && place.left + row.width <= frame.width && place.top + row.height <= frame.height
}

describe('where the HUD row goes', () => {
  it('goes right of the pointer and below it where there is room', () => {
    expect(hudPlace({ x: 20, y: 100, above: false }, { width: 60, height: 18 }, phone)).toEqual({ left: 34, top: 114 })
  })

  it('goes left of the pointer where the right has no room', () => {
    expect(hudPlace({ x: 360, y: 100, above: false }, { width: 60, height: 18 }, phone)).toEqual({ left: 286, top: 114 })
  })

  it('lies inside a phone canvas wherever a long hint is, in the middle too, where neither side has room', () => {
    for (const x of [0, 60, 194, 300, 388]) {
      const place = hudPlace({ x, y: 300, above: true }, hint, phone)
      expect(inside(place, hint, phone), `at ${x}`).toBe(true)
      expect(place.left).toBeGreaterThanOrEqual(HUD_EDGE)
      expect(place.left + hint.width).toBeLessThanOrEqual(phone.width - HUD_EDGE)
    }
    // In the middle it keeps as near the finger as it can: its left side as far right as the edge allows.
    expect(hudPlace({ x: 194, y: 300, above: true }, hint, phone).left).toBe(phone.width - hint.width - HUD_EDGE)
  })

  it('goes above a finger, below it only near the top edge', () => {
    expect(hudPlace({ x: 20, y: 300, above: true }, hint, phone).top).toBe(300 - 44 - 18)
    expect(hudPlace({ x: 20, y: 30, above: true }, hint, phone).top).toBe(30 + 44)
  })

  it('goes above the pointer near the bottom edge, and stays inside a frame too short for either side', () => {
    expect(hudPlace({ x: 20, y: 590, above: false }, hint, phone).top).toBe(590 - 14 - 18)
    expect(hudPlace({ x: 20, y: 20, above: false }, { width: 60, height: 30 }, { width: 388, height: 40 }).top).toBe(10)
  })
})
