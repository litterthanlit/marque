import paper from 'paper'
import { create } from 'zustand'
import type { LogoParams } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import type { IllustratorDocument, IllustratorLayer, PointSelection } from '../engine/illustrator/types.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../engine/illustrator/types.ts'
import { bakedEditableShape } from '../engine/illustrator/layerPath.ts'
import { deleteAnchor, editablePathToPathData, toggleSmooth } from '../engine/path/editPath.ts'
import { getLayerPathItem } from '../engine/illustrator/compose.ts'
import { savedDocument, type SavedVariation } from '../engine/vector/saved.ts'
import type { Contour, Guide, PathObject, VectorDocument, VectorObject, VectorSelection } from '../engine/vector/types.ts'
import { readLegacyLayers } from '../engine/vector/migrate.ts'
import {
  pointSelectionToVectorSelection,
  vectorDocumentToIllustratorDocument,
  vectorObjectToLayer,
} from '../engine/vector/view.ts'
import type { CutSpec, PunchShape, SlabKind } from '../engine/carve/geometry.ts'
import { carveOutline } from '../engine/carve/outline.ts'
import { carveFromCut, carveLayerName, roundCarveSpec, slabSpec, type CarveSpec } from '../engine/carve/spec.ts'
import { translateCarve } from '../engine/carve/edit.ts'
import { createEmptyVectorDocument, repairStructure, sanitizeVectorDocument } from '../engine/vector/document.ts'
import { detachGuide, follow, type DocumentLists } from '../engine/vector/follow.ts'
import { closedContourOf, constructionLines, makeGuide, moveGuideShape, tangentFrame, type GuideShape, type GuideStyle } from '../engine/vector/guides.ts'
import { asCircle, type Circle } from '../engine/geometry/asCircle.ts'
import { composeVectorMarkCached } from '../engine/vector/export.ts'
import { placeMark, placeSlab } from '../engine/carve/placement.ts'
import type { SurvivalSize } from '../engine/carve/survival.ts'
import { sparkLayers, type Spark } from '../engine/sparks/sparks.ts'
import { getAllModeParamDefaults, getModeGeneratorId, sanitizeBrandInput } from './modes.ts'
import {
  deepFreeze,
  insertObjects,
  moveObject,
  objectFromLayer,
  removeObjects,
  updateObject,
  updateObjects,
  writeFrame,
  writeLayerFields,
  writePathData,
  writePin,
  writeRecipe,
} from './objectEdits.ts'

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
  /** Guides draw in the construction look while this is on. View state: never in the history or the link. */
  showGuides: boolean
  /** The line new guides take. */
  guideStyle: GuideStyle
  /** What a drag of the Guide tool draws. */
  guideDraws: GuideDraws
  /** What the pen makes when it finishes: a filled shape, or a path guide. */
  penDraws: PenDraws
}

export type PenDraws = 'shape' | 'guide'
export type GuideDraws = 'line' | 'circle'

/** One layer change inside a single undoable commit. */
export interface LayerEdit {
  layerId: string
  /** New recipe; the path is regenerated from it. */
  carve?: CarveSpec
  /** New path data for free shapes (already in untransformed layer space). */
  pathData?: string
  /** With `pathData`: the one contour it replaces, the others kept as they are. Missing replaces them all. */
  contourIndex?: number
  /** How far a free shape's box is turned after the edit, in degrees. Missing keeps its frame as it was. */
  frameRotation?: number
  /** Pin the recipe's centre to this object's centre, or with null let it go. Missing keeps its pin as it was. */
  pin?: string | null
}

export interface LayerEditCommit {
  label: string
  edits: LayerEdit[]
  /** Selection to leave behind; defaults to the current one. */
  select?: string[]
  /** Selected anchor on the single selected layer, or null to clear it. */
  anchor?: AnchorRef | null
  /** A key edit that joins the one just before it into one undo step: see `HISTORY_MERGE_MS`. */
  merge?: HistoryMergeKind
}

/** One anchor of a layer: which contour (0 when missing) and which point on it. */
export interface AnchorRef {
  layerId: string
  segmentIndex: number
  contourIndex?: number
}

/** Key edits that run together into one undo step: arrow nudges, and turns and scales with Alt. */
export type HistoryMergeKind = 'nudge' | 'key-turn' | 'key-scale'

export type EditorTool = 'pen' | 'punch' | 'channel' | 'slice' | 'guide'

/**
 * One undo step. It holds the document's lists (objects, guides, fillets)
 * from before and after the edit by reference, never copies: undo puts the
 * earlier arrays back, so every cache keyed on them still hits. Selection is
 * restored with the step but is never a step of its own.
 */
