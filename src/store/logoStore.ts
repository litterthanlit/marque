import paper from 'paper'
import { create } from 'zustand'
import type { LogoParams } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import type { IllustratorDocument, IllustratorLayer } from '../engine/illustrator/types.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../engine/illustrator/types.ts'
import { bakedEditablePath, scaleLayers } from '../engine/illustrator/layerPath.ts'
import { deleteAnchor, editablePathToPathData, toggleSmooth } from '../engine/path/editPath.ts'
import { getLayerPathItem } from '../engine/illustrator/compose.ts'
import type { VectorCommand } from '../engine/vector/commands.ts'
import {
  applyVectorCommand as applyVectorCommandToDocument,
  createReplaceVectorDocumentCommand,
  invertVectorCommand,
} from '../engine/vector/commands.ts'
import { savedDocument, type SavedVariation } from '../engine/vector/saved.ts'
import type { VectorDocument, VectorSelection } from '../engine/vector/types.ts'
import {
  illustratorDocumentToVectorDocument,
  vectorDocumentToIllustratorDocument,
} from '../engine/vector/legacyIllustratorAdapter.ts'
import type { CutSpec, PunchShape, SlabKind } from '../engine/carve/geometry.ts'
import { carveOutline } from '../engine/carve/outline.ts'
import { carveFromCut, carveLayerName, roundCarveSpec, slabSpec, type CarveSpec } from '../engine/carve/spec.ts'
import { translateCarve } from '../engine/carve/edit.ts'
import { createEmptyVectorDocument, sanitizeVectorDocument } from '../engine/vector/document.ts'
import { composeVectorMarkCached } from '../engine/vector/export.ts'
import { placeMark, placeSlab } from '../engine/carve/placement.ts'
import type { SurvivalSize } from '../engine/carve/survival.ts'
import { sparkLayers, type Spark } from '../engine/sparks/sparks.ts'
import { getAllModeParamDefaults, getModeGeneratorId, sanitizeBrandInput } from './modes.ts'

type ThemeMode = 'dark' | 'light'

/** How the canvas draws the mark: as a construction sheet, or as the finished ink. */
export type CanvasLook = 'construction' | 'final'

interface UIState {
  theme: ThemeMode
  /** `null` is plain selecting. */
  activeTool: EditorTool | null
  carve: CarveSettings
  /** Size of the canvas in layer units, for placing new slabs. */
  viewport: { width: number; height: number }
  look: CanvasLook
  layersOpen: boolean
  /** Which set of sparks the tray deals. */
  sparkSeed: number
}

/** One layer change inside a single undoable commit. */
export interface LayerEdit {
  layerId: string
  /** New recipe; the path is regenerated from it. */
  carve?: CarveSpec
  /** New path data for free shapes (already in untransformed layer space). */
  pathData?: string
}

export interface LayerEditCommit {
  label: string
  edits: LayerEdit[]
  /** Selection to leave behind; defaults to the current one. */
  select?: string[]
  /** Selected anchor on the single selected layer, or null to clear it. */
  anchor?: { layerId: string; segmentIndex: number } | null
}

export type EditorTool = 'pen' | 'punch' | 'channel' | 'slice'

export interface CarveSettings {
  punchShape: PunchShape
  /** Width of new channels and slices, in layer units. */
  cutWidth: number
  survivalSize: SurvivalSize
  showWeakSpots: boolean
  /** Snap drags to points, edges, alignment and 15° angles (Cmd/Ctrl turns it off while held). */
  snapping: boolean
}

export const DEFAULT_CARVE_SETTINGS: CarveSettings = {
  punchShape: 'circle',
  cutWidth: 44,
  survivalSize: 32,
  showWeakSpots: true,
  snapping: true,
}

interface LogoStore {
  /** `fillColor` is the ink. The other fields are generator parameters: an old generator link sets them, and a saved mark stores them. */
  params: LogoParams
  error: string | null
  ui: UIState
  /** Never missing: an empty canvas is an empty document. `illustrator` mirrors it as layers. */
  vectorDocument: VectorDocument
  illustrator: IllustratorDocument
  vectorUndoStack: VectorCommand[]
  vectorRedoStack: VectorCommand[]

