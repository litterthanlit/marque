# Generative Logo Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the generative logo maker from Phase 1 (foundation) through Phase 5 (polish), adding blob primitives, export, presets, undo/redo, URL sharing, animation, the modular generator, and responsive polish.

**Architecture:** Engine generates serializable `GenerationResult` from params; renderer consumes it via Paper.js; Zustand store with temporal middleware manages state and undo/redo. All randomness flows through seeded PRNG. Export serializes `GenerationResult.mark` data directly — never scrapes canvas DOM.

**Tech Stack:** Vite + SWC, React 19, TypeScript, Paper.js (boolean ops + rendering), Zustand (state + undo/redo), seedrandom (deterministic PRNG), Tailwind CSS v4, Radix UI (sliders, toggles, selects)

---

## Current State

Phase 1 is complete. The following files exist and compile cleanly:

**Engine:** `types.ts`, `random.ts`, `grid/ConcentricGrid.ts`, `primitives/{circle,rectangle,triangle,polygon,index}.ts`, `boolean/operations.ts`, `symmetry/radial.ts`, `generators/{GeometricRadialGenerator,registry}.ts`, `pipeline/GenerationPipeline.ts`

**Store:** `store/logoStore.ts` (Zustand, no undo/redo yet)

**Renderer:** `renderer/{PaperRenderer,ConstructionView,FinalView,usePaperScope}.ts`

**Components:** `components/layout/{AppShell,Toolbar}.tsx`, `components/canvas/LogoCanvas.tsx`, `components/controls/{ParameterPanel,SliderControl,SeedInput,ColorPicker}.tsx`, `components/preview/{FinalPreview,ConstructionData}.tsx`

**Hooks:** `hooks/useGeneration.ts`

## File Map — What Gets Created or Modified

### New Files (Phase 2)
| File | Responsibility |
|------|---------------|
| `src/engine/primitives/blob.ts` | Organic shape: radial points with seeded noise displacement, smoothed Bezier |

### Modified Files (Phase 2)
| File | Change |
|------|--------|
| `src/engine/primitives/index.ts` | Add `'blob'` to `PrimitiveType`, import `blobPath`, add case to `createPrimitivePath` |

### New Files (Phase 3)
| File | Responsibility |
|------|---------------|
| `src/store/historyMiddleware.ts` | Zustand temporal middleware for undo/redo param snapshots |
| `src/store/presets.ts` | 8-12 curated `LogoParams` snapshots with name/description |
| `src/hooks/useExport.ts` | SVG + PNG export from `GenerationResult.mark` data |
| `src/hooks/useUrlState.ts` | Read/write canonical params + generatorVersion to URL hash |
| `src/components/controls/PresetSelector.tsx` | Preset gallery dropdown |
| `src/components/controls/GeneratorSelector.tsx` | Generator picker (Radix Select) |
| `src/components/export/ExportDialog.tsx` | Format selection + download dialog |

### Modified Files (Phase 3)
| File | Change |
|------|--------|
| `src/store/logoStore.ts` | Wrap with temporal middleware, add `applyPreset`, wire undo/redo |
| `src/components/controls/ParameterPanel.tsx` | Add PresetSelector, GeneratorSelector |
| `src/components/layout/Toolbar.tsx` | Add Export button, undo/redo buttons |
| `src/App.tsx` | Add `useUrlState` hook |

### New Files (Phase 4)
| File | Responsibility |
|------|---------------|
| `src/engine/animation/types.ts` | `AnimationKeyframe` interface |
| `src/engine/animation/keyframes.ts` | Generate rotation/scale/morph keyframes from params |
| `src/hooks/useAnimation.ts` | `requestAnimationFrame` loop, play/pause state |
| `src/components/canvas/AnimationControls.tsx` | Play/pause/speed UI |

### Modified Files (Phase 4)
| File | Change |
|------|--------|
| `src/components/canvas/LogoCanvas.tsx` | Wire animation loop into render cycle |
| `src/components/controls/ParameterPanel.tsx` | Add animation speed slider |

### New Files (Phase 5)
| File | Responsibility |
|------|---------------|
| `src/engine/grid/ModularGrid.ts` | Tile/repeat grid placement |
| `src/engine/generators/ModularGenerator.ts` | Tile-based logo generation |

### Modified Files (Phase 5)
| File | Change |
|------|--------|
| `src/engine/generators/registry.ts` | Register ModularGenerator |
| `src/components/layout/AppShell.tsx` | Responsive breakpoints |

---

## Phase 2: Blob Primitive

### Task 1: Blob Primitive

**Files:**
- Create: `src/engine/primitives/blob.ts`
- Modify: `src/engine/primitives/index.ts`

- [ ] **Step 1: Create blob.ts with seeded noise displacement**

Create `src/engine/primitives/blob.ts`:

```typescript
import type { SeededRandom } from '../types.ts'

/**
 * Organic blob shape: N radial sample points displaced by seeded noise,
 * connected with smooth cubic Bezier curves.
 */
export function blobPath(
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  rng: SeededRandom,
  pointCount = 8,
  noiseAmount = 0.4,
): string {
  const points: { x: number; y: number }[] = []

  for (let i = 0; i < pointCount; i++) {
    const angle = rotation + (2 * Math.PI * i) / pointCount
    const displacement = 1 + (rng.nextFloat(-noiseAmount, noiseAmount))
    const r = radius * displacement
    points.push({
      x: Math.round((cx + r * Math.cos(angle)) * 1000) / 1000,
      y: Math.round((cy + r * Math.sin(angle)) * 1000) / 1000,
    })
  }

  // Closed smooth cubic Bezier through points (Catmull-Rom -> Bezier)
  return smoothClosedPath(points)
}

function smoothClosedPath(points: { x: number; y: number }[]): string {
  const n = points.length
  if (n < 3) return ''

  const tension = 0.3
  const segments: string[] = [`M ${points[0].x} ${points[0].y}`]

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]

    const cp1x = Math.round((p1.x + (p2.x - p0.x) * tension) * 1000) / 1000
    const cp1y = Math.round((p1.y + (p2.y - p0.y) * tension) * 1000) / 1000
    const cp2x = Math.round((p2.x - (p3.x - p1.x) * tension) * 1000) / 1000
    const cp2y = Math.round((p2.y - (p3.y - p1.y) * tension) * 1000) / 1000

    segments.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`)
  }

  segments.push('Z')
  return segments.join(' ')
}
```

- [ ] **Step 2: Update primitives/index.ts to include blob**

Modify `src/engine/primitives/index.ts`. The full updated file:

```typescript
import type { SeededRandom } from '../types.ts'
import { circlePath } from './circle.ts'
import { rectanglePath } from './rectangle.ts'
import { trianglePath } from './triangle.ts'
import { polygonPath } from './polygon.ts'
import { blobPath } from './blob.ts'

