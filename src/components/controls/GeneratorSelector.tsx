import { useLogoStore } from '../../store/logoStore.ts'
import { listGenerators } from '../../engine/generators/registry.ts'

export function GeneratorSelector() {
  const generatorId = useLogoStore((s) => s.params.generatorId)
  const setParam = useLogoStore((s) => s.setParam)
  const generators = listGenerators()

  if (generators.length <= 1) return null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Generator
      </span>
      <select
        value={generatorId}
        onChange={(e) => setParam('generatorId', e.target.value)}
        className="px-2.5 py-1.5 text-sm bg-neutral-100 border border-neutral-200 rounded-md outline-none focus:border-neutral-400"
      >
        {generators.map((gen) => (
          <option key={gen.id} value={gen.id}>
            {gen.name}
          </option>
        ))}
      </select>
    </div>
  )
}
