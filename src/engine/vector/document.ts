import type {
  Matrix2D,
  Paint,
  Rect,
  VectorAppearance,
  VectorArtboard,
  VectorDocument,
} from './types.ts'

export const VECTOR_SCHEMA_VERSION = 1

export const IDENTITY_MATRIX: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
}

export const DEFAULT_ARTBOARD_RECT: Rect = {
  x: -512,
  y: -512,
  width: 1024,
  height: 1024,
}

export const NONE_PAINT: Paint = { type: 'none' }

export function solidPaint(color: string): Paint {
  return { type: 'solid', color }
}

export function createDefaultAppearance(fillColor = '#111111'): VectorAppearance {
  return {
    fill: solidPaint(fillColor),
    stroke: NONE_PAINT,
    strokeWidth: 0,
    strokeCap: 'butt',
    strokeJoin: 'miter',
    strokeMiterLimit: 4,
    strokeDashArray: [],
    opacity: 1,
    blendMode: 'normal',
  }
}

export function createDefaultArtboard(): VectorArtboard {
  return {
    id: crypto.randomUUID(),
    name: 'Artboard 1',
    rect: { ...DEFAULT_ARTBOARD_RECT },
    background: null,
  }
}

export function createEmptyVectorDocument(name = 'Untitled Vector Maker document'): VectorDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: VECTOR_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    kind: 'brand-vector',
    activeMode: 'logo',
    name,
    artboards: [createDefaultArtboard()],
    objects: [],
    selection: { targets: [] },
    source: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function isVectorDocument(value: unknown): value is VectorDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VectorDocument> & Record<string, unknown>
  return (
    candidate.schemaVersion === VECTOR_SCHEMA_VERSION &&
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

function isVectorSelection(value: unknown): value is VectorDocument['selection'] {
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
