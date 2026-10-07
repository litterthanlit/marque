import { composeOrderedPaths, type BooleanInput } from '../boolean/operations.ts'
import type { IllustratorLayer, MarkData } from '../illustrator/types.ts'
import { asCircle } from '../geometry/asCircle.ts'
import { contoursPrimitives, outlinePrimitives, recipePrimitives, type Primitive } from '../geometry/primitives.ts'
import { arcToCubics } from '../path/arc.ts'
import { add, cubicLength, distance, dot, emptyBounds, includeCubic, includePoint, projectOnCubic, scale, splitCubic, sub, type Bounds, type Cubic, type Vec } from '../path/bezier.ts'
import type { CarveSpec } from '../carve/spec.ts'
import { pathDataToContours } from '../vector/pathSerialization.ts'
import type { Contour, Fillet, VectorObject } from '../vector/types.ts'
import { layersOf } from '../vector/view.ts'
import {
  attributeCorners,
  attributedCorners,
  cornerKind,
  endTangent,
  inkGeometry,
  inkMeasure,
  markGeometry,
  reverseCubic,
  sameBetween,
  startTangent,
  type AttributedCorner,
  type CornerSource,
  type InkGeometry,
} from './corners.ts'
import { carryPlace, type OutlinesOf } from './anchor.ts'
import { cornerArc, runTo, settleOnInk, solveFillet, type FilletSolution } from './solve.ts'

/**
 * The fillet pass: a finishing pass over the composed ink. Each fillet that
 * shows finds its corner again, the corner of the ink nearest where it last
 * sat whose two curves belong to its two objects, and is solved there. It
 * rounds the corner with a patch over the notch between the corner, its two
 * sides as far as the touch points and the fillet's arc, grown a hair
 * across the sides: added at a concave corner and cut at a convex one. The
 * patch runs beside the ink's edges, crossing them only at the touch
 * points, and shares none, so the booleans meet no edge running along
 * another. All patches go on in one pass, adds then cuts, and the ink it
 * makes is measured: should it gain or lose more than the patches cover,
 * they go on one at a time instead. A fillet whose corner is gone is lost:
 * it changes nothing and waits for a matching corner to come back near it.
 * One whose corner is there but holds no fillet, a neighbour's taking all
 * its room, changes nothing either, and says why.
 */

/** A fillet as the pass left it: where it rounded its corner, or lost. */
export type ResolvedFillet =
  | {
      id: string
      lost: false
      /** The radius asked for. */
      radius: number
      /** The radius used: less than asked where a touch point would run off its curve. */
      used: number
      corner: Vec
      convex: boolean
      centre: Vec
      touches: [Vec, Vec]
      /** Set where a fillet on the neighbouring corner cut it down, its touch point ending this one's side. */
      byNeighbour?: true
    }
  | {
      id: string
      lost: true
      radius: number
      /** Where it waits for its corner. */
      at: Vec
      /** Where its circle last was, while the document is open, and that circle's radius; else about its place, at the radius asked. */
      centre: Vec
      used: number
      /**
       * Set where its corner is there but holds no fillet: 'neighbour' where
       * a fillet on the neighbouring corner leaves it no room, 'corner'
       * where the corner alone holds none.
       */
      noRoom?: 'neighbour' | 'corner'
    }

/** What the pass makes of some ink: the rounded ink, and each fillet that shows as it resolved. */
export interface FilletPass {
  pathData: string
  viewBox: MarkData['viewBox']
  warnings: string[]
  resolved: ResolvedFillet[]
}

/* ─── What the ink is made of ─── */

/** What sort of shape an object is, as Round all matches corners: a cut is told apart from a shape. */
export function shapeKind(source: { carve?: CarveSpec; contours: Contour[] }, operation: 'add' | 'subtract'): string {
  const kind = baseKind(source)
  return operation === 'subtract' ? `cut ${kind}` : kind
}

function baseKind(source: { carve?: CarveSpec; contours: Contour[] }): string {
  if (asCircle(source)) return 'circle'
  const spec = source.carve
  if (!spec) return 'path'
  switch (spec.kind) {
    case 'slab':
      return 'slab'
    case 'punch':
      return 'punch'
    case 'polygon':
      return 'polygon'
    case 'band':
      return 'band'
    case 'channel':
    case 'slice':
      return 'groove'
    default:
      return spec satisfies never
  }
}

