# Wave Arc Generator & Pixel Dissolution Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Wave Arc crescent generator (5th mode) and a Pixel Dissolution post-effect that works on any mode's output.

**Architecture:** Wave Arc follows the existing generator pattern (generate shapes → boolean compose → return GenerationResult). Dissolution is a new effect pipeline layer — it reads the generator's output, produces memoized derived particle geometry, and feeds into the renderer/export without mutating the generator contract. Effect params live in the store; effect results are memoized derived data.

**Tech Stack:** React 19, TypeScript, Zustand + Zundo, Paper.js (boolean ops), Tailwind CSS 4

**Design Spec:** `docs/superpowers/specs/2026-04-01-wave-arc-and-dissolution-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/engine/generators/WaveArcGenerator.ts` | Crescent generation with bilateral/radial symmetry |
| `src/engine/effects/types.ts` | `DissolutionParams`, `DissolutionResult`, `DissolutionCell`, effect registry interface |
| `src/engine/effects/dissolution.ts` | Dissolution processor: samples mark → distance field → particles |
| `src/engine/effects/registry.ts` | Effect registration and lookup |
| `src/components/controls/EffectControls.tsx` | Dissolution UI (toggle + sliders) |

### Modified Files

| File | Changes |
|------|---------|
| `src/engine/types.ts` | Add `EffectParamsMap` type, add `'ellipse'` to `ShapeNode.type` union, widen `ModeParamMap` value type to `number \| string` |
| `src/engine/generators/registry.ts` | Register `WaveArcGenerator` |
| `src/engine/primitives/index.ts` | Add `ellipsePath` dispatch |
| `src/engine/primitives/ellipse.ts` | New ellipse primitive (for crescent construction) |
| `src/engine/animation/keyframes.ts` | Add `generateWaveArcKeyframes` |
| `src/store/modes.ts` | Add `wave-arc` mode definition, defaults, limits, style overrides |
| `src/store/presets.ts` | Add 3 wave-arc presets |
| `src/store/logoStore.ts` | Add `effectParams` to store, `setEffectParam`, `toggleEffect`; widen `setModeParam` value type to `number \| string` |
| `src/store/historyMiddleware.ts` | Include `effectParams` in `stableParamsString` |
| `src/components/controls/ParameterPanel.tsx` | Add wave-arc mode controls + import EffectControls |
| `src/renderer/PaperRenderer.ts` | Accept optional dissolution result, render particles |
| `src/renderer/FinalView.ts` | Add `renderDissolution` function |
| `src/hooks/useExport.ts` | Accept dissolution result, serialize active layers |
| `src/hooks/useUrlState.ts` | Encode/decode `effectParams` with `e.` prefix |
| `src/components/canvas/LogoCanvas.tsx` | Compute dissolution, pass to renderer |
| `src/components/export/ExportDialog.tsx` | Show "Dissolution applied" indicator |

---

## Task 1: Add Ellipse Primitive

Crescents are built from two ellipses. The existing primitive system has circles but not ellipses.

**Files:**
- Create: `src/engine/primitives/ellipse.ts`
- Modify: `src/engine/primitives/index.ts`
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Create the ellipse primitive**

```typescript
// src/engine/primitives/ellipse.ts

/**
 * SVG path for an axis-aligned ellipse centered at (cx, cy).
 * radiusX and radiusY are the horizontal and vertical radii.
 * Rotation is in radians and rotates the entire ellipse around its center.
 */
export function ellipsePath(
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
): string {
  // Generate ellipse as 4 cubic bezier curves
  const k = 0.5522847498 // Kappa constant for circle-to-bezier
  const ox = radiusX * k
  const oy = radiusY * k

  // Points before rotation (relative to center)
  const points: Array<[number, number]> = [
    [0, -radiusY],        // top
    [radiusX, 0],         // right
    [0, radiusY],         // bottom
    [-radiusX, 0],        // left
  ]

  const controls: Array<[[number, number], [number, number]]> = [
    [[ox, -radiusY], [radiusX, -oy]],     // top -> right
    [[radiusX, oy], [ox, radiusY]],        // right -> bottom
    [[-ox, radiusY], [-radiusX, oy]],      // bottom -> left
    [[-radiusX, -oy], [-ox, -radiusY]],    // left -> top
  ]

  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const r = (x: number, y: number): [number, number] => [
    Math.round((cx + x * cos - y * sin) * 1000) / 1000,
    Math.round((cy + x * sin + y * cos) * 1000) / 1000,
  ]

  const p = points.map(([x, y]) => r(x, y))
  const c = controls.map(([c1, c2]) => [r(c1[0], c1[1]), r(c2[0], c2[1])] as const)

  return [
    `M ${p[0][0]} ${p[0][1]}`,
    `C ${c[0][0][0]} ${c[0][0][1]} ${c[0][1][0]} ${c[0][1][1]} ${p[1][0]} ${p[1][1]}`,
    `C ${c[1][0][0]} ${c[1][0][1]} ${c[1][1][0]} ${c[1][1][1]} ${p[2][0]} ${p[2][1]}`,
    `C ${c[2][0][0]} ${c[2][0][1]} ${c[2][1][0]} ${c[2][1][1]} ${p[3][0]} ${p[3][1]}`,
    `C ${c[3][0][0]} ${c[3][0][1]} ${c[3][1][0]} ${c[3][1][1]} ${p[0][0]} ${p[0][1]}`,
    'Z',
  ].join(' ')
}
```

- [ ] **Step 2: Add `'ellipse'` to the ShapeNode type union in types.ts**

In `src/engine/types.ts`, update the `type` field on `ShapeNode`:

```typescript
export interface ShapeNode {
  id: string
  type: 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'blob' | 'ellipse'
  // ... rest unchanged
}
```

Also widen `ModeParamMap` to accept string enum values (needed for `arcSymmetry: 'bilateral' | 'radial'`):

```typescript
export type ModeParamMap = Record<string, Record<string, number | string>>
```

- [ ] **Step 3: Register ellipse in the primitive dispatcher**

In `src/engine/primitives/index.ts`, add the import and case:

```typescript
import { ellipsePath } from './ellipse.ts'

// Inside createPrimitivePath switch:
case 'ellipse':
  return ellipsePath(
    cx, cy,
    radius * (params.widthScale ?? 1),
    radius * (params.heightScale ?? 1),
    rotation,
  )
```

