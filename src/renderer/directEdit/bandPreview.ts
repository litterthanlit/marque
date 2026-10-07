import type { BandSpec } from '../../engine/carve/spec.ts'

/**
 * The band the selection bar is showing on the canvas while one of its
 * setting sliders moves: which band, and its recipe with the value the
 * thumb is on. The canvas composes the ink with it in the band's place.
 * Null when none is shown.
 */
export interface BandPreview {
  id: string
  carve: BandSpec
}

let current: BandPreview | null = null
const listeners = new Set<() => void>()

export const bandPreview = {
  get(): BandPreview | null {
    return current
  },
  set(next: BandPreview | null): void {
    if (next === current || (next && current && next.id === current.id && JSON.stringify(next.carve) === JSON.stringify(current.carve))) return
    current = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