  setParam: <K extends keyof LogoParams>(key: K, value: LogoParams[K]) => void
  setParams: (updates: Partial<LogoParams>) => void
  setError: (error: string | null) => void
  setActiveTool: (tool: EditorTool | null) => void
  setVectorDocument: (doc: VectorDocument) => void
  undoVectorCommand: () => void
  redoVectorCommand: () => void
  setIllustratorDocument: (doc: IllustratorDocument) => void
  selectIllustratorLayer: (id: string | null, additive?: boolean) => void
  updateIllustratorLayer: (id: string, update: Partial<IllustratorLayer>) => void
  updateIllustratorLayerTransform: (
    id: string,
    update: Partial<IllustratorLayer['transform']>,
  ) => void
  duplicateIllustratorLayer: (id: string) => void
  deleteIllustratorLayers: (ids?: string[]) => void
  /** One place in the stack: 'up' is towards the top, where later layers sit. */
  moveIllustratorLayer: (id: string, direction: 'up' | 'down') => void
  toggleIllustratorLayerVisibility: (id: string) => void
  setIllustratorLayerOperation: (id: string, operation: 'add' | 'subtract') => void
  setCarveSettings: (update: Partial<CarveSettings>) => void
  addSlab: (kind: SlabKind) => void
  /** A spark's shapes as layers under everything else, beside the ink: one undo step. */
  dropSpark: (spark: Spark) => void
  /** Resize the selected free shapes together about the middle of the box around them: one undo step. */
  scaleSelection: (factor: number) => void
  setSparkSeed: (seed: number) => void
  shuffleSparks: () => void
  startOver: () => void
  /** Put a saved mark in place of the open document: one undo step for the layers. */
  openSaved: (entry: SavedVariation) => void
  setSelection: (layerIds: string[], anchor?: { layerId: string; segmentIndex: number } | null) => void
  commitLayerEdits: (commit: LayerEditCommit) => void
  setViewport: (viewport: { width: number; height: number }) => void
  toggleLook: () => void
  setLayersOpen: (open: boolean) => void
  addCarveCut: (spec: CutSpec) => void
  /** A closed shape drawn with the pen (layer space): added on top, selected, back to direct editing. */
  addPenShape: (pathData: string) => void
  booleanIllustratorLayers: (op: 'unite' | 'subtract' | 'intersect') => void
  /** Sharp/smooth or delete one point of a free shape: one undo step. */
  editAnchor: (layerId: string, index: number, op: 'toggle-smooth' | 'delete') => void
}

