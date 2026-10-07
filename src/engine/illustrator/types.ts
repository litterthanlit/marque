import type { CarveSpec } from '../carve/spec.ts'
import type { Guide, ObjectLink } from '../vector/types.ts'

export type IllustratorMode = 'object' | 'points'

export interface IllustratorSource {
  seed: number
  modeId: string
  generatorId: string
  generatorVersion: string
}

export interface IllustratorTransform {
  dx: number
  dy: number
  scale: number
  rotation: number
}

export interface IllustratorLayer {
  id: string
  name: string
  sourceShapeId?: string
  operation: 'add' | 'subtract'
  visible: boolean
  locked: boolean
  pathData: string
  fillRule: 'nonzero' | 'evenodd'
  /** The identity in every view of a document. A layer from before the vector format may hold another, drawn as stage 1 drew it. */
  transform: IllustratorTransform
  /** Recipe for slabs and cuts; the path above is always generated from it. */
  carve?: CarveSpec
  /** How far a free shape's box is turned, in degrees. Missing is upright. */
  frameRotation?: number
  /** The group the object sits in. Missing is the root. */
  parentId?: string
  /** How many contours the path holds, when more than one: a hole is a further contour. */
  contourCount?: number
  /** The object whose centre the recipe's centre is pinned to. */
  pin?: string
  /** What the path is made from, when the follow pass makes it: an offset of another object. */
  link?: ObjectLink
}

/** A group of the document as the canvas reads it. Its members follow it in the layers. */
export interface IllustratorGroup {
  id: string
  name: string
  /** The group it sits in. Missing is the root. */
  parentId?: string
  visible: boolean
  locked: boolean
  /** Members compose alone and enter the stack as one input, with `operation`. */
  isolated: boolean
  operation: 'add' | 'subtract'
}

export interface PointSelection {
  layerId: string
  /** Which contour of the layer: 0 is its first. */
  contourIndex: number
  segmentIndex: number
  handle: 'anchor' | 'in' | 'out' | null
}

export interface IllustratorDocument {
  id: string
  source: IllustratorSource
  layers: IllustratorLayer[]
  selectedLayerIds: string[]
  pointSelection: PointSelection | null
  mode: IllustratorMode
  /** The document's groups, when it has any. */
  groups?: IllustratorGroup[]
  /** The document's guides, the very same array. Missing reads as none. */
  guides?: Guide[]
  /** The selected guides. A selection holds guides or layers, never both. */
  selectedGuideIds?: string[]
}

export interface MarkData {
  compoundPathData: string
  fillRule: 'nonzero' | 'evenodd'
  viewBox: { x: number; y: number; width: number; height: number }
  /** Boolean steps that failed, each input left out of the mark. Missing when none did. */
  warnings?: string[]
}

export const DEFAULT_ILLUSTRATOR_TRANSFORM: IllustratorTransform = {
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
}
