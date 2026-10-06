import { add, scale, type Cubic, type Vec } from './bezier.ts'

/**
 * Circular arcs as cubics. A piece of sweep θ has its handles along the
 * tangents at its ends, (4/3)·tan(θ/4)·r long: exact at both ends and the
 * middle, and within 0.03% of the circle between for θ up to 90°.
 */

/** Handle ratio that makes a cubic quarter arc look circular: (4/3)·tan(π/8), as stage 1 stored it. */
export const KAPPA = 0.5522847498307936

const QUARTER = Math.PI / 2

/**
 * How long an arc's handles are, as a share of its radius, for a sweep in
 * radians: (4/3)·tan(θ/4). A quarter turn gives exactly KAPPA, so quarter
 * arcs come out as they always have.
 */
export function arcHandleRatio(sweep: number): number {
  if (sweep === QUARTER) return KAPPA
  if (sweep === -QUARTER) return -KAPPA
  return (4 / 3) * Math.tan(sweep / 4)
}

/**
 * The arc about `centre` from angle `startAngle` through `sweep` (radians;
 * positive turns clockwise on screen, as angles grow with y down), as cubics
 * of at most 90° each, in order.
 */
export function arcToCubics(centre: Vec, radius: number, startAngle: number, sweep: number): Cubic[] {
  if (!(radius > 0) || sweep === 0) return []
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER - 1e-9))
  const step = sweep / count
  const h = arcHandleRatio(step) * radius
  const at = (angle: number): Vec => ({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius })
  const tangent = (angle: number): Vec => ({ x: -Math.sin(angle), y: Math.cos(angle) })
  const out: Cubic[] = []
  for (let i = 0; i < count; i++) {
    const a0 = startAngle + i * step
    const a1 = i === count - 1 ? startAngle + sweep : a0 + step
    const p0 = at(a0)
    const p3 = at(a1)
    out.push([p0, add(p0, scale(tangent(a0), h)), add(p3, scale(tangent(a1), -h)), p3])
  }
  return out
}
