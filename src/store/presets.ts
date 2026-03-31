import type { LogoParams } from '../engine/types.ts'

export interface Preset {
  id: string
  name: string
  description: string
  params: Partial<LogoParams>
}

export const PRESETS: Preset[] = [
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Delicate 6-fold crystal pattern',
    params: { seed: 142, gridRings: 4, symmetryFolds: 6, additiveRatio: 0.7, baseRadius: 0.4, radiusVariation: 0.5, rotation: 0 },
  },
  {
    id: 'starburst',
    name: 'Starburst',
    description: 'Dense radial explosion',
    params: { seed: 88, gridRings: 6, symmetryFolds: 8, additiveRatio: 0.85, baseRadius: 0.3, radiusVariation: 1.2, rotation: 0 },
  },
  {
    id: 'shield',
    name: 'Shield',
    description: 'Bold 4-fold symmetry with negative space',
    params: { seed: 303, gridRings: 3, symmetryFolds: 4, additiveRatio: 0.5, baseRadius: 0.7, radiusVariation: 0.2, rotation: 45 },
  },
  {
    id: 'bloom',
    name: 'Bloom',
    description: 'Organic petal arrangement',
    params: { seed: 567, gridRings: 3, symmetryFolds: 5, additiveRatio: 0.75, baseRadius: 0.6, radiusVariation: 0.8, rotation: 0 },
  },
  {
    id: 'monogram',
    name: 'Monogram',
    description: 'Minimal 2-fold mark',
    params: { seed: 21, gridRings: 2, symmetryFolds: 2, additiveRatio: 0.9, baseRadius: 0.5, radiusVariation: 0.3, rotation: 0 },
  },
  {
    id: 'mandala',
    name: 'Mandala',
    description: 'Complex layered circular pattern',
    params: { seed: 999, gridRings: 7, symmetryFolds: 12, additiveRatio: 0.65, baseRadius: 0.25, radiusVariation: 0.6, rotation: 15 },
  },
  {
    id: 'crown',
    name: 'Crown',
    description: 'Pointed 3-fold structure',
    params: { seed: 415, gridRings: 4, symmetryFolds: 3, additiveRatio: 0.6, baseRadius: 0.55, radiusVariation: 1.0, rotation: 0 },
  },
  {
    id: 'coin',
    name: 'Coin',
    description: 'Dense compact circle motif',
    params: { seed: 777, gridRings: 5, symmetryFolds: 10, additiveRatio: 0.8, baseRadius: 0.35, radiusVariation: 0.15, rotation: 0 },
  },
  {
    id: 'scatter',
    name: 'Scatter',
    description: 'Sparse asymmetric composition',
    params: { seed: 42, gridRings: 8, symmetryFolds: 1, additiveRatio: 0.55, baseRadius: 0.45, radiusVariation: 1.5, rotation: 0 },
  },
  {
    id: 'void',
    name: 'Void',
    description: 'Heavy subtraction, negative space focus',
    params: { seed: 256, gridRings: 5, symmetryFolds: 7, additiveRatio: 0.35, baseRadius: 0.5, radiusVariation: 0.4, rotation: 0 },
  },
]
