import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { EmptyHint } from '../editor/EmptyHint.tsx'
import { LayersDrawer } from '../editor/LayersDrawer.tsx'
import { SelectionBar } from '../editor/SelectionBar.tsx'
import { SparkTray } from '../editor/SparkTray.tsx'
import { ToolPill } from '../editor/ToolPill.tsx'
import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'

export function AppShell() {
  const error = useLogoStore((s) => s.error)
  const setError = useLogoStore((s) => s.setError)
  const layersOpen = useLogoStore((s) => s.ui.layersOpen)

  return (
    <div className="h-dvh flex flex-col bg-surface">
      <Toolbar />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 bg-paper p-3 text-paper-ink sm:p-4">
          {error && (
            <div role="alert" className="flex items-center gap-3 self-center rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
          <div className="relative min-h-0 flex-1">
            <LogoCanvas>
              {/* The open drawer would cover the end of the pill or the bar: they centre on what is left in view. */}
              <div className={cn('pointer-events-none absolute inset-0', layersOpen && 'lg:right-72')}>
                <EmptyHint />
                <ToolPill />
                <SelectionBar />
              </div>
            </LogoCanvas>
          </div>
        </main>
        <LayersDrawer />
      </div>
      {/* Kept out of main, which holds only the drawing: the dev hook and the e2e checks look for the canvas there. */}
      <footer className="shrink-0 border-t border-border bg-surface-raised">
        <SparkTray />
      </footer>
    </div>
  )
}
