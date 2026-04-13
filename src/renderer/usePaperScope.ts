import { useEffect, useRef } from 'react'
import paper from 'paper'

export function usePaperScope(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const scopeRef = useRef<paper.PaperScope | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Disable Paper.js HiDPI scaling. Without this, Paper.js multiplies
    // canvas dimensions by devicePixelRatio on Retina displays, causing
    // a mismatch between the view coordinate space and the pixel buffer.
    // Paper.js checks this attribute during CanvasView initialization.
    canvas.setAttribute('hidpi', 'off')

    const scope = new paper.PaperScope()
    scope.setup(canvas)
    scopeRef.current = scope

    return () => {
      scope.project.clear()
      scopeRef.current = null
    }
  }, [canvasRef])

  return scopeRef
}
