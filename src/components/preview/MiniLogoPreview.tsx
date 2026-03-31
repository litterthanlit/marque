import { useMemo } from 'react'
import type { LogoParams } from '../../engine/types.ts'
import { generate } from '../../engine/pipeline/GenerationPipeline.ts'

interface MiniLogoPreviewProps {
  params: LogoParams
  className?: string
}

export function MiniLogoPreview({
  params,
  className = '',
}: MiniLogoPreviewProps) {
  const preview = useMemo(() => {
    try {
      const result = generate(params)
      if (!result.mark.compoundPathData) return null
      const padding = 20
      const viewBox = result.mark.viewBox
      const paddedViewBox = [
        viewBox.x - padding,
        viewBox.y - padding,
        viewBox.width + padding * 2,
        viewBox.height + padding * 2,
      ].join(' ')

      return {
        path: result.mark.compoundPathData,
        fillRule: result.mark.fillRule,
        viewBox: paddedViewBox,
      }
    } catch {
      return null
    }
  }, [params])

  if (!preview) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-100 text-[10px] uppercase tracking-[0.2em] text-neutral-400 ${className}`}
      >
        Pending
      </div>
    )
  }

  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.35)_35%,rgba(240,240,240,0.85)_100%)] ${className}`}
    >
      <svg
        viewBox={preview.viewBox}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={preview.path}
          fill={params.fillColor}
          fillRule={preview.fillRule}
        />
      </svg>
    </div>
  )
}