const sourcesCache = new WeakMap<VectorObject[], CornerSource[]>()

/** The paths that show, topmost first, as corners are read against them. Kept per objects array. */
export function cornerSources(objects: VectorObject[]): CornerSource[] {
  const cached = sourcesCache.get(objects)
  if (cached) return cached
  const shown = new Set(layersOf(objects).flatMap((layer) => (layer.visible ? [layer.id] : [])))
  const sources: CornerSource[] = []
  for (let i = objects.length - 1; i >= 0; i--) {
    const object = objects[i]
    if (object.type !== 'path' || !shown.has(object.id) || !object.contours.length) continue
    sources.push({ id: object.id, kind: shapeKind(object, object.operation), primitives: outlinePrimitives(object) })
  }
  sourcesCache.set(objects, sources)
  return sources
}

const layerSourceCache = new WeakMap<IllustratorLayer, CornerSource>()

/**
 * The layers that show in a live frame, topmost first, as corners are read
 * against them: a layer the frame replaces is read from its path or recipe
 * in the frame, and one it hides is left out.
 */
export function frameSources(layers: readonly IllustratorLayer[], replacements: ReadonlyMap<string, string | null>, carves: ReadonlyMap<string, CarveSpec>): CornerSource[] {
  const sources: CornerSource[] = []
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer.visible) continue
    if (replacements.has(layer.id)) {
      const pathData = replacements.get(layer.id)
      if (!pathData) continue
      const carve = carves.get(layer.id)
      const contours = carve ? [] : pathDataToContours(pathData)
      const primitives: Primitive[] = carve ? recipePrimitives(carve, layer.id) : contoursPrimitives(contours, layer.id)
      sources.push({ id: layer.id, kind: shapeKind({ carve, contours }, layer.operation), primitives })
      continue
    }
    if (!layer.pathData) continue
    let source = layerSourceCache.get(layer)
    if (!source) {
      const contours = layer.carve ? [] : pathDataToContours(layer.pathData)
      source = {
        id: layer.id,
        kind: shapeKind({ carve: layer.carve, contours }, layer.operation),
        primitives: layer.carve ? recipePrimitives(layer.carve, layer.id) : contoursPrimitives(contours, layer.id),
      }
      layerSourceCache.set(layer, source)
    }
    sources.push(source)
  }
  return sources
}

/* ─── Finding each fillet's corner ─── */

/** Two CSS pixels in layer units at the default zoom, where the 600-unit design area fills a canvas about 600 pixels across. */
export const MATCH_FLOOR = 2

/**
 * How near its place a fillet's corner must be to be its corner: two pixels,
 * or a quarter of its radius. Its place is carried along its first object's
 * outline to where the corner went, so a corner further off is another
 * corner, and the fillet is lost rather than moved there.
 */
export function matchReach(radius: number): number {
  return Math.max(MATCH_FLOOR, 0.25 * radius)
}

/** A place a fillet's corner is looked for, and how far from it. */
export interface Place {
  p: Vec
  reach: number
}

/** Where a fillet's corner is looked for: about its place. */
export const sat = (fillet: Fillet): Place[] => [{ p: fillet.at, reach: matchReach(fillet.radius) }]

/**
 * Each fillet's corner: of the corners between its two objects, the one
 * nearest any of the places `near` gives for it, within that place's
 * reach; the earlier place wins a tie. Nearer pairs are settled first, so
 * two fillets never take one corner.
 */
