import type { CarveSpec } from '../carve/spec.ts'
import type { Rect, VectorArtboard, VectorDocumentKind, VectorDocumentSource, VectorWorkspaceMode, Vec2 } from './types.ts'

/**
 * Schema version 1, frozen as stage 1 wrote it. Nothing writes it any more:
 * it is read from old links and saved marks, checked by the validator below
 * and upgraded by `migrate.ts`. The `#i=` importer still builds it first.
 */

export interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface VectorPathV1 {
  id: string
  closed: boolean
  segments: VectorPathSegmentV1[]
}

export interface VectorPathSegmentV1 {
  point: Vec2
  handleIn: Vec2 | null
  handleOut: Vec2 | null
  pointType: 'corner' | 'smooth' | 'symmetric'
}

export type PaintV1 =
  | { type: 'none' }
  | { type: 'solid'; color: string }

export interface VectorAppearanceV1 {
  fill: PaintV1
  stroke: PaintV1
  strokeWidth: number
  strokeCap: 'butt' | 'round' | 'square'
  strokeJoin: 'miter' | 'round' | 'bevel'
  strokeMiterLimit: number
  strokeDashArray: number[]
  opacity: number
  blendMode: 'normal'
}

export interface VectorSourceRefV1 {
  generatorId?: string
  generatorVersion?: string
  modeId?: string
  seed?: number
  sourceShapeId?: string
  paramsHash?: string
  convertedAt?: string
  compatOperation?: 'add' | 'subtract'
}

export interface VectorBaseObjectV1 {
  id: string
  type: VectorObjectV1['type']
  name: string
  parentId: string | null
  artboardId: string
  visible: boolean
  locked: boolean
  transform: Matrix2D
  appearance: VectorAppearanceV1
  source: VectorSourceRefV1 | null
}

export interface PathObjectV1 extends VectorBaseObjectV1 {
  type: 'path'
  path: VectorPathV1
  fillRule: 'nonzero' | 'evenodd'
  carve?: CarveSpec
  frame?: { rotation: number }
}

export interface ShapeObjectV1 extends VectorBaseObjectV1 {
  type: 'shape'
  shape:
    | { type: 'circle'; cx: number; cy: number; radius: number }
    | { type: 'rectangle'; x: number; y: number; width: number; height: number; cornerRadius: number }
    | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'polygon'; points: Vec2[] }
}

export interface TextObjectV1 extends VectorBaseObjectV1 {
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

export interface GroupObjectV1 extends Omit<VectorBaseObjectV1, 'appearance'> {
  type: 'group'
  childIds: string[]
  appearance?: VectorAppearanceV1
}

export type VectorObjectV1 = PathObjectV1 | ShapeObjectV1 | TextObjectV1 | GroupObjectV1

export type VectorSelectionTargetV1 =
  | { type: 'object'; objectId: string }
  | { type: 'anchor'; objectId: string; segmentIndex: number }
  | { type: 'handle'; objectId: string; segmentIndex: number; handle: 'in' | 'out' }

export interface VectorDocumentV1 {
  schemaVersion: 1
  id: string
  kind: VectorDocumentKind
  activeMode: VectorWorkspaceMode
  name: string
  artboards: VectorArtboard[]
  objects: VectorObjectV1[]
  selection: { targets: VectorSelectionTargetV1[] }
  source: VectorDocumentSource | null
  createdAt: string
  updatedAt: string
}

export const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function isIdentityMatrix(m: Matrix2D): boolean {
  const near = (v: number, target: number) => Math.abs(v - target) < 1e-9
  return near(m.a, 1) && near(m.b, 0) && near(m.c, 0) && near(m.d, 1) && near(m.e, 0) && near(m.f, 0)
}

export function createDefaultAppearanceV1(fillColor = '#111111'): VectorAppearanceV1 {
  return {
    fill: { type: 'solid', color: fillColor },
    stroke: { type: 'none' },
    strokeWidth: 0,
    strokeCap: 'butt',
    strokeJoin: 'miter',
    strokeMiterLimit: 4,
    strokeDashArray: [],
    opacity: 1,
    blendMode: 'normal',
  }
}

/* ─── The version 1 validator, as stage 1 shipped it ─── */

export function isVectorDocumentV1(value: unknown): value is VectorDocumentV1 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VectorDocumentV1> & Record<string, unknown>
  return (
    candidate.schemaVersion === 1 &&
    candidate.kind === 'brand-vector' &&
    (candidate.activeMode === 'logo' || candidate.activeMode === 'wordmark') &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.artboards) &&
    candidate.artboards.length > 0 &&
    candidate.artboards.every(isVectorArtboard) &&
    Array.isArray(candidate.objects) &&
    candidate.objects.every(isVectorObject) &&
    isVectorSelection(candidate.selection)
  )
}

