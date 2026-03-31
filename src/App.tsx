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
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().undo()
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().redo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <AppShell />
}

export default App
