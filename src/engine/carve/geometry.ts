import { carveOutline } from './outline.ts'
import { carveFromCut, carveLayerName, polygonSpec, POLYGON_SLAB_RADIUS, slabSpec } from './spec.ts'
import type { CarveToolKind, CutSpec, PolygonSpec, PunchShape, SlabKind, SlabSpec } from './spec.ts'
import type { Vec } from '../path/bezier.ts'

export type { Vec } from '../path/bezier.ts'
export type { CutSpec, PunchShape, SlabKind } from './spec.ts'
export type CarveTool = CarveToolKind

/** What the slab row adds: a slab preset, or a polygon. */
export type SlabEntry = SlabKind | 'polygon'

/** What the punch cuts: a punch shape, or a polygon, which is a polygon recipe that cuts. */
export type PunchToolShape = PunchShape | 'polygon'

export const SLAB_KINDS: Array<{ id: SlabEntry; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'circle', label: 'Circle' },
  { id: 'tall', label: 'Tall' },
  { id: 'polygon', label: 'Polygon' },
]

export const PUNCH_SHAPES: Array<{ id: PunchToolShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'polygon', label: 'Polygon' },
]

/**
 * The recipe an entry of the slab row adds, centred on `center`, at `size`
 * times its full size: a slab preset, or a polygon of `sides` as wide as the
 * circle slab.
 */
export function slabEntrySpec(entry: SlabEntry, sides: number, center: Vec = { x: 0, y: 0 }, size = 1): SlabSpec | PolygonSpec {
  if (entry === 'polygon') return polygonSpec(center, POLYGON_SLAB_RADIUS * size, sides)
  return slabSpec(entry, center, size)
}

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
  switch (spec.kind) {
    case 'punch':
    case 'polygon':
      return spec.radius >= 4
    case 'channel':
    case 'slice':
      return Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y) >= 6
    default:
      return spec satisfies never
  }
}
