/**
 * Development-only test hook, `window.__marque`, for the end-to-end checks in
 * e2e/. main.tsx installs it only in development, so production builds drop
 * this module.
 */
import { useLogoStore } from './store/logoStore.ts'
import { bakedEditablePath, bakedEditableShape } from './engine/illustrator/layerPath.ts'
import { grooveSpine } from './engine/carve/outline.ts'
import { isGroove } from './engine/carve/spec.ts'
import { cubicPoint, cubicTangent, type Vec } from './engine/path/bezier.ts'
import { composeVectorMarkCached } from './engine/vector/export.ts'
import { DESIGN_SPAN } from './renderer/viewFit.ts'
import { CURSORS } from './renderer/directEdit/cursors.ts'
import { scaledHandleLayout, selectionHandles } from './renderer/directEdit/handleSet.ts'
import { guideAnchor } from './engine/vector/guides.ts'

function canvasFrame() {
  const canvas = document.querySelector('main canvas') as HTMLCanvasElement | null
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  // Client pixels per layer unit: the canvas always shows DESIGN_SPAN units across.
  const unit = Math.min(rect.width, rect.height) / DESIGN_SPAN
  const toClient = (p: Vec) => ({ x: rect.left + rect.width / 2 + p.x * unit, y: rect.top + rect.height / 2 + p.y * unit })
  return { canvas, rect, unit, toClient }
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
     * several layers.
     */
    handles() {
      const frame = canvasFrame()
      if (!frame) return []
      const set = selectionHandles(useLogoStore.getState().illustrator, scaledHandleLayout(1 / frame.unit), bakedEditableShape)
      return (set?.list ?? []).map((h) => ({ id: h.id, ...frame.toClient(h.at) }))
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
