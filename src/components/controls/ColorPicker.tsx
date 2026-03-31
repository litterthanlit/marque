import { useLogoStore } from '../../store/logoStore.ts'

export function ColorPicker() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-neutral-500 uppercase tracking-[0.15em]">Color</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={fillColor}
          onChange={(e) => setParam('fillColor', e.target.value)}
          className="w-6 h-6 rounded border border-neutral-700 cursor-pointer bg-transparent"
        />
        <span className="text-[11px] font-mono text-neutral-500">{fillColor}</span>
      </div>
    </div>
  )
}
