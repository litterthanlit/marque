import type {
  IllustratorDocument,
  IllustratorLayer,
  IllustratorSource,
  IllustratorTransform,
  PointSelection,
} from '../illustrator/types.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../illustrator/types.ts'
import { createDefaultAppearance, createDefaultArtboard } from './document.ts'
import { pathDataToVectorPaths, vectorPathToPathData } from './pathSerialization.ts'
import type {
  Matrix2D,
  PathObject,
  VectorDocument,
  VectorDocumentSource,
  VectorObject,
  VectorSelection,
  VectorSelectionTarget,
} from './types.ts'

function sourceFromVector(source: VectorDocumentSource | null): IllustratorSource {
  return {
    seed: source?.seed ?? 0,
    modeId: source?.modeId ?? 'generated',
    generatorId: source?.generatorId ?? 'unknown',
    generatorVersion: source?.generatorVersion ?? 'v0',
  }
}

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

export function matrixFromIllustratorTransform(
  transform: IllustratorTransform,
): Matrix2D {
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

export function illustratorTransformFromMatrix(
  matrix: Matrix2D,
): IllustratorTransform {
  const scale = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b)
  return {
    dx: matrix.e,
    dy: matrix.f,
    scale: scale || 1,
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
  }
}

function vectorSelectionToLayerIds(selection: VectorSelection): string[] {
  const ids = selection.targets.map((target) => target.objectId)
  return [...new Set(ids)]
}

function vectorSelectionToPointSelection(
  selection: VectorSelection,
): PointSelection | null {
  const target = selection.targets.find(
    (candidate): candidate is Extract<VectorSelectionTarget, { type: 'anchor' | 'handle' }> =>
      candidate.type === 'anchor' || candidate.type === 'handle',
  )
  if (!target) return null
  return {
    layerId: target.objectId,
    segmentIndex: target.segmentIndex,
    handle: target.type === 'anchor' ? 'anchor' : target.handle,
  }
}

function pointSelectionToVectorSelection(
  pointSelection: PointSelection | null,
  selectedLayerIds: string[],
): VectorSelection {
  if (pointSelection) {
    return {
      targets: [
        pointSelection.handle === 'anchor' || pointSelection.handle === null
          ? {
              type: 'anchor',
              objectId: pointSelection.layerId,
              segmentIndex: pointSelection.segmentIndex,
            }
          : {
              type: 'handle',
              objectId: pointSelection.layerId,
              segmentIndex: pointSelection.segmentIndex,
              handle: pointSelection.handle,
            },
      ],
    }
  }

  return {
    targets: selectedLayerIds.map((objectId) => ({ type: 'object', objectId })),
  }
}

function vectorObjectToLayer(object: VectorObject): IllustratorLayer | null {
  if (object.type !== 'path') return null
  return {
    id: object.id,
    name: object.name,
    sourceShapeId: object.source?.sourceShapeId,
    operation: object.source?.compatOperation ?? 'add',
    visible: object.visible,
    locked: object.locked,
    pathData: vectorPathToPathData(object.path),
    fillRule: object.fillRule,
    transform: illustratorTransformFromMatrix(object.transform),
  }
}

export function vectorDocumentToIllustratorDocument(
  document: VectorDocument,
  previous?: IllustratorDocument | null,
): IllustratorDocument {
  const selectedLayerIds = vectorSelectionToLayerIds(document.selection)
  return {
    id: previous?.id ?? document.id,
    source: sourceFromVector(document.source),
    layers: document.objects
      .map(vectorObjectToLayer)
      .filter((layer): layer is IllustratorLayer => layer != null),
    selectedLayerIds,
    pointSelection: vectorSelectionToPointSelection(document.selection),
    mode: previous?.mode ?? (document.selection.targets.some((target) => target.type !== 'object') ? 'points' : 'object'),
  }
}

function layerToObjects(
  layer: IllustratorLayer,
  artboardId: string,
  source: VectorDocumentSource,
  fillColor: string,
): PathObject[] {
  const paths = pathDataToVectorPaths(layer.pathData)
  return paths.map((path, index) => ({
    id: paths.length === 1 ? layer.id : `${layer.id}_${index + 1}`,
    type: 'path',
    name: paths.length === 1 ? layer.name : `${layer.name}.${index + 1}`,
    parentId: null,
    artboardId,
    visible: layer.visible,
    locked: layer.locked,
    transform: matrixFromIllustratorTransform(layer.transform),
    appearance: createDefaultAppearance(fillColor),
    source: {
      ...source,
      sourceShapeId: layer.sourceShapeId,
      compatOperation: layer.operation,
    },
    path,
    fillRule: layer.fillRule,
  }))
}

export function illustratorDocumentToVectorDocument(
  document: IllustratorDocument,
  previous?: VectorDocument | null,
  fillColor = '#111111',
): VectorDocument {
  const now = new Date().toISOString()
  const artboard = previous?.artboards[0] ?? createDefaultArtboard()
  const source = previous?.source ?? sourceFromIllustrator(document.source)
  const objects = document.layers.flatMap((layer) =>
    layerToObjects(layer, artboard.id, source, fillColor),
  )

  return {
    schemaVersion: 1,
    id: previous?.id ?? document.id,
    kind: 'brand-vector',
    activeMode: previous?.activeMode ?? 'logo',
    name: previous?.name ?? 'Vector Maker document',
    artboards: [artboard],
    objects,
    selection: pointSelectionToVectorSelection(document.pointSelection, document.selectedLayerIds),
    source,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}

export function createEmptyLegacyIllustratorDocument(
  previous?: IllustratorDocument | null,
): IllustratorDocument {
  return {
    id: previous?.id ?? crypto.randomUUID(),
    source: previous?.source ?? sourceFromVector(null),
    layers: [],
    selectedLayerIds: [],
    pointSelection: null,
    mode: previous?.mode ?? 'object',
  }
}

export function identityLegacyTransform(): IllustratorTransform {
  return { ...DEFAULT_ILLUSTRATOR_TRANSFORM }
}
