import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/jetbrains-mono/400.css'
import App from './App.tsx'
import './index.css'
import { useLogoStore } from './store/logoStore.ts'
import { bakedEditablePath } from './engine/illustrator/layerPath.ts'
import { carveHandles, DEFAULT_HANDLE_LAYOUT } from './engine/carve/edit.ts'
import { DESIGN_SPAN } from './renderer/viewFit.ts'

// Development-only handle for end-to-end checks; stripped from production builds.
if (import.meta.env.DEV) {
  /** Client-space positions of the selected recipe's handles. */
  const handles = () => {
    const doc = useLogoStore.getState().illustrator
    const layer = doc?.layers.find((candidate) => candidate.id === doc.selectedLayerIds[0])
    const canvas = document.querySelector('main canvas')
    if (!layer?.carve || !canvas) return []
    const rect = canvas.getBoundingClientRect()
    const unit = Math.min(rect.width, rect.height) / DESIGN_SPAN
    const layout = {
      pad: DEFAULT_HANDLE_LAYOUT.pad / unit,
      rotateOffset: DEFAULT_HANDLE_LAYOUT.rotateOffset / unit,
      minEdgeHandleSize: DEFAULT_HANDLE_LAYOUT.minEdgeHandleSize / unit,
    }
    return carveHandles(layer.carve, layout).map((h) => ({
      id: h.id,
      x: rect.left + rect.width / 2 + h.at.x * unit,
      y: rect.top + rect.height / 2 + h.at.y * unit,
    }))
  }
  ;(window as unknown as { __marque?: unknown }).__marque = { store: useLogoStore, bakedEditablePath, handles }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