Also add `'ellipse'` to the `PrimitiveType` union if it's defined separately.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/engine/primitives/ellipse.ts src/engine/primitives/index.ts src/engine/types.ts
git commit -m "feat: add ellipse primitive for crescent construction"
```

---

## Task 2: Create WaveArcGenerator

The core generator that produces crescent marks.

**Files:**
- Create: `src/engine/generators/WaveArcGenerator.ts`
- Modify: `src/engine/generators/registry.ts`

- [ ] **Step 1: Create the generator file**

```typescript
// src/engine/generators/WaveArcGenerator.ts
import type {
  LogoGenerator,
  LogoParams,
  SeededRandom,
  GenerationResult,
  ShapeNode,
  ConstructionLine,
} from '../types.ts'
import { ellipsePath } from '../primitives/ellipse.ts'
import { composeBooleanResult } from '../boolean/operations.ts'
import { generateWaveArcKeyframes } from '../animation/keyframes.ts'

const CANVAS_SIZE = 500
const MAX_CRESCENTS = 96

export const WaveArcGenerator: LogoGenerator = {
  id: 'wave-arc',
  modeId: 'wave-arc',
  name: 'Wave Arc',
  description: 'Concentric crescent marks with bilateral or radial symmetry',
  version: '1.0',
  extraParams: [],
  getAnimationKeyframes: generateWaveArcKeyframes,

  generate(params: LogoParams, rng: SeededRandom): GenerationResult {
    const mp = params.modeParams['wave-arc'] ?? {}
    const arcCount = Math.round(mp.arcCount ?? 4)
    const spreadAngle = ((mp.spreadAngle ?? 120) * Math.PI) / 180
    const gapRatio = mp.gapRatio ?? 0.3
    const taperAmount = mp.taperAmount ?? 0.7
    const arcSymmetry: 'bilateral' | 'radial' = mp.arcSymmetry === 'radial' ? 'radial' : 'bilateral'
    const symmetryFolds = Math.round(mp.symmetryFolds ?? 4)
    const globalRotation = (params.rotation * Math.PI) / 180

    const warnings: string[] = []
    const maxRadius = CANVAS_SIZE * 0.4
    const shapes: ShapeNode[] = []

    // Build crescents for one side/spoke
    const crescentPaths: Array<{ pathData: string; operation: 'add' }> = []

    for (let i = 0; i < arcCount; i++) {
      const ringFraction = (i + 1) / (arcCount + 1)
      const outerRadius = maxRadius * ringFraction
      const thickness = outerRadius / (arcCount * (1 + gapRatio))
      const innerRadius = outerRadius - thickness

      // Inner ellipse is offset along the opening axis to create taper
      // Per spec: offset = taperAmount * outerRadius
      const taperOffset = taperAmount * outerRadius

      // Build outer ellipse (wider in the spread direction)
      const outerRx = outerRadius * Math.sin(spreadAngle / 2)
      const outerRy = outerRadius

      // Build inner ellipse (shifted to create taper)
      const innerRx = innerRadius * Math.sin(spreadAngle / 2)
      const innerRy = innerRadius

      // Outer ellipse centered at origin, opening rightward
      const outerPath = ellipsePath(0, 0, outerRx, outerRy, 0)
      // Inner ellipse offset toward the opening to taper the tips
      const innerPath = ellipsePath(taperOffset, 0, innerRx, innerRy, 0)

      // Boolean subtract: outer - inner = crescent
      const crescentResult = composeBooleanResult([
        { pathData: outerPath, operation: 'add' },
        { pathData: innerPath, operation: 'subtract' },
      ])

      if (crescentResult.compoundPathData) {
        crescentPaths.push({
          pathData: crescentResult.compoundPathData,
          operation: 'add',
        })
      }

      // Track shapes for construction view
      shapes.push({
        id: `crescent_outer_${i}`,
        type: 'ellipse',
        role: 'prototype',
        operation: 'add',
        center: { x: 0, y: 0 },
        radius: outerRadius,
        rotation: 0,
        params: { widthScale: outerRx / outerRadius, heightScale: 1 },
      })

      shapes.push({
        id: `crescent_inner_${i}`,
        type: 'ellipse',
        role: 'prototype',
        operation: 'subtract',
        center: { x: taperOffset, y: 0 },
        radius: innerRadius,
        rotation: 0,
        params: { widthScale: innerRx / innerRadius, heightScale: 1 },
      })
    }

    // Apply symmetry
    let allPaths = [...crescentPaths]

    if (arcSymmetry === 'bilateral') {
      // Mirror across vertical axis (flip X)
      const mirroredPaths = crescentPaths.map((cp) => ({
        pathData: mirrorPathX(cp.pathData),
        operation: cp.operation as 'add',
      }))
      allPaths = [...crescentPaths, ...mirroredPaths]

      // Add mirrored shapes for construction view
      const mirroredShapes = shapes.map((s, idx) => ({
        ...s,
        id: `${s.id}_mirror`,
        role: 'symmetry-instance' as const,
        center: { x: -s.center.x, y: s.center.y },
      }))
      shapes.push(...mirroredShapes)
    } else {
      // Radial: replicate crescentPaths around center
      const replicatedPaths: typeof crescentPaths = []
      const replicatedShapes: ShapeNode[] = []

      for (let fold = 1; fold < symmetryFolds; fold++) {
        const angle = (2 * Math.PI * fold) / symmetryFolds
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        for (const cp of crescentPaths) {
          replicatedPaths.push({
            pathData: rotatePathData(cp.pathData, angle),
            operation: 'add',
          })
        }

        for (const s of shapes.filter((s) => s.role === 'prototype')) {
          const rx = s.center.x * cos - s.center.y * sin
          const ry = s.center.x * sin + s.center.y * cos
          replicatedShapes.push({
            ...s,
            id: `${s.id}_fold${fold}`,
            role: 'symmetry-instance',
            center: {
              x: Math.round(rx * 1000) / 1000,
              y: Math.round(ry * 1000) / 1000,
            },
            rotation: s.rotation + angle,
          })
        }
      }

      allPaths = [...crescentPaths, ...replicatedPaths]
      shapes.push(...replicatedShapes)
    }

    // Cap total crescents
    if (allPaths.length > MAX_CRESCENTS) {
      allPaths = allPaths.slice(0, MAX_CRESCENTS)
      warnings.push(`Crescent count capped at ${MAX_CRESCENTS}`)
    }

    // Apply global rotation to all paths
    if (globalRotation !== 0) {
      allPaths = allPaths.map((cp) => ({
        pathData: rotatePathData(cp.pathData, globalRotation),
        operation: cp.operation,
      }))

      // Rotate shape centers for construction view
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i]
        const cos = Math.cos(globalRotation)
        const sin = Math.sin(globalRotation)
        const rx = s.center.x * cos - s.center.y * sin
        const ry = s.center.x * sin + s.center.y * cos
        shapes[i] = {
          ...s,
          center: {
            x: Math.round(rx * 1000) / 1000,
            y: Math.round(ry * 1000) / 1000,
          },
          rotation: s.rotation + globalRotation,
        }
      }
    }

    // Union all crescents into final mark
    const boolResult = composeBooleanResult(allPaths)

    // Build construction guide lines
    const guideLines: ConstructionLine[] = []
    const guideRadius = maxRadius * 1.1

    if (arcSymmetry === 'bilateral') {
      // Vertical mirror axis
      guideLines.push({
        x1: 0,
        y1: -guideRadius,
        x2: 0,
        y2: guideRadius,
        kind: 'mirror',
      })
    } else {
      // Radial guide lines
      for (let i = 0; i < symmetryFolds; i++) {
        const angle = (2 * Math.PI * i) / symmetryFolds + globalRotation
        guideLines.push({
          x1: 0,
          y1: 0,
          x2: Math.round(Math.cos(angle) * guideRadius * 100) / 100,
          y2: Math.round(Math.sin(angle) * guideRadius * 100) / 100,
          kind: 'radial',
        })
      }
    }

    return {
      shapes,
      mark: {
        layers: boolResult.layers,
        compoundPathData: boolResult.compoundPathData,
        fillRule: boolResult.fillRule as 'nonzero' | 'evenodd',
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridCircles: Array.from({ length: arcCount }, (_, i) => ({
          cx: 0,
          cy: 0,
          r: Math.round(maxRadius * ((i + 1) / (arcCount + 1)) * 100) / 100,
        })),
        guideLines,
        stats: {
          totalShapes: shapes.length,
          additiveCount: shapes.filter((s) => s.operation === 'add').length,
          subtractiveCount: shapes.filter((s) => s.operation === 'subtract').length,
          symmetryFolds: arcSymmetry === 'bilateral' ? 2 : symmetryFolds,
        },
      },
      warnings: [...warnings, ...boolResult.warnings],
    }
  },
}

