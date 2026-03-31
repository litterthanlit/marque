import { useLogoStore } from '../../store/logoStore.ts'

export function ColorPicker() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-sidebar-text shrink-0">Color</label>
      <input
        type="color"
        value={fillColor}
        onChange={(e) => setParam('fillColor', e.target.value)}
        className="size-6 rounded border border-sidebar-border cursor-pointer bg-transparent"
      />
      <span className="text-xs font-mono text-sidebar-muted tabular-nums">{fillColor}</span>
    </div>
  )
}