export interface HistoryStep {
  id: string
  label: string
  timestamp: number
  before: DocumentLists
  after: DocumentLists
  selectionBefore: VectorSelection
  selectionAfter: VectorSelection
  /** Set when the edit replaced the whole document (Start over, opening a saved mark): its name, id and source. */
  documents?: { before: VectorDocument; after: VectorDocument }
  /** Set on a key edit: what it was and on which layers, and when the last edit joined it. */
  merge?: { key: string; at: number }
}

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
  /** Never missing: an empty canvas is an empty document. Every edit writes it directly. */
  vectorDocument: VectorDocument
  /** What is selected: beside the document, never in it, so links and saved marks leave it out. */
  selection: VectorSelection
  /** The document and selection seen as layers, for the canvas and the panels. Derived, never written. */
  illustrator: IllustratorDocument
  vectorUndoStack: HistoryStep[]
  vectorRedoStack: HistoryStep[]

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
  setSparkSeed: (seed: number) => void
  shuffleSparks: () => void
  startOver: () => void
  /** Put a saved mark in place of the open document: one undo step for the layers. */
  openSaved: (entry: SavedVariation) => void
  setSelection: (layerIds: string[], anchor?: AnchorRef | null) => void
  commitLayerEdits: (commit: LayerEditCommit) => void
  setViewport: (viewport: { width: number; height: number }) => void
  toggleLook: () => void
  setLayersOpen: (open: boolean) => void
  /** A cut drawn with a carve tool, on top and selected; `pinTo` pins a punch's centre to that object's centre. */
  addCarveCut: (spec: CutSpec, pinTo?: string | null) => void
  /** Let go of the selected recipes' pins: one undo step. */
  unpinSelection: () => void
  /** Let go of every pin held to an object's centre: one undo step. */
  releasePinsTo: (id: string) => void
  /** A closed shape drawn with the pen (layer space): added on top, selected, back to direct editing. */
  addPenShape: (pathData: string) => void
  booleanIllustratorLayers: (op: 'unite' | 'subtract' | 'intersect') => void
  /** Sharp/smooth or delete one point of a free shape, on its first contour or another: one undo step. */
  editAnchor: (layerId: string, index: number, op: 'toggle-smooth' | 'delete', contourIndex?: number) => void

  /* Guides: every edit is one undo step, and none of them touches the objects. */
  /** Cmd+;, the toolbar's switch and the drawer's: view state, outside the history and the link. */
  toggleShowGuides: () => void
  setGuideStyle: (style: GuideStyle) => void
  setPenDraws: (draws: PenDraws) => void
  setGuideDraws: (draws: GuideDraws) => void
  /** New guides in the style for new guides: selected, unless `select` is false, when the selection stays as it is. */
  addGuides: (shapes: Array<GuideShape | { shape: GuideShape; link?: NonNullable<Guide['link']>; name?: string }>, label?: string, select?: boolean) => void
  /** Guides by id, or `null` for none; `additive` toggles them in the guides already selected. Guides not on the canvas are never picked. */
  selectGuides: (ids: string[] | null, additive?: boolean) => void
  /** The whole list of guides after a canvas gesture: one undo step. */
  commitGuides: (label: string, guides: Guide[], select?: string[]) => void
  setGuidesStyle: (ids: string[], style: GuideStyle) => void
  setGuidesLocked: (ids: string[], locked: boolean) => void
  toggleGuideVisibility: (id: string) => void
  /** Move the selected guides shown and not locked by `d`, detached from their shapes; a burst of nudges is one undo step. */
  nudgeGuides: (d: { x: number; y: number }) => void
  /** The given guides, or the selected ones. */
  deleteGuides: (ids?: string[]) => void
  /** The given construction guides, or the selected ones, become plain guides. */
  detachGuides: (ids?: string[]) => void
  /** Each closed path guide among the selected becomes a shape that adds. */
  makeShapeFromGuides: () => void
  /** Each contour of each selected path becomes a path guide; the paths go. */
  makeGuidesFromSelection: () => void
  /** Construction guides of the selected shapes, linked to them. */
  addConstructionGuides: (ids?: string[]) => void
  /** The four upright lines touching the selected circles, linked to them. */
  addTangentFrame: () => void
  /** A path the pen drew in its Guide mode, kept as a guide and selected; back to selecting. */
  addPenGuide: (contour: Contour) => void
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
    showGuides: true,
    guideStyle: 'solid',
    guideDraws: 'line',
    penDraws: 'shape',
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

  setActiveTool: (tool) =>
    set((state) => {
      const ui = { ...state.ui, activeTool: tool }
      // A tool that makes guides puts them on the canvas, so what it makes can be seen.
      return { ui: tool === 'guide' || (tool === 'pen' && ui.penDraws === 'guide') ? guidesOnCanvas(ui) : ui }
    }),

  setVectorDocument: (incoming) =>
    set((state) => {
      // Opening is no undo step, and what opening repairs is none either.
      const vectorDocument = sanitizeVectorDocument(incoming)
      if (!vectorDocument) return { error: 'This document could not be read.' }
      freezeInDevelopment([], vectorDocument.objects)
      freezeInDevelopment([], vectorDocument.guides)
      const selection: VectorSelection = { targets: [] }
      return {
        vectorDocument,
        selection,
        illustrator: vectorDocumentToIllustratorDocument(vectorDocument, selection, state.illustrator),
        vectorUndoStack: [],
        vectorRedoStack: [],
      }
    }),

  undoVectorCommand: () =>
    set((state) => {
      const step = state.vectorUndoStack.at(-1)
      if (!step) return {}
      return {
        ...restoreStep(state, step.documents?.before, step.before, step.selectionBefore),
        vectorUndoStack: state.vectorUndoStack.slice(0, -1),
        vectorRedoStack: [...state.vectorRedoStack, step],
      }
    }),

  redoVectorCommand: () =>
    set((state) => {
      const step = state.vectorRedoStack.at(-1)
      if (!step) return {}
      return {
        ...restoreStep(state, step.documents?.after, step.after, step.selectionAfter),
        // A redone step is finished: the next key starts a step of its own.
        vectorUndoStack: [...state.vectorUndoStack, withoutMerge(step)],
        vectorRedoStack: state.vectorRedoStack.slice(0, -1),
      }
    }),

  setIllustratorDocument: (doc) =>
    set((state) => {
      const vectorDocument = readLegacyLayers(doc, state.params.fillColor)
      if (!vectorDocument) return { error: 'This document could not be read.' }
      freezeInDevelopment([], vectorDocument.objects)
      freezeInDevelopment([], vectorDocument.guides)
      const selection: VectorSelection = { targets: [] }
      return {
        illustrator: vectorDocumentToIllustratorDocument(vectorDocument, selection, state.illustrator),
        vectorDocument,
        selection,
        vectorUndoStack: [],
        vectorRedoStack: [],
      }
    }),

  selectIllustratorLayer: (id, additive = false) =>
    set((state) => {
      const current = objectIdsOf(state.selection)
      const selectedLayerIds = id
        ? additive
          ? current.includes(id)
            ? current.filter((layerId) => layerId !== id)
            : [...current, id]
          : [id]
        : []
      return selectionUpdate(state, objectSelection(selectedLayerIds))
    }),

  updateIllustratorLayer: (id, update) => set((state) => layerUpdate(state, 'Update layer', id, (layer) => ({ ...layer, ...update }))),

  duplicateIllustratorLayer: (id) =>
    set((state) => {
      const objects = state.vectorDocument.objects
      const index = objects.findIndex((candidate) => candidate.id === id)
      const original = objects[index]
      if (!original || original.type !== 'path') return {}
      // The copy sits just above, in the same group.
      const copy: VectorObject = { ...objectFromLayer(duplicateLayer(vectorObjectToLayer(original))), parentId: original.parentId }
      return commitObjects(state, 'Duplicate layer', insertObjects(objects, [copy], index + 1), objectSelection([copy.id]))
    }),

  deleteIllustratorLayers: (ids) =>
    set((state) => {
      const selected = ids ?? state.illustrator.selectedLayerIds
      if (selected.length === 0) return {}
      return commitObjects(state, 'Delete layers', removeObjects(state.vectorDocument.objects, selected), objectSelection([]))
    }),

  moveIllustratorLayer: (id, direction) =>
    set((state) => commitObjects(state, 'Move layer', moveObject(state.vectorDocument.objects, id, direction))),

  toggleIllustratorLayerVisibility: (id) =>
    set((state) => layerUpdate(state, 'Toggle layer visibility', id, (layer) => ({ ...layer, visible: !layer.visible }))),

  setIllustratorLayerOperation: (id, operation) =>
    set((state) => layerUpdate(state, 'Set layer operation', id, (layer) => ({ ...layer, operation }))),

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
      const slab = objectFromLayer(recipeLayer(spec, 'add'))
      // New material goes on top: older cuts can't bite into it.
      return {
        ...commitObjects(state, 'Add slab', insertObjects(state.vectorDocument.objects, [slab], 'top'), objectSelection([slab.id])),
        ui: { ...state.ui, activeTool: null },
      }
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
      const dropped = sparkLayers(spark, target).map((layer) => objectFromLayer(layer))
      // A cut removes only what is below it. Underneath, the spark's cuts cannot reach the work already there.
      return {
        ...commitObjects(state, 'Add spark', insertObjects(state.vectorDocument.objects, dropped, 'bottom'), objectSelection(idsOf(dropped))),
        ui: { ...state.ui, activeTool: null },
      }
    }),

  setSparkSeed: (sparkSeed) =>
    set((state) => (state.ui.sparkSeed === sparkSeed ? {} : { ui: { ...state.ui, sparkSeed } })),

  shuffleSparks: () => set((state) => ({ ui: { ...state.ui, sparkSeed: state.ui.sparkSeed + 1 } })),

  startOver: () =>
    set((state) => {
      const document = slabDocument()
      return {
        ...commitObjects(state, 'Start over', document.objects, { targets: [] }, document),
        ui: { ...state.ui, activeTool: null },
      }
    }),

  openSaved: (entry) =>
    set((state) => {
      // An older entry is upgraded here, as it opens, and never rewritten in storage.
      const saved = savedDocument(entry)
      if (!saved) return { error: 'This saved mark could not be read.' }
      const document = saved.document
      return {
        ...commitObjects(state, 'Open saved mark', document.objects, { targets: [] }, document),
        params: { ...state.params, fillColor: saved.inkColor },
        ui: { ...state.ui, activeTool: null },
      }
    }),

  setSelection: (layerIds, anchor) =>
    set((state) =>
      selectionUpdate(state, {
        targets:
          anchor && layerIds.length === 1
            ? [{ type: 'anchor', objectId: anchor.layerId, contourIndex: anchor.contourIndex ?? 0, segmentIndex: anchor.segmentIndex }]
            : layerIds.map((objectId) => ({ type: 'object', objectId })),
      }),
    ),

  commitLayerEdits: (commit) => set((state) => applyLayerEdits(state, commit)),

  setViewport: (viewport) =>
    set((state) =>
      state.ui.viewport.width === viewport.width && state.ui.viewport.height === viewport.height
        ? {}
        : { ui: { ...state.ui, viewport } },
    ),

  toggleLook: () =>
    set((state) => withGuidesSeen(state, { ...state.ui, look: state.ui.look === 'construction' ? 'final' : 'construction' })),

  setLayersOpen: (open) =>
    set((state) => (state.ui.layersOpen === open ? {} : { ui: { ...state.ui, layersOpen: open } })),

  addCarveCut: (spec, pinTo = null) =>
    set((state) => {
      const layer = recipeLayer(carveFromCut(spec), 'subtract')
      if (!layer.pathData) return {}
      const made = objectFromLayer(layer)
      const target = pinTo ? state.vectorDocument.objects.find((object) => object.id === pinTo) : undefined
      const cut = target ? writePin(made, target.id) : made
      // The carve tool stays active so cuts can be made one after another.
      return commitObjects(state, `Add ${layer.name}`, insertObjects(state.vectorDocument.objects, [cut], 'top'), objectSelection([cut.id]))
    }),

  unpinSelection: () =>
    set((state) => {
      const ids = new Set(state.illustrator.selectedLayerIds)
      const objects = updateObjects(state.vectorDocument.objects, (object) =>
        object.type === 'path' && ids.has(object.id) ? writePin(object, null) : object,
      )
      return commitObjects(state, 'Unpin', objects)
    }),

  releasePinsTo: (id) =>
    set((state) => {
      const objects = updateObjects(state.vectorDocument.objects, (object) =>
        object.type === 'path' && object.pin?.centreOf === id ? writePin(object, null) : object,
      )
      return commitObjects(state, 'Release pins', objects)
    }),

  addPenShape: (pathData) =>
    set((state) => {
      const layer: IllustratorLayer = {
        id: crypto.randomUUID(),
        name: shapeNames(state)(),
        operation: 'add',
        visible: true,
        locked: false,
        pathData,
        fillRule: 'nonzero',
        transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
      }
      const shape = objectFromLayer(layer)
      return {
        ...commitObjects(state, 'Draw shape', insertObjects(state.vectorDocument.objects, [shape], 'top'), objectSelection([shape.id])),
        ui: { ...state.ui, activeTool: null },
      }
    }),

  booleanIllustratorLayers: (op) =>
    set((state) => {
      const doc = state.illustrator
      const ids = doc.selectedLayerIds
      if (ids.length < 2) return {}
      // In the order they were selected, not the order they are stacked.
      const selected = ids
        .map((id) => doc.layers.find((layer) => layer.id === id))
        .filter((layer): layer is IllustratorLayer => layer != null)
      if (selected.length < 2) return {}
      const result = performIllustratorBoolean(selected, op)
      if (!result) return {}
      const objects = state.vectorDocument.objects
      const insertAt = Math.min(...ids.map((id) => objects.findIndex((object) => object.id === id)))
      // One object, however many contours: a hole stays a hole. It stays in the group its inputs share.
      const parents = new Set(ids.map((id) => objects.find((object) => object.id === id)?.parentId ?? null))
      const made: VectorObject = { ...objectFromLayer(result), parentId: parents.size === 1 ? [...parents][0] : null }
      const next = insertObjects(removeObjects(objects, ids), [made], Math.max(0, insertAt))
      return commitObjects(state, `${op} layers`, next, objectSelection([made.id]))
    }),

  editAnchor: (layerId, index, op, contourIndex = 0) =>
    set((state) => {
      const layer = state.illustrator.layers.find((candidate) => candidate.id === layerId)
      if (!layer || layer.carve) return {}
      const path = bakedEditableShape(layer)?.[contourIndex]
      if (!path || !path.segs[index]) return {}
      if (op === 'delete') {
        const next = deleteAnchor(path, index)
        if (!next) return {}
        return applyLayerEdits(state, {
          label: 'Delete point',
          edits: [{ layerId, contourIndex, pathData: editablePathToPathData(next) }],
          select: [layerId],
          anchor: null,
        })
      }
      return applyLayerEdits(state, {
        label: 'Sharp / smooth',
        edits: [{ layerId, contourIndex, pathData: editablePathToPathData(toggleSmooth(path, index)) }],
        select: [layerId],
        anchor: { layerId, contourIndex, segmentIndex: index },
      })
    }),

  toggleShowGuides: () => set((state) => withGuidesSeen(state, { ...state.ui, showGuides: !state.ui.showGuides })),

  setGuideStyle: (guideStyle) => set((state) => (state.ui.guideStyle === guideStyle ? {} : { ui: { ...state.ui, guideStyle } })),

  setPenDraws: (penDraws) =>
    set((state) => {
      if (state.ui.penDraws === penDraws) return {}
      const ui = { ...state.ui, penDraws }
      return { ui: penDraws === 'guide' ? guidesOnCanvas(ui) : ui }
    }),

  setGuideDraws: (guideDraws) => set((state) => (state.ui.guideDraws === guideDraws ? {} : { ui: { ...state.ui, guideDraws } })),

  addGuides: (entries, label = 'Add guide', select = true) =>
    set((state) => {
      if (!entries.length) return {}
      const style = state.ui.guideStyle
      const added = entries.map((entry) => ('kind' in entry ? makeGuide(entry, style) : makeGuide(entry.shape, style, entry.link, entry.name)))
      const selection = select ? guideSelection(idsOf(added)) : undefined
      return revealGuides(state, commitGuideList(state, added.length > 1 ? 'Add guides' : label, [...state.vectorDocument.guides, ...added], selection))
    }),

  selectGuides: (ids, additive = false) =>
    set((state) => {
      if (!ids) return selectionUpdate(state, { targets: [] })
      // Only a guide on the canvas can be picked: the bar and Delete never act on one unseen.
      const seen = new Set(idsOf(seenGuides(state)))
      const picked = ids.filter((id) => seen.has(id))
      if (ids.length && !picked.length) return {}
      const current = guideIdsOf(state.selection)
      const next = additive
        ? [...current.filter((id) => !picked.includes(id)), ...picked.filter((id) => !current.includes(id))]
        : picked
      return selectionUpdate(state, guideSelection(next))
    }),

  commitGuides: (label, guides, select) =>
    set((state) => {
      // As selectGuides: only guides on the canvas can end up selected.
      const seen = new Set(idsOf(seenGuides({ ui: state.ui, vectorDocument: { ...state.vectorDocument, guides } })))
      const selection = select ? guideSelection(select.filter((id) => seen.has(id))) : undefined
      return commitGuideList(state, label, guides, selection)
    }),

  setGuidesStyle: (ids, style) =>
    set((state) => commitGuideList(state, 'Guide style', updateGuides(state.vectorDocument.guides, ids, (guide) => (guide.style === style ? guide : { ...guide, style })))),

  setGuidesLocked: (ids, locked) =>
    set((state) =>
      commitGuideList(
        state,
        locked ? 'Lock guide' : 'Unlock guide',
        updateGuides(state.vectorDocument.guides, ids, (guide) => (guide.locked === locked ? guide : { ...guide, locked })),
      ),
    ),

  toggleGuideVisibility: (id) =>
    set((state) => {
      const guide = state.vectorDocument.guides.find((candidate) => candidate.id === id)
      if (!guide) return {}
      // A guide turned off leaves the selection, as all of them do when they leave the canvas.
      const selected = guideIdsOf(state.selection)
      const selection = guide.visible && selected.includes(id) ? guideSelection(selected.filter((each) => each !== id)) : undefined
      return commitGuideList(
        state,
        guide.visible ? 'Hide guide' : 'Show guide',
        updateGuides(state.vectorDocument.guides, [id], (each) => ({ ...each, visible: !each.visible })),
        selection,
      )
    }),

  deleteGuides: (ids) =>
    set((state) => {
      // Without ids, the selection: only guides on the canvas, so Delete never removes one unseen.
      const seen = new Set(idsOf(seenGuides(state)))
      const selected = guideIdsOf(state.selection)
      const gone = new Set(ids ?? selected.filter((id) => seen.has(id)))
      if (gone.size === 0) return {}
      const guides = state.vectorDocument.guides.filter((guide) => !gone.has(guide.id))
      if (guides.length === state.vectorDocument.guides.length) return {}
      // A selection of layers stays: only a selection of guides loses the deleted ones.
      const selection = selected.length ? guideSelection(selected.filter((id) => !gone.has(id))) : undefined
      return commitGuideList(state, gone.size > 1 ? 'Delete guides' : 'Delete guide', guides, selection)
    }),

  nudgeGuides: (d) =>
    set((state) => {
      const selected = new Set(guideIdsOf(state.selection))
      const moving = idsOf(seenGuides(state).filter((guide) => selected.has(guide.id) && !guide.locked))
      if (!moving.length || (d.x === 0 && d.y === 0)) return {}
      const guides = updateGuides(state.vectorDocument.guides, moving, (guide) => ({ ...detachGuide(guide), shape: moveGuideShape(guide.shape, d) }))
      // As a layer nudge: a burst on the same guides is one undo step.
      return commitDocument(state, moving.length > 1 ? 'Nudge guides' : 'Nudge guide', { guides }, undefined, undefined, `nudge-guides ${moving.join(' ')}`)
    }),

  detachGuides: (ids) =>
    set((state) =>
      commitGuideList(state, 'Detach guide', updateGuides(state.vectorDocument.guides, ids ?? guideIdsOf(state.selection), detachGuide)),
    ),

  makeShapeFromGuides: () =>
    set((state) => {
      const chosen = new Set(guideIdsOf(state.selection))
      const made: Array<{ guide: Guide; shape: PathObject }> = []
      const nextName = shapeNames(state)
      for (const guide of state.vectorDocument.guides) {
        if (!chosen.has(guide.id)) continue
        const contour = closedContourOf(guide.shape)
        if (!contour) continue
        const name = nextName()
        made.push({
          guide,
          shape: { id: crypto.randomUUID(), type: 'path', name, parentId: null, visible: true, locked: false, operation: 'add', contours: [contour], fillRule: 'nonzero' },
        })
      }
      if (!made.length) return {}
      const used = new Set(made.map(({ guide }) => guide.id))
      return commitDocument(
        state,
        'Make shape',
        {
          objects: insertObjects(state.vectorDocument.objects, made.map(({ shape }) => shape), 'top'),
          guides: state.vectorDocument.guides.filter((guide) => !used.has(guide.id)),
        },
        objectSelection(made.map(({ shape }) => shape.id)),
      )
    }),

  makeGuidesFromSelection: () =>
    set((state) => {
      const ids = new Set(state.illustrator.selectedLayerIds)
      const paths = state.vectorDocument.objects.filter((object): object is PathObject => object.type === 'path' && ids.has(object.id))
      const added = paths.flatMap((object) =>
        object.contours.filter((contour) => contour.segments.length > 1).map((contour) => makeGuide({ kind: 'path', contour }, state.ui.guideStyle)),
      )
      if (!added.length) return {}
      return revealGuides(
        state,
        commitDocument(
          state,
          'Make guide',
          { objects: removeObjects(state.vectorDocument.objects, idsOf(paths)), guides: [...state.vectorDocument.guides, ...added] },
          guideSelection(idsOf(added)),
        ),
      )
    }),

  addConstructionGuides: (ids) =>
    set((state) => {
      const wanted = new Set(ids ?? state.illustrator.selectedLayerIds)
      const style = state.ui.guideStyle
      const guides = state.vectorDocument.guides
      const added: Guide[] = []
      for (const object of state.vectorDocument.objects) {
        if (object.type !== 'path' || !wanted.has(object.id)) continue
        for (const { role, shape, name } of constructionLines(object)) {
          if (hasLink(guides, object.id, role)) continue
          added.push(makeGuide(shape, style, { kind: 'construction', of: object.id, role }, name))
        }
      }
      if (!added.length) return {}
      return revealGuides(state, commitGuideList(state, 'Add construction guides', [...guides, ...added], guideSelection(idsOf(added))))
    }),

  addTangentFrame: () =>
    set((state) => {
      const circles = tangentCircles(state)
      if (!circles) return {}
      const guides = state.vectorDocument.guides
      const added = tangentFrame(circles)
        .filter(({ of, role }) => !hasLink(guides, of, role))
        .map(({ of, role, shape }) => makeGuide(shape, state.ui.guideStyle, { kind: 'construction', of, role }))
      if (!added.length) return {}
      return revealGuides(state, commitGuideList(state, 'Add tangent frame', [...guides, ...added], guideSelection(idsOf(added))))
    }),

  addPenGuide: (contour) =>
    set((state) => {
      const guide = makeGuide({ kind: 'path', contour }, state.ui.guideStyle)
      return {
        ...commitGuideList(state, 'Draw guide', [...state.vectorDocument.guides, guide], guideSelection([guide.id])),
        ui: guidesOnCanvas({ ...state.ui, activeTool: null }),
      }
    }),
}))

