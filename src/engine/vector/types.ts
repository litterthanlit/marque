export type VectorDocumentKind = 'brand-vector' | 'font'
export type VectorWorkspaceMode = 'logo' | 'wordmark'

export interface Vec2 {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface VectorArtboard {
  id: string
  name: string
  rect: Rect
  background: string | null
}

export interface VectorPath {
  id: string
  closed: boolean
  segments: VectorPathSegment[]
}

export interface VectorPathSegment {
  point: Vec2
  handleIn: Vec2 | null
  handleOut: Vec2 | null
  pointType: 'corner' | 'smooth' | 'symmetric'
}

export type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: string }

export interface VectorAppearance {
  fill: Paint
  stroke: Paint
  strokeWidth: number
  strokeCap: 'butt' | 'round' | 'square'
  strokeJoin: 'miter' | 'round' | 'bevel'
  strokeMiterLimit: number
  strokeDashArray: number[]
  opacity: number
  blendMode: 'normal'
}

export interface VectorSourceRef {
  generatorId?: string
  generatorVersion?: string
  modeId?: string
  seed?: number
  sourceShapeId?: string
  paramsHash?: string
  convertedAt?: string
  compatOperation?: 'add' | 'subtract'
}

export interface VectorBaseObject {
  id: string
  type: VectorObject['type']
  name: string
  parentId: string | null
  artboardId: string
  visible: boolean
  locked: boolean
  transform: Matrix2D
  appearance: VectorAppearance
  source: VectorSourceRef | null
}

export interface PathObject extends VectorBaseObject {
  type: 'path'
  path: VectorPath
  fillRule: 'nonzero' | 'evenodd'
}

export interface ShapeObject extends VectorBaseObject {
  type: 'shape'
  shape:
    | { type: 'circle'; cx: number; cy: number; radius: number }
    | { type: 'rectangle'; x: number; y: number; width: number; height: number; cornerRadius: number }
    | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'polygon'; points: Vec2[] }
}

export interface TextObject extends VectorBaseObject {
  type: 'text'
  text: string
  box: Rect
  fontFamily: string
  fontSize: number
  fontWeight: number | string
  lineHeight: number
  letterSpacing: number
  textAlign: 'left' | 'center' | 'right'
}

export interface GroupObject extends Omit<VectorBaseObject, 'appearance'> {
  type: 'group'
  childIds: string[]
  appearance?: VectorAppearance
}

export type VectorObject = PathObject | ShapeObject | TextObject | GroupObject

export type VectorSelectionTarget =
  | { type: 'object'; objectId: string }
  | { type: 'anchor'; objectId: string; segmentIndex: number }
  | { type: 'handle'; objectId: string; segmentIndex: number; handle: 'in' | 'out' }

export interface VectorSelection {
  targets: VectorSelectionTarget[]
}

export interface VectorDocumentSource {
  seed: number
  modeId: string
  generatorId: string
  generatorVersion: string
  paramsHash: string
  convertedAt: string
}

export interface VectorDocument {
  schemaVersion: 1
  id: string
  kind: VectorDocumentKind
  activeMode: VectorWorkspaceMode
  name: string
  artboards: VectorArtboard[]
  objects: VectorObject[]
  selection: VectorSelection
  source: VectorDocumentSource | null
  createdAt: string
  updatedAt: string
}
