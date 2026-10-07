import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { previewColor, renderGuides, renderIllustratorOnScope, scaleConstructionLines, showFrame, showMark } from '../../renderer/IllustratorRenderer.ts'
import { CarveTool } from '../../renderer/tools/CarveTool.ts'
import { DirectEditController, type Modifiers } from '../../renderer/directEdit/DirectEditController.ts'
import { registerEditorKeys } from '../../renderer/directEdit/keyboard.ts'
import { checkSurvival } from '../../engine/carve/survival.ts'
import { cutLayerName, cutPathData, type CutSpec } from '../../engine/carve/geometry.ts'
import { createComposeSession, type ComposeSession } from '../../engine/illustrator/composeSession.ts'
import type { IllustratorDocument } from '../../engine/illustrator/types.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../../engine/illustrator/types.ts'
import { composeBaseMark, composeVectorMarkCached } from '../../engine/vector/export.ts'
import { applyFillets, cornerSources, freeCorners, type ResolvedFillet } from '../../engine/fillet/apply.ts'
import type { AttributedCorner } from '../../engine/fillet/corners.ts'
import { RoundTool } from '../../renderer/tools/RoundTool.ts'
import { tangentCircles, useLogoStore } from '../../store/logoStore.ts'
import { PenTool } from '../../renderer/tools/PenTool.ts'
import { GuideTool, type Ghost, type GhostSet } from '../../renderer/tools/GuideTool.ts'
import { BandTool, type BandCircle } from '../../renderer/tools/BandTool.ts'
import { bandBetween, bandsEmptiedBy } from '../../engine/vector/bands.ts'
import { asCircle, type Circle } from '../../engine/geometry/asCircle.ts'
import { bandOuterPathData, carveOutline } from '../../engine/carve/outline.ts'
import type { PathObject } from '../../engine/vector/types.ts'
import { coincide, constructionLines, lineShape } from '../../engine/vector/guides.ts'
import { commonTangents } from '../../engine/geometry/tangent.ts'
import { pinsLostWithTarget } from '../../engine/vector/pins.ts'
import { linksEndedBy, offsetGeometry, offsetIsQuick } from '../../engine/vector/offsets.ts'
import { contoursToPathData } from '../../engine/vector/pathSerialization.ts'
import { offsetPreview, type OffsetPreview } from '../../renderer/directEdit/offsetPreview.ts'
import { refusals } from '../../renderer/directEdit/refusal.ts'
import { bandPreview } from '../../renderer/directEdit/bandPreview.ts'
import { filletPreview, filletRowHover } from '../../renderer/directEdit/filletPreview.ts'
import type { Contour } from '../../engine/vector/types.ts'
import type { EditablePath } from '../../engine/path/editPath.ts'
import { CanvasHud } from './CanvasHud.tsx'
import { isShuffleKey, sidesKeyStep, toolForKey } from '../editor/tools.ts'
import { canvasPixelRatio, fitView, visibleUnits } from '../../renderer/viewFit.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'

type Tool = PenTool | CarveTool | GuideTool | BandTool | RoundTool

const CARVE_PREVIEW_ID = '__carve_preview'
const OFFSET_PREVIEW_ID = '__offset_preview'
/** How long an offset slider must rest before the general method draws the offset it sets. */
const OFFSET_SETTLE_MS = 150

function modifiersOf(e: React.PointerEvent | PointerEvent): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, noSnap: e.metaKey || e.ctrlKey }
}

/** Guides show on the canvas in the construction look, while they are shown. */
function guidesShown(): boolean {
  const { ui } = useLogoStore.getState()
  return ui.look === 'construction' && ui.showGuides
}

/** The guides to draw now, or null while none draw. */
function guidesToDraw() {
  return guidesShown() ? useLogoStore.getState().vectorDocument.guides : null
}

/** A pen path as a contour of the document, to a thousandth of a unit as path data keeps a shape's points. */
function contourOf(path: EditablePath): Contour {
  const round = (v: { x: number; y: number }) => ({ x: Math.round(v.x * 1000) / 1000 || 0, y: Math.round(v.y * 1000) / 1000 || 0 })
  return {
    closed: path.closed,
    segments: path.segs.map((seg) => ({ point: round(seg.p), handleIn: seg.hIn && round(seg.hIn), handleOut: seg.hOut && round(seg.hOut) })),
  }
}

