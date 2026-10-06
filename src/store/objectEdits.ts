import type { CarveSpec } from '../engine/carve/spec.ts'
import { normalizeDegrees } from '../engine/path/bezier.ts'
import { roundCarveSpec } from '../engine/carve/spec.ts'
import { carveOutline } from '../engine/carve/outline.ts'
import { segsToContour, syncCarve } from '../engine/carve/sync.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { bakeLegacyTransform } from '../engine/vector/migrate.ts'
import { contoursToPathData, contourToPathData, pathDataToContours } from '../engine/vector/pathSerialization.ts'
import { takesPin, unpinned } from '../engine/vector/pins.ts'
import type { Contour, PathObject, VectorObject } from '../engine/vector/types.ts'

/**
 * Pure writes over a document's objects. Objects are immutable: a write builds
 * a new array and new objects only where something changed, and hands back
 * its input, the very same reference, when nothing did. Untouched objects keep
 * their identity, so every cache keyed on them still hits.
 */

/* ─── The list ─── */

/** Each object through `update`, which returns it unchanged, or a replacement. */
export function updateObjects(
  objects: VectorObject[],
  update: (object: VectorObject, index: number) => VectorObject,
): VectorObject[] {
  let changed = false
  const next = objects.map((object, index) => {
    const result = update(object, index)
    if (result !== object) changed = true
    return result
  })
  return changed ? next : objects
}

/** One object by id through `update`. */
export function updateObject(
  objects: VectorObject[],
  id: string,
  update: (object: VectorObject) => VectorObject,
): VectorObject[] {
  return updateObjects(objects, (object) => (object.id === id ? update(object) : object))
}

/** New objects on top of the stack, at the bottom, or at an index (later objects sit higher). */
export function insertObjects(objects: VectorObject[], added: VectorObject[], at: 'top' | 'bottom' | number): VectorObject[] {
  if (added.length === 0) return objects
  const index = at === 'top' ? objects.length : at === 'bottom' ? 0 : Math.min(Math.max(0, at), objects.length)
  return [...objects.slice(0, index), ...added, ...objects.slice(index)]
}

export function removeObjects(objects: VectorObject[], ids: Iterable<string>): VectorObject[] {
  const gone = new Set(ids)
  const next = objects.filter((object) => !gone.has(object.id))
  return next.length === objects.length ? objects : next
}

/**
 * One place in the stack: 'up' is towards the top, where later objects sit.
 * The step is one place among the object's siblings: a group moves with its
 * members, an object steps over a whole group, and a member stays in its
 * group's run. At the end of that run it stays where it is.
 */
export function moveObject(objects: VectorObject[], id: string, direction: 'up' | 'down'): VectorObject[] {
  const index = objects.findIndex((object) => object.id === id)
  if (index < 0) return objects
  const { parentId } = objects[index]
  const end = runEnd(objects, index)
  if (direction === 'up') {
    if (end >= objects.length || objects[end].parentId !== parentId) return objects
    const nextEnd = runEnd(objects, end)
    return [...objects.slice(0, index), ...objects.slice(end, nextEnd), ...objects.slice(index, end), ...objects.slice(nextEnd)]
  }
  // The sibling below starts at the nearest object below that shares the parent; the header first means there is none.
  let start = index - 1
  while (start >= 0 && objects[start].parentId !== parentId && objects[start].id !== parentId) start--
  if (start < 0 || objects[start].parentId !== parentId) return objects
  return [...objects.slice(0, start), ...objects.slice(index, end), ...objects.slice(start, index), ...objects.slice(end)]
}

/** Where the run of the object at `index` ends: past its members, and theirs, for a group. */
function runEnd(objects: VectorObject[], index: number): number {
  const object = objects[index]
  if (object.type !== 'group') return index + 1
  const inside = new Set([object.id])
  let end = index + 1
  while (end < objects.length) {
    const parentId = objects[end].parentId
    if (parentId === null || !inside.has(parentId)) break
    inside.add(objects[end].id)
    end++
  }
  return end
}

/* ─── One object ─── */

/**
 * A recipe written to an object. Its one contour is always the outline of
 * the rounded recipe. A recipe turns by its own rotation, so it keeps no
 * frame.
 */
