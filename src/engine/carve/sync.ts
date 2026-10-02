import { boundsCenter, distance, type Vec } from '../path/bezier.ts'
import type { IllustratorTransform } from '../illustrator/types.ts'
import type { Matrix2D, VectorPath, VectorPathSegment } from '../vector/types.ts'
import { foldTransform, isIdentityTransform } from './edit.ts'
import { carveOutline, outlineBounds, type Seg } from './outline.ts'
import { isCarveSpec, roundCarveSpec, type CarveSpec } from './spec.ts'

/**
 * Keeps a recipe and the path it produced in agreement. Recipes drive
 * editing; the path drives composition, export and older builds. This is the
 * one place that decides whether a stored recipe is still trustworthy.
 */

const MATCH_TOLERANCE = 0.05

function handleOrZero(h: Vec | null): Vec {
  return h ?? { x: 0, y: 0 }
}

/** Do the generated anchors match a stored path, within tolerance? */
export function segmentsMatch(segs: Seg[], path: VectorPath, tolerance = MATCH_TOLERANCE): boolean {
  if (!path.closed || path.segments.length !== segs.length) return false
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]
    const b = path.segments[i]
    if (distance(a.p, b.point) > tolerance) return false
    if (distance(handleOrZero(a.hIn), handleOrZero(b.handleIn)) > tolerance) return false
    if (distance(handleOrZero(a.hOut), handleOrZero(b.handleOut)) > tolerance) return false
  }
  return true
}

export function segsToVectorPath(segs: Seg[], id: string): VectorPath {
  return {
    id,
    closed: true,
    segments: segs.map(
      (seg): VectorPathSegment => ({
        point: { x: seg.p.x, y: seg.p.y },
        handleIn: seg.hIn ? { x: seg.hIn.x, y: seg.hIn.y } : null,
        handleOut: seg.hOut ? { x: seg.hOut.x, y: seg.hOut.y } : null,
        pointType: seg.hIn || seg.hOut ? 'smooth' : 'corner',
      }),
    ),
  }
}

const IDENTITY_TRANSFORM: IllustratorTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 }

export interface SyncedCarve {
  carve: CarveSpec
  path: VectorPath
  transform: IllustratorTransform
}

/**
 * Validate a layer's recipe against its (untransformed) path, fold any layer
 * transform into the recipe, and return the canonical path generated from the
 * rounded recipe. Returns null when the recipe should be dropped: invalid,
 * stale, or the path no longer matches it.
 */
export function syncCarve(spec: unknown, path: VectorPath, transform: IllustratorTransform): SyncedCarve | null {
  if (!isCarveSpec(spec)) return null
  let carve = roundCarveSpec(spec)
  let outline = carveOutline(carve)
  if (!segmentsMatch(outline.segs, path)) return null
  if (!isIdentityTransform(transform)) {
    const pivot = boundsCenter(outlineBounds(outline))
    carve = roundCarveSpec(foldTransform(carve, transform, pivot))
    outline = carveOutline(carve)
  }
  return { carve, path: segsToVectorPath(outline.segs, path.id), transform: { ...IDENTITY_TRANSFORM } }
}

export function isIdentityMatrix(m: Matrix2D): boolean {
  const near = (v: number, target: number) => Math.abs(v - target) < 1e-9
  return near(m.a, 1) && near(m.b, 0) && near(m.c, 0) && near(m.d, 1) && near(m.e, 0) && near(m.f, 0)
}

/** Is a stored object recipe consistent with the object's own path and transform? */
export function isObjectCarveValid(carve: unknown, path: VectorPath, transform: Matrix2D): carve is CarveSpec {
  if (!isCarveSpec(carve) || !isIdentityMatrix(transform)) return false
  return segmentsMatch(carveOutline(roundCarveSpec(carve)).segs, path)
}
