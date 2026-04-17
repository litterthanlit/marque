import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { ConstructionPanel } from '../canvas/ConstructionPanel.tsx'
import { ParameterPanel } from '../controls/ParameterPanel.tsx'
import { useLogoStore } from '../../store/logoStore.ts'
import { generateConstructionCommentary } from '../../engine/commentary/constructionCommentary.ts'

export function AppShell() {
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const error = useLogoStore((s) => s.error)
  const params = useLogoStore((s) => s.params)
  const result = useLogoStore((s) => s.result)
  const controlsButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasMobilePanelOpenRef = useRef(false)
  const titleId = useId()

  const commentary = useMemo(
    () => (result ? generateConstructionCommentary(params, result) : null),
    [params, result],
  )

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
        {/* Canvas area — takes all available space */}
        <main className="flex-1 flex flex-col items-center justify-center min-h-0 bg-canvas-bg relative">
          {error && (
            <div role="alert" className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {error}
            </div>
          )}
          <LogoCanvas />
        </main>

        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:flex-col w-[340px] lg:w-[380px] flex-shrink-0 border-l border-border bg-sidebar overflow-y-auto">
          <ConstructionPanel commentary={commentary} className="m-4 mb-0" />
          <ParameterPanel />
        </aside>
      </div>

      {/* Mobile controls button */}
      <button
        ref={controlsButtonRef}
        type="button"
        onClick={() => setMobilePanelOpen(true)}
        className="md:hidden fixed right-4 bottom-4 z-30 rounded-lg bg-interactive backdrop-blur-sm px-4 py-2.5 text-xs font-medium text-fg shadow-lg border border-border"
      >
        Controls
      </button>

      {/* Mobile drawer */}
      {mobilePanelOpen && (
        <div className="md:hidden fixed inset-0 z-40">
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
                className="text-xs text-sidebar-muted hover:text-fg transition-colors"
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
