import { composeOrderedPaths, type BooleanInput } from '../boolean/operations.ts'
import { layerInput, stackInputs, stackUnits, type StackUnit } from './compose.ts'
import type { IllustratorDocument, IllustratorLayer } from './types.ts'

/**
 * Live composition for a drag. Everything below the lowest edited layer is
 * composed once, up front; each frame then only re-applies the edited layers
 * and whatever sits above them. An isolated group counts as one input: one
 * with an edited member is composed again each frame, the others once.
 */
export interface ComposeSession {
  /** Compose with these layers' paths replaced (null hides a layer). */
  compose(replacements: Map<string, string | null>): string
}

export function createComposeSession(doc: IllustratorDocument, editedIds: Iterable<string>): ComposeSession {
  const edited = new Set(editedIds)
  const touches = (unit: StackUnit) =>
    unit.kind === 'layer' ? edited.has(unit.layer.id) : unit.layers.some((layer) => edited.has(layer.id))
  const units = stackUnits(doc)
  const first = units.findIndex(touches)
  const below = first < 0 ? units : units.slice(0, first)
  const above = first < 0 ? [] : units.slice(first)

  // Each layer's own input, read once.
  const inputs = new Map<IllustratorLayer, BooleanInput | null>()
  const own = (layer: IllustratorLayer): BooleanInput | null => {
    if (!inputs.has(layer)) inputs.set(layer, layer.pathData ? layerInput(layer) : null)
    return inputs.get(layer) ?? null
  }
  const prefix = composeOrderedPaths(stackInputs(below, own)).compoundPathData
  // Groups no edit reaches are composed once, here.
  const settled = new Map<StackUnit, BooleanInput[]>()
  for (const unit of above) if (unit.kind === 'group' && !touches(unit)) settled.set(unit, stackInputs([unit], own))

  return {
    compose(replacements) {
      const replaced = (layer: IllustratorLayer): BooleanInput | null => {
        if (!replacements.has(layer.id)) return own(layer)
        const pathData = replacements.get(layer.id)
        // The fill rule is read only where the path holds several contours.
        return pathData ? { pathData, operation: layer.operation, fillRule: layer.fillRule } : null
      }
      const frame: BooleanInput[] = []
      if (prefix) frame.push({ pathData: prefix, operation: 'add' })
      for (const unit of above) frame.push(...(settled.get(unit) ?? stackInputs([unit], replaced, false)))
      return composeOrderedPaths(frame).compoundPathData
    },
  }
}
