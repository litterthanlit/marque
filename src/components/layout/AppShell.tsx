import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { ConstructionPanel } from '../canvas/ConstructionPanel.tsx'
import { FinalMarkPreview } from '../canvas/FinalMarkPreview.tsx'
import { PaletteTile } from '../canvas/PaletteTile.tsx'
import { ExportTile } from '../canvas/ExportTile.tsx'
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

  const pastCount = useSyncExternalStore(
    (listener) => useLogoStore.temporal.subscribe(listener),
    () => useLogoStore.temporal.getState().pastStates.length,
    () => 0,
  )
  const futureCount = useSyncExternalStore(
    (listener) => useLogoStore.temporal.subscribe(listener),
    () => useLogoStore.temporal.getState().futureStates.length,
    () => 0,
  )
  const historyTotal = pastCount + futureCount + 1
  const historyCurrent = pastCount + 1

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

  const headlineText = commentary?.headline ?? 'Generative mark'

  return (
    <div className="h-dvh flex flex-col bg-surface">
      <Toolbar />
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Editorial stage — paper canvas area */}
        <main className="flex-1 flex flex-col min-w-0 bg-paper text-paper-ink overflow-auto relative">
          {error && (
            <div role="alert" className="absolute top-3 left-1/2 -translate-x-1/2 z-30 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
              {error}
            </div>
          )}

          {/* Title block */}
          <div className="px-6 pt-8 pb-4 lg:px-10 lg:pt-10 lg:pb-6">
            <div className="font-mono-tabular text-[11px] tracking-[0.18em] uppercase text-paper-muted">
              Generative logo system
            </div>
            <h1 className="mt-2 font-display text-[30px] leading-[1.05] tracking-tight text-paper-ink lg:text-[40px]">
              {headlineText}
              <span className="text-paper-muted"> · </span>
              <span className="font-mono-tabular text-[24px] lg:text-[32px] align-baseline">
                Seed {params.seed}
              </span>
            </h1>
          </div>

          {/* Editorial grid — DOM order is mobile stack order (canvas → final → construction);
              lg: grid columns place them at construction | canvas | final. */}
          <div className="px-6 pb-4 lg:px-10 lg:pb-6 flex flex-col gap-6 lg:flex-1 lg:min-h-0 lg:grid lg:grid-cols-12 lg:gap-6">
            <div className="relative flex items-center justify-center min-h-[320px] lg:col-start-4 lg:col-span-6 lg:min-h-0">
              <LogoCanvas />
            </div>
            <div className="relative lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:min-h-0 flex flex-col gap-3">
              <div className="aspect-square">
                <FinalMarkPreview />
              </div>
              <PaletteTile />
              <ExportTile />
            </div>
            <div className="lg:col-start-1 lg:col-span-3 lg:row-start-1 lg:min-h-0">
              <ConstructionPanel commentary={commentary} className="lg:h-full" />
            </div>
          </div>

          {/* History breadcrumb */}
          <div className="px-6 pb-6 lg:px-10 lg:pb-8 flex items-center gap-3">
            <span className="font-mono-tabular text-[11px] tracking-[0.14em] uppercase text-paper-muted">
              History
            </span>
            <span className="font-mono-tabular text-[11px] text-paper-ink">
              {historyCurrent} of {historyTotal}
            </span>
            {commentary && (
              <>
                <span className="text-paper-muted">·</span>
                <span className="text-[11px] text-paper-muted italic truncate">
                  {commentary.headline}
                </span>
              </>
            )}
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
