import { useEffect, useRef } from 'react'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { useLogoStore } from '../store/logoStore.ts'
import type { LogoParams, StyleFamily } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import { getGenerator } from '../engine/generators/registry.ts'
import {
  buildModeParamsForPersistence,
  getModeDefinition,
  getModeGeneratorId,
  getModeParamDefaults,
  getModeParamLimits,
  normalizeInitials,
  STYLE_FAMILIES,
} from '../store/modes.ts'
import { DEFAULT_DISSOLUTION_PARAMS } from '../engine/effects/types.ts'
import type { DissolutionParams } from '../engine/effects/types.ts'
import type { EffectParamsMap } from '../engine/effects/types.ts'
import type { ActiveSurface, IllustratorDocument } from '../engine/illustrator/types.ts'

const PARAM_KEYS: Array<
  | 'seed'
  | 'gridRings'
  | 'additiveRatio'
  | 'baseRadius'
  | 'radiusVariation'
  | 'rotation'
  | 'symmetryFolds'
  | 'fillColor'
  | 'animationSpeed'
> = [
  'seed',
  'gridRings',
  'additiveRatio',
  'baseRadius',
  'radiusVariation',
  'rotation',
  'symmetryFolds',
  'fillColor',
  'animationSpeed',
]

const PARAM_RANGES: Record<string, { min: number; max: number }> = {
  seed: { min: 0, max: 999999 },
  gridRings: { min: 1, max: 8 },
  additiveRatio: { min: 0, max: 1 },
  baseRadius: { min: 0.1, max: 1 },
  radiusVariation: { min: 0, max: 2 },
  rotation: { min: 0, max: 360 },
  symmetryFolds: { min: 1, max: 12 },
  animationSpeed: { min: 0, max: 5 },
}

export function useUrlState() {
  const params = useLogoStore((s) => s.params)
  const setParams = useLogoStore((s) => s.setParams)
  const setError = useLogoStore((s) => s.setError)
  const effectParams = useLogoStore((s) => s.effectParams)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const setActiveSurface = useLogoStore((s) => s.setActiveSurface)
  const illustrator = useLogoStore((s) => s.illustrator)
  const setIllustratorDocument = useLogoStore((s) => s.setIllustratorDocument)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const decoded = decodeParams(window.location.hash)
    if (decoded.error) {
      setError(decoded.error)
    }
    if (decoded.params) {
      setParams(decoded.params)
    }
    if (decoded.effectParams) {
      for (const [key, value] of Object.entries(decoded.effectParams)) {
        setEffectParam(key as keyof DissolutionParams, value as DissolutionParams[keyof DissolutionParams])
      }
    }
    if (decoded.illustrator) {
      setIllustratorDocument(decoded.illustrator)
    }
    if (decoded.activeSurface) {
      setActiveSurface(decoded.activeSurface)
    }
  }, [setActiveSurface, setError, setIllustratorDocument, setParams, setEffectParam])

  useEffect(() => {
    if (!initialized.current) return

    const encoded = encodeParams(params, effectParams, activeSurface, illustrator)
    const nextHash = encoded ? `#${encoded}` : ''
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash || window.location.pathname)
    }
  }, [activeSurface, effectParams, illustrator, params])
}

