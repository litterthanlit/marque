import { useEffect, useRef } from 'react'
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
  }, [setError, setParams])

  useEffect(() => {
    if (!initialized.current) return

    const encoded = encodeParams(params)
    const nextHash = encoded ? `#${encoded}` : ''
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash || window.location.pathname)
    }
  }, [params])
}

function encodeParams(params: LogoParams): string {
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

  return searchParams.toString()
}

function decodeParams(
  hash: string,
): { params: Partial<LogoParams> | null; error: string | null } {
  if (!hash || hash === '#') return { params: null, error: null }

  try {
    return decodeParamsInner(hash)
  } catch (e) {
    return {
      params: null,
      error: `Failed to decode URL parameters: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

function decodeParamsInner(
  hash: string,
): { params: Partial<LogoParams> | null; error: string | null } {
  const searchParams = new URLSearchParams(hash.replace(/^#/, ''))
  const rawUpdates: Partial<LogoParams> = {}
  const rawModeParams: Record<string, number> = {}

  const rawModeId = searchParams.get('mode')
  const modeId = rawModeId && getModeDefinition(rawModeId) ? rawModeId : DEFAULT_PARAMS.modeId
  const generatorId = getModeGeneratorId(modeId)
  const generator = getGenerator(generatorId)
  const rawVersion = searchParams.get('v')

  if (rawVersion && generator && rawVersion !== generator.version) {
    return {
      params: null,
      error: `This shared link was created for generator version ${rawVersion}, but ${generator.name} is now on ${generator.version}. Defaults were kept to avoid loading incompatible state.`,
    }
  }

  const rawStyle = searchParams.get('style')
  const styleFamily = STYLE_FAMILIES.some((family) => family.id === rawStyle)
    ? (rawStyle as StyleFamily)
    : DEFAULT_PARAMS.styleFamily

  for (const [key, value] of searchParams.entries()) {
    if (key === 'mode' || key === 'style' || key === 'initials' || key === 'v') {
      continue
    }

    if (key.startsWith('m.')) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        rawModeParams[key.slice(2)] = parsed
      }
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

  if (modeId === 'monogram') {
    const initials = normalizeInitials(searchParams.get('initials') ?? undefined)
    sanitized.brandInput = { initials: initials ?? 'MM' }
  } else {
    sanitized.brandInput = {}
  }

  const limits = getModeParamLimits(modeId)
  const modeDefaults = getModeParamDefaults(modeId)
  const sanitizedModeParams: Record<string, number> = { ...modeDefaults }

  for (const [key, value] of Object.entries(rawModeParams)) {
    const limit = limits[key]
    if (!limit) continue
    sanitizedModeParams[key] = clampNumber(value, limit.min, limit.max)
  }

  sanitized.modeParams = {
    [modeId]: sanitizedModeParams,
  }

  return { params: sanitized, error: null }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}
