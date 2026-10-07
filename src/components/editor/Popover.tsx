import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'
import { FLOATING_SURFACE } from './controls.tsx'

interface TriggerProps {
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
}

interface PopoverProps {
  label: string
  /** For the wrapper. The panel is placed against the nearest positioned ancestor, which can be this. */
  className?: string
  panelClassName?: string
  trigger: (props: TriggerProps) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
}

export function Popover({ label, className, panelClassName, trigger, children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      const root = rootRef.current
      if (root?.contains(document.activeElement)) root.querySelector('button')?.focus()
      setOpen(false)
    }
    // Capturing: Escape closes the panel before the canvas editors step back a level.
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className={className}>
      {trigger({
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
        onClick: () => setOpen((current) => !current),
      })}
      {open && (
        <div id={panelId} role="group" aria-label={label} className={cn(FLOATING_SURFACE, 'z-40 animate-drop p-3', panelClassName)}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}
