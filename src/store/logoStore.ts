import { create } from 'zustand'
import { temporal } from 'zundo'
import type {
  BrandInput,
  GenerationResult,
  LogoParams,
  StyleFamily,
} from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import { paramsEqual } from './historyMiddleware.ts'
import {
  getAllModeParamDefaults,
  getModeGeneratorId,
  getStyleFamilyDefaults,
  normalizeInitials,
  sanitizeBrandInput,
} from './modes.ts'

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
  setMode: (modeId: string) => void
  setStyleFamily: (styleFamily: StyleFamily) => void
  setBrandInput: (updates: Partial<BrandInput>) => void
  setModeParam: (key: string, value: number | string) => void
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
      params: {
        ...DEFAULT_PARAMS,
        modeParams: getAllModeParamDefaults(),
      },
      result: null,
      error: null,
      ui: {
        showGrid: true,
        showConstruction: true,
      },

      setParam: (key, value) =>
        set((state) => ({
          params: mergeLogoParams(state.params, { [key]: value } as Partial<LogoParams>),
        })),

      setParams: (updates) =>
        set((state) => ({
          params: mergeLogoParams(state.params, updates),
        })),

      setMode: (modeId) =>
        set((state) => {
          const styleDefaults = getStyleFamilyDefaults(
            modeId,
            state.params.styleFamily,
          )
          const currentInitials = normalizeInitials(state.params.brandInput.initials)

          return {
            params: mergeLogoParams(state.params, {
              ...styleDefaults.shared,
              modeId,
              generatorId: getModeGeneratorId(modeId),
              brandInput:
                modeId === 'monogram'
                  ? { initials: currentInitials ?? 'MM' }
                  : {},
              modeParams: {
                [modeId]: styleDefaults.modeParams,
              },
            }),
          }
        }),

      setStyleFamily: (styleFamily) =>
        set((state) => {
          const styleDefaults = getStyleFamilyDefaults(
            state.params.modeId,
            styleFamily,
          )

          return {
            params: mergeLogoParams(state.params, {
              ...styleDefaults.shared,
              styleFamily,
              modeParams: {
                [state.params.modeId]: styleDefaults.modeParams,
              },
            }),
          }
        }),

      setBrandInput: (updates) =>
        set((state) => ({
          params: mergeLogoParams(state.params, {
            brandInput: {
              ...state.params.brandInput,
              ...updates,
            },
          }),
        })),

      setModeParam: (key, value) =>
        set((state) => ({
          params: mergeLogoParams(state.params, {
            modeParams: {
              [state.params.modeId]: {
                ...(state.params.modeParams[state.params.modeId] ?? {}),
                [key]: value,
              },
            },
          }),
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
          params: mergeLogoParams(state.params, presetParams),
        })),
    }),
    {
      equality: paramsEqual,
      partialize: (state) => ({ params: state.params }),
      limit: 50,
    },
  ),
)

function mergeLogoParams(
  current: LogoParams,
  updates: Partial<LogoParams>,
): LogoParams {
  const nextModeId = updates.modeId ?? current.modeId
  const nextBrandInput = updates.brandInput
    ? sanitizeBrandInput(
        { ...current.brandInput, ...updates.brandInput },
        nextModeId,
      )
    : sanitizeBrandInput(current.brandInput, nextModeId)

  return {
    ...current,
    ...updates,
    modeId: nextModeId,
    generatorId: updates.generatorId ?? getModeGeneratorId(nextModeId),
    brandInput: nextBrandInput,
    modeParams: mergeModeParams(current.modeParams, updates.modeParams),
  }
}

function mergeModeParams(
  current: LogoParams['modeParams'],
  updates: LogoParams['modeParams'] | undefined,
): LogoParams['modeParams'] {
  if (!updates) return current

  const next = { ...current }

  for (const [modeId, params] of Object.entries(updates)) {
    next[modeId] = {
      ...(current[modeId] ?? {}),
      ...params,
    }
  }

  return next
}
