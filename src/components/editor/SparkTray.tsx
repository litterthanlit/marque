import { useEffect, useState } from 'react'
import { rollSparks, type Spark } from '../../engine/sparks/sparks.ts'
import { CONSTRUCTION } from '../../renderer/IllustratorRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'
import { EditorButton, FOCUS_RING } from './controls.tsx'
import { SHUFFLE_SHORTCUT } from './tools.ts'

const TRAY_SIZE = 8
const SLOTS = Array.from({ length: TRAY_SIZE }, (_, slot) => slot)
const TILE = 'size-10 shrink-0 rounded-lg sm:size-12'

interface Deal {
  seed: number
  sparks: Spark[]
}

// A roll takes tens of milliseconds. The last one is kept, so the same seed is never rolled twice in a row.
let lastDeal: Deal | null = null

function deal(seed: number): Deal {
  if (lastDeal?.seed !== seed) lastDeal = { seed, sparks: rollSparks(TRAY_SIZE, seed) }
  return lastDeal
}

/** Runs the job once the browser has painted the frame it was asked in. Returns a cancel. */
function afterPaint(job: () => void): () => void {
  let timer: number | undefined
  const frame = requestAnimationFrame(() => {
    timer = window.setTimeout(job, 0)
  })
  return () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
  }
}

export function SparkTray() {
  const seed = useLogoStore((s) => s.ui.sparkSeed)
  const shuffleSparks = useLogoStore((s) => s.shuffleSparks)
  // Trails the seed while the next set is rolled, so a shuffle swaps the set and never blanks it.
  const [shown, setShown] = useState<Deal | null>(lastDeal)

  useEffect(() => afterPaint(() => setShown(deal(seed))), [seed])

  return (
    <div className="flex h-12 items-center gap-2 px-3 sm:h-16 sm:justify-center sm:gap-3 sm:px-5">
      <span aria-hidden="true" className="text-[10px] uppercase tracking-widest text-sidebar-text max-sm:hidden">
        Sparks
      </span>
      {/* The padding keeps a focus ring inside the scrolling box, which would clip it. On a phone the row
          scrolls: its end fades out to say there is more, and the last tile scrolls clear of the fade. */}
      <div
        role="group"
        aria-label="Sparks"
        aria-busy={shown?.seed !== seed}
        className={cn(
          'flex min-w-0 items-center gap-1.5 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'max-sm:flex-1 max-sm:pr-6 max-sm:mask-r-from-[calc(100%-1.5rem)]',
        )}
      >
        {shown
          ? shown.sparks.map((spark, slot) => <SparkButton key={spark.id} spark={spark} slot={slot} />)
          : SLOTS.map((slot) => <span key={slot} aria-hidden="true" className={cn(TILE, 'bg-interactive')} />)}
      </div>
      <EditorButton onClick={shuffleSparks} title={`Deal eight new sparks (${SHUFFLE_SHORTCUT})`}>
        Shuffle
      </EditorButton>
    </div>
  )
}

/** A small sheet in the construction look: what the canvas will show once the spark is dropped. */
function SparkButton({ spark, slot }: { spark: Spark; slot: number }) {
  const dropSpark = useLogoStore((s) => s.dropSpark)
  const { viewBox, compoundPathData, fillRule } = spark.mark

  return (
    <button
      type="button"
      aria-label={`Add spark ${slot + 1}`}
      title="Add this spark to the canvas"
      onClick={() => dropSpark(spark)}
      className={cn(
        TILE,
        'border border-border bg-white p-1.5 transition-transform hover:-translate-y-px active:translate-y-0 active:scale-95',
        'motion-reduce:transform-none motion-reduce:transition-none',
        FOCUS_RING,
      )}
    >
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="size-full overflow-visible"
        aria-hidden="true"
      >
        <path
          d={compoundPathData}
          fillRule={fillRule}
          fill={CONSTRUCTION.fill}
          stroke={CONSTRUCTION.outline.color}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </button>
  )
}
