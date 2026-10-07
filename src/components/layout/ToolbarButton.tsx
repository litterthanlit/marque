import { cn } from '../../lib/utils.ts'

/**
 * A quiet button in the top bar: flat lettering on the page, a tint under
 * the pointer, a slight give when pressed. Toggled or open, it stays tinted.
 * Hover comes in at the enter speed and leaves at the exit speed, so it
 * never lags the pointer.
 */
export function ToolbarButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-sound="soft"
      {...props}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-key px-1.5 text-xs font-medium text-muted sm:px-2',
        'transition-[background-color,color,transform] duration-(--duration-exit) ease-out hover:bg-black/[0.045] hover:text-ink hover:duration-(--duration-enter) active:scale-[0.97] dark:hover:bg-white/[0.06]',
        'aria-expanded:bg-black/[0.06] aria-expanded:text-ink dark:aria-expanded:bg-white/[0.08]',
        'aria-pressed:bg-black/[0.06] aria-pressed:text-ink dark:aria-pressed:bg-white/[0.08]',
        'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted disabled:active:scale-100',
        'outline-offset-2',
        props.className,
      )}
    >
      {children}
    </button>
  )
}

/** A popover under a top-bar button: right-aligned to it, or the width of the screen on a phone. */
export const TOOLBAR_PANEL =
  'max-sm:fixed max-sm:inset-x-3 max-sm:top-14 sm:absolute sm:top-full sm:right-0 sm:mt-2 sm:w-72'
