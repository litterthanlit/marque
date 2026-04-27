import paper from 'paper'
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

export interface DrawnPath {
  id: string
  tool: 'pencil' | 'pen' | 'graffiti' | 'shapebuilder'
  pathData: string
  fillColor: string | null
  strokeColor: string | null
  strokeWidth: number
  closed: boolean
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
  drawnPaths: DrawnPath[]
  activeTool: 'select' | 'pencil' | 'pen' | 'graffiti' | 'shapebuilder' | null
  selectedPathIds: string[]
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
  addDrawnPath: (path: Omit<DrawnPath, 'id'>) => void
  removeDrawnPath: (id: string) => void
  clearDrawnPaths: () => void
  setActiveTool: (tool: 'select' | 'pencil' | 'pen' | 'graffiti' | 'shapebuilder' | null) => void
  togglePathSelection: (id: string) => void
  clearPathSelection: () => void
  booleanOp: (op: 'unite' | 'subtract' | 'intersect') => void
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
        showConstruction: false,
        perspectiveX: 0,
        perspectiveY: 0,
        drawingMode: false,
        activeDrawShape: 'circle',
        drawnShapes: [],
        theme: (window.localStorage.getItem('dalat.theme') as ThemeMode) || 'dark',
        editMode: false,
        selectedShapeId: null,
        shapeOverrides: {},
        drawnPaths: [],
        activeTool: null,
        selectedPathIds: [],
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

      addDrawnPath: (path) =>
        set((state) => ({
          ui: {
            ...state.ui,
            drawnPaths: [
              ...state.ui.drawnPaths,
              { ...path, id: crypto.randomUUID() },
            ],
          },
        })),

      removeDrawnPath: (id) =>
        set((state) => ({
          ui: {
            ...state.ui,
            drawnPaths: state.ui.drawnPaths.filter((p) => p.id !== id),
          },
        })),

      clearDrawnPaths: () =>
        set((state) => ({
          ui: { ...state.ui, drawnPaths: [] },
        })),

      setActiveTool: (tool) =>
        set((state) => ({
          ui: {
            ...state.ui,
            activeTool: tool,
            // Enter edit mode when selecting the select tool
            editMode: tool === 'select' ? true : state.ui.editMode,
            // Exit drawing mode when switching tools
            drawingMode: false,
            selectedPathIds: [],
          },
        })),

      togglePathSelection: (id) =>
        set((state) => {
          const ids = state.ui.selectedPathIds
          const next = ids.includes(id)
            ? ids.filter((i) => i !== id)
            : [...ids, id]
          return { ui: { ...state.ui, selectedPathIds: next } }
        }),

      clearPathSelection: () =>
        set((state) => ({
          ui: { ...state.ui, selectedPathIds: [] },
        })),

      booleanOp: (op) =>
        set((state) => {
          const ids = state.ui.selectedPathIds
          if (ids.length < 2) return state

          const selected = ids
            .map((id) => state.ui.drawnPaths.find((p) => p.id === id))
            .filter((p): p is DrawnPath => p != null)
          if (selected.length < 2) return state

          // Perform boolean op using Paper.js in a headless scope
          const result = performBooleanOp(selected, op)
          if (!result) return state

          // Replace selected paths with the result
          const remaining = state.ui.drawnPaths.filter((p) => !ids.includes(p.id))
          return {
            ui: {
              ...state.ui,
              drawnPaths: [...remaining, result],
              selectedPathIds: [result.id],
            },
          }
        }),
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

let booleanScope: paper.PaperScope | null = null

function getBooleanScope(): paper.PaperScope {
  if (!booleanScope) {
    booleanScope = new paper.PaperScope()
    booleanScope.setup(new paper.Size(1, 1))
  }
  booleanScope.activate()
  return booleanScope
}

function performBooleanOp(
  paths: DrawnPath[],
  op: 'unite' | 'subtract' | 'intersect',
): DrawnPath | null {
  const scope = getBooleanScope()
  scope.project.clear()

  const paperPaths: paper.PathItem[] = []
  for (const p of paths) {
    try {
      const item = p.closed || p.fillColor
        ? new scope.CompoundPath(p.pathData)
        : new scope.Path(p.pathData)
      paperPaths.push(item)
    } catch {
      return null
    }
  }

  if (paperPaths.length < 2) return null

  let result: paper.PathItem = paperPaths[0]
  for (let i = 1; i < paperPaths.length; i++) {
    try {
      const next =
        op === 'unite'
          ? result.unite(paperPaths[i])
          : op === 'subtract'
            ? result.subtract(paperPaths[i])
            : result.intersect(paperPaths[i])
      result.remove()
      paperPaths[i].remove()
      result = next
    } catch {
      return null
    }
  }

  const pathData = result.pathData
  result.remove()
  scope.project.clear()

  if (!pathData) return null

  // Use the fill color from the first shape
  const fillColor = paths[0].fillColor ?? paths[0].strokeColor ?? '#000000'

  return {
    id: crypto.randomUUID(),
    tool: 'shapebuilder',
    pathData,
    fillColor,
    strokeColor: null,
    strokeWidth: 0,
    closed: true,
  }
}