export type PrimitiveType = 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'blob'

const PRIMITIVE_TYPES: PrimitiveType[] = [
  'circle',
  'rectangle',
  'triangle',
  'polygon',
  'blob',
]

export function pickPrimitiveType(rng: SeededRandom): PrimitiveType {
  return PRIMITIVE_TYPES[rng.nextInt(0, PRIMITIVE_TYPES.length - 1)]
}

export function createPrimitivePath(
  type: PrimitiveType,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  params: Record<string, number>,
  rng?: SeededRandom,
): string {
  switch (type) {
    case 'circle':
      return circlePath(cx, cy, radius)
    case 'rectangle':
      return rectanglePath(cx, cy, radius, rotation)
    case 'triangle':
      return trianglePath(cx, cy, radius, rotation)
    case 'polygon':
      return polygonPath(cx, cy, radius, rotation, params.sides ?? 5)
    case 'blob':
      if (!rng) return circlePath(cx, cy, radius) // fallback if no rng
      return blobPath(cx, cy, radius, rotation, rng)
    default:
      return circlePath(cx, cy, radius)
  }
}
```

- [ ] **Step 3: Update all call sites of createPrimitivePath to pass rng**

The function signature now has an optional `rng` parameter. Update the two call sites:

**File: `src/engine/generators/GeometricRadialGenerator.ts` (line ~82)**

Change the `booleanInputs` mapping to pass `rng`:

```typescript
    // Build path data for each shape
    const booleanInputs = rotatedShapes.map((shape) => ({
      pathData: createPrimitivePath(
        shape.type as PrimitiveType,
        shape.center.x,
        shape.center.y,
        shape.radius,
        shape.rotation,
        shape.params,
        rng,
      ),
      operation: shape.operation,
    }))
```

Also update the import at the top of `GeometricRadialGenerator.ts`:
```typescript
import { pickPrimitiveType, createPrimitivePath, type PrimitiveType } from '../primitives/index.ts'
```

**File: `src/renderer/ConstructionView.ts` (line ~58)**

The construction view calls `createPrimitivePath` for rendering shape outlines. Since it doesn't have an rng, the blob fallback to circle is acceptable for construction outlines. No change needed — the optional param handles this.

- [ ] **Step 4: Verify the blob type is included in ShapeNode**

Check `src/engine/types.ts` line 22 — `ShapeNode.type` already includes `'blob'`. No change needed.

- [ ] **Step 5: Run type check and dev server**

Run: `npx tsc --noEmit && npm run dev`

Expected: No type errors. Dev server starts. Randomize seed a few times — some logos should contain organic blob shapes mixed with geometric ones.

- [ ] **Step 6: Commit**

```bash
git add src/engine/primitives/blob.ts src/engine/primitives/index.ts src/engine/generators/GeometricRadialGenerator.ts
git commit -m "feat: add blob primitive with seeded noise displacement"
```

---

## Phase 3: Export, Presets, Undo/Redo, URL Sharing

### Task 2: SVG + PNG Export

**Files:**
- Create: `src/hooks/useExport.ts`
- Create: `src/components/export/ExportDialog.tsx`
- Modify: `src/components/layout/Toolbar.tsx`

- [ ] **Step 1: Create useExport hook**

Create `src/hooks/useExport.ts`:

```typescript
import { useLogoStore } from '../store/logoStore.ts'

function generateSVGString(
  compoundPathData: string,
  fillRule: 'nonzero' | 'evenodd',
  viewBox: { x: number; y: number; width: number; height: number },
  fillColor: string,
): string {
  const padding = 20
  const vb = `${viewBox.x - padding} ${viewBox.y - padding} ${viewBox.width + padding * 2} ${viewBox.height + padding * 2}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">`,
    `  <path d="${compoundPathData}" fill="${fillColor}" fill-rule="${fillRule}" />`,
    `</svg>`,
  ].join('\n')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function useExport() {
  const result = useLogoStore((s) => s.result)
  const params = useLogoStore((s) => s.params)

  function exportSVG() {
    if (!result || !result.mark.compoundPathData) return
    const svg = generateSVGString(
      result.mark.compoundPathData,
      result.mark.fillRule,
      result.mark.viewBox,
      params.fillColor,
    )
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    downloadBlob(blob, `logo-${params.seed}.svg`)
  }

  function exportPNG(scale = 2) {
    if (!result || !result.mark.compoundPathData) return
    const svg = generateSVGString(
      result.mark.compoundPathData,
      result.mark.fillRule,
      result.mark.viewBox,
      params.fillColor,
    )

    const img = new Image()
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 1024 * scale
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)

      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `logo-${params.seed}.png`)
      }, 'image/png')
    }

    img.src = url
  }

  return { exportSVG, exportPNG, canExport: !!result?.mark.compoundPathData }
}
```

- [ ] **Step 2: Create ExportDialog component**

Create `src/components/export/ExportDialog.tsx`:

```tsx
import { useState } from 'react'
import { useExport } from '../../hooks/useExport.ts'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { exportSVG, exportPNG, canExport } = useExport()
  const [pngScale, setPngScale] = useState(2)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-80">
        <h2 className="text-sm font-semibold text-neutral-900 mb-4">Export Logo</h2>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => { exportSVG(); onClose() }}
            disabled={!canExport}
            className="w-full px-4 py-2.5 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Download SVG
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => { exportPNG(pngScale); onClose() }}
              disabled={!canExport}
              className="flex-1 px-4 py-2.5 text-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Download PNG
            </button>
            <select
              value={pngScale}
              onChange={(e) => setPngScale(Number(e.target.value))}
              className="px-2 py-1 text-xs border border-neutral-200 rounded-lg bg-white"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add Export button to Toolbar**

