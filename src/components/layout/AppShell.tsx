import { useEffect, useId, useRef, useState } from 'react'
import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { PaletteTile } from '../canvas/PaletteTile.tsx'
import { ExportTile } from '../canvas/ExportTile.tsx'
import { ParameterPanel } from '../controls/ParameterPanel.tsx'
import { useLogoStore } from '../../store/logoStore.ts'

export function AppShell() {
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const error = useLogoStore((s) => s.error)
  const setError = useLogoStore((s) => s.setError)
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
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <main className="flex-1 flex flex-col min-w-0 bg-paper text-paper-ink overflow-auto relative">
          {error && (
            <div role="alert" className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex w-max max-w-[calc(100%-1.5rem)] items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 rounded-sm font-medium underline underline-offset-2 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="p-6 lg:p-8 flex flex-col gap-6 lg:flex-1 lg:min-h-0 lg:grid lg:grid-cols-12 lg:gap-6">
            <div className="relative flex items-center justify-center min-h-[320px] lg:col-span-9 lg:min-h-0">
              <LogoCanvas />
            </div>
            <div className="lg:col-span-3 lg:min-h-0 flex flex-col gap-3">
              <PaletteTile />
              <ExportTile />
            </div>
          </div>
        </main>

        {/* Inspector (desktop ≥ 1024px) */}
        <aside className="hidden lg:flex lg:flex-col w-[clamp(300px,28vw,380px)] flex-shrink-0 border-l border-border bg-sidebar overflow-x-hidden overflow-y-auto">
          <ParameterPanel />
        </aside>
      </div>

      {/* Mobile controls button */}
      <button
        ref={controlsButtonRef}
        type="button"
        onClick={() => setMobilePanelOpen(true)}
        className="lg:hidden fixed right-4 bottom-4 z-30 rounded-lg bg-surface-raised backdrop-blur-sm px-4 py-2.5 text-xs font-medium text-fg shadow-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        Controls
      </button>

      {/* Mobile drawer */}
      {mobilePanelOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobilePanelOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] rounded-t-2xl bg-sidebar border-t border-border overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span id={titleId} className="text-xs font-medium text-neutral-300">Controls</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                className="text-xs text-sidebar-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
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
