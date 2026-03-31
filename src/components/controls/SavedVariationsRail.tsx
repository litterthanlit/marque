import { useLogoStore } from '../../store/logoStore.ts'
import { useSavedVariations } from '../../hooks/useSavedVariations.ts'

export function SavedVariationsRail() {
  const params = useLogoStore((s) => s.params)
  const applyPreset = useLogoStore((s) => s.applyPreset)
  const { variations, saveVariation, removeVariation } = useSavedVariations()

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => saveVariation(params)}
        className="h-7 px-2.5 rounded-md text-xs text-sidebar-text bg-white/5 hover:bg-white/10 hover:text-white"
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
              className="flex items-center justify-between h-8 px-2.5 rounded-md text-xs group hover:bg-white/5"
            >
              <button
                type="button"
                onClick={() => applyPreset(v.params)}
                className="text-sidebar-text hover:text-white truncate text-left flex-1 min-w-0"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => removeVariation(v.id)}
                className="text-sidebar-muted hover:text-red-400 opacity-0 group-hover:opacity-100 ml-2 shrink-0"
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
