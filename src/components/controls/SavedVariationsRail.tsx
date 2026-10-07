import { useLogoStore } from '../../store/logoStore.ts'
import { useSavedVariations } from '../../hooks/useSavedVariations.ts'
import { isBlankDocument } from '../../engine/vector/document.ts'
import { EditorButton } from '../editor/controls.tsx'

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
      <EditorButton onClick={() => saveVariation(vectorDocument, params)} disabled={isBlankDocument(vectorDocument)} className="w-full">
        Save current
      </EditorButton>

      {variations.length === 0 ? (
        <p className="px-1 text-xs text-pretty text-muted">
          Save a mark to come back to it later.
        </p>
      ) : (
        // A list set into the plate, as the drawer's are.
        <div className="flex flex-col rounded-[10px] bg-surface p-0.5 shadow-(--device-recess)">
          {variations.map((v) => (
            <div
              key={v.id}
              className="group flex h-8 items-center justify-between rounded-[8px] px-2.5 text-xs transition-colors duration-(--duration-exit) hover:bg-black/[0.045] hover:duration-(--duration-enter) dark:hover:bg-white/[0.06]"
            >
              <button
                type="button"
                onClick={() => {
                  openSaved(v)
                  onOpened?.()
                }}
                title="Open this mark. Undo brings the current one back."
                data-sound="soft"
                className="min-w-0 flex-1 truncate rounded-sm text-left text-ink outline-offset-2"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => removeVariation(v.id)}
                data-sound="soft"
                className="ml-2 shrink-0 rounded-sm px-1 text-muted outline-offset-2 transition-colors duration-(--duration-exit) hover:text-danger hover:duration-(--duration-enter)"
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
