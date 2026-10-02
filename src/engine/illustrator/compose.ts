import paper from 'paper'
import type { GenerationResult, LogoParams } from '../types.ts'
import { getGenerator } from '../generators/registry.ts'
import { composeOrderedPaths } from '../boolean/operations.ts'
import type { IllustratorDocument, IllustratorLayer, MarkData } from './types.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from './types.ts'

let illustratorScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!illustratorScope) {
    illustratorScope = new paper.PaperScope()
    illustratorScope.setup(new paper.Size(1, 1))
  }
  illustratorScope.activate()
  return illustratorScope
}

function pathFromLayer(scope: paper.PaperScope, layer: IllustratorLayer): paper.PathItem | null {
  try {
    const item = new scope.CompoundPath(layer.pathData)
    if (item.isEmpty()) {
      item.remove()
      throw new Error('empty compound path')
    }
    return item
  } catch {
    try {
      const item = new scope.Path(layer.pathData)
      if (item.isEmpty()) {
        item.remove()
        return null
      }
      return item
    } catch {
      return null
    }
  }
}

export function applyLayerTransform(item: paper.Item, layer: IllustratorLayer): void {
  const { dx, dy, scale, rotation } = layer.transform
  const pivot = item.bounds.center

  if (scale !== 1) item.scale(scale, pivot)
  if (rotation !== 0) item.rotate(rotation, pivot)
  if (dx !== 0 || dy !== 0) item.translate(new paper.Point(dx, dy))
}

export function getLayerPathItem(
  scope: paper.PaperScope,
  layer: IllustratorLayer,
  applyTransform = true,
): paper.PathItem | null {
  const item = pathFromLayer(scope, layer)
  if (!item) return null
  if (applyTransform) applyLayerTransform(item, layer)
  return item
}

/**
 * Generators describe a mark as "everything added, minus everything cut".
 * Layers compose in order, so put adds first (stable) to keep a converted mark
 * identical to the generated one.
 */
export function generatedShapesInApplyOrder<T extends { pathData?: string; operation: 'add' | 'subtract' }>(
  shapes: T[],
): T[] {
  const withPath = shapes.filter((shape) => Boolean(shape.pathData))
  return [
    ...withPath.filter((shape) => shape.operation === 'add'),
    ...withPath.filter((shape) => shape.operation === 'subtract'),
  ]
}

export function createIllustratorDocument(
  result: GenerationResult,
  params: LogoParams,
): IllustratorDocument {
  const generator = getGenerator(params.generatorId)
  const layers = generatedShapesInApplyOrder(result.shapes)
    .map((shape, index): IllustratorLayer => ({
      id: `layer_${shape.id}_${index}`,
      name: `${shape.type} ${index + 1}`,
      sourceShapeId: shape.id,
      operation: shape.operation,
      visible: true,
      locked: false,
      pathData: shape.pathData ?? '',
      fillRule: 'evenodd',
      transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
    }))

  return {
    id: crypto.randomUUID(),
    source: {
      seed: params.seed,
      modeId: params.modeId,
      generatorId: params.generatorId,
      generatorVersion: generator?.version ?? 'v0',
    },
    layers,
    selectedLayerIds: layers[0] ? [layers[0].id] : [],
    pointSelection: null,
    mode: 'object',
  }
}

export function composeIllustratorMark(doc: IllustratorDocument | null): MarkData | null {
  if (!doc) return null

  const scope = getScope()
  scope.project.clear()

  const inputs: Array<{ pathData: string; operation: 'add' | 'subtract' }> = []

  for (const layer of doc.layers) {
    if (!layer.visible || !layer.pathData) continue
    const item = getLayerPathItem(scope, layer, true)
    if (!item) continue
    const pathData = item.pathData
    item.remove()
    if (!pathData) continue
    inputs.push({ pathData, operation: layer.operation })
  }

  scope.project.clear()

  if (inputs.length === 0) {
    return {
      compoundPathData: '',
      fillRule: 'evenodd',
      viewBox: { x: 0, y: 0, width: 0, height: 0 },
    }
  }

  const result = composeOrderedPaths(inputs)
  return {
    compoundPathData: result.compoundPathData,
    fillRule: 'evenodd',
    viewBox: result.viewBox,
  }
}

export function isIllustratorSourceStale(
  doc: IllustratorDocument | null,
  params: LogoParams,
): boolean {
  if (!doc) return false
  // A carved slab has no generated source to drift from.
  if (doc.source.generatorId === 'slab') return false
  const generator = getGenerator(params.generatorId)
  return (
    doc.source.seed !== params.seed ||
    doc.source.modeId !== params.modeId ||
    doc.source.generatorId !== params.generatorId ||
    doc.source.generatorVersion !== (generator?.version ?? 'v0')
  )
}
