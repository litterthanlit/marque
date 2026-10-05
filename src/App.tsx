import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell.tsx'
import { useUrlState } from './hooks/useUrlState.ts'
import { useLogoStore } from './store/logoStore.ts'
import { dispatchEditorKey, isEditorInteracting } from './renderer/directEdit/keyboard.ts'

function App() {
  useUrlState()

  // Apply saved theme on mount
  useEffect(() => {
    const theme = useLogoStore.getState().ui.theme
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when input is focused
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      // Canvas editors first: Delete removes a selected point before its layer,
      // Escape steps back one level, arrows nudge.
      if (dispatchEditorKey(e)) {
        e.preventDefault()
        return
      }

      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase()
        // Undo waits for the drag to finish: the gesture is not a step yet.
        if (key === 'z' && isEditorInteracting()) {
          e.preventDefault()
          return
        }
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useLogoStore.getState().undoVectorCommand()
        }
        if (key === 'z' && e.shiftKey) {
          e.preventDefault()
          useLogoStore.getState().redoVectorCommand()
        }
        if (e.key === 'e') {
          e.preventDefault()
          // Export shortcut — dispatch custom event
          window.dispatchEvent(new CustomEvent('open-export'))
        }
      }

      // Delete/Backspace = delete selected shape in edit mode (not while a slider has focus)
      const onSlider = Boolean((e.target as HTMLElement).closest?.('[role="slider"]'))
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !onSlider) {
        const { ui, activeSurface, illustrator } = useLogoStore.getState()
        if (activeSurface === 'illustrator' && illustrator?.selectedLayerIds.length) {
          e.preventDefault()
          useLogoStore.getState().deleteIllustratorLayers()
          return
        }
        if (ui.editMode && ui.selectedShapeId) {
          e.preventDefault()
          useLogoStore.getState().deleteSelectedShape()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <AppShell />
}

export default App
