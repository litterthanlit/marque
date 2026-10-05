import { cn } from '../../lib/utils.ts'

export function ToolbarButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center px-1.5 sm:px-2 text-xs text-sidebar-text rounded-md transition-colors',
        'hover:bg-interactive-hover hover:text-fg',
        'aria-expanded:bg-interactive-hover aria-expanded:text-fg',
        'disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-sidebar-text',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
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
