import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { previewColor, renderIllustratorOnScope, scaleConstructionLines, setInkPathData } from '../../renderer/IllustratorRenderer.ts'
import { CarveTool } from '../../renderer/tools/CarveTool.ts'
import { DirectEditController, type Modifiers } from '../../renderer/directEdit/DirectEditController.ts'
import { registerEditorKeys } from '../../renderer/directEdit/keyboard.ts'
import { checkSurvival } from '../../engine/carve/survival.ts'
import { cutLayerName, cutPathData, type CutSpec } from '../../engine/carve/geometry.ts'
import { createComposeSession, type ComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument } from '../../engine/illustrator/types.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../../engine/illustrator/types.ts'
import { composeVectorMarkCached } from '../../engine/vector/export.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { InteractionLayer } from '../../renderer/InteractionLayer.ts'
import { PencilTool } from '../../renderer/tools/PencilTool.ts'
import { PenTool } from '../../renderer/tools/PenTool.ts'
import { GraffitiTool } from '../../renderer/tools/GraffitiTool.ts'
import { ShapeBuilderTool } from '../../renderer/tools/ShapeBuilderTool.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import { CanvasHud } from './CanvasHud.tsx'
import { isShuffleKey, toolForKey } from '../editor/tools.ts'
import { canvasPixelRatio, fitView, STILL, visibleUnits, type ViewMotion } from '../../renderer/viewFit.ts'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'
import type { DrawnPath } from '../../store/logoStore.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'

type Tool = PencilTool | PenTool | GraffitiTool | ShapeBuilderTool | CarveTool

const CARVE_PREVIEW_ID = '__carve_preview'

function modifiersOf(e: React.PointerEvent | PointerEvent): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, noSnap: e.metaKey || e.ctrlKey }
}

