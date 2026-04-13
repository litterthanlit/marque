import { useEffect, useId, useRef, useState } from 'react'
import { useExport } from '../../hooks/useExport.ts'
import { cn } from '../../lib/utils.ts'

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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-surface-raised border border-border rounded-2xl shadow-2xl shadow-black/40 p-5 w-80"
      >
        <h2 id={titleId} className="text-sm font-semibold text-fg mb-4">Export</h2>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Artboard" value={artboardMode} onChange={(v) => setArtboardMode(v as 'tight' | 'square')} options={[['tight', 'Tight'], ['square', 'Square']]} />
            <SelectField label="Padding" value={paddingMode} onChange={(v) => setPaddingMode(v as 'none' | 'compact' | 'presentation')} options={[['none', 'None'], ['compact', 'Compact'], ['presentation', 'Presentation']]} />
          </div>

          {hasDissolution && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Dissolution effect included in export
            </div>
          )}

          <button
            onClick={() => { exportSVG({ artboardMode, paddingMode }); onClose() }}
            disabled={!canExport}
            className={cn(
              'h-9 text-sm font-medium rounded-lg transition-colors',
              'bg-white text-neutral-900 hover:bg-neutral-200',
              'disabled:bg-white/5 disabled:text-neutral-600 disabled:cursor-default',
            )}
          >
            Download SVG
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => { exportPNG(pngScale, { artboardMode, paddingMode }); onClose() }}
              disabled={!canExport}
              className={cn(
                'flex-1 h-9 text-sm font-medium rounded-lg transition-colors',
                'border border-border text-fg hover:bg-interactive-hover',
                'disabled:opacity-30 disabled:cursor-default',
              )}
            >
              PNG
            </button>
            <select
              value={pngScale}
              onChange={(e) => setPngScale(Number(e.target.value))}
              className="h-9 px-2 text-xs border border-border rounded-lg bg-surface text-fg"
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
          className="mt-3 w-full h-8 text-xs text-sidebar-muted hover:text-fg rounded-lg hover:bg-interactive-hover transition-colors"
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
      <label className="text-[10px] uppercase tracking-widest text-sidebar-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 px-2 text-xs border border-border rounded-lg bg-surface text-fg"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
