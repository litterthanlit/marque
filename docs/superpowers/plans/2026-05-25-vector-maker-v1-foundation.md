# Vector Maker v1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Vector Maker v1 foundation: user-facing rename, `VectorDocument`, command history, generated-mark conversion, SVG/PNG export parity, and legacy editor compatibility.

**Architecture:** Add the new vector core alongside the existing `IllustratorDocument` code, then route current editor behavior through adapters. Keep the generated logo maker stable while progressively migrating editor state to `VectorDocument`.

**Tech Stack:** React 19, TypeScript, Vite, Zustand/Zundo, Paper.js, `lz-string`.

---

## File Structure

- Create: `src/engine/vector/types.ts`
  Owns `VectorDocument`, artboard, object, path segment, selection, appearance, and source metadata types.
- Create: `src/engine/vector/pathSerialization.ts`
  Converts structured `VectorPath` segments to/from SVG path data using Paper.js as the parser bridge.
- Create: `src/engine/vector/document.ts`
  Creates empty one-artboard brand-vector documents and validates/migrates persisted documents.
- Create: `src/engine/vector/commands.ts`
  Defines the command interface, reducer helpers, and core document mutation commands.
- Create: `src/engine/vector/fromGeneration.ts`
  Converts `GenerationResult` into editable `VectorDocument` objects with provenance metadata.
- Create: `src/engine/vector/export.ts`
  Serializes `VectorDocument` to active mark data and SVG.
- Create: `src/engine/vector/legacyIllustratorAdapter.ts`
  Bridges `IllustratorDocument` to/from `VectorDocument` while the UI migration is underway.
- Modify: `src/store/logoStore.ts`
  Adds `vectorDocument`, vector commands, and compatibility actions.
- Modify: `src/hooks/useActiveMark.ts`
  Uses `VectorDocument` export when active surface is Vector Maker.
- Modify: `src/hooks/useExport.ts`
  Routes SVG/PNG export through vector serialization when available.
- Modify: `src/components/controls/ParameterPanel.tsx`
  Renames user-facing `illustrator` tab to `Vector Maker` while keeping internal state stable.
- Modify: `src/renderer/IllustratorRenderer.ts`
  Adds a first item cache seam and prepares for vector object ids.
- Test manually with `npm run build`, generated mark conversion, SVG export, PNG export, undo/redo, and URL reload.

---

## Task 1: Add Vector Core Types

**Files:**
- Create: `src/engine/vector/types.ts`

- [ ] **Step 1: Create the vector type module**

Add:

