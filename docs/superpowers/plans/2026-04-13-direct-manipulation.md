# Direct Shape Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users generate a logo, then select, move, resize, rotate, and delete individual shapes — using the generator as a creative starting point, not a finished product.

**Architecture:** Replace the merged compound-path rendering with individual Paper.js items per shape. Add a selection/interaction layer that handles hit-testing, transform handles, and state sync back to the store. Keep the boolean compound path for export only.

**Tech Stack:** Paper.js (hit-testing, transforms, interactive items), Zustand (store), React (toolbar UI)

---

### Task 1: Add per-shape path data to GenerationResult

The engine already preserves `ShapeNode[]` in `result.shapes`, but each shape only has center/radius/type metadata — not the actual SVG path string. We need to attach the computed path data to each shape so the renderer can create individual Paper.js items without recomputing paths.

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/generators/GeometricRadialGenerator.ts`

- [ ] **Step 1: Add `pathData` field to ShapeNode type**

In `src/engine/types.ts`, add `pathData` to the `ShapeNode` interface:

```typescript
export interface ShapeNode {
  id: string
  type: 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'blob' | 'ellipse'
  role: 'prototype' | 'symmetry-instance'
  operation: 'add' | 'subtract'
  center: { x: number; y: number }
  radius: number
  rotation: number
  params: Record<string, number>
  pathData?: string  // SVG path string — set after path generation
}
```

- [ ] **Step 2: Populate pathData in GeometricRadialGenerator**

In `src/engine/generators/GeometricRadialGenerator.ts`, after the path generation loop that creates `booleanInputs`, attach the path data back to each shape. Find the section where `booleanInputs` is built (around line 100-110) and modify it:

```typescript
const booleanInputs = rotatedShapes.map((shape) => {
  const pathData = createPrimitivePath(
    shape.type as PrimitiveType,
    shape.center.x,
    shape.center.y,
    shape.radius,
    shape.rotation,
    shape.type === 'polygon' ? { sides: shape.params.sides ?? 5 } : {},
  )
  // Attach path data to the shape for individual rendering
  shape.pathData = pathData
  return {
    pathData,
    operation: shape.operation,
  }
})
```

This is a mutation of the existing shapes array. Since the shapes are created fresh each generation, this is safe.

- [ ] **Step 3: Do the same for all other generators**

Repeat for `ModularGenerator.ts`, `GridSystemGenerator.ts`, `MonogramGenerator.ts`, and `WaveArcGenerator.ts`. Each generator has a similar section where it builds boolean inputs from shapes. Attach `pathData` to each shape in the same way.

- [ ] **Step 4: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/generators/
git commit -m "feat: attach pathData to individual ShapeNode objects"
```

---

### Task 2: Render individual shapes instead of compound path

Replace `renderFinalMark` with a function that renders each shape as a separate, named Paper.js item. Keep the compound path rendering as a fallback for export previews.

**Files:**
- Modify: `src/renderer/FinalView.ts`
- Modify: `src/renderer/PaperRenderer.ts`

- [ ] **Step 1: Add renderIndividualShapes function to FinalView.ts**

Add this function to `src/renderer/FinalView.ts`:

```typescript
import type { ShapeNode } from '../engine/types.ts'

/**
 * Renders each shape as a separate Paper.js item so they can be
 * individually selected and manipulated. Returns a map of shape ID
 * to Paper.js item for the interaction layer to use.
 */
export function renderIndividualShapes(
  scope: paper.PaperScope,
  shapes: ShapeNode[],
  center: paper.Point,
  fillColor: string,
): Map<string, paper.Item> {
  const itemMap = new Map<string, paper.Item>()

  // Render additive shapes first, then subtractive on top
  const sorted = [...shapes].sort((a, b) => {
    if (a.operation === 'add' && b.operation === 'subtract') return -1
    if (a.operation === 'subtract' && b.operation === 'add') return 1
    return 0
  })

  for (const shape of sorted) {
    if (!shape.pathData) continue

    try {
      const path = new scope.Path(shape.pathData)
      path.translate(center)
      path.name = shape.id

      if (shape.operation === 'add') {
        path.fillColor = new scope.Color(fillColor)
      } else {
        path.fillColor = new scope.Color('#ffffff')
      }
      path.strokeColor = null

      itemMap.set(shape.id, path)
    } catch {
      // Skip invalid paths
    }
  }

  return itemMap
}
```

- [ ] **Step 2: Update PaperRenderer to use individual shapes**