/** The guides drawn on the canvas now: none while they are hidden, and none turned off. */
function seenGuides(state: Pick<LogoStore, 'ui' | 'vectorDocument'>): Guide[] {
  return guidesShown(state.ui) ? state.vectorDocument.guides.filter((guide) => guide.visible) : []
}

/** Do guides draw on the canvas in this view? */
function guidesShown(ui: UIState): boolean {
  return ui.look === 'construction' && ui.showGuides
}

/**
 * A new view, and the selection without its guides when they leave the
 * canvas: the bar and Delete only ever act on guides that can be seen.
 */
function withGuidesSeen(state: LogoStore, ui: UIState): Partial<LogoStore> {
  if (guidesShown(ui) || !state.selection.targets.some((target) => target.type === 'guide')) return { ui }
  return { ui, ...selectionUpdate(state, { targets: state.selection.targets.filter((target) => target.type !== 'guide') }) }
}

/** The view with guides on the canvas: the construction look, guides shown. */
function guidesOnCanvas(ui: UIState): UIState {
  return guidesShown(ui) ? ui : { ...ui, look: 'construction', showGuides: true }
}

/** An edit that made guides also puts them on the canvas, as Illustrator shows guides when you make one. */
function revealGuides(state: LogoStore, update: Partial<LogoStore>): Partial<LogoStore> {
  if (!update.vectorDocument) return update
  const ui = update.ui ?? state.ui
  const shown = guidesOnCanvas(ui)
  return shown === ui ? update : { ...update, ui: shown }
}

