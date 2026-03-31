import type { AnimationKeyframe } from './types.ts'
import type { LogoParams, SeededRandom } from '../types.ts'

/**
 * Generates animation keyframes for the geometric radial generator.
 * Rotation speed and scale pulsing based on animationSpeed param.
 */
export function generateRadialKeyframes(
  params: LogoParams,
  _rng: SeededRandom,
  frameCount = 60,
): AnimationKeyframe[] {
  const speed = params.animationSpeed
  if (speed === 0) return []

  const keyframes: AnimationKeyframe[] = []
  for (let i = 0; i <= frameCount; i++) {
    const t = i / frameCount
    keyframes.push({
      time: t,
      rotation: t * Math.PI * 2 * speed * 0.5,
      scale: 1 + Math.sin(t * Math.PI * 2) * speed * 0.05,
      opacity: 1,
    })
  }

  return keyframes
}

/**
 * Interpolates between keyframes at a given normalized time (0-1).
 */
export function interpolateKeyframe(
  keyframes: AnimationKeyframe[],
  t: number,
): AnimationKeyframe {
  if (keyframes.length === 0) return { time: t, rotation: 0, scale: 1, opacity: 1 }
  if (keyframes.length === 1) return keyframes[0]

  const normalizedT = t % 1

  let i = 0
  while (i < keyframes.length - 1 && keyframes[i + 1].time <= normalizedT) {
    i++
  }

  if (i >= keyframes.length - 1) return keyframes[keyframes.length - 1]

  const a = keyframes[i]
  const b = keyframes[i + 1]
  const segmentT = (normalizedT - a.time) / (b.time - a.time)

  return {
    time: normalizedT,
    rotation: a.rotation + (b.rotation - a.rotation) * segmentT,
    scale: a.scale + (b.scale - a.scale) * segmentT,
    opacity: a.opacity + (b.opacity - a.opacity) * segmentT,
  }
}
