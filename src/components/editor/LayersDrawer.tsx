import { useEffect, useId, useRef } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'
import { EditorButton, FOCUS_RING } from './controls.tsx'

const ROW_BUTTON = cn('h-7 shrink-0 rounded-md text-[10px] transition-colors hover:bg-interactive-hover', FOCUS_RING)

/** Lies over the canvas area and never resizes the canvas: a drawer on the right, or a sheet from the bottom when narrow. */
export function LayersDrawer() {
  const open = useLogoStore((s) => s.ui.layersOpen)
  const setLayersOpen = useLogoStore((s) => s.setLayersOpen)
  const illustrator = useLogoStore((s) => s.illustrator)
  const selectIllustratorLayer = useLogoStore((s) => s.selectIllustratorLayer)
  const moveIllustratorLayer = useLogoStore((s) => s.moveIllustratorLayer)
  const toggleIllustratorLayerVisibility = useLogoStore((s) => s.toggleIllustratorLayerVisibility)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const startOver = useLogoStore((s) => s.startOver)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // Focus goes in on opening, so Escape closes the drawer and not the selection, and back out on closing.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    closeRef.current?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || panel?.contains(active)) previous?.focus()
    }
  }, [open])

  if (!open) return null
  const layers = illustrator.layers
  const top = layers.length - 1

  return (
    <aside
      ref={panelRef}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        setLayersOpen(false)
      }}
      className={cn(
        'absolute z-30 flex flex-col border-border bg-sidebar shadow-2xl shadow-black/30',
        'max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[55%] max-lg:rounded-t-2xl max-lg:border-t',
        'lg:inset-y-0 lg:right-0 lg:w-72 lg:border-l',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-3">
        <h2 id={titleId} className="text-[10px] uppercase tracking-widest text-sidebar-muted">
          Layers
        </h2>
        <span className="flex-1 text-[10px] text-sidebar-muted">{layers.length} total</span>
        <button
          ref={closeRef}
          type="button"
          onClick={() => setLayersOpen(false)}
          aria-label="Close layers"
          title="Close layers (Esc)"
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-interactive-hover hover:text-fg',
            FOCUS_RING,
          )}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-[11px] leading-snug text-sidebar-muted">
          Applied in order from 01. A cut removes only what is below it; point at a hole on the canvas to find its cut.
        </p>
        {layers.length === 0 ? (
          <p className="rounded-lg border border-border bg-interactive-active/40 px-3 py-2 text-xs text-sidebar-muted">
            No layers yet.
          </p>
        ) : (
          <ul className="min-h-0 overflow-y-auto rounded-lg border border-border bg-interactive-active/40">
            {[...layers].reverse().map((layer, reverseIndex) => {
              const index = top - reverseIndex
              const selected = illustrator.selectedLayerIds.includes(layer.id)
              const number = String(index + 1).padStart(2, '0')
              // Slabs share a name: the position tells two rows apart.
              const name = `${number} ${layer.name}`
              return (
                <li
                  key={layer.id}
                  className={cn(
                    'flex items-center gap-1 border-b border-border/60 px-1.5 py-1 last:border-b-0',
                    selected && 'bg-interactive',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleIllustratorLayerVisibility(layer.id)}
                    className={cn(
                      ROW_BUTTON,
                      'w-7',
                      layer.visible ? 'text-fg' : 'text-sidebar-muted/60 hover:text-sidebar-muted',
                    )}
                    aria-label={layer.visible ? `Hide ${name}` : `Show ${name}`}
                  >
                    {layer.visible ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={(event) => selectIllustratorLayer(layer.id, event.shiftKey || event.metaKey)}
                    className={cn(
                      'h-7 min-w-0 flex-1 truncate rounded-md px-2 text-left text-xs text-sidebar-text transition-colors hover:bg-interactive-hover hover:text-fg',
                      FOCUS_RING,
                    )}
                  >
                    <span className="font-mono-tabular text-sidebar-muted">{number}</span> {layer.name}
                  </button>
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveIllustratorLayer(layer.id, 'up')}
                      disabled={index === top}
                      className={cn(ROW_BUTTON, 'w-6 text-sidebar-text hover:text-fg disabled:cursor-default disabled:opacity-30')}
                      aria-label={`Move ${name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveIllustratorLayer(layer.id, 'down')}
                      disabled={index === 0}
                      className={cn(ROW_BUTTON, 'w-6 text-sidebar-text hover:text-fg disabled:cursor-default disabled:opacity-30')}
                      aria-label={`Move ${name} down`}
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIllustratorLayerOperation(layer.id, layer.operation === 'add' ? 'subtract' : 'add')}
                    className={cn(ROW_BUTTON, 'w-8', layer.operation === 'add' ? 'text-emerald-300' : 'text-rose-300')}
                    aria-label={
                      layer.operation === 'add'
                        ? `${name} adds material. Make it a cut`
                        : `${name} cuts material. Make it add`
                    }
                    title={layer.operation === 'add' ? 'Adds material' : 'Cuts material'}
                  >
                    {layer.operation === 'add' ? 'Add' : 'Cut'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-3">
        <EditorButton
          onClick={startOver}
          disabled={layers.length === 0}
          title="Clear the mark. Undo brings it back."
          className="w-full"
        >
          Start over
        </EditorButton>
      </div>
    </aside>
  )
}
