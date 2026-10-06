import type { IllustratorLayer } from '../../engine/illustrator/types.ts'

/** A layer's number as the drawer shows it, from 01 at the bottom; null when it is gone. */
export function layerNumber(layers: readonly IllustratorLayer[], id: string): string | null {
  const index = layers.findIndex((layer) => layer.id === id)
  return index < 0 ? null : String(index + 1).padStart(2, '0')
}
