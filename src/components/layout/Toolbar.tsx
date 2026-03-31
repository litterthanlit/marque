import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const hasResult = useLogoStore((s) => Boolean(s.result))
  const [exportOpen, setExportOpen] = useState(false)

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
    function handleOpenExport() {
      setExportOpen(true)
    }
    window.addEventListener('open-export', handleOpenExport)
    return () => window.removeEventListener('open-export', handleOpenExport)
  }, [])

  return (
    <>
      <header className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-tight text-neutral-900 uppercase">
            Generative Logo System
          </h1>
          <span className="text-xs font-mono text-neutral-400">
            Seed #{seed}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => undo()}
            disabled={!canUndo}
            className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title="Undo (Cmd+Z)"
          >
            Undo
          </button>
          <button
            onClick={() => redo()}
            disabled={!canRedo}
            className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title="Redo (Cmd+Shift+Z)"
          >
            Redo
          </button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasResult}
            className="px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded-md hover:bg-neutral-700 transition-colors disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            Export
          </button>
        </div>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
