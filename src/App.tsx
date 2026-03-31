import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell.tsx'
import { useGeneration } from './hooks/useGeneration.ts'
import { useUrlState } from './hooks/useUrlState.ts'
import { useLogoStore } from './store/logoStore.ts'

function App() {
  useGeneration()
  useUrlState()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when input is focused
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().undo()
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().redo()
        }
        if (e.key === 'e') {
          e.preventDefault()
          // Export shortcut — dispatch custom event
          window.dispatchEvent(new CustomEvent('open-export'))
        }
      }

      // R = randomize seed
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        useLogoStore.getState().randomizeSeed()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <AppShell />
}

export default App