/** Some guides by id through `update`: the same array when none changes. */
function updateGuides(guides: Guide[], ids: Iterable<string>, update: (guide: Guide) => Guide): Guide[] {
  const wanted = new Set(ids)
  let changed = false
  const next = guides.map((guide) => {
    if (!wanted.has(guide.id)) return guide
    const result = update(guide)
    if (result !== guide) changed = true
    return result
  })
  return changed ? next : guides
}

/** Is there already a guide following this line of this object? */
function hasLink(guides: Guide[], of: string, role: string): boolean {
  return guides.some((guide) => guide.link?.of === of && guide.link.role === role)
}

/**
 * The selected objects read as circles, for a tangent frame: null unless
 * there are two or more and every one of them is a circle.
 */
export function tangentCircles(state: Pick<LogoStore, 'illustrator' | 'vectorDocument'>): Array<{ id: string; circle: Circle }> | null {
  const ids = new Set(state.illustrator.selectedLayerIds)
  const chosen = state.vectorDocument.objects.filter((object): object is PathObject => object.type === 'path' && ids.has(object.id))
  if (chosen.length < 2) return null
  const circles = chosen.map((object) => ({ id: object.id, circle: asCircle(object) }))
  return circles.every((entry) => entry.circle !== null) ? (circles as Array<{ id: string; circle: Circle }>) : null
}