export const useLogoStore = create<LogoStore>()((set) => ({
  params: {
    ...DEFAULT_PARAMS,
    modeParams: getAllModeParamDefaults(),
  },
  error: null,
  ui: {
    theme: readStoredTheme(),
    activeTool: null,
    carve: { ...DEFAULT_CARVE_SETTINGS },
    viewport: { width: 600, height: 600 },
    look: 'construction',
    layersOpen: false,
    sparkSeed: crypto.getRandomValues(new Uint32Array(1))[0],
  },
  ...blankDocument(),
  vectorUndoStack: [],
  vectorRedoStack: [],

  setParam: (key, value) =>
    set((state) => ({
      params: mergeLogoParams(state.params, { [key]: value } as Partial<LogoParams>),
    })),

  setParams: (updates) => set((state) => ({ params: mergeLogoParams(state.params, updates) })),

  setError: (error) => set({ error }),

  setActiveTool: (tool) => set((state) => ({ ui: { ...state.ui, activeTool: tool } })),

  setVectorDocument: (incoming) =>
    set((state) => {
      const vectorDocument = sanitizeVectorDocument(incoming)
      return {
        vectorDocument,
        illustrator: vectorDocumentToIllustratorDocument(vectorDocument, state.illustrator),
        vectorUndoStack: [],
        vectorRedoStack: [],
      }
    }),

  undoVectorCommand: () =>
    set((state) => {
      if (state.vectorUndoStack.length === 0) return {}
      const command = state.vectorUndoStack[state.vectorUndoStack.length - 1]
      const vectorDocument = invertVectorCommand(state.vectorDocument, command)
      return {
        vectorDocument,
        illustrator: vectorDocumentToIllustratorDocument(vectorDocument, state.illustrator),
        vectorUndoStack: state.vectorUndoStack.slice(0, -1),
        vectorRedoStack: [...state.vectorRedoStack, command],
      }
    }),

  redoVectorCommand: () =>
    set((state) => {
      if (state.vectorRedoStack.length === 0) return {}
      const command = state.vectorRedoStack[state.vectorRedoStack.length - 1]
      const vectorDocument = applyVectorCommandToDocument(state.vectorDocument, command)
      return {
        vectorDocument,
        illustrator: vectorDocumentToIllustratorDocument(vectorDocument, state.illustrator),
        vectorUndoStack: [...state.vectorUndoStack, command],
        vectorRedoStack: state.vectorRedoStack.slice(0, -1),
      }
    }),

  setIllustratorDocument: (doc) =>
    set((state) => {
      const vectorDocument = illustratorDocumentToVectorDocument(doc, null, state.params.fillColor)
      return {
        illustrator: vectorDocumentToIllustratorDocument(vectorDocument, doc),
        vectorDocument,
        vectorUndoStack: [],
        vectorRedoStack: [],
      }
    }),

  selectIllustratorLayer: (id, additive = false) =>
    set((state) => {
      const current = state.vectorDocument.selection.targets.map((target) => target.objectId)
      const selectedLayerIds = id
        ? additive
          ? current.includes(id)
            ? current.filter((layerId) => layerId !== id)
            : [...current, id]
          : [id]
        : []
      return selectionUpdate(state, {
        targets: selectedLayerIds.map((objectId) => ({ type: 'object', objectId })),
      })
    }),

  updateIllustratorLayer: (id, update) =>
    set((state) =>
      mutateVectorViaIllustrator(state, 'Update layer', (doc) => ({
        ...doc,
        layers: doc.layers.map((layer) =>
          layer.id === id ? { ...layer, ...update } : layer,
        ),
      })) ?? state,
    ),

  updateIllustratorLayerTransform: (id, update) =>
    set((state) =>
      mutateVectorViaIllustrator(state, 'Transform layer', (doc) => ({
        ...doc,
        layers: doc.layers.map((layer) =>
          layer.id === id
            ? {
                ...layer,
                transform: { ...layer.transform, ...update },
              }
            : layer,
        ),
      })) ?? state,
    ),

  duplicateIllustratorLayer: (id) =>
    set((state) => {
      const vectorUpdate = mutateVectorViaIllustrator(state, 'Duplicate layer', (doc) => {
        const index = doc.layers.findIndex((candidate) => candidate.id === id)
        const layer = doc.layers[index]
        if (!layer) return null
        const nextLayer = duplicateLayer(layer)
        const layers = [...doc.layers]
        layers.splice(index + 1, 0, nextLayer)
        return {
          ...doc,
          layers,
          selectedLayerIds: [nextLayer.id],
          pointSelection: null,
        }
      })
      return vectorUpdate ?? state
    }),

  deleteIllustratorLayers: (ids) =>
    set((state) => {
      const vectorUpdate = mutateVectorViaIllustrator(state, 'Delete layers', (doc) => {
        const selected = ids ?? doc.selectedLayerIds
        if (selected.length === 0) return null
        return {
          ...doc,
          layers: doc.layers.filter((layer) => !selected.includes(layer.id)),
          selectedLayerIds: [],
          pointSelection: null,
        }
      })
      return vectorUpdate ?? state
    }),

  moveIllustratorLayer: (id, direction) =>
    set((state) => {
      const vectorUpdate = mutateVectorViaIllustrator(state, 'Move layer', (doc) => {
        const index = doc.layers.findIndex((layer) => layer.id === id)
        if (index < 0) return null
        const targetIndex = direction === 'up' ? index + 1 : index - 1
        if (targetIndex < 0 || targetIndex >= doc.layers.length) return null
        const layers = [...doc.layers]
        const [layer] = layers.splice(index, 1)
        layers.splice(targetIndex, 0, layer)
        return { ...doc, layers }
      })
      return vectorUpdate ?? state
    }),

  toggleIllustratorLayerVisibility: (id) =>
    set((state) =>
      mutateVectorViaIllustrator(state, 'Toggle layer visibility', (doc) => ({
        ...doc,
        layers: doc.layers.map((layer) =>
          layer.id === id ? { ...layer, visible: !layer.visible } : layer,
        ),
      })) ?? state,
    ),

  setIllustratorLayerOperation: (id, operation) =>
    set((state) =>
      mutateVectorViaIllustrator(state, 'Set layer operation', (doc) => ({
        ...doc,
        layers: doc.layers.map((layer) =>
          layer.id === id ? { ...layer, operation } : layer,
        ),
      })) ?? state,
    ),

  setCarveSettings: (update) =>
    set((state) => ({
      ui: { ...state.ui, carve: { ...state.ui.carve, ...update } },
    })),

  addSlab: (kind) =>
    set((state) => {
      const existing = composeVectorMarkCached(state.vectorDocument)
      const spec = existing.compoundPathData
        ? placeSlab(kind, existing.viewBox, state.ui.viewport)
        : slabSpec(kind)
      const slab = recipeLayer(spec, 'add')
      // New material goes on top: older cuts can't bite into it.
      const update = mutateVectorViaIllustrator(state, 'Add slab', (doc) => ({
        ...doc,
        mode: 'object',
        layers: [...doc.layers, slab],
        selectedLayerIds: [slab.id],
        pointSelection: null,
      }))
      return update ? { ...update, ui: { ...state.ui, activeTool: null } } : state
    }),

  dropSpark: (spark) =>
    set((state) => {
      const existing = composeVectorMarkCached(state.vectorDocument)
      const target = placeMark(
        spark.mark.viewBox,
        SPARK_SPAN,
        existing.compoundPathData ? existing.viewBox : null,
        state.ui.viewport,
      )
      const dropped = sparkLayers(spark, target)
      // A cut removes only what is below it. Underneath, the spark's cuts cannot reach the work already there.
      const update = mutateVectorViaIllustrator(state, 'Add spark', (doc) => ({
        ...doc,
        mode: 'object',
        layers: [...dropped, ...doc.layers],
        selectedLayerIds: dropped.map((layer) => layer.id),
        pointSelection: null,
      }))
      return update ? { ...update, ui: { ...state.ui, activeTool: null } } : state
    }),

  scaleSelection: (factor) =>
    set((state) => {
      const doc = state.illustrator
      if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return {}
      const selected = doc.layers.filter((layer) => doc.selectedLayerIds.includes(layer.id))
      // A recipe is resized by its handles. Scaling its path would turn it into a free shape.
      if (selected.some((layer) => layer.carve)) return {}
      return layerEditsUpdate(state, { label: 'Scale shapes', edits: scaleLayers(selected, factor) })
    }),

  setSparkSeed: (sparkSeed) =>
    set((state) => (state.ui.sparkSeed === sparkSeed ? {} : { ui: { ...state.ui, sparkSeed } })),

  shuffleSparks: () => set((state) => ({ ui: { ...state.ui, sparkSeed: state.ui.sparkSeed + 1 } })),

  startOver: () =>
    set((state) => ({
      ...commitVectorDocumentUpdate(state, state.vectorDocument, slabDocument([], state.params.fillColor), 'Start over'),
      ui: { ...state.ui, activeTool: null },
    })),

  openSaved: (entry) =>
    set((state) => {
      const saved = savedDocument(entry)
      if (!saved) return { error: 'This saved mark could not be read.' }
      const document = sanitizeVectorDocument(saved.document)
      return {
        ...commitVectorDocumentUpdate(state, state.vectorDocument, document, 'Open saved mark'),
        params: { ...state.params, fillColor: saved.inkColor },
        ui: { ...state.ui, activeTool: null },
      }
    }),

  setSelection: (layerIds, anchor) =>
    set((state) =>
      selectionUpdate(state, {
        targets:
          anchor && layerIds.length === 1
            ? [{ type: 'anchor', objectId: anchor.layerId, segmentIndex: anchor.segmentIndex }]
            : layerIds.map((objectId) => ({ type: 'object', objectId })),
      }),
    ),

  commitLayerEdits: (commit) => set((state) => layerEditsUpdate(state, commit)),

  setViewport: (viewport) =>
    set((state) =>
      state.ui.viewport.width === viewport.width && state.ui.viewport.height === viewport.height
        ? {}
        : { ui: { ...state.ui, viewport } },
    ),

  toggleLook: () =>
    set((state) => ({
      ui: { ...state.ui, look: state.ui.look === 'construction' ? 'final' : 'construction' },
    })),

  setLayersOpen: (open) =>
    set((state) => (state.ui.layersOpen === open ? {} : { ui: { ...state.ui, layersOpen: open } })),

  addCarveCut: (spec) =>
    set((state) => {
      const layer = recipeLayer(carveFromCut(spec), 'subtract')
      if (!layer.pathData) return state
      const vectorUpdate = mutateVectorViaIllustrator(state, `Add ${layer.name}`, (doc) => {
        return {
          ...doc,
          mode: 'object',
          layers: [...doc.layers, layer],
          selectedLayerIds: [layer.id],
          pointSelection: null,
        }
      })
      // The carve tool stays active so cuts can be made one after another.
      return vectorUpdate ?? state
    }),

  addPenShape: (pathData) =>
    set((state) => {
      const vectorUpdate = mutateVectorViaIllustrator(state, 'Draw shape', (doc) => {
        const taken = new Set(doc.layers.map((layer) => layer.name))
        let n = doc.layers.length + 1
        while (taken.has(`Shape ${n}`)) n++
        const layer: IllustratorLayer = {
          id: crypto.randomUUID(),
          name: `Shape ${n}`,
          operation: 'add',
          visible: true,
          locked: false,
          pathData,
          fillRule: 'nonzero',
          transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
        }
        return { ...doc, mode: 'object', layers: [...doc.layers, layer], selectedLayerIds: [layer.id], pointSelection: null }
      })
      return vectorUpdate ? { ...vectorUpdate, ui: { ...state.ui, activeTool: null } } : state
    }),

  booleanIllustratorLayers: (op) =>
    set((state) => {
      const vectorUpdate = mutateVectorViaIllustrator(state, `${op} layers`, (doc) => {
        const ids = doc.selectedLayerIds
        if (ids.length < 2) return null
        const selected = ids
          .map((id) => doc.layers.find((layer) => layer.id === id))
          .filter((layer): layer is IllustratorLayer => layer != null)
        if (selected.length < 2) return null
        const result = performIllustratorBoolean(selected, op)
        if (!result) return null
        const insertAt = Math.min(
          ...ids.map((id) => doc.layers.findIndex((layer) => layer.id === id)),
        )
        const remaining = doc.layers.filter((layer) => !ids.includes(layer.id))
        remaining.splice(Math.max(0, insertAt), 0, result)
        return {
          ...doc,
          layers: remaining,
          selectedLayerIds: [result.id],
          pointSelection: null,
        }
      })
      return vectorUpdate ?? state
    }),

  editAnchor: (layerId, index, op) =>
    set((state) => {
      const layer = state.illustrator.layers.find((candidate) => candidate.id === layerId)
      if (!layer || layer.carve) return {}
      const path = bakedEditablePath(layer)
      if (!path || !path.segs[index]) return {}
      if (op === 'delete') {
        const next = deleteAnchor(path, index)
        if (!next) return {}
        return layerEditsUpdate(state, {
          label: 'Delete point',
          edits: [{ layerId, pathData: editablePathToPathData(next) }],
          select: [layerId],
          anchor: null,
        })
      }
      return layerEditsUpdate(state, {
        label: 'Sharp / smooth',
        edits: [{ layerId, pathData: editablePathToPathData(toggleSmooth(path, index)) }],
        select: [layerId],
        anchor: { layerId, segmentIndex: index },
      })
    }),
}))

