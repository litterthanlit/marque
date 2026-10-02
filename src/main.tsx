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

// Development-only handle for end-to-end checks; stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as { __marque?: unknown }).__marque = { store: useLogoStore, bakedEditablePath }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
