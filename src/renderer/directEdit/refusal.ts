import type { Refused } from '../../store/logoStore.ts'
import { hud } from './hud.ts'

/*
 * Why a command did nothing, such as a refused Cmd+G. The canvas says the
 * words by the selection and outlines what is in the way for a moment, so
 * the user can see which it is without the drawer's numbers.
 */

/** How long a refusal stays on the canvas. */
export const REFUSAL_MS = 1500

const listeners = new Set<(refused: Refused) => void>()

export const refusals = {
  /** Say a refusal: on the canvas when there is one, else in the HUD where it last was. Read out to screen readers either way. */
  say(refused: Refused): void {
    if (listeners.size) {
      for (const listener of listeners) listener(refused)
      return
    }
    hud.hold(refused.words, REFUSAL_MS)
    hud.announce(refused.words)
  },
  subscribe(listener: (refused: Refused) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
