import paper from 'paper'
import type { CompositeLayer } from '../types.ts'

export interface BooleanInput {
  pathData: string
  operation: 'add' | 'subtract'
  /** How an input of several contours fills: given, its holes are holes. One contour reads the same either way. */
  fillRule?: 'nonzero' | 'evenodd'
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
 * Accepts compound path data (several subpaths, e.g. a shape with holes).
 * With a fill rule, an item of several contours is resolved under that rule
 * and its contours turned so that either rule reads it alike: paper's
 * booleans honour it, and so does the even-odd ink the result is drawn as.
 */
function pathItemFromSVG(
  scope: paper.PaperScope,
  pathData: string,
  fillRule?: BooleanInput['fillRule'],
): paper.PathItem | null {
  try {
    let item: paper.PathItem = scope.PathItem.create(pathData)
    if (item.isEmpty()) {
      item.remove()
      return null
    }
    if (fillRule && item.children && item.children.length > 1) {
      item.fillRule = fillRule
      item = (item as unknown as { resolveCrossings(): paper.PathItem }).resolveCrossings()
      item.reorient(fillRule === 'nonzero', true)
    }
    return item
  } catch {
    return null
  }
}

/** Pieces of a result smaller than this, in square units, are slivers a boolean left behind. */
export const MIN_PIECE_AREA = 0.01

/**
 * The ink a piece covers. A piece no boolean has resolved yet, such as a lone
 * self-crossing input, can have lobes whose signed areas cancel, so a small
 * net area is measured again with its crossings resolved.
 */
function inkArea(piece: paper.PathItem): number {
  const net = areaOf(piece)
  if (net >= MIN_PIECE_AREA) return net
  const resolved = (piece.clone({ insert: false }) as unknown as { resolveCrossings(): paper.PathItem }).resolveCrossings()
  const parts = resolved.children ? [...resolved.children] : [resolved]
  const total = parts.reduce((sum, part) => sum + areaOf(part as paper.PathItem), 0)
  resolved.remove()
  return total
}

/** The result without its slivers; null when nothing but slivers is left. */
function dropSlivers(item: paper.PathItem): paper.PathItem | null {
  if (!item.children) {
    if (inkArea(item) >= MIN_PIECE_AREA) return item
    item.remove()
    return null
  }
  for (const piece of [...item.children]) {
    if (inkArea(piece as paper.PathItem) < MIN_PIECE_AREA) piece.remove()
  }
  return item
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

export interface OrderedBooleanResult {
  compoundPathData: string
  viewBox: { x: number; y: number; width: number; height: number }
  warnings: string[]
}

/**
 * Order-aware composition: each input is applied in sequence, so a subtract
 * only removes material that exists below it and a later add can fill a hole
 * back in. This is the single source of truth for what an editable mark looks
 * like — the canvas, previews and export all go through it.
 *
 * Consecutive inputs with the same operation give the same result whichever
 * way they are grouped, so each run is united as a balanced tree first and
 * then added to or cut from the result once. Pairs of similar size unite much
 * faster than one growing shape taking each input in turn.
 */
export function composeOrderedPaths(inputs: BooleanInput[]): OrderedBooleanResult {
  const warnings: string[] = []
  const scope = getScope()
  scope.project.clear()

  let result: paper.PathItem | null = null
  for (let start = 0; start < inputs.length; ) {
    const operation = inputs[start].operation
    let end = start
    while (end < inputs.length && inputs[end].operation === operation) end++
    const run = inputs.slice(start, end)
    start = end
    // Cuts before the first material have nothing to cut.
    if (!result && operation === 'subtract') continue

    const united = uniteBalanced(scope, run)
    if (united === 'unreliable') {
      result = foldInputs(scope, result, run, operation, warnings)
      continue
    }
    if (!united) continue
    result = result ? applyStep(scope, result, united, operation, warnings) : united.item
  }

  if (result) result = dropSlivers(result)
  if (!result || result.isEmpty()) {
    result?.remove()
    scope.project.clear()
    return { compoundPathData: '', viewBox: { x: 0, y: 0, width: 0, height: 0 }, warnings }
  }

  const compoundPathData = result.pathData
  const bounds = result.bounds
  result.remove()
  scope.project.clear()

  return {
    compoundPathData,
    viewBox: {
      x: Math.round(bounds.x * 100) / 100,
      y: Math.round(bounds.y * 100) / 100,
      width: Math.round(bounds.width * 100) / 100,
      height: Math.round(bounds.height * 100) / 100,
    },
    warnings,
  }
}

/** A shape made from some of the inputs, with the inputs it was made from. */
interface Applied {
  item: paper.PathItem
  inputs: BooleanInput[]
}

/**
 * One shape from a run of inputs, united pairwise level by level. Every pair
 * is checked, single inputs included, because a wrong pair would pass its
 * error up the tree where no later check can see it. When any pair fails or
 * is not plausible the run is reported as unreliable, so the caller applies
 * its inputs one at a time as the fold always did.
 */
function uniteBalanced(scope: paper.PaperScope, run: BooleanInput[]): Applied | null | 'unreliable' {
  let level = run.flatMap((input): Applied[] => {
    const item = pathItemFromSVG(scope, input.pathData, input.fillRule)
    return item ? [{ item, inputs: [input] }] : []
  })
  while (level.length > 1) {
    const next: Applied[] = []
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]
      const b = level[i + 1]
      if (!b) {
        next.push(a)
        continue
      }
      let united: paper.PathItem | null = null
      try {
        united = a.item.unite(b.item)
      } catch {
        united = null
      }
      if (!united || !isPlausible(united, a.item, b.item, 'add')) {
        united?.remove()
        for (const applied of [...next, ...level.slice(i)]) applied.item.remove()
        return 'unreliable'
      }
      a.item.remove()
      b.item.remove()
      next.push({ item: united, inputs: [...a.inputs, ...b.inputs] })
    }
    level = next
  }
  return level[0] ?? null
}

