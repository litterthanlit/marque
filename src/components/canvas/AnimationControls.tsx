import { cn } from '../../lib/utils.ts'

interface AnimationControlsProps {
  playing: boolean
  canAnimate: boolean
  onToggle: () => void
}

export function AnimationControls({ playing, canAnimate, onToggle }: AnimationControlsProps) {
  if (!canAnimate) return null

  return (
    <button
      onClick={onToggle}
      aria-pressed={playing}
      aria-label={playing ? 'Pause animation' : 'Play animation'}
      className={cn(
        'absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5',
        'h-7 px-2.5 rounded-md text-xs',
        'bg-neutral-900/80 text-white/90 hover:bg-neutral-900',
      )}
    >
      <span className={cn('size-1.5 rounded-full', playing ? 'bg-emerald-400' : 'bg-neutral-400')} aria-hidden="true" />
      {playing ? 'Pause' : 'Play'}
    </button>
  )
}
