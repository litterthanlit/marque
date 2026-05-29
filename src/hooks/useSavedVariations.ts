import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LogoParams } from '../engine/types.ts'
import type { EffectParamsMap } from '../engine/effects/types.ts'
import type { ActiveSurface, IllustratorDocument } from '../engine/illustrator/types.ts'
import type { VectorDocument } from '../engine/vector/types.ts'

const STORAGE_KEY = 'dalat.saved-variations.v3'
const MAX_VARIATIONS = 24

export interface SavedVariation {
  id: string
  name: string
  savedAt: string
  params: LogoParams
  effectParams?: EffectParamsMap
  activeSurface?: ActiveSurface
  vectorDocument?: VectorDocument | null
  illustrator?: IllustratorDocument | null
}

export function useSavedVariations() {
  const [variations, setVariations] = useState<SavedVariation[]>([])
  const loaded = useRef(false)

  // Load from localStorage on mount + sync cross-tab changes
  useEffect(() => {
    function syncFromStorage() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as SavedVariation[]
        if (Array.isArray(parsed)) {
          setVariations(parsed)
        }
      } catch {
        // Ignore broken local state.
      }
    }

    syncFromStorage()
    // Mark loaded after a microtask so the persistence effect below
    // skips the initial render (where variations is still []).
    queueMicrotask(() => { loaded.current = true })
    window.addEventListener('storage', syncFromStorage)
    return () => window.removeEventListener('storage', syncFromStorage)
  }, [])

  // Persist to localStorage after initial load
  useEffect(() => {
    if (!loaded.current) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(variations))
  }, [variations])

  const saveVariation = useCallback((
    params: LogoParams,
    activeSurface: ActiveSurface,
    vectorDocument: VectorDocument | null,
    illustrator: IllustratorDocument | null,
    effectParams: EffectParamsMap,
    name?: string,
  ) => {
    const safeName = name?.trim() || `${params.modeId} #${params.seed}`
    setVariations((current) => [
      {
        id: crypto.randomUUID(),
        name: safeName,
        savedAt: new Date().toISOString(),
        params: structuredClone(params),
        activeSurface,
        vectorDocument: vectorDocument ? structuredClone(vectorDocument) : null,
        illustrator: illustrator ? structuredClone(illustrator) : null,
        effectParams: structuredClone(effectParams),
      },
      ...current,
    ].slice(0, MAX_VARIATIONS))
  }, [])

  const removeVariation = useCallback((id: string) => {
    setVariations((current) => current.filter((variation) => variation.id !== id))
  }, [])

  return useMemo(
    () => ({ variations, saveVariation, removeVariation }),
    [variations, saveVariation, removeVariation],
  )
}
