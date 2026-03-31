import { useEffect, useId, useRef, useState } from 'react'
import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { ParameterPanel } from '../controls/ParameterPanel.tsx'
import { FinalPreview } from '../preview/FinalPreview.tsx'
import { ConstructionData } from '../preview/ConstructionData.tsx'
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
    <div className="h-screen flex flex-col bg-neutral-50">
      <Toolbar />
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Main canvas area */}
        <div className="flex-1 flex flex-col p-4 gap-4 min-h-0">
          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {error}
            </div>
          )}
          <LogoCanvas />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-shrink-0">
            <ConstructionData />
            <FinalPreview />
          </div>
        </div>

        <aside className="hidden md:block w-64 border-l border-neutral-200 bg-neutral-50 overflow-y-auto">
          <ParameterPanel />
        </aside>
      </div>

      <button
        ref={controlsButtonRef}
        type="button"
        onClick={() => setMobilePanelOpen(true)}
        className="md:hidden fixed right-4 bottom-4 z-30 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
      >
        Controls
      </button>

      {mobilePanelOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/25"
            onClick={() => setMobilePanelOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 max-h-[78vh] rounded-t-3xl border-t border-neutral-200 bg-neutral-50 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 bg-white">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-neutral-400">
                  Controls
                </div>
                <div id={titleId} className="text-sm font-medium text-neutral-900">
                  Tune the logo
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600"
              >
                Close
              </button>
            </div>
            <div className="max-h-[calc(78vh-73px)] overflow-y-auto">
              <ParameterPanel />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