export function matchFillets(fillets: readonly Fillet[], corners: readonly AttributedCorner[], near: (fillet: Fillet) => readonly Place[] = sat): Map<string, AttributedCorner> {
  const pairs: Array<{ fillet: Fillet; corner: AttributedCorner; d: number; rank: number }> = []
  for (const fillet of fillets) {
    const places = near(fillet)
    for (const corner of corners) {
      if (!sameBetween(fillet.between, corner.between)) continue
      let best: { d: number; rank: number } | null = null
      places.forEach((place, rank) => {
        const d = distance(place.p, corner.p)
        if (d <= place.reach && (!best || d < best.d)) best = { d, rank }
      })
      if (best) pairs.push({ fillet, corner, ...(best as { d: number; rank: number }) })
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.rank - b.rank)
  const matched = new Map<string, AttributedCorner>()
  const taken = new Set<AttributedCorner>()
  for (const { fillet, corner } of pairs) {
    if (matched.has(fillet.id) || taken.has(corner)) continue
    matched.set(fillet.id, corner)
    taken.add(corner)
  }
  return matched
}

/**
 * The corners of the ink within reach of where some fillet is looked for,
 * read against the objects: only those can be a fillet's, and reading whose
 * curves a corner carries is the costly part.
 */
export function cornersNear(geometry: InkGeometry, sources: readonly CornerSource[], fillets: readonly Fillet[], near: (fillet: Fillet) => readonly Place[] = sat): AttributedCorner[] {
  const places = fillets.flatMap(near)
  const wanted = geometry.corners.filter((corner) => places.some((place) => distance(place.p, corner.p) <= place.reach))
  return wanted.length === geometry.corners.length ? attributedCorners(geometry, sources) : attributeCorners(wanted, sources)
}

/**
 * Where an edit carries a fillet's place: along its first object's outline,
 * or, where it sits on the corner of two objects, to where their outlines
 * now cross. `outlines`
 * gives an object's outline before and after the edit (the very same
 * pieces for an object the edit left alone), or null for none.
 */
export function carriedPlace(fillet: Fillet, outlines: (id: string) => OutlinesOf | null): Vec {
  const [a, b] = fillet.between
  const first = outlines(a)
  if (!first) return fillet.at
  return carryPlace(fillet.at, first, b === a ? null : outlines(b))
}

/**
 * The last place each fillet rounded its corner, while the document is
 * open: where its centre sat from its corner, and its radius, so a fillet
 * that loses its corner draws where its circle last was.
 */
const lastSolved = new Map<string, { offset: Vec; used: number }>()

/** A lost fillet as the pass leaves it: waiting at its place, drawn where its circle last was. */
function lostFillet(fillet: Fillet, at: Vec, noRoom?: 'neighbour' | 'corner'): ResolvedFillet {
  const last = lastSolved.get(fillet.id)
  return { id: fillet.id, lost: true, radius: fillet.radius, at, centre: last ? add(at, last.offset) : at, used: last?.used ?? fillet.radius, ...(noRoom ? { noRoom } : {}) }
}

/* ─── Patches ─── */

const fixed = (v: number) => (Math.round(v * 100000) / 100000).toString()

/**
 * How far the patch's edges run off the corner's two sides, away from the
 * fillet: far enough that no edge of the patch lies along one of the ink's,
 * near enough that nothing else in the ink is reached.
 */
export const PATCH_BAND = 0.05

/**
 * How far inside the fillet's circle the patch's arc runs: well clear of
 * where path data rounds to, and under the shortest curve the corner
 * finder reads, so the step it leaves at each touch point is no corner.
 */
export const TOUCH_GAP = 5e-4

const leftNormal = (d: Vec): Vec => ({ x: -d.y, y: d.x })

/** A curve moved `by` along its left normal, near enough for a band this thin. */
function offsetCubic(curve: Cubic, by: number): Cubic {
  const n0 = scale(leftNormal(startTangent(curve)), by)
  const n1 = scale(leftNormal(endTangent(curve)), by)
  return [add(curve[0], n0), add(curve[1], n0), add(curve[2], n1), add(curve[3], n1)]
}

/**
 * The patch that rounds a corner: the notch between the corner, its two
 * sides as far as the touch points and the fillet's arc, grown a hair
 * across the sides, away from the fillet. Its edges run beside the sides
 * rather than along them, and cross the ink only at the touch points, so
 * however a side bends between the corner and its touch point the patch
 * covers just the notch. Added at a concave corner, cut at a convex one;
 * with bounds it lies within.
 */
export function filletPatch(corner: AttributedCorner, solution: FilletSolution): { input: BooleanInput; bounds: Bounds } {
  const { centre, touches, radius } = solution
  /** Each side as far as its touch point, moved off the fillet's side by the band. */
  const banks = ([0, 1] as const).map((side) => {
    const run = corner.sides[side]
    const away = dot(leftNormal(startTangent(run[0])), corner.bisector) > 0 ? -PATCH_BAND : PATCH_BAND
    const near = runTo(run, touches[side])
    const start = add(corner.p, scale(leftNormal(startTangent(run[0])), away))
    return { start, curves: near.map((curve) => offsetCubic(curve, away)), end: near.length ? offsetCubic(near.at(-1)!, away)[3] : start }
  })
  const { begin, sweep } = cornerArc(corner.p, centre, touches, radius)
  const bounds = emptyBounds()
  const point = (p: Vec) => {
    includePoint(bounds, p)
    return `${fixed(p.x)},${fixed(p.y)}`
  }
  const curveTo = (c: Cubic) => `C${point(c[1])} ${point(c[2])} ${point(c[3])}`
  // Behind the corner, the two banks meet in a bevel.
  let pathData = `M${point(sub(corner.p, scale(corner.bisector, PATCH_BAND)))}L${point(banks[0].start)}`
  for (const curve of banks[0].curves) pathData += curveTo(curve)
  // The arc runs a hair inside the fillet's circle, so the patch steps across each side square to it rather than
  // grazing it where the arc touches: a boolean reads a grazing touch as a tangle of slivers.
  const arc = arcToCubics(centre, radius - TOUCH_GAP, begin, sweep)
  pathData += `L${point(arc[0][0])}`
  for (const curve of arc) pathData += curveTo(curve)
  pathData += `L${point(banks[1].end)}`
  for (const curve of [...banks[1].curves].reverse()) pathData += curveTo(reverseCubic(curve))
  pathData += 'Z'
  return { input: { pathData, operation: corner.convex ? 'subtract' : 'add' }, bounds }
}

/**
 * The stretch of outline a fillet changes, as path data: each side from a
 * short way past its touch point (`lead` along it, never past the side's
 * next corner) back to the corner. The Round tool lights it, with the
 * fillet's circle, and nothing else.
 */
export function cornerSpan(corner: AttributedCorner, touches: readonly [Vec, Vec], lead: number): string {
  const side = (k: 0 | 1) => runUpTo(corner.sides[k], lengthTo(corner.sides[k], touches[k]) + lead)
  const point = (p: Vec) => `${fixed(p.x)},${fixed(p.y)}`
  const curveTo = (c: Cubic) => `C${point(c[1])} ${point(c[2])} ${point(c[3])}`
  const before = side(0).map(reverseCubic).reverse()
  let pathData = `M${point(before.length ? before[0][0] : corner.p)}`
  for (const curve of before) pathData += curveTo(curve)
  for (const curve of side(1)) pathData += curveTo(curve)
  return pathData
}

/* ─── The ink a pass reaches ─── */

const exact = (v: number) => (Math.round(v * 100000) / 100000).toString()

function contourPathData(curves: readonly Cubic[]): string {
  const point = (p: Vec) => `${exact(p.x)},${exact(p.y)}`
  return `M${point(curves[0][0])}${curves.map((c) => `C${point(c[1])} ${point(c[2])} ${point(c[3])}`).join('')}Z`
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
}

/**
 * The ink split in two: the pieces some patch's bounds reach, each with its
 * holes, as path data for the booleans, and the others, which no patch
 * touches, kept as they are with their bounds. Null when every piece is
 * reached. A piece's bounds hold the islands in its holes, so a reached
 * island always brings the piece around it.
 */
function splitInk(geometry: InkGeometry, patches: readonly Bounds[]): { reached: string; kept: string; keptBounds: Bounds } | null {
  const { contours, parents } = geometry
  const depths: number[] = []
  const depthOf = (i: number): number => (depths[i] ??= parents[i] < 0 ? 0 : depthOf(parents[i]) + 1)
  // A hole belongs to the piece it is a hole in.
  const pieceOf = (i: number) => (depthOf(i) % 2 === 0 ? i : parents[i])
  const reachedPieces = new Set<number>()
  contours.forEach((curves, i) => {
    if (pieceOf(i) !== i) return
    const bounds = emptyBounds()
    for (const curve of curves) for (const p of curve) includePoint(bounds, p)
    if (patches.some((patch) => overlaps(bounds, patch))) reachedPieces.add(i)
  })
  if (reachedPieces.size === contours.filter((_, i) => pieceOf(i) === i).length) return null
  let reached = ''
  let kept = ''
  const keptBounds = emptyBounds()
  contours.forEach((curves, i) => {
    if (reachedPieces.has(pieceOf(i))) {
      reached += contourPathData(curves)
      return
    }
    kept += contourPathData(curves)
    for (const curve of curves) includeCubic(keptBounds, curve)
  })
  return { reached, kept, keptBounds }
}

function viewBoxWith(box: MarkData['viewBox'], bounds: Bounds, empty: boolean): MarkData['viewBox'] {
  const minX = empty ? bounds.minX : Math.min(box.x, bounds.minX)
  const minY = empty ? bounds.minY : Math.min(box.y, bounds.minY)
  const maxX = empty ? bounds.maxX : Math.max(box.x + box.width, bounds.maxX)
  const maxY = empty ? bounds.maxY : Math.max(box.y + box.height, bounds.maxY)
  const round = (v: number) => Math.round(v * 100) / 100
  return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) }
}

