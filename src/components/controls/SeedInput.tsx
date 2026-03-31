import { useLogoStore } from '../../store/logoStore.ts'

export function SeedInput() {
  const seed = useLogoStore((s) => s.params.seed)
  const setParam = useLogoStore((s) => s.setParam)
  const randomizeSeed = useLogoStore((s) => s.randomizeSeed)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Seed
      </span>
      <div className="flex gap-2">
        <input
          type="number"
          value={seed}
          onChange={(e) => setParam('seed', parseInt(e.target.value) || 0)}
          className="flex-1 px-2.5 py-1.5 text-sm font-mono bg-neutral-100 border border-neutral-200 rounded-md outline-none focus:border-neutral-400 tabular-nums"
        />
        <button
          onClick={randomizeSeed}
          className="px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded-md hover:bg-neutral-700 transition-colors"
        >
          Random
        </button>
      </div>
    </div>
  )
}
