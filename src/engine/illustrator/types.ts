export type ActiveSurface = 'generated' | 'illustrator'
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
  transform: IllustratorTransform
}

export interface PointSelection {
  layerId: string
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
}

export interface MarkData {
  compoundPathData: string
  fillRule: 'nonzero' | 'evenodd'
  viewBox: { x: number; y: number; width: number; height: number }
}

export const DEFAULT_ILLUSTRATOR_TRANSFORM: IllustratorTransform = {
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
}
