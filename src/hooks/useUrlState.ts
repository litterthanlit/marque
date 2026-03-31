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
  for (const [k, v] of Object.entries(params.extra)) {
    searchParams.set(`x.${k}`, String(v))
  }

  return searchParams.toString()
}

function decodeParams(hash: string): Partial<LogoParams> | null {
  if (!hash || hash === '#') return null

  const searchParams = new URLSearchParams(hash.replace(/^#/, ''))
  const updates: Partial<LogoParams> = {}
  const extra: Record<string, number> = {}

  for (const [key, value] of searchParams.entries()) {
    if (key === 'v') continue // version, not a param

    if (key.startsWith('x.')) {
      extra[key.slice(2)] = Number(value)
      continue
    }

    if (PARAM_KEYS.includes(key as keyof LogoParams)) {
      const k = key as keyof LogoParams
      if (k === 'fillColor' || k === 'generatorId') {
        (updates as Record<string, string>)[k] = value
      } else {
        const num = Number(value)
        if (!isNaN(num)) {
          (updates as Record<string, number>)[k] = num
        }
      }
    }
  }

  if (Object.keys(extra).length > 0) {
    updates.extra = extra
  }

  return Object.keys(updates).length > 0 ? updates : null
}

export function useUrlState() {
  const params = useLogoStore((s) => s.params)
  const setParams = useLogoStore((s) => s.setParams)
  const initialized = useRef(false)

  // On mount: read URL hash and apply params
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const decoded = decodeParams(window.location.hash)
    if (decoded) {
      setParams(decoded)
    }
  }, [setParams])

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
