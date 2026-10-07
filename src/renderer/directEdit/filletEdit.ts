import { add, distance, dot, normalize, scale, sub, type Vec } from '../../engine/path/bezier.ts'
import type { ResolvedFillet } from '../../engine/fillet/apply.ts'
import type { IllustratorDocument } from '../../engine/illustrator/types.ts'
import { snapValue } from '../../engine/snap/snapping.ts'
import type { FilletCircle } from './hitZones.ts'

/**
 * Fillets on the canvas: where their circles and radius dots are, and the
 * radius a dot dragged to a point gives. Pure, in layer space.
 */

type Applied = Extract<ResolvedFillet, { lost: false }>

/** The circles a press can reach: a lost fillet's where its circle last was. */
export function filletCircles(fillets: readonly ResolvedFillet[]): FilletCircle[] {
  return fillets.map((fillet) => ({ id: fillet.id, c: fillet.centre, r: fillet.used }))
}

/** How far out of its corner a fillet's centre sits, per unit of radius: 1 / sin(θ/2) between two lines. */
function reachPerRadius(fillet: Applied): number {
  return fillet.used > 1e-9 ? distance(fillet.centre, fillet.corner) / fillet.used : 1
}

/** A fillet's radius dot: on its circle, the far side from its corner. */
export function filletDot(fillet: Applied): Vec {
  const out = normalize(sub(fillet.centre, fillet.corner))
  return add(fillet.centre, scale(out, fillet.used))
}

/**
 * The radius whose circle reaches `p` out of a corner, along the line from
 * the corner through the fillet's centre: the dot follows the pointer.
 */
export function radiusAt(corner: Vec, outwards: Vec, perRadius: number, p: Vec): number {
  return Math.max(0, dot(sub(p, corner), outwards)) / (perRadius + 1)
}

/** The radius a fillet's dot dragged to `p` gives. */
export function filletRadiusAt(fillet: Applied, p: Vec): number {
  return radiusAt(fillet.corner, normalize(sub(fillet.centre, fillet.corner)), reachPerRadius(fillet), p)
}

/** The sizes a fillet's radius snaps to: the other fillets', the corner radii and the circles' radii. */
export function filletSizes(doc: IllustratorDocument, sizes: { radii: number[]; circleRadii: number[]; punchRadii: number[] }, except: string | null): number[] {
  const others = (doc.fillets ?? []).flatMap((fillet) => (fillet.id === except ? [] : [fillet.radius]))
  return [...others, ...sizes.radii, ...sizes.circleRadii, ...sizes.punchRadii].filter((size) => size >= 2)
}

/** A radius snapped to the same size as another within `tolerance`, else left as it is; null when nothing is that near. */
export function snapFilletRadius(radius: number, sizes: number[], tolerance: number): number | null {
  return snapValue(radius, sizes, tolerance)
}

/**
 * What the HUD says of a fillet's radius: "r 25"; "r 18 · clamped from 25"
 * when its corner holds no more; "r 18 · clamped by a neighbour" when a
 * fillet on the neighbouring corner leaves it no more.
 */
export function radiusReadout(asked: number, fillet: ResolvedFillet | null | undefined): string {
  if (!fillet || fillet.lost || fillet.used >= asked - 0.5) return `r ${asked}`
  return fillet.byNeighbour ? `r ${Math.floor(fillet.used)} · clamped by a neighbour` : `r ${Math.floor(fillet.used)} · clamped from ${asked}`
}
