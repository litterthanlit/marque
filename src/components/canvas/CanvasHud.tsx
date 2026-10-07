import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { hud } from '../../renderer/directEdit/hud.ts'
import { hudPlace } from './hudPlacement.ts'

/**
 * Snap labels and measurements next to the pointer. Rendered in the DOM, not
 * on the canvas, so text stays crisp on high-density screens. The row is
 * measured, and goes to whichever side of the pointer has room, or as near
 * it as the canvas allows: it keeps 12 px clear of every edge, and a row
 * wider than the canvas wraps, its words to two lines at most. Under a
 * finger the row goes above the touch
 * point, below it only near the top edge. Keyboard edits are also read
 * out to screen readers.
 */
export function CanvasHud() {
  const state = useSyncExternalStore(hud.subscribe, hud.get, hud.get)
  // The frame is always there (empty when idle), so its size is known when the row appears.
  const frameRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState({ width: Infinity, height: Infinity })
  const [row, setRow] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const measure = () => setFrame({ width: element.clientWidth || Infinity, height: element.clientHeight || Infinity })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const visible = Boolean(state.label || state.chip)
  // Measured whenever its words change, before it is painted: it shows where it fits from the first frame.
  useLayoutEffect(() => {
    const element = rowRef.current
    if (!element) return
    const next = { width: element.offsetWidth, height: element.offsetHeight }
    setRow((was) => (was.width === next.width && was.height === next.height ? was : next))
  }, [visible, state.label, state.chip, frame.width])
  const { left, top } = hudPlace(state, row, frame)
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {/* A fresh node per announcement: the same words said twice are read out twice. */}
        <span key={state.statusId}>{state.status}</span>
      </p>
      <div ref={frameRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl" aria-hidden="true">
        {visible && (
          <div
            ref={rowRef}
            data-hud-row
            className="absolute flex w-max max-w-[calc(100%-24px)] flex-wrap items-center gap-1"
            style={{ left, top }}
          >
            {state.label && (
              <span className="line-clamp-2 rounded-md bg-pink-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
                {state.label}
              </span>
            )}
            {state.chip && (
              <span className="whitespace-nowrap rounded-md bg-neutral-900/90 px-1.5 py-0.5 font-mono-tabular text-[10px] text-white shadow-sm ring-1 ring-white/15">
                {state.chip}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
