import type { IllustratorDocument, IllustratorLayer, IllustratorSource, IllustratorTransform } from '../illustrator/types.ts'
import { syncCarve } from '../carve/sync.ts'
import { createDefaultArtboard } from './document.ts'
import { pathDataToContours } from './pathSerialization.ts'
import type { Contour, VectorDocumentSource } from './types.ts'
import {
  createDefaultAppearanceV1,
  type Matrix2D,
  type PathObjectV1,
  type VectorDocumentV1,
  type VectorPathV1,
} from './v1.ts'

/**
 * The importer for `#i=` links and saved layer documents from before the
 * vector format. It builds the version 1 document stage 1 built from them,
 * one object per subpath, so they draw exactly as they always did; the
 * upgrade in `migrate.ts` takes it from there.
 */

function sourceFromIllustrator(source: IllustratorSource): VectorDocumentSource {
  return {
    seed: source.seed,
    modeId: source.modeId,
    generatorId: source.generatorId,
    generatorVersion: source.generatorVersion,
    paramsHash: '',
    convertedAt: new Date().toISOString(),
  }
}

export function matrixFromIllustratorTransform(transform: IllustratorTransform): Matrix2D {
  const radians = (transform.rotation * Math.PI) / 180
  const cos = Math.cos(radians) * transform.scale
  const sin = Math.sin(radians) * transform.scale
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: transform.dx,
    f: transform.dy,
  }
}

/** The legacy transform a matrix stood for: the way stage 1 read it, and drew it. */
export function illustratorTransformFromMatrix(matrix: Matrix2D): IllustratorTransform {
  const scale = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b)
  return {
    dx: matrix.e,
    dy: matrix.f,
    scale: scale || 1,
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
  }
}

/** A contour as a version 1 path. */
export function pathFromContour(contour: Contour): VectorPathV1 {
  return {
    id: crypto.randomUUID(),
    closed: contour.closed,
    segments: contour.segments.map((segment) => ({
      ...segment,
      pointType: segment.handleIn || segment.handleOut ? 'smooth' : 'corner',
    })),
  }
}

/**
 * A layer as stage 1 tolerated it: a link only promises a list of layers, so
 * a field that is missing or of the wrong type takes the value stage 1 drew
 * it with. Null for an entry that is not a layer at all.
 */
function readLayer(value: unknown): IllustratorLayer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const transform = (raw.transform && typeof raw.transform === 'object' ? raw.transform : {}) as Record<string, unknown>
  const finite = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)
  const layer: IllustratorLayer = {
    id: typeof raw.id === 'string' ? raw.id : typeof raw.id === 'number' ? String(raw.id) : crypto.randomUUID(),
    name: typeof raw.name === 'string' ? raw.name : '',
    operation: raw.operation === 'subtract' ? 'subtract' : 'add',
    // Stage 1 drew a layer only when its flag was truthy, so a missing one stays hidden.
    visible: Boolean(raw.visible),
    locked: typeof raw.locked === 'boolean' ? raw.locked : false,
    pathData: typeof raw.pathData === 'string' ? raw.pathData : '',
    fillRule: raw.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    transform: {
      dx: finite(transform.dx, 0),
      dy: finite(transform.dy, 0),
      scale: finite(transform.scale, 1),
      rotation: finite(transform.rotation, 0),
    },
  }
  if (raw.carve !== undefined) layer.carve = raw.carve as IllustratorLayer['carve']
  if (typeof raw.sourceShapeId === 'string') layer.sourceShapeId = raw.sourceShapeId
  if (typeof raw.frameRotation === 'number' && Number.isFinite(raw.frameRotation)) layer.frameRotation = raw.frameRotation
  return layer
}

function layerToObjects(
  value: unknown,
  artboardId: string,
  source: VectorDocumentSource,
  fillColor: string,
): PathObjectV1[] {
  const layer = readLayer(value)
  if (!layer) return []
  const contours = pathDataToContours(layer.pathData)
  const base = {
    type: 'path' as const,
    parentId: null,
    artboardId,
    visible: layer.visible,
    locked: layer.locked,
    appearance: createDefaultAppearanceV1(fillColor),
    source: { ...source, sourceShapeId: layer.sourceShapeId, compatOperation: layer.operation },
    fillRule: layer.fillRule,
  }

  // Recipe layers: keep the recipe only while it still matches the path, and
  // fold any stray transform into it so recipe layers stay untransformed.
  const synced =
    layer.carve && contours.length === 1 && isFiniteContour(contours[0])
      ? syncCarve(layer.carve, contours[0], layer.transform)
      : null
  if (synced) {
    return [{
      ...base,
      id: layer.id,
      name: layer.name,
      transform: matrixFromIllustratorTransform({ dx: 0, dy: 0, scale: 1, rotation: 0 }),
      path: pathFromContour(synced.contour),
      carve: synced.carve,
    }]
  }

  // A subpath with a number that is not finite drew nothing in stage 1: it
  // is left out, and the rest of the layer keeps the name stage 1 gave it.
  return contours.flatMap((contour, index) =>
    isFiniteContour(contour)
      ? [{
          ...(layer.frameRotation ? { frame: { rotation: layer.frameRotation } } : {}),
          ...base,
          id: contours.length === 1 ? layer.id : `${layer.id}_${index + 1}`,
          name: contours.length === 1 ? layer.name : `${layer.name}.${index + 1}`,
          transform: matrixFromIllustratorTransform(layer.transform),
          path: pathFromContour(contour),
        }]
      : [],
  )
}

function isFiniteContour(contour: Contour): boolean {
  const finite = (vec: { x: number; y: number } | null) => vec === null || (Number.isFinite(vec.x) && Number.isFinite(vec.y))
  return contour.segments.every((segment) => finite(segment.point) && finite(segment.handleIn) && finite(segment.handleOut))
}

/** A layer document as the version 1 document stage 1 made of it. */
export function illustratorDocumentToVectorDocument(
  document: IllustratorDocument,
  previous?: VectorDocumentV1 | null,
  fillColor = '#111111',
): VectorDocumentV1 {
  const now = new Date().toISOString()
  const artboard = previous?.artboards[0] ?? createDefaultArtboard()
  const source = previous?.source ?? sourceFromIllustrator(document.source)
  const objects = document.layers.flatMap((layer) => layerToObjects(layer, artboard.id, source, fillColor))

  return {
    schemaVersion: 1,
    id: previous?.id ?? document.id,
    kind: 'brand-vector',
    activeMode: previous?.activeMode ?? 'logo',
    name: previous?.name ?? 'Vector Maker document',
    artboards: [artboard],
    objects,
    selection: { targets: document.selectedLayerIds.map((objectId) => ({ type: 'object', objectId })) },
    source,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}