/* ─── The pass ─── */

/**
 * Round the corners of some ink. `sources` are what the ink is made of,
 * topmost first; `near` where each fillet's corner is looked for, by
 * default where it sat. Only fillets that show take part.
 */
export function filletInk(
  pathData: string,
  geometry: InkGeometry,
  fillets: readonly Fillet[],
  sources: readonly CornerSource[],
  near: (fillet: Fillet) => readonly Place[] = sat,
  at: (fillet: Fillet) => Vec = (fillet) => fillet.at,
): FilletPass | null {
  const shown = fillets.filter((fillet) => fillet.visible)
  if (!shown.length) return null
  const matched = matchFillets(shown, cornersNear(geometry, sources, shown, near), near)
  const resolved: ResolvedFillet[] = []
  const adds: Patch[] = []
  const cuts: Patch[] = []
  const solutions = solveInTurn(shown, matched)
  for (const fillet of shown) {
    const corner = matched.get(fillet.id)
    const solved = solutions.get(fillet.id)
    if (!corner || !solved) {
      resolved.push(lostFillet(fillet, at(fillet)))
      continue
    }
    // Its corner is there but holds no fillet: it waits on its corner, as one lost does, and says why.
    if (!solved.solution) {
      resolved.push(lostFillet(fillet, corner.p, solved.noRoom))
      continue
    }
    const { solution, byNeighbour } = solved
    lastSolved.set(fillet.id, { offset: sub(solution.centre, corner.p), used: solution.radius })
    const patch = filletPatch(corner, solution)
    ;(patch.input.operation === 'add' ? adds : cuts).push({ ...patch, area: inkMeasure(patch.input.pathData).area })
    resolved.push({
      id: fillet.id,
      lost: false,
      radius: fillet.radius,
      used: solution.radius,
      corner: corner.p,
      convex: corner.convex,
      centre: solution.centre,
      touches: solution.touches,
      ...(byNeighbour ? { byNeighbour: true as const } : {}),
    })
  }
  if (!adds.length && !cuts.length) return { pathData, viewBox: boundsOf(geometry), warnings: [], resolved }
  const patches = [...adds, ...cuts]
  // Only the pieces a patch can reach go through the booleans; the others are kept as they are.
  const split = splitInk(geometry, patches.map((patch) => patch.bounds))
  const reached = split ? split.reached : pathData
  // Ink whose contours wind every which way is read by its fill rule first, so a hole stays a hole.
  const ink: BooleanInput = geometry.oriented ? { pathData: reached, operation: 'add' } : { pathData: reached, operation: 'add', fillRule: 'evenodd' }
  let result = composeOrderedPaths([ink, ...patches.map((patch) => patch.input)])
  // All at once is much the quicker; should it come out wrong, the patches go on one at a time.
  if (!keepsTo(reached, result.compoundPathData, patches)) result = patchOneByOne(ink, patches)
  if (!split) return { pathData: result.compoundPathData, viewBox: result.viewBox, warnings: result.warnings, resolved }
  return {
    pathData: result.compoundPathData + split.kept,
    viewBox: viewBoxWith(result.viewBox, split.keptBounds, !result.compoundPathData),
    warnings: result.warnings,
    resolved,
  }
}

