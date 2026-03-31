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
      title={playing ? 'Pause animation' : 'Play animation'}
      className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white/90 px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-neutral-900/70" aria-hidden="true" />
      {playing ? 'Pause' : 'Play'}
    </button>
  )
}