// Objects are immutable once in a document: each is read as a circle once.
const circleCache = new WeakMap<PathObject, Circle | null>()

/**
 * What the Band tool can join: every visible object read as a circle, the
 * topmost first, and the circle guides on the canvas after them.
 */
function bandCircles(): BandCircle[] {
  const { vectorDocument, illustrator } = useLogoStore.getState()
  const shown = new Set(illustrator.layers.filter((layer) => layer.visible).map((layer) => layer.id))
  const out: BandCircle[] = []
  for (const object of [...vectorDocument.objects].reverse()) {
    if (object.type !== 'path' || !shown.has(object.id)) continue
    let circle = circleCache.get(object)
    if (circle === undefined) circleCache.set(object, (circle = asCircle(object)))
    if (circle) out.push({ id: object.id, circle, guide: false })
  }
  for (const guide of guidesToDraw() ?? []) {
    if (guide.visible && guide.shape.kind === 'circle' && guide.shape.r > 0) out.push({ id: guide.id, circle: { c: guide.shape.c, r: guide.shape.r }, guide: true })
  }
  return out
}

/** The band the Band tool would make between two circles, its outline and the edges the sheet strokes, or null when they allow it no fit. */
function toolBandOutline(a: Circle, b: Circle): { outline: string; edges: string | null } | null {
  const settings = useLogoStore.getState().ui.band
  const spec = bandBetween({ v: 1, kind: 'band', a, b, fit: settings.fit, width: settings.width, angle: settings.angle, side: 1, radius: settings.radius }, a, b)
  const outline = carveOutline(spec)
  return outline.segs.length ? { outline: outline.pathData, edges: bandOuterPathData(spec) } : null
}

/** The corners the Round tool offers, kept for the base mark and fillets they were read from. */
let roundCornersCache: { base: object; fillets: object; corners: readonly AttributedCorner[] } | null = null

/** The corners of the mark with no fillet on them: what the Round tool rounds. */
function roundCorners(): readonly AttributedCorner[] {
  const { objects, fillets } = useLogoStore.getState().vectorDocument
  const base = composeBaseMark(objects)
  if (roundCornersCache?.base === base && roundCornersCache.fillets === fillets) return roundCornersCache.corners
  const corners = freeCorners(base, fillets, cornerSources(objects))
  roundCornersCache = { base, fillets, corners }
  return corners
}

/** The last few Round tool previews, by the mark, the fillets, the corner and the radius. */
const roundPreviews: Array<{ base: object; fillets: object; corner: AttributedCorner; radius: number; made: { fillet: ResolvedFillet | null } | null }> = []

/** The fillet a corner would take at `radius`, as the mark would round it with the fillets it has: a neighbour may cut it down. */
function roundPreview(corner: AttributedCorner, radius: number): { fillet: ResolvedFillet | null } | null {
  const { objects, fillets } = useLogoStore.getState().vectorDocument
  const base = composeBaseMark(objects)
  const known = roundPreviews.find((entry) => entry.base === base && entry.fillets === fillets && entry.corner === corner && entry.radius === radius)
  if (known) return known.made
  const id = '__round_preview'
  let made: { fillet: ResolvedFillet | null } | null = null
  try {
    const mark = applyFillets(base, [...fillets, { id, visible: true, radius, at: corner.p, between: corner.between }], cornerSources(objects))
    made = { fillet: mark.fillets?.find((fillet) => fillet.id === id) ?? null }
  } catch {
    made = null
  }
  roundPreviews.unshift({ base, fillets, corner, radius, made })
  roundPreviews.length = Math.min(roundPreviews.length, 8)
  return made
}

/**
 * Under the Round tool, does the corner to round under the pointer take a
 * press (or the hover) over the editor's zone there? A free corner within
 * reach always does, over a fillet's circle and over the selected fillet's
 * radius dot, so corners can be rounded one after another; a press on the
 * dot with no free corner within reach drags the dot.
 */
function roundCornerFirst(tool: RoundTool, point: paper.Point, target: ReturnType<DirectEditController['toolPressTarget']>, touch: boolean): boolean {
  if (target?.kind !== 'editor' || (target.zone !== 'fillet' && target.zone !== 'fillet-dot')) return false
  return tool.cornerDistance(point, touch) !== null
}

