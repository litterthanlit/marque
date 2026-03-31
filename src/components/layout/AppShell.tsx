import { useEffect, useId, useRef, useState } from 'react'
import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { ParameterPanel } from '../controls/ParameterPanel.tsx'
import { useLogoStore } from '../../store/logoStore.ts'

export function AppShell() {
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const error = useLogoStore((s) => s.error)
  const controlsButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasMobilePanelOpenRef = useRef(false)
  const titleId = useId()

  useEffect(() => {
    if (!mobilePanelOpen) return
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobilePanelOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobilePanelOpen])

  useEffect(() => {
    if (wasMobilePanelOpenRef.current && !mobilePanelOpen) {
      controlsButtonRef.current?.focus()
    }
    wasMobilePanelOpenRef.current = mobilePanelOpen
  }, [mobilePanelOpen])

  return (
    <div className="h-screen flex flex-col bg-[#f5f5f4]">
      <Toolbar />
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10 min-h-0">
          {error && (
            <div role="alert" className="mb-4 w-full max-w-[680px] rounded-lg bg-amber-950/90 px-4 py-2.5 text-sm text-amber-200">
              {error}
            </div>
          )}
          <LogoCanvas />
        </div>
        <aside className="hidden md:block w-[340px] flex-shrink-0 border-l border-neutral-800 bg-[#1a1a1a] overflow-y-auto">
          <ParameterPanel />
        </aside>
      </div>

      <button
        ref={controlsButtonRef}
        type="button"
        onClick={() => setMobilePanelOpen(true)}
        className="md:hidden fixed right-4 bottom-4 z-30 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 shadow-lg border border-neutral-200"
      >
        Controls
      </button>

      {mobilePanelOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobilePanelOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 max-h-[78vh] rounded-t-2xl bg-[#1a1a1a] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <span id={titleId} className="text-sm font-medium text-neutral-300">Controls</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                className="rounded-md px-2.5 py-1 text-xs text-neutral-400 hover:text-white transition-colors"
              >
                Done
              </button>
            </div>
            <div className="max-h-[calc(78vh-48px)] overflow-y-auto">
              <ParameterPanel />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
