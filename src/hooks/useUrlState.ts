import { useEffect, useRef } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import type { LogoParams } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import { getGenerator } from '../engine/generators/registry.ts'

const PARAM_KEYS: (keyof LogoParams)[] = [
  'seed', 'gridRings', 'additiveRatio', 'baseRadius',
  'radiusVariation', 'rotation', 'symmetryFolds', 'fillColor',
  'animationSpeed', 'generatorId',
]

const PARAM_RANGES: Partial<Record<keyof LogoParams, { min: number; max: number }>> = {
  seed: { min: 0, max: 999999 },
  gridRings: { min: 1, max: 8 },
  additiveRatio: { min: 0, max: 1 },
  baseRadius: { min: 0.1, max: 1 },
  radiusVariation: { min: 0, max: 2 },
  rotation: { min: 0, max: 360 },
  symmetryFolds: { min: 1, max: 12 },
  animationSpeed: { min: 0, max: 5 },
}

function encodeParams(params: LogoParams): string {
  const generator = getGenerator(params.generatorId)
  const searchParams = new URLSearchParams()

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

  // Encode extra params
  const allowedExtraKeys = new Set(generator?.extraParams.map((param) => param.key) ?? [])
  for (const [k, v] of Object.entries(params.extra).sort(([a], [b]) => a.localeCompare(b))) {
    if (allowedExtraKeys.has(k)) {
      searchParams.set(`x.${k}`, String(v))
    }
  }

  return searchParams.toString()
}

function decodeParams(
  hash: string,
): { params: Partial<LogoParams> | null; error: string | null } {
  if (!hash || hash === '#') return { params: null, error: null }

  const searchParams = new URLSearchParams(hash.replace(/^#/, ''))
  const rawUpdates: Partial<LogoParams> = {}
  const rawExtra: Record<string, number> = {}
  const rawVersion = searchParams.get('v')

  for (const [key, value] of searchParams.entries()) {
    if (key === 'v') continue // version, not a param

    if (key.startsWith('x.')) {
      const parsed = Number(value)
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        rawExtra[key.slice(2)] = parsed
      }
      continue
    }

    if (PARAM_KEYS.includes(key as keyof LogoParams)) {
      const k = key as keyof LogoParams
      if (k === 'fillColor' || k === 'generatorId') {
        (rawUpdates as Record<string, string>)[k] = value
      } else {
        const num = Number(value)
        if (!Number.isNaN(num) && Number.isFinite(num)) {
          (rawUpdates as Record<string, number>)[k] = num
        }
      }
    }
  }

  return sanitizeDecodedParams(rawUpdates, rawExtra, rawVersion)
}

export function useUrlState() {
  const params = useLogoStore((s) => s.params)
  const setParams = useLogoStore((s) => s.setParams)
  const setError = useLogoStore((s) => s.setError)
  const initialized = useRef(false)

  // On mount: read URL hash and apply params
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const decoded = decodeParams(window.location.hash)
    if (decoded?.error) {
      setError(decoded.error)
    }
    if (decoded?.params) {
      setParams(decoded.params)
    }
  }, [setError, setParams])

  // On param change: update URL hash
  useEffect(() => {
    if (!initialized.current) return
    const encoded = encodeParams(params)
    const newHash = encoded ? `#${encoded}` : ''
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', newHash || window.location.pathname)
    }
  }, [params])
}

function sanitizeDecodedParams(
  updates: Partial<LogoParams>,
  extra: Record<string, number>,
  version: string | null,
): { params: Partial<LogoParams> | null; error: string | null } {
  const sanitized: Partial<LogoParams> = {}
  const generatorId =
    typeof updates.generatorId === 'string' && getGenerator(updates.generatorId)
      ? updates.generatorId
      : DEFAULT_PARAMS.generatorId
  const generator = getGenerator(generatorId)
  let error: string | null = null

  if (version && generator && version !== generator.version) {
    error = `This shared link was created for generator version ${version}, but ${generator.name} is now on ${generator.version}. Defaults were kept to avoid loading incompatible state.`
    return { params: null, error }
  }

  if (generatorId !== DEFAULT_PARAMS.generatorId || updates.generatorId) {
    sanitized.generatorId = generatorId
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'generatorId' || key === 'fillColor' || key === 'extra') continue

    const range = PARAM_RANGES[key as keyof LogoParams]
    if (typeof value === 'number' && range) {
      ;(sanitized as Record<string, number>)[key] = clampNumber(
        value,
        range.min,
        range.max,
      )
    }
  }

  if (typeof updates.fillColor === 'string' && isHexColor(updates.fillColor)) {
    sanitized.fillColor = updates.fillColor
  }

  if (generator) {
    const sanitizedExtra: Record<string, number> = {}
    for (const definition of generator.extraParams) {
      const rawValue = extra[definition.key]
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        sanitizedExtra[definition.key] = clampNumber(
          rawValue,
          definition.min,
          definition.max,
        )
      }
    }

    if (Object.keys(sanitizedExtra).length > 0) {
      sanitized.extra = sanitizedExtra
    }
  }

  return {
    params: Object.keys(sanitized).length > 0 ? sanitized : null,
    error,
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}
