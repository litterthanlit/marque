import { useEffect, useRef } from 'react'

/**
 * Is Shift held? Read while a slider moves, which lands on larger steps then.
 * Kept in a ref: holding it must not draw the bar again.
 */
export function useShiftHeld() {
  const held = useRef(false)
  useEffect(() => {
    const note = (event: KeyboardEvent | PointerEvent) => {
      held.current = event.shiftKey
    }
    window.addEventListener('keydown', note, true)
    window.addEventListener('keyup', note, true)
    window.addEventListener('pointermove', note, true)
    window.addEventListener('pointerdown', note, true)
    return () => {
      window.removeEventListener('keydown', note, true)
      window.removeEventListener('keyup', note, true)
      window.removeEventListener('pointermove', note, true)
      window.removeEventListener('pointerdown', note, true)
    }
  }, [])
  return held
}