function encodeParams(
  params: LogoParams,
  effectParams: EffectParamsMap,
  activeSurface: ActiveSurface,
  illustrator: IllustratorDocument | null,
): string {
  const searchParams = new URLSearchParams()
  const generator = getGenerator(params.generatorId)

  if (params.modeId !== DEFAULT_PARAMS.modeId) {
    searchParams.set('mode', params.modeId)
  }

  if (params.styleFamily !== DEFAULT_PARAMS.styleFamily) {
    searchParams.set('style', params.styleFamily)
  }

  const initials = normalizeInitials(params.brandInput.initials)
  if (params.modeId === 'monogram' && initials) {
    searchParams.set('initials', initials)
  }

  for (const key of PARAM_KEYS) {
    const value = params[key]
    const defaultValue = DEFAULT_PARAMS[key]
    if (value !== defaultValue) {
      searchParams.set(key, String(value))
    }
  }

  if (generator) {
    searchParams.set('v', generator.version)
  }

  const activeModeParams = params.modeParams[params.modeId] ?? {}
  const persistedModeParams = buildModeParamsForPersistence(params.modeId, {
    [params.modeId]: activeModeParams,
  })

  for (const [key, value] of Object.entries(persistedModeParams[params.modeId] ?? {}).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const defaultValue = getModeParamDefaults(params.modeId)[key]
    if (value !== defaultValue) {
      searchParams.set(`m.${key}`, String(value))
    }
  }

  // Encode enabled shapes (only if not all enabled)
  const allShapes = ['circle', 'rectangle', 'triangle', 'polygon', 'blob']
  const sorted = [...params.enabledShapes].sort()
  const allSorted = [...allShapes].sort()
  if (sorted.join(',') !== allSorted.join(',')) {
    searchParams.set('shapes', sorted.join(','))
  }

  // Encode effect params (e. prefix)
  if (effectParams.dissolution.enabled) {
    searchParams.set('e.dissolve', '1')
    const dp = effectParams.dissolution
    const dd = DEFAULT_DISSOLUTION_PARAMS
    if (dp.threshold !== dd.threshold) searchParams.set('e.threshold', String(dp.threshold))
    if (dp.cellSize !== dd.cellSize) searchParams.set('e.cellSize', String(dp.cellSize))
    if (dp.shape !== dd.shape) searchParams.set('e.shape', dp.shape)
    if (dp.scatter !== dd.scatter) searchParams.set('e.scatter', String(dp.scatter))
    if (dp.sizeVariation !== dd.sizeVariation) searchParams.set('e.sizeVariation', String(dp.sizeVariation))
  }

  if (activeSurface !== 'generated' || illustrator) {
    searchParams.set('surface', activeSurface)
  }

  if (illustrator) {
    searchParams.set('i', compressToEncodedURIComponent(JSON.stringify(illustrator)))
  }

  return searchParams.toString()
}

interface DecodedUrlState {
  params: Partial<LogoParams> | null
  effectParams: Partial<DissolutionParams> | null
  activeSurface: ActiveSurface | null
  illustrator: IllustratorDocument | null
  error: string | null
}

