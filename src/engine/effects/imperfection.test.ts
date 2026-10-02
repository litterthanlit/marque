import { describe, expect, it } from 'vitest'
import paper from 'paper'
import { applyImperfection, imperfectPathData, isImperfectionActive } from './imperfection.ts'
import { DEFAULT_IMPERFECTION_PARAMS, type ImperfectionParams } from './types.ts'
import type { MarkData } from '../illustrator/types.ts'

const ON: ImperfectionParams = { ...DEFAULT_IMPERFECTION_PARAMS, enabled: true }
const MAX: ImperfectionParams = { enabled: true, wobble: 1, grain: 1, soften: 1, seed: 7 }

// A thin cross and a square with a square hole: thin strokes and counters.
const CROSS = 'M245,60L255,60L255,240L440,240L440,250L255,250L255,440L245,440L245,250L60,250L60,240L245,240Z'
const FRAME = 'M330,330L440,330L440,440L330,440Z M360,360L410,360L410,410L360,410Z'
const MARK = `${CROSS} ${FRAME}`

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function shape(pathData: string) {
  scope.activate()
  return new scope.CompoundPath({ pathData, insert: false })
}

function areaOf(pathData: string) {
  return Math.abs(shape(pathData).area)
}

function contourCount(pathData: string) {
  return shape(pathData).children.length
}

describe('imperfection', () => {
  it('leaves the mark alone when off or set to nothing', () => {
    expect(imperfectPathData(MARK, DEFAULT_IMPERFECTION_PARAMS)).toBe(MARK)
    const none = { ...ON, wobble: 0, grain: 0, soften: 0 }
    expect(isImperfectionActive(none)).toBe(false)
    expect(imperfectPathData(MARK, none)).toBe(MARK)
  })

  it('draws the same mark for the same hand, and a new one for a new hand', () => {
    const a = imperfectPathData(MARK, ON)
    expect(a).not.toBe(MARK)
    expect(imperfectPathData(MARK, ON)).toBe(a)
    expect(imperfectPathData(MARK, { ...ON, seed: ON.seed + 1 })).not.toBe(a)
  })

  it('keeps every contour, holes included, even at full strength', () => {
    const out = imperfectPathData(MARK, MAX)
    expect(contourCount(out)).toBe(contourCount(MARK))
  })

  it('keeps the amount of ink close to the original', () => {
    const before = areaOf(MARK)
    for (const params of [ON, MAX]) {
      const after = areaOf(imperfectPathData(MARK, params))
      expect(Math.abs(after - before) / before).toBeLessThan(0.08)
    }
  })

  it('stays within a small margin of the original outline', () => {
    const before = shape(MARK).bounds
    const after = shape(imperfectPathData(MARK, MAX)).bounds
    const size = Math.max(before.width, before.height)
    for (const key of ['left', 'top', 'right', 'bottom'] as const) {
      expect(Math.abs(after[key] - before[key])).toBeLessThan(size * 0.03)
    }
  })

  it('does not move parts that did not change', () => {
    // Noise lives in the mark's own space: adding a shape elsewhere, or
    // reordering contours, keeps the cross drawn exactly as before.
    const alone = imperfectPathData(`${CROSS} M0,0L500,0L500,1L0,1Z`, ON)
    const reordered = imperfectPathData(`M0,0L500,0L500,1L0,1Z ${CROSS}`, ON)
    const crossOf = (pathData: string) => shape(pathData).children.map((c) => (c as paper.Path).pathData).sort()
    expect(crossOf(reordered)).toEqual(crossOf(alone))
  })

  it('returns the handmade mark with a frame that fits it', () => {
    const mark: MarkData = { compoundPathData: MARK, fillRule: 'evenodd', viewBox: { x: 60, y: 60, width: 380, height: 380 } }
    expect(applyImperfection(mark, DEFAULT_IMPERFECTION_PARAMS)).toBe(mark)
    const out = applyImperfection(mark, MAX)!
    expect(out).not.toBe(mark)
    expect(out.fillRule).toBe('evenodd')
    const b = shape(out.compoundPathData).bounds
    expect(out.viewBox.x).toBeCloseTo(b.x, 2)
    expect(out.viewBox.width).toBeCloseTo(b.width, 2)
    // Asked again (canvas, preview, export), it's the same object.
    expect(applyImperfection(mark, MAX)).toBe(out)
  })
})
