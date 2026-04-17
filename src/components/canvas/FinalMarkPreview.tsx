import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'

export function FinalMarkPreview() {
  const result = useLogoStore((s) => s.result)
  const fillColor = useLogoStore((s) => s.params.fillColor)

  const markData = result?.mark.compoundPathData
  const fillRule = result?.mark.fillRule
  const viewBox = result?.mark.viewBox

  const hasMark = Boolean(markData && fillRule && viewBox)
  const vbString = viewBox
    ? `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
    : '0 0 1 1'

  return (
    <div
      aria-label="Final mark preview"
      className={cn(
        'w-full h-full rounded-lg overflow-hidden',
        'bg-paper border border-paper-line shadow-sm',
        'flex flex-col',
      )}
      style={{ contain: 'layout paint' }}
    >
      <div className="relative flex-1 flex items-center justify-center p-4">
        {hasMark ? (
          <svg
            viewBox={vbString}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
            aria-hidden="true"
          >
            <path d={markData} fill={fillColor} fillRule={fillRule} />
          </svg>
        ) : (
          <div className="flex-1 self-stretch rounded-md border border-dashed border-paper-line flex items-center justify-center">
            <span className="font-mono-tabular text-[10px] text-paper-muted">pending</span>
          </div>
        )}
      </div>
      <div
        className={cn(
          'shrink-0 px-2 py-1 text-center',
          'text-[9px] font-medium uppercase tracking-[0.14em] text-paper-muted',
          'border-t border-paper-line',
        )}
      >
        Final mark
      </div>
    </div>
  )
}
