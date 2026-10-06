import { boundsCenter, distance, type Vec } from '../path/bezier.ts'
import type { IllustratorTransform } from '../illustrator/types.ts'
import type { Contour, Segment } from '../vector/types.ts'
import { foldTransform, isIdentityTransform } from './edit.ts'
import { carveOutline, outlineBounds, type Seg } from './outline.ts'
import { isCarveSpec, roundCarveSpec, type CarveSpec } from './spec.ts'

/**
 * Keeps a recipe and the contour it produced in agreement. Recipes drive
 * editing; the contour drives composition, export and older builds. This is
 * the one place that decides whether a stored recipe is still trustworthy.
 */

const MATCH_TOLERANCE = 0.05

/** A contour as either schema stores it: version 1 paths add an id and point types. */
export interface ContourLike {
  closed: boolean
  segments: readonly Pick<Segment, 'point' | 'handleIn' | 'handleOut'>[]
}

function handleOrZero(h: Vec | null): Vec {
  return h ?? { x: 0, y: 0 }
}

/** Do the generated anchors match a stored contour, within tolerance? */
export function segmentsMatch(segs: Seg[], contour: ContourLike, tolerance = MATCH_TOLERANCE): boolean {
  if (!contour.closed || contour.segments.length !== segs.length) return false
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]
    const b = contour.segments[i]
    if (distance(a.p, b.point) > tolerance) return false
    if (distance(handleOrZero(a.hIn), handleOrZero(b.handleIn)) > tolerance) return false
    if (distance(handleOrZero(a.hOut), handleOrZero(b.handleOut)) > tolerance) return false
  }
  return true
}

export function segsToContour(segs: Seg[]): Contour {
  return {
    closed: true,
    segments: segs.map(
      (seg): Segment => ({
        point: { x: seg.p.x, y: seg.p.y },
        handleIn: seg.hIn ? { x: seg.hIn.x, y: seg.hIn.y } : null,
        handleOut: seg.hOut ? { x: seg.hOut.x, y: seg.hOut.y } : null,
      }),
    ),
  }
}

export interface SyncedCarve {
  carve: CarveSpec
  contour: Contour
}

/**
 * Validate a recipe against its (untransformed) contour, fold any legacy
 * transform into the recipe, and return the contour generated from the
 * rounded recipe. Returns null when the recipe should be dropped: invalid,
 * stale, or the contour no longer matches it.
 */
export function syncCarve(spec: unknown, contour: ContourLike, transform: IllustratorTransform): SyncedCarve | null {
  if (!isCarveSpec(spec)) return null
  let carve = roundCarveSpec(spec)
  let outline = carveOutline(carve)
  if (!segmentsMatch(outline.segs, contour)) return null
  if (!isIdentityTransform(transform)) {
    const pivot = boundsCenter(outlineBounds(outline))
    carve = roundCarveSpec(foldTransform(carve, transform, pivot))
    outline = carveOutline(carve)
  }
  return { carve, contour: segsToContour(outline.segs) }
}

/** Is a stored recipe consistent with its object's contours: exactly one, closed, its outline? */
export function isObjectCarveValid(carve: unknown, contours: readonly ContourLike[]): carve is CarveSpec {
  if (!isCarveSpec(carve) || contours.length !== 1) return false
  return segmentsMatch(carveOutline(roundCarveSpec(carve)).segs, contours[0])
}