/** Names for new shapes, "Shape N", one after another, never one already taken. */
function shapeNames(state: LogoStore): () => string {
  const taken = new Set(state.illustrator.layers.map((layer) => layer.name))
  let n = state.illustrator.layers.length + 1
  return () => {
    while (taken.has(`Shape ${n}`)) n++
    const name = `Shape ${n}`
    taken.add(name)
    return name
  }
}

/** Vector Maker's own history is capped. A step holds two arrays of references, not two documents. */
const MAX_VECTOR_HISTORY = 100

function capHistory<T>(stack: T[]): T[] {
  return stack.length > MAX_VECTOR_HISTORY ? stack.slice(stack.length - MAX_VECTOR_HISTORY) : stack
}

/** How soon after the last key edit the next one of the same kind, on the same layers, joins its undo step. */
export const HISTORY_MERGE_MS = 1000

/**
 * The one way an edit reaches the document. It writes some of its lists:
 * objects, guides or fillets; a list not given stays as it is. The follow
 * pass then brings up to date whatever follows the objects that changed. When
 * every list holds the same items as before, the edit is no step: only a new
 * selection, if one is given, is applied. Otherwise one history step records
 * the lists and selections from both sides, and redo is cleared. `document`
 * replaces the whole document (its id, name, source and lists) along with them.
 *
 * A key edit with a `merge` key joins the newest step instead when that step
 * has the same key, its last edit came less than `HISTORY_MERGE_MS` ago,
 * nothing was undone since and the document is still as it left it: the step
 * keeps its label and where it started, and takes the new end. So a burst of
 * arrow keys is one undo step, yet every key is written at once.
 */
