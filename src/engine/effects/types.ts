export interface DissolutionParams {
  enabled: boolean
  threshold: number       // 0-1 (0 = fully solid, 1 = fully dissolved)
  cellSize: number        // 4-32 px
  shape: 'square' | 'circle'
  scatter: number         // 0-1
  sizeVariation: number   // 0-1
}

export interface EffectMark {
  compoundPathData: string
  fillRule: 'nonzero' | 'evenodd'
  viewBox: { x: number; y: number; width: number; height: number }
}

export interface EffectSource {
  mark: EffectMark
}

export interface DissolutionCell {
  x: number
  y: number
  width: number
  height: number
  distance: number        // 0-1 normalized distance from edge
  revealRank: number      // animation ordering (0 = first to appear)
  shape: 'square' | 'circle'
}

export interface DissolutionResult {
  particlePathData: string
  solidCorePath: string | null
  cells: DissolutionCell[]
  viewBox: { x: number; y: number; width: number; height: number }
}

export const DEFAULT_DISSOLUTION_PARAMS: DissolutionParams = {
  enabled: false,
  threshold: 0.5,
  cellSize: 12,
  shape: 'square',
  scatter: 0,
  sizeVariation: 0.3,
}

/**
 * Imperfection: redraws the mark's outline as if it were cut or printed by
 * hand. Amounts are 0-1 and scale with the mark's size.
 */
export interface ImperfectionParams {
  enabled: boolean
  wobble: number          // 0-1: slow drift of the hand along each edge
  grain: number           // 0-1: fine ragged edge, like ink on paper
  soften: number          // 0-1: ink spread that rounds sharp corners
  seed: number            // which "hand": same seed, same drawing
}

export const DEFAULT_IMPERFECTION_PARAMS: ImperfectionParams = {
  enabled: false,
  wobble: 0.6,
  grain: 0.4,
  soften: 0.45,
  seed: 1,
}

export type EffectParamsMap = {
  dissolution: DissolutionParams
  imperfection: ImperfectionParams
}
