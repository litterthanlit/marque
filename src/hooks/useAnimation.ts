import { useRef, useEffect, useCallback, useState } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import type { AnimationKeyframe } from '../engine/animation/types.ts'
import { generateRadialKeyframes, interpolateKeyframe } from '../engine/animation/keyframes.ts'
import { SeededPRNG } from '../engine/random.ts'

export function useAnimation(
  onFrame: (keyframe: AnimationKeyframe) => void,
) {
  const params = useLogoStore((s) => s.params)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef(0)
  const keyframesRef = useRef<AnimationKeyframe[]>([])

  // Regenerate keyframes when params change
  useEffect(() => {
    const rng = new SeededPRNG(params.seed)
    keyframesRef.current = generateRadialKeyframes(params, rng)

    if (params.animationSpeed === 0) {
      setPlaying(false)
    }
  }, [params])

  const loop = useCallback((timestamp: number) => {
    if (!startTimeRef.current) startTimeRef.current = timestamp
    const elapsed = timestamp - startTimeRef.current
    const duration = 3000 / Math.max(0.1, params.animationSpeed)
    const t = (elapsed / duration) % 1

    const keyframe = interpolateKeyframe(keyframesRef.current, t)
    onFrame(keyframe)

    rafRef.current = requestAnimationFrame(loop)
  }, [onFrame, params.animationSpeed])

  useEffect(() => {
    if (playing && keyframesRef.current.length > 0) {
      startTimeRef.current = 0
      rafRef.current = requestAnimationFrame(loop)
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      // Reset to identity
      onFrame({ time: 0, rotation: 0, scale: 1, opacity: 1 })
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, loop, onFrame])

  const togglePlaying = useCallback(() => {
    if (params.animationSpeed === 0) return
    setPlaying((p) => !p)
  }, [params.animationSpeed])

  return { playing, togglePlaying, canAnimate: params.animationSpeed > 0 }
}
