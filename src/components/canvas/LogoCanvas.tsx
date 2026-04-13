import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import { DrawingOverlay } from './DrawingOverlay.tsx'
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
      drawnShapes: ui.drawnShapes,
    })
  }, [result, ui.showGrid, ui.showConstruction, ui.drawnShapes, params.fillColor, dissolution, scopeRef])

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

  const hasPerspective = ui.perspectiveX !== 0 || ui.perspectiveY !== 0
  const perspectiveStyle = hasPerspective
    ? {
        perspective: '800px',
        perspectiveOrigin: 'center center',
      }
    : undefined

  const cardStyle = hasPerspective
    ? {
        transform: `rotateX(${ui.perspectiveX}deg) rotateY(${ui.perspectiveY}deg)`,
        transformStyle: 'preserve-3d' as const,
      }
    : undefined

  return (
    <div className="relative w-full h-full flex items-center justify-center p-8 md:p-12">
      <div
        className="relative w-full max-w-[min(100%,calc(100vh-8rem))] aspect-square"
        style={perspectiveStyle}
      >
        <div
          className="absolute inset-0 rounded-2xl bg-white shadow-2xl shadow-black/20 transition-transform duration-150"
          style={cardStyle}
        >
          <canvas
            ref={canvasRef}
            width={600}
            height={600}
            className="size-full rounded-2xl"
            style={{ imageRendering: 'auto' }}
          />
          <DrawingOverlay />
        </div>
        <AnimationControls playing={playing} canAnimate={canAnimate} onToggle={togglePlaying} />
      </div>
    </div>
  )
}