function commitVectorDocumentUpdate(
  state: LogoStore,
  baseDocument: VectorDocument,
  nextDocument: VectorDocument,
  label: string,
  illustratorHint?: IllustratorDocument | null,
): Partial<LogoStore> {
  const command = createReplaceVectorDocumentCommand(label, baseDocument, nextDocument)
  const vectorDocument = applyVectorCommandToDocument(baseDocument, command)
  return {
    vectorDocument,
    illustrator: vectorDocumentToIllustratorDocument(
      vectorDocument,
      illustratorHint ?? state.illustrator,
    ),
    vectorUndoStack: capHistory([...state.vectorUndoStack, command]),
    vectorRedoStack: [],
  }
}

function mutateVectorViaIllustrator(
  state: LogoStore,
  label: string,
  mutate: (doc: IllustratorDocument) => IllustratorDocument | null,
): Partial<LogoStore> | null {
  const baseDocument = state.vectorDocument
  const legacyDocument = vectorDocumentToIllustratorDocument(baseDocument, state.illustrator)
  const nextLegacyDocument = mutate(structuredClone(legacyDocument) as IllustratorDocument)
  if (!nextLegacyDocument) return null
  const nextVectorDocument = illustratorDocumentToVectorDocument(
    nextLegacyDocument,
    baseDocument,
    state.params.fillColor,
  )
  return commitVectorDocumentUpdate(
    state,
    baseDocument,
    nextVectorDocument,
    label,
    nextLegacyDocument,
  )
}

