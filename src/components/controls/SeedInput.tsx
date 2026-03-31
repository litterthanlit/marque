import { useLogoStore } from '../../store/logoStore.ts'

export function SeedInput() {
  const seed = useLogoStore((s) => s.params.seed)
  const setParam = useLogoStore((s) => s.setParam)
  const randomizeSeed = useLogoStore((s) => s.randomizeSeed)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-neutral-500 uppercase tracking-[0.15em]">Seed</span>
      <div className="flex gap-1.5">
        <input
          type="number"
          value={seed}
          min={0}
          max={999999}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10)
            const nextSeed = Number.isFinite(parsed) ? Math.min(999999, Math.max(0, parsed)) : 0
            setParam('seed', nextSeed)
          }}
          className="flex-1 px-2 py-1 text-[12px] font-mono bg-neutral-800 border border-neutral-700 rounded text-white outline-none focus:border-neutral-500 tabular-nums min-w-0"
        />
        <button
          onClick={randomizeSeed}
          className="px-2.5 py-1 text-[11px] font-medium bg-white text-neutral-900 rounded hover:bg-neutral-200 transition-colors"
        >
          Random
        </button>
      </div>
    </div>
  )
}
