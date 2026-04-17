import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { cn } from '../../lib/utils.ts'

export function EffectControls() {
  const dissolution = useLogoStore((s) => s.effectParams.dissolution)
  const toggleDissolution = useLogoStore((s) => s.toggleDissolution)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggleDissolution}
        className={cn(
          'flex items-center justify-between h-7 px-2.5 rounded-md text-xs',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
          dissolution.enabled ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring' : 'bg-interactive-active text-sidebar-text hover:bg-interactive-hover',
        )}
      >
        <span>Dissolution</span>
        <span className={cn('size-1.5 rounded-full', dissolution.enabled ? 'bg-emerald-500' : 'bg-sidebar-muted')} />
      </button>

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
              'flex-1 h-6 rounded text-[11px] capitalize',
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
