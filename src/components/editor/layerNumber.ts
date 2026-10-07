import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'

/** A layer's number as the drawer shows it, from 01 at the bottom; null when it is gone. */
export function layerNumber(layers: readonly IllustratorLayer[], id: string): string | null {
  const index = layers.findIndex((layer) => layer.id === id)
  return index < 0 ? null : String(index + 1).padStart(2, '0')
}

/**
 * A band's circles as the drawer numbers them: a layer's number, or a
 * guide's, "guide 3", or with `short`, as a drawer row has room for, "g3".
 */
export function bandEnds(doc: Pick<IllustratorDocument, 'layers' | 'guides'>, link: { a: string; b: string }, short = false): string[] {
  return [link.a, link.b].map((id) => {
    const number = layerNumber(doc.layers, id)
    if (number) return number
    const guide = (doc.guides ?? []).findIndex((each) => each.id === id)
    return guide < 0 ? '—' : `${short ? 'g' : 'guide '}${guide + 1}`
  })
}
