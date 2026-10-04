import { cubicPoint, distance, projectOnCubic, straightCubic, type Vec } from './bezier.ts'
import { bendCurve, curveOf, isCurveStraight, moveAnchor, type EditablePath } from './editPath.ts'

/**
 * A shape being drawn with the pen: an open run of points, in layer space.
 * Points are placed with clicks; any edge between them can be bent by
 * dragging it, even mid-drawing. Closing turns it into a filled shape.
 */
export type PenDraft = EditablePath

export const EMPTY_DRAFT: PenDraft = { closed: false, segs: [] }

/** A closed shape needs at least this many points. */
export const MIN_CLOSE_POINTS = 3

export function placePoint(draft: PenDraft, p: Vec): PenDraft {
  return { closed: false, segs: [...draft.segs, { p, hIn: null, hOut: null }] }
}

export function moveDraftPoint(draft: PenDraft, index: number, p: Vec): PenDraft {
  if (!draft.segs[index]) return draft
  return moveAnchor(draft, index, p)
}

/** Bend the edge from point `curveIndex` to the next so its point at `t` passes through `target`. */
export function bendDraftEdge(draft: PenDraft, curveIndex: number, t: number, target: Vec): PenDraft {
  if (curveIndex < 0 || curveIndex >= draft.segs.length - 1) return draft
  return bendCurve(draft, curveIndex, t, target)
}

/** Take back the last point (and the bend of the edge that led to it). */
export function removeLastPoint(draft: PenDraft): PenDraft {
  if (!draft.segs.length) return draft
  const segs = draft.segs.slice(0, -1).map((seg) => ({ ...seg }))
  if (segs.length) segs[segs.length - 1].hOut = null
  return { closed: false, segs }
}

/** Area enclosed if the draft were closed now (curves included, sampled). */
export function draftArea(draft: PenDraft): number {
  const n = draft.segs.length
  if (n < MIN_CLOSE_POINTS) return 0
  const closed: EditablePath = { closed: true, segs: draft.segs }
  const points: Vec[] = []
  for (let i = 0; i < n; i++) {
    const c = curveOf(closed, i)
    const steps = isCurveStraight(closed, i) ? 1 : 12
    for (let k = 0; k < steps; k++) points.push(cubicPoint(c, k / steps))
  }
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}

export function canClose(draft: PenDraft): boolean {
  return draft.segs.length >= MIN_CLOSE_POINTS && draftArea(draft) >= 1
}

/** The finished shape: the last point joins the first with a straight edge. */
export function closeDraft(draft: PenDraft): EditablePath | null {
  if (!canClose(draft)) return null
  const segs = draft.segs.map((seg) => ({ ...seg }))
  segs[segs.length - 1].hOut = null
  segs[0].hIn = null
  return { closed: true, segs }
}

export type DraftHit =
  | { kind: 'close' }
  | { kind: 'point'; index: number }
  | { kind: 'edge'; curveIndex: number; t: number; point: Vec }

export interface DraftTolerances {
  /** Magnet around the first point once the shape can close. */
  close: number
  point: number
  edge: number
}

/** Edge `i` of a draft, with straight edges as evenly-spaced cubics (t is then a fraction of length). */
export function draftCurve(draft: PenDraft, i: number) {
  const c = curveOf(draft, i)
  return isCurveStraight(draft, i) ? straightCubic(c[0], c[3]) : c
}

/** What a press at `p` would grab: the first point (to close), a point, or an edge. */
export function hitDraft(draft: PenDraft, p: Vec, tol: DraftTolerances): DraftHit | null {
  const n = draft.segs.length
  if (!n) return null
  if (canClose(draft) && distance(draft.segs[0].p, p) <= tol.close) return { kind: 'close' }
  let best = -1
  let bestD = tol.point
  draft.segs.forEach((seg, i) => {
    const d = distance(seg.p, p)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  if (best >= 0) return { kind: 'point', index: best }
  let edge: { curveIndex: number; t: number; point: Vec; d: number } | null = null
  for (let i = 0; i < n - 1; i++) {
    const hit = projectOnCubic(draftCurve(draft, i), p)
    if (hit.distance <= tol.edge && (!edge || hit.distance < edge.d)) {
      edge = { curveIndex: i, t: hit.t, point: hit.point, d: hit.distance }
    }
  }
  return edge ? { kind: 'edge', curveIndex: edge.curveIndex, t: edge.t, point: edge.point } : null
}
