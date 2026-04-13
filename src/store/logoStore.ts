import { create } from 'zustand'
import { temporal } from 'zundo'
import type {
  BrandInput,
  GenerationResult,
  LogoParams,
  StyleFamily,
} from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import type { DissolutionParams, EffectParamsMap } from '../engine/effects/types.ts'
import { DEFAULT_DISSOLUTION_PARAMS } from '../engine/effects/types.ts'
import { paramsEqual } from './historyMiddleware.ts'
import {
  getAllModeParamDefaults,
  getModeGeneratorId,
  getStyleFamilyDefaults,
  normalizeInitials,
  sanitizeBrandInput,
} from './modes.ts'

export interface DrawnShape {
  id: string
  type: 'circle' | 'rectangle' | 'triangle' | 'polygon'
  x: number
  y: number
  radius: number
  operation: 'add' | 'subtract'
}

export interface ShapeOverride {
  dx: number
  dy: number
  scale: number
  rotation: number
  hidden: boolean
}

type ThemeMode = 'dark' | 'light'

interface UIState {
  showGrid: boolean
  showConstruction: boolean
  perspectiveX: number
  perspectiveY: number
  drawingMode: boolean
  activeDrawShape: 'circle' | 'rectangle' | 'triangle' | 'polygon'
  drawnShapes: DrawnShape[]
  theme: ThemeMode
  editMode: boolean
  selectedShapeId: string | null
  shapeOverrides: Record<string, ShapeOverride>
}

interface LogoStore {
  params: LogoParams
  result: GenerationResult | null
  error: string | null
  ui: UIState
  effectParams: EffectParamsMap

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
  setPerspective: (axis: 'perspectiveX' | 'perspectiveY', value: number) => void
  resetPerspective: () => void
  setDrawingMode: (enabled: boolean) => void
  setActiveDrawShape: (shape: 'circle' | 'rectangle' | 'triangle' | 'polygon') => void
  addDrawnShape: (shape: Omit<DrawnShape, 'id'>) => void
  removeDrawnShape: (id: string) => void
  clearDrawnShapes: () => void
  toggleTheme: () => void
  applyPreset: (params: Partial<LogoParams>) => void
  toggleShape: (shape: string) => void
  setEffectParam: <K extends keyof DissolutionParams>(key: K, value: DissolutionParams[K]) => void
  toggleDissolution: () => void
  toggleEditMode: () => void
  selectShape: (id: string | null) => void
  updateShapeOverride: (id: string, update: Partial<ShapeOverride>) => void
  deleteSelectedShape: () => void
  clearShapeOverrides: () => void
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
        perspectiveX: 0,
        perspectiveY: 0,
        drawingMode: false,
        activeDrawShape: 'circle',
        drawnShapes: [],
        theme: (window.localStorage.getItem('dalat.theme') as ThemeMode) || 'dark',
        editMode: false,
        selectedShapeId: null,
        shapeOverrides: {},
      },
      effectParams: {
        dissolution: { ...DEFAULT_DISSOLUTION_PARAMS },
      },

      setParam: (key, value) =>
        set((state) => ({
          params: mergeLogoParams(state.params, { [key]: value } as Partial<LogoParams>),
          ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
        })),

      setParams: (updates) =>
        set((state) => ({
          params: mergeLogoParams(state.params, updates),
          ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
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
            ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
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
            ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
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
          ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
        })),

      randomizeSeed: () =>
        set((state) => ({
          params: {
            ...state.params,
            seed: crypto.getRandomValues(new Uint32Array(1))[0] % 10000,
          },
          ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
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

      setPerspective: (axis, value) =>
        set((state) => ({
          ui: { ...state.ui, [axis]: value },
        })),

      resetPerspective: () =>
        set((state) => ({
          ui: { ...state.ui, perspectiveX: 0, perspectiveY: 0 },
        })),

      setDrawingMode: (enabled) =>
        set((state) => ({
          ui: { ...state.ui, drawingMode: enabled },
        })),

      setActiveDrawShape: (shape) =>
        set((state) => ({
          ui: { ...state.ui, activeDrawShape: shape },
        })),

      addDrawnShape: (shape) =>
        set((state) => ({
          ui: {
            ...state.ui,
            drawnShapes: [
              ...state.ui.drawnShapes,
              { ...shape, id: crypto.randomUUID() },
            ],
          },
        })),

      removeDrawnShape: (id) =>
        set((state) => ({
          ui: {
            ...state.ui,
            drawnShapes: state.ui.drawnShapes.filter((s) => s.id !== id),
          },
        })),

      clearDrawnShapes: () =>
        set((state) => ({
          ui: { ...state.ui, drawnShapes: [] },
        })),

      toggleTheme: () =>
        set((state) => {
          const next = state.ui.theme === 'dark' ? 'light' : 'dark'
          window.localStorage.setItem('dalat.theme', next)
          document.documentElement.classList.toggle('light', next === 'light')
          return { ui: { ...state.ui, theme: next } }
        }),

      applyPreset: (presetParams) =>
        set((state) => ({
          params: mergeLogoParams(state.params, presetParams),
          ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
        })),

      setEffectParam: (key, value) =>
        set((state) => ({
          effectParams: {
            ...state.effectParams,
            dissolution: {
              ...state.effectParams.dissolution,
              [key]: value,
            },
          },
        })),

      toggleShape: (shape: string) =>
        set((state) => {
          const current = state.params.enabledShapes
          const has = current.includes(shape)
          if (has && current.length <= 1) return state
          const next = has ? current.filter((s) => s !== shape) : [...current, shape]
          return {
            params: { ...state.params, enabledShapes: next },
            ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
          }
        }),

      toggleDissolution: () =>
        set((state) => ({
          effectParams: {
            ...state.effectParams,
            dissolution: {
              ...state.effectParams.dissolution,
              enabled: !state.effectParams.dissolution.enabled,
            },
          },
        })),

      toggleEditMode: () =>
        set((state) => ({
          ui: {
            ...state.ui,
            editMode: !state.ui.editMode,
            selectedShapeId: null,
          },
        })),

      selectShape: (id) =>
        set((state) => ({
          ui: { ...state.ui, selectedShapeId: id },
        })),

      updateShapeOverride: (id, update) =>
        set((state) => {
          const current = state.ui.shapeOverrides[id] ?? {
            dx: 0, dy: 0, scale: 1, rotation: 0, hidden: false,
          }
          return {
            ui: {
              ...state.ui,
              shapeOverrides: {
                ...state.ui.shapeOverrides,
                [id]: { ...current, ...update },
              },
            },
          }
        }),

      deleteSelectedShape: () =>
        set((state) => {
          const id = state.ui.selectedShapeId
          if (!id) return state
          const current = state.ui.shapeOverrides[id] ?? {
            dx: 0, dy: 0, scale: 1, rotation: 0, hidden: false,
          }
          return {
            ui: {
              ...state.ui,
              selectedShapeId: null,
              shapeOverrides: {
                ...state.ui.shapeOverrides,
                [id]: { ...current, hidden: true },
              },
            },
          }
        }),

      clearShapeOverrides: () =>
        set((state) => ({
          ui: { ...state.ui, shapeOverrides: {}, selectedShapeId: null },
        })),
    }),
    {
      equality: paramsEqual,
      partialize: (state) => ({ params: state.params, effectParams: state.effectParams }),
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
