import { useLogoStore } from '../../store/logoStore.ts'

export function EmptyHint() {
  const empty = useLogoStore((s) => (s.illustrator?.layers.length ?? 0) === 0)
  const idle = useLogoStore((s) => s.ui.activeTool === null)
  if (!empty || !idle) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
      <p role="note" className="text-center font-display text-[18px] text-paper-muted">
        Add a slab or draw with the pen to start.
      </p>
    </div>
  )
}
