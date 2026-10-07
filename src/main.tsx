import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import App from './App.tsx'
import './index.css'
import { installDevHook } from './devHook.ts'
import { installSound } from './lib/sound.ts'

// Development-only hook for the end-to-end checks; production builds leave it out.
if (import.meta.env.DEV) installDevHook()

// Keys click from the first press: the listeners are delegated, so no key needs a handler of its own.
installSound()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
