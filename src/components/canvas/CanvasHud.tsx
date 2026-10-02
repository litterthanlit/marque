import { useSyncExternalStore } from 'react'
import { hud } from '../../renderer/directEdit/hud.ts'

/**
 * Snap labels and measurements next to the pointer. Rendered in the DOM, not
 * on the canvas, so text stays crisp on high-density screens.
 */
export function CanvasHud() {
  const state = useSyncExternalStore(hud.subscribe, hud.get, hud.get)
  if (!state.label && !state.chip) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl" aria-hidden="true">
      <div className="absolute flex items-center gap-1" style={{ left: state.x + 14, top: state.y + 14 }}>
        {state.label && (
          <span className="rounded-md bg-pink-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
            {state.label}
          </span>
        )}
        {state.chip && (
          <span className="rounded-md bg-neutral-900/90 px-1.5 py-0.5 font-mono-tabular text-[10px] text-white shadow-sm">
            {state.chip}
          </span>
        )}
      </div>
    </div>
  )
}