function layerEditsUpdate(state: LogoStore, commit: LayerEditCommit): Partial<LogoStore> {
  const update = mutateVectorViaIllustrator(state, commit.label, (doc) => {
    let changed = false
    const layers = doc.layers.map((layer) => {
      const edit = commit.edits.find((candidate) => candidate.layerId === layer.id)
      if (!edit) return layer
      if (edit.carve) {
        const carve = roundCarveSpec(edit.carve)
        const pathData = carveOutline(carve).pathData
        if (layer.carve && JSON.stringify(layer.carve) === JSON.stringify(carve) && isIdentity(layer.transform)) {
          return layer
        }
        changed = true
        return { ...layer, carve, pathData, transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM } }
      }
      if (edit.pathData !== undefined && edit.pathData !== layer.pathData) {
        changed = true
        const next: IllustratorLayer = {
          ...layer,
          pathData: edit.pathData,
          transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
        }
        delete next.carve
        return next
      }
      return layer
    })
    if (!changed) return null
    const selectedLayerIds = commit.select ?? doc.selectedLayerIds
    const pointSelection =
      commit.anchor === undefined
        ? doc.pointSelection
        : commit.anchor
          ? { layerId: commit.anchor.layerId, segmentIndex: commit.anchor.segmentIndex, handle: 'anchor' as const }
          : null
    return { ...doc, layers, selectedLayerIds, pointSelection }
  })
  return update ?? {}
}

