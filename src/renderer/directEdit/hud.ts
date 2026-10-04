/**
 * What the canvas HUD shows: a snap/hint label and a measurement chip, near
 * the pointer. A tiny external store so the canvas code can update it every
 * frame without re-rendering React; CanvasHud subscribes to it.
 */
export interface HudState {
  label: string | null
  chip: string | null
  /** CSS pixels from the canvas's top-left corner. */
  x: number
  y: number
}

let state: HudState = { label: null, chip: null, x: 0, y: 0 }
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export const hud = {
  get(): HudState {
    return state
  },
  set(next: Partial<HudState>): void {
    const merged = { ...state, ...next }
    if (
      merged.label === state.label &&
      merged.chip === state.chip &&
      merged.x === state.x &&
      merged.y === state.y
    ) {
      return
    }
    state = merged
    emit()
  },
  clear(): void {
    if (state.label === null && state.chip === null) return
    state = { ...state, label: null, chip: null }
    emit()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
