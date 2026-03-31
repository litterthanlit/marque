import { useLogoStore } from '../../store/logoStore.ts'

export function ColorPicker() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Fill Color
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={fillColor}
          onChange={(e) => setParam('fillColor', e.target.value)}
          className="w-8 h-8 rounded border border-neutral-200 cursor-pointer"
        />
        <span className="text-xs font-mono text-neutral-400">{fillColor}</span>
      </div>
    </div>
  )
}
