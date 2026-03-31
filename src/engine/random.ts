import seedrandom from 'seedrandom'
import type { SeededRandom } from './types.ts'

export class SeededPRNG implements SeededRandom {
  private rng: () => number

  constructor(seed: number | string) {
    this.rng = seedrandom(String(seed))
  }

  next(): number {
    return this.rng()
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min
  }

  nextFloat(min: number, max: number): number {
    return this.rng() * (max - min) + min
  }

  nextBool(probability = 0.5): boolean {
    return this.rng() < probability
  }
}
