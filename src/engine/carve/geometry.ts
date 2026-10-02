import { carveOutline } from './outline.ts'
import { carveFromCut, carveLayerName, slabSpec } from './spec.ts'
import type { CarveToolKind, CutSpec, PunchShape, SlabKind } from './spec.ts'

export type { Vec } from '../path/bezier.ts'
export type { CutSpec, PunchShape, SlabKind } from './spec.ts'
export type CarveTool = CarveToolKind

export const SLAB_KINDS: Array<{ id: SlabKind; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'circle', label: 'Circle' },
  { id: 'tall', label: 'Tall' },
]

export const PUNCH_SHAPES: Array<{ id: PunchShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
]

/** Slab outline in layer space (centred on 0,0). */
export function slabPathData(kind: SlabKind): string {
  return carveOutline(slabSpec(kind)).pathData
}

export function cutPathData(spec: CutSpec): string {
  return carveOutline(carveFromCut(spec)).pathData
}

export function cutLayerName(spec: CutSpec): string {
  return carveLayerName(carveFromCut(spec))
}

/** Is a drag big enough to count as a cut? (A click on punch stamps a default size.) */
export function isMeaningfulCut(spec: CutSpec): boolean {
  if (spec.kind === 'punch') return spec.radius >= 4
  return Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y) >= 6
}
