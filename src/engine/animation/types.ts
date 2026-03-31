export interface AnimationKeyframe {
  time: number // 0-1 normalized
  rotation: number // radians
  scale: number
  opacity: number
}

export interface AnimationConfig {
  duration: number // ms
  keyframes: AnimationKeyframe[]
  loop: boolean
}
