import { useLogoStore } from '../../store/logoStore.ts'
import { MiniLogoPreview } from '../preview/MiniLogoPreview.tsx'
import { useSavedVariations } from '../../hooks/useSavedVariations.ts'

export function SavedVariationsRail() {
  const params = useLogoStore((s) => s.params)
  const applyPreset = useLogoStore((s) => s.applyPreset)
  const { variations, saveVariation, removeVariation } = useSavedVariations()

  return (
    <section className="flex flex-col gap-3 rounded-[28px] border border-neutral-200 bg-white/90 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-400">
            Saved variations
          </div>
          <div className="text-sm font-medium text-neutral-900">
            Keep the concepts worth revisiting
          </div>
        </div>
        <button
          type="button"
          onClick={() => saveVariation(params)}
          className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50"
        >
          Save current
        </button>
      </div>

      {variations.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-neutral-200 bg-neutral-50 px-4 py-5 text-sm leading-6 text-neutral-500">
          Save a logo concept and it will stay here as a reusable starting point.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {variations.map((variation) => (
            <div
              key={variation.id}
              className="grid grid-cols-[84px_1fr] gap-3 rounded-[22px] border border-neutral-200 bg-neutral-50/80 p-2"
            >
              <MiniLogoPreview
                params={variation.params}
                className="aspect-square min-h-[84px]"
              />
              <div className="flex min-w-0 flex-col justify-between py-1">
                <div>
                  <div className="text-sm font-medium text-neutral-900">
                    {variation.name}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-neutral-400">
                    {variation.params.modeId}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset(variation.params)}
                    className="rounded-full bg-neutral-900 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white transition hover:bg-neutral-700"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVariation(variation.id)}
                    className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
