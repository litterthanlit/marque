/**
 * What the canvas HUD shows: a snap/hint label and a measurement chip, near
 * the pointer, and a status read out to screen readers. A tiny external
 * store so the canvas code can update it every frame without re-rendering
 * React; CanvasHud subscribes to it.
 */
export interface HudState {
  label: string | null
  chip: string | null
  /** CSS pixels from the canvas's top-left corner. */
  x: number
  y: number
  /** The row goes above the point, clear of a finger pressing there. */
  above: boolean
  /** The outcome of the last keyboard edit, for screen readers. Clearing the HUD keeps it. */
  status: string
  /** Counts announcements, so the same words said twice are read out twice. */
  statusId: number
}

let state: HudState = { label: null, chip: null, x: 0, y: 0, above: false, status: '', statusId: 0 }
const listeners = new Set<() => void>()
/** A label that outranks every other for a moment, such as "unpinned". */
let held: { label: string; timer: ReturnType<typeof setTimeout> } | null = null
/** The label last asked for: it shows again when a held one goes. */
let wanted: string | null = null

function emit() {
  for (const listener of listeners) listener()
}

export const hud = {
  get(): HudState {
    return state
  },
  /** The label last asked for, under any held one. */
  asked(): string | null {
    return wanted
  },
  set(next: Partial<Omit<HudState, 'status' | 'statusId'>>): void {
    if (next.label !== undefined) wanted = next.label
    const merged = { ...state, ...next, ...(held ? { label: held.label } : {}) }
    if (
      merged.label === state.label &&
      merged.chip === state.chip &&
      merged.x === state.x &&
      merged.y === state.y &&
      merged.above === state.above
    ) {
      return
    }
    state = merged
    emit()
  },
  /** Read `status` out to screen readers, even when it is what was read last. */
  announce(status: string): void {
    state = { ...state, status, statusId: state.statusId + 1 }
    emit()
  },
  /** Drop a status that no longer holds, such as after an undo, so it is never read stale. */
  silence(): void {
    if (!state.status) return
    state = { ...state, status: '', statusId: state.statusId + 1 }
    emit()
  },
  clear(): void {
    wanted = null
    // A held label stays its moment, past the end of the gesture that set it.
    const label = held ? held.label : null
    if (state.label === label && state.chip === null) return
    state = { ...state, label, chip: null }
    emit()
  },
  /** Show `label` over any other for `ms`, as when an edit lets go of a pin. */
  hold(label: string, ms = 1000): void {
    if (held) clearTimeout(held.timer)
    held = { label, timer: setTimeout(() => hud.letGo(), ms) }
    if (state.label === label) return
    state = { ...state, label }
    emit()
  },
  /** A held label goes at once: the one last asked for shows. */
  letGo(): void {
    if (!held) return
    clearTimeout(held.timer)
    held = null
    if (state.label === wanted) return
    state = { ...state, label: wanted }
    emit()
  },
  /** Is a label held? */
  holding(): boolean {
    return held !== null
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
