import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils.ts'
import { play } from '../../lib/sound.ts'

/** Focus shows as the one ring every control shares (index.css), for the keyboard only. */
export const FOCUS_RING = 'outline-offset-2'

/**
 * A panel of the instrument: a plate of the body's finish lifted off the
 * sheet, its lit edge and grain. Wells are pressed into it; keys sit in them.
 */
export const FLOATING_SURFACE = 'plate plate-raised rounded-[14px]'

/** A rule across a plate between two of its rows: a fine groove, lit on its lower lip. */
export const PLATE_RULE = 'border-t border-black/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.75)] dark:border-black/50 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]'

/** A well pressed into a plate, for a row of keys: its corners nest inside the plate's. */
export const WELL = 'well rounded-[10px] p-0.5'

/** The selection's words and numbers, on a strip of LCD glass as tall as a key. */
export const SUMMARY_LCD = 'lcd h-8 max-w-full truncate rounded-[8px] px-2.5 text-xs leading-8'

/** Lettering on a key: small capitals set by CSS, so the accessible name keeps its case. */
export const KEY_LETTERING = 'text-[10px] font-medium uppercase leading-none tracking-[0.03em]'

interface EditorButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** A toggle or one choice of several: sets `aria-pressed`, latches the key down and lights its window. */
  pressed?: boolean
  danger?: boolean
  /** The one action a panel is for, such as making what it sets. */
  primary?: boolean
}

/** A raised key on a 2px base that sinks under the finger, and clicks down and up. */
export function EditorButton({ pressed, danger, primary, className, children, ...props }: EditorButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-sound="key"
      data-tone={primary ? 'primary' : danger ? 'danger' : undefined}
      {...props}
      className={cn('device-key inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 rounded-[8px] px-2.5', KEY_LETTERING, FOCUS_RING, className)}
    >
      {children}
    </button>
  )
}

