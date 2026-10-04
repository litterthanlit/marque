import { useLogoStore } from '../../store/logoStore.ts'

export function SeedInput() {
  const seed = useLogoStore((s) => s.params.seed)
  const setParam = useLogoStore((s) => s.setParam)
  const randomizeSeed = useLogoStore((s) => s.randomizeSeed)

  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] uppercase tracking-widest text-sidebar-muted shrink-0">Seed</label>
      <input
        type="number"
        value={seed}
        min={0}
        max={999999}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10)
          setParam('seed', Number.isFinite(parsed) ? Math.min(999999, Math.max(0, parsed)) : 0)
        }}
        className="flex-1 min-w-0 h-8 px-2.5 text-xs font-mono tabular-nums bg-interactive-active border border-border rounded-lg text-fg outline-none focus:border-sidebar-muted transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      />
      <button
        onClick={randomizeSeed}
        className="h-8 px-3 text-xs font-medium bg-interactive text-fg rounded-lg hover:bg-interactive-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        Random
      </button>
    </div>
  )
}
