# Vector Drawing Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add freehand pencil, bezier pen, graffiti spray, and transform handles to give users complete vector freedom on the canvas.

**Architecture:** Replace the current stamp-based DrawingOverlay with a unified tool system. Each tool is a class implementing a common interface (onMouseDown/Drag/Up). Drawn paths are stored as serialized SVG path data in the store. Transform handles wrap the existing InteractionLayer selection with visible resize/rotate controls.

**Tech Stack:** Paper.js (path drawing, smoothing, hit-testing), Zustand (store), React (tool switcher UI)

---

### Task 1: Create the tool system and DrawnPath type

Replace the simple `DrawnShape` stamp model with a flexible `DrawnPath` type that can represent any vector path — freehand strokes, bezier curves, spray particles.

**Files:**
- Modify: `src/store/logoStore.ts`

- [ ] **Step 1: Add DrawnPath interface**

Add alongside the existing `DrawnShape` interface (keep DrawnShape for backward compat):

```typescript
export interface DrawnPath {
  id: string
  tool: 'pencil' | 'pen' | 'graffiti'
  pathData: string        // serialized SVG path data
  fillColor: string | null
  strokeColor: string | null
  strokeWidth: number
  closed: boolean
}
```

- [ ] **Step 2: Add drawnPaths state and actions**

Add to UIState:
```typescript
drawnPaths: DrawnPath[]
activeTool: 'select' | 'pencil' | 'pen' | 'graffiti' | null
```

Add actions:
```typescript
addDrawnPath: (path: Omit<DrawnPath, 'id'>) => void
removeDrawnPath: (id: string) => void
clearDrawnPaths: () => void
setActiveTool: (tool: UIState['activeTool']) => void
```

Initial state: `drawnPaths: []`, `activeTool: null`

Implementations follow the same pattern as `addDrawnShape` — generate UUID, append to array.

- [ ] **Step 3: Verify build, commit**

---

### Task 2: Build PencilTool — freehand smooth paths

Paper.js path drawing with automatic smoothing. Mouse down starts a path, drag adds points, mouse up smooths and finalizes.

**Files:**
- Create: `src/renderer/tools/PencilTool.ts`

- [ ] **Step 1: Create PencilTool**

```typescript
import type { DrawnPath } from '../../store/logoStore.ts'

export interface ToolCallbacks {
  onPathComplete: (path: Omit<DrawnPath, 'id'>) => void
}

export class PencilTool {
  private scope: paper.PaperScope
  private callbacks: ToolCallbacks
  private currentPath: paper.Path | null = null
  private strokeColor: string
  private strokeWidth: number

  constructor(scope: paper.PaperScope, callbacks: ToolCallbacks, options?: { strokeColor?: string; strokeWidth?: number }) {
    this.scope = scope
    this.callbacks = callbacks
    this.strokeColor = options?.strokeColor ?? '#000000'
    this.strokeWidth = options?.strokeWidth ?? 2
  }

  onMouseDown(point: paper.Point) {
    this.currentPath = new this.scope.Path({
      strokeColor: new this.scope.Color(this.strokeColor),
      strokeWidth: this.strokeWidth,
      strokeCap: 'round',
      strokeJoin: 'round',
    })
    this.currentPath.add(point)
  }

  onMouseDrag(point: paper.Point) {
    if (!this.currentPath) return
    this.currentPath.add(point)
    this.scope.view.update()
  }

  onMouseUp(_point: paper.Point) {
    if (!this.currentPath) return
    this.currentPath.simplify(2.5)
    
    const pathData = this.currentPath.pathData
    this.callbacks.onPathComplete({
      tool: 'pencil',
      pathData,
      fillColor: null,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      closed: false,
    })
    this.currentPath = null
  }

  destroy() {
    if (this.currentPath) {
      this.currentPath.remove()
      this.currentPath = null
    }
  }
}
```

- [ ] **Step 2: Verify build, commit**

---

