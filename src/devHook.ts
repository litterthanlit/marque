/**
 * Development-only test hook, `window.__marque`, for the end-to-end checks in
 * e2e/. main.tsx installs it only in development, so production builds drop
 * this module.
 */
import { useLogoStore } from './store/logoStore.ts'
import { bakedEditablePath } from './engine/illustrator/layerPath.ts'
import { carveHandles, DEFAULT_HANDLE_LAYOUT } from './engine/carve/edit.ts'
import { grooveSpine } from './engine/carve/outline.ts'
import { isGroove } from './engine/carve/spec.ts'
import { cubicPoint, cubicTangent, type Vec } from './engine/path/bezier.ts'
import { composeVectorMarkCached } from './engine/vector/export.ts'
import { DESIGN_SPAN } from './renderer/viewFit.ts'
import { CURSORS } from './renderer/directEdit/cursors.ts'

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

    /** Client-space positions of the selected recipe's handles. */
    handles() {
      const doc = useLogoStore.getState().illustrator
      const layer = doc.selectedLayerIds.length === 1 ? layerById(doc.selectedLayerIds[0]) : undefined
      const frame = canvasFrame()
      if (!layer?.carve || !frame) return []
      const layout = {
        pad: DEFAULT_HANDLE_LAYOUT.pad / frame.unit,
        rotateOffset: DEFAULT_HANDLE_LAYOUT.rotateOffset / frame.unit,
        minEdgeHandleSize: DEFAULT_HANDLE_LAYOUT.minEdgeHandleSize / frame.unit,
        radiusInset: DEFAULT_HANDLE_LAYOUT.radiusInset / frame.unit,
      }
      return carveHandles(layer.carve, layout).map((h) => ({ id: h.id, ...frame.toClient(h.at) }))
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