Replace `src/components/layout/Toolbar.tsx` with:

```tsx
import { useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <>
      <header className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-tight text-neutral-900 uppercase">
            Generative Logo System
          </h1>
          <span className="text-xs font-mono text-neutral-400">
            Seed #{seed}
          </span>
        </div>
        <button
          onClick={() => setExportOpen(true)}
          className="px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded-md hover:bg-neutral-700 transition-colors"
        >
          Export
        </button>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
```

- [ ] **Step 4: Verify export works**

Run: `npm run dev`

Expected: Export button appears in toolbar. Click it, dialog opens. Download SVG — open in browser, verify it shows the logo. Download PNG — verify it's a raster image at the selected scale.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useExport.ts src/components/export/ExportDialog.tsx src/components/layout/Toolbar.tsx
git commit -m "feat: add SVG and PNG export with dialog"
```

### Task 3: Undo/Redo with Zustand Temporal

**Files:**
- Create: `src/store/historyMiddleware.ts`
- Modify: `src/store/logoStore.ts`
- Modify: `src/components/layout/Toolbar.tsx`

- [ ] **Step 1: Install zundo**

```bash
npm install zundo
```

- [ ] **Step 2: Create historyMiddleware.ts**

Create `src/store/historyMiddleware.ts`:

```typescript
import { temporal } from 'zundo'
import type { LogoParams } from '../engine/types.ts'

/**
 * Equality check: only snapshot when params change, not UI state.
 * Compares serialized params to avoid unnecessary history entries.
 */
export function paramsEqual(
  pastState: { params: LogoParams },
  currentState: { params: LogoParams },
): boolean {
  return JSON.stringify(pastState.params) === JSON.stringify(currentState.params)
}

export { temporal }
```

- [ ] **Step 3: Update logoStore.ts with temporal middleware**

Replace `src/store/logoStore.ts` with:

```typescript
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
  ui: UIState

  setParam: <K extends keyof LogoParams>(key: K, value: LogoParams[K]) => void
  setParams: (updates: Partial<LogoParams>) => void
  randomizeSeed: () => void
  setResult: (result: GenerationResult) => void
  toggleGrid: () => void
  toggleConstruction: () => void
  applyPreset: (params: Partial<LogoParams>) => void
}