/**
 * Mirrors SVG path data across the Y axis (negates all X coordinates).
 * Works on M, L, C, Q, Z commands.
 */
function mirrorPathX(pathData: string): string {
  return pathData.replace(
    /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g,
    (_match, x, y) => `${-parseFloat(x)} ${y}`,
  )
}

/**
 * Rotates SVG path data around the origin by angle (radians).
 * Works on coordinate pairs in M, L, C, Q, Z commands.
 */
function rotatePathData(pathData: string, angle: number): string {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return pathData.replace(
    /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g,
    (_match, xStr, yStr) => {
      const x = parseFloat(xStr)
      const y = parseFloat(yStr)
      const rx = Math.round((x * cos - y * sin) * 1000) / 1000
      const ry = Math.round((x * sin + y * cos) * 1000) / 1000
      return `${rx} ${ry}`
    },
  )
}
```

- [ ] **Step 2: Register the generator**

In `src/engine/generators/registry.ts`, add:

```typescript
import { WaveArcGenerator } from './WaveArcGenerator.ts'

// At the bottom, after existing registrations:
registerGenerator(WaveArcGenerator)
```

- [ ] **Step 3: Add animation keyframes for wave-arc**

In `src/engine/animation/keyframes.ts`, add:

```typescript
export function generateWaveArcKeyframes(
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
      rotation: Math.sin(t * Math.PI * 2) * Math.PI * 0.12 * speed,
      scale: 1 + Math.sin(t * Math.PI * 2) * 0.03 * speed,
      opacity: 1,
    })
  }

  return keyframes
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/engine/generators/WaveArcGenerator.ts src/engine/generators/registry.ts src/engine/animation/keyframes.ts
git commit -m "feat: add wave arc crescent generator"
```

---

## Task 3: Register Wave Arc Mode

Wire the generator into the mode system with defaults, limits, style overrides, and presets.

**Files:**
- Modify: `src/store/modes.ts`
- Modify: `src/store/presets.ts`

- [ ] **Step 1: Add mode definition to `LOGO_MODES` array**

In `src/store/modes.ts`, add after the monogram entry in the `LOGO_MODES` array:

```typescript
{
  id: 'wave-arc',
  name: 'Wave Arc',
  generatorId: 'wave-arc',
  description: 'Concentric crescent marks with bilateral or radial symmetry.',
  sharedControls: ['seed', 'styleFamily', 'fillColor', 'rotation', 'animationSpeed'],
},
```

- [ ] **Step 2: Add default mode params**

In `DEFAULT_MODE_PARAMS`, add:

```typescript
'wave-arc': {
  arcCount: 4,
  spreadAngle: 120,
  gapRatio: 0.3,
  taperAmount: 0.7,
  arcSymmetry: 'bilateral',
  symmetryFolds: 4,
},
```

- [ ] **Step 3: Add param limits**

In `MODE_PARAM_LIMITS`, add:

```typescript
'wave-arc': {
  arcCount: { min: 2, max: 8 },
  spreadAngle: { min: 30, max: 180 },
  gapRatio: { min: 0.1, max: 0.8 },
  taperAmount: { min: 0.2, max: 1 },
  // arcSymmetry is an enum ('bilateral' | 'radial'), not clamped numerically
  symmetryFolds: { min: 2, max: 12 },
},
```

- [ ] **Step 4: Add style family overrides for all 5 families**

In `MODE_STYLE_OVERRIDES`, add a `'wave-arc'` entry under each family:

```typescript
// minimal:
'wave-arc': {
  fillColor: '#161616',
  rotation: 0,
  animationSpeed: 0.6,
  mode: { arcCount: 4, spreadAngle: 120, gapRatio: 0.3, taperAmount: 0.7, arcSymmetry: 'bilateral', symmetryFolds: 4 },
},

// heritage:
'wave-arc': {
  fillColor: '#6f4627',
  rotation: 0,
  animationSpeed: 0.4,
  mode: { arcCount: 5, spreadAngle: 140, gapRatio: 0.22, taperAmount: 0.85, arcSymmetry: 'bilateral', symmetryFolds: 4 },
},

// luxe:
'wave-arc': {
  fillColor: '#171311',
  rotation: 15,
  animationSpeed: 0.3,
  mode: { arcCount: 3, spreadAngle: 100, gapRatio: 0.35, taperAmount: 0.6, arcSymmetry: 'bilateral', symmetryFolds: 5 },
},

// playful:
'wave-arc': {
  fillColor: '#0d87b8',
  rotation: 0,
  animationSpeed: 1.2,
  mode: { arcCount: 5, spreadAngle: 150, gapRatio: 0.2, taperAmount: 0.9, arcSymmetry: 'radial', symmetryFolds: 6 },
},