/** The drawing surface. `children` float over it, inside the card. */
export function LogoCanvas({ children }: { children?: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const interactionRef = useRef<InteractionLayer | null>(null)
  const toolRef = useRef<Tool | null>(null)
  const controllerRef = useRef<DirectEditController | null>(null)
  const carveSessionRef = useRef<{ doc: IllustratorDocument; session: ComposeSession } | null>(null)
  // Who received the current press in Vector Maker: a tool, or the editor (handles stay live under tools).
  const pressOwnerRef = useRef<'tool' | 'editor' | null>(null)
  // The canvas's layout size in CSS pixels, and the Generate animation's current motion.
  const cssSizeRef = useRef<{ width: number; height: number } | null>(null)
  const motionRef = useRef<ViewMotion>(STILL)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const effectParams = useLogoStore((s) => s.effectParams)
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const illustrator = useLogoStore((s) => s.illustrator)
  const selectShape = useLogoStore((s) => s.selectShape)
  const updateShapeOverride = useLogoStore((s) => s.updateShapeOverride)
  const addDrawnPath = useLogoStore((s) => s.addDrawnPath)
  const addIllustratorPathLayer = useLogoStore((s) => s.addIllustratorPathLayer)
  const togglePathSelection = useLogoStore((s) => s.togglePathSelection)
  const addCarveCut = useLogoStore((s) => s.addCarveCut)
  const addPenShape = useLogoStore((s) => s.addPenShape)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const setViewport = useLogoStore((s) => s.setViewport)
  const activeMark = useActiveMark()
  const inVectorMaker = activeSurface === 'illustrator'

  const dissolution = useMemo(() => {
    if (!activeMark || !effectParams.dissolution.enabled) return null
    return DissolutionProcessor.process({ mark: activeMark }, effectParams.dissolution)
  }, [activeMark, effectParams.dissolution])

  const survival = useMemo(() => {
    if (activeSurface !== 'illustrator' || !ui.carve.showWeakSpots || dissolution) return null
    return checkSurvival(activeMark, ui.carve.survivalSize)
  }, [activeSurface, activeMark, dissolution, ui.carve.showWeakSpots, ui.carve.survivalSize])

  /** Fit the design area to the canvas. Vector Maker edits in a still view, so pointers map exactly. */
  const applyView = useCallback(() => {
    const scope = scopeRef.current
    const size = cssSizeRef.current
    if (!scope || !size) return
    const still = useLogoStore.getState().activeSurface === 'illustrator'
    fitView(scope, size.width, size.height, canvasPixelRatio(), still ? STILL : motionRef.current)
  }, [scopeRef])

  // Follow the canvas's size on screen (and the screen's pixel density), and
  // tell the store how much of the design area is visible so new slabs fit.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let media: MediaQueryList | null = null
    const resize = () => {
      // Layout size: unaffected by the perspective tilt on Generate.
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      cssSizeRef.current = { width, height }
      applyView()
      setViewport(visibleUnits(width, height))
      if (scopeRef.current) scaleConstructionLines(scopeRef.current)
      controllerRef.current?.refresh()
    }
    const onPixelRatio = () => {
      watchPixelRatio()
      resize()
    }
    const watchPixelRatio = () => {
      media?.removeEventListener('change', onPixelRatio)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      media.addEventListener('change', onPixelRatio)
    }
    resize()
    watchPixelRatio()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', onPixelRatio)
    }
  }, [applyView, setViewport, scopeRef])

  // Switching tabs stops (or resumes) the animation's motion.
  useEffect(() => {
    applyView()
  }, [activeSurface, applyView])

  // Direct editing lives only on the Vector Maker surface.
  useEffect(() => {
    const scope = scopeRef.current
    const canvas = canvasRef.current
    if (!scope || !canvas || activeSurface !== 'illustrator') return
    const controller = new DirectEditController(scope, canvas, {
      getDoc: () => useLogoStore.getState().illustrator,
      getInkPathData: () => composeVectorMarkCached(useLogoStore.getState().vectorDocument)?.compoundPathData ?? '',
      isEnabled: () => {
        const state = useLogoStore.getState()
        return Boolean(state.illustrator) && !state.effectParams.dissolution.enabled
      },
      isSnapping: () => useLogoStore.getState().ui.carve.snapping,
      setSelection: (ids, anchor) => useLogoStore.getState().setSelection(ids, anchor),
      commitLayerEdits: (commit) => useLogoStore.getState().commitLayerEdits(commit),
      editAnchor: (layerId, index, op) => useLogoStore.getState().editAnchor(layerId, index, op),
    })
    controllerRef.current = controller
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [activeSurface, scopeRef])

  // Render
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return

    if (activeSurface === 'illustrator') {
      if (interactionRef.current) {
        interactionRef.current.destroy()
        interactionRef.current = null
      }
      if (!illustrator) {
        scope.activate()
        scope.project.clear()
        scope.view.update()
        return
      }
      const itemMap = renderIllustratorOnScope(scope, illustrator, {
        fillColor: params.fillColor,
        look: ui.look,
        dissolution,
        survival,
        mark: activeMark,
      })
      controllerRef.current?.sync(itemMap)
      // A render clears the canvas: the pen's drawing in progress goes back on top.
      if (toolRef.current instanceof PenTool) toolRef.current.redraw()
      return
    }

    if (!result) return
    const itemMap = renderLogoOnScope(scope, result, {
      showGrid: ui.showGrid,
      showConstruction: ui.showConstruction,
      fillColor: params.fillColor,
      dissolution,
      drawnShapes: ui.drawnShapes,
      editMode: ui.editMode,
    })

    // Render user-drawn vector paths on top
    renderDrawnPaths(scope, ui.drawnPaths, ui.selectedPathIds)

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
  }, [
    activeSurface,
    illustrator,
    activeMark,
    survival,
    result,
    ui.showGrid,
    ui.showConstruction,
    ui.drawnShapes,
    ui.drawnPaths,
    ui.editMode,
    ui.shapeOverrides,
    ui.selectedShapeId,
    ui.selectedPathIds,
    ui.viewport,
    ui.look,
    params.fillColor,
    dissolution,
    scopeRef,
    selectShape,
    updateShapeOverride,
  ])

  /** Live preview of a cut mid-drag: the document below it is composed once per drag. */
  const previewCut = useCallback((spec: CutSpec | null) => {
    const scope = scopeRef.current
    const doc = useLogoStore.getState().illustrator
    if (!scope || !doc) return
    if (!spec) {
      carveSessionRef.current = null
      setInkPathData(scope, composeVectorMarkCached(useLogoStore.getState().vectorDocument)?.compoundPathData ?? '')
      return
    }
    if (!carveSessionRef.current || carveSessionRef.current.doc !== doc) {
      carveSessionRef.current = {
        doc,
        session: createComposeSession(withPreviewCut(doc, spec), [CARVE_PREVIEW_ID]),
      }
    }
    let ink: string
    try {
      ink = carveSessionRef.current.session.compose(new Map([[CARVE_PREVIEW_ID, cutPathData(spec)]]))
    } catch {
      return // a boolean hiccup mid-drag: keep the last good frame
    }
    setInkPathData(scope, ink)
  }, [scopeRef])

  // Manage the active drawing tool's lifecycle
  useEffect(() => {
    const scope = scopeRef.current
    const canvas = canvasRef.current
    if (!scope || !canvas) return

    if (toolRef.current) {
      toolRef.current.destroy()
      toolRef.current = null
    }

    const callbacks = {
      onPathComplete: (path: Omit<DrawnPath, 'id'>) => {
        if (activeSurface === 'illustrator') {
          // Tools draw in canvas space; layers live in centred layer space.
          scope.activate()
          const item = new scope.CompoundPath(path.pathData)
          item.translate(scope.view.center.multiply(-1))
          const pathData = item.pathData
          item.remove()
          addIllustratorPathLayer({ ...path, pathData })
        } else {
          addDrawnPath(path)
        }
      },
    }

    const color = params.fillColor

    switch (ui.activeTool) {
      case 'punch':
      case 'channel':
      case 'slice':
        if (activeSurface !== 'illustrator') break
        toolRef.current = new CarveTool(scope, {
          onCut: (spec) => {
            carveSessionRef.current = null
            addCarveCut(spec)
          },
          onPreview: previewCut,
          snapPoint: (p, from, role) => controllerRef.current?.snapToolPoint(p, role, { rays: from ? [from] : [] }) ?? p,
          snapRadius: (center, radius) => controllerRef.current?.snapToolRadius(center, radius) ?? radius,
          onGestureEnd: () => controllerRef.current?.endToolSnap(),
        }, {
          kind: ui.activeTool,
          punchShape: ui.carve.punchShape,
          cutWidth: ui.carve.cutWidth,
        })
        break
      case 'pencil':
        toolRef.current = new PencilTool(scope, callbacks, { strokeColor: color, strokeWidth: 2 })
        break
      case 'pen':
        if (activeSurface !== 'illustrator') break
        toolRef.current = new PenTool(scope, {
          onShape: (pathData) => addPenShape(pathData),
          snapPoint: (p, role, rays, extra) => controllerRef.current?.snapToolPoint(p, role, { rays, extra }) ?? p,
          onGestureEnd: () => controllerRef.current?.endToolSnap(),
        }, {
          // Read at draw time, so switching the look keeps the drawing in progress.
          fillColor: () => previewColor(useLogoStore.getState().ui.look, color),
        })
        break
      case 'graffiti':
        toolRef.current = new GraffitiTool(scope, callbacks, { fillColor: color })
        break
      case 'shapebuilder':
        toolRef.current = new ShapeBuilderTool(scope, callbacks, { fillColor: color })
        break
    }

    if (activeSurface === 'illustrator') {
      canvas.style.cursor = toolRef.current ? 'crosshair' : 'default'
      controllerRef.current?.setHandlesLive(!(toolRef.current instanceof PenTool))
    }

    // Tool keys take precedence over the editor's while a tool is active.
    const unregister = registerEditorKeys((event) => {
      const tool = toolRef.current
      // A tool key mid-press, or mid-drawing with the pen, would throw the gesture away: it waits.
      // The shuffle key waits too: pressed then, it is a slip of the hand.
      const gestureKey = toolForKey(event) || isShuffleKey(event)
      if (gestureKey && (pressOwnerRef.current || (tool instanceof PenTool && tool.isDrawing))) return true
      if (!tool) return false
      if (tool instanceof PenTool) {
        const mod = event.metaKey || event.ctrlKey
        if (event.key === 'Enter') return tool.finalize() || tool.isDrawing
        if (event.key === 'Escape') {
          if (tool.isDrawing) tool.cancel()
          else setActiveTool(null)
          return true
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && !mod) return tool.removeLastPoint()
        // While drawing, undo steps back through the pen's own points (and redo waits).
        if (mod && event.key.toLowerCase() === 'z' && tool.isDrawing) {
          if (!event.shiftKey) tool.undo()
          return true
        }
        return false
      }
      if (tool instanceof ShapeBuilderTool) {
        if (event.key === 'Enter') {
          tool.finalize()
          return true
        }
        if (event.key === 'Escape') {
          if (tool.isDrawing) tool.cancel()
          else setActiveTool(null)
          return true
        }
        return false
      }
      if (event.key === 'Escape') {
        if (tool instanceof CarveTool) tool.cancel()
        setActiveTool(null)
        return true
      }
      return false
    })

    return () => {
      unregister()
      if (toolRef.current) {
        toolRef.current.destroy()
        toolRef.current = null
      }
      controllerRef.current?.setHandlesLive(true)
    }
  }, [
    activeSurface,
    ui.activeTool,
    ui.carve.punchShape,
    ui.carve.cutWidth,
    params.fillColor,
    scopeRef,
    addDrawnPath,
    addIllustratorPathLayer,
    addCarveCut,
    addPenShape,
    setActiveTool,
    previewCut,
  ])

  /* ─── Pointer routing ─── */

  const toProject = useCallback((e: React.PointerEvent<HTMLCanvasElement>): paper.Point | null => {
    const scope = scopeRef.current
    if (!scope) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) * scope.view.viewSize.width) / Math.max(rect.width, 1)
    const vy = ((e.clientY - rect.top) * scope.view.viewSize.height) / Math.max(rect.height, 1)
    return scope.view.viewToProject(new scope.Point(vx, vy))
  }, [scopeRef])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary || e.button !== 0) return
    const point = toProject(e)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)

    if (activeSurface === 'illustrator') {
      const controller = controllerRef.current
      const p = { x: point.x, y: point.y }
      const touch = e.pointerType === 'touch'
      if (toolRef.current && !controller?.handleAt(p, touch)) {
        pressOwnerRef.current = 'tool'
        controller?.toolPointer(p, modifiersOf(e))
        toolRef.current.onMouseDown(point)
        return
      }
      pressOwnerRef.current = 'editor'
      controller?.pointerDown(p, modifiersOf(e), touch)
      return
    }

    if (toolRef.current) {
      toolRef.current.onMouseDown(point)
      return
    }

    // In select mode, check if clicking on a drawn path for selection
    if (ui.activeTool === 'select' && scopeRef.current) {
      const hitResult = scopeRef.current.project.hitTest(point, {
        fill: true,
        stroke: true,
        tolerance: 8,
      })
      if (hitResult?.item) {
        let item: paper.Item | null = hitResult.item
        while (item && !(item.data as Record<string, unknown>)?.drawnPathId) {
          item = item.parent
        }
        if (item && (item.data as Record<string, unknown>)?.drawnPathId) {
          togglePathSelection((item.data as Record<string, unknown>).drawnPathId as string)
          return
        }
      }
      useLogoStore.getState().clearPathSelection()
      return
    }

    if (ui.editMode && interactionRef.current) {
      interactionRef.current.onMouseDown(point)
    }
  }, [activeSurface, toProject, ui.activeTool, ui.editMode, scopeRef, togglePathSelection])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return
    const point = toProject(e)
    if (!point) return

    if (activeSurface === 'illustrator') {
      const controller = controllerRef.current
      const p = { x: point.x, y: point.y }
      const touch = e.pointerType === 'touch'
      const tool = toolRef.current
      if (tool && pressOwnerRef.current !== 'editor') {
        if (e.buttons === 0 && controller) {
          const penCursor = tool instanceof PenTool ? tool.cursorAt(point) : null
          e.currentTarget.style.cursor = penCursor ?? controller.toolHover(p, touch) ?? 'crosshair'
        }
        controller?.toolPointer(p, modifiersOf(e))
        if (tool instanceof ShapeBuilderTool && e.buttons === 0) tool.onMouseMove(point)
        else tool.onMouseDrag(point)
        return
      }
      controller?.pointerMove(p, modifiersOf(e), touch)
      return
    }

    const tool = toolRef.current
    if (tool) {
      if (tool instanceof ShapeBuilderTool && e.buttons === 0) tool.onMouseMove(point)
      else tool.onMouseDrag(point)
      return
    }

    if (ui.editMode && interactionRef.current) {
      interactionRef.current.onMouseDrag(point)
    }
  }, [activeSurface, toProject, ui.editMode])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return
    const point = toProject(e)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!point) return

    if (activeSurface === 'illustrator') {
      const owner = pressOwnerRef.current
      pressOwnerRef.current = null
      if (owner === 'tool' && toolRef.current) {
        toolRef.current.onMouseUp(point)
        return
      }
      controllerRef.current?.pointerUp()
      return
    }

    if (toolRef.current) {
      toolRef.current.onMouseUp(point)
      return
    }

    if (ui.editMode && interactionRef.current) {
      interactionRef.current.onMouseUp(point)
    }
  }, [activeSurface, toProject, ui.editMode])

  /** The gesture was interrupted (pointer cancelled or capture lost): undo the preview. */
  const handlePointerCancel = useCallback(() => {
    if (activeSurface !== 'illustrator') return
    pressOwnerRef.current = null
    if (toolRef.current instanceof CarveTool) toolRef.current.cancel()
    controllerRef.current?.cancel()
  }, [activeSurface])

  /** Hover outlines, snap guides and labels go when the pointer leaves (a captured drag keeps them). */
  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeSurface !== 'illustrator' || e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (toolRef.current instanceof PenTool) toolRef.current.pointerLeave()
    controllerRef.current?.pointerLeave()
  }, [activeSurface])

  // A window blur mid-drag would otherwise leave a gesture hanging.
  useEffect(() => {
    if (!inVectorMaker) return
    const onBlur = () => controllerRef.current?.cancel()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [inVectorMaker])

  const handleDoubleClick = useCallback(() => {
    // Finalize pen/shapebuilder tool on double-click
    if (toolRef.current && (toolRef.current instanceof PenTool || toolRef.current instanceof ShapeBuilderTool)) {
      toolRef.current.finalize()
    }
  }, [])

  const onFrame = useCallback((keyframe: AnimationKeyframe) => {
    motionRef.current =
      keyframe.rotation === 0 && keyframe.scale === 1
        ? STILL
        : { rotation: (keyframe.rotation * 180) / Math.PI, scale: keyframe.scale }
    applyView()
  }, [applyView])

  const { playing, togglePlaying, canAnimate } = useAnimation(onFrame)

  const hasPerspective = !inVectorMaker && (ui.perspectiveX !== 0 || ui.perspectiveY !== 0)
  const isDrawingTool = ui.activeTool === 'pencil' || ui.activeTool === 'pen' || ui.activeTool === 'graffiti' || ui.activeTool === 'shapebuilder'

  // In Vector Maker the editor sets the cursor itself, per hover zone.
  const canvasStyle: React.CSSProperties = inVectorMaker
    ? { imageRendering: 'auto', touchAction: 'none' }
    : hasPerspective
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
    <div className="relative size-full">
      <div className="absolute inset-0 rounded-2xl bg-white shadow-2xl shadow-black/20">
        <canvas
          ref={canvasRef}
          width={600}
          height={600}
          className="size-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)]"
          style={canvasStyle}
          tabIndex={inVectorMaker ? 0 : undefined}
          aria-label={inVectorMaker ? 'Vector Maker canvas. Drag a shape to move it, its handles to resize it, or an edge to bend it. Arrow keys nudge the selection; Delete removes it.' : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
        />
        {inVectorMaker && <CanvasHud />}
        {children}
      </div>
      {!inVectorMaker && <AnimationControls playing={playing} canAnimate={canAnimate} onToggle={togglePlaying} />}
    </div>
  )
}

