import paper from 'paper'
import type { EffectSource, ImperfectionParams } from './types.ts'
import type { MarkData } from '../illustrator/types.ts'
import type { EffectProcessor } from './registry.ts'

/**
 * Imperfection redraws every outline of the mark as a hand would: each
 * contour is resampled, softened (ink spreading into corners), then moved by
 * a noise field: a slow wobble plus a fine grain.
 *
 * The wobble is a smooth warp of the whole plane, so the two edges of a thin
 * bar drift together: strokes wander instead of pinching shut, and holes
 * never close. The grain then roughens each edge along its normal.
 *
 * All noise lives in the mark's own coordinates, not along each contour, so
 * the result is a pure function of the path data and the params, and parts
 * that don't move keep their exact wobble while something else is dragged or
 * carved (contour order and start points don't matter).
 */

// Headless Paper.js scope, only used to read curves out of path data.
let imperfectionScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!imperfectionScope) {
    imperfectionScope = new paper.PaperScope()
    imperfectionScope.setup(new paper.Size(1, 1))
  }
  imperfectionScope.activate()
  return imperfectionScope
}

// Everything is relative to the mark's size, so a 40-unit mark and a
// 500-unit mark look equally handmade.
const WOBBLE_AMPLITUDE = 0.016       // × size at wobble = 1
const WOBBLE_WAVELENGTH = 0.22       // × size
const WOBBLE_DETAIL_WAVELENGTH = 0.075
const GRAIN_AMPLITUDE = 0.0032       // × size at grain = 1
const GRAIN_WAVELENGTH = 0.02
const SOFTEN_RADIUS = 0.022          // × size at soften = 1 (Gaussian sigma)
const SAMPLE_SPACING = 0.012         // × size, without grain
const GRAIN_SAMPLE_SPACING = 0.0055  // × size, fine enough to carry the grain
const MAX_SAMPLES_PER_CONTOUR = 1600
// The grain on a small contour (a dot, a pinhole) is held to this share of
// its perimeter, so it never closes up or turns inside out.
const MAX_GRAIN_PER_PERIMETER = 0.008
const MAX_SOFTEN_PER_PERIMETER = 0.035

interface Pt {
  x: number
  y: number
}

interface Contour {
  points: Pt[]
  /** Cumulative arc length at each sample. */
  arc: number[]
  perimeter: number
}

export function isImperfectionActive(params: ImperfectionParams): boolean {
  return params.enabled && (params.wobble > 0 || params.grain > 0 || params.soften > 0)
}

// --- Noise --------------------------------------------------------------

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Smooth 2D value noise in [-1, 1]. */
function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const u = fade(x - ix)
  const v = fade(y - iy)
  const a = hash(ix, iy, seed)
  const b = hash(ix + 1, iy, seed)
  const c = hash(ix, iy + 1, seed)
  const d = hash(ix + 1, iy + 1, seed)
  const top = a + (b - a) * u
  const bottom = c + (d - c) * u
  return top + (bottom - top) * v
}

// --- Geometry -------------------------------------------------------------

function readContours(pathData: string, spacing: number): Contour[] {
  const scope = getScope()
  let item: paper.PathItem
  try {
    item = new scope.CompoundPath({ pathData, insert: false })
  } catch {
    return []
  }
  const paths: paper.Path[] = item instanceof scope.CompoundPath
    ? (item.children as paper.Path[])
    : [item as unknown as paper.Path]

  const contours: Contour[] = []
  for (const path of paths) {
    const curves = path.curves
    if (curves.length === 0) continue
    const perimeter = path.length
    if (!(perimeter > 0)) continue
    const step = Math.max(spacing, perimeter / MAX_SAMPLES_PER_CONTOUR)

    const points: Pt[] = []
    const arc: number[] = []
    let walked = 0
    for (const curve of curves) {
      const length = curve.length
      if (length <= 1e-9) continue
      // Every curve starts on a sample, so corners stay where they are
      // until softening rounds them on purpose.
      const n = Math.max(1, Math.ceil(length / step))
      for (let i = 0; i < n; i++) {
        const offset = (i / n) * length
        const p = curve.getPointAt(offset)
        if (!p) continue
        points.push({ x: p.x, y: p.y })
        arc.push(walked + offset)
      }
      walked += length
    }
    // An open path is filled as if closed; close its gap the same way.
    if (points.length >= 3) contours.push({ points, arc, perimeter: walked })
  }
  return contours
}

/** Gaussian smoothing by arc length around a closed contour: ink spreading into corners. */
function soften(contour: Contour, sigma: number): Pt[] {
  const { points, arc, perimeter } = contour
  const n = points.length
  if (sigma <= 1e-9) return points
  const reach = sigma * 2.5
  const twoSigmaSq = 2 * sigma * sigma
  const out: Pt[] = new Array(n)

  for (let i = 0; i < n; i++) {
    let sx = points[i].x
    let sy = points[i].y
    let sw = 1
    // Walk both ways around the loop until the weights are negligible.
    for (const dir of [1, -1]) {
      for (let k = 1; k < n; k++) {
        const j = (i + dir * k + n * k) % n
        let ds = dir > 0 ? arc[j] - arc[i] : arc[i] - arc[j]
        if (ds < 0) ds += perimeter
        if (ds > reach) break
        const w = Math.exp(-(ds * ds) / twoSigmaSq)
        sx += points[j].x * w
        sy += points[j].y * w
        sw += w
      }
    }
    out[i] = { x: sx / sw, y: sy / sw }
  }
  return out
}