### Task 3: Build PenTool — bezier point-and-click paths

Click to place anchor points. Drag while clicking to pull bezier handles. Double-click or press Enter to finalize. Escape to cancel.

**Files:**
- Create: `src/renderer/tools/PenTool.ts`

- [ ] **Step 1: Create PenTool**

```typescript
import type { DrawnPath } from '../../store/logoStore.ts'
import type { ToolCallbacks } from './PencilTool.ts'

export class PenTool {
  private scope: paper.PaperScope
  private callbacks: ToolCallbacks
  private currentPath: paper.Path | null = null
  private strokeColor: string
  private strokeWidth: number
  private handleIn: paper.Point | null = null

  constructor(scope: paper.PaperScope, callbacks: ToolCallbacks, options?: { strokeColor?: string; strokeWidth?: number }) {
    this.scope = scope
    this.callbacks = callbacks
    this.strokeColor = options?.strokeColor ?? '#000000'
    this.strokeWidth = options?.strokeWidth ?? 2
  }

  onMouseDown(point: paper.Point) {
    if (!this.currentPath) {
      this.currentPath = new this.scope.Path({
        strokeColor: new this.scope.Color(this.strokeColor),
        strokeWidth: this.strokeWidth,
        strokeCap: 'round',
        fillColor: null,
      })
    }

    const segment = this.currentPath.add(point)
    if (this.handleIn) {
      segment.handleIn = this.handleIn
      this.handleIn = null
    }
    this.scope.view.update()
  }

  onMouseDrag(point: paper.Point) {
    if (!this.currentPath || this.currentPath.segments.length === 0) return
    const lastSeg = this.currentPath.lastSegment
    const handle = point.subtract(lastSeg.point)
    lastSeg.handleOut = handle
    this.handleIn = handle.negate()
    this.scope.view.update()
  }

  onMouseUp(_point: paper.Point) {
    // Nothing — path stays open until finalize
  }

  /** Double-click or Enter to finalize */
  finalize() {
    if (!this.currentPath || this.currentPath.segments.length < 2) {
      this.cancel()
      return
    }

    const pathData = this.currentPath.pathData
    this.callbacks.onPathComplete({
      tool: 'pen',
      pathData,
      fillColor: null,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      closed: false,
    })
    this.currentPath = null
    this.handleIn = null
  }

  cancel() {
    if (this.currentPath) {
      this.currentPath.remove()
      this.currentPath = null
    }
    this.handleIn = null
  }

  get isDrawing(): boolean {
    return this.currentPath !== null && this.currentPath.segments.length > 0
  }

  destroy() {
    this.cancel()
  }
}
```

- [ ] **Step 2: Verify build, commit**

---

### Task 4: Build GraffitiTool — spray paint effect

Emits scattered particles around the cursor while the mouse is held down. Particles are small circles with random positions, sizes, and slight opacity variation. Collects all particles into one compound path on mouse up.

**Files:**
- Create: `src/renderer/tools/GraffitiTool.ts`

- [ ] **Step 1: Create GraffitiTool**

