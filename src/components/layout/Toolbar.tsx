import { useEffect, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { useExport } from '../../hooks/useExport.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { cn } from '../../lib/utils.ts'

export function Toolbar() {
  const undo = useLogoStore((s) => s.undoVectorCommand)
  const redo = useLogoStore((s) => s.redoVectorCommand)
  const canUndo = useLogoStore((s) => s.vectorUndoStack.length > 0)
  const canRedo = useLogoStore((s) => s.vectorRedoStack.length > 0)
  const look = useLogoStore((s) => s.ui.look)
  const toggleLook = useLogoStore((s) => s.toggleLook)
  const { canExport } = useExport()
  const [exportOpen, setExportOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')

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
      <header className="flex items-center justify-between h-12 gap-2 px-3 sm:px-5 border-b border-border bg-surface-raised">
        <span className="font-display text-[18px] leading-none font-medium tracking-tight text-fg">dalat</span>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <ToolbarButton onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)" className="hidden sm:inline-flex">
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton onClick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)" className="hidden sm:inline-flex">
            <RedoIcon />
          </ToolbarButton>
          <div className="hidden sm:block w-px h-3.5 bg-border mx-1" />
          <ToolbarButton
            onClick={toggleLook}
            aria-label="Show construction lines"
            aria-pressed={look === 'construction'}
            title="Show construction lines (F)"
            className="aria-pressed:bg-interactive-hover aria-pressed:text-fg"
          >
            <ConstructionIcon />
          </ToolbarButton>
          <ToolbarButton onClick={handleCopyShareLink} className="hidden lg:inline-flex">
            {shareState === 'copied' ? 'Copied' : shareState === 'failed' ? 'Failed' : 'Share'}
          </ToolbarButton>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!canExport}
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

function ConstructionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="8" height="8" rx="1" />
      <circle cx="10" cy="6" r="4" strokeDasharray="0.1 2.4" />
    </svg>
  )
}