/** Vector Maker's own history is capped; each step stores two documents. */
const MAX_VECTOR_HISTORY = 100

function capHistory<T>(stack: T[]): T[] {
  return stack.length > MAX_VECTOR_HISTORY ? stack.slice(stack.length - MAX_VECTOR_HISTORY) : stack
}

/**
 * Change the selection without entering the undo history. Undo restores the
 * selection captured with each edit, so redo stays valid too.
 */
function selectionUpdate(state: LogoStore, selection: VectorSelection): Partial<LogoStore> {
  const vectorDocument = { ...state.vectorDocument, selection }
  return {
    vectorDocument,
    illustrator: vectorDocumentToIllustratorDocument(vectorDocument, state.illustrator),
  }
}

function isIdentity(t: IllustratorLayer['transform']): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0
}

/** The document the app opens on. */
function blankDocument(): Pick<LogoStore, 'vectorDocument' | 'illustrator'> {
  const vectorDocument = createEmptyVectorDocument()
  return { vectorDocument, illustrator: vectorDocumentToIllustratorDocument(vectorDocument) }
}

/** A document that starts from slabs, with no generated mark behind it. */
function slabDocument(layers: IllustratorLayer[], fillColor: string): VectorDocument {
  const legacy: IllustratorDocument = {
    id: crypto.randomUUID(),
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers,
    selectedLayerIds: layers.length ? [layers[layers.length - 1].id] : [],
    pointSelection: null,
    mode: 'object',
  }
  const doc = illustratorDocumentToVectorDocument(legacy, null, fillColor)
  doc.name = 'Slab'
  return doc
}

