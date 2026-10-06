import type { CarveSpec } from '../engine/carve/spec.ts'
import { normalizeDegrees } from '../engine/path/bezier.ts'
import { roundCarveSpec } from '../engine/carve/spec.ts'
import { carveOutline } from '../engine/carve/outline.ts'
import { isIdentityMatrix, segsToVectorPath, syncCarve } from '../engine/carve/sync.ts'
import type { IllustratorLayer } from '../engine/illustrator/types.ts'
import { createDefaultAppearance, IDENTITY_MATRIX } from '../engine/vector/document.ts'
import { matrixFromIllustratorTransform } from '../engine/vector/legacyIllustratorAdapter.ts'
import { pathDataToVectorPaths, vectorPathToPathData } from '../engine/vector/pathSerialization.ts'
import type {
  Matrix2D,
  PathObject,
  VectorDocument,
  VectorDocumentSource,
  VectorObject,
  VectorPath,
} from '../engine/vector/types.ts'

/**
 * Pure writes over a document's objects. Objects are immutable: a write builds
 * a new array and new objects only where something changed, and hands back
 * its input, the very same reference, when nothing did. Untouched objects keep
 * their identity, so every cache keyed on them still hits.
 */

/** What a new object takes from the document it joins. */
export interface NewObjectContext {
  artboardId: string
  /** Copied onto each new object's source, beside its operation. */
  source: VectorDocumentSource
  /** The current ink. New objects take it as their appearance; existing ones keep theirs. */
  ink: string
}

export function newObjectContext(document: VectorDocument, ink: string): NewObjectContext {
  return {
    artboardId: document.artboards[0]?.id ?? '',
    source: document.source ?? {
      seed: 0,
      modeId: 'generated',
      generatorId: 'unknown',
      generatorVersion: 'v0',
      paramsHash: '',
      convertedAt: new Date().toISOString(),
    },
    ink,
  }
}

function identity(): Matrix2D {
  return { ...IDENTITY_MATRIX }
}

/* ─── The list ─── */

/** Each object through `update`, which returns it unchanged, a replacement, or several (a path split in pieces). */
export function updateObjects(
  objects: VectorObject[],
  update: (object: VectorObject, index: number) => VectorObject | VectorObject[],
): VectorObject[] {
  let changed = false
  const next = objects.flatMap((object, index) => {
    const result = update(object, index)
    if (result !== object && !(Array.isArray(result) && result.length === 1 && result[0] === object)) changed = true
    return result
  })
  return changed ? next : objects
}

/** One object by id through `update`. */
export function updateObject(
  objects: VectorObject[],
  id: string,
  update: (object: VectorObject) => VectorObject | VectorObject[],
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

/** One place in the stack: 'up' is towards the top, where later objects sit. */
export function moveObject(objects: VectorObject[], id: string, direction: 'up' | 'down'): VectorObject[] {
  const index = objects.findIndex((object) => object.id === id)
  if (index < 0) return objects
  const target = direction === 'up' ? index + 1 : index - 1
  if (target < 0 || target >= objects.length) return objects
  const next = [...objects]
  const [object] = next.splice(index, 1)
  next.splice(target, 0, object)
  return next
}

/* ─── One object ─── */

/**
 * A recipe written to an object. The path is always the outline of the
 * rounded recipe, and the transform is the identity. A recipe turns by its
 * own rotation, so it keeps no frame.
 */
export function writeRecipe(object: PathObject, carve: CarveSpec): PathObject {
  const rounded = roundCarveSpec(carve)
  if (
    object.carve &&
    !object.frame &&
    isIdentityMatrix(object.transform) &&
    JSON.stringify(object.carve) === JSON.stringify(rounded)
  ) {
    return object
  }
  const next: PathObject = {
    ...object,
    transform: identity(),
    path: segsToVectorPath(carveOutline(rounded).segs, object.path.id),
    carve: rounded,
  }
  delete next.frame
  return next
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
 * New path data for an object, already in untransformed layer space. The
 * object becomes a free shape: its recipe goes and its transform is reset.
 * Its frame stays: a gesture that turns the box writes it with writeFrame.
 * Path data with several subpaths still becomes one object per subpath.
 */
export function writePathData(object: PathObject, pathData: string): PathObject[] {
  if (pathData === vectorPathToPathData(object.path)) return [object]
  return writeContours(object, pathDataToVectorPaths(pathData))
}

/** New paths for an object: one object per path, each a free shape with the identity transform. */
export function writeContours(object: PathObject, paths: VectorPath[]): PathObject[] {
  return paths.map((path, index) => {
    const next: PathObject = {
      ...object,
      id: paths.length === 1 ? object.id : `${object.id}_${index + 1}`,
      name: paths.length === 1 ? object.name : `${object.name}.${index + 1}`,
      transform: identity(),
      path,
    }
    delete next.carve
    return next
  })
}

/** The fields of a layer that need no new geometry: name, visibility, lock, fill rule and operation. */
export function writeLayerFields(object: PathObject, layer: IllustratorLayer): PathObject {
  const source = object.source
  if (
    object.name === layer.name &&
    object.visible === layer.visible &&
    object.locked === layer.locked &&
    object.fillRule === layer.fillRule &&
    (source?.compatOperation ?? 'add') === layer.operation &&
    source?.sourceShapeId === layer.sourceShapeId
  ) {
    return object
  }
  return {
    ...object,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    fillRule: layer.fillRule,
    source: { ...source, sourceShapeId: layer.sourceShapeId, compatOperation: layer.operation },
  }
}

/**
 * The objects a layer describes, as the legacy adapter built them: a recipe
 * stays only while it matches its path and takes any transform into itself,
 * and a path with several subpaths becomes one object per subpath. With a
 * `base`, its appearance, parent, artboard and source fields are kept.
 */
export function objectsFromLayer(layer: IllustratorLayer, context: NewObjectContext, base?: PathObject): PathObject[] {
  const paths = pathDataToVectorPaths(layer.pathData)
  const synced = layer.carve && paths.length === 1 ? syncCarve(layer.carve, paths[0], layer.transform) : null
  const build = (path: VectorPath, id: string, name: string, transform: Matrix2D, carve?: CarveSpec): PathObject => {
    const object: PathObject = {
      ...(base ?? { parentId: null, artboardId: context.artboardId, appearance: createDefaultAppearance(context.ink) }),
      id,
      type: 'path',
      name,
      visible: layer.visible,
      locked: layer.locked,
      transform,
      source: {
        ...(base ? base.source : context.source),
        sourceShapeId: layer.sourceShapeId,
        compatOperation: layer.operation,
      },
      path,
      fillRule: layer.fillRule,
    }
    if (carve) object.carve = carve
    else delete object.carve
    if (!carve && layer.frameRotation) object.frame = { rotation: layer.frameRotation }
    else delete object.frame
    return object
  }
  if (synced) return [build(synced.path, layer.id, layer.name, identity(), synced.carve)]
  const transform = matrixFromIllustratorTransform(layer.transform)
  return paths.map((path, index) =>
    paths.length === 1
      ? build(path, layer.id, layer.name, { ...transform })
      : build(path, `${layer.id}_${index + 1}`, `${layer.name}.${index + 1}`, { ...transform }),
  )
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