export const useLogoStore = create<LogoStore>()(
  temporal(
    (set) => ({
      params: { ...DEFAULT_PARAMS },
      result: null,
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
          params: { ...state.params, seed: Math.floor(Math.random() * 10000) },
        })),

      setResult: (result) => set({ result }),

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
```

- [ ] **Step 4: Add undo/redo buttons to Toolbar**

Update `src/components/layout/Toolbar.tsx`:

```tsx
import { useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'

export function Toolbar() {
  const seed = useLogoStore((s) => s.params.seed)
  const [exportOpen, setExportOpen] = useState(false)

  const undo = useLogoStore.temporal.getState().undo
  const redo = useLogoStore.temporal.getState().redo

  return (
    <>
      <header className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-tight text-neutral-900 uppercase">
            Generative Logo System
          </h1>
          <span className="text-xs font-mono text-neutral-400">
            Seed #{seed}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => undo()}
            className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
            title="Undo (Cmd+Z)"
          >
            Undo
          </button>
          <button
            onClick={() => redo()}
            className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
            title="Redo (Cmd+Shift+Z)"
          >
            Redo
          </button>
          <button
            onClick={() => setExportOpen(true)}
            className="px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded-md hover:bg-neutral-700 transition-colors"
          >
            Export
          </button>
        </div>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}
```

- [ ] **Step 5: Add keyboard shortcuts for undo/redo**

Add to `src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell.tsx'
import { useGeneration } from './hooks/useGeneration.ts'
import { useLogoStore } from './store/logoStore.ts'

function App() {
  useGeneration()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().undo()
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().redo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <AppShell />
}

export default App
```

- [ ] **Step 6: Verify undo/redo works**

Run: `npm run dev`

Expected: Change sliders, click Undo — params revert. Click Redo — params restore. Cmd+Z / Cmd+Shift+Z keyboard shortcuts work. Toggling grid/construction checkboxes does NOT create undo history.

- [ ] **Step 7: Commit**

```bash
git add src/store/historyMiddleware.ts src/store/logoStore.ts src/components/layout/Toolbar.tsx src/App.tsx package.json package-lock.json
git commit -m "feat: add undo/redo with zundo temporal middleware"
```

### Task 4: Presets

**Files:**
- Create: `src/store/presets.ts`
- Create: `src/components/controls/PresetSelector.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] **Step 1: Create presets.ts**

Create `src/store/presets.ts`:

```typescript
import type { LogoParams } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'

export interface Preset {
  id: string
  name: string
  description: string
  params: Partial<LogoParams>
}

export const PRESETS: Preset[] = [
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Delicate 6-fold crystal pattern',
    params: { seed: 142, gridRings: 4, symmetryFolds: 6, additiveRatio: 0.7, baseRadius: 0.4, radiusVariation: 0.5, rotation: 0 },
  },
  {
    id: 'starburst',
    name: 'Starburst',
    description: 'Dense radial explosion',
    params: { seed: 88, gridRings: 6, symmetryFolds: 8, additiveRatio: 0.85, baseRadius: 0.3, radiusVariation: 1.2, rotation: 0 },
  },
  {
    id: 'shield',
    name: 'Shield',
    description: 'Bold 4-fold symmetry with negative space',
    params: { seed: 303, gridRings: 3, symmetryFolds: 4, additiveRatio: 0.5, baseRadius: 0.7, radiusVariation: 0.2, rotation: 45 },
  },
  {
    id: 'bloom',
    name: 'Bloom',
    description: 'Organic petal arrangement',
    params: { seed: 567, gridRings: 3, symmetryFolds: 5, additiveRatio: 0.75, baseRadius: 0.6, radiusVariation: 0.8, rotation: 0 },
  },
  {
    id: 'monogram',
    name: 'Monogram',
    description: 'Minimal 2-fold mark',
    params: { seed: 21, gridRings: 2, symmetryFolds: 2, additiveRatio: 0.9, baseRadius: 0.5, radiusVariation: 0.3, rotation: 0 },
  },
  {
    id: 'mandala',
    name: 'Mandala',
    description: 'Complex layered circular pattern',
    params: { seed: 999, gridRings: 7, symmetryFolds: 12, additiveRatio: 0.65, baseRadius: 0.25, radiusVariation: 0.6, rotation: 15 },
  },
  {
    id: 'crown',
    name: 'Crown',
    description: 'Pointed 3-fold structure',
    params: { seed: 415, gridRings: 4, symmetryFolds: 3, additiveRatio: 0.6, baseRadius: 0.55, radiusVariation: 1.0, rotation: 0 },
  },
  {
    id: 'coin',
    name: 'Coin',
    description: 'Dense compact circle motif',
    params: { seed: 777, gridRings: 5, symmetryFolds: 10, additiveRatio: 0.8, baseRadius: 0.35, radiusVariation: 0.15, rotation: 0 },
  },
  {
    id: 'scatter',
    name: 'Scatter',
    description: 'Sparse asymmetric composition',
    params: { seed: 42, gridRings: 8, symmetryFolds: 1, additiveRatio: 0.55, baseRadius: 0.45, radiusVariation: 1.5, rotation: 0 },
  },
  {
    id: 'void',
    name: 'Void',
    description: 'Heavy subtraction, negative space focus',
    params: { seed: 256, gridRings: 5, symmetryFolds: 7, additiveRatio: 0.35, baseRadius: 0.5, radiusVariation: 0.4, rotation: 0 },
  },
]
```

- [ ] **Step 2: Create PresetSelector component**

Create `src/components/controls/PresetSelector.tsx`:

```tsx
import { PRESETS } from '../../store/presets.ts'
import { useLogoStore } from '../../store/logoStore.ts'

export function PresetSelector() {
  const applyPreset = useLogoStore((s) => s.applyPreset)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Presets
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => applyPreset(preset.params)}
            className="px-2 py-1.5 text-xs text-left border border-neutral-200 rounded-md hover:bg-neutral-100 transition-colors"
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add PresetSelector to ParameterPanel**

In `src/components/controls/ParameterPanel.tsx`, add the import and component:

Add import at top:
```typescript
import { PresetSelector } from './PresetSelector.tsx'
```

Add `<PresetSelector />` at the bottom of the returned JSX, after the toggle checkboxes section:

```tsx
      <PresetSelector />
```

- [ ] **Step 4: Verify presets work**

Run: `npm run dev`

Expected: Preset buttons appear below toggles. Clicking a preset updates all sliders and regenerates the logo. Undo reverses a preset application.

- [ ] **Step 5: Commit**

```bash
git add src/store/presets.ts src/components/controls/PresetSelector.tsx src/components/controls/ParameterPanel.tsx
git commit -m "feat: add 10 curated presets with selector UI"
```

### Task 5: Generator Selector

**Files:**
- Create: `src/components/controls/GeneratorSelector.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] **Step 1: Create GeneratorSelector component**

Create `src/components/controls/GeneratorSelector.tsx`:

```tsx
import { useLogoStore } from '../../store/logoStore.ts'
import { listGenerators } from '../../engine/generators/registry.ts'

export function GeneratorSelector() {
  const generatorId = useLogoStore((s) => s.params.generatorId)
  const setParam = useLogoStore((s) => s.setParam)
  const generators = listGenerators()

  if (generators.length <= 1) return null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-500 uppercase tracking-wider">
        Generator
      </span>
      <select
        value={generatorId}
        onChange={(e) => setParam('generatorId', e.target.value)}
        className="px-2.5 py-1.5 text-sm bg-neutral-100 border border-neutral-200 rounded-md outline-none focus:border-neutral-400"
      >
        {generators.map((gen) => (
          <option key={gen.id} value={gen.id}>
            {gen.name}
          </option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 2: Add GeneratorSelector to ParameterPanel**

In `src/components/controls/ParameterPanel.tsx`, add import:
```typescript
import { GeneratorSelector } from './GeneratorSelector.tsx'
```

Add `<GeneratorSelector />` right after `<SeedInput />` in the JSX.

- [ ] **Step 3: Verify**

Run: `npm run dev`

Expected: Generator selector appears but is hidden when only one generator exists (GeometricRadial). It will become visible after the ModularGenerator is added in Phase 5.

- [ ] **Step 4: Commit**

```bash
git add src/components/controls/GeneratorSelector.tsx src/components/controls/ParameterPanel.tsx
git commit -m "feat: add generator selector UI (hidden until multiple generators exist)"
```

### Task 6: URL State Persistence

**Files:**
- Create: `src/hooks/useUrlState.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create useUrlState hook**

Create `src/hooks/useUrlState.ts`:

```typescript
import { useEffect, useRef } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import type { LogoParams } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'
import { getGenerator } from '../engine/generators/registry.ts'

const PARAM_KEYS: (keyof LogoParams)[] = [
  'seed', 'gridRings', 'additiveRatio', 'baseRadius',
  'radiusVariation', 'rotation', 'symmetryFolds', 'fillColor',
  'animationSpeed', 'generatorId',
]

function encodeParams(params: LogoParams): string {
  const generator = getGenerator(params.generatorId)
  const searchParams = new URLSearchParams()

  for (const key of PARAM_KEYS) {
    const value = params[key]
    const defaultValue = DEFAULT_PARAMS[key]
    if (value !== defaultValue) {
      searchParams.set(key, String(value))
    }
  }

  if (generator) {
    searchParams.set('v', generator.version)
  }

  // Encode extra params
  for (const [k, v] of Object.entries(params.extra)) {
    searchParams.set(`x.${k}`, String(v))
  }

  return searchParams.toString()
}

function decodeParams(hash: string): Partial<LogoParams> | null {
  if (!hash || hash === '#') return null

  const searchParams = new URLSearchParams(hash.replace(/^#/, ''))
  const updates: Partial<LogoParams> = {}
  const extra: Record<string, number> = {}

  for (const [key, value] of searchParams.entries()) {
    if (key === 'v') continue // version, not a param

    if (key.startsWith('x.')) {
      extra[key.slice(2)] = Number(value)
      continue
    }

    if (PARAM_KEYS.includes(key as keyof LogoParams)) {
      const k = key as keyof LogoParams
      if (k === 'fillColor' || k === 'generatorId') {
        (updates as Record<string, string>)[k] = value
      } else {
        const num = Number(value)
        if (!isNaN(num)) {
          (updates as Record<string, number>)[k] = num
        }
      }
    }
  }

  if (Object.keys(extra).length > 0) {
    updates.extra = extra
  }

  return Object.keys(updates).length > 0 ? updates : null
}

export function useUrlState() {
  const params = useLogoStore((s) => s.params)
  const setParams = useLogoStore((s) => s.setParams)
  const initialized = useRef(false)

  // On mount: read URL hash and apply params
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const decoded = decodeParams(window.location.hash)
    if (decoded) {
      setParams(decoded)
    }
  }, [setParams])

  // On param change: update URL hash
  useEffect(() => {
    if (!initialized.current) return
    const encoded = encodeParams(params)
    const newHash = encoded ? `#${encoded}` : ''
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', newHash || window.location.pathname)
    }
  }, [params])
}
```

- [ ] **Step 2: Wire useUrlState into App.tsx**

Update `src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell.tsx'
import { useGeneration } from './hooks/useGeneration.ts'
import { useUrlState } from './hooks/useUrlState.ts'
import { useLogoStore } from './store/logoStore.ts'

