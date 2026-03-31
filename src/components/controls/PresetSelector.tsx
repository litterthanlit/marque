import { useMemo } from 'react'
import { DEFAULT_PARAMS } from '../../engine/types.ts'
import type { LogoParams } from '../../engine/types.ts'
import { getAllModeParamDefaults } from '../../store/modes.ts'
import { PRESETS } from '../../store/presets.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { MiniLogoPreview } from '../preview/MiniLogoPreview.tsx'

export function PresetSelector() {
  const modeId = useLogoStore((s) => s.params.modeId)
  const applyPreset = useLogoStore((s) => s.applyPreset)

  const presets = useMemo(
    () => PRESETS.filter((preset) => preset.modeId === modeId),
    [modeId],
  )

  return (
    <section className="flex flex-col gap-3 rounded-[28px] border border-neutral-200 bg-white/90 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-400">
            Presets
          </div>
          <div className="text-sm font-medium text-neutral-900">
            Starting points for this mode
          </div>
        </div>
        <div className="text-[11px] text-neutral-400">
          {presets.length} curated looks
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset.params)}
            className="group grid grid-cols-[88px_1fr] gap-3 rounded-[22px] border border-neutral-200 bg-neutral-50/80 p-2 text-left transition hover:border-neutral-300 hover:bg-white"
            title={preset.description}
          >
            <MiniLogoPreview
              params={applyModePresetDefaults(preset.params)}
              className="aspect-square min-h-[88px]"
            />
            <div className="flex min-w-0 flex-col justify-between py-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-900">
                    {preset.name}
                  </span>
                  <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    {preset.styleFamily}
                  </span>
                </div>
                <p className="text-xs leading-5 text-neutral-500">
                  {preset.description}
                </p>
              </div>
              <span className="mt-3 text-[11px] uppercase tracking-[0.22em] text-neutral-400 transition group-hover:text-neutral-700">
                Apply preset
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function applyModePresetDefaults(params: Partial<LogoParams>): LogoParams {
  const nextModeParams = {
    ...getAllModeParamDefaults(),
    ...(params.modeParams ?? {}),
  }

  return {
    ...DEFAULT_PARAMS,
    ...params,
    modeParams: nextModeParams,
  }
}
