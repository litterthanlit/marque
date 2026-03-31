import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { getModeDefinition } from '../../store/modes.ts'

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
      <header className="flex items-center justify-between h-11 px-4 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold tracking-tight text-neutral-900">Dalat</span>
          <span className="text-[11px] text-neutral-400 font-mono tabular-nums">#{seed}</span>
          <span className="hidden sm:inline text-[11px] text-neutral-400">{mode?.name ?? modeId}</span>
          <span className="hidden lg:inline text-[11px] text-neutral-400 capitalize">{styleFamily}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => undo()} disabled={!canUndo} className="px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-default" title="Undo">Undo</button>
          <button onClick={() => redo()} disabled={!canRedo} className="px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-default" title="Redo">Redo</button>
          <div className="w-px h-4 bg-neutral-200 mx-1" />
          <button onClick={handleCopyShareLink} className="px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-900 transition-colors">
            {shareState === 'copied' ? 'Copied!' : shareState === 'failed' ? 'Failed' : 'Share'}
          </button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasResult}
            className="ml-1 px-3 py-1 text-[11px] font-medium bg-neutral-900 text-white rounded hover:bg-neutral-700 transition-colors disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-default"
          >
            Export
          </button>
        </div>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
