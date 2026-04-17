import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { cn } from '../../lib/utils.ts'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const hasResult = useLogoStore((s) => Boolean(s.result))
  const [exportOpen, setExportOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const { undo, redo } = useLogoStore.temporal.getState()
  const canUndo = useSyncExternalStore(
    (listener) => useLogoStore.temporal.subscribe(listener),
    () => useLogoStore.temporal.getState().pastStates.length > 0,
    () => false,
  )
  const canRedo = useSyncExternalStore(
    (listener) => useLogoStore.temporal.subscribe(listener),
    () => useLogoStore.temporal.getState().futureStates.length > 0,
    () => false,
  )

  useEffect(() => {
    function handleOpenExport() { setExportOpen(true) }
    window.addEventListener('open-export', handleOpenExport)
    return () => window.removeEventListener('open-export', handleOpenExport)
  }, [])

  useEffect(() => {
    if (shareState === 'idle') return
    const timer = window.setTimeout(() => setShareState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [shareState])

  async function handleCopyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareState('copied')
    } catch {
      setShareState('failed')
    }
  }

  return (
    <>
      <header className="flex items-center justify-between h-12 px-5 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display text-[18px] leading-none font-medium tracking-tight text-fg">dalat</span>
          <span className="font-mono-tabular text-[11px] text-sidebar-muted">#{seed}</span>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => undo()} disabled={!canUndo} title="Undo (Cmd+Z)">
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => redo()} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
            <RedoIcon />
          </ToolbarButton>
          <div className="w-px h-3.5 bg-border mx-1" />
          <ToolbarButton onClick={handleCopyShareLink}>
            {shareState === 'copied' ? 'Copied' : shareState === 'failed' ? 'Failed' : 'Share'}
          </ToolbarButton>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasResult}
            className={cn(
              'ml-1 h-7 px-3 text-xs font-medium rounded-md transition-colors',
              'bg-fg text-surface hover:opacity-80',
              'disabled:opacity-30 disabled:cursor-default',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
            )}
          >
            Export
          </button>
        </div>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}

function ToolbarButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'h-7 px-2 text-xs text-sidebar-muted rounded-md transition-colors',
        'hover:bg-interactive-hover hover:text-fg',
        'disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-sidebar-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
        props.className,
      )}
    >
      {children}
    </button>
  )
}

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h7a4 4 0 0 1 0 8H7" />
      <path d="M6 4L3 7l3 3" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 7H6a4 4 0 0 0 0 8h3" />
      <path d="M10 4l3 3-3 3" />
    </svg>
  )
}
