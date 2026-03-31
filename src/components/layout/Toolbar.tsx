import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { getModeDefinition } from '../../store/modes.ts'
import { cn } from '../../lib/utils.ts'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const modeId = useLogoStore((s) => s.params.modeId)
  const styleFamily = useLogoStore((s) => s.params.styleFamily)
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
      <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-neutral-900">Dalat</span>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500">
            <span>/</span>
            <span>{mode?.name ?? modeId}</span>
            <span>/</span>
            <span className="capitalize">{styleFamily}</span>
          </div>
          <span className="text-xs text-neutral-400 font-mono tabular-nums">#{seed}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <ToolbarButton onClick={() => undo()} disabled={!canUndo} title="Undo (Cmd+Z)">Undo</ToolbarButton>
          <ToolbarButton onClick={() => redo()} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">Redo</ToolbarButton>
          <div className="w-px h-4 bg-border mx-1" />
          <ToolbarButton onClick={handleCopyShareLink}>
            {shareState === 'copied' ? 'Copied!' : shareState === 'failed' ? 'Failed' : 'Share'}
          </ToolbarButton>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasResult}
            className={cn(
              'ml-1 h-7 px-3 text-xs font-medium rounded-md',
              'bg-neutral-900 text-white hover:bg-neutral-800',
              'disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-default',
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
        'h-7 px-2 text-xs text-neutral-500 rounded-md',
        'hover:bg-neutral-100 hover:text-neutral-900',
        'disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-neutral-500',
        props.className,
      )}
    >
      {children}
    </button>
  )
}