/** The document as it would be with `spec` applied — for previewing a cut mid-drag. */
function withPreviewCut(doc: IllustratorDocument, spec: CutSpec): IllustratorDocument {
  return {
    ...doc,
    layers: [
      ...doc.layers,
      {
        id: CARVE_PREVIEW_ID,
        name: cutLayerName(spec),
        operation: 'subtract',
        visible: true,
        locked: false,
        pathData: cutPathData(spec),
        fillRule: 'evenodd',
        transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
      },
    ],
  }
}

/** Render stored drawn paths as Paper.js items */
function renderDrawnPaths(scope: paper.PaperScope, paths: DrawnPath[], selectedIds: string[]) {
  for (const dp of paths) {
    try {
      let item: paper.PathItem
      if (dp.closed || dp.fillColor) {
        item = new scope.CompoundPath(dp.pathData)
        if (dp.fillColor) item.fillColor = new scope.Color(dp.fillColor)
        if (dp.strokeColor) item.strokeColor = new scope.Color(dp.strokeColor)
        if (dp.strokeWidth) item.strokeWidth = dp.strokeWidth
      } else {
        const p = new scope.Path(dp.pathData)
        if (dp.strokeColor) p.strokeColor = new scope.Color(dp.strokeColor)
        p.strokeWidth = dp.strokeWidth || 2
        p.strokeCap = 'round'
        p.strokeJoin = 'round'
        p.fillColor = null
        item = p
      }
      item.data = { drawnPathId: dp.id }

      // Show selection outline
      if (selectedIds.includes(dp.id)) {
        const bounds = item.bounds
        const outline = new scope.Path.Rectangle({
          rectangle: bounds.expand(4),
          strokeColor: new scope.Color('#4A90D9'),
          strokeWidth: 1.5,
          dashArray: [4, 3],
          fillColor: null,
        })
        outline.data = { selectionOutline: true }
      }
    } catch {
      // Skip invalid path data
    }
  }
}
