/**
 * The offset the selection bar is showing on the canvas while its Offset
 * popover is open, or while a copy's Distance slider moves: which object it
 * is made from, how far, whether it cuts, and, for a copy being changed,
 * which copy it stands in for. The canvas draws it dashed over the ink and
 * composes the ink with it. Null when none is shown.
 */
export interface OffsetPreview {
  of: string
  distance: number
  asCut: boolean
  /** The copy this preview stands in for; missing for a copy not yet added. */
  replaces?: string
}

let current: OffsetPreview | null = null
const listeners = new Set<() => void>()

export const offsetPreview = {
  get(): OffsetPreview | null {
    return current
  },
  set(next: OffsetPreview | null): void {
    const same =
      next === current ||
      (next !== null &&
        current !== null &&
        next.of === current.of &&
        next.distance === current.distance &&
        next.asCut === current.asCut &&
        next.replaces === current.replaces)
    if (same) return
    current = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