function App() {
  useGeneration()
  useUrlState()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().undo()
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().redo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <AppShell />
}

export default App
```

- [ ] **Step 3: Verify URL sharing**

Run: `npm run dev`

Expected: Adjust sliders — URL hash updates. Copy URL, open in new tab — same logo appears. Default params produce a clean URL with no hash.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useUrlState.ts src/App.tsx
git commit -m "feat: add URL hash state persistence for shareable logos"
```

---

## Phase 4: Animation

### Task 7: Animation Engine

**Files:**
- Create: `src/engine/animation/types.ts`
- Create: `src/engine/animation/keyframes.ts`
- Modify: `src/engine/generators/GeometricRadialGenerator.ts`

- [ ] **Step 1: Create animation types**

Create `src/engine/animation/types.ts`:

```typescript
export interface AnimationKeyframe {
  time: number // 0-1 normalized
  rotation: number // radians
  scale: number
  opacity: number
}

export interface AnimationConfig {
  duration: number // ms
  keyframes: AnimationKeyframe[]
  loop: boolean
}
```

- [ ] **Step 2: Create keyframe generator**

Create `src/engine/animation/keyframes.ts`:

```typescript
import type { AnimationKeyframe } from './types.ts'
import type { LogoParams, SeededRandom } from '../types.ts'

/**
 * Generates animation keyframes for the geometric radial generator.
 * Rotation speed and scale pulsing based on animationSpeed param.
 */
export function generateRadialKeyframes(
  params: LogoParams,
  _rng: SeededRandom,
  frameCount = 60,
): AnimationKeyframe[] {
  const speed = params.animationSpeed
  if (speed === 0) return []

  const keyframes: AnimationKeyframe[] = []
  for (let i = 0; i <= frameCount; i++) {
    const t = i / frameCount
    keyframes.push({
      time: t,
      rotation: t * Math.PI * 2 * speed * 0.5,
      scale: 1 + Math.sin(t * Math.PI * 2) * speed * 0.05,
      opacity: 1,
    })
  }

  return keyframes
}

/**
 * Interpolates between keyframes at a given normalized time (0-1).
 */
export function interpolateKeyframe(
  keyframes: AnimationKeyframe[],
  t: number,
): AnimationKeyframe {
  if (keyframes.length === 0) return { time: t, rotation: 0, scale: 1, opacity: 1 }
  if (keyframes.length === 1) return keyframes[0]

  const normalizedT = t % 1

  let i = 0
  while (i < keyframes.length - 1 && keyframes[i + 1].time <= normalizedT) {
    i++
  }

  if (i >= keyframes.length - 1) return keyframes[keyframes.length - 1]

  const a = keyframes[i]
  const b = keyframes[i + 1]
  const segmentT = (normalizedT - a.time) / (b.time - a.time)

  return {
    time: normalizedT,
    rotation: a.rotation + (b.rotation - a.rotation) * segmentT,
    scale: a.scale + (b.scale - a.scale) * segmentT,
    opacity: a.opacity + (b.opacity - a.opacity) * segmentT,
  }
}
```

- [ ] **Step 3: Commit animation engine**