In `src/renderer/PaperRenderer.ts`, add a new `editMode` option and use individual rendering when active. Update the `RenderOptions` interface and `renderLogoOnScope`:

```typescript
import { renderFinalMark, renderDissolution, renderIndividualShapes } from './FinalView.ts'

interface RenderOptions {
  showGrid: boolean
  showConstruction: boolean
  fillColor: string
  dissolution?: DissolutionResult | null
  drawnShapes?: DrawnShape[]
  editMode?: boolean  // When true, render shapes individually for selection
}

export function renderLogoOnScope(
  scope: paper.PaperScope,
  result: GenerationResult,
  options: RenderOptions,
): Map<string, paper.Item> | null {
  scope.activate()
  scope.project.clear()

  const center = getCenter(scope)

  if (options.showConstruction) {
    renderConstruction(scope, result, center, options.showGrid)
  }

  let itemMap: Map<string, paper.Item> | null = null

  if (options.editMode && !options.dissolution) {
    // Edit mode: render shapes individually for selection
    itemMap = renderIndividualShapes(scope, result.shapes, center, options.fillColor)
  } else if (options.dissolution) {
    renderDissolution(scope, options.dissolution, center, options.fillColor)
  } else {
    renderFinalMark(scope, result, center, options.fillColor)
  }

  if (options.drawnShapes && options.drawnShapes.length > 0) {
    renderDrawnShapes(scope, options.drawnShapes, center, options.fillColor)
  }

  scope.view.update()
  return itemMap
}
```

