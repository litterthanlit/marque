import { useState } from 'react'
import { useExport } from '../../hooks/useExport.ts'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { exportSVG, exportPNG, canExport } = useExport()
  const [pngScale, setPngScale] = useState(2)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-80">
        <h2 className="text-sm font-semibold text-neutral-900 mb-4">Export Logo</h2>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => { exportSVG(); onClose() }}
            disabled={!canExport}
            className="w-full px-4 py-2.5 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Download SVG
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => { exportPNG(pngScale); onClose() }}
              disabled={!canExport}
              className="flex-1 px-4 py-2.5 text-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Download PNG
            </button>
            <select
              value={pngScale}
              onChange={(e) => setPngScale(Number(e.target.value))}
              className="px-2 py-1 text-xs border border-neutral-200 rounded-lg bg-white"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
