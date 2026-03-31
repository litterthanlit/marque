import { useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const [exportOpen, setExportOpen] = useState(false)

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
        <button
          onClick={() => setExportOpen(true)}
          className="px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded-md hover:bg-neutral-700 transition-colors"
        >
          Export
        </button>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