/** The construction lines of the shape under `p` (layer space) that are not yet guides following it, and its bounds. */
function ghostsAt(controller: DirectEditController | null, scope: paper.PaperScope | null, p: { x: number; y: number }, touch: boolean): GhostSet | null {
  if (!controller || !scope) return null
  const center = scope.view.center
  const id = controller.shapeAt({ x: p.x + center.x, y: p.y + center.y }, touch)
  return id ? ghostsOf(controller, id) : null
}

/**
 * How far the bars floating over the canvas (those marked data-canvas-cover)
 * reach in from its top and its bottom, in CSS pixels: a bar in the upper
 * half covers from the top, one in the lower half from the bottom.
 */
function coveredInsets(canvas: HTMLCanvasElement): { top: number; bottom: number } {
  const box = canvas.getBoundingClientRect()
  const middle = box.top + box.height / 2
  let top = 0
  let bottom = 0
  for (const cover of canvas.parentElement?.querySelectorAll('[data-canvas-cover]') ?? []) {
    const rect = cover.getBoundingClientRect()
    if (rect.height === 0 || rect.right < box.left || rect.left > box.right) continue
    if ((rect.top + rect.bottom) / 2 < middle) top = Math.max(top, rect.bottom - box.top)
    else bottom = Math.max(bottom, box.bottom - rect.top)
  }
  return { top, bottom }
}

/**
 * The construction lines of one shape that are not guides yet, read from
 * the document as it is now. When it is one of two circles selected, the
 * lines the two share are offered too, as plain guides.
 */
function ghostsOf(controller: DirectEditController | null, id: string): GhostSet | null {
  const state = useLogoStore.getState()
  const { vectorDocument } = state
  const object = vectorDocument.objects.find((candidate) => candidate.id === id)
  const bounds = controller?.shapeBounds(id)
  if (!object || object.type !== 'path' || !bounds) return null
  const taken = new Set(vectorDocument.guides.flatMap((guide) => (guide.link?.of === object.id ? [guide.link.role] : [])))
  const ghosts: Ghost[] = constructionLines(object)
    .filter((line) => !taken.has(line.role))
    .map((line) => ({ of: object.id, role: line.role, key: line.role, shape: line.shape, name: line.name }))
  const pair = tangentCircles(state)
  if (pair?.length === 2 && pair.some((entry) => entry.id === id)) {
    commonTangents(pair[0].circle, pair[1].circle).forEach((line, i) => {
      const shape = lineShape(line.p, line.angle)
      // A line already there, as a guide or as one of the shape's own ghosts, is not offered twice: the linked one stays.
      if (vectorDocument.guides.some((guide) => coincide(guide.shape, shape)) || ghosts.some((ghost) => coincide(ghost.shape, shape))) return
      const name = line.kind === 'external' ? 'Outer tangent' : 'Inner tangent'
      ghosts.push({ of: object.id, role: null, key: `tangent-${i}`, shape, name, span: line.touches })
    })
  }
  return { of: object.id, bounds, ghosts }
}

