import { add, boundsCenter, emptyBounds, includeCubic, rotate, scale, sub, type Bounds, type Vec } from '../path/bezier.ts'
import { isObjectCarveValid, syncCarve } from '../carve/sync.ts'
import { isIdentityTransform } from '../carve/edit.ts'
import type { IllustratorDocument, IllustratorTransform } from '../illustrator/types.ts'
import { repairVectorDocument, VECTOR_SCHEMA_VERSION } from './document.ts'
import { illustratorDocumentToVectorDocument, illustratorTransformFromMatrix } from './legacyImport.ts'
import type { Contour, PathObject, VectorDocument } from './types.ts'
import { isVectorDocumentV1, type VectorDocumentV1, type VectorObjectV1, type VectorPathV1 } from './v1.ts'

/**
 * The one way a document from outside the editor comes in: a link or a
 * saved mark. Version 2 is read and repaired; version 1 passes the
 * validator stage 1 shipped, then is upgraded. Null when it cannot be read.
 */
export function readVectorDocument(raw: unknown): VectorDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (version === VECTOR_SCHEMA_VERSION) return repairVectorDocument(raw)
  if (version === 1) return isVectorDocumentV1(raw) ? upgradeV1(raw) : null
  return null
}

/**
 * A layer document from before the vector format, through the importer that
 * splits it into one object per subpath, as stage 1 drew it, then upgraded.
 * Null when it cannot be read.
 */
export function readLegacyLayers(document: IllustratorDocument, fillColor?: string): VectorDocument | null {
  return upgradeV1(illustratorDocumentToVectorDocument(document, null, fillColor))
}

/**
 * A version 1 document as version 2. Each path keeps its id, name, flags,
 * fill rule, frame and generated shape; its operation comes from its source.
 * A legacy transform is baked into the points the way stage 1 drew it, and a
 * recipe takes it in through `foldTransform`, kept only while its outline
 * still matches the baked path; the path stays as stage 1 drew it. Appearance, the rest of the source, the transform, the
 * artboard, path ids and point types go. Shapes, text and groups go too: no
 * version 1 edit ever kept them. So does the selection. Null when the
 * result still cannot be read: never an empty document in its place, which
 * would open blank and be written over the link at the first edit.
 */
export function upgradeV1(document: VectorDocumentV1): VectorDocument | null {
  const upgraded: VectorDocument = {
    schemaVersion: VECTOR_SCHEMA_VERSION,
    id: document.id,
    kind: document.kind,
    activeMode: document.activeMode,
    name: document.name,
    artboards: document.artboards,
    objects: document.objects.flatMap(upgradeObject),
    guides: [],
    fillets: [],
    source: document.source,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
  // Frames on recipes, frames that are not a turn, unknown fields: as any document from outside.
  return repairVectorDocument(upgraded)
}

function upgradeObject(object: VectorObjectV1): PathObject[] {
  if (object.type !== 'path') return []
  const transform = illustratorTransformFromMatrix(object.transform)
  const contour = contourFromPath(object.path)
  const baked = bakeLegacyTransform([contour], transform)
  const synced = object.carve !== undefined ? syncCarve(object.carve, contour, transform) : null
  // A folded recipe is kept only while its outline still matches the drawing: a slice's reach, say, does not scale.
  const carve = synced && isObjectCarveValid(synced.carve, baked) ? synced.carve : undefined
  const next: PathObject = {
    id: object.id,
    name: object.name,
    parentId: null,
    visible: object.visible,
    locked: object.locked,
    type: 'path',
    operation: object.source?.compatOperation === 'subtract' ? 'subtract' : 'add',
    contours: baked,
    fillRule: object.fillRule,
  }
  if (carve) next.carve = carve
  else if (object.frame) next.frame = object.frame
  const sourceShapeId = object.source?.sourceShapeId
  if (typeof sourceShapeId === 'string') next.sourceShapeId = sourceShapeId
  return [next]
}

function contourFromPath(path: VectorPathV1): Contour {
  return {
    closed: path.closed,
    segments: path.segments.map((segment) => ({
      point: { x: segment.point.x, y: segment.point.y },
      handleIn: segment.handleIn && { x: segment.handleIn.x, y: segment.handleIn.y },
      handleOut: segment.handleOut && { x: segment.handleOut.x, y: segment.handleOut.y },
    })),
  }
}

/**
 * Contours under a legacy transform, as stage 1 drew them: scaled and turned
 * about the exact centre of their bounds, then moved. Anchors take the whole
 * map, Bézier handles its linear part. The identity leaves them as they are.
 */
export function bakeLegacyTransform(contours: Contour[], transform: IllustratorTransform): Contour[] {
  if (isIdentityTransform(transform)) return contours
  const pivot = boundsCenter(contoursBounds(contours))
  const linear = (v: Vec): Vec => rotate(scale(v, transform.scale), transform.rotation)
  const point = (p: Vec): Vec => add(add(pivot, linear(sub(p, pivot))), { x: transform.dx, y: transform.dy })
  return contours.map((contour) => ({
    closed: contour.closed,
    segments: contour.segments.map((segment) => ({
      point: point(segment.point),
      handleIn: segment.handleIn && linear(segment.handleIn),
      handleOut: segment.handleOut && linear(segment.handleOut),
    })),
  }))
}

/** The exact bounds of some contours, curves and all. */
export function contoursBounds(contours: readonly Contour[]): Bounds {
  const b = emptyBounds()
  for (const { closed, segments } of contours) {
    const count = closed ? segments.length : segments.length - 1
    if (segments.length === 1) {
      const p = segments[0].point
      includeCubic(b, [p, p, p, p])
    }
    for (let i = 0; i < count; i++) {
      const a = segments[i]
      const z = segments[(i + 1) % segments.length]
      includeCubic(b, [a.point, add(a.point, a.handleOut ?? { x: 0, y: 0 }), add(z.point, z.handleIn ?? { x: 0, y: 0 }), z.point])
    }
  }
  return b
}
