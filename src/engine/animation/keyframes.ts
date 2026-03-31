import type { AnimationKeyframe } from './types.ts'
import type { LogoParams, SeededRandom } from '../types.ts'

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

export function generateModularKeyframes(
  params: LogoParams,
  rng: SeededRandom,
  frameCount = 60,
): AnimationKeyframe[] {
  const speed = params.animationSpeed
  if (speed === 0) return []

  const sway = rng.nextFloat(0.08, 0.22)
  const scaleAmplitude = rng.nextFloat(0.015, 0.04)
  const keyframes: AnimationKeyframe[] = []

  for (let i = 0; i <= frameCount; i++) {
    const t = i / frameCount
    keyframes.push({
      time: t,
      rotation: Math.sin(t * Math.PI * 2) * Math.PI * sway * speed,
      scale: 1 + Math.sin(t * Math.PI * 4) * scaleAmplitude * speed,
      opacity: 1,
    })
  }

  return keyframes
}

export function generateWaveArcKeyframes(
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
      rotation: Math.sin(t * Math.PI * 2) * Math.PI * 0.12 * speed,
      scale: 1 + Math.sin(t * Math.PI * 2) * 0.03 * speed,
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
