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
      className="absolute bottom-3 left-3 px-3 py-1.5 text-xs font-medium bg-white/90 border border-neutral-200 rounded-md hover:bg-white transition-colors shadow-sm"
    >
      {playing ? 'Pause' : 'Play'}
    </button>
  )
}
