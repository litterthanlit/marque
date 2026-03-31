import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'

export function LogoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const effectParams = useLogoStore((s) => s.effectParams)

  const dissolution = useMemo(() => {
    if (!result || !effectParams.dissolution.enabled) return null
    return DissolutionProcessor.process(result, effectParams.dissolution)
  }, [result, effectParams.dissolution])

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !result) return
    renderLogoOnScope(scope, result, {
      showGrid: ui.showGrid,
      showConstruction: ui.showConstruction,
      fillColor: params.fillColor,
      dissolution,
    })
  }, [result, ui.showGrid, ui.showConstruction, params.fillColor, dissolution, scopeRef])

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
    <div className="relative w-full max-w-xl aspect-square bg-white rounded-lg border border-border shadow-sm">
      <canvas
        ref={canvasRef}
        width={680}
        height={680}
        className="size-full rounded-lg"
        style={{ imageRendering: 'auto' }}
      />
      <AnimationControls playing={playing} canAnimate={canAnimate} onToggle={togglePlaying} />
    </div>
  )
}