// tech:
'wave-arc': {
  fillColor: '#0f172a',
  rotation: 0,
  animationSpeed: 0.8,
  mode: { arcCount: 6, spreadAngle: 90, gapRatio: 0.15, taperAmount: 0.5, arcSymmetry: 'radial', symmetryFolds: 8 },
},
```

- [ ] **Step 5: Add 3 presets**

In `src/store/presets.ts`, add:

```typescript
{
  id: 'wave-signal',
  modeId: 'wave-arc',
  name: 'Signal',
  description: 'Bilateral crescents radiating like a broadcast signal.',
  styleFamily: 'minimal',
  params: {
    modeId: 'wave-arc',
    generatorId: 'wave-arc',
    styleFamily: 'minimal',
    seed: 256,
    fillColor: '#161616',
    rotation: 0,
    modeParams: {
      'wave-arc': {
        arcCount: 4,
        spreadAngle: 120,
        gapRatio: 0.3,
        taperAmount: 0.7,
        arcSymmetry: 'bilateral',
        symmetryFolds: 4,
      },
    },
  },
},
{
  id: 'wave-radial-pulse',
  modeId: 'wave-arc',
  name: 'Radial Pulse',
  description: 'Radial crescents fanning out from the center.',
  styleFamily: 'tech',
  params: {
    modeId: 'wave-arc',
    generatorId: 'wave-arc',
    styleFamily: 'tech',
    seed: 733,
    fillColor: '#0f172a',
    rotation: 0,
    modeParams: {
      'wave-arc': {
        arcCount: 3,
        spreadAngle: 160,
        gapRatio: 0.25,
        taperAmount: 0.95,
        arcSymmetry: 'radial',
        symmetryFolds: 6,
      },
    },
  },
},
{
  id: 'wave-ripple',
  modeId: 'wave-arc',
  name: 'Ripple',
  description: 'Dense bilateral waves with blunt, even strokes.',
  styleFamily: 'heritage',
  params: {
    modeId: 'wave-arc',
    generatorId: 'wave-arc',
    styleFamily: 'heritage',
    seed: 488,
    fillColor: '#6f4627',
    rotation: 0,
    modeParams: {
      'wave-arc': {
        arcCount: 7,
        spreadAngle: 90,
        gapRatio: 0.15,
        taperAmount: 0.3,
        arcSymmetry: 'bilateral',
        symmetryFolds: 4,
      },
    },
  },
},
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/store/modes.ts src/store/presets.ts
git commit -m "feat: register wave-arc mode with defaults, limits, and presets"
```

---

## Task 4: Add Wave Arc UI Controls

Add mode-specific controls to the parameter panel for wave-arc.

**Files:**
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] **Step 1: Add wave-arc controls block**

In `ParameterPanel.tsx`, after the monogram controls block (after line 395, before the closing `</PanelSection>`), add:

```tsx
{params.modeId === 'wave-arc' && (
  <>
    <SliderControl
      label="Arc Count"
      value={activeModeParams.arcCount ?? 4}
      min={2}
      max={8}
      step={1}
      onChange={(value) => setModeParam('arcCount', value)}
    />
    <SliderControl
      label="Spread Angle"
      value={activeModeParams.spreadAngle ?? 120}
      min={30}
      max={180}
      step={1}
      onChange={(value) => setModeParam('spreadAngle', value)}
    />
    <SliderControl
      label="Gap Ratio"
      value={activeModeParams.gapRatio ?? 0.3}
      min={0.1}
      max={0.8}
      step={0.01}
      onChange={(value) => setModeParam('gapRatio', value)}
    />
    <SliderControl
      label="Taper Amount"
      value={activeModeParams.taperAmount ?? 0.7}
      min={0.2}
      max={1}
      step={0.01}
      onChange={(value) => setModeParam('taperAmount', value)}
    />
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
        Symmetry
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['bilateral', 'radial'] as const).map((sym) => (
          <button
            key={sym}
            type="button"
            onClick={() => setModeParam('arcSymmetry', sym)}
            className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
              (activeModeParams.arcSymmetry ?? 'bilateral') === sym
                ? 'border-neutral-900 bg-neutral-950 text-white'
                : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300'
            }`}
          >
            {sym}
          </button>
        ))}
      </div>
    </div>
    {(activeModeParams.arcSymmetry ?? 'bilateral') === 'radial' && (
      <SliderControl
        label="Symmetry Folds"
        value={activeModeParams.symmetryFolds ?? 4}
        min={2}
        max={12}
        step={1}
        onChange={(value) => setModeParam('symmetryFolds', value)}
      />
    )}
  </>
)}
```

- [ ] **Step 2: Verify the app renders wave-arc mode in the browser**

Run: `npm run dev`
Expected: Wave Arc appears in the mode selector, switching to it shows crescents, sliders work.

- [ ] **Step 3: Commit**

```bash
git add src/components/controls/ParameterPanel.tsx
git commit -m "feat: add wave-arc mode controls to parameter panel"
```

---

## Task 5: Add Effect Types and Registry

Foundation for the effect pipeline.

**Files:**
- Create: `src/engine/effects/types.ts`
- Create: `src/engine/effects/registry.ts`
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Define effect types**

```typescript
// src/engine/effects/types.ts

export interface DissolutionParams {
  enabled: boolean
  threshold: number       // 0-1 (0 = fully solid, 1 = fully dissolved)
  cellSize: number        // 4-32 px
  shape: 'square' | 'circle'
  scatter: number         // 0-1
  sizeVariation: number   // 0-1
}

export interface DissolutionCell {
  x: number
  y: number
  width: number
  height: number
  distance: number        // 0-1 normalized distance from edge
  revealRank: number      // animation ordering (0 = first to appear)
  shape: 'square' | 'circle'
}

export interface DissolutionResult {
  particlePathData: string
  solidCorePath: string | null
  cells: DissolutionCell[]
  viewBox: { x: number; y: number; width: number; height: number }
}

export const DEFAULT_DISSOLUTION_PARAMS: DissolutionParams = {
  enabled: false,
  threshold: 0.5,
  cellSize: 12,
  shape: 'square',
  scatter: 0,
  sizeVariation: 0.3,
}

export type EffectParamsMap = {
  dissolution: DissolutionParams
}
```

- [ ] **Step 2: Create effect registry**

```typescript
// src/engine/effects/registry.ts
import type { GenerationResult } from '../types.ts'
import type { DissolutionParams, DissolutionResult } from './types.ts'

export interface EffectProcessor<P, R> {
  id: string
  process(result: GenerationResult, params: P): R | null
}

const registry = new Map<string, EffectProcessor<unknown, unknown>>()

export function registerEffect<P, R>(effect: EffectProcessor<P, R>): void {
  registry.set(effect.id, effect as EffectProcessor<unknown, unknown>)
}

export function getEffect(id: string): EffectProcessor<unknown, unknown> | undefined {
  return registry.get(id)
}
```

- [ ] **Step 3: Add `EffectParamsMap` re-export in engine types**

In `src/engine/types.ts`, add at the bottom:

```typescript
export type { EffectParamsMap } from './effects/types.ts'
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/engine/effects/types.ts src/engine/effects/registry.ts src/engine/types.ts
git commit -m "feat: add effect types, dissolution params, and effect registry"
```

---

## Task 6: Implement Dissolution Processor

The core sampling + distance field + particle emission logic.

**Files:**
- Create: `src/engine/effects/dissolution.ts`
- Modify: `src/engine/effects/registry.ts`

- [ ] **Step 1: Create the dissolution processor**

```typescript
// src/engine/effects/dissolution.ts
import paper from 'paper'
import type { GenerationResult } from '../types.ts'
import type { DissolutionParams, DissolutionResult, DissolutionCell } from './types.ts'
import type { EffectProcessor } from './registry.ts'
import { registerEffect } from './registry.ts'
import { SeededPRNG } from '../random.ts'

let dissolveScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!dissolveScope) {
    dissolveScope = new paper.PaperScope()
    dissolveScope.setup(new paper.Size(1, 1))
  }
  dissolveScope.activate()
  return dissolveScope
}

export const DissolutionProcessor: EffectProcessor<DissolutionParams, DissolutionResult> = {
  id: 'dissolution',

  process(result: GenerationResult, params: DissolutionParams): DissolutionResult | null {
    if (!params.enabled || params.threshold === 0) return null
    if (!result.mark.compoundPathData) return null

    const scope = getScope()
    scope.project.clear()

    const vb = result.mark.viewBox
    const cellSize = params.cellSize

    // Create the mark path for hit testing
    let markPath: paper.PathItem
    try {
      markPath = new scope.CompoundPath(result.mark.compoundPathData)
      markPath.fillRule = result.mark.fillRule
    } catch {
      try {
        markPath = new scope.Path(result.mark.compoundPathData)
      } catch {
        return null
      }
    }

    // Sample grid cells
    const cols = Math.ceil(vb.width / cellSize)
    const rows = Math.ceil(vb.height / cellSize)
    const filledCells: Array<{ col: number; row: number; cx: number; cy: number; density: number }> = []

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = vb.x + (col + 0.5) * cellSize
        const cy = vb.y + (row + 0.5) * cellSize

        // Sample center point
        const point = new scope.Point(cx, cy)
        if (markPath.contains(point)) {
          // Estimate density by sampling corners
          let hits = 1
          const offsets = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]
          for (const [dx, dy] of offsets) {
            if (markPath.contains(new scope.Point(cx + dx * cellSize, cy + dy * cellSize))) {
              hits++
            }
          }
          filledCells.push({ col, row, cx, cy, density: hits / 5 })
        }
      }
    }

    markPath.remove()
    scope.project.clear()

    if (filledCells.length === 0) return null

    // Compute distance field (BFS from edge cells)
    const cellMap = new Map<string, number>()
    for (const cell of filledCells) {
      cellMap.set(`${cell.col},${cell.row}`, 0)
    }

    // Find edge cells (adjacent to an empty cell)
    const edgeCells: Array<{ col: number; row: number }> = []
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]

    for (const cell of filledCells) {
      let isEdge = false
      for (const [dc, dr] of dirs) {
        if (!cellMap.has(`${cell.col + dc},${cell.row + dr}`)) {
          isEdge = true
          break
        }
      }
      if (isEdge) {
        edgeCells.push({ col: cell.col, row: cell.row })
        cellMap.set(`${cell.col},${cell.row}`, 0)
      }
    }

    // BFS to compute distances from edges
    const distances = new Map<string, number>()
    const queue = edgeCells.map((c) => ({ ...c, dist: 0 }))
    for (const c of queue) {
      distances.set(`${c.col},${c.row}`, 0)
    }

    let qi = 0
    while (qi < queue.length) {
      const current = queue[qi++]
      for (const [dc, dr] of dirs) {
        const key = `${current.col + dc},${current.row + dr}`
        if (cellMap.has(key) && !distances.has(key)) {
          const dist = current.dist + 1
          distances.set(key, dist)
          queue.push({ col: current.col + dc, row: current.row + dr, dist })
        }
      }
    }

    // Normalize distances
    let maxDist = 0
    for (const d of distances.values()) {
      if (d > maxDist) maxDist = d
    }
    if (maxDist === 0) maxDist = 1

    // Build cells with distance and determine which dissolve
    const rng = new SeededPRNG(42) // Fixed seed for scatter determinism
    const dissolutionCells: DissolutionCell[] = []
    const solidParts: string[] = []
    const particleParts: string[] = []
    let revealRank = 0

    // Sort cells by distance (edge first) for reveal ordering
    const sortedCells = filledCells
      .map((cell) => ({
        ...cell,
        normalizedDist: (distances.get(`${cell.col},${cell.row}`) ?? 0) / maxDist,
      }))
      .sort((a, b) => a.normalizedDist - b.normalizedDist)

    for (const cell of sortedCells) {
      const dissolves = cell.normalizedDist < params.threshold

      if (dissolves) {
        // Emit particle
        const sizeScale = 1 - params.sizeVariation * (1 - cell.density)
        const particleSize = cellSize * 0.85 * sizeScale

        let px = cell.cx
        let py = cell.cy
        if (params.scatter > 0) {
          px += (rng.nextFloat(-1, 1) * params.scatter * cellSize * 0.4)
          py += (rng.nextFloat(-1, 1) * params.scatter * cellSize * 0.4)
        }

        const halfSize = particleSize / 2

        if (params.shape === 'circle') {
          const r = halfSize
          particleParts.push(
            `M ${round(px - r)} ${round(py)} ` +
            `A ${round(r)} ${round(r)} 0 1 0 ${round(px + r)} ${round(py)} ` +
            `A ${round(r)} ${round(r)} 0 1 0 ${round(px - r)} ${round(py)} Z`,
          )
        } else {
          particleParts.push(
            `M ${round(px - halfSize)} ${round(py - halfSize)} ` +
            `L ${round(px + halfSize)} ${round(py - halfSize)} ` +
            `L ${round(px + halfSize)} ${round(py + halfSize)} ` +
            `L ${round(px - halfSize)} ${round(py + halfSize)} Z`,
          )
        }

        dissolutionCells.push({
          x: px,
          y: py,
          width: particleSize,
          height: particleSize,
          distance: cell.normalizedDist,
          revealRank: revealRank++,
          shape: params.shape,
        })
      }
    }

    // Build solid core path (cells above threshold)
    // We use the original mark minus a boolean subtract of dissolved cells
    // Simpler approach: if threshold < 1, keep the original path as solid core
    // and let the renderer composite them
    const solidCorePath = params.threshold < 1
      ? result.mark.compoundPathData
      : null

    return {
      particlePathData: particleParts.join(' '),
      solidCorePath,
      cells: dissolutionCells,
      viewBox: { ...vb },
    }
  },
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

registerEffect(DissolutionProcessor)
```

- [ ] **Step 2: Import dissolution in the registry to trigger auto-registration**

In `src/engine/effects/registry.ts`, add at the bottom:

```typescript
// Auto-register built-in effects
import './dissolution.ts'
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/engine/effects/dissolution.ts src/engine/effects/registry.ts
git commit -m "feat: implement dissolution processor with distance field and particle emission"
```

---

## Task 7: Add Effect Params to Store

Wire effect state into the Zustand store.

**Files:**
- Modify: `src/store/logoStore.ts`
- Modify: `src/store/historyMiddleware.ts`

- [ ] **Step 1: Add effectParams to the store**

In `src/store/logoStore.ts`, update the imports:

```typescript
import type { DissolutionParams, EffectParamsMap } from '../engine/effects/types.ts'
import { DEFAULT_DISSOLUTION_PARAMS } from '../engine/effects/types.ts'
```

Add to the `LogoStore` interface:

```typescript
effectParams: EffectParamsMap
setEffectParam: <K extends keyof DissolutionParams>(key: K, value: DissolutionParams[K]) => void
toggleDissolution: () => void
```

Add to the store initial state (inside the `temporal` call):

```typescript
effectParams: {
  dissolution: { ...DEFAULT_DISSOLUTION_PARAMS },
},
```

Add the mutation methods:

```typescript
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
```

- [ ] **Step 2: Include effectParams in history tracking**

In `src/store/historyMiddleware.ts`, update `stableParamsString` to accept and serialize effectParams. First update the `paramsEqual` function:

```typescript
export function paramsEqual(
  pastState: { params: LogoParams; effectParams?: Record<string, unknown> },
  currentState: { params: LogoParams; effectParams?: Record<string, unknown> },
): boolean {
  return (
    stableParamsString(pastState.params) === stableParamsString(currentState.params) &&
    JSON.stringify(pastState.effectParams) === JSON.stringify(currentState.effectParams)
  )
}
```

Then update `partialize` in the temporal config in `logoStore.ts`:

```typescript
partialize: (state) => ({ params: state.params, effectParams: state.effectParams }),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/store/logoStore.ts src/store/historyMiddleware.ts
git commit -m "feat: add effectParams to store with undo/redo tracking"
```

---

## Task 8: Integrate Dissolution into Renderer

Make the renderer display particles when dissolution is active.

**Files:**
- Modify: `src/renderer/PaperRenderer.ts`
- Modify: `src/renderer/FinalView.ts`
- Modify: `src/components/canvas/LogoCanvas.tsx`

- [ ] **Step 1: Add dissolution rendering to FinalView.ts**

In `src/renderer/FinalView.ts`, add:

```typescript
import type { DissolutionResult } from '../engine/effects/types.ts'

export function renderDissolution(
  scope: paper.PaperScope,
  dissolution: DissolutionResult,
  center: paper.Point,
  fillColor: string,
): void {
  scope.activate()

  // Render solid core if present
  if (dissolution.solidCorePath) {
    try {
      const corePath = new scope.CompoundPath(dissolution.solidCorePath)
      corePath.translate(center)
      corePath.fillColor = new scope.Color(fillColor)
      corePath.fillRule = 'evenodd'
      corePath.strokeColor = null
    } catch {
      // Ignore invalid core path
    }
  }

  // Render particles
  if (dissolution.particlePathData) {
    try {
      const particles = new scope.CompoundPath(dissolution.particlePathData)
      particles.translate(center)
      particles.fillColor = new scope.Color(fillColor)
      particles.strokeColor = null
    } catch {
      // Ignore invalid particle path
    }
  }
}
```

- [ ] **Step 2: Update PaperRenderer to accept dissolution**

In `src/renderer/PaperRenderer.ts`, update the interface and functions:

```typescript
import type { DissolutionResult } from '../engine/effects/types.ts'
import { renderDissolution } from './FinalView.ts'

interface RenderOptions {
  showGrid: boolean
  showConstruction: boolean
  fillColor: string
  dissolution?: DissolutionResult | null
}

export function renderLogoOnScope(
  scope: paper.PaperScope,
  result: GenerationResult,
  options: RenderOptions,
): void {
  scope.activate()
  scope.project.clear()

  const canvasSize = scope.view.size
  const center = new scope.Point(canvasSize.width / 2, canvasSize.height / 2)

  // Draw construction view first (behind the mark) — always raw generator output
  if (options.showConstruction) {
    renderConstruction(scope, result, center, options.showGrid)
  }

  // Draw the composed mark — use dissolution if active
  if (options.dissolution) {
    renderDissolution(scope, options.dissolution, center, options.fillColor)
  } else {
    renderFinalMark(scope, result, center, options.fillColor)
  }

  scope.view.update()
}
```

- [ ] **Step 3: Compute and pass dissolution in LogoCanvas**

In `src/components/canvas/LogoCanvas.tsx`, import and compute dissolution:

```typescript
import { useLogoStore } from '../../store/logoStore.ts'
import { DissolutionProcessor } from '../../engine/effects/dissolution.ts'
import { useMemo } from 'react'

// Inside the component, after getting result:
const effectParams = useLogoStore((s) => s.effectParams)

const dissolution = useMemo(() => {
  if (!result || !effectParams.dissolution.enabled) return null
  return DissolutionProcessor.process(result, effectParams.dissolution)
}, [result, effectParams.dissolution])

// Pass to renderLogoOnScope:
renderLogoOnScope(scope, result, {
  showGrid: ui.showGrid,
  showConstruction: ui.showConstruction,
  fillColor: params.fillColor,
  dissolution,
})
```

- [ ] **Step 4: Verify the app renders dissolution in the browser**

Run: `npm run dev`
Expected: Enabling dissolution in the store (via dev tools) shows particles on the canvas.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/FinalView.ts src/renderer/PaperRenderer.ts src/components/canvas/LogoCanvas.tsx
git commit -m "feat: integrate dissolution rendering into canvas pipeline"
```

---

## Task 9: Add Effect Controls UI

The dissolution control panel section.

**Files:**
- Create: `src/components/controls/EffectControls.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] **Step 1: Create EffectControls component**

```tsx
// src/components/controls/EffectControls.tsx
import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'

export function EffectControls() {
  const dissolution = useLogoStore((s) => s.effectParams.dissolution)
  const toggleDissolution = useLogoStore((s) => s.toggleDissolution)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={toggleDissolution}
        className={`rounded-[20px] border px-3 py-3 text-left transition ${
          dissolution.enabled
            ? 'border-neutral-900 bg-neutral-950 text-white'
            : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Pixel Dissolution</span>
          <span
            className={`h-5 w-9 rounded-full border ${
              dissolution.enabled
                ? 'border-white/25 bg-white/10'
                : 'border-neutral-300 bg-white'
            }`}
          >
            <span
              className={`mt-[1px] block h-4 w-4 rounded-full transition ${
                dissolution.enabled
                  ? 'translate-x-[18px] bg-white'
                  : 'translate-x-[1px] bg-neutral-400'
              }`}
            />
          </span>
        </div>
        <div
          className={`mt-2 text-xs leading-5 ${
            dissolution.enabled ? 'text-white/70' : 'text-neutral-500'
          }`}
        >
          Decompose the mark into a field of particles with controllable erosion
          depth.
        </div>
      </button>

      {dissolution.enabled && (
        <>
          <SliderControl
            label="Threshold"
            value={dissolution.threshold}
            min={0.01}
            max={1}
            step={0.01}
            onChange={(value) => setEffectParam('threshold', value)}
          />
          <SliderControl
            label="Cell Size"
            value={dissolution.cellSize}
            min={4}
            max={32}
            step={1}
            onChange={(value) => setEffectParam('cellSize', value)}
          />
          <div className="flex flex-col gap-2">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
              Particle Shape
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['square', 'circle'] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setEffectParam('shape', shape)}
                  className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    dissolution.shape === shape
                      ? 'border-neutral-900 bg-neutral-950 text-white'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300'
                  }`}
                >
                  {shape}
                </button>
              ))}
            </div>
          </div>
          <SliderControl
            label="Scatter"
            value={dissolution.scatter}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setEffectParam('scatter', value)}
          />
          <SliderControl
            label="Size Variation"
            value={dissolution.sizeVariation}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setEffectParam('sizeVariation', value)}
          />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add EffectControls to ParameterPanel**

In `src/components/controls/ParameterPanel.tsx`, import and add the section:

```typescript
import { EffectControls } from './EffectControls.tsx'
```

After the "Construction" `PanelSection` and before `<PresetSelector />`, add:

```tsx
<PanelSection
  eyebrow="Effects"
  title="Post-processing"
  description="Effects apply to any mode's output without changing the underlying generation."
>
  <EffectControls />
</PanelSection>
```

- [ ] **Step 3: Verify dissolution controls work in the browser**

Run: `npm run dev`
Expected: Effects section appears in the panel. Toggling dissolution on shows particles. Sliders change particle appearance in real-time.

- [ ] **Step 4: Commit**

```bash
git add src/components/controls/EffectControls.tsx src/components/controls/ParameterPanel.tsx
git commit -m "feat: add dissolution effect controls to parameter panel"
```

---

## Task 10: Integrate Dissolution into Export

Export the dissolved mark when dissolution is active.

**Files:**
- Modify: `src/hooks/useExport.ts`
- Modify: `src/components/export/ExportDialog.tsx`

- [ ] **Step 1: Update useExport to accept dissolution**

In `src/hooks/useExport.ts`, update the hook:

```typescript
import type { DissolutionResult } from '../engine/effects/types.ts'

export function useExport(dissolution?: DissolutionResult | null) {
  const result = useLogoStore((s) => s.result)
  const params = useLogoStore((s) => s.params)
  const generator = getGenerator(params.generatorId)
  const filenameBase = `logo-${params.seed}-${params.modeId}-${generator?.version ?? 'v0'}`

  function getExportPaths(): { pathData: string; fillRule: 'nonzero' | 'evenodd' } | null {
    if (!result || !result.mark.compoundPathData) return null

    if (dissolution) {
      // Combine active layers
      const parts: string[] = []
      if (dissolution.solidCorePath) parts.push(dissolution.solidCorePath)
      if (dissolution.particlePathData) parts.push(dissolution.particlePathData)
      if (parts.length === 0) return null
      return { pathData: parts.join(' '), fillRule: 'evenodd' }
    }

    return {
      pathData: result.mark.compoundPathData,
      fillRule: result.mark.fillRule,
    }
  }

  function exportSVG(options: ExportOptions = {}) {
    const paths = getExportPaths()
    if (!paths || !result) return
    const svg = generateSVGString(
      paths.pathData,
      paths.fillRule,
      result.mark.viewBox,
      params.fillColor,
      options,
    )
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    downloadBlob(blob, `${filenameBase}.svg`)
  }

  function exportPNG(scale = 2, options: ExportOptions = {}) {
    const paths = getExportPaths()
    if (!paths || !result) return

    const normalizedViewBox = normalizeViewBox(
      result.mark.viewBox,
      options.artboardMode ?? 'tight',
      options.paddingMode ?? 'compact',
    )
    const svg = generateSVGString(
      paths.pathData,
      paths.fillRule,
      result.mark.viewBox,
      params.fillColor,
      options,
    )

    const img = new Image()
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const { width, height } = getPngCanvasSize(normalizedViewBox, scale)
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)

      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${filenameBase}.png`)
      }, 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      console.error('PNG export failed: could not render SVG to image')
    }

    img.src = url
  }

  return {
    exportSVG,
    exportPNG,
    canExport: !!getExportPaths(),
    hasDissolution: !!dissolution,
  }
}
```

- [ ] **Step 2: Show dissolution indicator in ExportDialog**

In `src/components/export/ExportDialog.tsx`, show a small badge when dissolution is active:

```tsx
// After the existing preview or format section, add:
{hasDissolution && (
  <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
    <span className="font-medium">Dissolution applied</span>
    <span className="text-amber-500">Export includes the dissolved effect.</span>
  </div>
)}
```

Update the hook call in ExportDialog to pass `hasDissolution`:

```tsx
const { exportSVG, exportPNG, canExport, hasDissolution } = useExport(dissolution)
```

Where `dissolution` comes from the parent component via props or from the store computation.

- [ ] **Step 3: Verify export works with dissolution**

Run: `npm run dev`
Expected: Export with dissolution enabled produces an SVG with particle paths. The dialog shows "Dissolution applied".

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useExport.ts src/components/export/ExportDialog.tsx
git commit -m "feat: integrate dissolution into SVG and PNG export pipeline"
```

---

## Task 11: Add Effect Params to URL State

Persist effect params in the URL for shareable links.

**Files:**
- Modify: `src/hooks/useUrlState.ts`

- [ ] **Step 1: Encode effect params in URL**

In `src/hooks/useUrlState.ts`, add effect param encoding to `encodeParams`:

```typescript
import { DEFAULT_DISSOLUTION_PARAMS } from '../engine/effects/types.ts'
import type { EffectParamsMap } from '../engine/effects/types.ts'
```

Update the store selectors to also read `effectParams`:

```typescript
const effectParams = useLogoStore((s) => s.effectParams)
```

In `encodeParams`, accept effectParams and add after the mode params encoding:

```typescript
// Encode effect params (e. prefix)
if (effectParams.dissolution.enabled) {
  searchParams.set('e.dissolve', '1')
  const dp = effectParams.dissolution
  const dd = DEFAULT_DISSOLUTION_PARAMS
  if (dp.threshold !== dd.threshold) searchParams.set('e.threshold', String(dp.threshold))
  if (dp.cellSize !== dd.cellSize) searchParams.set('e.cellSize', String(dp.cellSize))
  if (dp.shape !== dd.shape) searchParams.set('e.shape', dp.shape)
  if (dp.scatter !== dd.scatter) searchParams.set('e.scatter', String(dp.scatter))
  if (dp.sizeVariation !== dd.sizeVariation) searchParams.set('e.sizeVariation', String(dp.sizeVariation))
}
```

- [ ] **Step 2: Decode effect params from URL**

In `decodeParamsInner`, add effect param decoding after the mode params section:

```typescript
// Decode effect params
const effectUpdates: Partial<EffectParamsMap['dissolution']> = {}
const dissolveEnabled = searchParams.get('e.dissolve') === '1'

if (dissolveEnabled) {
  effectUpdates.enabled = true

  const threshold = Number(searchParams.get('e.threshold'))
  if (Number.isFinite(threshold)) effectUpdates.threshold = clampNumber(threshold, 0, 1)

  const cellSize = Number(searchParams.get('e.cellSize'))
  if (Number.isFinite(cellSize)) effectUpdates.cellSize = clampNumber(cellSize, 4, 32)

  const shape = searchParams.get('e.shape')
  if (shape === 'square' || shape === 'circle') effectUpdates.shape = shape

  const scatter = Number(searchParams.get('e.scatter'))
  if (Number.isFinite(scatter)) effectUpdates.scatter = clampNumber(scatter, 0, 1)

  const sizeVariation = Number(searchParams.get('e.sizeVariation'))
  if (Number.isFinite(sizeVariation)) effectUpdates.sizeVariation = clampNumber(sizeVariation, 0, 1)
}
```

Return the effect updates alongside the logo params so the caller can apply them.

- [ ] **Step 3: Apply effect params on URL restore**

In the `useUrlState` hook's initial effect, apply the decoded effect params:

```typescript
if (decoded.effectParams) {
  for (const [key, value] of Object.entries(decoded.effectParams)) {
    setEffectParam(key as keyof DissolutionParams, value)
  }
}
```

- [ ] **Step 4: Fix mode param decoder to handle string enum values**

The existing `decodeParamsInner` in `useUrlState.ts` parses all `m.` prefixed values as `Number(value)` and skips non-finite results. This drops string params like `m.arcSymmetry=bilateral`. Update the mode param decoding block to preserve string values when the numeric parse fails:

```typescript
if (key.startsWith('m.')) {
  const paramKey = key.slice(2)
  const parsed = Number(value)
  if (Number.isFinite(parsed)) {
    rawModeParams[paramKey] = parsed
  } else if (value) {
    // String enum param (e.g., arcSymmetry: 'bilateral' | 'radial')
    rawModeStringParams[paramKey] = value
  }
  continue
}
```

Also update `rawModeParams` type to `Record<string, number>` (unchanged) and add a new `rawModeStringParams: Record<string, string> = {}`. Merge both into the sanitized mode params at the end:

```typescript
const sanitizedModeParams: Record<string, number | string> = { ...modeDefaults }
// Apply numeric params with clamping
for (const [key, value] of Object.entries(rawModeParams)) { ... }
// Apply string params without clamping
for (const [key, value] of Object.entries(rawModeStringParams)) {
  if (key in modeDefaults) sanitizedModeParams[key] = value
}
```

- [ ] **Step 5: Sync effect params to URL on change**

In the URL encoding effect, include `effectParams` in the dependency array and pass it to `encodeParams`.

- [ ] **Step 6: Verify shared URLs preserve dissolution state**

Run: `npm run dev`
Expected: Enable dissolution, copy URL, paste in new tab → same dissolved logo appears. Wave-arc shared URLs with `m.arcSymmetry=bilateral` or `m.arcSymmetry=radial` restore correctly.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useUrlState.ts
git commit -m "feat: persist dissolution effect params in URL state"
```

---

## Verification Checklist

- [ ] `npm run dev` starts cleanly.
- [ ] `npx tsc --noEmit` passes.
- [ ] Wave Arc mode appears in the mode selector with 5 correct entries.
- [ ] Switching to Wave Arc shows bilateral crescent marks.
- [ ] Arc Count, Spread Angle, Gap Ratio, and Taper Amount sliders change the mark.
- [ ] Switching to Radial symmetry replicates crescents around center.
- [ ] Symmetry Folds slider only appears in radial mode.
- [ ] All 5 style families produce distinct wave-arc looks.
- [ ] 3 wave-arc presets appear and render correctly.
- [ ] Construction view shows ellipse outlines and guide lines.
- [ ] Dissolution toggle shows/hides particle controls.
- [ ] Dissolution works on all 5 modes (geometric-radial, modular, grid-system, monogram, wave-arc).
- [ ] Threshold slider erodes from edges inward.
- [ ] Cell size changes particle granularity.
- [ ] Square/circle toggle changes particle shape.
- [ ] Scatter displaces particles from grid centers.
- [ ] Exported SVG includes dissolved paths when dissolution is active.
- [ ] Exported PNG matches the canvas.
- [ ] "Dissolution applied" badge appears in export dialog when active.
- [ ] Undo/redo tracks both effect param changes and generator param changes.
- [ ] Shared URLs reproduce the exact dissolved state.
- [ ] Changing the seed changes the wave-arc mark.
- [ ] Same seed + params reproduces the same wave-arc mark.

---

## Suggested Commit Order

1. `feat: add ellipse primitive for crescent construction`
2. `feat: add wave arc crescent generator`
3. `feat: register wave-arc mode with defaults, limits, and presets`
4. `feat: add wave-arc mode controls to parameter panel`
5. `feat: add effect types, dissolution params, and effect registry`
6. `feat: implement dissolution processor with distance field and particle emission`
7. `feat: add effectParams to store with undo/redo tracking`
8. `feat: integrate dissolution rendering into canvas pipeline`
9. `feat: add dissolution effect controls to parameter panel`
10. `feat: integrate dissolution into SVG and PNG export pipeline`
11. `feat: persist dissolution effect params in URL state`
