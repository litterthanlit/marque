import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { cn } from '../../lib/utils.ts'

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised'

export function EffectControls() {
  const dissolution = useLogoStore((s) => s.effectParams.dissolution)
  const toggleDissolution = useLogoStore((s) => s.toggleDissolution)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)

  return (
    <div className="flex flex-col gap-2">
      <ImperfectionControls />

      <EffectToggle label="Dissolution" enabled={dissolution.enabled} onToggle={toggleDissolution} />

      {dissolution.enabled && (
        <div className="flex flex-col gap-2 pl-1">
          <SliderControl label="Threshold" value={dissolution.threshold} min={0.01} max={1} step={0.01} onChange={(v) => setEffectParam('threshold', v)} />
          <SliderControl label="Cell Size" value={dissolution.cellSize} min={4} max={32} step={1} onChange={(v) => setEffectParam('cellSize', v)} />
          <SegmentRow label="Shape" value={dissolution.shape} options={['square', 'circle']} onChange={(v) => setEffectParam('shape', v as 'square' | 'circle')} />
          <SliderControl label="Scatter" value={dissolution.scatter} min={0} max={1} step={0.01} onChange={(v) => setEffectParam('scatter', v)} />
          <SliderControl label="Size Var" value={dissolution.sizeVariation} min={0} max={1} step={0.01} onChange={(v) => setEffectParam('sizeVariation', v)} />
        </div>
      )}
    </div>
  )
}

/** Imperfection: the mark redrawn by hand. Shared by Generate and Vector Maker. */
export function ImperfectionControls() {
  const imperfection = useLogoStore((s) => s.effectParams.imperfection)
  const toggleImperfection = useLogoStore((s) => s.toggleImperfection)
  const setImperfectionParams = useLogoStore((s) => s.setImperfectionParams)

  return (
    <div className="flex flex-col gap-2">
      <EffectToggle label="Imperfection" enabled={imperfection.enabled} onToggle={toggleImperfection} />

      {imperfection.enabled && (
        <div className="flex flex-col gap-2 pl-1" role="group" aria-label="Imperfection settings">
          <SliderControl label="Wobble" value={imperfection.wobble} min={0} max={1} step={0.01} onChange={(v) => setImperfectionParams({ wobble: v })} />
          <SliderControl label="Grain" value={imperfection.grain} min={0} max={1} step={0.01} onChange={(v) => setImperfectionParams({ grain: v })} />
          <SliderControl label="Ink Spread" value={imperfection.soften} min={0} max={1} step={0.01} onChange={(v) => setImperfectionParams({ soften: v })} />
          <button
            type="button"
            onClick={() => setImperfectionParams({ seed: nextHandSeed(imperfection.seed) })}
            aria-label="Redraw with a new hand"
            title="Same settings, drawn again by a different hand"
            className={cn(
              'flex items-center justify-between h-7 px-2.5 rounded-md text-xs',
              'bg-interactive-active text-sidebar-text hover:bg-interactive-hover hover:text-fg',
              focusRing,
            )}
          >
            <span>New hand</span>
            <span className="text-[10px] text-sidebar-muted font-mono tabular-nums">#{imperfection.seed}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** A different hand every time, never the one you just had. */
function nextHandSeed(current: number): number {
  let seed = current
  while (seed === current) seed = 1 + Math.floor(Math.random() * 9999)
  return seed
}

function EffectToggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className={cn(
        'flex items-center justify-between h-7 px-2.5 rounded-md text-xs',
        focusRing,
        enabled ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring' : 'bg-interactive-active text-sidebar-text hover:bg-interactive-hover',
      )}
    >
      <span>{label}</span>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', enabled ? 'bg-emerald-500' : 'bg-sidebar-muted')} />
    </button>
  )
}

function SegmentRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-sidebar-text shrink-0">{label}</span>
      <div className="flex gap-0.5 flex-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'flex-1 min-w-0 h-6 rounded px-1 text-[11px] capitalize truncate',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
              value === opt ? 'bg-interactive text-fg font-medium' : 'bg-interactive-active text-sidebar-muted hover:text-fg',
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