function areaOf(item: paper.PathItem): number {
  return Math.abs((item as unknown as { area: number }).area)
}

/**
 * Paper sometimes returns a plainly wrong union or difference without an
 * error, such as an empty shape where two shapes touch along an arc. A union
 * is never smaller than its larger shape nor larger than both together, and
 * a difference never loses more than the cut.
 */
function isPlausible(result: paper.PathItem, target: paper.PathItem, operand: paper.PathItem, operation: BooleanInput['operation']): boolean {
  const r = areaOf(result)
  const t = areaOf(target)
  const o = areaOf(operand)
  const slack = Math.max(0.5, 1e-4 * (t + o))
  return operation === 'add'
    ? r >= Math.max(t, o) - slack && r <= t + o + slack
    : r >= t - o - slack && r <= t + slack
}

/**
 * `target` with `operand` added or cut, and whether the answer is plausible;
 * neither item is used up. Paper now and then answers wrongly for a shape
 * one of its own booleans just made, such as filling a hole in it when
 * something far from the hole is cut, and rightly for the same shapes read
 * again from their path data. So an answer that is not plausible is tried
 * once more on the two read again, and the better of the two is kept.
 * Throws when paper does.
 */
function checkedStep(
  scope: paper.PaperScope,
  target: paper.PathItem,
  operand: paper.PathItem,
  operation: BooleanInput['operation'],
): { item: paper.PathItem; plausible: boolean } {
  const first = operation === 'add' ? target.unite(operand) : target.subtract(operand)
  if (isPlausible(first, target, operand, operation)) return { item: first, plausible: true }
  const again = pathItemFromSVG(scope, target.pathData)
  const other = pathItemFromSVG(scope, operand.pathData)
  try {
    if (!again || !other) return { item: first, plausible: false }
    const second = operation === 'add' ? again.unite(other) : again.subtract(other)
    if (isPlausible(second, again, other, operation)) {
      first.remove()
      return { item: second, plausible: true }
    }
    second.remove()
    return { item: first, plausible: false }
  } catch {
    return { item: first, plausible: false }
  } finally {
    again?.remove()
    other?.remove()
  }
}

/**
 * `target` with `operand` added or cut; both items are used up. When the
 * operand was made from several inputs and paper's answer fails, or is not
 * plausible even read again, its inputs are applied one at a time instead.
 * A single input that fails is left out, with a warning; one whose answer is
 * not plausible either way keeps paper's answer, as an input whose lobes
 * cancel can look implausible when it is not.
 */
function applyStep(
  scope: paper.PaperScope,
  target: paper.PathItem,
  operand: Applied,
  operation: BooleanInput['operation'],
  warnings: string[],
): paper.PathItem {
  const single = operand.inputs.length === 1
  try {
    const next = checkedStep(scope, target, operand.item, operation)
    if (single || next.plausible) {
      target.remove()
      operand.item.remove()
      return next.item
    }
    next.item.remove()
  } catch (e) {
    if (single) {
      warnings.push(`Boolean ${operation} failed: ${e}`)
      operand.item.remove()
      return target
    }
  }
  operand.item.remove()
  return foldInputs(scope, target, operand.inputs, operation, warnings)
}

/**
 * `target` with each input added or cut in turn, the way the mark was always
 * composed, each step checked as a single input is. Cuts with no material
 * yet are dropped, and an input whose boolean fails is left out with a
 * warning.
 */
function foldInputs(
  scope: paper.PaperScope,
  target: paper.PathItem,
  inputs: BooleanInput[],
  operation: BooleanInput['operation'],
  warnings: string[],
): paper.PathItem
function foldInputs(
  scope: paper.PaperScope,
  target: paper.PathItem | null,
  inputs: BooleanInput[],
  operation: BooleanInput['operation'],
  warnings: string[],
): paper.PathItem | null
function foldInputs(
  scope: paper.PaperScope,
  target: paper.PathItem | null,
  inputs: BooleanInput[],
  operation: BooleanInput['operation'],
  warnings: string[],
): paper.PathItem | null {
  let result = target
  for (const input of inputs) {
    const path = pathItemFromSVG(scope, input.pathData, input.fillRule)
    if (!path) continue
    if (!result) {
      if (operation === 'add') result = path
      else path.remove()
      continue
    }
    try {
      const next = checkedStep(scope, result, path, operation).item
      result.remove()
      result = next
    } catch (e) {
      warnings.push(`Boolean ${operation} failed: ${e}`)
    }
    path.remove()
  }
  return result
}
