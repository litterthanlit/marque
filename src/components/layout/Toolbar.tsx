import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { getModeDefinition } from '../../store/modes.ts'
import { cn } from '../../lib/utils.ts'

function ThemeIcon({ theme }: { theme: string }) {
  if (theme === 'light') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M13.5 8.5a5.5 5.5 0 1 1-6-6 4.5 4.5 0 0 0 6 6Z" />
    </svg>
  )
}

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const modeId = useLogoStore((s) => s.params.modeId)
  const styleFamily = useLogoStore((s) => s.params.styleFamily)
  const hasResult = useLogoStore((s) => Boolean(s.result))
  const theme = useLogoStore((s) => s.ui.theme)
  const toggleTheme = useLogoStore((s) => s.toggleTheme)
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

  const mode = getModeDefinition(modeId)

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
      <header className="flex items-center justify-between h-11 px-4 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-fg tracking-tight">dalat</span>
          <span className="text-sidebar-muted">/</span>
          <span className="hidden sm:inline text-xs text-sidebar-text">{mode?.name ?? modeId}</span>
          <span className="hidden lg:inline text-sidebar-muted">/</span>
          <span className="hidden lg:inline text-xs text-sidebar-muted capitalize">{styleFamily}</span>
          <span className="text-[10px] text-sidebar-muted font-mono tabular-nums ml-1">#{seed}</span>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => undo()} disabled={!canUndo} title="Undo (Cmd+Z)">
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton onClick={() => redo()} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
            <RedoIcon />
          </ToolbarButton>
          <div className="w-px h-3.5 bg-border mx-1" />
          <ToolbarButton onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            <ThemeIcon theme={theme} />
          </ToolbarButton>
          <ToolbarButton onClick={handleCopyShareLink}>
            {shareState === 'copied' ? 'Copied' : 'Share'}
          </ToolbarButton>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasResult}
            className={cn(
              'ml-1 h-7 px-3 text-xs font-medium rounded-md transition-colors',
              'bg-neutral-800 text-white hover:bg-neutral-700',
              'disabled:opacity-30 disabled:cursor-default',
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
