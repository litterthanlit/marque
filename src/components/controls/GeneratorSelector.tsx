import { useLogoStore } from '../../store/logoStore.ts'
import { getGenerator, listGenerators } from '../../engine/generators/registry.ts'

export function GeneratorSelector() {
  const generatorId = useLogoStore((s) => s.params.generatorId)
  const params = useLogoStore((s) => s.params)
  const setParams = useLogoStore((s) => s.setParams)
  const generators = listGenerators()

  if (generators.length <= 1) return null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Generator
      </span>
      <select
        value={generatorId}
        onChange={(e) => {
          const nextGeneratorId = e.target.value
          const nextGenerator = getGenerator(nextGeneratorId)
          if (!nextGenerator) return

          const nextExtra = Object.fromEntries(
            nextGenerator.extraParams.map((definition) => [
              definition.key,
              params.extra[definition.key] ?? definition.default,
            ]),
          )

          setParams({
            generatorId: nextGeneratorId,
            extra: nextExtra,
          })
        }}
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