function commitDocument(
  state: LogoStore,
  label: string,
  written: Partial<DocumentLists>,
  selection?: VectorSelection,
  document?: VectorDocument,
  merge?: string,
): Partial<LogoStore> {
  const current = state.vectorDocument
  const base = document ?? current
  const before = listsOf(current)
  // Groups stay runs under their headers, as reading the document would make them.
  const after = follow(before, {
    objects: repairStructure(written.objects ?? base.objects),
    guides: written.guides ?? base.guides,
    fillets: written.fillets ?? base.fillets,
  })
  const lists: DocumentLists = {
    objects: sameItems(before.objects, after.objects) ? before.objects : after.objects,
    guides: sameItems(before.guides, after.guides) ? before.guides : after.guides,
    fillets: sameItems(before.fillets, after.fillets) ? before.fillets : after.fillets,
  }
  if (!document && sameLists(before, lists)) {
    return selection ? selectionUpdate(state, selection) : {}
  }
  freezeInDevelopment(before.objects, lists.objects)
  freezeInDevelopment(before.guides, lists.guides)
  freezeInDevelopment(before.fillets, lists.fillets)
  const selectionAfter = selection ?? state.selection
  const now = Date.now()
  const last = state.vectorUndoStack.at(-1)
  const joins =
    merge !== undefined &&
    !document &&
    last?.merge?.key === merge &&
    now - last.merge.at < HISTORY_MERGE_MS &&
    state.vectorRedoStack.length === 0 &&
    sameLists(last.after, before)
  const step: HistoryStep = joins
    ? { ...last, after: lists, selectionAfter, merge: { key: merge, at: now } }
    : {
        id: crypto.randomUUID(),
        label,
        timestamp: now,
        before,
        after: lists,
        selectionBefore: state.selection,
        selectionAfter,
        ...(document ? { documents: { before: current, after: document } } : {}),
        ...(merge !== undefined ? { merge: { key: merge, at: now } } : {}),
      }
  const vectorDocument: VectorDocument = {
    ...base,
    ...lists,
    updatedAt: new Date().toISOString(),
  }
  return {
    vectorDocument,
    selection: selectionAfter,
    illustrator: vectorDocumentToIllustratorDocument(vectorDocument, selectionAfter, state.illustrator),
    vectorUndoStack: joins ? [...state.vectorUndoStack.slice(0, -1), step] : capHistory([...state.vectorUndoStack, step]),
    vectorRedoStack: [],
  }
}

