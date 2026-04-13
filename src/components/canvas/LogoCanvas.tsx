import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { InteractionLayer } from '../../renderer/InteractionLayer.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import { DrawingOverlay } from './DrawingOverlay.tsx'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'

export function LogoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const interactionRef = useRef<InteractionLayer | null>(null)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const effectParams = useLogoStore((s) => s.effectParams)
  const selectShape = useLogoStore((s) => s.selectShape)
  const updateShapeOverride = useLogoStore((s) => s.updateShapeOverride)
  const deleteSelectedShape = useLogoStore((s) => s.deleteSelectedShape)
  const clearShapeOverrides = useLogoStore((s) => s.clearShapeOverrides)

  const dissolution = useMemo(() => {
    if (!result || !effectParams.dissolution.enabled) return null
    return DissolutionProcessor.process(result, effectParams.dissolution)
  }, [result, effectParams.dissolution])

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !result) return
    const itemMap = renderLogoOnScope(scope, result, {
      showGrid: ui.showGrid,
      showConstruction: ui.showConstruction,
      fillColor: params.fillColor,
      dissolution,
      drawnShapes: ui.drawnShapes,
      editMode: ui.editMode,
    })

    if (ui.editMode && itemMap) {
      if (!interactionRef.current) {
        interactionRef.current = new InteractionLayer(scope, {
          onSelect: (id) => selectShape(id),
          onMove: (id, dx, dy) => {
            const prev = useLogoStore.getState().ui.shapeOverrides[id]
            updateShapeOverride(id, {
              dx: (prev?.dx ?? 0) + dx,
              dy: (prev?.dy ?? 0) + dy,
            })
          },
        })
      }
      interactionRef.current.setup(itemMap)
      interactionRef.current.applyOverrides(ui.shapeOverrides)
      interactionRef.current.showSelection(ui.selectedShapeId)
    } else if (!ui.editMode && interactionRef.current) {
      interactionRef.current.destroy()
      interactionRef.current = null
    }
  }, [result, ui.showGrid, ui.showConstruction, ui.drawnShapes, ui.editMode, ui.shapeOverrides, ui.selectedShapeId, params.fillColor, dissolution, scopeRef, selectShape, updateShapeOverride])

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

  const canvasStyle: React.CSSProperties = hasPerspective
    ? {
        imageRendering: 'auto',
        transform: `perspective(800px) rotateX(${ui.perspectiveX}deg) rotateY(${ui.perspectiveY}deg)`,
        transition: 'transform 150ms',
        cursor: ui.editMode ? 'default' : undefined,
      }
    : { imageRendering: 'auto', cursor: ui.editMode ? 'default' : undefined }

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ui.editMode || !interactionRef.current || !scopeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = new scopeRef.current.Point(e.clientX - rect.left, e.clientY - rect.top)
    interactionRef.current.onMouseDown(point)
  }, [ui.editMode, scopeRef])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ui.editMode || !interactionRef.current || !scopeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = new scopeRef.current.Point(e.clientX - rect.left, e.clientY - rect.top)
    interactionRef.current.onMouseDrag(point)
  }, [ui.editMode, scopeRef])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ui.editMode || !interactionRef.current || !scopeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = new scopeRef.current.Point(e.clientX - rect.left, e.clientY - rect.top)
    interactionRef.current.onMouseUp(point)
  }, [ui.editMode, scopeRef])

  return (
    <div className="relative w-full h-full flex items-center justify-center p-8 md:p-12">
      <div className="relative w-full max-w-[min(100%,calc(100vh-8rem))] aspect-square">
        <div className="absolute inset-0 rounded-2xl bg-white shadow-2xl shadow-black/20">
          <canvas
            ref={canvasRef}
            width={600}
            height={600}
            className="size-full rounded-2xl"
            style={canvasStyle}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
          {!ui.editMode && <DrawingOverlay />}
        </div>
        <AnimationControls playing={playing} canAnimate={canAnimate} onToggle={togglePlaying} />
        {ui.editMode && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 rounded-xl bg-black/70 backdrop-blur-sm border border-white/10">
            <span className="px-2 text-xs text-white/60">
              {ui.selectedShapeId ? `Selected: ${ui.selectedShapeId}` : 'Click a shape'}
            </span>
            {ui.selectedShapeId && (
              <>
                <div className="w-px h-5 bg-white/10" />
                <button onClick={deleteSelectedShape} className="h-8 px-3 rounded-lg text-xs text-red-400 hover:bg-white/10">Delete</button>
              </>
            )}
            <div className="w-px h-5 bg-white/10" />
            <button onClick={clearShapeOverrides} className="h-8 px-3 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10">Reset All</button>
          </div>
        )}
      </div>
    </div>
  )
}
