import { PRESETS } from '../../store/presets.ts'
import { useLogoStore } from '../../store/logoStore.ts'

export function PresetSelector() {
  const applyPreset = useLogoStore((s) => s.applyPreset)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Presets
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => applyPreset(preset.params)}
            className="px-2 py-1.5 text-xs text-left border border-neutral-200 rounded-md hover:bg-neutral-100 transition-colors"
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  )
}
