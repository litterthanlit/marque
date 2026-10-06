import { add, distance, rotate, scale, sub, type Vec } from '../path/bezier.ts'
import { carveOutline } from '../carve/outline.ts'
import { isGroove, roundCarveSpec, type CarveSpec } from '../carve/spec.ts'
import { translateCarve } from '../carve/edit.ts'
import { segsToContour } from '../carve/sync.ts'
import { asCircle, type CircleSource } from '../geometry/asCircle.ts'
import type { PathObject, VectorObject } from './types.ts'

/**
 * Centre pins. A recipe whose centre was dropped on another object's centre
 * keeps `pin: { centreOf }`, and the follow pass holds it there: when the
 * object it is pinned to moves or resizes, the recipe moves with it. Only a
 * recipe takes a pin, by its centre or a groove's middle; any object with a
 * centre can hold one.
 */

/** The centre of a recipe: a slab's or punch's own, a groove's middle. */
export function recipeCentre(spec: CarveSpec): Vec {
  return isGroove(spec) ? scale(add(spec.from, spec.to), 0.5) : spec.center
}

/**
 * The centre of an object, as snapping offers it and a pin holds to it: a
 * recipe's centre, a circle's, or else the middle of the box round a free
 * shape's points, measured in its frame, as its box is drawn, so the centre
 * turns with it. Null for an object with no points.
 */
export function shapeCentre(source: CircleSource & { frame?: { rotation: number } }): Vec | null {
  if (source.carve) return recipeCentre(source.carve)
  const circle = asCircle(source)
  if (circle) return circle.c
  const rotation = source.frame?.rotation ?? 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const contour of source.contours) {
    for (const segment of contour.segments) {
      const point = rotate(segment.point, -rotation)
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  return minX <= maxX ? rotate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, rotation) : null
}

/** Can an object take a pin: is it a recipe? A free shape stores no centre. */
export function takesPin(object: VectorObject | undefined): object is PathObject & { carve: CarveSpec } {
  return object?.type === 'path' && object.carve !== undefined
}

/** How far a pinned centre may sit from its target and still be on it: past the rounding of stored recipes. */
export const PIN_SLACK = 0.02

/** Would pinning `id` to `target` close a loop of pins? */
export function pinLoops(objects: readonly VectorObject[], id: string, target: string): boolean {
  const byId = new Map(objects.map((object) => [object.id, object]))
  const seen = new Set<string>()
  let at: string | undefined = target
  while (at !== undefined && !seen.has(at)) {
    if (at === id) return true
    seen.add(at)
    const object = byId.get(at)
    at = object?.type === 'path' ? object.pin?.centreOf : undefined
  }
  return false
}

/** An object without its pin. */
export function unpinned(object: PathObject): PathObject {
  if (!object.pin) return object
  const { pin: _pin, ...rest } = object
  return rest
}

/**
 * The recipes an edit let go of because what they were pinned to went:
 * deleted, made a guide, or merged into another shape. Recipes that went
 * too are left out, as are pins let go of while their target stayed.
 */
export function pinsLostWithTarget(before: readonly VectorObject[], after: readonly VectorObject[]): string[] {
  const now = new Map(after.map((object) => [object.id, object]))
  return before.flatMap((object) => {
    if (object.type !== 'path' || !object.pin || now.has(object.pin.centreOf)) return []
    const later = now.get(object.id)
    return later?.type === 'path' && !later.pin ? [object.id] : []
  })
}

/**
 * Pins that would hold in a loop are broken: walking the stack from the
 * bottom, the pin that would close a loop goes. A pin on an object that
 * cannot take one goes too. The same array when none does.
 */
export function breakPinLoops(objects: VectorObject[]): VectorObject[] {
  let next = objects
  for (let i = 0; i < objects.length; i++) {
    const object = next[i]
    if (object.type !== 'path' || !object.pin) continue
    const others = next.map((each, index) => (index === i ? unpinned(object) : each))
    if (takesPin(object) && !pinLoops(others, object.id, object.pin.centreOf)) continue
    next = others
  }
  return next
}

/** A recipe moved so its centre lands on `centre`, its contour the outline of the rounded recipe. */
function centredOn(object: PathObject & { carve: CarveSpec }, centre: Vec): PathObject & { carve: CarveSpec } {
  const carve = roundCarveSpec(translateCarve(object.carve, sub(centre, recipeCentre(object.carve))))
  return { ...object, carve, contours: [segsToContour(carveOutline(carve).segs)] }
}

/**
 * The pins of some objects brought up to date after an edit. `changed`
 * names the objects the edit touched. A recipe pinned to an object that
 * changed moves onto its centre, and anything pinned to it follows in turn.
 * A recipe whose own edit took its centre off its target's, which did not
 * change, lets go: dragging it away unpins it. A pin to an object that is
 * gone, or has no centre, goes. With `changed` null, as a document opens,
 * pins are only checked: nothing moves, and a pin whose recipe is not on
 * its target's centre goes, so what was stored is what is read.
 * Returns the objects, the same array when nothing moved, and every id moved.
 */
export function followPins(objects: VectorObject[], changed: ReadonlySet<string> | null): { objects: VectorObject[]; moved: Set<string> } {
  const moved = new Set<string>()
  let next = breakPinLoops(objects)
  if (!next.some((object) => object.type === 'path' && object.pin)) return { objects: next, moved }
  const touched = (id: string) => changed !== null && (changed.has(id) || moved.has(id))
  for (let pass = 0; pass <= next.length; pass++) {
    let again = false
    const byId = new Map(next.map((object) => [object.id, object]))
    const updated = next.map((object) => {
      if (object.type !== 'path' || !object.pin) return object
      const target = byId.get(object.pin.centreOf)
      const centre = target?.type === 'path' && target !== object ? shapeCentre(target) : null
      if (!takesPin(object) || !centre) return unpinned(object)
      const own = recipeCentre(object.carve)
      if (touched(target!.id)) {
        const centred = centredOn(object, centre)
        if (JSON.stringify(centred.carve) === JSON.stringify(object.carve)) return object
        moved.add(object.id)
        again = true
        return centred
      }
      // As a document opens, a recipe off its target's centre is not held there: its pin goes, and it stays where it was.
      const lets = changed === null || changed.has(object.id)
      if (lets && distance(own, centre) > PIN_SLACK) return unpinned(object)
      return object
    })
    const same = updated.every((object, index) => object === next[index])
    if (!same) next = updated
    if (!again) break
  }
  return { objects: next, moved }
}
