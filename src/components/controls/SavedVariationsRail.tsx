import { useLogoStore } from '../../store/logoStore.ts'
import { useSavedVariations } from '../../hooks/useSavedVariations.ts'
import { isBlankDocument } from '../../engine/vector/document.ts'

interface SavedVariationsRailProps {
  /** A saved mark was put on the canvas. */
  onOpened?: () => void
}

export function SavedVariationsRail({ onOpened }: SavedVariationsRailProps) {
  const params = useLogoStore((s) => s.params)
  const vectorDocument = useLogoStore((s) => s.vectorDocument)
  const openSaved = useLogoStore((s) => s.openSaved)
  const { variations, saveVariation, removeVariation } = useSavedVariations()

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => saveVariation(vectorDocument, params)}
        disabled={isBlankDocument(vectorDocument)}
        className="h-7 px-2.5 rounded-md text-xs text-sidebar-text bg-interactive-active hover:bg-interactive-hover hover:text-fg disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        Save current
      </button>

      {variations.length === 0 ? (
        <p className="text-xs text-sidebar-muted text-pretty px-1">
          Save a mark to come back to it later.
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
                onClick={() => {
                  openSaved(v)
                  onOpened?.()
                }}
                title="Open this mark. Undo brings the current one back."
                className="text-sidebar-text hover:text-fg truncate text-left flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised rounded-sm"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => removeVariation(v.id)}
                className="text-sidebar-muted hover:text-red-400 ml-2 px-1 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised rounded-sm"
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
