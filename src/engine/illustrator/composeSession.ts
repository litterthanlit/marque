import { composeOrderedPaths, type BooleanInput } from '../boolean/operations.ts'
import type { CarveSpec } from '../carve/spec.ts'
import { carriedPlace, filletFrame, frameSources, type ResolvedFillet } from '../fillet/apply.ts'
import type { OutlinesOf } from '../fillet/anchor.ts'
import { contoursPrimitives, recipePrimitives, type Primitive } from '../geometry/primitives.ts'
import { pathDataToContours } from '../vector/pathSerialization.ts'
import { layerInput, stackInputs, stackUnits, type StackUnit } from './compose.ts'
import type { IllustratorDocument, IllustratorLayer } from './types.ts'

/**
 * Live composition for a drag. Everything below the lowest edited layer is
 * composed once, up front; each frame then only re-applies the edited layers
 * and whatever sits above them. An isolated group counts as one input: one
 * with an edited member is composed again each frame, the others once, the
 * groups inside an edited one that the edit never reaches too. The
 * document's fillets go on each frame, each looked for where the gesture
 * carries its place along its objects' outlines since the session began,
 * as the commit looks for it, so they follow the drag however far a frame
 * moves or turns a shape; a fillet none of whose objects the drag edits
 * stays on its own corner, or is lost while the corner is covered.
 */
export interface ComposeSession {
  /**
   * Compose with these layers' paths replaced (null hides a layer). `carves`
   * are the recipes of the replaced layers that have one: a corner is read
   * against a recipe's own pieces.
   */
  compose(replacements: Map<string, string | null>, carves?: ReadonlyMap<string, CarveSpec>): string
  /** How each fillet that shows resolved on the last frame; null while none shows. */
  readonly fillets: ResolvedFillet[] | null
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

  const fillets = doc.fillets?.some((fillet) => fillet.visible) ? doc.fillets : null
  let resolved: ResolvedFillet[] | null = null
  const layersById = new Map(doc.layers.map((layer) => [layer.id, layer]))
  /** Each layer's outline as the session began, as fillets' places are carried along it. */
  const startOutlines = new Map<string, readonly Primitive[]>()
  const startOf = (id: string): readonly Primitive[] | null => {
    const layer = layersById.get(id)
    if (!layer?.pathData) return null
    if (!startOutlines.has(id)) startOutlines.set(id, outlineOf(id, layer.pathData, layer.carve))
    return startOutlines.get(id)!
  }

  return {
    get fillets() {
      return resolved
    },
    compose(replacements, carves = new Map()) {
      const replaced = (layer: IllustratorLayer): BooleanInput | null => {
        if (!replacements.has(layer.id)) return own(layer)
        const pathData = replacements.get(layer.id)
        // The fill rule is read only where the path holds several contours.
        return pathData ? { pathData, operation: layer.operation, fillRule: layer.fillRule } : null
      }
      const frame: BooleanInput[] = []
      if (prefix) frame.push({ pathData: prefix, operation: 'add' })
      for (const unit of above) frame.push(...(settled.get(unit) ?? stackInputs([unit], replaced, (group) => !touches(group))))
      const ink = composeOrderedPaths(frame).compoundPathData
      if (!fillets) return ink
      const outlines = new Map<string, OutlinesOf | null>()
      const outlineOfLayer = (id: string): OutlinesOf | null => {
        if (!outlines.has(id)) {
          const was = startOf(id)
          if (!replacements.has(id)) outlines.set(id, was && { was, now: was })
          else {
            const pathData = replacements.get(id)
            outlines.set(id, was && pathData ? { was, now: outlineOf(id, pathData, carves.get(id)) } : null)
          }
        }
        return outlines.get(id)!
      }
      const pass = filletFrame(ink, fillets, frameSources(doc.layers, replacements, carves), (fillet) => carriedPlace(fillet, outlineOfLayer))
      resolved = pass?.resolved ?? null
      return pass ? pass.pathData : ink
    },
  }
}

/** A layer's outline as pieces: by its recipe, or by its path where it has none. */
function outlineOf(id: string, pathData: string, carve: CarveSpec | undefined): Primitive[] {
  return carve ? recipePrimitives(carve, id) : contoursPrimitives(pathDataToContours(pathData), id)
}
