import { add, cross, distance, dot, scale, sub, type Bounds, type Vec } from '../../engine/path/bezier.ts'
import { lineDirection, nearestOnGuide, type GuideShape } from '../../engine/vector/guides.ts'
import type { Guide } from '../../engine/vector/types.ts'

/**
 * Editing guides on the canvas, as plain sums: which guide is under the
 * pointer, where a selected guide's handles sit, and where a line drawn out
 * of guides starts. Everything is in layer space.
 */

/** A handle of one selected guide: a line's turning knob, or one of a circle's four radius squares. */
export interface GuideHandle {
  guideId: string
  id: 'rotate' | 'n' | 'e' | 's' | 'w'
  at: Vec
  /** What it turns about (a line's pivot) or scales from (a circle's centre). */
  pivot: Vec
}

/** How far out along a line its knob sits from its pivot, in CSS pixels. */
const KNOB_REACH_PX = 56

const within = (p: Vec, view: Bounds) => p.x >= view.minX && p.x <= view.maxX && p.y >= view.minY && p.y <= view.maxY

/**
 * The point a line turns about: its own point when that is in the open view
 * (in view, and under no floating bar), or else the point of it nearest the
 * middle of the open view, so the knob is always reachable.
 */
function linePivot(shape: Extract<GuideShape, { kind: 'line' }>, view: Bounds): Vec {
  if (within(shape.p, view)) return shape.p
  const middle = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 }
  const d = lineDirection(shape.angle)
  return add(shape.p, scale(d, dot(sub(middle, shape.p), d)))
}

/** The handles of a single selected guide, kept in `view`, the open part of the canvas. A path guide has none: it only moves. */
export function guideHandles(guide: Guide, view: Bounds, unitsPerPx: number): GuideHandle[] {
  const { shape } = guide
  if (guide.locked) return []
  switch (shape.kind) {
    case 'line': {
      const pivot = linePivot(shape, view)
      // The knob goes on the side of the pivot nearer the middle of the view.
      const middle = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 }
      const d = lineDirection(shape.angle)
      const side = dot(sub(middle, pivot), d) >= 0 ? 1 : -1
      const reach = KNOB_REACH_PX * unitsPerPx
      const toward = add(pivot, scale(d, side * reach))
      const away = add(pivot, scale(d, -side * reach))
      return [{ guideId: guide.id, id: 'rotate', at: within(toward, view) || !within(away, view) ? toward : away, pivot }]
    }
    case 'circle': {
      const { c, r } = shape
      return [
        { guideId: guide.id, id: 'n', at: { x: c.x, y: c.y - r }, pivot: c },
        { guideId: guide.id, id: 'e', at: { x: c.x + r, y: c.y }, pivot: c },
        { guideId: guide.id, id: 's', at: { x: c.x, y: c.y + r }, pivot: c },
        { guideId: guide.id, id: 'w', at: { x: c.x - r, y: c.y }, pivot: c },
      ]
    }
    case 'path':
      return []
    default:
      return shape satisfies never
  }
}

/** The nearest of some guides to `p`, within `reach`, and the point of it there. */
export function nearestGuide(guides: readonly Guide[], p: Vec, reach: number): { guide: Guide; point: Vec; distance: number } | null {
  let best: { guide: Guide; point: Vec; distance: number } | null = null
  for (const guide of guides) {
    const hit = nearestOnGuide(guide.shape, p)
    if (hit.distance <= reach && (!best || hit.distance < best.distance)) best = { guide, ...hit }
  }
  return best
}

/**
 * Where a new line starts when it is drawn out of guides already there: where
 * two lines within `reach` of `p` cross, when that is within reach too, or
 * else the point of the nearest guide nearest `p`. Null when none is in reach.
 */
export function startOnGuides(guides: readonly Guide[], p: Vec, reach: number): Vec | null {
  const near = guides
    .map((guide) => ({ shape: guide.shape, ...nearestOnGuide(guide.shape, p) }))
    .filter((hit) => hit.distance <= reach)
    .sort((a, b) => a.distance - b.distance)
  if (!near.length) return null
  const lines = near.flatMap((hit) => (hit.shape.kind === 'line' ? [hit.shape] : []))
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const crossing = lineCrossing(lines[i], lines[j])
      if (crossing && distance(crossing, p) <= reach) return crossing
    }
  }
  return near[0].point
}

/** Where two line guides cross, or null when they run parallel. */
function lineCrossing(a: Extract<GuideShape, { kind: 'line' }>, b: Extract<GuideShape, { kind: 'line' }>): Vec | null {
  const da = lineDirection(a.angle)
  const db = lineDirection(b.angle)
  const denominator = cross(da, db)
  if (Math.abs(denominator) < 1e-9) return null
  return add(a.p, scale(da, cross(sub(b.p, a.p), db) / denominator))
}

/** The nearest guide handle to `p`, within `reach`. */
export function nearestGuideHandle(handles: readonly GuideHandle[], p: Vec, reach: number): GuideHandle | null {
  let best: GuideHandle | null = null
  let bestD = reach
  for (const handle of handles) {
    const d = distance(handle.at, p)
    if (d <= bestD) {
      best = handle
      bestD = d
    }
  }
  return best
}