function decodeParams(
  hash: string,
): DecodedUrlState {
  if (!hash || hash === '#') {
    return {
      params: null,
      effectParams: null,
      activeSurface: null,
      illustrator: null,
      error: null,
    }
  }

  try {
    return decodeParamsInner(hash)
  } catch (e) {
    return {
      params: null,
      effectParams: null,
      activeSurface: null,
      illustrator: null,
      error: `Failed to decode URL parameters: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

function decodeParamsInner(
  hash: string,
): DecodedUrlState {
  const searchParams = new URLSearchParams(hash.replace(/^#/, ''))
  const rawUpdates: Partial<LogoParams> = {}
  const rawModeParams: Record<string, number> = {}
  const rawModeStringParams: Record<string, string> = {}

  const rawModeId = searchParams.get('mode')
  const modeId = rawModeId && getModeDefinition(rawModeId) ? rawModeId : DEFAULT_PARAMS.modeId
  const generatorId = getModeGeneratorId(modeId)
  const generator = getGenerator(generatorId)
  const rawVersion = searchParams.get('v')

  if (rawVersion && generator && rawVersion !== generator.version) {
    return {
      params: null,
      effectParams: null,
      activeSurface: null,
      illustrator: null,
      error: `This shared link was created for generator version ${rawVersion}, but ${generator.name} is now on ${generator.version}. Defaults were kept to avoid loading incompatible state.`,
    }
  }

  const rawStyle = searchParams.get('style')
  const styleFamily = STYLE_FAMILIES.some((family) => family.id === rawStyle)
    ? (rawStyle as StyleFamily)
    : DEFAULT_PARAMS.styleFamily

  for (const [key, value] of searchParams.entries()) {
    if (
      key === 'mode' ||
      key === 'style' ||
      key === 'initials' ||
      key === 'v' ||
      key === 'shapes' ||
      key === 'surface' ||
      key === 'i'
    ) {
      continue
    }

    if (key.startsWith('m.')) {
      const paramKey = key.slice(2)
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        rawModeParams[paramKey] = parsed
      } else if (value) {
        // String enum param (e.g., arcSymmetry)
        rawModeStringParams[paramKey] = value
      }
      continue
    }

    if (key.startsWith('e.')) {
      continue
    }

    if (!PARAM_KEYS.includes(key as (typeof PARAM_KEYS)[number])) continue

    if (key === 'fillColor') {
      rawUpdates.fillColor = value
      continue
    }

    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      ;(rawUpdates as Record<string, number>)[key] = parsed
    }
  }

  const sanitized: Partial<LogoParams> = {
    modeId,
    generatorId,
    styleFamily,
  }

  for (const [key, value] of Object.entries(rawUpdates)) {
    if (key === 'fillColor') continue
    const range = PARAM_RANGES[key]
    if (range && typeof value === 'number') {
      ;(sanitized as Record<string, number>)[key] = clampNumber(value, range.min, range.max)
    }
  }

  if (typeof rawUpdates.fillColor === 'string' && isHexColor(rawUpdates.fillColor)) {
    sanitized.fillColor = rawUpdates.fillColor
  }

  const shapesRaw = searchParams.get('shapes')
  if (shapesRaw) {
    const validShapes = ['circle', 'rectangle', 'triangle', 'polygon', 'blob']
    const decoded = shapesRaw.split(',').filter((s) => validShapes.includes(s))
    if (decoded.length > 0) {
      sanitized.enabledShapes = decoded
    }
  }

  if (modeId === 'monogram') {
    const initials = normalizeInitials(searchParams.get('initials') ?? undefined)
    sanitized.brandInput = { initials: initials ?? 'MM' }
  } else {
    sanitized.brandInput = {}
  }

  const limits = getModeParamLimits(modeId)
  const modeDefaults = getModeParamDefaults(modeId)
  const sanitizedModeParams: Record<string, number | string> = { ...modeDefaults }

  for (const [key, value] of Object.entries(rawModeParams)) {
    const limit = limits[key]
    if (!limit) continue
    sanitizedModeParams[key] = clampNumber(value, limit.min, limit.max)
  }

  for (const [key, value] of Object.entries(rawModeStringParams)) {
    if (key in modeDefaults) sanitizedModeParams[key] = value
  }

  sanitized.modeParams = {
    [modeId]: sanitizedModeParams,
  }

  // Decode effect params
  const effectUpdates: Partial<DissolutionParams> = {}
  if (searchParams.get('e.dissolve') === '1') {
    effectUpdates.enabled = true
    const threshold = Number(searchParams.get('e.threshold'))
    if (Number.isFinite(threshold)) effectUpdates.threshold = clampNumber(threshold, 0, 1)
    const cellSize = Number(searchParams.get('e.cellSize'))
    if (Number.isFinite(cellSize)) effectUpdates.cellSize = clampNumber(cellSize, 4, 32)
    const shape = searchParams.get('e.shape')
    if (shape === 'square' || shape === 'circle') effectUpdates.shape = shape
    const scatter = Number(searchParams.get('e.scatter'))
    if (Number.isFinite(scatter)) effectUpdates.scatter = clampNumber(scatter, 0, 1)
    const sizeVariation = Number(searchParams.get('e.sizeVariation'))
    if (Number.isFinite(sizeVariation)) effectUpdates.sizeVariation = clampNumber(sizeVariation, 0, 1)
  }

  const rawSurface = searchParams.get('surface')
  const decodedIllustrator = decodeIllustrator(searchParams.get('i'))
  const decodedSurface: ActiveSurface | null =
    rawSurface === 'illustrator'
      ? 'illustrator'
      : rawSurface === 'generated'
        ? 'generated'
        : null

  return {
    params: sanitized,
    effectParams: Object.keys(effectUpdates).length > 0 ? effectUpdates : null,
    activeSurface: decodedSurface,
    illustrator: decodedIllustrator,
    error: null,
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

function decodeIllustrator(raw: string | null): IllustratorDocument | null {
  if (!raw) return null
  const json = decompressFromEncodedURIComponent(raw)
  if (!json) throw new Error('Invalid Vector Maker document encoding')
  const parsed = JSON.parse(json) as unknown
  if (!isIllustratorDocument(parsed)) {
    throw new Error('Invalid Vector Maker document')
  }
  return parsed
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