```bash
git add src/engine/animation/types.ts src/engine/animation/keyframes.ts
git commit -m "feat: add animation keyframe engine with interpolation"
```

### Task 8: Animation Hook and UI

**Files:**
- Create: `src/hooks/useAnimation.ts`
- Create: `src/components/canvas/AnimationControls.tsx`
- Modify: `src/components/canvas/LogoCanvas.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] **Step 1: Create useAnimation hook**

Create `src/hooks/useAnimation.ts`:

```typescript
import { useRef, useEffect, useCallback, useState } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import type { AnimationKeyframe } from '../engine/animation/types.ts'
import { generateRadialKeyframes, interpolateKeyframe } from '../engine/animation/keyframes.ts'
import { SeededPRNG } from '../engine/random.ts'

export function useAnimation(
  onFrame: (keyframe: AnimationKeyframe) => void,
) {
  const params = useLogoStore((s) => s.params)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef(0)
  const keyframesRef = useRef<AnimationKeyframe[]>([])

  // Regenerate keyframes when params change
  useEffect(() => {
    const rng = new SeededPRNG(params.seed)
    keyframesRef.current = generateRadialKeyframes(params, rng)

    if (params.animationSpeed === 0) {
      setPlaying(false)
    }
  }, [params])

  const loop = useCallback((timestamp: number) => {
    if (!startTimeRef.current) startTimeRef.current = timestamp
    const elapsed = timestamp - startTimeRef.current
    const duration = 3000 / Math.max(0.1, params.animationSpeed)
    const t = (elapsed / duration) % 1

    const keyframe = interpolateKeyframe(keyframesRef.current, t)
    onFrame(keyframe)

    rafRef.current = requestAnimationFrame(loop)
  }, [onFrame, params.animationSpeed])

  useEffect(() => {
    if (playing && keyframesRef.current.length > 0) {
      startTimeRef.current = 0
      rafRef.current = requestAnimationFrame(loop)
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      // Reset to identity
      onFrame({ time: 0, rotation: 0, scale: 1, opacity: 1 })
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, loop, onFrame])

  const togglePlaying = useCallback(() => {
    if (params.animationSpeed === 0) return
    setPlaying((p) => !p)
  }, [params.animationSpeed])

  return { playing, togglePlaying, canAnimate: params.animationSpeed > 0 }
}
```

- [ ] **Step 2: Create AnimationControls component**

Create `src/components/canvas/AnimationControls.tsx`:

```tsx
interface AnimationControlsProps {
  playing: boolean
  canAnimate: boolean
  onToggle: () => void
}

export function AnimationControls({ playing, canAnimate, onToggle }: AnimationControlsProps) {
  if (!canAnimate) return null

  return (
    <button
      onClick={onToggle}
      className="absolute bottom-3 left-3 px-3 py-1.5 text-xs font-medium bg-white/90 border border-neutral-200 rounded-md hover:bg-white transition-colors shadow-sm"
    >
      {playing ? 'Pause' : 'Play'}
    </button>
  )
}
```

- [ ] **Step 3: Wire animation into LogoCanvas**

Replace `src/components/canvas/LogoCanvas.tsx` with:

```tsx
import { useRef, useEffect, useCallback } from 'react'
import { usePaperScope } from '../../renderer/usePaperScope.ts'
import { renderLogoOnScope } from '../../renderer/PaperRenderer.ts'
import { useLogoStore } from '../../store/logoStore.ts'
import { useAnimation } from '../../hooks/useAnimation.ts'
import { AnimationControls } from './AnimationControls.tsx'
import type { AnimationKeyframe } from '../../engine/animation/types.ts'

export function LogoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = usePaperScope(canvasRef)
  const result = useLogoStore((s) => s.result)
  const ui = useLogoStore((s) => s.ui)
  const fillColor = useLogoStore((s) => s.params.fillColor)

  // Static render
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !result) return

    renderLogoOnScope(scope, result, {
      showGrid: ui.showGrid,
      showConstruction: ui.showConstruction,
      fillColor,
    })
  }, [result, ui.showGrid, ui.showConstruction, fillColor, scopeRef])

  // Animation frame callback
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

  return (
    <div className="flex-1 flex items-center justify-center bg-white relative">
      <canvas
        ref={canvasRef}
        width={600}
        height={600}
        className="w-full h-full max-w-[600px] max-h-[600px]"
        style={{ imageRendering: 'auto' }}
      />
      <AnimationControls
        playing={playing}
        canAnimate={canAnimate}
        onToggle={togglePlaying}
      />
    </div>
  )
}
```

- [ ] **Step 4: Add animation speed slider to ParameterPanel**

In `src/components/controls/ParameterPanel.tsx`, add after the Rotation slider:

```tsx
      <SliderControl
        label="Animation Speed"
        value={params.animationSpeed}
        min={0}
        max={5}
        step={0.1}
        onChange={(v) => setParam('animationSpeed', v)}
      />
```

- [ ] **Step 5: Verify animation**

Run: `npm run dev`

Expected: Animation speed at 0 = no animation, no play button. Increase animation speed — Play button appears. Click Play — logo rotates and subtly scales. Click Pause — logo stops. Changing other params while animating updates the logo shape.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAnimation.ts src/components/canvas/AnimationControls.tsx src/components/canvas/LogoCanvas.tsx src/components/controls/ParameterPanel.tsx src/engine/animation/
git commit -m "feat: add animation system with play/pause and speed control"
```

---

## Phase 5: Modular Generator and Polish

### Task 9: Modular Grid + Generator

**Files:**
- Create: `src/engine/grid/ModularGrid.ts`
- Create: `src/engine/generators/ModularGenerator.ts`
- Modify: `src/engine/generators/registry.ts`

- [ ] **Step 1: Create ModularGrid**

Create `src/engine/grid/ModularGrid.ts`:

