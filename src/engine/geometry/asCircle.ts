import { add, cubicPoint, distance, type Cubic, type Vec } from '../path/bezier.ts'
import { bentEdgeCount, type CarveSpec } from '../carve/spec.ts'
import type { Contour, PathObject } from '../vector/types.ts'

/** A circle in layer space. */
export interface Circle {
  c: Vec
  r: number
}

/** What `asCircle` reads: a recipe, or else the contours. */
export type CircleSource = Pick<PathObject, 'contours'> & { carve?: CarveSpec }

/**
 * An object read as a circle, or null. A circle slab (an unbent slab, square,
 * whose corner radius is at least half its width) and an unbent circle punch
 * are circles by their recipe; a polygon never is. Any other object is one when it is a single
 * closed contour whose anchors and curve midpoints all lie within
 * max(0.05, 0.001·r) of one circle: that covers spark circles, which carry no
 * recipe.
 */
export function asCircle(object: CircleSource): Circle | null {
  const spec = object.carve
  if (spec) return recipeCircle(spec)
  if (object.contours.length !== 1) return null
  return contourCircle(object.contours[0])
}

function recipeCircle(spec: CarveSpec): Circle | null {
  if (bentEdgeCount(spec) > 0) return null
  switch (spec.kind) {
    case 'slab':
      return Math.abs(spec.width - spec.height) <= 1e-6 && spec.radius >= spec.width / 2 - 1e-6
        ? { c: spec.center, r: spec.width / 2 }
        : null
    case 'punch':
      return spec.shape === 'circle' ? { c: spec.center, r: spec.radius } : null
    case 'polygon':
      // A polygon is not a circle, even rounded as far as it goes: it keeps its sides, and [ and ] change them.
      return null
    case 'channel':
    case 'slice':
      return null
    default:
      return spec satisfies never
  }
}

/** A closed contour read as a circle: fitted to its anchors and curve midpoints, then checked against them. */
export function contourCircle(contour: Contour): Circle | null {
  const { segments } = contour
  if (!contour.closed || segments.length < 2) return null
  const samples: Vec[] = []
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]
    const b = segments[(i + 1) % segments.length]
    const curve: Cubic = [a.point, add(a.point, a.handleOut ?? ZERO), add(b.point, b.handleIn ?? ZERO), b.point]
    samples.push(a.point, cubicPoint(curve, 0.5))
  }
  const fitted = fitCircle(samples)
  if (!fitted) return null
  const tolerance = Math.max(0.05, 0.001 * fitted.r)
  return samples.every((p) => Math.abs(distance(p, fitted.c) - fitted.r) <= tolerance) ? fitted : null
}

const ZERO: Vec = { x: 0, y: 0 }

/** The circle nearest some points, by least squares on x² + y² + Dx + Ey + F; null when they are in a line. */
export function fitCircle(points: readonly Vec[]): Circle | null {
  if (points.length < 3) return null
  // Measured from their mean, so the sums stay well conditioned far from the origin.
  const mean = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 })
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sxz = 0
  let syz = 0
  let sz = 0
  for (const p of points) {
    const x = p.x - mean.x
    const y = p.y - mean.y
    const z = x * x + y * y
    sxx += x * x
    sxy += x * y
    syy += y * y
    sxz += x * z
    syz += y * z
    sz += z
  }
  // With x and y centred, D and E solve a 2 × 2 system and F is the mean of −z.
  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-12 * Math.max(1, sxx * syy)) return null
  const d = (-sxz * syy + syz * sxy) / det
  const e = (-syz * sxx + sxz * sxy) / det
  const f = -sz / points.length
  const r2 = (d * d + e * e) / 4 - f
  if (!(r2 > 0)) return null
  return { c: { x: mean.x - d / 2, y: mean.y - e / 2 }, r: Math.sqrt(r2) }
}