```ts
export type VectorDocumentKind = 'brand-vector' | 'font'
export type VectorWorkspaceMode = 'logo' | 'wordmark'

export interface Vec2 {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface VectorArtboard {
  id: string
  name: string
  rect: Rect
  background: string | null
}

export interface VectorPath {
  id: string
  closed: boolean
  segments: VectorPathSegment[]
}

export interface VectorPathSegment {
  point: Vec2
  handleIn: Vec2 | null
  handleOut: Vec2 | null
  pointType: 'corner' | 'smooth' | 'symmetric'
}

export type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: string }

export interface VectorAppearance {
  fill: Paint
  stroke: Paint
  strokeWidth: number
  strokeCap: 'butt' | 'round' | 'square'
  strokeJoin: 'miter' | 'round' | 'bevel'
  strokeMiterLimit: number
  strokeDashArray: number[]
  opacity: number
  blendMode: 'normal'
}

export interface VectorSourceRef {
  generatorId?: string
  generatorVersion?: string
  modeId?: string
  seed?: number
  sourceShapeId?: string
  paramsHash?: string
  convertedAt?: string
}

export interface VectorBaseObject {
  id: string
  type: VectorObject['type']
  name: string
  parentId: string | null
  artboardId: string
  visible: boolean
  locked: boolean
  transform: Matrix2D
  appearance: VectorAppearance
  source: VectorSourceRef | null
}

export interface PathObject extends VectorBaseObject {
  type: 'path'
  path: VectorPath
  fillRule: 'nonzero' | 'evenodd'
}

export interface ShapeObject extends VectorBaseObject {
  type: 'shape'
  shape:
    | { type: 'circle'; cx: number; cy: number; radius: number }
    | { type: 'rectangle'; x: number; y: number; width: number; height: number; cornerRadius: number }
    | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'polygon'; points: Vec2[] }
}

export interface TextObject extends VectorBaseObject {
  type: 'text'
  text: string
  box: Rect
  fontFamily: string
  fontSize: number
  fontWeight: number | string
  lineHeight: number
  letterSpacing: number
  textAlign: 'left' | 'center' | 'right'
}

export interface GroupObject extends Omit<VectorBaseObject, 'appearance'> {
  type: 'group'
  childIds: string[]
  appearance?: VectorAppearance
}

export type VectorObject = PathObject | ShapeObject | TextObject | GroupObject

export type VectorSelectionTarget =
  | { type: 'object'; objectId: string }
  | { type: 'anchor'; objectId: string; segmentIndex: number }
  | { type: 'handle'; objectId: string; segmentIndex: number; handle: 'in' | 'out' }

export interface VectorSelection {
  targets: VectorSelectionTarget[]
}

export interface VectorDocumentSource {
  seed: number
  modeId: string
  generatorId: string
  generatorVersion: string
  paramsHash: string
  convertedAt: string
}

export interface VectorDocument {
  schemaVersion: 1
  id: string
  kind: VectorDocumentKind
  activeMode: VectorWorkspaceMode
  name: string
  artboards: VectorArtboard[]
  objects: VectorObject[]
  selection: VectorSelection
  source: VectorDocumentSource | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build still passes because the new module is not imported yet.

- [ ] **Step 3: Commit**

```bash
git add src/engine/vector/types.ts
git commit -m "feat: add vector document types"
```

---

## Task 2: Add Document Defaults and Validation

**Files:**
- Create: `src/engine/vector/document.ts`

- [ ] **Step 1: Add document factory helpers**

Add:

```ts
import type {
  Matrix2D,
  Paint,
  Rect,
  VectorAppearance,
  VectorArtboard,
  VectorDocument,
} from './types.ts'

export const VECTOR_SCHEMA_VERSION = 1

export const IDENTITY_MATRIX: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
}

export const DEFAULT_ARTBOARD_RECT: Rect = {
  x: -512,
  y: -512,
  width: 1024,
  height: 1024,
}

export const NONE_PAINT: Paint = { type: 'none' }

export function solidPaint(color: string): Paint {
  return { type: 'solid', color }
}

export function createDefaultAppearance(fillColor = '#111111'): VectorAppearance {
  return {
    fill: solidPaint(fillColor),
    stroke: NONE_PAINT,
    strokeWidth: 0,
    strokeCap: 'butt',
    strokeJoin: 'miter',
    strokeMiterLimit: 4,
    strokeDashArray: [],
    opacity: 1,
    blendMode: 'normal',
  }
}

export function createDefaultArtboard(): VectorArtboard {
  return {
    id: crypto.randomUUID(),
    name: 'Artboard 1',
    rect: { ...DEFAULT_ARTBOARD_RECT },
    background: null,
  }
}

export function createEmptyVectorDocument(name = 'Untitled Vector Maker document'): VectorDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: VECTOR_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    kind: 'brand-vector',
    activeMode: 'logo',
    name,
    artboards: [createDefaultArtboard()],
    objects: [],
    selection: { targets: [] },
    source: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function isVectorDocument(value: unknown): value is VectorDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VectorDocument>
  return (
    candidate.schemaVersion === VECTOR_SCHEMA_VERSION &&
    candidate.kind === 'brand-vector' &&
    Array.isArray(candidate.artboards) &&
    Array.isArray(candidate.objects) &&
    Boolean(candidate.selection)
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add src/engine/vector/document.ts
git commit -m "feat: add vector document factory"
```

---

## Task 3: Add Path Serialization

**Files:**
- Create: `src/engine/vector/pathSerialization.ts`

- [ ] **Step 1: Add Paper.js-backed path conversion**

Add:

```ts
import paper from 'paper'
import type { VectorPath, VectorPathSegment } from './types.ts'

let vectorPathScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!vectorPathScope) {
    vectorPathScope = new paper.PaperScope()
    vectorPathScope.setup(new paper.Size(1, 1))
  }
  vectorPathScope.activate()
  return vectorPathScope
}

