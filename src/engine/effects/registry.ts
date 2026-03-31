import type { GenerationResult } from '../types.ts'

export interface EffectProcessor<P, R> {
  id: string
  process(result: GenerationResult, params: P): R | null
}

const registry = new Map<string, EffectProcessor<unknown, unknown>>()

export function registerEffect<P, R>(effect: EffectProcessor<P, R>): void {
  registry.set(effect.id, effect as EffectProcessor<unknown, unknown>)
}

export function getEffect(id: string): EffectProcessor<unknown, unknown> | undefined {
  return registry.get(id)
}
