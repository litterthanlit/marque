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
  const candidate = value as Partial<VectorDocument>
  return (
    candidate.schemaVersion === VECTOR_SCHEMA_VERSION &&
    candidate.kind === 'brand-vector' &&
    Array.isArray(candidate.artboards) &&
    Array.isArray(candidate.objects) &&
    Boolean(candidate.selection)
  )
}