/** A fillet solved on its corner, moved onto the curves as drawn; null when none fits. */
function solveOn(corner: AttributedCorner, radius: number): FilletSolution | null {
  const exact = solveFillet(corner, radius)
  return exact ? settleOnInk(corner, exact) : null
}

/** A fillet solved on its corner, and whether a neighbour's span cut it down; or, with no solution, why its corner holds none. */
type Solved = { solution: FilletSolution; byNeighbour: boolean } | { solution: null; noRoom: 'neighbour' | 'corner' }

/**
 * Each matched fillet solved on its corner, in the order of the list, none
 * overlapping a neighbour: where a fillet earlier in the list touches the
 * stretch of curve between its corner and this one's, this one's side ends
 * at that touch point, so its radius is cut down to stop there. One whose
 * neighbours leave it no room at all, or whose corner holds no fillet, is
 * given no solution, and why.
 */
function solveInTurn(fillets: readonly Fillet[], matched: ReadonlyMap<string, AttributedCorner>): Map<string, Solved> {
  const solved = new Map<string, Solved>()
  const placed: Array<{ corner: AttributedCorner; solution: FilletSolution }> = []
  for (const fillet of fillets) {
    const corner = matched.get(fillet.id)
    if (!corner) continue
    const sides = neighbourSides(corner, placed)
    const solution = solveOn(sides === corner.sides ? corner : { ...corner, sides }, fillet.radius)
    if (!solution) {
      solved.set(fillet.id, { solution: null, noRoom: sides !== corner.sides && solveOn(corner, fillet.radius) ? 'neighbour' : 'corner' })
      continue
    }
    // Cut down by a neighbour: its own corner alone would hold more.
    const byNeighbour = sides !== corner.sides && solution.clamped && (solveOn(corner, fillet.radius)?.radius ?? 0) > solution.radius + HALVING_SLACK
    solved.set(fillet.id, { solution, byNeighbour })
    placed.push({ corner, solution })
  }
  return solved
}

