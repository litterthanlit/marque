import { useRef, useEffect, useCallback } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'

export function LogoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const fillColor = useLogoStore((s) => s.params.fillColor)

  // Static render
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !result) return

    renderLogoOnScope(scope, result, {
      showGrid: ui.showGrid,
      showConstruction: ui.showConstruction,
      fillColor,
    })
  }, [result, ui.showGrid, ui.showConstruction, fillColor, scopeRef])

  // Animation frame callback
  const onFrame = useCallback((keyframe: AnimationKeyframe) => {
    const scope = scopeRef.current
    if (!scope) return

    const view = scope.view
    if (keyframe.rotation === 0 && keyframe.scale === 1) {
      view.rotation = 0
      view.scaling = new scope.Point(1, 1)
    } else {
      view.rotation = (keyframe.rotation * 180) / Math.PI
      view.scaling = new scope.Point(keyframe.scale, keyframe.scale)
    }
    view.update()
  }, [scopeRef])

  const { playing, togglePlaying, canAnimate } = useAnimation(onFrame)

  return (
    <div className="flex-1 flex items-center justify-center bg-white relative">
      <canvas
        ref={canvasRef}
        width={600}
        height={600}
        className="w-full h-full max-w-[600px] max-h-[600px]"
        style={{ imageRendering: 'auto' }}
      />
      <AnimationControls
        playing={playing}
        canAnimate={canAnimate}
        onToggle={togglePlaying}
      />
    </div>
  )
}