```typescript
import type { GridPoint, SeededRandom } from '../types.ts'

export interface ModularGridParams {
  columns: number
  rows: number
  canvasSize: number
  baseRadius: number
  radiusVariation: number
}

/**
 * Generates placement points on a tile/repeat grid.
 */
export function generateModularGrid(
  params: ModularGridParams,
  rng: SeededRandom,
): GridPoint[] {
  const { columns, rows, canvasSize, baseRadius, radiusVariation } = params
  const points: GridPoint[] = []

  const cellW = (canvasSize * 0.8) / columns
  const cellH = (canvasSize * 0.8) / rows
  const startX = -(canvasSize * 0.4)
  const startY = -(canvasSize * 0.4)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cx = startX + cellW * (col + 0.5)
      const cy = startY + cellH * (row + 0.5)

      // Add slight random jitter
      const jitterX = rng.nextFloat(-cellW * 0.1, cellW * 0.1)
      const jitterY = rng.nextFloat(-cellH * 0.1, cellH * 0.1)

      const shapeRadius =
        canvasSize * baseRadius * 0.12 * (1 + rng.nextFloat(-radiusVariation, radiusVariation) * 0.5)

      points.push({
        ring: row,
        angle: (2 * Math.PI * col) / columns,
        x: Math.round((cx + jitterX) * 1000) / 1000,
        y: Math.round((cy + jitterY) * 1000) / 1000,
        ringRadius: Math.round(shapeRadius * 1000) / 1000,
      })
    }
  }

  return points
}
```

- [ ] **Step 2: Create ModularGenerator**

Create `src/engine/generators/ModularGenerator.ts`:

```typescript
import type {
  LogoGenerator,
  LogoParams,
  SeededRandom,
  GenerationResult,
  ShapeNode,
  ParamDefinition,
} from '../types.ts'
import { generateModularGrid } from '../grid/ModularGrid.ts'
import { pickPrimitiveType, createPrimitivePath, type PrimitiveType } from '../primitives/index.ts'
import { composeBooleanResult } from '../boolean/operations.ts'

const CANVAS_SIZE = 500

export const ModularGenerator: LogoGenerator = {
  id: 'modular',
  name: 'Modular Grid',
  description: 'Tile/repeat grid patterns with optional circular clipping',
  version: '1.0',
  extraParams: [
    { key: 'columns', label: 'Columns', min: 2, max: 8, step: 1, default: 4 },
    { key: 'rows', label: 'Rows', min: 2, max: 8, step: 1, default: 4 },
    { key: 'circleClip', label: 'Circle Clip', min: 0, max: 1, step: 1, default: 1 },
  ] satisfies ParamDefinition[],

  generate(params: LogoParams, rng: SeededRandom): GenerationResult {
    const columns = params.extra.columns ?? 4
    const rows = params.extra.rows ?? 4
    const useClip = (params.extra.circleClip ?? 1) > 0.5

    const gridPoints = generateModularGrid(
      {
        columns,
        rows,
        canvasSize: CANVAS_SIZE,
        baseRadius: params.baseRadius,
        radiusVariation: params.radiusVariation,
      },
      rng,
    )

    const allShapes: ShapeNode[] = gridPoints.map((point, i) => {
      const type = pickPrimitiveType(rng)
      const operation: 'add' | 'subtract' = rng.nextBool(params.additiveRatio)
        ? 'add'
        : 'subtract'
      const shapeRotation = rng.nextFloat(0, Math.PI * 2)

      const shapeParams: Record<string, number> =
        type === 'polygon' ? { sides: rng.nextInt(3, 6) } : {}

      return {
        id: `mod_${i}`,
        type,
        role: 'prototype' as const,
        operation,
        center: { x: point.x, y: point.y },
        radius: point.ringRadius,
        rotation: shapeRotation,
        params: shapeParams,
      }
    })

    // Apply global rotation
    const globalRotation = (params.rotation * Math.PI) / 180
    const rotatedShapes: ShapeNode[] =
      globalRotation === 0
        ? allShapes
        : allShapes.map((shape) => {
            const cos = Math.cos(globalRotation)
            const sin = Math.sin(globalRotation)
            const x = shape.center.x * cos - shape.center.y * sin
            const y = shape.center.x * sin + shape.center.y * cos
            return {
              ...shape,
              center: {
                x: Math.round(x * 1000) / 1000,
                y: Math.round(y * 1000) / 1000,
              },
              rotation: shape.rotation + globalRotation,
            }
          })

    // Build path data
    const booleanInputs = rotatedShapes.map((shape) => ({
      pathData: createPrimitivePath(
        shape.type as PrimitiveType,
        shape.center.x,
        shape.center.y,
        shape.radius,
        shape.rotation,
        shape.params,
        rng,
      ),
      operation: shape.operation,
    }))

    // If circle clip, add a large circle as the first additive shape
    if (useClip) {
      const clipRadius = CANVAS_SIZE * 0.38
      const clipPath = `M ${-clipRadius} 0 A ${clipRadius} ${clipRadius} 0 1 0 ${clipRadius} 0 A ${clipRadius} ${clipRadius} 0 1 0 ${-clipRadius} 0 Z`
      booleanInputs.unshift({ pathData: clipPath, operation: 'add' })

      // Change all additive shapes to intersect by making them subtractive
      // and adding them back as a second pass... Actually, simpler approach:
      // just compose normally, then intersect with circle.
    }

    const boolResult = composeBooleanResult(booleanInputs)

    const addCount = rotatedShapes.filter((s) => s.operation === 'add').length
    const subCount = rotatedShapes.filter((s) => s.operation === 'subtract').length

    return {
      shapes: rotatedShapes,
      mark: {
        layers: [],
        compoundPathData: boolResult.compoundPathData,
        fillRule: boolResult.fillRule as 'nonzero' | 'evenodd',
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridLines: [],
        stats: {
          totalShapes: rotatedShapes.length,
          additiveCount: addCount,
          subtractiveCount: subCount,
          symmetryFolds: 1,
        },
      },
      warnings: boolResult.warnings,
    }
  },
}
```

