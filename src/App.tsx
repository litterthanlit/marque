import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell.tsx'
import { useUrlState } from './hooks/useUrlState.ts'
import { useLogoStore } from './store/logoStore.ts'
import { dispatchEditorKey, isBareKey, isEditorInteracting } from './renderer/directEdit/keyboard.ts'
import { hud } from './renderer/directEdit/hud.ts'
import { isShuffleKey, sidesKeyStep, steppedPolygonSides, toolForKey } from './components/editor/tools.ts'

/** How long the HUD shows the next polygon's sides after [ or ]. */
const NEXT_SIDES_MS = 1500

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
        // Cmd+; shows and hides guides, as in Illustrator. View state: no undo step, nothing in the link.
        if (e.key === ';' && !e.altKey) {
          e.preventDefault()
          useLogoStore.getState().toggleShowGuides()
          return
        }
        // Undo waits for the drag to finish: the gesture is not a step yet.
        if (key === 'z' && isEditorInteracting()) {
          e.preventDefault()
          return
        }
        // What a keyboard edit read out last no longer holds after an undo or redo.
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          hud.silence()
          useLogoStore.getState().undoVectorCommand()
        }
        if (key === 'z' && e.shiftKey) {
          e.preventDefault()
          hud.silence()
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
        if (isShuffleKey(e)) {
          e.preventDefault()
          useLogoStore.getState().shuffleSparks()
          return
        }
        // [ and ] wait for a drag to end, and leave the pen alone.
        const step = sidesKeyStep(e)
        if (step) {
          e.preventDefault()
          const { ui, illustrator, stepPolygonSides } = useLogoStore.getState()
          if (isEditorInteracting() || ui.activeTool === 'pen') return
          stepPolygonSides(step)
          // With no polygon selected the keys set the next one's sides, which nothing on the canvas shows: say so.
          const selected = illustrator.layers.filter((layer) => illustrator.selectedLayerIds.includes(layer.id))
          if (!steppedPolygonSides(selected).length) {
            const said = `Next polygon: ${useLogoStore.getState().ui.carve.polygonSides} sides`
            hud.hold(said, NEXT_SIDES_MS)
            hud.announce(said)
          }
          return
        }
      }

      // Delete/Backspace removes the selected layers or guides (not while a slider has focus)
      const onSlider = Boolean((e.target as HTMLElement).closest?.('[role="slider"]'))
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !onSlider) {
        const { illustrator, deleteIllustratorLayers, deleteGuides } = useLogoStore.getState()
        if (illustrator.selectedLayerIds.length) {
          e.preventDefault()
          deleteIllustratorLayers()
        } else if (illustrator.selectedGuideIds?.length) {
          e.preventDefault()
          deleteGuides()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <AppShell />
}

export default App
