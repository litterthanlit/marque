import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { hud } from '../../renderer/directEdit/hud.ts'

const OFFSET = 14
// Rough size of the label row, to decide when to flip it to the other side of the pointer.
const FLIP_X = 160
const FLIP_Y = 40

/**
 * Snap labels and measurements next to the pointer. Rendered in the DOM, not
 * on the canvas, so text stays crisp on high-density screens. Near the right
 * or bottom edge the row flips to the other side of the pointer so it stays
 * readable.
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
  const flipY = state.y + OFFSET + FLIP_Y > height
  const style: React.CSSProperties = {
    ...(flipX ? { right: width - state.x + OFFSET } : { left: state.x + OFFSET }),
    ...(flipY ? { bottom: height - state.y + OFFSET } : { top: state.y + OFFSET }),
  }
  return (
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
  )
}
