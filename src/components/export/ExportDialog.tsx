import { useEffect, useId, useRef, useState } from 'react'
import { useExport } from '../../hooks/useExport.ts'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { exportSVG, exportPNG, canExport, hasDissolution } = useExport()
  const [pngScale, setPngScale] = useState(2)
  const [artboardMode, setArtboardMode] = useState<'tight' | 'square'>('tight')
  const [paddingMode, setPaddingMode] = useState<'none' | 'compact' | 'presentation'>('compact')
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-white rounded-xl shadow-xl p-5 w-80"
      >
        <h2 id={titleId} className="text-sm font-semibold text-neutral-900 mb-4 text-balance">Export</h2>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Artboard" value={artboardMode} onChange={(v) => setArtboardMode(v as 'tight' | 'square')} options={[['tight', 'Tight'], ['square', 'Square']]} />
            <SelectField label="Padding" value={paddingMode} onChange={(v) => setPaddingMode(v as 'none' | 'compact' | 'presentation')} options={[['none', 'None'], ['compact', 'Compact'], ['presentation', 'Presentation']]} />
          </div>

          {hasDissolution && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Dissolution effect will be included in export.
            </div>
          )}

          <button
            onClick={() => { exportSVG({ artboardMode, paddingMode }); onClose() }}
            disabled={!canExport}
            className="h-9 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-default"
          >
            Download SVG
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => { exportPNG(pngScale, { artboardMode, paddingMode }); onClose() }}
              disabled={!canExport}
              className="flex-1 h-9 text-sm font-medium border border-border rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-default"
            >
              PNG
            </button>
            <select
              value={pngScale}
              onChange={(e) => setPngScale(Number(e.target.value))}
              className="h-9 px-2 text-xs border border-border rounded-lg bg-white"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
        </div>

        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="mt-3 w-full h-8 text-xs text-neutral-500 hover:text-neutral-900 rounded-md hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-neutral-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 px-2 text-xs border border-border rounded-md bg-white text-neutral-700"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