interface SegmentedProps<T extends string | number> {
  label: string
  /** Each option, with a tooltip when it has a shortcut or a note; a disabled one says why in its tooltip. */
  options: ReadonlyArray<{ value: T; label: string; title?: string; disabled?: boolean }>
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * One choice of several, as a row of interlocked keys in a well: the chosen
 * one is a key face, latched down; the others are lettering printed on the
 * well, a press away.
 */
export function Segmented<T extends string | number>({ label, options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={cn('flex gap-1 rounded-[10px] p-0.5 well', className)} role="group" aria-label={label}>
      {options.map((option) => {
        const chosen = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen}
            data-sound="key"
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 flex-1 rounded-[8px] px-2.5 select-none',
              KEY_LETTERING,
              FOCUS_RING,
              chosen ? 'device-key before:hidden' : 'flat-key',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface SwitchButtonProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  title?: string
  className?: string
}

/**
 * A switch with its own light: a cap that snaps across a recessed slot,
 * showing the orange of a switch that is on, as the snap hints it turns on
 * show the hand is on something. Two tiny clicks as it flips.
 */
export function SwitchButton({ label, checked, onChange, title, className }: SwitchButtonProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => {
        play('toggle')
        onChange(!checked)
      }}
      className={cn(
        'flat-key group/switch flex h-8 shrink-0 items-center justify-between gap-2 rounded-[8px] px-2.5 text-xs font-medium',
        FOCUS_RING,
        className,
      )}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="relative h-3.5 w-7 shrink-0 overflow-hidden rounded-full bg-black/10 shadow-(--device-recess) dark:bg-black/40">
        <span
          className="absolute inset-y-0 left-0 w-1/2 bg-(--device-hold) opacity-0 shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] transition-opacity duration-(--duration-exit) group-aria-checked/switch:opacity-100 group-aria-checked/switch:duration-(--duration-enter)"
        />
        <span className="absolute inset-y-[2px] left-[2px] w-[13px] rounded-full [background:var(--device-key-face)] shadow-[0_0_0_0.5px_rgb(0_0_0/0.25),0_1px_1px_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.8)] transition-transform duration-(--duration-enter) ease-spring group-aria-checked/switch:translate-x-[11px] dark:shadow-[0_0_0_0.5px_rgb(0_0_0/0.8),0_1px_1px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.12)]" />
      </span>
    </button>
  )
}

/** A groove cut into the plate between two groups: a shadow and the lit lip below it. */
export function Divider({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('h-5 w-px shrink-0 bg-black/10 shadow-[1px_0_0_rgb(255_255_255/0.8)] dark:bg-black/50 dark:shadow-[1px_0_0_rgb(255_255_255/0.06)]', className)} />
}

interface StepperProps {
  label: string
  /** What it is read out as, where that says more than the label shown. */
  name?: string
  /** The value shown, or null where the selection holds several. */
  value: number | null
  min: number
  max: number
  onStep: (delta: 1 | -1) => void
  /** What the buttons do, read out and shown on hover. */
  lessLabel: string
  moreLabel: string
  title?: string
}

/** A number stepped one at a time: − value +. Reachable by touch, where a key is not. */
export function Stepper({ label, name, value, min, max, onStep, lessLabel, moreLabel, title }: StepperProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={name ?? label} title={title}>
      <span aria-hidden="true" className="engraved px-1">
        {label}
      </span>
      <EditorButton aria-label={lessLabel} title={lessLabel} disabled={value !== null && value <= min} onClick={() => onStep(-1)} className="w-8 px-0">
        −
      </EditorButton>
      {/* The value on a small LCD between its keys. */}
      <output aria-live="polite" className="lcd h-6 min-w-7 rounded-[5px] px-1 text-center text-xs font-light leading-6">
        {value ?? '–'}
      </output>
      <EditorButton aria-label={moreLabel} title={moreLabel} disabled={value !== null && value >= max} onClick={() => onStep(1)} className="w-8 px-0">
        +
      </EditorButton>
    </div>
  )
}

/** How long a press on a step button is held before it steps by 5, and how often it steps again while held. */
const LONG_PRESS_MS = 450
const REPEAT_MS = 250

/** One of a pair of step buttons: what it is read out as and shown on hover, and whether it can step. */
interface StepButton {
  label: string
  title: string
  disabled: boolean
}

/**
 * A − and a + that step a value: a unit, or 5 with Shift or a long press,
 * which steps again while held. With no keys on touch, the way to an exact
 * value, which a slider moves a unit or two a pixel. `land` gives where a
 * step from a value goes; the same value is no step.
 */
export function StepButtons({ value, land, onStep, label, less, more }: { value: number; land: (from: number, by: -1 | 1, five: boolean) => number; onStep: (next: number) => void; label: string; less: StepButton; more: StepButton }) {
  // The value a held press steps from: the bar draws again between its steps.
  const latest = useRef(value)
  latest.current = value
  const held = useRef<{ timer: number; stepped: boolean } | null>(null)
  const step = (by: -1 | 1, five: boolean) => {
    const from = latest.current
    const next = land(from, by, five)
    if (next === from) return
    latest.current = next
    onStep(next)
  }
  const letGo = () => {
    if (held.current) window.clearTimeout(held.current.timer)
  }
  useEffect(() => letGo, [])
  const press = (by: -1 | 1) => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return
      letGo()
      const state = { timer: 0, stepped: false }
      const again = () => {
        state.stepped = true
        step(by, true)
        state.timer = window.setTimeout(again, REPEAT_MS)
      }
      state.timer = window.setTimeout(again, LONG_PRESS_MS)
      held.current = state
    },
    onPointerUp: letGo,
    onPointerLeave: letGo,
    onPointerCancel: letGo,
    // A long press has stepped already: its click does not step again.
    onClick: (event: React.MouseEvent) => {
      if (held.current?.stepped) {
        held.current = null
        return
      }
      step(by, event.shiftKey)
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  })
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <EditorButton aria-label={less.label} title={less.title} disabled={less.disabled} {...press(-1)} className="w-8 px-0 touch-manipulation select-none">
        −
      </EditorButton>
      <EditorButton aria-label={more.label} title={more.title} disabled={more.disabled} {...press(1)} className="w-8 px-0 touch-manipulation select-none">
        +
      </EditorButton>
    </div>
  )
}
