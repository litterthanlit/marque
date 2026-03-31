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
    <div className="relative flex-1 overflow-hidden rounded-[32px] border border-neutral-200 bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.94)_25%,rgba(244,241,237,0.9)_70%,rgba(229,226,221,0.85)_100%)] shadow-[0_22px_80px_rgba(15,23,42,0.08)]">
      <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative flex h-full w-full items-center justify-center p-4">
      <canvas
        ref={canvasRef}
        width={600}
        height={600}
        className="h-full w-full max-h-[640px] max-w-[640px]"
        style={{ imageRendering: 'auto' }}
      />
      <AnimationControls
        playing={playing}
        canAnimate={canAnimate}
        onToggle={togglePlaying}
      />
      </div>
    </div>
  )
}