/** Closed Catmull-Rom spline through the points, as cubic Bézier path data. */
function toSmoothPathData(points: Pt[]): string {
  const n = points.length
  const r = (v: number) => Math.round(v * 100) / 100
  const at = (i: number) => points[(i + n) % n]
  const parts: string[] = [`M${r(points[0].x)},${r(points[0].y)}`]
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    parts.push(`C${r(c1x)},${r(c1y)},${r(c2x)},${r(c2y)},${r(p2.x)},${r(p2.y)}`)
  }
  parts.push('Z')
  return parts.join('')
}

function contourSize(contours: Contour[]): number {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { points } of contours) {
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return Math.max(maxX - minX, maxY - minY)
}

/**
 * The handmade version of some path data. Same input, same output: safe to
 * call on every frame of a drag. Returns the input when there is nothing to do.
 */
export function imperfectPathData(pathData: string, params: ImperfectionParams): string {
  if (!pathData || !isImperfectionActive(params)) return pathData

  // Sample coarsely first just to learn the mark's size.
  const coarse = readContours(pathData, Infinity)
  const size = contourSize(coarse)
  if (!(size > 0)) return pathData

  const wobble = clamp01(params.wobble)
  const grain = clamp01(params.grain)
  const softness = clamp01(params.soften)
  const seed = Math.round(params.seed) | 0

  const spacing = size * (grain > 0 ? GRAIN_SAMPLE_SPACING : SAMPLE_SPACING)
  const contours = readContours(pathData, spacing)
  if (contours.length === 0) return pathData

  const wobbleAmp = wobble * WOBBLE_AMPLITUDE * size
  const grainAmp = grain * GRAIN_AMPLITUDE * size
  const wobbleFreq = 1 / (WOBBLE_WAVELENGTH * size)
  const detailFreq = 1 / (WOBBLE_DETAIL_WAVELENGTH * size)
  const grainFreq = 1 / (GRAIN_WAVELENGTH * size)

  const out: string[] = []
  for (const contour of contours) {
    const sigma = Math.min(softness * SOFTEN_RADIUS * size, contour.perimeter * MAX_SOFTEN_PER_PERIMETER)
    const soft = soften(contour, sigma)

    const grainHere = Math.min(grainAmp, contour.perimeter * MAX_GRAIN_PER_PERIMETER)

    const n = soft.length
    const moved: Pt[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const p = soft[i]
      let x = p.x
      let y = p.y

      if (wobbleAmp > 0) {
        const wx = p.x * wobbleFreq
        const wy = p.y * wobbleFreq
        const dx = p.x * detailFreq
        const dy = p.y * detailFreq
        x += wobbleAmp * (0.75 * noise2(wx, wy, seed) + 0.25 * noise2(dx, dy, seed + 1))
        y += wobbleAmp * (0.75 * noise2(wx, wy, seed + 2) + 0.25 * noise2(dx, dy, seed + 3))
      }

      if (grainHere > 0) {
        const prev = soft[(i - 1 + n) % n]
        const next = soft[(i + 1) % n]
        const tx = next.x - prev.x
        const ty = next.y - prev.y
        const tl = Math.hypot(tx, ty)
        if (tl > 1e-9) {
          // Along the normal (-ty, tx); its side doesn't matter, the noise is symmetric.
          const d = grainHere * noise2(p.x * grainFreq, p.y * grainFreq, seed + 4)
          x -= (ty / tl) * d
          y += (tx / tl) * d
        }
      }

      moved[i] = { x, y }
    }
    out.push(toSmoothPathData(moved))
  }
  return out.join('')
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}

// --- Effect ------------------------------------------------------------

function paramsKey(params: ImperfectionParams): string {
  return `${params.wobble}|${params.grain}|${params.soften}|${params.seed}`
}

// The canvas, previews and export all ask for the same mark: keep the last few.
const CACHE_LIMIT = 6
const cache = new Map<string, MarkData>()

function viewBoxOf(pathData: string, fallback: MarkData['viewBox']): MarkData['viewBox'] {
  const scope = getScope()
  try {
    const item = new scope.CompoundPath({ pathData, insert: false })
    const b = item.bounds
    if (b.width > 0 && b.height > 0) {
      const r = (v: number) => Math.round(v * 1000) / 1000
      return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) }
    }
  } catch {
    // keep the original frame
  }
  return fallback
}

const ImperfectionProcessor: EffectProcessor<ImperfectionParams, MarkData> = {
  id: 'imperfection',

  process(source: EffectSource, params: ImperfectionParams): MarkData | null {
    const { mark } = source
    if (!mark.compoundPathData || !isImperfectionActive(params)) return null

    const key = `${paramsKey(params)}|${mark.compoundPathData}`
    const hit = cache.get(key)
    if (hit) return hit

    const compoundPathData = imperfectPathData(mark.compoundPathData, params)
    if (compoundPathData === mark.compoundPathData) return null
    const result: MarkData = {
      compoundPathData,
      fillRule: mark.fillRule,
      viewBox: viewBoxOf(compoundPathData, mark.viewBox),
    }

    cache.set(key, result)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    return result
  },
}

/** The mark as it will be shown and exported: handmade when imperfection is on. */
export function applyImperfection(mark: MarkData | null, params: ImperfectionParams): MarkData | null {
  if (!mark) return null
  return ImperfectionProcessor.process({ mark }, params) ?? mark
}

export { ImperfectionProcessor }