- [ ] **Step 3: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/FinalView.ts src/renderer/PaperRenderer.ts
git commit -m "feat: render individual shapes in edit mode"
```

---

### Task 3: Add edit mode to the store

Add state for edit mode, selected shape tracking, and per-shape transform overrides so user manipulations persist.

**Files:**
- Modify: `src/store/logoStore.ts`

- [ ] **Step 1: Add edit mode state and actions to the store**

In `src/store/logoStore.ts`, add these to the `UIState` interface:

```typescript
interface UIState {
  // ... existing fields
  editMode: boolean
  selectedShapeId: string | null
  shapeOverrides: Record<string, ShapeOverride>  // per-shape transform overrides
}
```

Add the `ShapeOverride` type at the top of the file:

```typescript
export interface ShapeOverride {
  dx: number       // x translation delta
  dy: number       // y translation delta
  scale: number    // scale multiplier (1 = original)
  rotation: number // rotation delta in degrees
  hidden: boolean  // soft-delete
}
```

Add to the store interface:

```typescript
interface LogoStore {
  // ... existing
  toggleEditMode: () => void
  selectShape: (id: string | null) => void
  updateShapeOverride: (id: string, update: Partial<ShapeOverride>) => void
  deleteSelectedShape: () => void
  clearShapeOverrides: () => void
}
```

- [ ] **Step 2: Add initial state and action implementations**

In the store's `create` call, add initial state:

```typescript
ui: {
  // ... existing
  editMode: false,
  selectedShapeId: null,
  shapeOverrides: {},
},
```

And add the actions:

```typescript
toggleEditMode: () =>
  set((state) => ({
    ui: {
      ...state.ui,
      editMode: !state.ui.editMode,
      selectedShapeId: null,  // deselect on toggle
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
```

- [ ] **Step 3: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/store/logoStore.ts
git commit -m "feat: add edit mode state and shape override actions"
```

---

### Task 4: Build the interaction layer

Create a component that handles Paper.js hit-testing, drag-to-move, and selection visuals. This sits between the canvas and the user's mouse events.

**Files:**
- Create: `src/renderer/InteractionLayer.ts`

- [ ] **Step 1: Create InteractionLayer module**

Create `src/renderer/InteractionLayer.ts`:

```typescript
import type { ShapeOverride } from '../store/logoStore.ts'

interface InteractionCallbacks {
  onSelect: (shapeId: string | null) => void
  onMove: (shapeId: string, dx: number, dy: number) => void
}

/**
 * Manages hit-testing and drag interactions on Paper.js items.
 * Call setup() after each render to bind to the current item map.
 */
export class InteractionLayer {
  private scope: paper.PaperScope
  private itemMap: Map<string, paper.Item> = new Map()
  private callbacks: InteractionCallbacks
  private selectedId: string | null = null
  private selectionRect: paper.Item | null = null
  private dragStart: paper.Point | null = null
  private dragOrigPos: paper.Point | null = null

  constructor(scope: paper.PaperScope, callbacks: InteractionCallbacks) {
    this.scope = scope
    this.callbacks = callbacks
  }

  setup(itemMap: Map<string, paper.Item>) {
    this.itemMap = itemMap
    this.clearSelection()
  }

  /** Apply stored overrides (position, scale, rotation, visibility) to rendered items */
  applyOverrides(overrides: Record<string, ShapeOverride>) {
    for (const [id, override] of Object.entries(overrides)) {
      const item = this.itemMap.get(id)
      if (!item) continue

      if (override.hidden) {
        item.visible = false
        continue
      }

      if (override.dx !== 0 || override.dy !== 0) {
        item.translate(new this.scope.Point(override.dx, override.dy))
      }
      if (override.scale !== 1) {
        item.scale(override.scale)
      }
      if (override.rotation !== 0) {
        item.rotate(override.rotation)
      }
    }
  }

  /** Show selection highlight around a shape */
  showSelection(shapeId: string | null) {
    this.clearSelection()
    this.selectedId = shapeId
    if (!shapeId) return

    const item = this.itemMap.get(shapeId)
    if (!item || !item.visible) return

    const bounds = item.bounds.expand(6)
    this.selectionRect = new this.scope.Path.Rectangle({
      rectangle: bounds,
      strokeColor: new this.scope.Color('#3b82f6'),
      strokeWidth: 1.5,
      dashArray: [4, 4],
      fillColor: null,
    })
    this.scope.view.update()
  }

  private clearSelection() {
    if (this.selectionRect) {
      this.selectionRect.remove()
      this.selectionRect = null
    }
  }

  /** Handle mouse down — hit test and start drag */
  onMouseDown(point: paper.Point): boolean {
    const hitResult = this.scope.project.hitTest(point, {
      fill: true,
      tolerance: 5,
    })

    if (!hitResult || !hitResult.item?.name) {
      this.callbacks.onSelect(null)
      return false
    }

    const shapeId = hitResult.item.name
    if (!this.itemMap.has(shapeId)) {
      this.callbacks.onSelect(null)
      return false
    }

    this.callbacks.onSelect(shapeId)
    this.dragStart = point
    this.dragOrigPos = hitResult.item.position.clone()
    return true
  }

  /** Handle mouse drag — move selected shape */
  onMouseDrag(point: paper.Point) {
    if (!this.dragStart || !this.selectedId || !this.dragOrigPos) return

    const item = this.itemMap.get(this.selectedId)
    if (!item) return

    const delta = point.subtract(this.dragStart)
    item.position = this.dragOrigPos.add(delta)
    this.showSelection(this.selectedId)
    this.scope.view.update()
  }

  /** Handle mouse up — commit the drag as an override */
  onMouseUp(point: paper.Point) {
    if (!this.dragStart || !this.selectedId || !this.dragOrigPos) {
      this.dragStart = null
      return
    }

    const delta = point.subtract(this.dragStart)
    if (delta.length > 2) {
      this.callbacks.onMove(this.selectedId, delta.x, delta.y)
    }

    this.dragStart = null
    this.dragOrigPos = null
  }

  destroy() {
    this.clearSelection()
    this.itemMap.clear()
  }
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/InteractionLayer.ts
git commit -m "feat: add InteractionLayer for shape hit-testing and drag"
```

---

### Task 5: Wire edit mode into LogoCanvas

Connect the interaction layer to the canvas component, handling mouse events and syncing selection/overrides between the store and Paper.js.

**Files:**
- Modify: `src/components/canvas/LogoCanvas.tsx`

- [ ] **Step 1: Integrate edit mode and interaction layer**

Replace the contents of `src/components/canvas/LogoCanvas.tsx`:

```typescript
import { useRef, useEffect, useCallback, useMemo } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import { DrawingOverlay } from './DrawingOverlay.tsx'
import { InteractionLayer } from '../../renderer/InteractionLayer.ts'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'

export function LogoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const interactionRef = useRef<InteractionLayer | null>(null)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const params = useLogoStore((s) => s.params)
  const effectParams = useLogoStore((s) => s.effectParams)
  const selectShape = useLogoStore((s) => s.selectShape)
  const updateShapeOverride = useLogoStore((s) => s.updateShapeOverride)

  const dissolution = useMemo(() => {
    if (!result || !effectParams.dissolution.enabled) return null
    return DissolutionProcessor.process(result, effectParams.dissolution)
  }, [result, effectParams.dissolution])

  // Render and set up interaction layer
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !result) return

    const itemMap = renderLogoOnScope(scope, result, {
      showGrid: ui.showGrid,
      showConstruction: ui.showConstruction,
      fillColor: params.fillColor,
      dissolution,
      drawnShapes: ui.drawnShapes,
      editMode: ui.editMode,
    })

    if (ui.editMode && itemMap) {
      if (!interactionRef.current) {
        interactionRef.current = new InteractionLayer(scope, {
          onSelect: selectShape,
          onMove: (id, dx, dy) => {
            const prev = ui.shapeOverrides[id]
            updateShapeOverride(id, {
              dx: (prev?.dx ?? 0) + dx,
              dy: (prev?.dy ?? 0) + dy,
            })
          },
        })
      }
      interactionRef.current.setup(itemMap)
      interactionRef.current.applyOverrides(ui.shapeOverrides)
      interactionRef.current.showSelection(ui.selectedShapeId)
    } else if (interactionRef.current) {
      interactionRef.current.destroy()
      interactionRef.current = null
    }
  }, [result, ui.showGrid, ui.showConstruction, ui.drawnShapes, ui.editMode, ui.shapeOverrides, ui.selectedShapeId, params.fillColor, dissolution, scopeRef, selectShape, updateShapeOverride])

  // Mouse event handlers for edit mode
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ui.editMode || !interactionRef.current || !scopeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = new scopeRef.current.Point(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    interactionRef.current.onMouseDown(point)
  }, [ui.editMode, scopeRef])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ui.editMode || !interactionRef.current || !scopeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = new scopeRef.current.Point(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    interactionRef.current.onMouseDrag(point)
  }, [ui.editMode, scopeRef])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ui.editMode || !interactionRef.current || !scopeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = new scopeRef.current.Point(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    interactionRef.current.onMouseUp(point)
  }, [ui.editMode, scopeRef])

  const onFrame = useCallback((keyframe: AnimationKeyframe) => {
    const scope = scopeRef.current
    if (!scope) return
    const view = scope.view
    if (keyframe.rotation === 0 && keyframe.scale === 1) {
      view.rotation = 0
      view.scaling = new scope.Point(1, 1)
    } else {
      view.rotation = (keyframe.rotation * 180) / Math.PI
      view.scaling = new scope.Point(keyframe.scale, keyframe.scale)
    }
    view.update()
  }, [scopeRef])

  const { playing, togglePlaying, canAnimate } = useAnimation(onFrame)

  const hasPerspective = ui.perspectiveX !== 0 || ui.perspectiveY !== 0

  const canvasStyle: React.CSSProperties = hasPerspective
    ? {
        imageRendering: 'auto',
        transform: `perspective(800px) rotateX(${ui.perspectiveX}deg) rotateY(${ui.perspectiveY}deg)`,
        transition: 'transform 150ms',
      }
    : { imageRendering: 'auto' }

  return (
    <div className="relative w-full h-full flex items-center justify-center p-8 md:p-12">
      <div className="relative w-full max-w-[min(100%,calc(100vh-8rem))] aspect-square">
        <div className="absolute inset-0 rounded-2xl bg-white shadow-2xl shadow-black/20">
          <canvas
            ref={canvasRef}
            width={600}
            height={600}
            className="size-full rounded-2xl"
            style={{
              ...canvasStyle,
              cursor: ui.editMode ? 'default' : undefined,
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
          {!ui.editMode && <DrawingOverlay />}
        </div>
        <AnimationControls playing={playing} canAnimate={canAnimate} onToggle={togglePlaying} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/LogoCanvas.tsx
git commit -m "feat: wire interaction layer into LogoCanvas for edit mode"
```

---

### Task 6: Add edit mode toggle and shape toolbar to the UI

Add an "Edit" button to the toolbar and a floating shape actions bar (delete, reset) when a shape is selected.

**Files:**
- Modify: `src/components/canvas/DrawingOverlay.tsx` (add edit mode toolbar)
- Modify: `src/components/layout/Toolbar.tsx` (add Edit button)

- [ ] **Step 1: Add Edit button to Toolbar**

In `src/components/layout/Toolbar.tsx`, add the edit mode toggle next to the Draw button. Import `toggleEditMode` and `editMode` from the store:

After the theme toggle button and before the Share button, add:

```typescript
const editMode = useLogoStore((s) => s.ui.editMode)
const toggleEditMode = useLogoStore((s) => s.toggleEditMode)
```

Add the button in the toolbar JSX, after the theme toggle `<ToolbarButton>`:

```tsx
<ToolbarButton
  onClick={toggleEditMode}
  className={editMode ? 'bg-blue-500/20 text-blue-400' : undefined}
>
  {editMode ? 'Editing' : 'Edit'}
</ToolbarButton>
```

- [ ] **Step 2: Add floating shape actions bar**

Create a `ShapeActions` component inside `src/components/canvas/DrawingOverlay.tsx` or as a sibling. Add this to `LogoCanvas.tsx` return JSX, after the `<AnimationControls>`:

In `LogoCanvas.tsx`, add these store selectors at the top of the component:

```typescript
const deleteSelectedShape = useLogoStore((s) => s.deleteSelectedShape)
const clearShapeOverrides = useLogoStore((s) => s.clearShapeOverrides)
```

Then add this JSX block after `<AnimationControls>`, inside the outer wrapper div:

```tsx
{ui.editMode && (
  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 rounded-xl bg-black/70 backdrop-blur-sm border border-white/10">
    <span className="px-2 text-xs text-white/60">
      {ui.selectedShapeId ? `Selected: ${ui.selectedShapeId}` : 'Click a shape'}
    </span>
    {ui.selectedShapeId && (
      <>
        <div className="w-px h-5 bg-white/10" />
        <button
          onClick={deleteSelectedShape}
          className="h-8 px-3 rounded-lg text-xs text-red-400 hover:bg-white/10"
        >
          Delete
        </button>
      </>
    )}
    <div className="w-px h-5 bg-white/10" />
    <button
      onClick={clearShapeOverrides}
      className="h-8 px-3 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10"
    >
      Reset All
    </button>
  </div>
)}
```

- [ ] **Step 3: Add keyboard shortcut for delete**

In `src/App.tsx`, in the `handleKeyDown` function, add:

```typescript
// Delete/Backspace = delete selected shape in edit mode
if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey) {
  const { editMode, selectedShapeId } = useLogoStore.getState().ui
  if (editMode && selectedShapeId) {
    e.preventDefault()
    useLogoStore.getState().deleteSelectedShape()
  }
}
```

- [ ] **Step 4: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/LogoCanvas.tsx src/components/layout/Toolbar.tsx src/App.tsx
git commit -m "feat: add edit mode toggle, shape actions bar, and delete shortcut"
```

---

### Task 7: Preserve shape overrides across regeneration

When the user changes a parameter (seed, style, etc.), the shapes regenerate with new IDs. The overrides should be cleared so stale transforms don't apply to wrong shapes. Also wire up the "Edit" toggle to auto-enable edit mode when clicking a shape.

**Files:**
- Modify: `src/store/logoStore.ts`

- [ ] **Step 1: Clear overrides when params change**

In `src/store/logoStore.ts`, modify the `setParam`, `setParams`, `setMode`, `setStyleFamily`, `randomizeSeed`, and `applyPreset` actions to also clear shape overrides. The simplest approach — add a helper and call it from each:

```typescript
function withClearedOverrides(state: LogoStore): Partial<LogoStore> {
  return {
    ui: {
      ...state.ui,
      shapeOverrides: {},
      selectedShapeId: null,
    },
  }
}
```

Then in each action that changes params, spread the override clearing into the return. For example in `randomizeSeed`:

```typescript
randomizeSeed: () =>
  set((state) => ({
    params: {
      ...state.params,
      seed: crypto.getRandomValues(new Uint32Array(1))[0] % 10000,
    },
    ...withClearedOverrides(state),
  })),
```

Apply the same pattern to: `setParam`, `setParams`, `setMode`, `setStyleFamily`, `applyPreset`.

- [ ] **Step 2: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/store/logoStore.ts
git commit -m "feat: clear shape overrides when generation params change"
```

---

### Task 8: Integration test — full flow verification

Manual verification of the complete edit flow.

- [ ] **Step 1: Start dev server and test**

Run: `npx vite --port 5199`

Test the following flow:
1. Generate a logo (Geometric Radial, any seed)
2. Click "Edit" in the toolbar — shapes should render individually (slight visual difference from boolean-composed version is expected)
3. Click a shape — blue dashed selection rect appears
4. Drag a shape — it moves, selection follows
5. Release — shape stays in new position
6. Press Delete — shape disappears
7. Click "Reset All" — all overrides cleared, original layout restored
8. Change seed — overrides cleared automatically
9. Click "Edit" again to exit edit mode — returns to compound path rendering

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for edit mode"
```
