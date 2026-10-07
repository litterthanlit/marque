import { bandParts } from '../carve/band.ts'
import { carveOutline } from '../carve/outline.ts'
import { BAND_SETTING_RANGE, bandSettings, roundCarveSpec, type BandEnd, type BandFit, type BandSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { asCircle, type Circle } from '../geometry/asCircle.ts'
import type { Guide, PathObject, VectorObject } from './types.ts'

/**
 * Bands. A band is a path whose recipe is a BandSpec, joining two circles:
 * `link: { kind: 'band', a, b }` names them, and its recipe holds snapshots
 * of both. The follow pass takes new snapshots whenever either changes, so
 * the band follows its circles. An end is an object `asCircle` reads (a
 * circle slab or punch, a spark circle, a copy of one) or a circle guide,
 * which the sheets use as often. A band is never a circle itself, so no
 * band joins bands.
 *
 * While an end is no circle, or the circles allow the band's fit none, it
 * keeps its link and its recipe and has no contours: the drawer flags it,
 * and it comes back when the circles allow it again. When an end goes, the
 * band is detached in the same edit: it keeps its geometry and its recipe,
 * as a plain band. An empty one, with nothing to keep, goes with it.
 */

export type BandLink = { kind: 'band'; a: string; b: string }
export type LinkedBand = PathObject & { carve: BandSpec; link: BandLink }

/** Is an object a band, linked or not? */
export function isBand(object: VectorObject | undefined): object is PathObject & { carve: BandSpec } {
  return object?.type === 'path' && object.carve?.kind === 'band'
}

/** Is an object a band that follows its circles? */
export function isLinkedBand(object: VectorObject | undefined): object is LinkedBand {
  return isBand(object) && object.link?.kind === 'band'
}

/** Is an object a band that follows circles that allow it no fit, or one that is not a circle? It waits, empty. */
export function isEmptyBand(object: VectorObject | undefined): boolean {
  return isLinkedBand(object) && object.contours.length === 0
}

/** A circle as a band's snapshot of it. */
export function bandEnd(circle: Circle): BandEnd {
  return { c: { x: circle.c.x, y: circle.c.y }, r: circle.r }
}

/**
 * The circle an end of a band is: an object `asCircle` reads, or a circle
 * guide. Null while it is there but no circle (a band never is one);
 * undefined when it is gone.
 */
export function bandEndCircle(id: string, byId: ReadonlyMap<string, VectorObject>, guides: ReadonlyMap<string, Guide>): Circle | null | undefined {
  const object = byId.get(id)
  if (object) return object.type === 'path' && !isBand(object) ? asCircle(object) : null
  const guide = guides.get(id)
  if (!guide) return undefined
  return guide.shape.kind === 'circle' && guide.shape.r > 0 ? { c: guide.shape.c, r: guide.shape.r } : null
}

/**
 * A band's recipe written: rounded, its contour the outline, or none while
 * its circles allow no fit. Its link stays, and so does its name; a pin or
 * a frame goes, as a band takes neither. The same object when nothing changes.
 */
export function writeBand<T extends PathObject>(object: T, carve: BandSpec): T {
  const rounded = fittingSide(roundCarveSpec(carve) as BandSpec)
  const outline = carveOutline(rounded)
  const count = outline.segs.length ? 1 : 0
  if (!object.pin && !object.frame && object.contours.length === count && object.carve && JSON.stringify(object.carve) === JSON.stringify(rounded)) return object
  const next: T = { ...object, carve: rounded, contours: count ? [segsToContour(outline.segs)] : [], fillRule: 'evenodd' }
  delete next.pin
  delete next.frame
  return next
}

/**
 * A strip on the side of its circles that fits. Which side of each circle
 * its edges touch is decided by where the circles lie across its angle: at
 * most one side fits (both only when equal circles lie along it, and then
 * they are the same strip). So a strip takes that side whenever it is
 * written, and follows a circle dragged across it. Any other band is as it is.
 */
export function fittingSide(spec: BandSpec): BandSpec {
  if (spec.fit !== 'strip' || bandParts(spec)) return spec
  const flipped: BandSpec = { ...spec, side: spec.side === -1 ? 1 : -1 }
  return bandParts(flipped) ? flipped : spec
}

/**
 * A band's recipe with new snapshots of its circles, rounded as it is
 * stored, a strip on the side that fits: what the follow pass writes, what
 * the Band tool makes, and what a live frame of a drag draws, so they are
 * the same.
 */
export function bandBetween(spec: BandSpec, a: Circle, b: Circle): BandSpec {
  return fittingSide(roundCarveSpec({ ...spec, a: bandEnd(a), b: bandEnd(b) }) as BandSpec)
}

/** What a band's controls change: its fit, and a fit's setting. */
export type BandUpdate = Partial<Pick<BandSpec, 'fit' | 'width' | 'angle' | 'radius'>>

/** The setting each fit reads. */
const FIT_SETTING = { belt: null, bar: 'width', strip: 'angle', neck: 'radius' } as const satisfies Record<BandFit, keyof BandSpec | null>

/**
 * A band's recipe with its fit or setting changed, rounded as it is stored,
 * a strip on the side that fits. A fit it had no setting for takes the
 * default, so the recipe always holds its fit's own setting.
 */
export function bandWith(spec: BandSpec, update: BandUpdate): BandSpec {
  const next: BandSpec = { ...spec, ...update }
  const key = FIT_SETTING[next.fit]
  if (key && next[key] === undefined) next[key] = bandSettings(spec)[key]
  return fittingSide(roundCarveSpec(next) as BandSpec)
}

/**
 * A band's recipe in another fit. Its setting there is the one it had,
 * where that fits, or else the nearest whole one the sliders reach that
 * does, so a band can always change to a fit its circles allow. Null when
 * they allow that fit none at all.
 */
export function bandRefitted(spec: BandSpec, fit: BandFit): BandSpec | null {
  const kept = bandWith(spec, { fit })
  if (bandParts(kept)) return kept
  const key = FIT_SETTING[fit]
  if (!key) return null
  const [min, max] = BAND_SETTING_RANGE[key]
  const from = Math.min(max, Math.max(min, Math.round(bandSettings(kept)[key])))
  // An angle turns round: 179° is next to 0°.
  const reach = key === 'angle' ? 90 : max - min
  for (let d = 0; d <= reach; d++) {
    for (const step of d ? [d, -d] : [0]) {
      const value = key === 'angle' ? (((from + step) % 180) + 180) % 180 : from + step
      if (value < min || value > max) continue
      const update: BandUpdate = { fit }
      update[key] = value
      const next = bandWith(spec, update)
      if (bandParts(next)) return next
    }
  }
  return null
}

/**
 * Why a band's circles allow it no fit, in the words a control's title
 * gives: "These circles leave no room for a neck of 30". With `any`, they
 * allow none at any setting: "no room for a neck".
 */
export function noFitReason(spec: BandSpec, any = false): string {
  const settings = bandSettings(spec)
  switch (spec.fit) {
    case 'belt':
      return 'These circles leave no room for a belt: one lies inside the other'
    case 'bar':
      return 'These circles leave no room for a bar: their centres meet'
    case 'strip':
      return any ? 'These circles leave no room for a strip at any angle' : `These circles leave no room for a strip at ${Math.round(settings.angle)}°`
    case 'neck':
      return any ? 'These circles leave no room for a neck of any radius' : `These circles leave no room for a neck of ${Math.round(settings.radius)}`
    default:
      return spec.fit satisfies never
  }
}

/** A band with new snapshots of its circles; empty, its recipe kept, while either is no circle. */
export function rebuiltBand(band: LinkedBand, a: Circle | null, b: Circle | null): LinkedBand {
  if (!a || !b) return band.contours.length ? { ...band, contours: [] } : band
  return writeBand(band, bandBetween(band.carve, a, b))
}

/** A band that no longer follows its circles: the same geometry and recipe, a plain band. */
export function detachBand<T extends PathObject>(object: T): T {
  if (object.link?.kind !== 'band') return object
  const { link: _link, ...rest } = object
  return rest as T
}

/**
 * Bands brought up to date after an edit. A band is made again when it
 * changed itself (it is new, or its fit or setting is), or an end did: an
 * object `changed` names, or a guide that is not as `guidesWere` had it. A
 * band whose end is gone is detached, and an empty one goes. With `changed`
 * null, as a document opens, bands are read as stored. The same array when
 * nothing changes.
 */
export function followBands(
  objects: VectorObject[],
  guides: readonly Guide[],
  changed: ReadonlySet<string> | null,
  guidesWere: readonly Guide[] | null,
): VectorObject[] {
  if (changed === null || !objects.some(isLinkedBand)) return objects
  const byId = new Map(objects.map((object) => [object.id, object]))
  const guideById = new Map(guides.map((guide) => [guide.id, guide]))
  const was = guidesWere ? new Map(guidesWere.map((guide) => [guide.id, guide])) : null
  const guideMoved = (id: string) => was !== null && !byId.has(id) && guideById.get(id) !== was.get(id)
  let touched = false
  const next = objects.flatMap((object) => {
    if (!isLinkedBand(object)) return [object]
    const { a, b } = object.link
    const one = bandEndCircle(a, byId, guideById)
    const two = bandEndCircle(b, byId, guideById)
    let result: VectorObject | null = object
    if (one === undefined || two === undefined) result = object.contours.length ? detachBand(object) : null
    else if (changed.has(object.id) || changed.has(a) || changed.has(b) || guideMoved(a) || guideMoved(b)) result = rebuiltBand(object, one, two)
    if (result !== object) touched = true
    return result ? [result] : []
  })
  return touched ? next : objects
}

/**
 * Do any bands follow guides that differ between `before` and `after`? Then
 * a guide edit is one the follow pass must see.
 */
export function bandsOnGuides(objects: readonly VectorObject[], before: readonly Guide[], after: readonly Guide[]): boolean {
  if (before === after) return false
  const ends = new Set(objects.flatMap((object) => (isLinkedBand(object) ? [object.link.a, object.link.b] : [])))
  if (!ends.size) return false
  const was = new Map(before.map((guide) => [guide.id, guide]))
  const now = new Map(after.map((guide) => [guide.id, guide]))
  for (const id of ends) if (was.get(id) !== now.get(id)) return true
  return false
}

/** The bands an edit left no fit: linked, drawn before it, empty after. */
export function bandsEmptiedBy(before: readonly VectorObject[], after: readonly VectorObject[]): string[] {
  const was = new Map(before.map((object) => [object.id, object]))
  return after.flatMap((object) => {
    const earlier = was.get(object.id)
    return isEmptyBand(object) && earlier?.type === 'path' && earlier.contours.length ? [object.id] : []
  })
}

/** What a link follows: an offset copy its source, a band its two circles. */
export function linkSources(link: PathObject['link']): string[] {
  if (!link) return []
  return link.kind === 'offset' ? [link.of] : [link.a, link.b]
}

/**
 * Bands whose links would close a loop or reach what they cannot follow
 * are detached: a band of itself, of the same circle twice, of a group, or
 * of another band. An end that is neither an object nor a guide is left to
 * the reference repair. A band with no outline that follows nothing, as
 * one detached here or by that repair while waiting empty, would never
 * come back: it goes. The same array when nothing changes.
 */
export function breakBandLinks(objects: VectorObject[], guideIds: ReadonlySet<string>): VectorObject[] {
  const byId = new Map(objects.map((object) => [object.id, object]))
  const fits = (id: string, self: string) => {
    if (id === self) return false
    const object = byId.get(id)
    if (!object) return guideIds.has(id)
    return object.type === 'path' && !isBand(object)
  }
  let touched = false
  const next = objects.flatMap((object) => {
    if (isBand(object) && !object.contours.length && object.link?.kind !== 'band') {
      touched = true
      return []
    }
    if (object.type !== 'path' || object.link?.kind !== 'band') return [object]
    const { a, b } = object.link
    if (isBand(object) && a !== b && fits(a, object.id) && fits(b, object.id)) return [object]
    touched = true
    return isBand(object) && !object.contours.length ? [] : [detachBand(object)]
  })
  return touched ? next : objects
}

/** The bands that follow `id`, for the bar and the drawer: their ids, in stack order. */
export function bandsOf(objects: ReadonlyArray<{ id: string; link?: PathObject['link'] }>, id: string): string[] {
  return objects.flatMap((object) => (object.link?.kind === 'band' && (object.link.a === id || object.link.b === id) ? [object.id] : []))
}
