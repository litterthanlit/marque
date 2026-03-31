import { useLogoStore } from '../../store/logoStore.ts'

export function SeedInput() {
  const seed = useLogoStore((s) => s.params.seed)
  const setParam = useLogoStore((s) => s.setParam)
  const randomizeSeed = useLogoStore((s) => s.randomizeSeed)

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-sidebar-text shrink-0">Seed</label>
      <input
        type="number"
        value={seed}
        min={0}
        max={999999}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10)
          setParam('seed', Number.isFinite(parsed) ? Math.min(999999, Math.max(0, parsed)) : 0)
        }}
        className="flex-1 min-w-0 h-7 px-2 text-xs font-mono tabular-nums bg-transparent border border-sidebar-border rounded-md text-white outline-none focus:border-neutral-500"
      />
      <button
        onClick={randomizeSeed}
        className="h-7 px-2.5 text-xs font-medium bg-white/10 text-white rounded-md hover:bg-white/15"
      >
        Random
      </button>
    </div>
  )
}
