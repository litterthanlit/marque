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
    <div className="h-dvh flex flex-col bg-surface">
      <Toolbar />
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <main className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 min-h-0 gap-3">
          {error && (
            <div role="alert" className="w-full max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          )}
          <LogoCanvas />
        </main>
        <aside className="hidden md:flex md:flex-col w-80 flex-shrink-0 border-l border-sidebar-border bg-sidebar overflow-y-auto">
          <ParameterPanel />
        </aside>
      </div>

      <button
        ref={controlsButtonRef}
        type="button"
        onClick={() => setMobilePanelOpen(true)}
        className="md:hidden fixed right-4 bottom-4 z-30 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        Controls
      </button>

      {mobilePanelOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobilePanelOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] rounded-t-xl bg-sidebar overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
              <span id={titleId} className="text-sm font-medium text-neutral-200">Controls</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                className="text-xs text-sidebar-muted hover:text-white"
              >
                Done
              </button>
            </div>
            <div className="max-h-[calc(80dvh-44px)] overflow-y-auto">
              <ParameterPanel />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
