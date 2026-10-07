/**
 * Development-only test hook, `window.__marque`, for the end-to-end checks in
 * e2e/. main.tsx installs it only in development, so production builds drop
 * this module.
 */
import { useLogoStore } from './store/logoStore.ts'
import { bakedEditablePath, bakedEditableShape } from './engine/illustrator/layerPath.ts'
import { carveOutline, grooveSpine } from './engine/carve/outline.ts'
import { isGroove } from './engine/carve/spec.ts'
import { cubicPoint, cubicTangent, type Vec } from './engine/path/bezier.ts'
import { composeBaseMark, composeVectorMarkCached } from './engine/vector/export.ts'
import { cornerSources, freeCorners } from './engine/fillet/apply.ts'
import { cornerKind } from './engine/fillet/corners.ts'
import { filletDot } from './renderer/directEdit/filletEdit.ts'
import { filletMarksDrawn, guidePointsDrawn, vertexSquaresDrawn } from './renderer/IllustratorRenderer.ts'
import { DESIGN_SPAN } from './renderer/viewFit.ts'
import { CURSORS } from './renderer/directEdit/cursors.ts'
import { canvasPointer, scaledHandleLayout, selectionHandles } from './renderer/directEdit/handleSet.ts'
import { guideAnchor } from './engine/vector/guides.ts'
import type { Fillet } from './engine/vector/types.ts'

function canvasFrame() {
  const canvas = document.querySelector('main canvas') as HTMLCanvasElement | null
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  // Client pixels per layer unit: the canvas always shows DESIGN_SPAN units across.
  const unit = Math.min(rect.width, rect.height) / DESIGN_SPAN
  const toClient = (p: Vec) => ({ x: rect.left + rect.width / 2 + p.x * unit, y: rect.top + rect.height / 2 + p.y * unit })
  return { canvas, rect, unit, toClient }
}

/** A fillet as the end-to-end checks read it: `lost` is null while it does not show (hidden, or no canvas). */
type FilletOnCanvas = Fillet & {
  lost: boolean | null
  used?: number
  convex?: boolean
  circle?: Vec & { r: number }
  dot?: Vec
}

function layerById(id: string) {
  return useLogoStore.getState().illustrator.layers.find((candidate) => candidate.id === id)
}

