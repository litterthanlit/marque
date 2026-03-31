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
      className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded bg-neutral-900/80 backdrop-blur-sm px-2.5 py-1 text-[11px] text-white/80 hover:text-white transition-colors"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${playing ? 'bg-green-400' : 'bg-neutral-400'}`} aria-hidden="true" />
      {playing ? 'Pause' : 'Play'}
    </button>
  )
}
