import type { AnimationKeyframe } from './animation/types.ts'

export type StyleFamily =
  | 'minimal'
  | 'heritage'
  | 'luxe'
  | 'playful'
  | 'tech'

export interface BrandInput {
  initials?: string
}

export type ModeParamMap = Record<string, Record<string, number | string>>

export interface LogoParams {
  seed: number
  gridRings: number // 1-8
  additiveRatio: number // 0-1
  baseRadius: number // 0.1-1.0
  radiusVariation: number // 0-2
  rotation: number // 0-360
  symmetryFolds: number // 1-12
  fillColor: string // hex
  animationSpeed: number // 0 = static
  modeId: string
  styleFamily: StyleFamily
  brandInput: BrandInput
  generatorId: string
  modeParams: ModeParamMap
}

export interface PersistedLogoState {
  generatorVersion: string
  params: LogoParams
}

/**
 * All fields must be structured-clone safe (plain data only, no class
 * instances or functions) to allow future Web Worker migration.
 */
export interface ShapeNode {
  id: string
  type: 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'blob' | 'ellipse'
  role: 'prototype' | 'symmetry-instance'
  operation: 'add' | 'subtract'
  center: { x: number; y: number }
  radius: number
  rotation: number
  params: Record<string, number>
}

export interface CompositeLayer {
  id: string
  operation: 'add' | 'subtract'
  pathData: string
  fillRule: 'nonzero' | 'evenodd'
}

export interface ConstructionCircle {
  cx: number
  cy: number
  r: number
}

export interface ConstructionLine {
  x1: number
  y1: number
  x2: number
  y2: number
  kind: 'radial' | 'grid' | 'mirror' | 'frame'
}

/**
 * All fields must be structured-clone safe (plain strings, numbers, arrays,
 * and plain objects only) to allow future Web Worker migration.
 */
export interface GenerationResult {
  shapes: ShapeNode[]
  mark: {
    layers: CompositeLayer[]
    compoundPathData: string
    fillRule: 'nonzero' | 'evenodd'
    viewBox: { x: number; y: number; width: number; height: number }
  }
  constructionData: {
    gridCircles: ConstructionCircle[]
    guideLines: ConstructionLine[]
    stats: {
      totalShapes: number
      additiveCount: number
      subtractiveCount: number
      symmetryFolds: number
    }
  }
  warnings: string[]
}

export interface ParamDefinition {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface SeededRandom {
  next(): number
  nextInt(min: number, max: number): number
  nextFloat(min: number, max: number): number
  nextBool(probability?: number): boolean
}

export interface LogoGenerator {
  id: string
  modeId?: string
  name: string
  description: string
  version: string
  extraParams: ParamDefinition[]
  generate(params: LogoParams, rng: SeededRandom): GenerationResult
  getAnimationKeyframes?: (
    params: LogoParams,
    rng: SeededRandom,
  ) => AnimationKeyframe[]
}

export interface GridPoint {
  ring: number
  angle: number
  x: number
  y: number
  ringRadius: number
}

export const DEFAULT_PARAMS: LogoParams = {
  seed: 42,
  gridRings: 3,
  additiveRatio: 0.6,
  baseRadius: 0.5,
  radiusVariation: 0.3,
  rotation: 0,
  symmetryFolds: 6,
  fillColor: '#000000',
  animationSpeed: 0,
  modeId: 'geometric-radial',
  styleFamily: 'minimal',
  brandInput: {},
  generatorId: 'geometric-radial',
  modeParams: {},
}

export type { EffectParamsMap } from './effects/types.ts'
