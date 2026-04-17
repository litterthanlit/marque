import { useEffect, useMemo, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'

// TODO(phase-c): extract to src/renderer/ once a shared SVG serializer
// lives there. Phase B is forbidden from touching src/renderer/**, so we
// inline a minimal serializer here. Mirrors useExport.ts's generateSVGString
// at tight/no-padding defaults.
function serializeMarkToSVG(
  compoundPathData: string,
  fillRule: 'nonzero' | 'evenodd',
  viewBox: { x: number; y: number; width: number; height: number },
  fillColor: string,
): string {
  const vb = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">`,
    `  <path d="${compoundPathData}" fill="${fillColor}" fill-rule="${fillRule}" />`,
    `</svg>`,
  ].join('\n')
}

export function FinalMarkPreview() {
  const result = useLogoStore((s) => s.result)
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const markData = result?.mark.compoundPathData
  const fillRule = result?.mark.fillRule
  const viewBox = result?.mark.viewBox

  const svgString = useMemo(() => {
    if (!markData || !fillRule || !viewBox) return null
    return serializeMarkToSVG(markData, fillRule, viewBox, fillColor)
  }, [markData, fillRule, viewBox, fillColor])

  useEffect(() => {
    if (copyState === 'idle') return
    const t = window.setTimeout(() => setCopyState('idle'), 2000)
    return () => window.clearTimeout(t)
  }, [copyState])

  async function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (!svgString) return
    try {
      await navigator.clipboard.writeText(svgString)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const hasMark = Boolean(svgString && viewBox)
  const vbString = viewBox
    ? `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
    : '0 0 1 1'

  return (
    <div
      aria-label="Final mark preview"
      className={cn(
        'group absolute top-4 right-4 z-20',
        'w-24 h-24 rounded-lg overflow-hidden',
        'bg-paper border border-paper-line shadow-sm',
        'flex flex-col',
      )}
      style={{ contain: 'layout paint' }}
    >
      <div className="relative flex-1 flex items-center justify-center">
        {hasMark ? (
          <svg
            viewBox={vbString}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full p-2"
            aria-hidden="true"
          >
            <path d={markData} fill={fillColor} fillRule={fillRule} />
          </svg>
        ) : (
          <div className="m-2 flex-1 self-stretch rounded-md border border-dashed border-paper-line flex items-center justify-center">
            <span className="font-mono-tabular text-[10px] text-paper-muted">pending</span>
          </div>
        )}

        {hasMark && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copyState === 'copied' ? 'SVG copied' : 'Copy SVG'}
            className={cn(
              'absolute bottom-1 right-1',
              'h-5 px-1.5 rounded text-[9px] font-medium tracking-tight',
              'bg-paper-ink text-paper',
              'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              'transition-opacity duration-150',
              'focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-[color:var(--color-selection)]',
              'focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
            )}
          >
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
          </button>
        )}
      </div>
      <div
        aria-live="polite"
        className={cn(
          'shrink-0 px-2 py-1 text-center',
          'text-[9px] font-medium uppercase tracking-[0.14em] text-paper-muted',
          'border-t border-paper-line',
        )}
      >
        {copyState === 'copied' ? 'Copied' : 'Final mark'}
      </div>
    </div>
  )
}
