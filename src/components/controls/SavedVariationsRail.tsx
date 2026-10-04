import { useLogoStore } from '../../store/logoStore.ts'
import { useSavedVariations } from '../../hooks/useSavedVariations.ts'
import type { DissolutionParams } from '../../engine/effects/types.ts'

export function SavedVariationsRail() {
  const params = useLogoStore((s) => s.params)
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const vectorDocument = useLogoStore((s) => s.vectorDocument)
  const illustrator = useLogoStore((s) => s.illustrator)
  const effectParams = useLogoStore((s) => s.effectParams)
  const applyPreset = useLogoStore((s) => s.applyPreset)
  const setActiveSurface = useLogoStore((s) => s.setActiveSurface)
  const setVectorDocument = useLogoStore((s) => s.setVectorDocument)
  const setIllustratorDocument = useLogoStore((s) => s.setIllustratorDocument)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)
  const { variations, saveVariation, removeVariation } = useSavedVariations()

  function restoreVariation(variation: (typeof variations)[number]) {
    applyPreset(variation.params)
    if (variation.vectorDocument) {
      setVectorDocument(structuredClone(variation.vectorDocument))
    } else if ('illustrator' in variation) {
      setIllustratorDocument(
        variation.illustrator ? structuredClone(variation.illustrator) : null,
      )
    } else {
      setVectorDocument(null)
    }
    setActiveSurface(variation.activeSurface ?? 'generated')
    if (variation.effectParams) {
      for (const [key, value] of Object.entries(variation.effectParams.dissolution)) {
        setEffectParam(
          key as keyof DissolutionParams,
          value as DissolutionParams[keyof DissolutionParams],
        )
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => saveVariation(
          params,
          activeSurface,
          vectorDocument,
          illustrator,
          effectParams,
        )}
        className="h-7 px-2.5 rounded-md text-xs text-sidebar-text bg-interactive-active hover:bg-interactive-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        Save current
      </button>

      {variations.length === 0 ? (
        <p className="text-xs text-sidebar-muted text-pretty px-1">
          Save a logo to keep it as a reusable starting point.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {variations.map((v) => (
            <div
                key={v.id}
              className="flex items-center justify-between h-8 px-2.5 rounded-md text-xs group hover:bg-interactive-hover"
            >
              <button
                type="button"
                onClick={() => restoreVariation(v)}
                className="text-sidebar-text hover:text-fg truncate text-left flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised rounded-sm"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => removeVariation(v.id)}
                className="text-sidebar-muted hover:text-red-400 opacity-0 group-hover:opacity-100 ml-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised focus-visible:opacity-100 rounded-sm"
                aria-label={`Delete ${v.name}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
