import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { InteractionLayer } from '../../renderer/InteractionLayer.ts'
import { PencilTool } from '../../renderer/tools/PencilTool.ts'
import { PenTool } from '../../renderer/tools/PenTool.ts'
import { GraffitiTool } from '../../renderer/tools/GraffitiTool.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import { DrawingOverlay } from './DrawingOverlay.tsx'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'
import type { DrawnPath } from '../../store/logoStore.ts'

export function LogoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const interactionRef = useRef<InteractionLayer | null>(null)
  const toolRef = useRef<PencilTool | PenTool | GraffitiTool | null>(null)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const effectParams = useLogoStore((s) => s.effectParams)
  const selectShape = useLogoStore((s) => s.selectShape)
  const updateShapeOverride = useLogoStore((s) => s.updateShapeOverride)
  const deleteSelectedShape = useLogoStore((s) => s.deleteSelectedShape)
  const clearShapeOverrides = useLogoStore((s) => s.clearShapeOverrides)
  const addDrawnPath = useLogoStore((s) => s.addDrawnPath)

  const dissolution = useMemo(() => {
    if (!result || !effectParams.dissolution.enabled) return null
    return DissolutionProcessor.process(result, effectParams.dissolution)
  }, [result, effectParams.dissolution])

  // Render logo + drawn paths + interaction layer
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

    // Render user-drawn vector paths on top
    renderDrawnPaths(scope, ui.drawnPaths)

    // Set up interaction layer for edit/select mode
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
  }, [result, ui.showGrid, ui.showConstruction, ui.drawnShapes, ui.drawnPaths, ui.editMode, ui.shapeOverrides, ui.selectedShapeId, params.fillColor, dissolution, scopeRef, selectShape, updateShapeOverride])

  // Manage active drawing tool lifecycle
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return

    // Destroy previous tool
    if (toolRef.current) {
      toolRef.current.destroy()
      toolRef.current = null
    }

    const callbacks = {
      onPathComplete: (path: Omit<DrawnPath, 'id'>) => {
        addDrawnPath(path)
      },
    }

    const color = params.fillColor

    switch (ui.activeTool) {
      case 'pencil':
        toolRef.current = new PencilTool(scope, callbacks, { strokeColor: color, strokeWidth: 2 })
        break
      case 'pen':
        toolRef.current = new PenTool(scope, callbacks, { strokeColor: color, strokeWidth: 2 })
        break
      case 'graffiti':
        toolRef.current = new GraffitiTool(scope, callbacks, { fillColor: color })
        break
    }

    return () => {
      if (toolRef.current) {
        toolRef.current.destroy()
        toolRef.current = null
      }
    }
  }, [ui.activeTool, params.fillColor, scopeRef, addDrawnPath])

  // Mouse events — route to active tool or interaction layer
  const getPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!scopeRef.current) return null
    const rect = e.currentTarget.getBoundingClientRect()
    return new scopeRef.current.Point(e.clientX - rect.left, e.clientY - rect.top)
  }, [scopeRef])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getPoint(e)
    if (!point) return

    if (toolRef.current) {
      toolRef.current.onMouseDown(point)
      return
    }
    if (ui.editMode && interactionRef.current) {
      interactionRef.current.onMouseDown(point)
    }
  }, [getPoint, ui.editMode])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getPoint(e)
    if (!point) return

    if (toolRef.current) {
      toolRef.current.onMouseDrag(point)
      return
    }
    if (ui.editMode && interactionRef.current) {
      interactionRef.current.onMouseDrag(point)
    }
  }, [getPoint, ui.editMode])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getPoint(e)
    if (!point) return

    if (toolRef.current) {
      toolRef.current.onMouseUp(point)
      return
    }
    if (ui.editMode && interactionRef.current) {
      interactionRef.current.onMouseUp(point)
    }
  }, [getPoint, ui.editMode])

  const handleDoubleClick = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Finalize pen tool on double-click
    if (toolRef.current && toolRef.current instanceof PenTool) {
      toolRef.current.finalize()
    }
  }, [])

  // Keyboard: Enter to finalize pen, Escape to cancel
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!toolRef.current) return
      if (toolRef.current instanceof PenTool) {
        if (e.key === 'Enter') {
          e.preventDefault()
          toolRef.current.finalize()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          toolRef.current.cancel()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

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
  const isDrawingTool = ui.activeTool === 'pencil' || ui.activeTool === 'pen' || ui.activeTool === 'graffiti'

  const canvasStyle: React.CSSProperties = hasPerspective
    ? {
        imageRendering: 'auto',
        transform: `perspective(800px) rotateX(${ui.perspectiveX}deg) rotateY(${ui.perspectiveY}deg)`,
        transition: 'transform 150ms',
        cursor: isDrawingTool ? 'crosshair' : ui.editMode ? 'default' : undefined,
      }
    : {
        imageRendering: 'auto',
        cursor: isDrawingTool ? 'crosshair' : ui.editMode ? 'default' : undefined,
      }

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
            onDoubleClick={handleDoubleClick}
          />
          <DrawingOverlay />
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

/** Render stored drawn paths as Paper.js items */
function renderDrawnPaths(scope: paper.PaperScope, paths: DrawnPath[]) {
  for (const dp of paths) {
    try {
      if (dp.closed || dp.fillColor) {
        const path = new scope.CompoundPath(dp.pathData)
        if (dp.fillColor) path.fillColor = new scope.Color(dp.fillColor)
        if (dp.strokeColor) path.strokeColor = new scope.Color(dp.strokeColor)
        if (dp.strokeWidth) path.strokeWidth = dp.strokeWidth
      } else {
        const path = new scope.Path(dp.pathData)
        if (dp.strokeColor) path.strokeColor = new scope.Color(dp.strokeColor)
        path.strokeWidth = dp.strokeWidth || 2
        path.strokeCap = 'round'
        path.strokeJoin = 'round'
        path.fillColor = null
      }
    } catch {
      // Skip invalid path data
    }
  }
}
