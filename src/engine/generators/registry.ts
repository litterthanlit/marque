import type { LogoGenerator } from '../types.ts'
import { GeometricRadialGenerator } from './GeometricRadialGenerator.ts'
import { GridSystemGenerator } from './GridSystemGenerator.ts'
import { MonogramGenerator } from './MonogramGenerator.ts'
import { ModularGenerator } from './ModularGenerator.ts'
import { WaveArcGenerator } from './WaveArcGenerator.ts'

const registry = new Map<string, LogoGenerator>()

export function registerGenerator(generator: LogoGenerator): void {
  registry.set(generator.id, generator)
}

export function getGenerator(id: string): LogoGenerator | undefined {
  return registry.get(id)
}

export function listGenerators(): LogoGenerator[] {
  return Array.from(registry.values())
}

// Register built-in generators
registerGenerator(GeometricRadialGenerator)
registerGenerator(GridSystemGenerator)
registerGenerator(MonogramGenerator)
registerGenerator(ModularGenerator)
registerGenerator(WaveArcGenerator)
