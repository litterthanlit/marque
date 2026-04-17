import { useEffect, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { useExport } from '../../hooks/useExport.ts'
import { serializeMarkToSVG } from './markSerializer.ts'
import { cn } from '../../lib/utils.ts'

export function ExportTile() {
  const result = useLogoStore((s) => s.result)
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const { exportPNG } = useExport()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  async function handleCopySVG() {
    if (!result) return
    const { compoundPathData, fillRule, viewBox } = result.mark
    const svgString = serializeMarkToSVG(compoundPathData, fillRule, viewBox, fillColor)
    try {
      await navigator.clipboard.writeText(svgString)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const isDisabled = result === null

  return (
    <section
      aria-label="Export"
      className={cn(
        'bg-paper border border-paper-line rounded-lg overflow-hidden',
        'p-3 flex flex-col gap-2',
      )}
    >
      <span className="text-[10px] uppercase tracking-[0.14em] text-paper-muted">
        Export
      </span>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleCopySVG}
          disabled={isDisabled}
          aria-label={copyState === 'copied' ? 'SVG copied to clipboard' : 'Copy SVG'}
          className={cn(
            'h-8 rounded-md text-[11px] font-medium',
            'bg-paper-ink text-paper hover:opacity-90',
            'disabled:opacity-30 disabled:cursor-default',
            'focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-[color:var(--color-selection)]',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
          )}
        >
          <span aria-live="polite">
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy SVG'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => exportPNG()}
          disabled={isDisabled}
          aria-label="Download PNG"
          className={cn(
            'h-8 rounded-md text-[11px] font-medium',
            'bg-paper-ink text-paper hover:opacity-90',
            'disabled:opacity-30 disabled:cursor-default',
            'focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-[color:var(--color-selection)]',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
          )}
        >
          Download PNG
        </button>
      </div>
    </section>
  )
}