/** How much more than a fillet's radius its own corner must hold for a neighbour to have cut it down. */
const HALVING_SLACK = 2e-3

/**
 * A corner's two sides, each ended where a fillet already placed on the
 * neighbouring corner touches the stretch of curve between them: the very
 * same sides when none does.
 */
export function neighbourSides(corner: AttributedCorner, placed: ReadonlyArray<{ corner: AttributedCorner; solution: Pick<FilletSolution, 'touches'> }>): AttributedCorner['sides'] {
  let sides: [Cubic[], Cubic[]] | null = null
  for (const other of placed) {
    for (const own of [0, 1] as const) {
      for (const theirs of [0, 1] as const) {
        const run = corner.sides[own]
        if (!sameStretch(run, other.corner.sides[theirs], corner.p, other.corner.p)) continue
        const reach = runLength(run) - lengthTo(other.corner.sides[theirs], other.solution.touches[theirs])
        sides ??= [corner.sides[0], corner.sides[1]]
        sides[own] = runUpTo(sides[own], Math.max(0, reach))
      }
    }
  }
  return sides ?? corner.sides
}

/** Is this the stretch of curve between two neighbouring corners, read from each end? */
function sameStretch(run: readonly Cubic[], other: readonly Cubic[], from: Vec, to: Vec): boolean {
  if (run.length !== other.length) return false
  const near = (p: Vec, q: Vec) => distance(p, q) < 1e-9
  return near(run.at(-1)![3], to) && near(other.at(-1)![3], from) && near(run[0][3], other.at(-1)![0])
}

function runLength(run: readonly Cubic[]): number {
  return run.reduce((sum, curve) => sum + cubicLength(curve), 0)
}

