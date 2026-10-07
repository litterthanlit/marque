import { useLogoStore } from '../../store/logoStore.ts'
import { isBlankDocument } from '../../engine/vector/document.ts'

export function EmptyHint() {
  // Guides are something drawn: the hint never lies over them.
  const empty = useLogoStore((s) => isBlankDocument(s.vectorDocument))
  const idle = useLogoStore((s) => s.ui.activeTool === null)
  if (!empty || !idle) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
      {/* On the sheet, which is white in both themes: its grey holds 4.9:1 there. */}
      <p role="note" className="animate-enter text-balance text-center text-lead font-medium tracking-[-0.015em] text-[#707070]">
        Add a slab, draw with the pen, or pick a spark below.
      </p>
    </div>
  )
}
