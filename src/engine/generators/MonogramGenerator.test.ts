import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { composeBooleanResult } from '../boolean/operations.ts'
import { getAllModeParamDefaults } from '../../store/modes.ts'
import { GLYPHS } from '../monogram/glyphs.ts'
import { pieceEnd, pieceStart } from '../monogram/stroke.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
/** The enclosed counters of each capital; the rest have none. */
const COUNTERS: Record<string, number> = { A: 1, B: 2, D: 1, O: 1, P: 1, Q: 1, R: 1 }

function params(initials: string, mode: Record<string, number> = {}): LogoParams {
  const defaults = getAllModeParamDefaults()
  return {
    ...DEFAULT_PARAMS,
    rotation: 0,
    seed: 7,
    modeId: 'monogram',
    generatorId: 'monogram',
    brandInput: { initials },
    modeParams: { ...defaults, monogram: { ...defaults.monogram, ...mode } },
  }
}

/** The pieces of ink in a mark and the holes in them, read from which way each contour turns. */
function measure(pathData: string) {
  scope.activate()
  const item = new scope.CompoundPath(pathData)
  const contours = (item.children as paper.Path[]).map((child) => ({ clockwise: child.clockwise, area: Math.abs(child.area) }))
  const largest = contours.reduce((a, b) => (b.area > a.area ? b : a))
  const pieces = contours.filter((contour) => contour.clockwise === largest.clockwise).length
  const result = { area: Math.abs(item.area), pieces, holes: contours.length - pieces, bounds: item.bounds.clone() }
  item.remove()
  return result
}

describe('the monogram letters', () => {
  it('has a skeleton for every capital, its strokes unbroken', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual(ALPHABET)
    for (const [letter, glyph] of Object.entries(GLYPHS)) {
      for (const stroke of glyph.strokes) {
        for (let i = 1; i < stroke.pieces.length; i++) {
          const gap = Math.hypot(
            pieceStart(stroke.pieces[i]).x - pieceEnd(stroke.pieces[i - 1]).x,
            pieceStart(stroke.pieces[i]).y - pieceEnd(stroke.pieces[i - 1]).y,
          )
          expect(gap, `${letter}: piece ${i} starts where the last ends`).toBeLessThan(1e-9)
        }
        if (stroke.closed) {
          const first = pieceStart(stroke.pieces[0])
          const last = pieceEnd(stroke.pieces.at(-1)!)
          expect(Math.hypot(first.x - last.x, first.y - last.y), `${letter} closes`).toBeLessThan(1e-9)
        }
      }
    }
  })

  const VARIANTS = [
    { strokeWeight: 0.8, contrast: 0 },
    { strokeWeight: 1.8, contrast: 0 },
    { strokeWeight: 1.8, contrast: 1 },
  ]

  it.each([0, 1, 2])('draws every capital as one piece of ink with its counters, corners in style %i', (cornerStyle) => {
    for (const letter of ALPHABET) {
      for (const variant of VARIANTS) {
        const result = generate(params(letter, { ...variant, cornerStyle, frameMode: 0 }))
        const label = `${letter} ${JSON.stringify(variant)}`
        expect(result.warnings, label).toEqual([])
        const mark = measure(result.mark.compoundPathData)
        expect(mark.pieces, `${label}: one piece`).toBe(1)
        expect(mark.holes, `${label}: counters`).toBe(COUNTERS[letter] ?? 0)
      }
    }
  })

  it('stands every letter on the baseline and under the cap line, as its bars do', () => {
    const height = (letter: string) => measure(generate(params(letter, { contrast: 0.5 })).mark.compoundPathData).bounds.height
    const bars = height('E')
    for (const letter of 'AHKMNVWXZ') expect(height(letter), letter).toBeCloseTo(bars, 2)
  })

  it('draws every piece as an added outline of its own, without holes', () => {
    const result = generate(params('BQ', { frameMode: 2 }))
    expect(result.shapes.length).toBeGreaterThan(0)
    for (const shape of result.shapes) {
      expect(shape.type).toBe('stroke')
      expect(shape.operation).toBe('add')
      expect(shape.pathData!.match(/M/g)).toHaveLength(1)
    }
    expect(result.constructionData.stats.subtractiveCount).toBe(0)
  })

  it.each([1, 2])('frames the letters in style %i without cutting into them', (frameMode) => {
    const framed = generate(params('AB', { frameMode }))
    const compose = (frame: boolean) =>
      composeBooleanResult(
        framed.shapes
          .filter((shape) => shape.id.startsWith('monogram_') === frame)
          .map((shape) => ({ pathData: shape.pathData!, operation: 'add' as const })),
      ).compoundPathData
    const letters = measure(compose(false))
    const frame = measure(compose(true))
    const whole = measure(framed.mark.compoundPathData)
    expect(framed.warnings).toEqual([])
    expect(Math.abs(whole.area - letters.area - frame.area) / whole.area).toBeLessThan(1e-3)
    expect(whole.pieces).toBe(2)
    expect(whole.holes).toBe(letters.holes + 1)
  })

  it('centres the mark and draws it the same for any seed', () => {
    const a = generate(params('MN'))
    const b = generate({ ...params('MN'), seed: 12345 })
    expect(b.mark.compoundPathData).toBe(a.mark.compoundPathData)
    const { bounds } = measure(a.mark.compoundPathData)
    expect(Math.abs(bounds.center.x)).toBeLessThan(0.5)
    expect(Math.abs(bounds.center.y)).toBeLessThan(0.5)
  })

  it('draws the letters closer, then over each other, as the interlock grows', () => {
    const width = (interlockStrength: number) =>
      measure(generate(params('HH', { interlockStrength })).mark.compoundPathData).bounds.width
    expect(width(0)).toBeGreaterThan(width(0.45))
    expect(width(0.45)).toBeGreaterThan(width(1))
    expect(measure(generate(params('HH', { interlockStrength: 0 })).mark.compoundPathData).pieces).toBe(2)
    expect(measure(generate(params('HH', { interlockStrength: 1 })).mark.compoundPathData).pieces).toBe(1)
  })

  it('draws two letters at full size and fits three, or a badge, to the same longest side', () => {
    const span = (initials: string, frameMode = 0) => {
      const { bounds } = measure(generate(params(initials, { frameMode })).mark.compoundPathData)
      return Math.max(bounds.width, bounds.height)
    }
    expect(span('HH')).toBeLessThan(420)
    expect(span('MWM')).toBeCloseTo(420, 0)
    expect(span('HH', 2)).toBeCloseTo(420, 0)
  })

  it('turns the whole mark by the rotation', () => {
    const upright = measure(generate(params('I')).mark.compoundPathData).bounds
    const turned = measure(generate({ ...params('I'), rotation: 90 }).mark.compoundPathData).bounds
    expect(turned.width).toBeCloseTo(upright.height, 1)
    expect(turned.height).toBeCloseTo(upright.width, 1)
  })
})
