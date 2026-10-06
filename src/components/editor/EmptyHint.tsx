import { useLogoStore } from '../../store/logoStore.ts'
import { isBlankDocument } from '../../engine/vector/document.ts'

export function EmptyHint() {
  // Guides are something drawn: the hint never lies over them.
  const empty = useLogoStore((s) => isBlankDocument(s.vectorDocument))
  const idle = useLogoStore((s) => s.ui.activeTool === null)
  if (!empty || !idle) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
      <p role="note" className="text-center font-display text-[18px] text-paper-muted">
        Add a slab, draw with the pen, or pick a spark below.
      </p>
    </div>
  )
}
