import { useLogoStore } from '../../store/logoStore.ts'

export function ColorPicker() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] uppercase tracking-widest text-sidebar-muted shrink-0">Color</label>
      <div className="relative">
        <input
          type="color"
          value={fillColor}
          onChange={(e) => setParam('fillColor', e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <div
          className="size-8 rounded-lg border border-border"
          style={{ backgroundColor: fillColor }}
        />
      </div>
      <span className="text-xs font-mono text-sidebar-muted tabular-nums">{fillColor}</span>
    </div>
  )
}
