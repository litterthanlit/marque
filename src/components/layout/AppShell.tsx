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
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Toolbar />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 bg-canvas p-3 sm:p-4">
          {error && (
            // A fault: a red square, the stop's shape, so it never reads as something running.
            <div role="alert" className="flex animate-enter items-center gap-2.5 self-center rounded-lg bg-surface px-3 py-2 text-xs text-ink shadow-md">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-[1px] bg-danger" />
              <span>{error}</span>
              <button
                type="button"
                data-sound="soft"
                onClick={() => setError(null)}
                className="shrink-0 rounded-sm font-medium text-muted underline decoration-line-strong underline-offset-2 transition-colors duration-(--duration-exit) hover:text-ink hover:duration-(--duration-enter)"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            <LogoCanvas>
              {/* The open drawer would cover the end of the pill or the bar: they centre on what is left in view. */}
              <div className={cn('pointer-events-none absolute inset-0', layersOpen && 'lg:right-80')}>
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
      {/* The deck: a strip of the instrument's body along the bottom edge, its top edge catching the light. */}
      <footer className="plate shrink-0 border-t border-black/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.9)] dark:border-black/60 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]">
        <SparkTray />
      </footer>
    </div>
  )
}
