import { describe, expect, it } from 'vitest'
import { cubicPoint } from './bezier.ts'
import { curveOf } from './editPath.ts'
import {
  bendDraftEdge,
  canClose,
  closeDraft,
  draftArea,
  EMPTY_DRAFT,
  hitDraft,
  moveDraftPoint,
  placePoint,
  removeLastPoint,
  type PenDraft,
} from './penDraft.ts'

const tol = { close: 10, point: 6, edge: 6 }

function draw(...points: Array<[number, number]>): PenDraft {
  return points.reduce<PenDraft>((draft, [x, y]) => placePoint(draft, { x, y }), EMPTY_DRAFT)
}

describe('pen draft', () => {
  it('places points and closes into a shape once there are three', () => {
    const two = draw([0, 0], [100, 0])
    expect(canClose(two)).toBe(false)
    expect(closeDraft(two)).toBeNull()
    const three = placePoint(two, { x: 100, y: 100 })
    expect(draftArea(three)).toBeCloseTo(5000, 6)
    const shape = closeDraft(three)!
    expect(shape.closed).toBe(true)
    expect(shape.segs).toHaveLength(3)
  })

  it('will not close three points in a line', () => {
    expect(canClose(draw([0, 0], [50, 0], [100, 0]))).toBe(false)
  })

  it('bends an edge mid-drawing through the cursor', () => {
    const draft = draw([0, 0], [100, 0], [100, 100])
    const bent = bendDraftEdge(draft, 0, 0.5, { x: 50, y: -30 })
    const p = cubicPoint(curveOf(bent, 0), 0.5)
    expect(p.x).toBeCloseTo(50, 6)
    expect(p.y).toBeCloseTo(-30, 6)
    // The bend survives closing; the closing edge is straight.
    const shape = closeDraft(bent)!
    expect(shape.segs[0].hOut).not.toBeNull()
    expect(shape.segs[2].hOut).toBeNull()
    expect(shape.segs[0].hIn).toBeNull()
  })

  it('moves a point and takes back the last one', () => {
    const draft = moveDraftPoint(draw([0, 0], [100, 0], [100, 100]), 1, { x: 120, y: 10 })
    expect(draft.segs[1].p).toEqual({ x: 120, y: 10 })
    const bent = bendDraftEdge(draft, 1, 0.5, { x: 140, y: 60 })
    const back = removeLastPoint(bent)
    expect(back.segs).toHaveLength(2)
    expect(back.segs[1].hOut).toBeNull()
    expect(removeLastPoint(EMPTY_DRAFT)).toBe(EMPTY_DRAFT)
  })

  it('finds the first point (to close), other points and edges', () => {
    const draft = draw([0, 0], [100, 0], [100, 100])
    expect(hitDraft(draft, { x: 7, y: 5 }, tol)).toEqual({ kind: 'close' })
    expect(hitDraft(draw([0, 0], [100, 0]), { x: 3, y: 2 }, tol)).toEqual({ kind: 'point', index: 0 })
    expect(hitDraft(draft, { x: 102, y: 98 }, tol)).toEqual({ kind: 'point', index: 2 })
    const edge = hitDraft(draft, { x: 30, y: 4 }, tol)
    expect(edge?.kind).toBe('edge')
    if (edge?.kind === 'edge') {
      expect(edge.curveIndex).toBe(0)
      expect(edge.t).toBeCloseTo(0.3, 3)
    }
    // The would-be closing edge is not part of the draft yet.
    expect(hitDraft(draft, { x: 50, y: 50 }, tol)).toBeNull()
  })
})