/** How far along a run of curves, from its start, the point nearest `q` lies. */
function lengthTo(run: readonly Cubic[], q: Vec): number {
  let best = { index: 0, t: 0, distance: Infinity }
  run.forEach((curve, index) => {
    const hit = projectOnCubic(curve, q)
    if (hit.distance < best.distance - 1e-9) best = { index, t: hit.t, distance: hit.distance }
  })
  return runLength(run.slice(0, best.index)) + (best.t > 0 ? cubicLength(splitCubic(run[best.index], best.t)[0]) : 0)
}

/** A run of curves from its start as far as `reach` along it. */
function runUpTo(run: readonly Cubic[], reach: number): Cubic[] {
  const out: Cubic[] = []
  let gone = 0
  for (const curve of run) {
    const length = cubicLength(curve)
    if (gone + length < reach) {
      out.push(curve)
      gone += length
      continue
    }
    // The point that far along the curve, by halving.
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (gone + cubicLength(splitCubic(curve, mid)[0]) < reach) lo = mid
      else hi = mid
    }
    if (lo > 1e-9) out.push(splitCubic(curve, lo)[0])
    break
  }
  return out.length || !run.length ? out : [splitCubic(run[0], 1e-6)[0]]
}

/** A fillet's patch, with how much ink it covers. */
type Patch = ReturnType<typeof filletPatch> & { area: number }

/**
 * Did some patches round the ink and do nothing more? The adds gain no
 * more ink than they cover and the cuts take off no more, so a hole filled
 * or a piece lost shows. Both are measured exactly; the slack is for
 * slivers the booleans drop and for the curve paper draws again where it
 * starts a contour anew, which can stray by a hundredth.
 */
function keepsTo(before: string, after: string, patches: readonly Patch[]): boolean {
  const was = inkMeasure(before).area
  const gained = inkMeasure(after).area - was
  const covered = (operation: BooleanInput['operation']) => patches.reduce((sum, patch) => sum + (patch.input.operation === operation ? patch.area : 0), 0)
  const slack = 0.5 + 2e-4 * Math.abs(was)
  return gained <= covered('add') + slack && -gained <= covered('subtract') + slack
}

/** The patches put on one at a time, each checked: one that would do more than round its corner is left off, with a warning. */
function patchOneByOne(ink: BooleanInput, patches: readonly Patch[]): ReturnType<typeof composeOrderedPaths> {
  let current = ink
  let result: ReturnType<typeof composeOrderedPaths> | null = null
  const warnings: string[] = []
  for (const patch of patches) {
    const next = composeOrderedPaths([current, patch.input])
    if (next.warnings.length || !keepsTo(current.pathData, next.compoundPathData, [patch])) {
      warnings.push('A fillet could not round its corner and was left off')
      continue
    }
    current = { pathData: next.compoundPathData, operation: 'add' }
    result = next
  }
  return { ...(result ?? composeOrderedPaths([ink])), warnings }
}

function boundsOf(geometry: InkGeometry): MarkData['viewBox'] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of geometry.rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  const round = (v: number) => Math.round(v * 100) / 100
  return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) }
}

/**
 * A composed mark with its fillets on: a new mark, carrying how each
 * fillet that shows resolved. With no fillet showing, the very same mark.
 */
export function applyFillets(base: MarkData, fillets: readonly Fillet[], sources: readonly CornerSource[]): MarkData {
  const pass = filletInk(base.compoundPathData, markGeometry(base), fillets, sources)
  if (!pass) return base
  const changed = pass.resolved.some((fillet) => !fillet.lost)
  const warnings = [...(base.warnings ?? []), ...pass.warnings]
  return {
    compoundPathData: changed ? pass.pathData : base.compoundPathData,
    fillRule: base.fillRule,
    viewBox: changed ? pass.viewBox : base.viewBox,
    ...(warnings.length ? { warnings } : {}),
    fillets: pass.resolved,
  }
}

/**
 * A live frame's ink with its fillets on, each looked for as the commit
 * will look for it: about where the gesture carries its place along its
 * first object's outline, so a fillet whose objects the gesture leaves
 * alone stays on its own corner, lost while another shape covers it.
 * `carry` gives each fillet's place on the frame; a fillet lost on the
 * frame waits there, as the commit will leave it.
 */
