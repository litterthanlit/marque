import { useEffect, useMemo, useRef } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import type { MarkData } from '../../engine/illustrator/types.ts'
import { checkSurvival, SURVIVAL_SIZES, type SurvivalResult, type SurvivalSize } from '../../engine/carve/survival.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'
import { cn } from '../../lib/utils.ts'
import { TOOLBAR_PANEL, ToolbarButton } from '../layout/ToolbarButton.tsx'
import { Segmented, SwitchButton } from './controls.tsx'
import { Popover } from './Popover.tsx'

interface Verdict {
  tone: 'empty' | 'holds' | 'weak'
  text: string
}

const DOT: Record<Verdict['tone'], string> = {
  empty: 'bg-neutral-600',
  holds: 'bg-emerald-400',
  weak: 'bg-rose-500',
}

const SIZE_OPTIONS = SURVIVAL_SIZES.map((size) => ({ value: size, label: `${size}px` }))

function verdictOf(survival: SurvivalResult | null, size: SurvivalSize): Verdict {
  if (!survival) return { tone: 'empty', text: 'Nothing to check yet.' }
  if (survival.weakRatio > 0) {
    const percent = Math.max(1, Math.round(survival.weakRatio * 100))
    return {
      tone: 'weak',
      text: `About ${percent}% of the ink is too thin to show at ${size}px. Widen the walls marked in pink.`,
    }
  }
  return { tone: 'holds', text: `Every wall holds up at ${size}px.` }
}

export function SurvivalPopover() {
  const carve = useLogoStore((s) => s.ui.carve)
  const setCarveSettings = useLogoStore((s) => s.setCarveSettings)
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const mark = useActiveMark()
  const survival = useMemo(() => checkSurvival(mark, carve.survivalSize), [mark, carve.survivalSize])
  const verdict = verdictOf(survival, carve.survivalSize)

  return (
    <Popover
      label="Survival check"
      className="sm:relative"
      panelClassName={cn(TOOLBAR_PANEL, 'flex flex-col gap-2.5')}
      trigger={(props) => (
        <ToolbarButton {...props} aria-label={`Survival check. ${verdict.text}`} title={`Survival check. ${verdict.text}`}>
          <span aria-hidden="true" className={cn('size-2 rounded-full', DOT[verdict.tone])} />
          <span className="ml-1.5 max-sm:hidden">Survival</span>
        </ToolbarButton>
      )}
    >
      <div className="text-[10px] uppercase tracking-widest text-sidebar-muted">Survival check</div>
      <div className="flex items-end gap-3" role="group" aria-label="Mark at actual size">
        {SURVIVAL_SIZES.map((size) => (
          <figure key={size} className="m-0 flex flex-col items-center gap-1">
            <SizePreview mark={mark} size={size} color={fillColor} />
            <figcaption className="text-[10px] font-mono-tabular text-sidebar-muted">{size}px</figcaption>
          </figure>
        ))}
      </div>
      <div>
        <div className="mb-1.5 text-xs text-sidebar-text">Smallest size it must hold up at</div>
        <Segmented
          label="Smallest size in pixels"
          options={SIZE_OPTIONS}
          value={carve.survivalSize}
          onChange={(survivalSize) => setCarveSettings({ survivalSize })}
          className="font-mono-tabular"
        />
      </div>
      <SwitchButton
        label="Show weak spots on canvas"
        checked={carve.showWeakSpots}
        onChange={(showWeakSpots) => setCarveSettings({ showWeakSpots })}
      />
      <p className="flex items-start gap-2 text-xs text-sidebar-text" aria-live="polite">
        <span aria-hidden="true" className={cn('mt-1 size-2 shrink-0 rounded-full', DOT[verdict.tone])} />
        {verdict.text}
      </p>
    </Popover>
  )
}

function SizePreview({ mark, size, color }: { mark: MarkData | null; size: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size * ratio)
    canvas.height = Math.round(size * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!mark?.compoundPathData) return
    const { x, y, width, height } = mark.viewBox
    const longest = Math.max(width, height)
    if (longest <= 0) return
    // Fill the tile edge to edge, the way an app icon or favicon would.
    const scale = (size * ratio) / longest
    ctx.setTransform(scale, 0, 0, scale, -(x + width / 2 - longest / 2) * scale, -(y + height / 2 - longest / 2) * scale)
    ctx.fillStyle = color
    ctx.fill(new Path2D(mark.compoundPathData), mark.fillRule)
  }, [mark, size, color])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Mark at ${size} pixels`}
      className="rounded-[3px] bg-white"
      style={{ width: size, height: size }}
    />
  )
}
