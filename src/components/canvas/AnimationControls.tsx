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
        'absolute bottom-4 left-4 inline-flex items-center gap-1.5',
        'h-8 px-3 rounded-lg text-xs font-medium',
        'bg-black/70 backdrop-blur-sm text-white/90 hover:bg-black/80 transition-colors',
        'border border-white/10',
      )}
    >
      <span className={cn('size-1.5 rounded-full', playing ? 'bg-emerald-400' : 'bg-neutral-500')} aria-hidden="true" />
      {playing ? 'Pause' : 'Play'}
    </button>
  )
}
