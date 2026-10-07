/**
 * The radius the selection bar's slider is showing on the selected fillets
 * while its thumb moves: which fillets, and the radius. The canvas rounds
 * the base mark with it, which a radius never changes. Null when none is
 * shown.
 */
export interface FilletPreview {
  ids: readonly string[]
  radius: number
}

let current: FilletPreview | null = null
const listeners = new Set<() => void>()

export const filletPreview = {
  get(): FilletPreview | null {
    return current
  },
  set(next: FilletPreview | null): void {
    if (next === current || (next && current && next.radius === current.radius && next.ids.join(' ') === current.ids.join(' '))) return
    current = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

let rowHover: string | null = null
const rowListeners = new Set<() => void>()

/** The fillet whose row in the drawer the pointer is over: the canvas lights it as a pointer over its circle would. */
export const filletRowHover = {
  get(): string | null {
    return rowHover
  },
  set(id: string | null): void {
    if (id === rowHover) return
    rowHover = id
    for (const listener of rowListeners) listener()
  },
  subscribe(listener: () => void): () => void {
    rowListeners.add(listener)
    return () => rowListeners.delete(listener)
  },
}
