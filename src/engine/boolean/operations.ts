import paper from 'paper'
import type { CompositeLayer } from '../types.ts'

interface BooleanInput {
  pathData: string
  operation: 'add' | 'subtract'
}

interface BooleanResult {
  layers: CompositeLayer[]
  compoundPathData: string
  fillRule: 'nonzero' | 'evenodd'
  viewBox: { x: number; y: number; width: number; height: number }
  warnings: string[]
}

// Headless Paper.js scope for boolean operations
let booleanScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!booleanScope) {
    booleanScope = new paper.PaperScope()
    booleanScope.setup(new paper.Size(1, 1))
  }
  booleanScope.activate()
  return booleanScope
}

function pathFromSVG(
  scope: paper.PaperScope,
  pathData: string,
): paper.PathItem | null {
  try {
    const path = new scope.Path(pathData)
    if (path.isEmpty()) {
      path.remove()
      return null
    }
    return path
  } catch {
    return null
  }
}

/**
 * Boolean composition via Paper.js. Paper objects are used internally only;
 * all returned data is structured-clone safe (plain strings/numbers/objects).
 */
export function composeBooleanResult(inputs: BooleanInput[]): BooleanResult {
  const warnings: string[] = []
  const scope = getScope()
  scope.project.clear()

  const addInputs = inputs.filter((i) => i.operation === 'add')
  const subInputs = inputs.filter((i) => i.operation === 'subtract')

  if (addInputs.length === 0) {
    return {
      layers: [],
      compoundPathData: '',
      fillRule: 'nonzero',
      viewBox: { x: 0, y: 0, width: 0, height: 0 },
      warnings: ['No additive shapes provided'],
    }
  }

  // Unite all additive shapes
  let result: paper.PathItem | null = null
  for (const input of addInputs) {
    const path = pathFromSVG(scope, input.pathData)
    if (!path) continue

    if (!result) {
      result = path
    } else {
      try {
        const united: paper.PathItem = result.unite(path)
        result.remove()
        path.remove()
        result = united
      } catch (e) {
        warnings.push(`Boolean unite failed: ${e}`)
        path.remove()
      }
    }
  }

  if (!result) {
    return {
      layers: [],
      compoundPathData: '',
      fillRule: 'nonzero',
      viewBox: { x: 0, y: 0, width: 0, height: 0 },
      warnings: ['All additive paths were empty or invalid'],
    }
  }

  // Subtract all subtractive shapes
  for (const input of subInputs) {
    const path = pathFromSVG(scope, input.pathData)
    if (!path) continue

    try {
      const subtracted: paper.PathItem = result!.subtract(path)
      result!.remove()
      path.remove()
      result = subtracted
    } catch (e) {
      warnings.push(`Boolean subtract failed: ${e}`)
      path.remove()
    }
  }

  // Export result
  const pathData = result!.pathData
  const bounds = result!.bounds
  result!.remove()
  const layers = buildCompositeLayers(addInputs, subInputs)

  return {
    layers,
    compoundPathData: pathData,
    fillRule: 'evenodd',
    viewBox: {
      x: Math.round(bounds.x * 100) / 100,
      y: Math.round(bounds.y * 100) / 100,
      width: Math.round(bounds.width * 100) / 100,
      height: Math.round(bounds.height * 100) / 100,
    },
    warnings,
  }
}

function buildCompositeLayers(
  addInputs: BooleanInput[],
  subInputs: BooleanInput[],
): CompositeLayer[] {
  const layers: CompositeLayer[] = []

  const additiveLayer = mergeLayerPaths(addInputs)
  if (additiveLayer) {
    layers.push({
      id: 'additive',
      operation: 'add',
      pathData: additiveLayer,
      fillRule: 'evenodd',
    })
  }

  const subtractiveLayer = mergeLayerPaths(subInputs)
  if (subtractiveLayer) {
    layers.push({
      id: 'subtractive',
      operation: 'subtract',
      pathData: subtractiveLayer,
      fillRule: 'evenodd',
    })
  }

  return layers
}

function mergeLayerPaths(inputs: BooleanInput[]): string {
  if (inputs.length === 0) return ''

  const scope = getScope()
  scope.project.clear()

  let merged: paper.PathItem | null = null

  for (const input of inputs) {
    const path = pathFromSVG(scope, input.pathData)
    if (!path) continue

    if (!merged) {
      merged = path
      continue
    }

    try {
      const united = merged.unite(path)
      merged.remove()
      path.remove()
      merged = united
    } catch {
      path.remove()
    }
  }

  if (!merged) return ''

  const pathData = merged.pathData
  merged.remove()
  scope.project.clear()
  return pathData
}
