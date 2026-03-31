import { create } from 'zustand'
import { temporal } from 'zundo'
import type { LogoParams, GenerationResult } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import { paramsEqual } from './historyMiddleware.ts'

interface UIState {
  showGrid: boolean
  showConstruction: boolean
}

interface LogoStore {
  params: LogoParams
  result: GenerationResult | null
  error: string | null
  ui: UIState

  setParam: <K extends keyof LogoParams>(key: K, value: LogoParams[K]) => void
  setParams: (updates: Partial<LogoParams>) => void
  randomizeSeed: () => void
  setResult: (result: GenerationResult | null) => void
  setError: (error: string | null) => void
  toggleGrid: () => void
  toggleConstruction: () => void
  applyPreset: (params: Partial<LogoParams>) => void
}

export const useLogoStore = create<LogoStore>()(
  temporal(
    (set) => ({
      params: { ...DEFAULT_PARAMS },
      result: null,
      error: null,
      ui: {
        showGrid: true,
        showConstruction: true,
      },

      setParam: (key, value) =>
        set((state) => ({
          params: { ...state.params, [key]: value },
        })),

      setParams: (updates) =>
        set((state) => ({
          params: { ...state.params, ...updates },
        })),

      randomizeSeed: () =>
        set((state) => ({
          params: {
            ...state.params,
            seed: crypto.getRandomValues(new Uint32Array(1))[0] % 10000,
          },
        })),

      setResult: (result) => set({ result }),
      setError: (error) => set({ error }),

      toggleGrid: () =>
        set((state) => ({
          ui: { ...state.ui, showGrid: !state.ui.showGrid },
        })),

      toggleConstruction: () =>
        set((state) => ({
          ui: { ...state.ui, showConstruction: !state.ui.showConstruction },
        })),

      applyPreset: (presetParams) =>
        set((state) => ({
          params: { ...state.params, ...presetParams },
        })),
    }),
    {
      equality: paramsEqual,
      partialize: (state) => ({ params: state.params }),
      limit: 50,
    },
  ),
)