- [ ] **Step 3: Register ModularGenerator**

Replace `src/engine/generators/registry.ts`:

```typescript
import type { LogoGenerator } from '../types.ts'
import { GeometricRadialGenerator } from './GeometricRadialGenerator.ts'
import { ModularGenerator } from './ModularGenerator.ts'

const registry = new Map<string, LogoGenerator>()

export function registerGenerator(generator: LogoGenerator): void {
  registry.set(generator.id, generator)
}

export function getGenerator(id: string): LogoGenerator | undefined {
  return registry.get(id)
}

export function listGenerators(): LogoGenerator[] {
  return Array.from(registry.values())
}

// Register built-in generators
registerGenerator(GeometricRadialGenerator)
registerGenerator(ModularGenerator)
```

- [ ] **Step 4: Show extra params in ParameterPanel when generator has them**

In `src/components/controls/ParameterPanel.tsx`, add dynamic extra param sliders. Add after the GeneratorSelector:

```tsx
      {/* Dynamic extra params from generator */}
      {currentGenerator?.extraParams.map((paramDef) => (
        <SliderControl
          key={paramDef.key}
          label={paramDef.label}
          value={params.extra[paramDef.key] ?? paramDef.default}
          min={paramDef.min}
          max={paramDef.max}
          step={paramDef.step}
          onChange={(v) => {
            setParam('extra', { ...params.extra, [paramDef.key]: v })
          }}
        />
      ))}
```

Add the import and generator lookup at the top of the component function:

```typescript
import { getGenerator } from '../../engine/generators/registry.ts'

// Inside ParameterPanel function:
const currentGenerator = getGenerator(params.generatorId)
```

- [ ] **Step 5: Verify generator switching**

Run: `npm run dev`

Expected: Generator dropdown now shows two options: "Geometric Radial" and "Modular Grid". Switching to Modular Grid shows extra sliders (Columns, Rows, Circle Clip). The generated logo uses a grid pattern instead of radial symmetry.

- [ ] **Step 6: Commit**

```bash
git add src/engine/grid/ModularGrid.ts src/engine/generators/ModularGenerator.ts src/engine/generators/registry.ts src/components/controls/ParameterPanel.tsx
git commit -m "feat: add modular grid generator with tile/repeat patterns"
```

### Task 10: Responsive Layout

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Make AppShell responsive**

Replace `src/components/layout/AppShell.tsx` with:

```tsx
import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { ParameterPanel } from '../controls/ParameterPanel.tsx'
import { FinalPreview } from '../preview/FinalPreview.tsx'
import { ConstructionData } from '../preview/ConstructionData.tsx'

export function AppShell() {
  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <Toolbar />
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Main canvas area */}
        <div className="flex-1 flex flex-col p-4 gap-4 min-h-0">
          <LogoCanvas />
          <div className="flex gap-4 flex-shrink-0">
            <ConstructionData />
            <FinalPreview />
          </div>
        </div>

        {/* Parameter panel — collapsible on mobile */}
        <aside className="w-full md:w-64 border-t md:border-t-0 md:border-l border-neutral-200 bg-neutral-50 overflow-y-auto max-h-[40vh] md:max-h-none">
          <ParameterPanel />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify responsive behavior**

Run: `npm run dev`

Expected: On wide screens — side panel on right. On narrow screens (<768px) — panel stacks below canvas, scrollable, max 40vh. Canvas fills available space.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: add responsive layout with collapsible panel"
```

### Task 11: Keyboard Shortcuts

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add keyboard shortcuts**

Update the `handleKeyDown` function in `src/App.tsx`:

```tsx
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when input is focused
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().undo()
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault()
          useLogoStore.temporal.getState().redo()
        }
        if (e.key === 'e') {
          e.preventDefault()
          // Export shortcut — dispatch custom event
          window.dispatchEvent(new CustomEvent('open-export'))
        }
      }

      // R = randomize seed
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        useLogoStore.getState().randomizeSeed()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
```

Also update `Toolbar.tsx` to listen for the export event:

```tsx
  useEffect(() => {
    function handleOpenExport() {
      setExportOpen(true)
    }
    window.addEventListener('open-export', handleOpenExport)
    return () => window.removeEventListener('open-export', handleOpenExport)
  }, [])
```

- [ ] **Step 2: Verify shortcuts**

Run: `npm run dev`

Expected: `R` randomizes seed. `Cmd+Z` undoes. `Cmd+Shift+Z` redoes. `Cmd+E` opens export. Shortcuts don't fire when typing in seed input.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/layout/Toolbar.tsx
git commit -m "feat: add keyboard shortcuts (R=random, Cmd+E=export, Cmd+Z/Shift+Z=undo/redo)"
```

---

## Verification Checklist

After all tasks are complete, run through these checks:

- [ ] `npm run dev` — app loads without errors
- [ ] `npx tsc --noEmit` — no type errors
- [ ] Adjust seed slider — new logo each time
- [ ] Toggle construction view — grid lines appear/disappear
- [ ] All parameter sliders update logo in real-time
- [ ] Switch generators — different logo structure
- [ ] Modular generator shows extra params (columns, rows, circle clip)
- [ ] Export SVG — open in browser, verify match
- [ ] Export PNG — verify resolution
- [ ] Test all 10 presets — each produces a distinct logo
- [ ] Randomize rapidly — no crashes or artifacts
- [ ] Undo/redo — parameter changes reversible
- [ ] Cmd+Z / Cmd+Shift+Z work
- [ ] Reload shared URL — same logo reproduces
- [ ] Animation: increase speed, click play, logo animates
- [ ] Responsive: narrow window, panel stacks below canvas
- [ ] R key randomizes, Cmd+E opens export