/** An edit of the objects alone: see `commitDocument`. */
function commitObjects(
  state: LogoStore,
  label: string,
  objects: VectorObject[],
  selection?: VectorSelection,
  document?: VectorDocument,
  merge?: string,
): Partial<LogoStore> {
  return commitDocument(state, label, document ? {} : { objects }, selection, document, merge)
}

/** An edit of the guides alone: the objects keep their array, so nothing recomposes. */
function commitGuideList(state: LogoStore, label: string, guides: Guide[], selection?: VectorSelection): Partial<LogoStore> {
  return commitDocument(state, label, { guides }, selection)
}

function listsOf(document: VectorDocument): DocumentLists {
  return { objects: document.objects, guides: document.guides, fillets: document.fillets }
}

function withoutMerge(step: HistoryStep): HistoryStep {
  if (!step.merge) return step
  const { merge: _merge, ...rest } = step
  return rest
}

/** The same items in the same order: a list rebuilt without a change is no change. */
function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index) => item === b[index]))
}

function sameLists(a: DocumentLists, b: DocumentLists): boolean {
  return a.objects === b.objects && a.guides === b.guides && a.fillets === b.fillets
}

/** The document as a history step left it. The selection keeps only targets that still exist. */
function restoreStep(
  state: LogoStore,
  document: VectorDocument | undefined,
  lists: DocumentLists,
  selection: VectorSelection,
): Pick<LogoStore, 'vectorDocument' | 'selection' | 'illustrator'> {
  const ids = new Set(lists.objects.map((object) => object.id))
  const guideIds = new Set(lists.guides.map((guide) => guide.id))
  const vectorDocument: VectorDocument = {
    ...(document ?? state.vectorDocument),
    ...lists,
    updatedAt: new Date().toISOString(),
  }
  // Guides off the canvas are not selected back: what cannot be seen is not acted on.
  const shown = guidesShown(state.ui)
  const restored: VectorSelection = {
    targets: selection.targets.filter((target) => (target.type === 'guide' ? shown && guideIds.has(target.guideId) : ids.has(target.objectId))),
  }
  return {
    vectorDocument,
    selection: restored,
    illustrator: vectorDocumentToIllustratorDocument(vectorDocument, restored, state.illustrator),
  }
}

