import { useRef, useEffect } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderPreviewOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'

export function FinalPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const result = useLogoStore((s) => s.result)
  const fillColor = useLogoStore((s) => s.params.fillColor)

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !result) return

    renderPreviewOnScope(scope, result, fillColor)
  }, [result, fillColor, scopeRef])

  return (
    <div className="rounded-[24px] border border-neutral-200 bg-white/90 p-3 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
      <div className="mb-2 text-[11px] uppercase tracking-[0.28em] text-neutral-400">
        Final Logo
      </div>
      <canvas
        ref={canvasRef}
        width={200}
        height={200}
        className="w-full aspect-square"
      />
    </div>
  )
}