export function filletFrame(ink: string, fillets: readonly Fillet[], sources: readonly CornerSource[], carry: (fillet: Fillet) => Vec): FilletPass | null {
  const places = new Map<Fillet, Vec>()
  const at = (fillet: Fillet): Vec => {
    if (!places.has(fillet)) places.set(fillet, carry(fillet))
    return places.get(fillet)!
  }
  return filletInk(ink, inkGeometry(ink), fillets, sources, (fillet) => [{ p: at(fillet), reach: matchReach(fillet.radius) }], at)
}

/** The corners of a mark between objects, as the Round tool offers them: each with no fillet on it yet. */
export function freeCorners(base: MarkData, fillets: readonly Fillet[], sources: readonly CornerSource[]): AttributedCorner[] {
  const geometry = markGeometry(base)
  const corners = attributedCorners(geometry, sources)
  const taken = new Set(matchFillets(fillets, corners).values())
  return corners.filter((corner) => !taken.has(corner))
}


/**
 * A turn within this of another's is near enough the same, as Round all
 * matches corners: where bars meet circles of different sizes, the joins
 * of one kind turn by up to a few degrees apart.
 */
const SAME_TURN = (15 * Math.PI) / 180

/**
 * The corners Round all may round like a fillet: every other corner of the
 * ink with no fillet on it, shown or hidden, between the same kinds of
 * object (or of the same kind of one object), convex or concave as it is,
 * and turning within 15° of it. Empty while the fillet is lost.
 */
export function cornersLike(base: MarkData, fillets: readonly Fillet[], sources: readonly CornerSource[], filletId: string): AttributedCorner[] {
  const geometry = markGeometry(base)
  const corners = attributedCorners(geometry, sources)
  // Matched as the Round tool matches them: a hidden fillet keeps its corner.
  const matched = matchFillets(fillets, corners)
  const like = matched.get(filletId)
  if (!like) return []
  const taken = new Set(matched.values())
  const kind = cornerKind(like)
  return corners.filter((corner) => !taken.has(corner) && cornerKind(corner) === kind && corner.convex === like.convex && Math.abs(corner.turn - like.turn) <= SAME_TURN)
}

/**
 * What Round all does for a fillet: the corners like it that it rounds, in
 * turn, and how many it skips because a fillet of that radius there would
 * overlap a neighbour's, one already on the mark or one it has just added,
 * on the stretch of curve between their corners.
 */
export function roundAllPlan(base: MarkData, fillets: readonly Fillet[], sources: readonly CornerSource[], filletId: string): { corners: AttributedCorner[]; skipped: number } {
  const like = fillets.find((fillet) => fillet.id === filletId)
  const candidates = like ? cornersLike(base, fillets, sources, filletId) : []
  if (!like || !candidates.length) return { corners: [], skipped: 0 }
  // The fillets already rounding their corners, as the pass solves them.
  const shown = fillets.filter((fillet) => fillet.visible)
  const matched = matchFillets(shown, attributedCorners(markGeometry(base), sources))
  const placed: Array<{ corner: AttributedCorner; solution: FilletSolution }> = []
  const solved = solveInTurn(shown, matched)
  // A fillet that rounds nothing, its corner holding none, is like nothing.
  if (like.visible && !solved.get(like.id)?.solution) return { corners: [], skipped: 0 }
  for (const [id, { solution }] of solved) if (solution) placed.push({ corner: matched.get(id)!, solution })
  const corners: AttributedCorner[] = []
  let skipped = 0
  for (const corner of candidates) {
    const own = solveOn(corner, like.radius)
    const sides = neighbourSides(corner, placed)
    const kept = own && sides !== corner.sides ? solveOn({ ...corner, sides }, like.radius) : own
    if (own && (!kept || kept.radius < own.radius - HALVING_SLACK)) {
      skipped++
      continue
    }
    corners.push(corner)
    if (kept) placed.push({ corner, solution: kept })
  }
  return { corners, skipped }
}
