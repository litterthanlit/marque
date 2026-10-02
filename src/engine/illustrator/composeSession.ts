import { composeOrderedPaths } from '../boolean/operations.ts'
import { layerTransformedPathData } from './compose.ts'
import type { IllustratorDocument } from './types.ts'

/**
 * Live composition for a drag. Everything below the lowest edited layer is
 * composed once, up front; each frame then only re-applies the edited layers
 * and whatever sits above them.
 */
export interface ComposeSession {
  /** Compose with these layers' paths replaced (null hides a layer). */
  compose(replacements: Map<string, string | null>): string
}

export function createComposeSession(doc: IllustratorDocument, editedIds: Iterable<string>): ComposeSession {
  const edited = new Set(editedIds)
  const layers = doc.layers.filter((layer) => layer.visible && layer.pathData)
  const first = layers.findIndex((layer) => edited.has(layer.id))
  const below = first < 0 ? layers : layers.slice(0, first)
  const above = first < 0 ? [] : layers.slice(first)

  const prefix = composeOrderedPaths(
    below.map((layer) => ({ pathData: layerTransformedPathData(layer), operation: layer.operation })),
  ).compoundPathData
  const rest = above.map((layer) => ({
    id: layer.id,
    operation: layer.operation,
    pathData: layerTransformedPathData(layer),
  }))

  return {
    compose(replacements) {
      const inputs: Array<{ pathData: string; operation: 'add' | 'subtract' }> = []
      if (prefix) inputs.push({ pathData: prefix, operation: 'add' })
      for (const layer of rest) {
        const pathData = replacements.has(layer.id) ? replacements.get(layer.id) : layer.pathData
        if (pathData) inputs.push({ pathData, operation: layer.operation })
      }
      return composeOrderedPaths(inputs).compoundPathData
    },
  }
}