function createDevHook() {
  return {
    store: useLogoStore,
    bakedEditablePath,
    bakedEditableShape,

    /**
     * Client-space positions of the selection's handles, as the canvas
     * computes them: a recipe's own, or the box around a free shape or
     * several layers, laid out for the pointer last used on the canvas.
     */
    handles() {
      const frame = canvasFrame()
      if (!frame) return []
      const set = selectionHandles(useLogoStore.getState().illustrator, scaledHandleLayout(1 / frame.unit, canvasPointer.touch()), bakedEditableShape)
      return (set?.list ?? []).map((h) => ({ id: h.id, ...frame.toClient(h.at) }))
    },

    /**
     * What the selection holds: layers and whole groups, as a click selects
     * them. `illustrator.selectedLayerIds` stands each group in for every
     * layer inside it.
     */
    selectedRoots() {
      const { illustrator } = useLogoStore.getState()
      return illustrator.selectedRootIds ?? illustrator.selectedLayerIds
    },

    /** The group the selection lies in, which a click selects inside of; null for none. */
    enteredGroup() {
      return useLogoStore.getState().illustrator.enteredGroupId ?? null
    },

    /** Name of the editor cursor currently shown on the canvas. */
    cursor() {
      const current = canvasFrame()?.canvas.style.cursor ?? ''
      return Object.entries(CURSORS).find(([, value]) => value === current)?.[0] ?? current
    },

    /** The composed mark: exactly what the canvas draws and Copy SVG copies. */
    mark() {
      return composeVectorMarkCached(useLogoStore.getState().vectorDocument)
    },

    /**
     * The corners the Round tool offers now, those with no fillet on them:
     * each in client space and layer space, with the objects whose
     * outlines meet there, the kind Round all matches by, and its turn in degrees.
     */
    roundCorners() {
      const frame = canvasFrame()
      const { objects, fillets } = useLogoStore.getState().vectorDocument
      if (!frame) return []
      return freeCorners(composeBaseMark(objects), fillets, cornerSources(objects)).map((corner) => ({
        ...frame.toClient(corner.p),
        at: corner.p,
        between: corner.between,
        kind: cornerKind(corner),
        convex: corner.convex,
        turn: (corner.turn * 180) / Math.PI,
      }))
    },

    /**
     * The document's fillets as the mark resolves them: each stored fillet,
     * with where its circle is on the canvas (client space, radius in client
     * pixels) and its radius dot, or `lost` while its corner is gone.
     */
    fillets(): FilletOnCanvas[] {
      const frame = canvasFrame()
      const { vectorDocument } = useLogoStore.getState()
      const resolved = composeVectorMarkCached(vectorDocument).fillets ?? []
      return vectorDocument.fillets.map((fillet) => {
        const state = resolved.find((each) => each.id === fillet.id)
        if (!frame || !state) return { ...fillet, lost: null }
        if (state.lost) return { ...fillet, lost: true, circle: { ...frame.toClient(state.centre), r: state.used * frame.unit } }
        return {
          ...fillet,
          lost: false,
          used: state.used,
          convex: state.convex,
          circle: { ...frame.toClient(state.centre), r: state.used * frame.unit },
          dot: frame.toClient(filletDot(state)),
        }
      })
    },

    /** How the canvas last drew the fillets' circles: each solid, dashed or lost, and its colour. None in the final look. */
    filletMarks() {
      return filletMarksDrawn()
    },

    /**
     * Where the canvas draws the squares at the corner points of the recipes'
     * own constructions (slab and polygon vertices), layer space: a drag's
     * live ones in place of those it moves. None in the final look.
     */
    cornerSquares() {
      return vertexSquaresDrawn().map((p) => ({ x: p.x, y: p.y }))
    },

    /**
     * Where the canvas last marked guides crossing (squares) and frame lines
     * touching their circles (open circles), layer space: a live frame's
     * while a drag moves guides. None in the final look.
     */
    guidePoints() {
      const { crossings, touches } = guidePointsDrawn()
      return { crossings: crossings.map((p) => ({ x: p.x, y: p.y })), touches: touches.map((p) => ({ x: p.x, y: p.y })) }
    },

    /** The document's guides: never composed, never in `mark()`. */
    guides() {
      return useLogoStore.getState().vectorDocument.guides
    },

    /**
     * Client positions of the guides on the canvas: for each, the point of it
     * nearest a layer-space point (the middle of the canvas unless given),
     * or a path guide's first point.
     */
    guidesOnCanvas(near: Vec = { x: 0, y: 0 }) {
      const frame = canvasFrame()
      if (!frame) return []
      return useLogoStore.getState().vectorDocument.guides.map((guide) => ({ id: guide.id, ...frame.toClient(guideAnchor(guide.shape, near)) }))
    },

    /**
     * The corner circles of a layer's recipe, as the construction look draws
     * them: each centre in client space, and its radius in client pixels.
     * A linked offset copy draws none of its own.
     */
    cornerCircles(layerId: string) {
      const layer = layerById(layerId)
      const spec = layer?.carve
      const frame = canvasFrame()
      if (!spec || !frame || layer.link?.kind === 'offset') return []
      const outline = carveOutline(spec).frame
      return outline.kind !== 'groove' ? outline.cornerCircles.map((circle) => ({ ...frame.toClient(circle.c), r: circle.r * frame.unit })) : []
    },

    /** A point on a channel's or slice's spine and the unit normal there, in client space. */
    grooveProbe(layerId: string, t: number) {
      const spec = layerById(layerId)?.carve
      const frame = canvasFrame()
      if (!spec || !isGroove(spec) || !frame) return null
      const spine = grooveSpine(spec)
      const tangent = cubicTangent(spine, t)
      return { ...frame.toClient(cubicPoint(spine, t)), nx: -tangent.y, ny: tangent.x, unit: frame.unit, width: spec.width }
    },
  }
}

export type DevHook = ReturnType<typeof createDevHook>

export function installDevHook(): void {
  ;(window as unknown as { __marque?: DevHook }).__marque = createDevHook()
}
