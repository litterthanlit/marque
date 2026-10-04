import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'

export function PaletteTile() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  return (
    <section
      aria-label="Palette"
      className={cn(
        'bg-paper border border-paper-line rounded-lg overflow-hidden',
        'flex items-center gap-3 p-3',
      )}
    >
      {/* Swatch + hidden native color picker */}
      <div
        className={cn(
          'relative size-10 rounded-md border border-paper-line shrink-0',
          'focus-within:ring-2 focus-within:ring-[color:var(--color-selection)]',
          'focus-within:ring-offset-2 focus-within:ring-offset-paper',
        )}
        style={{ backgroundColor: fillColor }}
      >
        <input
          type="color"
          value={fillColor}
          onChange={(e) => setParam('fillColor', e.target.value)}
          aria-label="Pick fill color"
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.14em] text-paper-muted">
          Palette
        </span>
        <span className="font-mono-tabular text-[12px] text-paper-ink">
          {fillColor.toLowerCase()}
        </span>
      </div>
    </section>
  )
}