function toSegment(segment: paper.Segment): VectorPathSegment {
  return {
    point: { x: segment.point.x, y: segment.point.y },
    handleIn:
      segment.handleIn.length === 0
        ? null
        : { x: segment.handleIn.x, y: segment.handleIn.y },
    handleOut:
      segment.handleOut.length === 0
        ? null
        : { x: segment.handleOut.x, y: segment.handleOut.y },
    pointType: segment.handleIn.length > 0 || segment.handleOut.length > 0 ? 'smooth' : 'corner',
  }
}

export function pathDataToVectorPaths(pathData: string): VectorPath[] {
  const scope = getScope()
  scope.project.clear()

  const item = new scope.CompoundPath(pathData)
  const paths = item.getItems({ class: scope.Path })
  const result = paths
    .filter((path): path is paper.Path => path instanceof scope.Path)
    .map((path) => ({
      id: crypto.randomUUID(),
      closed: path.closed,
      segments: path.segments.map(toSegment),
    }))
    .filter((path) => path.segments.length > 0)

  scope.project.clear()
  return result
}

export function vectorPathToPathData(path: VectorPath): string {
  const scope = getScope()
  scope.project.clear()

  const paperPath = new scope.Path()
  paperPath.closed = path.closed
  for (const segment of path.segments) {
    paperPath.add(
      new scope.Segment(
        new scope.Point(segment.point.x, segment.point.y),
        segment.handleIn ? new scope.Point(segment.handleIn.x, segment.handleIn.y) : undefined,
        segment.handleOut ? new scope.Point(segment.handleOut.x, segment.handleOut.y) : undefined,
      ),
    )
  }

  const pathData = paperPath.pathData
  scope.project.clear()
  return pathData
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add src/engine/vector/pathSerialization.ts
git commit -m "feat: serialize vector path segments"
```

---

## Task 4: Add Command-Based Mutation Layer

**Files:**
- Create: `src/engine/vector/commands.ts`

- [ ] **Step 1: Add command interface and core commands**

Add:

```ts
import type { VectorDocument, VectorObject, VectorSelection } from './types.ts'

export interface VectorCommand {
  id: string
  label: string
  timestamp: number
  apply(document: VectorDocument): VectorDocument
  invert(document: VectorDocument): VectorDocument
  mergeWith?(next: VectorCommand): VectorCommand | null
}

function touch(document: VectorDocument): VectorDocument {
  return { ...document, updatedAt: new Date().toISOString() }
}

export function applyVectorCommand(document: VectorDocument, command: VectorCommand): VectorDocument {
  return touch(command.apply(document))
}

export function createSetSelectionCommand(selection: VectorSelection): VectorCommand {
  let previous: VectorSelection | null = null
  return {
    id: crypto.randomUUID(),
    label: 'Set selection',
    timestamp: Date.now(),
    apply(document) {
      previous = document.selection
      return { ...document, selection }
    },
    invert(document) {
      return { ...document, selection: previous ?? { targets: [] } }
    },
  }
}

export function createAddObjectsCommand(objects: VectorObject[]): VectorCommand {
  return {
    id: crypto.randomUUID(),
    label: 'Add objects',
    timestamp: Date.now(),
    apply(document) {
      return { ...document, objects: [...document.objects, ...objects] }
    },
    invert(document) {
      const ids = new Set(objects.map((object) => object.id))
      return {
        ...document,
        objects: document.objects.filter((object) => !ids.has(object.id)),
        selection: {
          targets: document.selection.targets.filter(
            (target) => target.type !== 'object' || !ids.has(target.objectId),
          ),
        },
      }
    },
  }
}

export function createDeleteObjectsCommand(objectIds: string[]): VectorCommand {
  let deleted: VectorObject[] = []
  const ids = new Set(objectIds)
  return {
    id: crypto.randomUUID(),
    label: 'Delete objects',
    timestamp: Date.now(),
    apply(document) {
      deleted = document.objects.filter((object) => ids.has(object.id))
      return {
        ...document,
        objects: document.objects.filter((object) => !ids.has(object.id)),
        selection: { targets: [] },
      }
    },
    invert(document) {
      return { ...document, objects: [...document.objects, ...deleted] }
    },
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add src/engine/vector/commands.ts
git commit -m "feat: add vector command mutations"
```

---

## Task 5: Convert Generated Marks to VectorDocument

**Files:**
- Create: `src/engine/vector/fromGeneration.ts`

- [ ] **Step 1: Add generated mark converter**

Add:

```ts
import type { GenerationResult, LogoParams } from '../types.ts'
import { getGenerator } from '../generators/registry.ts'
import { createDefaultAppearance, createDefaultArtboard } from './document.ts'
import { pathDataToVectorPaths } from './pathSerialization.ts'
import type { PathObject, VectorDocument, VectorObject } from './types.ts'

function paramsHash(params: LogoParams): string {
  return JSON.stringify({
    seed: params.seed,
    modeId: params.modeId,
    generatorId: params.generatorId,
    modeParams: params.modeParams[params.modeId] ?? {},
    brandInput: params.brandInput,
  })
}

export function createVectorDocumentFromGeneration(
  result: GenerationResult,
  params: LogoParams,
): VectorDocument {
  const generator = getGenerator(params.generatorId)
  const artboard = createDefaultArtboard()
  const convertedAt = new Date().toISOString()
  const source = {
    seed: params.seed,
    modeId: params.modeId,
    generatorId: params.generatorId,
    generatorVersion: generator?.version ?? 'v0',
    paramsHash: paramsHash(params),
    convertedAt,
  }

  const objects: VectorObject[] = result.shapes.flatMap((shape, index) => {
    if (!shape.pathData) return []

    const paths = pathDataToVectorPaths(shape.pathData)
    return paths.map((path, pathIndex): PathObject => ({
      id: crypto.randomUUID(),
      type: 'path',
      name: `${shape.type} ${index + 1}${paths.length > 1 ? `.${pathIndex + 1}` : ''}`,
      parentId: null,
      artboardId: artboard.id,
      visible: true,
      locked: false,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      appearance: createDefaultAppearance(params.fillColor),
      source: {
        ...source,
        sourceShapeId: shape.id,
      },
      path,
      fillRule: 'evenodd',
    }))
  })

  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind: 'brand-vector',
    activeMode: 'logo',
    name: `Vector Maker ${params.seed}`,
    artboards: [artboard],
    objects,
    selection: objects[0] ? { targets: [{ type: 'object', objectId: objects[0].id }] } : { targets: [] },
    source,
    createdAt: convertedAt,
    updatedAt: convertedAt,
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add src/engine/vector/fromGeneration.ts
git commit -m "feat: convert generated marks to vector documents"
```

---

## Task 6: Export VectorDocument to Mark Data and SVG

**Files:**
- Create: `src/engine/vector/export.ts`

- [ ] **Step 1: Add vector export serializer**

Add:

```ts
import type { MarkData } from '../illustrator/types.ts'
import type { PathObject, VectorDocument, VectorObject } from './types.ts'
import { vectorPathToPathData } from './pathSerialization.ts'

function isVisiblePath(object: VectorObject): object is PathObject {
  return object.type === 'path' && object.visible && !object.locked
}

export function composeVectorMark(document: VectorDocument | null): MarkData | null {
  if (!document) return null

  const paths = document.objects
    .filter(isVisiblePath)
    .map((object) => vectorPathToPathData(object.path))
    .filter(Boolean)

  const artboard = document.artboards[0]
  if (!artboard) return null

  return {
    compoundPathData: paths.join(' '),
    fillRule: 'evenodd',
    viewBox: {
      x: artboard.rect.x,
      y: artboard.rect.y,
      width: artboard.rect.width,
      height: artboard.rect.height,
    },
  }
}

export function serializeVectorDocumentToSvg(document: VectorDocument, fallbackFill = '#111111'): string {
  const artboard = document.artboards[0]
  const viewBox = artboard
    ? `${artboard.rect.x} ${artboard.rect.y} ${artboard.rect.width} ${artboard.rect.height}`
    : '-512 -512 1024 1024'

  const body = document.objects
    .filter(isVisiblePath)
    .map((object) => {
      const fill = object.appearance.fill.type === 'solid' ? object.appearance.fill.color : fallbackFill
      const opacity = object.appearance.opacity < 1 ? ` opacity="${object.appearance.opacity}"` : ''
      return `  <path d="${vectorPathToPathData(object.path)}" fill="${fill}" fill-rule="${object.fillRule}"${opacity} />`
    })
    .join('\n')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">`,
    body,
    `</svg>`,
  ].join('\n')
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add src/engine/vector/export.ts
git commit -m "feat: export vector documents"
```

---

## Task 7: Wire VectorDocument into Store Alongside Legacy Illustrator

**Files:**
- Modify: `src/store/logoStore.ts`

- [ ] **Step 1: Add imports**

Add near the existing illustrator imports:

```ts
import type { VectorCommand } from '../engine/vector/commands.ts'
import { applyVectorCommand } from '../engine/vector/commands.ts'
import type { VectorDocument } from '../engine/vector/types.ts'
import { createVectorDocumentFromGeneration } from '../engine/vector/fromGeneration.ts'
```

- [ ] **Step 2: Extend store shape**

Add to `LogoStore` state:

```ts
vectorDocument: VectorDocument | null
vectorUndoStack: VectorCommand[]
vectorRedoStack: VectorCommand[]
```

Add to `LogoStore` actions:

```ts
ensureVectorDocument: () => void
setVectorDocument: (doc: VectorDocument | null) => void
applyVectorCommand: (command: VectorCommand) => void
undoVectorCommand: () => void
redoVectorCommand: () => void
```

- [ ] **Step 3: Initialize state**

Add beside `illustrator: null`:

```ts
vectorDocument: null,
vectorUndoStack: [],
vectorRedoStack: [],
```

- [ ] **Step 4: Add action implementations**

Add near existing `ensureIllustratorDocument` actions:

```ts
ensureVectorDocument: () =>
  set((state) => {
    if (state.vectorDocument || !state.result) return {}
    return {
      vectorDocument: createVectorDocumentFromGeneration(state.result, state.params),
      activeSurface: 'illustrator',
      vectorUndoStack: [],
      vectorRedoStack: [],
    }
  }),

setVectorDocument: (doc) =>
  set(() => ({
    vectorDocument: doc,
    vectorUndoStack: [],
    vectorRedoStack: [],
  })),

applyVectorCommand: (command) =>
  set((state) => {
    if (!state.vectorDocument) return {}
    return {
      vectorDocument: applyVectorCommand(state.vectorDocument, command),
      vectorUndoStack: [...state.vectorUndoStack, command],
      vectorRedoStack: [],
    }
  }),

undoVectorCommand: () =>
  set((state) => {
    if (!state.vectorDocument || state.vectorUndoStack.length === 0) return {}
    const command = state.vectorUndoStack[state.vectorUndoStack.length - 1]
    return {
      vectorDocument: command.invert(state.vectorDocument),
      vectorUndoStack: state.vectorUndoStack.slice(0, -1),
      vectorRedoStack: [...state.vectorRedoStack, command],
    }
  }),

redoVectorCommand: () =>
  set((state) => {
    if (!state.vectorDocument || state.vectorRedoStack.length === 0) return {}
    const command = state.vectorRedoStack[state.vectorRedoStack.length - 1]
    return {
      vectorDocument: applyVectorCommand(state.vectorDocument, command),
      vectorUndoStack: [...state.vectorUndoStack, command],
      vectorRedoStack: state.vectorRedoStack.slice(0, -1),
    }
  }),
```

- [ ] **Step 5: Keep current editor entry point working**

Update `ensureIllustratorDocument` so it also creates `vectorDocument` when possible:

```ts
ensureIllustratorDocument: () =>
  set((state) => {
    if (!state.result) return { activeSurface: 'illustrator' }
    return {
      illustrator: state.illustrator ?? createIllustratorDocument(state.result, state.params),
      vectorDocument:
        state.vectorDocument ?? createVectorDocumentFromGeneration(state.result, state.params),
      activeSurface: 'illustrator',
    }
  }),
```

- [ ] **Step 6: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 7: Commit**

```bash
git add src/store/logoStore.ts
git commit -m "feat: store vector maker documents"
```

---

## Task 8: Route Active Mark Through VectorDocument

**Files:**
- Modify: `src/hooks/useActiveMark.ts`

- [ ] **Step 1: Add vector export**

Add import:

```ts
import { composeVectorMark } from '../engine/vector/export.ts'
```

Read vector document from store:

```ts
const vectorDocument = useLogoStore((s) => s.vectorDocument)
```

Update memo:

```ts
if (activeSurface === 'illustrator' && vectorDocument) {
  return composeVectorMark(vectorDocument)
}
```

Keep existing Illustrator fallback below it:

```ts
if (activeSurface === 'illustrator' && illustrator) {
  return composeIllustratorMark(illustrator)
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useActiveMark.ts
git commit -m "feat: use vector document as active mark"
```

---

## Task 9: Rename User-Facing Illustrator Copy to Vector Maker

**Files:**
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] **Step 1: Rename tab display without changing internal surface id**

Keep:

```ts
type Tab = 'generate' | 'illustrator'
```

Add:

```ts
const TAB_LABELS: Record<Tab, string> = {
  generate: 'Generate',
  illustrator: 'Vector Maker',
}
```

Replace button text:

```tsx
{TAB_LABELS[t]}
```

- [ ] **Step 2: Rename visible section labels inside `IllustratorTab`**

Search in `ParameterPanel.tsx` for visible text containing `Illustrator` and replace it with `Vector Maker`.

Do not rename functions or internal types in this task.

- [ ] **Step 3: Run user-facing text check**

Run: `rg -n "Illustrator" src`

Expected: remaining matches are internal type/function/file names only, not JSX text nodes.

- [ ] **Step 4: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/controls/ParameterPanel.tsx
git commit -m "feat: rename editor UI to vector maker"
```

---

## Task 10: Add First Renderer Cache Seam

**Files:**
- Modify: `src/renderer/IllustratorRenderer.ts`

- [ ] **Step 1: Introduce cache type**

Add near interfaces:

```ts
export interface IllustratorRenderCache {
  items: Map<string, paper.Item>
}

export function createIllustratorRenderCache(): IllustratorRenderCache {
  return { items: new Map() }
}
```

- [ ] **Step 2: Accept optional cache**

Change the renderer signature:

```ts
export function renderIllustratorOnScope(
  scope: paper.PaperScope,
  doc: IllustratorDocument,
  options: IllustratorRenderOptions,
  cache?: IllustratorRenderCache,
): Map<string, paper.Item> {
```

At the start of the function, clear stale cache on full rebuild:

```ts
cache?.items.clear()
```

When setting `itemMap`, also set cache:

```ts
itemMap.set(layer.id, item)
cache?.items.set(layer.id, item)
```

This does not optimize rendering yet. It creates the stable API seam for the next plan.

- [ ] **Step 3: Run typecheck**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/IllustratorRenderer.ts
git commit -m "feat: add editor renderer cache seam"
```

---

## Task 11: Manual Verification

**Files:**
- No source files unless bugs are found.

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 2: Start app**

Run: `npm run dev`

Expected: Vite prints a local URL.

- [ ] **Step 3: Verify generation still works**

Open the local URL. Randomize seed. Switch generator modes. Confirm generated mark changes and no console errors appear.

- [ ] **Step 4: Verify Vector Maker entry**

Open the inspector tab labeled `Vector Maker`. Confirm the current generated mark still appears/editing surface still opens.

- [ ] **Step 5: Verify export parity**

Export SVG and PNG from the generated surface, then from Vector Maker. Confirm files download and SVG opens in a browser.

- [ ] **Step 6: Verify no user-facing Illustrator copy**

Run: `rg -n "Illustrator" src/components src/hooks src/App.tsx`

Expected: no visible UI strings containing `Illustrator`.

- [ ] **Step 7: Commit fixes if needed**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize vector maker foundation"
```

---

## Plan Self-Review

- Spec coverage: this plan covers naming, `VectorDocument`, command history foundation, generated conversion, export parity, renderer cache seam, and no Font Mode UI.
- Deferred by design: direct transform bounds, full workspace, path editing UI, text/wordmark tools, production pathfinder, and dirty-object renderer updates beyond the first seam. These need follow-up plans after this foundation lands.
- Placeholder scan: no `TBD`/`TODO` implementation placeholders are required for execution.
- Type consistency: `VectorDocumentKind` uses `"brand-vector" | "font"` and `VectorWorkspaceMode` uses `"logo" | "wordmark"` as specified.
