import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { cn } from '../../lib/utils.ts'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const hasResult = useLogoStore((s) => Boolean(s.result))
  const dissolutionEnabled = useLogoStore((s) => s.effectParams.dissolution.enabled)
  const toggleDissolution = useLogoStore((s) => s.toggleDissolution)
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const undoVectorCommand = useLogoStore((s) => s.undoVectorCommand)
  const redoVectorCommand = useLogoStore((s) => s.redoVectorCommand)
  const canUndoVector = useLogoStore((s) => s.vectorUndoStack.length > 0)
  const canRedoVector = useLogoStore((s) => s.vectorRedoStack.length > 0)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const { undo, redo } = useLogoStore.temporal.getState()
  const canUndoGenerated = useSyncExternalStore(
    (listener) => useLogoStore.temporal.subscribe(listener),
    () => useLogoStore.temporal.getState().pastStates.length > 0,
    () => false,
  )
  const canRedoGenerated = useSyncExternalStore(
    (listener) => useLogoStore.temporal.subscribe(listener),
    () => useLogoStore.temporal.getState().futureStates.length > 0,
    () => false,
  )
  const canUndo = activeSurface === 'illustrator' ? canUndoVector : canUndoGenerated
  const canRedo = activeSurface === 'illustrator' ? canRedoVector : canRedoGenerated

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

  function handleUndo() {
    if (activeSurface === 'illustrator') {
      undoVectorCommand()
    } else {
      undo()
    }
  }

  function handleRedo() {
    if (activeSurface === 'illustrator') {
      redoVectorCommand()
    } else {
      redo()
    }
  }

  return (
    <>
      <header className="flex items-center justify-between h-12 gap-2 px-3 sm:px-5 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display text-[18px] leading-none font-medium tracking-tight text-fg">dalat</span>
          <span className="font-mono-tabular text-[11px] text-sidebar-muted">#{seed}</span>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <ToolbarButton onClick={handleUndo} disabled={!canUndo} title="Undo (Cmd+Z)" className="hidden sm:inline-flex">
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton onClick={handleRedo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)" className="hidden sm:inline-flex">
            <RedoIcon />
          </ToolbarButton>
          <div className="hidden sm:block w-px h-3.5 bg-border mx-1" />
          {dissolutionEnabled && (
            <ToolbarButton
              onClick={toggleDissolution}
              title="Dissolution effect is active. Click to turn it off."
              className="text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 hover:text-amber-200"
            >
              <span className="lg:hidden">Fx</span>
              <span className="hidden lg:inline">Effect On</span>
            </ToolbarButton>
          )}
          {activeSurface === 'illustrator' && (
            <span
              title="Export and sharing are using the editable Vector Maker document."
              className="hidden sm:inline-flex h-7 items-center rounded-md border border-sky-500/20 bg-sky-500/10 px-2 text-xs text-sky-300"
            >
              Vector Maker
            </span>
          )}
          <ToolbarButton onClick={handleCopyShareLink} className="hidden lg:inline-flex">
            {shareState === 'copied' ? 'Copied' : shareState === 'failed' ? 'Failed' : 'Share'}
          </ToolbarButton>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasResult}
            className={cn(
              'ml-1 h-7 px-2 sm:px-3 text-xs font-medium rounded-md transition-colors',
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
        'inline-flex h-7 items-center justify-center px-2 text-xs text-sidebar-muted rounded-md transition-colors',
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
