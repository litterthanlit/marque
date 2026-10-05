import paper from 'paper'
import { composeOrderedPaths } from '../boolean/operations.ts'
import type { IllustratorDocument, IllustratorLayer, MarkData } from './types.ts'

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

/** A layer's path with its transform applied, in layer space. */
export function layerTransformedPathData(layer: IllustratorLayer): string {
  const scope = getScope()
  scope.project.clear()
  const item = getLayerPathItem(scope, layer, true)
  const pathData = item?.pathData ?? ''
  item?.remove()
  scope.project.clear()
  return pathData
}

export function composeIllustratorMark(doc: IllustratorDocument): MarkData {
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
