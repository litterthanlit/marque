import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { hud } from '../../renderer/directEdit/hud.ts'

const OFFSET = 14
// How far above a finger the row sits, so the hand does not cover it.
const FINGER_OFFSET = 44
// Rough size of the label row, to decide when to flip it to the other side of the pointer.
const FLIP_X = 160
const FLIP_Y = 40

/**
 * Snap labels and measurements next to the pointer. Rendered in the DOM, not
 * on the canvas, so text stays crisp on high-density screens. Near the right
 * or bottom edge the row flips to the other side of the pointer so it stays
 * readable. Under a finger the row goes above the touch point, below it
 * only near the top edge. Keyboard edits are also read out to screen readers.
 */
export function CanvasHud() {
  const state = useSyncExternalStore(hud.subscribe, hud.get, hud.get)
  // The frame is always there (empty when idle), so its size is known when the row appears.
  const frameRef = useRef<HTMLDivElement>(null)
  const [{ width, height }, setSize] = useState({ width: Infinity, height: Infinity })
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => setSize({ width: frame.clientWidth || Infinity, height: frame.clientHeight || Infinity })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])
  const visible = Boolean(state.label || state.chip)
  const flipX = state.x + OFFSET + FLIP_X > width
  const vertical: React.CSSProperties = state.above
    ? state.y - FINGER_OFFSET - FLIP_Y < 0
      ? { top: state.y + FINGER_OFFSET }
      : { top: state.y - FINGER_OFFSET, transform: 'translateY(-100%)' }
    : state.y + OFFSET + FLIP_Y > height
      ? { bottom: height - state.y + OFFSET }
      : { top: state.y + OFFSET }
  const style: React.CSSProperties = {
    ...(flipX ? { right: width - state.x + OFFSET } : { left: state.x + OFFSET }),
    ...vertical,
  }
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {/* A fresh node per announcement: the same words said twice are read out twice. */}
        <span key={state.statusId}>{state.status}</span>
      </p>
      <div ref={frameRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl" aria-hidden="true">
        {visible && (
          <div className="absolute flex items-center gap-1 whitespace-nowrap" style={style}>
            {state.label && (
              <span className="rounded-md bg-pink-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
                {state.label}
              </span>
            )}
            {state.chip && (
              <span className="rounded-md bg-neutral-900/90 px-1.5 py-0.5 font-mono-tabular text-[10px] text-white shadow-sm ring-1 ring-white/15">
                {state.chip}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
