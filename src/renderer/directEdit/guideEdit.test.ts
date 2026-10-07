import { describe, expect, it } from 'vitest'
import type { Guide } from '../../engine/vector/types.ts'
import { guideHandles, startOnGuides } from './guideEdit.ts'

const guide = (id: string, shape: Guide['shape']): Guide => ({ id, name: 'Line', visible: true, locked: false, style: 'solid', shape })

describe('where a line drawn out of guides starts', () => {
  const flat = guide('flat', { kind: 'line', p: { x: -150, y: 150 }, angle: 0 })
  const upright = guide('upright', { kind: 'line', p: { x: -150, y: 0 }, angle: 90 })

  it('starts at the corner where two frame lines cross, when the press is near it', () => {
    const start = startOnGuides([flat, upright], { x: -147, y: 152 }, 4)!
    expect(start.x).toBeCloseTo(-150, 9)
    expect(start.y).toBeCloseTo(150, 9)
  })

  it('starts on the nearest guide, under the press, away from any crossing', () => {
    expect(startOnGuides([flat, upright], { x: -60, y: 153 }, 4)).toEqual({ x: -60, y: 150 })
  })

  it('starts on a circle at its point nearest the press', () => {
    const circle = guide('circle', { kind: 'circle', c: { x: 0, y: 0 }, r: 100 })
    const start = startOnGuides([circle], { x: 0, y: -102 }, 4)!
    expect(start.x).toBeCloseTo(0, 9)
    expect(start.y).toBeCloseTo(-100, 9)
  })

  it('starts nowhere when no guide is in reach', () => {
    expect(startOnGuides([flat, upright], { x: 0, y: 0 }, 4)).toBeNull()
  })
})

describe("a selected line's knob", () => {
  // The open part of the view: the bars cover the canvas above y = -200 and below y = 250.
  const open = { minX: -300, minY: -200, maxX: 300, maxY: 250 }

  it('turns about the point of the line nearest the middle of the open view when its own point lies under a bar', () => {
    const upright = guide('upright', { kind: 'line', p: { x: 40, y: -280 }, angle: 90 })
    const [knob] = guideHandles(upright, open, 1)
    expect(knob.pivot).toEqual({ x: 40, y: 25 })
    expect(knob.at.y).toBeGreaterThan(open.minY)
    expect(knob.at.y).toBeLessThan(open.maxY)
  })

  it('turns about its own point when that is open, the knob on the side that stays open', () => {
    const flat = guide('flat', { kind: 'line', p: { x: 280, y: 0 }, angle: 0 })
    const [knob] = guideHandles(flat, open, 1)
    expect(knob.pivot).toEqual({ x: 280, y: 0 })
    expect(knob.at).toEqual({ x: 224, y: 0 })
  })
})