/** A layer generated from a recipe: the path always comes from the (rounded) recipe. */
function recipeLayer(spec: CarveSpec, operation: 'add' | 'subtract'): IllustratorLayer {
  const carve = roundCarveSpec(spec)
  return {
    id: crypto.randomUUID(),
    name: carveLayerName(carve),
    operation,
    visible: true,
    locked: false,
    pathData: carveOutline(carve).pathData,
    fillRule: 'evenodd',
    transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
    carve,
  }
}

/** How long a dropped spark is on its longer side. The canvas shows 600 units across. */
const SPARK_SPAN = 360

const DUPLICATE_OFFSET = 12

/** A copy offset down-right. Recipe layers move their recipe, not a transform. */
function duplicateLayer(layer: IllustratorLayer): IllustratorLayer {
  const copy: IllustratorLayer = {
    ...structuredClone(layer),
    id: crypto.randomUUID(),
    name: `${layer.name} copy`,
    sourceShapeId: undefined,
    locked: false,
  }
  if (layer.carve) {
    const carve = roundCarveSpec(translateCarve(layer.carve, { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET }))
    return { ...copy, carve, pathData: carveOutline(carve).pathData }
  }
  return {
    ...copy,
    transform: {
      ...layer.transform,
      dx: layer.transform.dx + DUPLICATE_OFFSET,
      dy: layer.transform.dy + DUPLICATE_OFFSET,
    },
  }
}

// Storage can be missing (tests, server rendering) or throw (blocked site data).
function readStoredTheme(): ThemeMode {
  try {
    if (typeof window === 'undefined') return 'dark'
    return (window.localStorage.getItem('dalat.theme') as ThemeMode) || 'dark'
  } catch {
    return 'dark'
  }
}

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

function performIllustratorBoolean(
  layers: IllustratorLayer[],
  op: 'unite' | 'subtract' | 'intersect',
): IllustratorLayer | null {
  const scope = getBooleanScope()
  scope.project.clear()

  const items: paper.PathItem[] = []
  for (const layer of layers) {
    const item = getLayerPathItem(scope, layer, true)
    if (!item) return null
    items.push(item)
  }

  if (items.length < 2) return null

  let result = items[0]
  for (let i = 1; i < items.length; i++) {
    try {
      const next =
        op === 'unite'
          ? result.unite(items[i])
          : op === 'subtract'
            ? result.subtract(items[i])
            : result.intersect(items[i])
      result.remove()
      items[i].remove()
      result = next
    } catch {
      return null
    }
  }

  const pathData = result.pathData
  result.remove()
  scope.project.clear()

  if (!pathData) return null

  return {
    id: crypto.randomUUID(),
    name: `${op} result`,
    operation: layers[0].operation,
    visible: true,
    locked: false,
    pathData,
    fillRule: 'evenodd',
    transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
  }
}

