import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell.tsx'
import { useUrlState } from './hooks/useUrlState.ts'
import { useLogoStore } from './store/logoStore.ts'
import { dispatchEditorKey, isBareKey, isEditorInteracting } from './renderer/directEdit/keyboard.ts'
import { toolForKey } from './components/editor/tools.ts'

function App() {
  useUrlState()

  // Apply saved theme on mount
  useEffect(() => {
    const theme = useLogoStore.getState().ui.theme
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip while typing or choosing. The colour swatch keeps focus after its picker closes, and takes no typing.
      const target = e.target as HTMLElement
      const tag = target.tagName
      const colourSwatch = tag === 'INPUT' && (target as HTMLInputElement).type === 'color'
      if ((tag === 'INPUT' && !colourSwatch) || tag === 'SELECT' || tag === 'TEXTAREA') return
      // A dialog over the page has the keyboard: nothing behind it reacts.
      if (document.querySelector('[aria-modal="true"]')) return

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

      if (e.key === 'Escape' && useLogoStore.getState().ui.layersOpen) {
        e.preventDefault()
        useLogoStore.getState().setLayersOpen(false)
        return
      }

      if (isBareKey(e)) {
        const key = e.key.toLowerCase()
        if (key === 'f') {
          e.preventDefault()
          useLogoStore.getState().toggleLook()
          return
        }
        if (key === 'l') {
          e.preventDefault()
          const { ui, setLayersOpen } = useLogoStore.getState()
          setLayersOpen(!ui.layersOpen)
          return
        }
        const tool = toolForKey(e)
        if (tool) {
          e.preventDefault()
          useLogoStore.getState().setActiveTool(tool.id)
          return
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