function isVectorSelection(value: unknown): value is VectorDocumentV1['selection'] {
  if (!isRecord(value) || !Array.isArray(value.targets)) return false
  return value.targets.every(isVectorSelectionTarget)
}

function isVectorSelectionTarget(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.type === 'object') return typeof value.objectId === 'string'
  if (value.type === 'anchor') {
    return typeof value.objectId === 'string' && isNonNegativeInteger(value.segmentIndex)
  }
  if (value.type === 'handle') {
    return (
      typeof value.objectId === 'string' &&
      isNonNegativeInteger(value.segmentIndex) &&
      (value.handle === 'in' || value.handle === 'out')
    )
  }
  return false
}

function isVectorArtboard(value: unknown): value is VectorArtboard {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRect(value.rect) &&
    (typeof value.background === 'string' || value.background === null)
  )
}

function isVectorObject(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !(typeof value.parentId === 'string' || value.parentId === null) ||
    typeof value.artboardId !== 'string' ||
    typeof value.visible !== 'boolean' ||
    typeof value.locked !== 'boolean' ||
    !isMatrix(value.transform) ||
    !(isRecord(value.source) || value.source === null)
  ) {
    return false
  }

  if (value.type === 'group') {
    return Array.isArray(value.childIds) && value.childIds.every((id) => typeof id === 'string')
  }

  if (!isVectorAppearance(value.appearance)) return false

  if (value.type === 'path') {
    return (
      isVectorPath(value.path) &&
      (value.fillRule === 'nonzero' || value.fillRule === 'evenodd')
    )
  }

  if (value.type === 'shape') return isVectorShape(value.shape)

  if (value.type === 'text') {
    return (
      typeof value.text === 'string' &&
      isRect(value.box) &&
      typeof value.fontFamily === 'string' &&
      isFiniteNumber(value.fontSize) &&
      (typeof value.fontWeight === 'string' || isFiniteNumber(value.fontWeight)) &&
      isFiniteNumber(value.lineHeight) &&
      isFiniteNumber(value.letterSpacing) &&
      (value.textAlign === 'left' || value.textAlign === 'center' || value.textAlign === 'right')
    )
  }

  return false
}

function isVectorPath(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.closed === 'boolean' &&
    Array.isArray(value.segments) &&
    value.segments.every(isVectorPathSegment)
  )
}

function isVectorPathSegment(value: unknown): boolean {
  return (
    isRecord(value) &&
    isVec2(value.point) &&
    (isVec2(value.handleIn) || value.handleIn === null) &&
    (isVec2(value.handleOut) || value.handleOut === null) &&
    (value.pointType === 'corner' || value.pointType === 'smooth' || value.pointType === 'symmetric')
  )
}

function isVectorShape(value: unknown): boolean {
  if (!isRecord(value)) return false

  if (value.type === 'circle') {
    return isFiniteNumber(value.cx) && isFiniteNumber(value.cy) && isFiniteNumber(value.radius)
  }

  if (value.type === 'rectangle') {
    return (
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isFiniteNumber(value.width) &&
      isFiniteNumber(value.height) &&
      isFiniteNumber(value.cornerRadius)
    )
  }

  if (value.type === 'ellipse') {
    return (
      isFiniteNumber(value.cx) &&
      isFiniteNumber(value.cy) &&
      isFiniteNumber(value.rx) &&
      isFiniteNumber(value.ry)
    )
  }

  if (value.type === 'polygon') {
    return Array.isArray(value.points) && value.points.every(isVec2)
  }

  return false
}

function isVectorAppearance(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPaint(value.fill) &&
    isPaint(value.stroke) &&
    isFiniteNumber(value.strokeWidth) &&
    (value.strokeCap === 'butt' || value.strokeCap === 'round' || value.strokeCap === 'square') &&
    (value.strokeJoin === 'miter' || value.strokeJoin === 'round' || value.strokeJoin === 'bevel') &&
    isFiniteNumber(value.strokeMiterLimit) &&
    Array.isArray(value.strokeDashArray) &&
    value.strokeDashArray.every(isFiniteNumber) &&
    isFiniteNumber(value.opacity) &&
    value.blendMode === 'normal'
  )
}

function isPaint(value: unknown): boolean {
  return (
    isRecord(value) &&
    ((value.type === 'none') ||
      (value.type === 'solid' && typeof value.color === 'string'))
  )
}

function isMatrix(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.a) &&
    isFiniteNumber(value.b) &&
    isFiniteNumber(value.c) &&
    isFiniteNumber(value.d) &&
    isFiniteNumber(value.e) &&
    isFiniteNumber(value.f)
  )
}

function isVec2(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isRect(value: unknown): value is Rect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
