import { distance } from '../path/bezier.ts'
import { outlinePrimitives } from '../geometry/primitives.ts'
import { composeBaseMark } from '../vector/export.ts'
import type { Fillet, VectorObject } from '../vector/types.ts'
import type { OutlinesOf } from './anchor.ts'
import { carriedPlace, cornerSources, cornersNear, matchFillets, matchReach } from './apply.ts'
import { markGeometry } from './corners.ts'

/**
 * Fillets follow their corners. A fillet's place is anchored to its first
 * object's outline: after an edit it is carried to the same place on that
 * outline, or, where it sits on the corner of two objects, to where their
 * outlines now cross, so it tracks a shape dragged, turned or resized, lost
 * or not. Its corner
 * is then the corner of the ink between its objects within two pixels or a
 * quarter of its radius of that place; with none there it is lost, never
 * moved to another corner, and waits at the place for its corner to come
 * back. A fillet between objects that are gone goes with them, in the same
 * edit.
 */

/** How near a fillet's place may be to its corner, unrounded, and be left as it is. */
const SETTLED = 0.005

const round = (v: number) => Math.round(v * 100) / 100 || 0

/**
 * The fillets after an edit of the objects: those whose objects are gone
 * removed, the others moved onto the corners they now resolve to. `was`
 * holds the objects before the edit, by id; `changed` the ids it touched.
 * Each fillet's place is carried along its objects' outlines as the edit
 * left them; one whose corner is not found there waits at that place. The
 * very same array when nothing moves.
 */
export function followFillets(
  objects: VectorObject[],
  fillets: Fillet[],
  was: ReadonlyMap<string, VectorObject> | null,
  changed: ReadonlySet<string>,
): Fillet[] {
  if (!fillets.length) return fillets
  const paths = new Set(objects.flatMap((object) => (object.type === 'path' ? [object.id] : [])))
  const kept = fillets.filter((fillet) => paths.has(fillet.between[0]) && paths.has(fillet.between[1]))
  // Any change to the objects may move a corner: the base mark it reads is the one the canvas draws next.
  if (!kept.length || !changed.size) return kept.length === fillets.length ? fillets : kept
  const base = composeBaseMark(objects)
  const geometry = markGeometry(base)
  const byId = new Map(objects.map((object) => [object.id, object]))
  const outlines = (id: string): OutlinesOf | null => {
    const now = byId.get(id)
    if (now?.type !== 'path') return null
    const after = outlinePrimitives(now)
    const before = changed.has(id) ? was?.get(id) : now
    return { was: before?.type === 'path' ? outlinePrimitives(before) : after, now: after }
  }
  const places = new Map(kept.map((fillet) => [fillet, carriedPlace(fillet, outlines)]))
  const near = (fillet: Fillet) => [{ p: places.get(fillet) ?? fillet.at, reach: matchReach(fillet.radius) }]
  const matched = matchFillets(kept, cornersNear(geometry, cornerSources(objects), kept, near), near)
  let moved = kept.length !== fillets.length
  const next = kept.map((fillet) => {
    // A lost fillet waits where its corner would be, carried with its objects.
    const p = matched.get(fillet.id)?.p ?? places.get(fillet)!
    // Places are stored to a hundredth: a fillet already there, to that, is left as it is.
    const at = { x: round(p.x), y: round(p.y) }
    if ((at.x === fillet.at.x && at.y === fillet.at.y) || distance(p, fillet.at) <= SETTLED) return fillet
    moved = true
    return { ...fillet, at }
  })
  return moved ? next : fillets
}