/** Development builds freeze each item as it enters the document, so an edit in place throws. */
function freezeInDevelopment<T>(before: readonly T[], after: readonly T[]): void {
  if (!import.meta.env.DEV) return
  const known = new Set(before)
  for (const item of after) if (!known.has(item)) deepFreeze(item)
}

function objectSelection(ids: string[]): VectorSelection {
  return { targets: ids.map((objectId) => ({ type: 'object', objectId })) }
}

function guideSelection(ids: string[]): VectorSelection {
  return { targets: ids.map((guideId) => ({ type: 'guide', guideId })) }
}

/** The objects a selection names: its object and point targets, never its guides. */
function objectIdsOf(selection: VectorSelection): string[] {
  return selection.targets.flatMap((target) => (target.type === 'guide' ? [] : [target.objectId]))
}

/** The guides a selection names. */
function guideIdsOf(selection: VectorSelection): string[] {
  return selection.targets.flatMap((target) => (target.type === 'guide' ? [target.guideId] : []))
}

function idsOf(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((item) => item.id)
}

/**
 * Change one path object through its layer view: fields such as the name or
 * operation are written in place, and a change of path, recipe or transform
 * rebuilds it the way the layer describes it, a transform baked in.
 */
function layerUpdate(
  state: LogoStore,
  label: string,
  id: string,
  update: (layer: IllustratorLayer) => IllustratorLayer,
): Partial<LogoStore> {
  const objects = updateObject(state.vectorDocument.objects, id, (object) => {
    if (object.type !== 'path') return object
    const layer = vectorObjectToLayer(object)
    const next = update(layer)
    const sameGeometry =
      next.pathData === layer.pathData && next.carve === layer.carve && sameTransform(next.transform, layer.transform)
    return sameGeometry ? writeLayerFields(object, next) : objectFromLayer(next, object)
  })
  return commitObjects(state, label, objects)
}

function sameTransform(a: IllustratorLayer['transform'], b: IllustratorLayer['transform']): boolean {
  return a.dx === b.dx && a.dy === b.dy && a.scale === b.scale && a.rotation === b.rotation
}

/**
 * A gesture's edits: a recipe edit regenerates the path from the recipe, and
 * a path edit makes the layer a free shape, which keeps its frame unless the
 * edit turns it. Edits that change nothing are skipped, and when none changes
 * anything the commit is not a step and leaves the selection alone.
 */
function applyLayerEdits(state: LogoStore, commit: LayerEditCommit): Partial<LogoStore> {
  const done = new Set<string>()
  let objects = state.vectorDocument.objects
  for (const edit of commit.edits) {
    if (done.has(edit.layerId)) continue
    done.add(edit.layerId)
    objects = updateObject(objects, edit.layerId, (object) => {
      if (object.type !== 'path') return object
      if (edit.carve) {
        const written = writeRecipe(object, edit.carve)
        return edit.pin === undefined || written.type !== 'path' ? written : writePin(written, edit.pin)
      }
      const written = edit.pathData !== undefined ? writePathData(object, edit.pathData, edit.contourIndex) : object
      return edit.frameRotation === undefined ? written : writeFrame(written, edit.frameRotation)
    })
  }
  if (objects === state.vectorDocument.objects) return {}
  const doc = state.illustrator
  const selectedLayerIds = commit.select ?? doc.selectedLayerIds
  const pointSelection: PointSelection | null =
    commit.anchor === undefined
      ? doc.pointSelection
      : commit.anchor
        ? {
            layerId: commit.anchor.layerId,
            contourIndex: commit.anchor.contourIndex ?? 0,
            segmentIndex: commit.anchor.segmentIndex,
            handle: 'anchor',
          }
        : null
  const selection = pointSelectionToVectorSelection(pointSelection, selectedLayerIds)
  // The same kind of key edit on other layers is an edit of its own.
  const merge = commit.merge && `${commit.merge} ${objectIdsOf(selection).join(' ')}`
  return commitObjects(state, commit.label, objects, selection, undefined, merge)
}

/**
 * Change the selection without entering the undo history. The objects array
 * keeps its identity, so nothing is recomposed. Undo restores the selection
 * captured with each edit, so redo stays valid too.
 */
function selectionUpdate(state: LogoStore, selection: VectorSelection): Partial<LogoStore> {
  return {
    selection,
    illustrator: vectorDocumentToIllustratorDocument(state.vectorDocument, selection, state.illustrator),
  }
}

/** The document the app opens on. */
function blankDocument(): Pick<LogoStore, 'vectorDocument' | 'selection' | 'illustrator'> {
  const vectorDocument = createEmptyVectorDocument()
  const selection: VectorSelection = { targets: [] }
  return { vectorDocument, selection, illustrator: vectorDocumentToIllustratorDocument(vectorDocument, selection) }
}

/** An empty document that starts from slabs, with no generated mark behind it. */
function slabDocument(): VectorDocument {
  const document = createEmptyVectorDocument('Slab')
  return {
    ...document,
    source: {
      seed: 0,
      modeId: 'slab',
      generatorId: 'slab',
      generatorVersion: 'v1',
      paramsHash: '',
      convertedAt: document.createdAt,
    },
  }
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

/** A copy offset down-right. Recipe layers move their recipe; a free shape's offset is baked into its points. */
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

