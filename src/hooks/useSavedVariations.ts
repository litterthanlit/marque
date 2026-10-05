import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LogoParams } from '../engine/types.ts'
import { createSavedVariation, type SavedVariation } from '../engine/vector/saved.ts'
import type { VectorDocument } from '../engine/vector/types.ts'

const STORAGE_KEY = 'dalat.saved-variations.v3'
const MAX_VARIATIONS = 24

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

  const saveVariation = useCallback((document: VectorDocument, params: LogoParams) => {
    const entry = createSavedVariation(document, params)
    setVariations((current) => [entry, ...current].slice(0, MAX_VARIATIONS))
  }, [])

  const removeVariation = useCallback((id: string) => {
    setVariations((current) => current.filter((variation) => variation.id !== id))
  }, [])

  return useMemo(
    () => ({ variations, saveVariation, removeVariation }),
    [variations, saveVariation, removeVariation],
  )
}
