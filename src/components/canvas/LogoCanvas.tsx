import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
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
import { PenTool } from '../../renderer/tools/PenTool.ts'
import { CanvasHud } from './CanvasHud.tsx'
import { isShuffleKey, toolForKey } from '../editor/tools.ts'
import { canvasPixelRatio, fitView, visibleUnits } from '../../renderer/viewFit.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'

type Tool = PenTool | CarveTool

const CARVE_PREVIEW_ID = '__carve_preview'

function modifiersOf(e: React.PointerEvent | PointerEvent): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, noSnap: e.metaKey || e.ctrlKey }
}

/** The drawing surface. `children` float over it, inside the card. */
export function LogoCanvas({ children }: { children?: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const toolRef = useRef<Tool | null>(null)
  const controllerRef = useRef<DirectEditController | null>(null)
  const carveSessionRef = useRef<{ doc: IllustratorDocument; session: ComposeSession } | null>(null)
  // Who received the current press: a tool, or the editor (handles stay live under tools).
  const pressOwnerRef = useRef<'tool' | 'editor' | null>(null)
  // The canvas's layout size in CSS pixels.
  const cssSizeRef = useRef<{ width: number; height: number } | null>(null)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const illustrator = useLogoStore((s) => s.illustrator)
  const addCarveCut = useLogoStore((s) => s.addCarveCut)
  const addPenShape = useLogoStore((s) => s.addPenShape)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const setViewport = useLogoStore((s) => s.setViewport)
  const activeMark = useActiveMark()

  const survival = useMemo(() => {
    if (!ui.carve.showWeakSpots) return null
    return checkSurvival(activeMark, ui.carve.survivalSize)
  }, [activeMark, ui.carve.showWeakSpots, ui.carve.survivalSize])

  /** Fit the design area to the canvas. */
  const applyView = useCallback(() => {
    const scope = scopeRef.current
    const size = cssSizeRef.current
    if (!scope || !size) return
    fitView(scope, size.width, size.height, canvasPixelRatio())
  }, [scopeRef])

  // Follow the canvas's size on screen (and the screen's pixel density), and
  // tell the store how much of the design area is visible so new slabs fit.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let media: MediaQueryList | null = null
    const resize = () => {
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

  useEffect(() => {
    const scope = scopeRef.current
    const canvas = canvasRef.current
    if (!scope || !canvas) return
    const controller = new DirectEditController(scope, canvas, {
      getDoc: () => useLogoStore.getState().illustrator,
      getInkPathData: () => composeVectorMarkCached(useLogoStore.getState().vectorDocument).compoundPathData,
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
  }, [scopeRef])

  // Render. The renderer reads only the layers, so a selection change, which
  // keeps the same layers array, does not rebuild the scope.
  const layers = illustrator.layers
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return
    const itemMap = renderIllustratorOnScope(scope, { ...useLogoStore.getState().illustrator, layers }, {
      fillColor: params.fillColor,
      look: ui.look,
      survival,
      mark: activeMark,
    })
    controllerRef.current?.sync(itemMap)
    // A render clears the canvas: the pen's drawing in progress goes back on top.
    if (toolRef.current instanceof PenTool) toolRef.current.redraw()
  }, [layers, activeMark, survival, ui.viewport, ui.look, params.fillColor, scopeRef])

  // The editor draws the selection over the canvas: a new selection redraws only that.
  const { selectedLayerIds, pointSelection } = illustrator
  useEffect(() => {
    controllerRef.current?.refresh()
  }, [selectedLayerIds, pointSelection])

  /** Live preview of a cut mid-drag: the document below it is composed once per drag. */
  const previewCut = useCallback((spec: CutSpec | null) => {
    const scope = scopeRef.current
    const doc = useLogoStore.getState().illustrator
    if (!scope) return
    if (!spec) {
      carveSessionRef.current = null
      setInkPathData(scope, composeVectorMarkCached(useLogoStore.getState().vectorDocument).compoundPathData)
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

    const color = params.fillColor

    switch (ui.activeTool) {
      case 'punch':
      case 'channel':
      case 'slice':
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
      case 'pen':
        toolRef.current = new PenTool(scope, {
          onShape: (pathData) => addPenShape(pathData),
          snapPoint: (p, role, rays, extra) => controllerRef.current?.snapToolPoint(p, role, { rays, extra }) ?? p,
          onGestureEnd: () => controllerRef.current?.endToolSnap(),
        }, {
          // Read at draw time, so switching the look keeps the drawing in progress.
          fillColor: () => previewColor(useLogoStore.getState().ui.look, color),
        })
        break
    }

    canvas.style.cursor = toolRef.current ? 'crosshair' : 'default'
    // The pen hides every handle; a carve tool keeps only a recipe's own, to adjust the cut just made.
    controllerRef.current?.setHandlesLive(toolRef.current instanceof PenTool ? 'none' : toolRef.current ? 'recipe' : 'all')

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
      if (event.key === 'Escape') {
        tool.cancel()
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
      controllerRef.current?.setHandlesLive('all')
    }
  }, [
    ui.activeTool,
    ui.carve.punchShape,
    ui.carve.cutWidth,
    params.fillColor,
    scopeRef,
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

    const controller = controllerRef.current
    const p = { x: point.x, y: point.y }
    const touch = e.pointerType === 'touch'
    if (toolRef.current && !controller?.handleAt(p, touch)) {
      pressOwnerRef.current = 'tool'
      controller?.toolPointer(p, modifiersOf(e), touch)
      toolRef.current.onMouseDown(point)
      return
    }
    pressOwnerRef.current = 'editor'
    controller?.pointerDown(p, modifiersOf(e), touch)
  }, [toProject])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return
    const point = toProject(e)
    if (!point) return

    const controller = controllerRef.current
    const p = { x: point.x, y: point.y }
    const touch = e.pointerType === 'touch'
    const tool = toolRef.current
    if (tool && pressOwnerRef.current !== 'editor') {
      if (e.buttons === 0 && controller) {
        const penCursor = tool instanceof PenTool ? tool.cursorAt(point) : null
        e.currentTarget.style.cursor = penCursor ?? controller.toolHover(p, touch) ?? 'crosshair'
      }
      controller?.toolPointer(p, modifiersOf(e), touch)
      tool.onMouseDrag(point)
      return
    }
    controller?.pointerMove(p, modifiersOf(e), touch)
  }, [toProject])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return
    const point = toProject(e)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!point) return

    const owner = pressOwnerRef.current
    pressOwnerRef.current = null
    if (owner === 'tool' && toolRef.current) {
      toolRef.current.onMouseUp(point)
      return
    }
    controllerRef.current?.pointerUp()
  }, [toProject])

  /** The gesture was interrupted (pointer cancelled or capture lost): undo the preview. */
  const handlePointerCancel = useCallback(() => {
    pressOwnerRef.current = null
    if (toolRef.current instanceof CarveTool) toolRef.current.cancel()
    controllerRef.current?.cancel()
  }, [])

  /** Hover outlines, snap guides and labels go when the pointer leaves (a captured drag keeps them). */
  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (toolRef.current instanceof PenTool) toolRef.current.pointerLeave()
    controllerRef.current?.pointerLeave()
  }, [])

  // A window blur mid-drag would otherwise leave a gesture hanging.
  useEffect(() => {
    const onBlur = () => controllerRef.current?.cancel()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  const handleDoubleClick = useCallback(() => {
    if (toolRef.current instanceof PenTool) toolRef.current.finalize()
  }, [])

  return (
    <div className="relative size-full">
      <div className="absolute inset-0 rounded-2xl bg-white shadow-2xl shadow-black/20">
        <canvas
          ref={canvasRef}
          width={600}
          height={600}
          className="size-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)]"
          // The editor sets the cursor itself, per hover zone.
          style={{ imageRendering: 'auto', touchAction: 'none' }}
          tabIndex={0}
          aria-label="Vector Maker canvas. Drag a shape to move it, its handles to resize or rotate it, or an edge to bend it. Arrow keys nudge the selection; Alt with Left or Right rotates it by 1 degree, Alt with Up or Down scales it so its longer side grows or shrinks by 1 unit, and Shift makes each step larger. Delete removes it."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
        />
        <CanvasHud />
        {children}
      </div>
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
