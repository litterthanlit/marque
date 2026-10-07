import paper from 'paper'
import { composeOrderedPaths, type BooleanInput } from '../boolean/operations.ts'
import type { IllustratorDocument, IllustratorGroup, IllustratorLayer, MarkData } from './types.ts'

let illustratorScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!illustratorScope) {
    illustratorScope = new paper.PaperScope()
    illustratorScope.setup(new paper.Size(1, 1))
  }
  illustratorScope.activate()
  return illustratorScope
}

/**
 * A layer's path as paper reads it. A path of several contours fills by the
 * layer's fill rule, so a hole is a hole wherever it is hit or composed; a
 * single contour fills the same under either rule.
 */
function pathFromLayer(scope: paper.PaperScope, layer: IllustratorLayer): paper.PathItem | null {
  try {
    const item = new scope.CompoundPath(layer.pathData)
    if (item.isEmpty()) {
      item.remove()
      throw new Error('empty compound path')
    }
    if (item.children.length > 1) item.fillRule = layer.fillRule
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

/** A layer's path with its transform applied, in layer space, as composition takes it. */
export function layerInput(layer: IllustratorLayer): BooleanInput | null {
  const scope = getScope()
  scope.project.clear()
  const item = getLayerPathItem(scope, layer, true)
  const pathData = item?.pathData ?? ''
  const several = Boolean(item?.children && item.children.length > 1)
  item?.remove()
  scope.project.clear()
  if (!pathData) return null
  return several ? { pathData, operation: layer.operation, fillRule: layer.fillRule } : { pathData, operation: layer.operation }
}

/**
 * What the stack is made of, bottom first: a layer each, or an isolated
 * group as one unit whose members compose alone. Members of a group that is
 * not isolated stand in the stack like any other layer.
 */
export type StackUnit =
  | { kind: 'layer'; layer: IllustratorLayer }
  | { kind: 'group'; group: IllustratorGroup; units: StackUnit[]; layers: IllustratorLayer[] }

/** An isolated group in the stack. */
export type GroupUnit = Extract<StackUnit, { kind: 'group' }>

export function stackUnits(doc: Pick<IllustratorDocument, 'layers' | 'groups'>): StackUnit[] {
  const groups = doc.groups
  if (!groups?.some((group) => group.isolated)) return doc.layers.map((layer) => ({ kind: 'layer', layer }))
  const byId = new Map(groups.map((group) => [group.id, group]))
  /** The isolated groups around a layer, outermost first. */
  const isolatedChain = (parentId: string | undefined): IllustratorGroup[] => {
    const chain: IllustratorGroup[] = []
    const seen = new Set<IllustratorGroup>()
    let group = parentId === undefined ? undefined : byId.get(parentId)
    while (group && !seen.has(group)) {
      seen.add(group)
      if (group.isolated) chain.unshift(group)
      group = group.parentId === undefined ? undefined : byId.get(group.parentId)
    }
    return chain
  }
  const root: StackUnit[] = []
  const open: GroupUnit[] = []
  for (const layer of doc.layers) {
    const chain = isolatedChain(layer.parentId)
    let depth = 0
    while (depth < open.length && depth < chain.length && open[depth].group === chain[depth]) depth++
    open.length = depth
    for (let i = depth; i < chain.length; i++) {
      const unit: GroupUnit = { kind: 'group', group: chain[i], units: [], layers: [] }
      ;(open.at(-1)?.units ?? root).push(unit)
      open.push(unit)
    }
    for (const unit of open) unit.layers.push(layer)
    ;(open.at(-1)?.units ?? root).push({ kind: 'layer', layer })
  }
  return root
}

/**
 * Does a cut reach a layer below it? A cut inside an isolated group reaches
 * only what is inside that group; a cut at the root, or in a group that is
 * not isolated, reaches everything below it, an isolated group's members
 * too, since it cuts what the group composes to. Null when no group is
 * isolated: then every cut reaches everything below it.
 */
export function cutReach(doc: Pick<IllustratorDocument, 'layers' | 'groups'>): ((cut: IllustratorLayer, layer: IllustratorLayer) => boolean) | null {
  const groups = doc.groups
  if (!groups?.some((group) => group.isolated)) return null
  const byId = new Map(groups.map((group) => [group.id, group]))
  const scopes = new Map<string | undefined, Set<string>>()
  /** The isolated groups around a layer: what a cut inside one of them is kept in. */
  const isolatedAround = (parentId: string | undefined): Set<string> => {
    const known = scopes.get(parentId)
    if (known) return known
    const around = new Set<string>()
    let group = parentId === undefined ? undefined : byId.get(parentId)
    while (group && !around.has(group.id)) {
      if (group.isolated) around.add(group.id)
      group = group.parentId === undefined ? undefined : byId.get(group.parentId)
    }
    scopes.set(parentId, around)
    return around
  }
  /** The innermost isolated group around a layer, or null at the root. */
  const innermost = (parentId: string | undefined): string | null => {
    let group = parentId === undefined ? undefined : byId.get(parentId)
    const seen = new Set<string>()
    while (group && !seen.has(group.id)) {
      if (group.isolated) return group.id
      seen.add(group.id)
      group = group.parentId === undefined ? undefined : byId.get(group.parentId)
    }
    return null
  }
  return (cut, layer) => {
    const scope = innermost(cut.parentId)
    return scope === null || isolatedAround(layer.parentId).has(scope)
  }
}

/** Each isolated group composed alone, keyed by the very layers and groups it holds: the last few, newest first. */
const recentGroups: Array<{ key: unknown[]; pathData: string; warnings: string[] }> = []
const RECENT_GROUPS = 32

/**
 * The inputs of a stack, bottom first. `pathOf` gives a layer's input, or
 * null to leave it out. An isolated group's members compose alone, so a cut
 * among them reaches only the members below it, and the result enters as
 * one input with the group's operation. With `cached`, a group composed
 * from the very same layers before is not composed again; given as a
 * test, only the groups it passes are, at any depth, and the others are
 * composed afresh. A boolean step that fails inside a group is added to
 * `warnings`, when given.
 */
export function stackInputs(
  units: StackUnit[],
  pathOf: (layer: IllustratorLayer) => BooleanInput | null,
  cached: boolean | ((unit: GroupUnit) => boolean) = true,
  warnings?: string[],
): BooleanInput[] {
  const inputs: BooleanInput[] = []
  for (const unit of units) {
    if (unit.kind === 'layer') {
      const input = unit.layer.visible ? pathOf(unit.layer) : null
      if (input) inputs.push(input)
      continue
    }
    if (!unit.group.visible) continue
    const fromCache = typeof cached === 'function' ? cached(unit) : cached
    const composed = fromCache ? cachedGroupPath(unit, pathOf) : composeGroup(unit, pathOf, cached)
    warnings?.push(...composed.warnings)
    if (composed.pathData) inputs.push({ pathData: composed.pathData, operation: unit.group.operation })
  }
  return inputs
}

function composeGroup(
  unit: GroupUnit,
  pathOf: (layer: IllustratorLayer) => BooleanInput | null,
  cached: boolean | ((unit: GroupUnit) => boolean),
): { pathData: string; warnings: string[] } {
  const warnings: string[] = []
  const result = composeOrderedPaths(stackInputs(unit.units, pathOf, cached, warnings))
  return { pathData: result.compoundPathData, warnings: [...warnings, ...result.warnings] }
}

/** What a group's composition reads: its layers and inner groups, by identity, nesting marked. */
function groupKey(units: StackUnit[]): unknown[] {
  return units.flatMap((unit) => (unit.kind === 'layer' ? [unit.layer] : [unit.group, '(', ...groupKey(unit.units), ')']))
}

function cachedGroupPath(
  unit: GroupUnit,
  pathOf: (layer: IllustratorLayer) => BooleanInput | null,
): { pathData: string; warnings: string[] } {
  const key = groupKey(unit.units)
  const index = recentGroups.findIndex((entry) => entry.key.length === key.length && entry.key.every((value, i) => value === key[i]))
  const entry = index >= 0 ? recentGroups.splice(index, 1)[0] : { key, ...composeGroup(unit, pathOf, true) }
  recentGroups.unshift(entry)
  recentGroups.length = Math.min(recentGroups.length, RECENT_GROUPS)
  return entry
}

/** The mark, with the boolean steps that failed (in a group or the stack) as its warnings. */
export function composeIllustratorMark(doc: Pick<IllustratorDocument, 'layers' | 'groups'>): MarkData {
  const warnings: string[] = []
  const inputs = stackInputs(stackUnits(doc), (layer) => (layer.pathData ? layerInput(layer) : null), true, warnings)

  if (inputs.length === 0) {
    return {
      compoundPathData: '',
      fillRule: 'evenodd',
      viewBox: { x: 0, y: 0, width: 0, height: 0 },
      ...(warnings.length ? { warnings } : {}),
    }
  }

  const result = composeOrderedPaths(inputs)
  warnings.push(...result.warnings)
  return {
    compoundPathData: result.compoundPathData,
    fillRule: 'evenodd',
    viewBox: result.viewBox,
    ...(warnings.length ? { warnings } : {}),
  }
}
