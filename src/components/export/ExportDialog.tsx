import { useEffect, useId, useRef, useState } from 'react'
import { useExport } from '../../hooks/useExport.ts'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { exportSVG, exportPNG, canExport } = useExport()
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
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-white rounded-xl shadow-xl p-6 w-80"
      >
        <h2 id={titleId} className="text-sm font-semibold text-neutral-900 mb-4">Export Logo</h2>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-[0.24em] text-neutral-400">
                Artboard
              </label>
              <select
                value={artboardMode}
                onChange={(event) =>
                  setArtboardMode(event.target.value as 'tight' | 'square')
                }
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700"
              >
                <option value="tight">Tight bounds</option>
                <option value="square">Square artboard</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-[0.24em] text-neutral-400">
                Padding
              </label>
              <select
                value={paddingMode}
                onChange={(event) =>
                  setPaddingMode(
                    event.target.value as 'none' | 'compact' | 'presentation',
                  )
                }
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700"
              >
                <option value="none">None</option>
                <option value="compact">Compact</option>
                <option value="presentation">Presentation</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => {
              exportSVG({ artboardMode, paddingMode })
              onClose()
            }}
            disabled={!canExport}
            className="w-full px-4 py-2.5 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Download SVG
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => {
                exportPNG(pngScale, { artboardMode, paddingMode })
                onClose()
              }}
              disabled={!canExport}
              className="flex-1 px-4 py-2.5 text-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Transparent PNG
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
          <p className="text-[11px] leading-4 text-neutral-500">
            PNG export preserves the logo&apos;s aspect ratio, supports square or tight artboards, and keeps the background transparent.
          </p>
        </div>

        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