export function writeRecipe(object: PathObject, carve: CarveSpec): PathObject {
  const rounded = roundCarveSpec(carve)
  if (object.carve && !object.frame && JSON.stringify(object.carve) === JSON.stringify(rounded)) return object
  const next: PathObject = { ...object, contours: [segsToContour(carveOutline(rounded).segs)], carve: rounded }
  delete next.frame
  return next
}

/**
 * Pin a recipe's centre to another object's centre, or with null let it go.
 * Only a recipe takes a pin; for a free shape this is no change.
 */
export function writePin(object: PathObject, centreOf: string | null): PathObject {
  if (centreOf === null) return object.pin ? unpinned(object) : object
  if (!takesPin(object) || centreOf === object.id || object.pin?.centreOf === centreOf) return object
  return { ...object, pin: { centreOf } }
}

/** The rotation of a free path's box, rounded to 0.01°. Upright leaves no frame. */
export function writeFrame(object: PathObject, rotation: number): PathObject {
  const rounded = Math.round(normalizeDegrees(rotation) * 100) / 100
  const turned = rounded !== 0 && !object.carve
  if (turned ? object.frame?.rotation === rounded : !object.frame) return object
  const next: PathObject = { ...object }
  if (turned) next.frame = { rotation: rounded }
  else delete next.frame
  return next
}

/**
 * New path data for an object: all its contours, or with `contourIndex`
 * only that one, the others kept as they are. The object becomes a free
 * shape: its recipe goes, and so do its link and pin. Its frame stays: a
 * gesture that turns the box writes it with writeFrame. Path data of several
 * subpaths is one object of several contours: a hole stays a hole.
 */
export function writePathData(object: PathObject, pathData: string, contourIndex?: number): PathObject {
  if (contourIndex !== undefined) {
    const current = object.contours[contourIndex]
    if (!current) return object
    if (pathData === contourToPathData(current)) return object
    const [contour] = pathDataToContours(pathData)
    if (!contour) return object
    return writeContours(object, object.contours.map((each, index) => (index === contourIndex ? contour : each)))
  }
  if (pathData === contoursToPathData(object.contours)) return object
  const contours = pathDataToContours(pathData)
  return contours.length ? writeContours(object, contours) : object
}

/** New contours for an object: a free shape, its recipe, link and pin gone. */
export function writeContours(object: PathObject, contours: Contour[]): PathObject {
  const next: PathObject = { ...object, contours }
  delete next.carve
  delete next.link
  delete next.pin
  return next
}

/** The fields of a layer that need no new geometry: name, visibility, lock, fill rule, operation and generated shape. */
export function writeLayerFields(object: PathObject, layer: IllustratorLayer): PathObject {
  if (
    object.name === layer.name &&
    object.visible === layer.visible &&
    object.locked === layer.locked &&
    object.fillRule === layer.fillRule &&
    object.operation === layer.operation &&
    object.sourceShapeId === layer.sourceShapeId
  ) {
    return object
  }
  const next: PathObject = {
    ...object,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    fillRule: layer.fillRule,
    operation: layer.operation,
  }
  if (layer.sourceShapeId !== undefined) next.sourceShapeId = layer.sourceShapeId
  else delete next.sourceShapeId
  return next
}

/**
 * The object a layer describes: one object, every subpath a contour. A
 * recipe stays only while it matches its single contour, and takes any
 * legacy transform into itself; a free shape has the transform baked into
 * its points, the way stage 1 drew it. With a `base`, its parent, link,
 * pin and the fields a layer does not carry are kept.
 */
export function objectFromLayer(layer: IllustratorLayer, base?: PathObject): PathObject {
  const contours = pathDataToContours(layer.pathData)
  const synced = layer.carve && contours.length === 1 ? syncCarve(layer.carve, contours[0], layer.transform) : null
  const object: PathObject = {
    ...(base ?? { parentId: null }),
    id: layer.id,
    type: 'path',
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    operation: layer.operation,
    contours: synced ? [synced.contour] : bakeLegacyTransform(contours, layer.transform),
    fillRule: layer.fillRule,
  }
  if (layer.sourceShapeId !== undefined) object.sourceShapeId = layer.sourceShapeId
  else delete object.sourceShapeId
  if (synced) object.carve = synced.carve
  else {
    delete object.carve
    delete object.link
    delete object.pin
  }
  if (!synced && layer.frameRotation) object.frame = { rotation: layer.frameRotation }
  else delete object.frame
  return object
}

/* ─── Immutability ─── */

/** Freeze an object and everything inside it, so an edit in place throws. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}
