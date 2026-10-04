import { useMemo } from 'react'
import { PRESETS } from '../../store/presets.ts'
import { useLogoStore } from '../../store/logoStore.ts'

export function PresetSelector() {
  const modeId = useLogoStore((s) => s.params.modeId)
  const applyPreset = useLogoStore((s) => s.applyPreset)

  const presets = useMemo(
    () => PRESETS.filter((preset) => preset.modeId === modeId),
    [modeId],
  )

  if (presets.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => applyPreset(preset.params)}
          className="flex items-center justify-between h-8 px-2.5 rounded-md text-xs text-sidebar-text hover:bg-interactive-hover hover:text-fg group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          title={preset.description}
        >
          <span>{preset.name}</span>
          <span className="text-sidebar-muted capitalize text-[10px]">{preset.styleFamily}</span>
        </button>
      ))}
    </div>
  )
}
