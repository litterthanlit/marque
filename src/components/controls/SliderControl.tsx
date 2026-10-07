import { useEffect, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** The value let go on. `false` says it was refused: the thumb goes back to `value`. */
  onChange: (value: number) => void | boolean
  /** How the value reads beside the label, where it says more than the number. */
  format?: (value: number) => string
  /** Every value the thumb passes through, before the one let go on reaches `onChange`. */
  onInput?: (value: number) => void
  /** Where a value the thumb reaches lands, such as the nearest step of 5 while Shift is held. */
  adjust?: (value: number) => number
  /** A value marked on the track, such as 0 between in and out. */
  mark?: number
  /** Words under the two ends of the track, such as "in" and "out". */
  ends?: readonly [string, string]
  /** Take the keyboard focus as it appears. */
  autoFocus?: boolean
  /** Read the value as plainly as the bar's other numbers, where it is what the control is for. */
  emphasis?: boolean
  /**
   * How values lie along the track: evenly, or 'sqrt', the distance along
   * the track the square root of the value's share of the range, so small
   * values get most of the track. The arrow keys still step by `step` (ten
   * with Shift).
   */
  scale?: 'linear' | 'sqrt'
}

/** How finely the thumb of a slider on a square-root scale is placed along its track. */
const TRACK_STEPS = 1000

export function SliderControl({ label, value, min, max, step, onChange, format, onInput, adjust, mark, ends, autoFocus, emphasis, scale = 'linear' }: SliderControlProps) {
  const [draftValue, setDraftValue] = useState(value)
  const thumbRef = useRef<HTMLSpanElement>(null)
  // The value `onChange` last refused. A key commits before it moves the thumb: that move is not taken up.
  const refused = useRef<number | null>(null)

  // Only as it appears, not when the prop changes later; a frame on, once the thumb is placed and shown.
  useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => thumbRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  const land = (v: number) => Math.min(max, Math.max(min, adjust ? adjust(v) : v))
  const shown = format ? format(draftValue) : Number.isInteger(step) ? String(draftValue) : draftValue.toFixed(2)
  const rooted = scale === 'sqrt' && max > min
  // On a square-root scale the track runs over positions, each read as the value it stands for, to the step.
  const toTrack = (v: number) => (rooted ? Math.round(TRACK_STEPS * Math.sqrt(Math.max(0, (v - min) / (max - min)))) : v)
  const fromTrack = (t: number) => (rooted ? Math.round((min + (max - min) * (t / TRACK_STEPS) ** 2) / step) * step : t)
  const at = (v: number) => (rooted ? (toTrack(v) / TRACK_STEPS) * 100 : ((v - min) / (max - min)) * 100)
  /** A value reached by a key, as the track would reach it: shown, and let go on at once. */
  const keyTo = (v: number) => {
    const next = land(v)
    if (next === draftValue) return
    setDraftValue(next)
    onInput?.(next)
    const taken = onChange(next) !== false
    if (!taken) setDraftValue(value)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Where room is short the label gives way, never the value: it stays on one line. */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-sidebar-text">{label}</span>
        <span className={emphasis ? 'shrink-0 whitespace-nowrap text-xs text-fg font-mono tabular-nums' : 'shrink-0 whitespace-nowrap text-[10px] text-sidebar-muted font-mono tabular-nums'}>
          {shown}
        </span>
      </div>
      <Slider.Root
        className="relative flex items-center h-5 select-none touch-none group"
        value={[toTrack(draftValue)]}
        min={rooted ? 0 : min}
        max={rooted ? TRACK_STEPS : max}
        step={rooted ? 1 : step}
        onPointerDown={() => (refused.current = null)}
        onKeyDown={(event) => {
          if (!rooted) return
          // On a square-root scale a key steps the value, not the track: one unit (ten with Shift), and Home and End go to the ends.
          const by = event.shiftKey ? 10 * step : step
          const keys: Record<string, number> = { ArrowRight: by, ArrowUp: by, ArrowLeft: -by, ArrowDown: -by, PageUp: 10 * step, PageDown: -10 * step }
          if (event.key in keys) keyTo(draftValue + keys[event.key])
          else if (event.key === 'Home') keyTo(min)
          else if (event.key === 'End') keyTo(max)
          else return
          event.preventDefault()
        }}
        onValueChange={([v]) => {
          const next = land(fromTrack(v))
          if (next === refused.current) return
          setDraftValue(next)
          onInput?.(next)
        }}
        onValueCommit={([v]) => {
          const next = land(fromTrack(v))
          // Refused, the value stays as it was: so does the thumb.
          const taken = onChange(next) !== false
          refused.current = taken ? null : next
          if (!taken) setDraftValue(value)
        }}
      >
        <Slider.Track className="relative grow h-[3px] bg-interactive-active rounded-full">
          {mark === undefined ? (
            <Slider.Range className="absolute h-full bg-interactive rounded-full group-hover:bg-interactive-hover transition-colors" />
          ) : (
            <>
              {/* Filled from the mark to the thumb, on whichever side of it the value lies. */}
              <span
                aria-hidden="true"
                className="absolute h-full bg-interactive rounded-full group-hover:bg-interactive-hover transition-colors"
                style={{ left: `${at(Math.min(mark, draftValue))}%`, right: `${100 - at(Math.max(mark, draftValue))}%` }}
              />
              <span aria-hidden="true" className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-sidebar-muted" style={{ left: `${at(mark)}%` }} />
            </>
          )}
        </Slider.Track>
        <Slider.Thumb ref={thumbRef} aria-label={label} aria-valuetext={format || rooted ? shown : undefined} className="block size-3 bg-white rounded-full outline-none shadow-sm shadow-black/30 hover:scale-110 focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised transition-transform" />
      </Slider.Root>
      {ends && (
        <div aria-hidden="true" className="-mt-1 flex justify-between text-[10px] text-sidebar-muted">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  )
}
