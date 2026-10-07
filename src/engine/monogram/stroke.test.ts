import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { composeBooleanResult } from '../boolean/operations.ts'
import { outlineBounds, outlinePathData, strokeSkeleton, widthAlong, type CornerStyle, type Piece, type Skeleton, type StrokeStyle } from './stroke.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

const open = (pieces: Piece[], tee = { start: false, end: false }): Skeleton => ({ pieces, closed: false, tee })
const line = (ax: number, ay: number, bx: number, by: number): Piece => ({ kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
const polyline = (...points: Array<[number, number]>) =>
  open(points.slice(1).map((p, i) => line(points[i][0], points[i][1], p[0], p[1])))
const mono = (width: number, corners: CornerStyle = 'miter', lines?: StrokeStyle['lines']): StrokeStyle => ({
  vertical: width,
  horizontal: width,
  corners,
  lines,
})

/** The ink of a stroke: its outlines united, as the monogram unites them. */
function ink(skeleton: Skeleton, style: StrokeStyle) {
  const result = composeBooleanResult(
    strokeSkeleton(skeleton, style).map((outline) => ({ pathData: outlinePathData(outline), operation: 'add' as const })),
  )
  expect(result.warnings).toEqual([])
  scope.activate()
  const item = new scope.CompoundPath(result.compoundPathData)
  const { left, top, right, bottom } = item.bounds
  const area = Math.abs(item.area)
  item.remove()
  return { area, left, top, right, bottom }
}

describe('stroking a centreline', () => {
  it('gives a straight piece its width either side, ending square', () => {
    const drawn = ink(polyline([0, 0], [10, 0]), mono(2))
    expect(drawn.area).toBeCloseTo(20, 6)
    expect([drawn.left, drawn.top, drawn.right, drawn.bottom]).toEqual([0, -1, 10, 1])
  })

  it('makes horizontals thinner than verticals by the contrast, and diagonals between', () => {
    const style: StrokeStyle = { vertical: 2, horizontal: 1, corners: 'miter' }
    expect(widthAlong(style, { x: 1, y: 0 })).toBe(1)
    expect(widthAlong(style, { x: 0, y: -1 })).toBe(2)
    expect(widthAlong(style, { x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBeCloseTo(1.5, 12)
    expect(ink(polyline([0, 0], [0, 10]), style).area).toBeCloseTo(20, 6)
    expect(ink(polyline([0, 0], [10, 0]), style).area).toBeCloseTo(10, 6)
  })

  it('draws an arc as a band of the same width, within a hair of the true one', () => {
    // At drawing size, so the thousandths the path is written in do not count.
    const arc: Piece = { kind: 'arc', c: { x: 0, y: 0 }, r: 50, start: Math.PI, sweep: Math.PI }
    const drawn = ink(open([arc]), mono(10))
    // A half annulus: sweep · r · w.
    expect(Math.abs(drawn.area - Math.PI * 500) / (Math.PI * 500)).toBeLessThan(5e-5)
    expect(drawn.top).toBeCloseTo(-55, 2)
    expect(drawn.left).toBeCloseTo(-55, 2)
  })

  it('carries a stroke round a smooth corner from a line onto an arc without a seam', () => {
    const skeleton = open([line(0, 50, 0, 0), { kind: 'arc', c: { x: 50, y: 0 }, r: 50, start: Math.PI, sweep: Math.PI / 2 }])
    const area = 500 + (Math.PI / 2) * 500
    expect(Math.abs(ink(skeleton, mono(10)).area - area) / area).toBeLessThan(1e-5)
  })

  // An L of two strokes ten long, one wide: two bars and the corner square.
  const L = polyline([0, 0], [0, 10], [10, 10])

  it('miters a corner, filling its outer square', () => {
    const drawn = ink(L, mono(1, 'miter'))
    expect(drawn.area).toBeCloseTo(20, 6)
    expect([drawn.left, drawn.bottom]).toEqual([-0.5, 10.5])
  })

  it('bevels a corner, leaving out half the outer square', () => {
    expect(ink(L, mono(1, 'bevel')).area).toBeCloseTo(20 - 0.125, 6)
  })

  it('rounds a corner on a quarter circle about it', () => {
    const tees = { ...L, tee: { start: true, end: true } }
    expect(ink(tees, mono(1, 'round')).area).toBeCloseTo(20 - 0.25 + Math.PI / 16, 3)
  })

  it('bevels a miter that would reach further than its limit', () => {
    // A 20° corner: its miter would reach almost six half-widths.
    const sharp = polyline([0, 0], [5, 10 * Math.tan((80 * Math.PI) / 180) / 2], [10, 0])
    const drawn = ink(sharp, mono(1))
    const apex = 10 * Math.tan((80 * Math.PI) / 180) / 2
    expect(drawn.bottom).toBeLessThan(apex + 1)
  })

  it('cuts a corner on the baseline flat at the ink line, half a horizontal below', () => {
    const V = polyline([0, 0], [2.5, 7], [5, 0])
    const style: StrokeStyle = { vertical: 1, horizontal: 0.6, corners: 'miter', lines: { top: 0, bottom: 7 } }
    const drawn = ink(V, style)
    expect(drawn.bottom).toBeCloseTo(7.3, 9)
    // Its free ends on the cap line are cut flat the same way.
    expect(drawn.top).toBeCloseTo(-0.3, 9)
  })

  it('keeps a corner on the cap line whose miter stays on the ink line, as a bar meets a stem', () => {
    const drawn = ink(polyline([4, 0], [0, 0], [0, 7]), { vertical: 1, horizontal: 0.6, corners: 'miter', lines: { top: 0, bottom: 7 } })
    expect(drawn.left).toBeCloseTo(-0.5, 9)
    expect(drawn.top).toBeCloseTo(-0.3, 9)
  })

  it('rounds free ends, pulling a round end on the cap line back so it reaches the ink line', () => {
    expect(ink(polyline([0, 0], [10, 0]), mono(1, 'round')).area).toBeCloseTo(10 + Math.PI / 4, 3)
    const stem = ink(polyline([0, 0], [0, 7]), { vertical: 1, horizontal: 0.6, corners: 'round', lines: { top: 0, bottom: 7 } })
    expect(stem.top).toBeCloseTo(-0.3, 3)
    expect(stem.bottom).toBeCloseTo(7.3, 3)
  })

  it('ends a tee square where it is given, even in the round style', () => {
    const drawn = ink(open([line(0, 0, 10, 0)], { start: true, end: true }), mono(1, 'round'))
    expect(drawn.area).toBeCloseTo(10, 6)
  })

  it('draws a closed run with every corner joined, its first to its last', () => {
    const square: Skeleton = {
      pieces: [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0)],
      closed: true,
      tee: { start: false, end: false },
    }
    const drawn = ink(square, mono(1))
    expect(drawn.area).toBeCloseTo(11 * 11 - 9 * 9, 6)
    expect([drawn.left, drawn.top, drawn.right, drawn.bottom]).toEqual([-0.5, -0.5, 10.5, 10.5])
  })

  it('gives each piece one outline, bounded by its curves', () => {
    const outlines = strokeSkeleton(polyline([0, 0], [0, 10], [10, 10]), mono(1))
    expect(outlines).toHaveLength(2)
    for (const outline of outlines) expect(outlinePathData(outline).match(/M/g)).toHaveLength(1)
    const arc = strokeSkeleton(open([{ kind: 'arc', c: { x: 0, y: 0 }, r: 5, start: 0, sweep: Math.PI / 2 }]), mono(1))
    const bounds = outlineBounds(arc[0])
    expect(bounds.maxX).toBeCloseTo(5.5, 3)
    expect(bounds.maxY).toBeCloseTo(5.5, 3)
  })
})
