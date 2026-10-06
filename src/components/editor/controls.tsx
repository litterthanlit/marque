import { cn } from '../../lib/utils.ts'

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised'

export const FLOATING_SURFACE = 'rounded-xl border border-border bg-surface-raised shadow-lg shadow-black/20'

interface EditorButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** A toggle or one choice of several: sets `aria-pressed` and lights the button. */
  pressed?: boolean
  danger?: boolean
}

export function EditorButton({ pressed, danger, className, children, ...props }: EditorButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 text-xs transition-colors',
        'disabled:opacity-40 disabled:cursor-default aria-expanded:bg-interactive aria-expanded:text-fg',
        FOCUS_RING,
        pressed
          ? 'bg-interactive text-fg ring-1 ring-interactive-ring'
          : danger
            ? 'bg-interactive-active text-red-400 hover:bg-interactive-hover'
            : 'bg-interactive-active text-sidebar-text hover:bg-interactive-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

interface SegmentedProps<T extends string | number> {
  label: string
  /** Each option, with a tooltip when it has a shortcut or a note. */
  options: ReadonlyArray<{ value: T; label: string; title?: string }>
  value: T
  onChange: (value: T) => void
  className?: string
}

export function Segmented<T extends string | number>({ label, options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={cn('flex gap-1 rounded-lg bg-interactive-active p-0.5', className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 flex-1 rounded-md px-2.5 text-xs transition-colors',
            FOCUS_RING,
            value === option.value ? 'bg-interactive text-fg shadow-sm' : 'text-sidebar-text hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
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

/** Pink like the snap hints and the weak-spot marks it turns on: the switch reads as part of the same system. */
export function SwitchButton({ label, checked, onChange, title, className }: SwitchButtonProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-8 shrink-0 items-center justify-between gap-2 rounded-lg bg-interactive-active px-2.5 text-xs text-sidebar-text transition-colors hover:bg-interactive-hover hover:text-fg',
        FOCUS_RING,
        className,
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors duration-150',
          checked ? 'bg-pink-500' : 'bg-neutral-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none',
            checked ? 'translate-x-3' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  )
}

export function Divider({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('h-4 w-px shrink-0 bg-border', className)} />
}
