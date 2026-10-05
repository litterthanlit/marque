import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { getGenerator } from '../generators/registry.ts'
import type { IllustratorDocument } from '../illustrator/types.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import {
  getAllModeParamDefaults,
  getModeDefinition,
  getModeGeneratorId,
  getModeParamDefaults,
  getModeParamLimits,
  normalizeInitials,
  STYLE_FAMILIES,
} from '../../store/modes.ts'
import { isVectorDocument } from './document.ts'
import { createVectorDocumentFromGeneration } from './fromGeneration.ts'
import type { VectorDocument } from './types.ts'

/** What a link asks the app to open. */
export type DecodedLink =
  | { kind: 'blank' }
  | { kind: 'vector'; document: VectorDocument; inkColor: string }
  /** The `i` parameter: a layer document from before the vector format. */
  | { kind: 'legacy-layers'; document: IllustratorDocument; inkColor: string }
  /** A link from the old Generate screen: its mark is rebuilt from these. */
  | { kind: 'generator'; params: LogoParams }
  | { kind: 'invalid'; reason: string }

type NumberKey =
  | 'seed'
  | 'gridRings'
  | 'additiveRatio'
  | 'baseRadius'
  | 'radiusVariation'
  | 'rotation'
  | 'symmetryFolds'
  | 'animationSpeed'

const NUMBER_RANGES: Record<NumberKey, { min: number; max: number }> = {
  seed: { min: 0, max: 999999 },
  gridRings: { min: 1, max: 8 },
  additiveRatio: { min: 0, max: 1 },
  baseRadius: { min: 0.1, max: 1 },
  radiusVariation: { min: 0, max: 2 },
  rotation: { min: 0, max: 360 },
  symmetryFolds: { min: 1, max: 12 },
  animationSpeed: { min: 0, max: 5 },
}

const NUMBER_KEYS = Object.keys(NUMBER_RANGES) as NumberKey[]
const GENERATOR_KEYS = new Set<string>(['mode', 'style', 'initials', 'shapes', 'fillColor', ...NUMBER_KEYS])
const MODE_PARAM_PREFIX = 'm.'
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const UNREADABLE: DecodedLink = { kind: 'invalid', reason: 'This link holds a document that could not be read.' }

export function decodeLink(hash: string): DecodedLink {
  const query = new URLSearchParams(hash.replace(/^#/, ''))

  // A document does not depend on the generator, so the version check below does not apply to it.
  const vectorDocument = query.get('vd')
  if (vectorDocument) {
    const document = unpack(vectorDocument)
    return isVectorDocument(document) ? { kind: 'vector', document, inkColor: inkColor(query) } : UNREADABLE
  }
  const layerDocument = query.get('i')
  if (layerDocument) {
    const document = unpack(layerDocument)
    return isIllustratorDocument(document)
      ? { kind: 'legacy-layers', document, inkColor: inkColor(query) }
      : UNREADABLE
  }

  // Every untouched tab of the old app has `v` and nothing else.
  const version = query.get('v')
  if (version === null || ![...query.keys()].some(isGeneratorKey)) return { kind: 'blank' }

  const mode = query.get('mode')
  const modeId = mode && getModeDefinition(mode) ? mode : DEFAULT_PARAMS.modeId
  const generator = getGenerator(getModeGeneratorId(modeId))
  if (!generator || version !== generator.version) {
    return {
      kind: 'invalid',
      reason: `This link was made with generator version ${version}, which this app can no longer rebuild.`,
    }
  }
  return { kind: 'generator', params: generatorParams(query, modeId) }
}

/** The hash for a document, as `location.hash` reads it. An empty document has none. */
export function encodeLink(document: VectorDocument, inkColor: string): string {
  if (document.objects.length === 0) return ''
  const query = new URLSearchParams({
    fillColor: inkColor,
    vd: compressToEncodedURIComponent(JSON.stringify(document)),
  })
  return `#${query}`
}

export function documentFromGeneratorLink(params: LogoParams): VectorDocument {
  return createVectorDocumentFromGeneration(generate(params), params)
}

function isGeneratorKey(key: string): boolean {
  return GENERATOR_KEYS.has(key) || key.startsWith(MODE_PARAM_PREFIX)
}

function inkColor(query: URLSearchParams): string {
  const color = query.get('fillColor')
  return color && HEX_COLOR.test(color) ? color : DEFAULT_PARAMS.fillColor
}

function generatorParams(query: URLSearchParams, modeId: string): LogoParams {
  const style = query.get('style')
  const shapes = (query.get('shapes') ?? '')
    .split(',')
    .filter((shape) => DEFAULT_PARAMS.enabledShapes.includes(shape))

  const params: LogoParams = {
    ...DEFAULT_PARAMS,
    modeId,
    generatorId: getModeGeneratorId(modeId),
    styleFamily: STYLE_FAMILIES.find((family) => family.id === style)?.id ?? DEFAULT_PARAMS.styleFamily,
    fillColor: inkColor(query),
    enabledShapes: shapes.length > 0 ? shapes : DEFAULT_PARAMS.enabledShapes,
    brandInput:
      modeId === 'monogram' ? { initials: normalizeInitials(query.get('initials') ?? undefined) ?? 'MM' } : {},
    modeParams: { ...getAllModeParamDefaults(), [modeId]: modeParams(query, modeId) },
  }

  for (const key of NUMBER_KEYS) {
    const raw = query.get(key)
    if (raw === null || !Number.isFinite(Number(raw))) continue
    const { min, max } = NUMBER_RANGES[key]
    params[key] = clamp(Number(raw), min, max)
  }
  return params
}

function modeParams(query: URLSearchParams, modeId: string): Record<string, number | string> {
  const limits = getModeParamLimits(modeId)
  const params = getModeParamDefaults(modeId)

  for (const [key, raw] of query) {
    if (!key.startsWith(MODE_PARAM_PREFIX)) continue
    const name = key.slice(MODE_PARAM_PREFIX.length)
    const value = Number(raw)
    if (Number.isFinite(value)) {
      const limit = limits[name]
      if (limit) params[name] = clamp(value, limit.min, limit.max)
    } else if (name in params) {
      // An enum such as arcSymmetry.
      params[name] = raw
    }
  }
  return params
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function unpack(packed: string): unknown {
  const json = decompressFromEncodedURIComponent(packed)
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function isIllustratorDocument(value: unknown): value is IllustratorDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as Partial<IllustratorDocument>
  return (
    typeof doc.id === 'string' &&
    Boolean(doc.source) &&
    Array.isArray(doc.layers) &&
    Array.isArray(doc.selectedLayerIds) &&
    (doc.mode === 'object' || doc.mode === 'points')
  )
}
