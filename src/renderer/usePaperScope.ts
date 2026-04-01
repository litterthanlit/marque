import { useEffect, useRef } from 'react'
import paper from 'paper'

export function usePaperScope(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const scopeRef = useRef<paper.PaperScope | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const scope = new paper.PaperScope()
    scope.setup(canvas)

    // Lock view size to canvas pixel dimensions so CSS scaling
    // doesn't shift the coordinate system
    scope.view.viewSize = new scope.Size(canvas.width, canvas.height)

    scopeRef.current = scope

    return () => {
      scope.project.clear()
      scopeRef.current = null
    }
  }, [canvasRef])

  return scopeRef
}