```typescript
import type { DrawnPath } from '../../store/logoStore.ts'
import type { ToolCallbacks } from './PencilTool.ts'

export class GraffitiTool {
  private scope: paper.PaperScope
  private callbacks: ToolCallbacks
  private particles: paper.Path[] = []
  private fillColor: string
  private sprayRadius: number
  private density: number
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastPoint: paper.Point | null = null

  constructor(scope: paper.PaperScope, callbacks: ToolCallbacks, options?: { fillColor?: string; sprayRadius?: number; density?: number }) {
    this.scope = scope
    this.callbacks = callbacks
    this.fillColor = options?.fillColor ?? '#000000'
    this.sprayRadius = options?.sprayRadius ?? 30
    this.density = options?.density ?? 8
  }

  onMouseDown(point: paper.Point) {
    this.lastPoint = point
    this.spray(point)
    this.intervalId = setInterval(() => {
      if (this.lastPoint) this.spray(this.lastPoint)
    }, 50)
  }

  onMouseDrag(point: paper.Point) {
    this.lastPoint = point
    this.spray(point)
  }

  onMouseUp(_point: paper.Point) {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.lastPoint = null

    if (this.particles.length === 0) return

    // Merge all particles into one compound path
    const compound = new this.scope.CompoundPath({
      children: this.particles.map(p => p.clone()),
      fillColor: new this.scope.Color(this.fillColor),
    })

    const pathData = compound.pathData
    compound.remove()

    // Remove individual particles
    for (const p of this.particles) p.remove()
    this.particles = []

    if (pathData) {
      this.callbacks.onPathComplete({
        tool: 'graffiti',
        pathData,
        fillColor: this.fillColor,
        strokeColor: null,
        strokeWidth: 0,
        closed: true,
      })
    }

    this.scope.view.update()
  }

  private spray(center: paper.Point) {
    for (let i = 0; i < this.density; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * this.sprayRadius
      const x = center.x + Math.cos(angle) * radius
      const y = center.y + Math.sin(angle) * radius
      const size = 1 + Math.random() * 3

      const dot = new this.scope.Path.Circle(
        new this.scope.Point(x, y),
        size,
      )
      dot.fillColor = new this.scope.Color(this.fillColor)
      this.particles.push(dot)
    }
    this.scope.view.update()
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const p of this.particles) p.remove()
    this.particles = []
  }
}
```

- [ ] **Step 2: Verify build, commit**

---

### Task 5: Add transform handles to InteractionLayer

When a shape is selected in edit mode, show 8 resize handles (corners + midpoints) and a rotation handle. Dragging handles updates the shape's scale and rotation overrides.

**Files:**
- Modify: `src/renderer/InteractionLayer.ts`

- [ ] **Step 1: Add transform handles to showSelection**

Extend `showSelection` to draw 8 small squares at bounds corners/midpoints plus a rotation handle above the top-center. Add `onHandleDrag` to detect which handle is being dragged and compute scale/rotation deltas. The `onMove` callback from InteractionCallbacks should be extended:

```typescript
interface InteractionCallbacks {
  onSelect: (shapeId: string | null) => void
  onMove: (shapeId: string, dx: number, dy: number) => void
  onScale: (shapeId: string, scale: number) => void
  onRotate: (shapeId: string, rotation: number) => void
}
```

Handles are small `Path.Rectangle` items with `name` set to `handle-tl`, `handle-tr`, etc. Hit-testing checks for handle names first, then falls through to shape hit-testing.

- [ ] **Step 2: Verify build, commit**

---

### Task 6: Replace DrawingOverlay with unified tool switcher

Replace the current stamp-based DrawingOverlay with a new toolbar that switches between tools: Select (edit mode), Pencil, Pen, Graffiti. Wire mouse events to the active tool.

**Files:**
- Modify: `src/components/canvas/DrawingOverlay.tsx`
- Modify: `src/components/canvas/LogoCanvas.tsx`

- [ ] **Step 1: Rewrite DrawingOverlay as ToolBar**

The toolbar shows tool icons: Select (arrow), Pencil, Pen, Graffiti. Clicking one sets `activeTool` in the store. The active tool gets highlighted.

- [ ] **Step 2: Wire tools into LogoCanvas mouse events**

In LogoCanvas, when `activeTool` is set, create the appropriate tool instance and forward mouse events. On path complete, call `addDrawnPath`. Render drawn paths after the logo.

- [ ] **Step 3: Add drawn path rendering to PaperRenderer**

Add a `renderDrawnPaths` function that creates Paper.js paths from `DrawnPath[]` — respecting fill/stroke/width per path.

- [ ] **Step 4: Verify build, commit**

---

### Task 7: Integration test

Test all tools end-to-end: pencil draws smooth curves, pen places bezier points, graffiti sprays particles, transform handles resize/rotate, all paths persist and render correctly.
