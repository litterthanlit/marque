import { useEffect, useMemo, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { useExport } from '../../hooks/useExport.ts'
import { serializeMarkToSVG } from './markSerializer.ts'
import { cn } from '../../lib/utils.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'

export function ExportTile() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const effectParams = useLogoStore((s) => s.effectParams)
  const activeMark = useActiveMark()
  const { exportPNG, canExport } = useExport()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copyMark = useMemo(() => {
    if (!activeMark) return null
    if (!effectParams.dissolution.enabled) return activeMark

    const dissolution = DissolutionProcessor.process(
      { mark: activeMark },
      effectParams.dissolution,
    )
    if (!dissolution) return activeMark

    const parts = [
      dissolution.solidCorePath,
      dissolution.particlePathData,
    ].filter(Boolean)
    if (parts.length === 0) return null

    return {
      compoundPathData: parts.join(' '),
      fillRule: 'evenodd' as const,
      viewBox: dissolution.viewBox,
    }
  }, [activeMark, effectParams.dissolution])

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  async function handleCopySVG() {
    if (!copyMark) return
    const { compoundPathData, fillRule, viewBox } = copyMark
    const svgString = serializeMarkToSVG(compoundPathData, fillRule, viewBox, fillColor)
    try {
      await navigator.clipboard.writeText(svgString)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

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
          disabled={!canExport}
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
          disabled={!canExport}
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
