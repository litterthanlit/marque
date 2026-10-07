import { carveOutline } from '../carve/outline.ts'
import { offsetRecipe, offsetsExactly } from '../carve/offset.ts'
import { carveLayerName, roundCarveSpec, type CarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { offsetContours } from '../geometry/offset.ts'
import { linkSources } from './bands.ts'
import type { Contour, Guide, ObjectLink, PathObject, VectorObject } from './types.ts'

/**
 * Offset copies. A copy remembers the object it was made from and how far
 * out (or, negative, in) it lies: `link: { kind: 'offset', of, distance }`.
 * The follow pass makes it again whenever its source changes. A recipe with
 * an exact offset gives a recipe, so the copy has handles and follows on
 * every frame of a drag; anything else gives free contours by the general
 * method, made at the commit. A copy whose source leaves nothing at its
 * distance keeps its link and is empty until the source grows back.
 */

export type OffsetLink = { kind: 'offset'; of: string; distance: number }
export type OffsetCopy = PathObject & { link: OffsetLink }

export function isOffsetCopy(object: VectorObject | undefined): object is OffsetCopy {
  return object?.type === 'path' && object.link?.kind === 'offset'
}

/**
 * Is an object a copy whose source leaves nothing at its distance? It keeps
 * its link and comes back when its source grows, so what follows it (a pin,
 * its guides) waits for it rather than letting go.
 */
export function isEmptyCopy(object: VectorObject | undefined): boolean {
  return isOffsetCopy(object) && object.contours.length === 0
}

/** What an offset makes: a recipe and its outline, or free contours. */
export interface OffsetGeometry {
  carve?: CarveSpec
  contours: Contour[]
}

/**
 * The furthest a copy may lie from its source. The slider reaches 120; a
 * link or saved mark from elsewhere that goes further is read at this
 * distance, as the general method's work grows with the square of it.
 */
export const MAX_OFFSET = 600

/** Is the source a recipe its copies follow exactly, on every frame? */
export function followsExactly(source: Pick<PathObject, 'carve'>): boolean {
  return source.carve !== undefined && offsetsExactly(source.carve)
}

/** A general offset made recently: kept so that it is not made again. */
interface Made {
  contours: Contour[]
  fillRule: PathObject['fillRule']
  distance: number
  result: Contour[] | null
}

/**
 * How many general offsets are kept, the most recently used first: one for
 * each copy the last follow pass met that is made by the general method,
 * and a few more for the slider's last steps. So one pass never pushes out
 * what it made itself, and the next edit finds every copy's offset kept;
 * bounded by the document, whatever history holds.
 */
const SPARE = 12
let kept = SPARE
const recent: Made[] = []

/**
 * The general offset of some contours, from those kept when it can be:
 * the same contours, or the same moved, as a drag or a nudge of the source
 * leaves them, whose offset is the kept one moved alike.
 */
function generalOffset(contours: Contour[], fillRule: PathObject['fillRule'], distance: number): Contour[] | null {
  let result: Contour[] | null | undefined
  const at = recent.findIndex((made) => made.contours === contours && made.fillRule === fillRule && made.distance === distance)
  if (at >= 0) result = recent[at].result
  else {
    for (const made of recent) {
      if (made.fillRule !== fillRule || made.distance !== distance) continue
      const by = shiftBetween(made.contours, contours)
      if (!by) continue
      result = made.result && made.result.map((contour) => movedContour(contour, by))
      break
    }
    if (result === undefined) result = offsetContours(contours, fillRule, distance)
  }
  if (at >= 0) recent.splice(at, 1)
  recent.unshift({ contours, fillRule, distance, result })
  recent.length = Math.min(recent.length, kept)
  return result
}

/** Is the general offset of these contours at this distance kept, as is or moved? Then it costs nothing. */
function generalOffsetKept(contours: Contour[], fillRule: PathObject['fillRule'], distance: number): boolean {
  return recent.some(
    (made) => made.fillRule === fillRule && made.distance === distance && (made.contours === contours || shiftBetween(made.contours, contours) !== null),
  )
}

/** How far `b` lies from `a` when it is `a` moved, every point alike and every handle the same; else null. */
function shiftBetween(a: readonly Contour[], b: readonly Contour[]): { x: number; y: number } | null {
  if (a.length !== b.length || !a.length || !a[0].segments.length || a[0].segments.length !== b[0].segments.length) return null
  const by = { x: b[0].segments[0].point.x - a[0].segments[0].point.x, y: b[0].segments[0].point.y - a[0].segments[0].point.y }
  const same = (p: { x: number; y: number } | null, q: { x: number; y: number } | null) => (p === null ? q === null : q !== null && Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9)
  for (let k = 0; k < a.length; k++) {
    const from = a[k]
    const to = b[k]
    if (from.closed !== to.closed || from.segments.length !== to.segments.length) return null
    for (let i = 0; i < from.segments.length; i++) {
      const p = from.segments[i]
      const q = to.segments[i]
      if (Math.abs(q.point.x - p.point.x - by.x) > 1e-9 || Math.abs(q.point.y - p.point.y - by.y) > 1e-9) return null
      if (!same(p.handleIn, q.handleIn) || !same(p.handleOut, q.handleOut)) return null
    }
  }
  return by
}

function movedContour(contour: Contour, by: { x: number; y: number }): Contour {
  return { ...contour, segments: contour.segments.map((segment) => ({ ...segment, point: { x: segment.point.x + by.x, y: segment.point.y + by.y } })) }
}

/**
 * A source offset by `distance`: the offset recipe and its outline when
 * there is an exact one, else the general offset of its contours. Null when
 * nothing is left, and while the source is a band its circles allow no fit:
 * its recipe is kept, but there is nothing to offset.
 */
export function offsetGeometry(source: Pick<PathObject, 'carve' | 'contours' | 'fillRule'>, distance: number): OffsetGeometry | null {
  if (source.carve?.kind === 'band' && !source.contours.length) return null
  if (source.carve && offsetsExactly(source.carve)) {
    const offset = offsetRecipe(source.carve, distance)
    if (!offset) return null
    const carve = roundCarveSpec(offset)
    return { carve, contours: [segsToContour(carveOutline(carve).segs)] }
  }
  const contours = generalOffset(source.contours, source.fillRule, distance)
  return contours ? { contours } : null
}

/**
 * Can the offset be had at once: an exact one, or a general one already
 * made? A live preview reads it on every step only then, and waits for the
 * slider to rest otherwise.
 */
export function offsetIsQuick(source: Pick<PathObject, 'carve' | 'contours' | 'fillRule'>, distance: number): boolean {
  return followsExactly(source) || generalOffsetKept(source.contours, source.fillRule, distance)
}

/** Does a copy of this object follow exactly, without the general method? */
function followsGivenExactly(source: VectorObject | undefined): boolean {
  return source?.type === 'path' && followsExactly(source)
}

/** A copy made again from its source, or the very same copy when nothing about it changes. */
export function rebuiltCopy(copy: OffsetCopy, source: PathObject): OffsetCopy {
  const made = offsetGeometry(source, copy.link.distance)
  if (!made) {
    if (!copy.contours.length && !copy.carve && !copy.pin && !copy.frame) return copy
    return clean({ ...copy, contours: [] }, undefined)
  }
  if (made.carve) {
    if (copy.carve && !copy.pin && !copy.frame && JSON.stringify(copy.carve) === JSON.stringify(made.carve)) return copy
    return clean({ ...copy, contours: made.contours, fillRule: 'evenodd' }, made.carve)
  }
  if (!copy.carve && !copy.pin && !copy.frame && copy.contours === made.contours) return copy
  return clean({ ...copy, contours: made.contours, fillRule: 'evenodd' }, undefined)
}

/** A copy with the recipe it now carries, if any, and no pin or frame: it follows its source alone. */
function clean(copy: OffsetCopy, carve: CarveSpec | undefined): OffsetCopy {
  const next: OffsetCopy = { ...copy }
  if (carve) next.carve = carve
  else delete next.carve
  delete next.pin
  delete next.frame
  return next
}

/** A copy that no longer follows anything: the same geometry, a plain object. */
export function detachOffset<T extends PathObject>(object: T): T {
  if (object.link?.kind !== 'offset') return object
  const { link: _link, ...rest } = object
  return rest as T
}

/**
 * Offset copies brought up to date after an edit. `changed` names the
 * objects the edit touched: a copy is made again when it changed itself (it
 * is new, or its distance is) or its source did, after its source is
 * brought up to date, so an offset of an offset follows too. A copy whose
 * source is gone, or is not a path, is detached and keeps its geometry; an
 * empty one, which has none to keep, goes with its source. With `changed`
 * null, as a document opens, copies are read as stored. The same array when
 * nothing changes.
 */
export function followOffsets(objects: VectorObject[], changed: ReadonlySet<string> | null): VectorObject[] {
  if (changed === null || !objects.some(isOffsetCopy)) return objects
  const byId = new Map(objects.map((object) => [object.id, object]))
  kept = SPARE + objects.filter((object) => isOffsetCopy(object) && !followsGivenExactly(byId.get(object.link.of))).length
  /** Each copy as it settles: null when it goes. */
  const settled = new Map<string, VectorObject | null>()
  const visiting = new Set<string>()
  const moved = new Set(changed)
  const settle = (object: VectorObject): VectorObject | null => {
    if (!isOffsetCopy(object)) return object
    const done = settled.get(object.id)
    if (done !== undefined) return done
    // A loop of copies cannot follow itself: the read repair breaks any.
    if (visiting.has(object.id)) return object
    visiting.add(object.id)
    const found = byId.get(object.link.of)
    const source = found ? settle(found) : null
    let next: VectorObject | null = object
    if (source?.type !== 'path') next = object.contours.length ? detachOffset(object) : null
    else if (source.id === object.id) next = detachOffset(object)
    else if (moved.has(source.id) || moved.has(object.id)) next = rebuiltCopy(object, source)
    if (next !== object) moved.add(object.id)
    visiting.delete(object.id)
    settled.set(object.id, next)
    return next
  }
  let touched = false
  const next = objects.flatMap((object) => {
    const result = settle(object)
    if (result !== object) touched = true
    return result ? [result] : []
  })
  return touched ? next : objects
}

/**
 * The name a copy that stopped following takes: a name it was given by hand
 * stays, and the one it was made with ("Inset −55"), which tells what it
 * follows, gives way to what a new layer of its kind is called, its recipe's
 * name or `freeName()` for a free shape.
 */
export function nameDetached(object: PathObject, distance: number, freeName: () => string): string {
  if (object.name !== offsetName(distance)) return object.name
  return object.carve ? carveLayerName(object.carve) : freeName()
}

/**
 * Objects after an edit, every copy whose link the edit ended named as
 * `nameDetached` says: detached by hand, its own geometry edited, or its
 * source gone. The same array when none is renamed.
 */
export function renameDetached(before: readonly VectorObject[], after: VectorObject[], freeName: () => string): VectorObject[] {
  const was = new Map(before.filter(isOffsetCopy).map((object) => [object.id, object.link.distance]))
  if (!was.size) return after
  let touched = false
  const next = after.map((object) => {
    const distance = was.get(object.id)
    if (distance === undefined || object.type !== 'path' || isOffsetCopy(object)) return object
    const name = nameDetached(object, distance, freeName)
    if (name === object.name) return object
    touched = true
    return { ...object, name }
  })
  return touched ? next : after
}

/**
 * The copies and bands an edit stopped following without being told to:
 * `gone`, a source went (deleted, made a guide, merged into another shape;
 * a band's circle guide deleted); `edited`, their own geometry was edited.
 * Those that went too are left out, and so are those detached by hand,
 * which keep their geometry while their sources stay. `guides` are the
 * guides after the edit, which a band may follow.
 */
export function linksEndedBy(before: readonly VectorObject[], after: readonly VectorObject[], guides: readonly Guide[] = []): { gone: string[]; edited: string[] } {
  const now = new Map(after.map((object) => [object.id, object]))
  const guideIds = new Set(guides.map((guide) => guide.id))
  const gone: string[] = []
  const edited: string[] = []
  for (const object of before) {
    if (object.type !== 'path' || !object.link) continue
    const later = now.get(object.id)
    if (later?.type !== 'path' || later.link?.kind === object.link.kind) continue
    const there = (id: string) => now.get(id)?.type === 'path' || (object.link!.kind === 'band' && guideIds.has(id))
    if (!linkSources(object.link).every(there)) gone.push(object.id)
    else if (later.contours !== object.contours) edited.push(object.id)
  }
  return { gone, edited }
}

/**
 * Copies that would follow each other in a loop are detached, walking the
 * stack from the bottom: the link that closes a loop goes, and so does a
 * link to an object that is not a path. The same array when none does.
 */
export function breakOffsetLoops(objects: VectorObject[]): VectorObject[] {
  let next = objects
  for (let i = 0; i < next.length; i++) {
    const object = next[i]
    if (!isOffsetCopy(object)) continue
    const byId = new Map(next.map((each) => [each.id, each]))
    const seen = new Set<string>([object.id])
    let at: VectorObject | undefined = byId.get(object.link.of)
    let loops = at?.type !== 'path'
    while (!loops && isOffsetCopy(at)) {
      if (seen.has(at.id)) {
        loops = true
        break
      }
      seen.add(at.id)
      at = byId.get(at.link.of)
    }
    if (loops || at?.type !== 'path') next = next.map((each, index) => (index === i ? detachOffset(object) : each))
  }
  return next
}

/**
 * The source of a copy and of its source in turn, down to the first that
 * follows nothing: what moving the copy moves. Read from objects or from
 * their layer views alike.
 */
export function offsetRoot(objects: ReadonlyArray<{ id: string; link?: ObjectLink }>, id: string): string {
  const byId = new Map(objects.map((object) => [object.id, object]))
  const seen = new Set<string>()
  let at = id
  for (let link = byId.get(at)?.link; link?.kind === 'offset' && !seen.has(at); link = byId.get(at)?.link) {
    seen.add(at)
    if (!byId.has(link.of)) break
    at = link.of
  }
  return at
}

/**
 * Does an offset copy or a band follow, directly or through other copies
 * and bands, one of `ids`? An edit of both a source and what follows it, as
 * a box around them makes, edits the source alone: the copy or band is made
 * again from it, and keeps its link. A band on a construction circle among
 * `guides` follows, through it, the shape the guide follows.
 */
export function followsAnyOf(
  objects: ReadonlyArray<{ id: string; link?: ObjectLink }>,
  id: string,
  ids: ReadonlySet<string>,
  guides: ReadonlyArray<{ id: string; link?: { of: string } }> = [],
): boolean {
  const byId = new Map(objects.map((object) => [object.id, object]))
  const guideOf = new Map(guides.flatMap((guide) => (guide.link ? [[guide.id, guide.link.of] as const] : [])))
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    for (const end of linkSources(byId.get(queue.shift()!)?.link)) {
      const source = guideOf.get(end) ?? end
      if (ids.has(source)) return true
      if (seen.has(source)) continue
      seen.add(source)
      queue.push(source)
    }
  }
  return false
}

const MINUS = '−'

/** A distance as the bar and the drawer write it: whole units, a true minus sign for an inset. */
export function offsetDistanceText(distance: number): string {
  const whole = Math.round(distance * 100) / 100
  return whole < 0 ? `${MINUS}${Math.abs(whole)}` : String(whole)
}

/** What a copy is, "Inset" or "Outset", with its distance: "Inset −55". */
export function offsetName(distance: number): string {
  return `${distance < 0 ? 'Inset' : 'Outset'} ${offsetDistanceText(distance)}`
}
