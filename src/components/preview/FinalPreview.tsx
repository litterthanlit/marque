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
    <div className="border border-neutral-200 rounded-lg bg-white p-2">
      <div className="text-xs text-neutral-400 uppercase tracking-wider mb-2">
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
