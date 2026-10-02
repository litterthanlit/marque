import { describe, expect, it } from 'vitest'
import { cubicPoint, cross, dot, normalize, scale, type Vec } from './bezier.ts'
import {
  bendCurve,
  curveOf,
  deleteAnchor,
  editablePathToPathData,
  insertPoint,
  isSmoothAt,
  moveAnchor,
  moveHandle,
  straightenCurve,
  toggleSmooth,
  type EditablePath,
} from './editPath.ts'

const square: EditablePath = {
  closed: true,
  segs: [
    { p: { x: 0, y: 0 }, hIn: null, hOut: null },
    { p: { x: 100, y: 0 }, hIn: null, hOut: null },
    { p: { x: 100, y: 100 }, hIn: null, hOut: null },
    { p: { x: 0, y: 100 }, hIn: null, hOut: null },
  ],
}

function angleBetween(a: Vec, b: Vec): number {
  return Math.abs(Math.atan2(cross(a, b), dot(a, b))) * (180 / Math.PI)
}

describe('free path editing', () => {
  it('toggles a corner to smooth and back', () => {
    const smooth = toggleSmooth(square, 1)
    expect(isSmoothAt(smooth, 1)).toBe(true)
    const sharp = toggleSmooth(smooth, 1)
    expect(sharp.segs[1].hIn).toBeNull()
    expect(sharp.segs[1].hOut).toBeNull()
  })

  it('keeps a smooth point smooth when one handle moves, unless asked not to', () => {
    const smooth = toggleSmooth(square, 1)
    const lengthIn = Math.hypot(smooth.segs[1].hIn!.x, smooth.segs[1].hIn!.y)
    const moved = moveHandle(smooth, 1, 'out', { x: 150, y: 40 })
    expect(isSmoothAt(moved, 1, 0.1)).toBe(true)
    expect(Math.hypot(moved.segs[1].hIn!.x, moved.segs[1].hIn!.y)).toBeCloseTo(lengthIn, 9)
    const broken = moveHandle(smooth, 1, 'out', { x: 150, y: 40 }, { breakSmooth: true })
    expect(isSmoothAt(broken, 1)).toBe(false)
  })

  it('moves an anchor with its handles', () => {
    const smooth = toggleSmooth(square, 2)
    const moved = moveAnchor(smooth, 2, { x: 120, y: 130 })
    expect(moved.segs[2].p).toEqual({ x: 120, y: 130 })
    expect(moved.segs[2].hOut).toEqual(smooth.segs[2].hOut)
  })

  it('inserting a point keeps the shape', () => {
    const curvy = toggleSmooth(toggleSmooth(square, 1), 2)
    const before = curveOf(curvy, 1)
    const { path, index } = insertPoint(curvy, 1, 0.37)
    expect(index).toBe(2)
    expect(path.segs).toHaveLength(5)
    const left = curveOf(path, 1)
    const right = curveOf(path, 2)
    for (const t of [0, 0.3, 0.7, 1]) {
      const a = cubicPoint(left, t)
      const b = cubicPoint(before, t * 0.37)
      expect(a.x).toBeCloseTo(b.x, 6)
      expect(a.y).toBeCloseTo(b.y, 6)
      const c = cubicPoint(right, t)
      const d = cubicPoint(before, 0.37 + t * 0.63)
      expect(c.x).toBeCloseTo(d.x, 6)
      expect(c.y).toBeCloseTo(d.y, 6)
    }
  })

  it('refuses to delete below three points on a closed shape', () => {
    const triangle = deleteAnchor(square, 0)!
    expect(triangle.segs).toHaveLength(3)
    expect(deleteAnchor(triangle, 0)).toBeNull()
  })

  it('bends a straight edge through the cursor and straightens it again', () => {
    const target = { x: 50, y: -30 }
    const bent = bendCurve(square, 0, 0.5, target)
    const p = cubicPoint(curveOf(bent, 0), 0.5)
    expect(p.x).toBeCloseTo(target.x, 6)
    expect(p.y).toBeCloseTo(target.y, 6)
    const flat = straightenCurve(bent, 0)
    expect(flat.segs[0].hOut).toBeNull()
    expect(flat.segs[1].hIn).toBeNull()
  })

  it('keeps neighbouring smooth points smooth while bending', () => {
    const smooth = toggleSmooth(square, 1)
    const bent = bendCurve(smooth, 0, 0.5, { x: 50, y: -40 })
    const out = normalize(bent.segs[1].hOut!)
    const inn = normalize(scale(bent.segs[1].hIn!, -1))
    expect(angleBetween(out, inn)).toBeLessThan(0.1)
  })

  it('writes straight sides as lines and curves as curves', () => {
    expect(editablePathToPathData(square)).toBe('M0,0L100,0L100,100L0,100L0,0Z')
    expect(editablePathToPathData(toggleSmooth(square, 1))).toContain('C')
  })
})
