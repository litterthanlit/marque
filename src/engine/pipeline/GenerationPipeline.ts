import type { LogoParams, GenerationResult } from '../types.ts'
import { SeededPRNG } from '../random.ts'
import { getGenerator } from '../generators/registry.ts'

export function generate(params: LogoParams): GenerationResult {
  const generator = getGenerator(params.generatorId)
  if (!generator) {
    throw new Error(`Unknown generator: ${params.generatorId}`)
  }

  const rng = new SeededPRNG(params.seed)
  return generator.generate(params, rng)
}