/** The drawing surface. `children` float over it, inside the card. */
export function LogoCanvas({ children }: { children?: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const toolRef = useRef<Tool | null>(null)
  const controllerRef = useRef<DirectEditController | null>(null)
  const carveSessionRef = useRef<{ doc: IllustratorDocument; session: ComposeSession } | null>(null)
  // The composition an offset preview draws over, made once per document and preview target.
  const offsetSessionRef = useRef<{ doc: IllustratorDocument; key: string; session: ComposeSession } | null>(null)
  /** The composition a band setting being slid is shown with: the band in its place, made again on every step. */
  const bandSessionRef = useRef<{ doc: IllustratorDocument; id: string; session: ComposeSession } | null>(null)
  // A general offset preview waiting for its slider to rest.
  const offsetSettleRef = useRef(0)
  // Who received the current press: a tool, or the editor (handles stay live under tools).
  const pressOwnerRef = useRef<'tool' | 'editor' | null>(null)
  // The canvas's layout size in CSS pixels.
  const cssSizeRef = useRef<{ width: number; height: number } | null>(null)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const illustrator = useLogoStore((s) => s.illustrator)
  const addCarveCut = useLogoStore((s) => s.addCarveCut)
  const addPenShape = useLogoStore((s) => s.addPenShape)
  const addPenGuide = useLogoStore((s) => s.addPenGuide)
  const addGuides = useLogoStore((s) => s.addGuides)
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
      if (scopeRef.current) {
        // Lines are clipped to the view: a new size draws them afresh.
        renderGuides(scopeRef.current, guidesToDraw(), useLogoStore.getState().illustrator.layers)
        scaleConstructionLines(scopeRef.current)
      }
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
      getMark: () => composeVectorMarkCached(useLogoStore.getState().vectorDocument),
      getBaseMark: () => composeBaseMark(useLogoStore.getState().vectorDocument.objects),
      filletsShown: () => useLogoStore.getState().ui.look === 'construction',
      selectFillets: (ids, additive) => useLogoStore.getState().selectFillets(ids, additive),
      setFilletRadius: (id, radius) => useLogoStore.getState().setFilletRadius(id, radius),
      isSnapping: () => useLogoStore.getState().ui.carve.snapping,
      setSelection: (ids, anchor) => useLogoStore.getState().setSelection(ids, anchor),
      commitLayerEdits: (commit) => useLogoStore.getState().commitLayerEdits(commit),
      editAnchor: (layerId, index, op, contourIndex) => useLogoStore.getState().editAnchor(layerId, index, op, contourIndex),
      guidesShown,
      selectGuides: (ids, additive) => useLogoStore.getState().selectGuides(ids, additive),
      commitGuides: (label, guides, select) => useLogoStore.getState().commitGuides(label, guides, select),
      nudgeGuides: (d) => useLogoStore.getState().nudgeGuides(d),
      coveredInsets: () => coveredInsets(canvas),
    })
    controllerRef.current = controller
    // A pin let go of because its target went, by an edit made off the canvas, is said too, and so is a copy that stops following
    // by an edit the canvas does not read out itself, and a band an edit leaves no fit. Undo and redo bring back what was.
    const unwatch = useLogoStore.subscribe((state, before) => {
      if (state.vectorDocument.objects === before.vectorDocument.objects) return
      const step = state.vectorUndoStack.at(-1)
      if (!step || before.vectorUndoStack.includes(step) || before.vectorRedoStack.includes(step)) return
      const unpinned = pinsLostWithTarget(before.vectorDocument.objects, state.vectorDocument.objects)
      const { gone, edited } = linksEndedBy(before.vectorDocument.objects, state.vectorDocument.objects, state.vectorDocument.guides)
      const emptied = bandsEmptiedBy(before.vectorDocument.objects, state.vectorDocument.objects)
      if (unpinned.length || gone.length || edited.length || emptied.length) controller.noteLetGo({ unpinned, gone, edited, emptied })
    })
    // A refused command, such as Cmd+G, is said by the selection, with what is in the way outlined.
    const unrefuse = refusals.subscribe((refused) => controller.showRefusal(refused))
    return () => {
      unwatch()
      unrefuse()
      controller.destroy()
      controllerRef.current = null
    }
  }, [scopeRef])

  /**
   * Draw the offset the selection bar is setting: its outline dashed over
   * the ink, and the ink composed with it in place, directly above its
   * source (or in place of the copy it stands in for), so an inset as a cut
   * shows its ring. With none, the ink goes back to the mark.
   */
  const applyOffsetPreview = useCallback((settled = false) => {
    const scope = scopeRef.current
    if (!scope) return
    const preview = offsetPreview.get()
    const state = useLogoStore.getState()
    const source = preview ? state.vectorDocument.objects.find((object) => object.id === preview.of) : undefined
    window.clearTimeout(offsetSettleRef.current)
    // The general method waits for the slider to rest: the last frame stays meanwhile.
    if (preview && source?.type === 'path' && !settled && !offsetIsQuick(source, preview.distance)) {
      offsetSettleRef.current = window.setTimeout(() => applyOffsetPreview(true), OFFSET_SETTLE_MS)
      return
    }
    if (!preview || source?.type !== 'path') {
      controllerRef.current?.showOffsetOutline(null)
      if (offsetSessionRef.current) {
        offsetSessionRef.current = null
        showMark(scope, composeVectorMarkCached(state.vectorDocument))
      }
      return
    }
    const made = offsetGeometry(source, preview.distance)
    const pathData = made ? contoursToPathData(made.contours) : ''
    const doc = state.illustrator
    const key = `${preview.of} ${preview.asCut} ${preview.replaces ?? ''}`
    if (offsetSessionRef.current?.doc !== doc || offsetSessionRef.current.key !== key) {
      const id = preview.replaces ?? OFFSET_PREVIEW_ID
      offsetSessionRef.current = { doc, key, session: createComposeSession(withPreviewOffset(doc, preview, source.operation), [id]) }
    }
    try {
      const session = offsetSessionRef.current.session
      showFrame(scope, session.compose(new Map([[preview.replaces ?? OFFSET_PREVIEW_ID, pathData || null]])), session.fillets)
    } catch {
      // A boolean hiccup: the last good frame stays.
    }
    controllerRef.current?.showOffsetOutline(pathData || null, preview.replaces ?? null)
  }, [scopeRef])

  useEffect(() => {
    const unsubscribe = offsetPreview.subscribe(() => applyOffsetPreview())
    return () => {
      unsubscribe()
      window.clearTimeout(offsetSettleRef.current)
      offsetPreview.set(null)
    }
  }, [applyOffsetPreview])

  /** Draw the band whose setting the selection bar's slider is moving, in its place in the ink. With none, the ink goes back to the mark. */
  const applyBandPreview = useCallback(() => {
    const scope = scopeRef.current
    if (!scope) return
    const preview = bandPreview.get()
    const state = useLogoStore.getState()
    const doc = state.illustrator
    if (!preview || !doc.layers.some((layer) => layer.id === preview.id)) {
      if (bandSessionRef.current) {
        bandSessionRef.current = null
        showMark(scope, composeVectorMarkCached(state.vectorDocument))
      }
      return
    }
    if (bandSessionRef.current?.doc !== doc || bandSessionRef.current.id !== preview.id) {
      bandSessionRef.current = { doc, id: preview.id, session: createComposeSession(doc, [preview.id]) }
    }
    const outline = carveOutline(preview.carve)
    try {
      const session = bandSessionRef.current.session
      showFrame(scope, session.compose(new Map([[preview.id, outline.segs.length ? outline.pathData : null]]), new Map([[preview.id, preview.carve]])), session.fillets)
    } catch {
      // A boolean hiccup: the last good frame stays.
    }
  }, [scopeRef])

  useEffect(() => {
    const unsubscribe = bandPreview.subscribe(applyBandPreview)
    return () => {
      unsubscribe()
      bandPreview.set(null)
    }
  }, [applyBandPreview])

  /** Round the base mark with the radius the selection bar's slider is on. With none, the ink goes back to the mark. */
  const filletShownRef = useRef(false)
  const applyFilletPreview = useCallback(() => {
    const scope = scopeRef.current
    if (!scope) return
    const preview = filletPreview.get()
    const { vectorDocument } = useLogoStore.getState()
    if (!preview || !vectorDocument.fillets.some((fillet) => preview.ids.includes(fillet.id))) {
      if (filletShownRef.current) {
        filletShownRef.current = false
        showMark(scope, composeVectorMarkCached(vectorDocument))
        controllerRef.current?.showFilletPreview(null)
      }
      return
    }
    const fillets = vectorDocument.fillets.map((fillet) => (preview.ids.includes(fillet.id) ? { ...fillet, radius: preview.radius } : fillet))
    try {
      const mark = applyFillets(composeBaseMark(vectorDocument.objects), fillets, cornerSources(vectorDocument.objects))
      showMark(scope, mark)
      // The selected fillets' circles and radius dot follow the thumb with the ink.
      controllerRef.current?.showFilletPreview(mark.fillets ?? null)
      filletShownRef.current = true
    } catch {
      // A boolean hiccup: the last good frame stays.
    }
  }, [scopeRef])

  useEffect(() => {
    const unsubscribe = filletPreview.subscribe(applyFilletPreview)
    return () => {
      unsubscribe()
      filletPreview.set(null)
    }
  }, [applyFilletPreview])

  // A fillet's row in the drawer under the pointer lights its circle on the canvas.
  useEffect(() => filletRowHover.subscribe(() => controllerRef.current?.showRowHover()), [])

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
      guides: guidesToDraw(),
    })
    controllerRef.current?.sync(itemMap)
    // An offset being set is drawn over the new ink again.
    if (offsetPreview.get()) applyOffsetPreview()
    if (bandPreview.get()) applyBandPreview()
    // A render clears the canvas: the drawing in progress goes back on top.
    const tool = toolRef.current
    if (tool instanceof PenTool || tool instanceof GuideTool || tool instanceof BandTool || tool instanceof RoundTool) tool.redraw()
  }, [layers, activeMark, survival, ui.viewport, ui.look, params.fillColor, scopeRef, applyOffsetPreview, applyBandPreview])

  // Guides draw on their own: a guide edit, or showing and hiding them, redraws only them.
  const guides = useLogoStore((s) => s.vectorDocument.guides)
  const selectedGuideIds = illustrator.selectedGuideIds
  const selectedFilletIds = illustrator.selectedFilletIds
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return
    renderGuides(scope, ui.showGuides && ui.look === 'construction' ? guides : null, useLogoStore.getState().illustrator.layers)
    controllerRef.current?.refresh()
    // The Guide tool's ghosts leave out the lines that are guides now; the Band tool's circles take in the guides on the canvas.
    if (toolRef.current instanceof GuideTool || toolRef.current instanceof BandTool) toolRef.current.redraw()
  }, [guides, ui.showGuides, ui.look, scopeRef])

  // The Band tool's preview follows the pill's settings as they change.
  const bandSettings = useLogoStore((s) => s.ui.band)
  useEffect(() => {
    if (toolRef.current instanceof BandTool) toolRef.current.redraw()
  }, [bandSettings])

  // The editor draws the selection over the canvas: a new selection redraws only that.
  const { selectedLayerIds, pointSelection } = illustrator
  useEffect(() => {
    controllerRef.current?.refresh()
  }, [selectedLayerIds, pointSelection, selectedGuideIds, selectedFilletIds])

  /** Live preview of a cut mid-drag: the document below it is composed once per drag. */
  const previewCut = useCallback((spec: CutSpec | null) => {
    const scope = scopeRef.current
    const doc = useLogoStore.getState().illustrator
    if (!scope) return
    if (!spec) {
      carveSessionRef.current = null
      showMark(scope, composeVectorMarkCached(useLogoStore.getState().vectorDocument))
      return
    }
    if (!carveSessionRef.current || carveSessionRef.current.doc !== doc) {
      carveSessionRef.current = {
        doc,
        session: createComposeSession(withPreviewCut(doc, spec), [CARVE_PREVIEW_ID]),
      }
    }
    let ink: string
    const session = carveSessionRef.current.session
    try {
      ink = session.compose(new Map([[CARVE_PREVIEW_ID, cutPathData(spec)]]))
    } catch {
      return // a boolean hiccup mid-drag: keep the last good frame
    }
    showFrame(scope, ink, session.fillets)
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
            // A punch started on a shape's centre is pinned there.
            addCarveCut(spec, spec.kind === 'punch' || spec.kind === 'polygon' ? (controllerRef.current?.toolStartPin() ?? null) : null)
          },
          onPreview: previewCut,
          snapPoint: (p, from, role) =>
            controllerRef.current?.snapToolPoint(p, role, { rays: from ? [from] : [], pins: ui.activeTool === 'punch' }) ?? p,
          snapRadius: (center, radius, like) => controllerRef.current?.snapToolRadius(center, radius, like) ?? radius,
          onGestureEnd: () => controllerRef.current?.endToolSnap(),
        }, {
          kind: ui.activeTool,
          punchShape: ui.carve.punchShape,
          // Read at draw time: stepping a selected polygon also sets the next count, and must not rebuild the tool under the pen.
          polygonSides: () => useLogoStore.getState().ui.carve.polygonSides,
          cutWidth: ui.carve.cutWidth,
        })
        break
      case 'pen':
        toolRef.current = new PenTool(scope, {
          onShape: (pathData) => addPenShape(pathData),
          onGuide: (path) => addPenGuide(contourOf(path)),
          snapPoint: (p, role, rays, extra) => controllerRef.current?.snapToolPoint(p, role, { rays, extra }) ?? p,
          onGestureEnd: () => controllerRef.current?.endToolSnap(),
        }, {
          // Read at draw time, so switching the look keeps the drawing in progress.
          fillColor: () => previewColor(useLogoStore.getState().ui.look, color),
          draws: () => useLogoStore.getState().ui.penDraws,
        })
        break
      case 'guide':
        // What the tool draws is not selected: the tool stays on, and a selected guide's knob would sit in the way of the next line.
        toolRef.current = new GuideTool(scope, {
          onGuide: (shape) => addGuides([shape], undefined, false),
          onGhosts: (ghosts) =>
            addGuides(
              ghosts.map(({ shape, of, role, name }) => (role ? { shape, link: { kind: 'construction', of, role }, name } : { shape, name })),
              ghosts.every((ghost) => ghost.role) ? 'Add construction guide' : 'Add guide',
              false,
            ),
          ghostsAt: (p, touch) => ghostsAt(controllerRef.current, scopeRef.current, p, touch),
          ghostsOf: (of) => ghostsOf(controllerRef.current, of),
          selectGuide: (id, additive) => useLogoStore.getState().selectGuides([id], additive),
          snapPoint: (p, role, rays) => controllerRef.current?.snapToolPoint(p, role, { rays }) ?? p,
          snapRadius: (center, radius) => controllerRef.current?.snapToolRadius(center, radius) ?? radius,
          snapLine: (start, current, angle) => controllerRef.current?.snapGuideLine(start, current, angle) ?? null,
          snaps: (mods) => useLogoStore.getState().ui.carve.snapping && !mods.noSnap,
          onGestureEnd: () => controllerRef.current?.endToolSnap(),
        }, {
          draws: () => useLogoStore.getState().ui.guideDraws,
        })
        break
      case 'band':
        // What the tool makes is selected, and the tool stays on for the next band.
        toolRef.current = new BandTool(scope, {
          circles: bandCircles,
          preview: toolBandOutline,
          onBand: (a, b) => useLogoStore.getState().addBand(a, b),
        })
        break
      case 'round':
        // The fillet a click makes is selected, and the tool stays on for the next corner.
        toolRef.current = new RoundTool(scope, {
          corners: roundCorners,
          preview: roundPreview,
          radius: () => useLogoStore.getState().ui.round.radius,
          lastRadius: () => useLogoStore.getState().ui.round.last,
          snapRadius: (radius, touch, free) => controllerRef.current?.snapToolFilletRadius(radius, touch, free) ?? { radius: Math.round(radius), same: false },
          onFillet: (corner, radius) => useLogoStore.getState().addFillet(corner.p, corner.between, radius),
        })
        break
    }

    canvas.style.cursor = toolRef.current ? 'crosshair' : 'default'
    // The pen and the Guide tool hide every handle; a carve tool keeps only a recipe's own, to adjust the cut just made.
    const current = toolRef.current
    controllerRef.current?.setHandlesLive(current instanceof PenTool || current instanceof GuideTool || current instanceof BandTool || current instanceof RoundTool ? 'none' : current ? 'recipe' : 'all')
    // Under the Guide tool, guides take presses before the tool does; under the Round tool, fillets.
    controllerRef.current?.setGuidesFirst(current instanceof GuideTool)
    controllerRef.current?.setFilletsFirst(current instanceof RoundTool)

    // Tool keys take precedence over the editor's while a tool is active.
    const unregister = registerEditorKeys((event) => {
      const tool = toolRef.current
      // A tool key mid-press, or mid-drawing with the pen, would throw the gesture away: it waits.
      // The shuffle key waits too: pressed then, it is a slip of the hand. So do [ and ], which change a polygon's sides.
      const gestureKey = toolForKey(event) || isShuffleKey(event) || sidesKeyStep(event) !== 0
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
      if (tool instanceof GuideTool || tool instanceof BandTool || tool instanceof RoundTool) {
        // Escape drops the line being drawn (or the ghosts a tap pinned, or the band's first circle) first, then the tool.
        if (event.key === 'Escape') {
          if (!tool.dismiss()) setActiveTool(null)
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
      controllerRef.current?.setGuidesFirst(false)
      controllerRef.current?.setFilletsFirst(false)
    }
  }, [
    ui.activeTool,
    ui.carve.punchShape,
    ui.carve.cutWidth,
    params.fillColor,
    scopeRef,
    addCarveCut,
    addPenShape,
    addPenGuide,
    addGuides,
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
    let target = toolRef.current && controller ? controller.toolPressTarget(p, touch) : null
    // Under the Round tool a free corner within reach takes the press over a fillet's circle or the selected fillet's radius dot.
    if (toolRef.current instanceof RoundTool && controller && roundCornerFirst(toolRef.current, point, target, touch)) target = null
    if (toolRef.current && target?.kind !== 'editor') {
      pressOwnerRef.current = 'tool'
      controller?.toolDown(p, modifiersOf(e), touch)
      const tool = toolRef.current
      if (tool instanceof GuideTool) tool.onMouseDown(point, modifiersOf(e), touch, target?.kind === 'guide' ? target : null)
      else if (tool instanceof BandTool) tool.onMouseDown(point, touch)
      else if (tool instanceof RoundTool) tool.onMouseDown(point, modifiersOf(e), touch)
      else tool.onMouseDown(point)
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
      const hovering = e.buttons === 0 && controller !== null
      let roundYields = false
      if (hovering) {
        const penCursor = tool instanceof PenTool ? tool.cursorAt(point) : null
        // As a press would: a corner to round takes the hover over a fillet's circle or a radius dot further off, and else the editor's zone does.
        const target = tool instanceof RoundTool ? controller.toolPressTarget(p, touch) : null
        const cornerFirst = tool instanceof RoundTool && roundCornerFirst(tool, point, target, touch)
        roundYields = target?.kind === 'editor' && !cornerFirst
        e.currentTarget.style.cursor = penCursor ?? controller.toolHover(p, touch, cornerFirst) ?? 'crosshair'
      }
      controller?.toolPointer(p, modifiersOf(e), touch)
      if (tool instanceof GuideTool) tool.onMouseDrag(point, modifiersOf(e), touch, hovering && controller.toolPressTarget(p, touch) !== null)
      else if (tool instanceof BandTool) tool.onMouseDrag(point, touch)
      else if (tool instanceof RoundTool) tool.onMouseDrag(point, modifiersOf(e), touch, hovering && roundYields)
      else tool.onMouseDrag(point)
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
    const tool = toolRef.current
    if (owner === 'tool' && tool) {
      if (tool instanceof GuideTool) tool.onMouseUp(point, modifiersOf(e))
      else tool.onMouseUp(point)
      return
    }
    controllerRef.current?.pointerUp()
  }, [toProject])

  /** The gesture was interrupted (pointer cancelled or capture lost): undo the preview. */
  const handlePointerCancel = useCallback(() => {
    pressOwnerRef.current = null
    if (toolRef.current instanceof CarveTool || toolRef.current instanceof GuideTool || toolRef.current instanceof BandTool || toolRef.current instanceof RoundTool) toolRef.current.cancel()
    controllerRef.current?.cancel()
  }, [])

  /** Hover outlines, snap hints and labels go when the pointer leaves (a captured drag keeps them). */
  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (toolRef.current instanceof PenTool || toolRef.current instanceof GuideTool || toolRef.current instanceof BandTool || toolRef.current instanceof RoundTool) toolRef.current.pointerLeave()
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
          aria-label="Vector Maker canvas. Drag a shape to move it, its handles to resize or rotate it, or an edge to bend it. A click takes a whole group; a double-click takes one of its pieces, and Escape comes back. Arrow keys nudge the selection; Alt with Left or Right rotates it by 1 degree, Alt with Up or Down scales it so its longer side grows or shrinks by 1 unit, and Shift makes each step larger. Delete removes it."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
        />
        <CanvasHud />
        {ui.look === 'construction' && activeMark.warnings && (
          // A failed boolean step is never a silent gap.
          <p
            role="status"
            className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 shadow-sm"
          >
            {activeMark.warnings.length === 1
              ? 'One shape could not be combined and is left out of the mark.'
              : `${activeMark.warnings.length} shapes could not be combined and are left out of the mark.`}
          </p>
        )}
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

/**
 * The document as it would be with an offset the bar is setting: a new
 * layer directly above its source, in its group, or the copy it stands in
 * for, cutting or not as the preview says.
 */
function withPreviewOffset(doc: IllustratorDocument, preview: OffsetPreview, sourceOperation: 'add' | 'subtract'): IllustratorDocument {
  const operation = preview.asCut ? 'subtract' : sourceOperation
  if (preview.replaces) {
    return { ...doc, layers: doc.layers.map((layer) => (layer.id === preview.replaces ? { ...layer, operation } : layer)) }
  }
  const index = doc.layers.findIndex((layer) => layer.id === preview.of)
  const source = doc.layers[index]
  const layer = {
    id: OFFSET_PREVIEW_ID,
    name: 'Offset',
    operation,
    visible: true,
    locked: false,
    pathData: '',
    fillRule: 'evenodd' as const,
    transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
    ...(source?.parentId ? { parentId: source.parentId } : {}),
  }
  return { ...doc, layers: [...doc.layers.slice(0, index + 1), layer, ...doc.layers.slice(index + 1)] }
}
