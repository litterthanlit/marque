import { bandParts } from './band.ts'
import { bandSettings, polygonApothem, polygonCornerRadius, type BandSpec, type CarveSpec, type PolygonSpec, type SlabSpec } from './spec.ts'

/**
 * Exact offsets of recipes. A recipe made of straight sides and true arcs
 * offsets to a recipe of the same family: every side moves out by d along
 * its normal, and every arc keeps its centre and gains d on its radius. An
 * inset larger than a corner's radius leaves that corner sharp, which is
 * the true inset of a rounded corner too. Distances are in layer units, d > 0
 * outward and d < 0 inward.
 *
 * A groove, bent or not, is every point within half its width of its spine,
 * so it offsets to the same groove, wider or narrower by 2d. Other bent
 * recipes (a bent side, a corner of other fullness than a true arc) are not
 * made of sides and arcs: they take the general method.
 */

/** Nothing narrower than this, in layer units across, is left of an offset. */
export const OFFSET_MIN_SIZE = 1

/**
 * Does a recipe offset exactly? Slabs and punches do while unbent, polygons
 * and grooves always. A bent groove's copy is the groove 2d wider: where
 * half of it passes the spine's tightest radius its rails draw spurs, as a
 * groove that wide always does, rather than the true offset of the narrower
 * outline; and a slice's copy cuts edge to edge, as the slice does.
 */
export function offsetsExactly(spec: CarveSpec): boolean {
  switch (spec.kind) {
    case 'slab':
    case 'punch':
      return !spec.sides && !spec.corners
    case 'polygon':
    case 'channel':
    case 'slice':
    case 'band':
      return true
    default:
      return spec satisfies never
  }
}

/**
 * A recipe offset by `d`: larger for d > 0, smaller for d < 0. Null when the
 * recipe does not offset exactly (see offsetsExactly) or when nothing is left
 * of it, narrower than OFFSET_MIN_SIZE. The result is not rounded: writing it
 * rounds it, as any recipe.
 *
 * - a circle slab or circle punch: radius ± d;
 * - an unbent slab: width and height ± 2d, corner radius max(r ± d, 0);
 * - a polygon: radius ± d / cos(π/n), corner radius max(ρ ± d, 0), so its
 *   corners keep their centres;
 * - a square punch: as a slab, so its outset, rounded by d, is a slab;
 * - a triangle punch: the polygon it draws, of radius 1.25 r, as above;
 * - a channel or slice, bent or not: width ± 2d;
 * - a band: see offsetBand.
 */
export function offsetRecipe(spec: CarveSpec, d: number): CarveSpec | null {
  if (!offsetsExactly(spec)) return null
  switch (spec.kind) {
    case 'slab':
      return offsetSlab(spec, d)
    case 'punch': {
      if (spec.shape === 'circle') {
        const radius = spec.radius + d
        return 2 * radius < OFFSET_MIN_SIZE ? null : { ...spec, radius }
      }
      if (spec.shape === 'triangle') {
        const polygon: PolygonSpec = { v: 1, kind: 'polygon', center: spec.center, sides: 3, radius: spec.radius * 1.25, rotation: spec.rotation, cornerRadius: 0 }
        return offsetPolygon(polygon, d)
      }
      // A square punch is a box with sharp corners: an inset stays one, an outset rounds them by d.
      const half = spec.radius + d
      if (2 * half < OFFSET_MIN_SIZE) return null
      if (d <= 0) return { ...spec, radius: half }
      const slab: SlabSpec = { v: 1, kind: 'slab', preset: 'rounded', center: spec.center, width: 2 * half, height: 2 * half, radius: d, rotation: spec.rotation }
      return slab
    }
    case 'polygon':
      return offsetPolygon(spec, d)
    case 'channel':
    case 'slice': {
      const width = spec.width + 2 * d
      return width < OFFSET_MIN_SIZE ? null : { ...spec, width }
    }
    case 'band':
      return offsetBand(spec, d)
    default:
      return spec satisfies never
  }
}

function offsetSlab(spec: SlabSpec, d: number): SlabSpec | null {
  const width = spec.width + 2 * d
  const height = spec.height + 2 * d
  if (Math.min(width, height) < OFFSET_MIN_SIZE) return null
  // The radius it draws: a slab clamps its rounding to half its shorter side.
  const drawn = Math.max(0, Math.min(spec.radius, spec.width / 2, spec.height / 2))
  return { ...spec, width, height, radius: Math.max(drawn + d, 0) }
}

function offsetPolygon(spec: PolygonSpec, d: number): PolygonSpec | null {
  const apothem = polygonApothem(spec) + d
  if (2 * apothem < OFFSET_MIN_SIZE) return null
  const radius = spec.radius + d / Math.cos(Math.PI / spec.sides)
  return { ...spec, radius, cornerRadius: Math.max(polygonCornerRadius(spec) + d, 0) }
}

/**
 * A band offset by `d`, as the band between its circles offset by `d`:
 *
 * - a belt: both radii ± d, its exact offset, since it wraps its circles;
 * - a bar: width ± 2d, as a channel;
 * - a strip: both radii ± d, which moves each edge out by d and keeps its
 *   ends through the centres;
 * - a neck: both radii ± d and its arcs' radius ∓ d, which keeps the arcs'
 *   centres.
 *
 * A strip's and a neck's are exact for the mark they make with their
 * circles offset alike, whose edges and arcs they are, though not for the
 * band alone: its ends and chords lie inside the circles. Nothing is left
 * when a radius falls under half of OFFSET_MIN_SIZE, a neck's arcs to
 * nothing, or the offset circles allow no fit.
 */
function offsetBand(spec: BandSpec, d: number): BandSpec | null {
  if (spec.fit === 'bar') {
    const width = bandSettings(spec).width + 2 * d
    return width < OFFSET_MIN_SIZE ? null : { ...spec, width }
  }
  const ra = spec.a.r + d
  const rb = spec.b.r + d
  if (Math.min(ra, rb) < OFFSET_MIN_SIZE / 2) return null
  const next: BandSpec = { ...spec, a: { c: spec.a.c, r: ra }, b: { c: spec.b.c, r: rb } }
  if (spec.fit === 'neck') {
    const radius = bandSettings(spec).radius - d
    if (radius < OFFSET_MIN_SIZE / 2) return null
    next.radius = radius
  }
  return bandParts(next) ? next : null
}
