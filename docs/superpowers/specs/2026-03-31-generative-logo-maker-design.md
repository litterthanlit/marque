# Generative Logo Maker — Design Spec

## Overview

A browser-based generative logo system where users tweak parameters (seed, symmetry, grid rings, shape ratios) and the engine produces geometric logos through boolean operations on shape primitives. Inspired by parametric design tools, each seed produces a unique, reproducible logo for a given `generatorId + generatorVersion + params` tuple.

**Audience:** Both beginners (presets, randomize, simple sliders) and designers (full parameter control, construction view, precise parameter tuning).

**v1 interaction model:** Parameter-driven generation, not freeform vector editing. Users can tune, randomize, compare, and export marks, but direct point/anchor editing is out of scope for v1.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Build | Vite + SWC | Fast HMR, minimal config |
| UI | React 19 + TypeScript | Component model for controls, type safety for geometry |
| Geometry/Rendering | Paper.js | Built-in boolean ops (unite, subtract, intersect, exclude), SVG export, Bezier math |
| State | Zustand | Lightweight, undo/redo via temporal middleware |
| RNG | seedrandom | Deterministic PRNG for reproducible logos |
| Styling | Tailwind CSS v4 | Rapid custom UI |
| UI Primitives | Radix UI | Accessible sliders, toggles, dropdowns |

## Architecture

### Directory Structure

```
src/
  main.tsx
  App.tsx

  engine/                          # Pure logic, framework-agnostic
    types.ts                       # LogoParams, ShapeNode, GenerationResult
    Engine.ts                      # Main orchestrator
    random.ts                      # Seeded PRNG wrapper
    grid/
      ConcentricGrid.ts            # Concentric ring placement
      ModularGrid.ts               # Tile/repeat placement
    primitives/
      index.ts                     # Shape factory
      circle.ts
      rectangle.ts
      triangle.ts
      polygon.ts
      blob.ts                      # Organic shapes: radial points with Perlin-noise displacement, smoothed into closed Bezier curves
    boolean/
      operations.ts                # Geometry backend abstraction; Paper.js adapter behind a serializable engine API
    symmetry/
      radial.ts                    # N-fold radial symmetry
    generators/
      types.ts                     # Generator plugin interface
      GeometricRadialGenerator.ts  # Primary: concentric grid + radial symmetry
      ModularGenerator.ts          # Secondary: tile/repeat patterns
      registry.ts                  # Pluggable generator registry
    pipeline/
      GenerationPipeline.ts        # params -> grid -> shapes -> booleans -> output

  store/
    logoStore.ts                   # Zustand: params, generation state, UI state
    historyMiddleware.ts           # Undo/redo
    presets.ts                     # Built-in parameter presets

  renderer/
    PaperRenderer.ts               # Paper.js rendering bridge
    ConstructionView.ts            # Grid lines, guides, construction overlay
    FinalView.ts                   # Clean final logo rendering
    usePaperScope.ts               # React hook for Paper.js lifecycle

  components/
    layout/
      AppShell.tsx                 # Main layout grid
      Toolbar.tsx                  # Top bar: seed display, mode toggle, export
    canvas/
      LogoCanvas.tsx               # Main canvas (hosts Paper.js)
      CanvasControls.tsx           # Zoom, pan, view mode toggle
    controls/
      ParameterPanel.tsx           # Right-side slider panel
      SliderControl.tsx            # Labeled slider with value display
      SeedInput.tsx                # Seed input + randomize button
      ColorPicker.tsx              # Fill color picker
      PresetSelector.tsx           # Preset gallery/dropdown
      GeneratorSelector.tsx        # Choose generation algorithm
    preview/
      FinalPreview.tsx             # Small clean logo preview
      ConstructionData.tsx         # Stats: shape counts, symmetry info
    export/
      ExportDialog.tsx             # Format selection + download

  hooks/
    useGeneration.ts               # Orchestrates generation on param change
    useAnimation.ts                # Animation loop management
    useExport.ts                   # Export functionality

  utils/
    math.ts                        # Geometry helpers
    color.ts                       # Color manipulation
```

### Data Flow

```
User adjusts slider
  -> Zustand store updates params
    -> useGeneration hook (debounced ~50-100ms)
      -> Engine.generate(params)
        -> Seed PRNG initialized
        -> Generator selected (Geometric/Modular)
        -> Grid places shape positions
        -> Primitives created at positions
        -> N-fold symmetry applied
        -> Boolean ops composed (Paper.js headless)
        -> Returns GenerationResult
      -> PaperRenderer receives result
        -> Construction canvas: grid + guides + shapes + composed result
        -> Final preview canvas: clean composed path only
```

### Architectural Decisions

- The engine owns deterministic generation and returns plain data only. It must not leak Paper.js runtime objects into React state.
- The renderer owns display concerns only. It can use Paper.js imperatively, but it consumes serializable output from the engine.
- Persisted state includes canonical generation inputs only: `generatorId`, `generatorVersion`, and sanitized `LogoParams`.
- Transient UI state such as panel open/closed, zoom/pan, preview mode, hover state, and construction overlay visibility is not included in undo history or shared URLs.
- Undo/redo snapshots are taken on committed parameter changes, not every pointer-move tick.
- The geometry backend must remain swappable so generation can move to a Web Worker without changing the public engine contract.

### Core Types

```typescript
interface LogoParams {
  seed: number;
  gridRings: number;              // 1-8
  additiveRatio: number;          // 0-1
  baseRadius: number;             // 0.1-1.0
  radiusVariation: number;        // 0-2
  rotation: number;               // 0-360
  symmetryFolds: number;          // 1-12
  fillColor: string;              // hex
  animationSpeed: number;         // 0 = static
  generatorId: string;
  extra: Record<string, number>;  // generator-specific params
}

interface PersistedLogoState {
  generatorVersion: string;
  params: LogoParams;
}

interface ShapeNode {
  id: string;
  type: 'circle' | 'rectangle' | 'triangle' | 'polygon' | 'blob';
  role: 'prototype' | 'symmetry-instance';
  operation: 'add' | 'subtract';
  center: { x: number; y: number };
  radius: number;
  rotation: number;
  params: Record<string, number>;
}

interface CompositeLayer {
  id: string;
  operation: 'add' | 'subtract';
  pathData: string;               // Serialized SVG path data for this boolean layer
  fillRule: 'nonzero' | 'evenodd';
}

interface GenerationResult {
  shapes: ShapeNode[];
  mark: {
    layers: CompositeLayer[];
    compoundPathData: string;     // Final composed mark, may contain multiple contours/holes
    fillRule: 'nonzero' | 'evenodd';
    viewBox: { x: number; y: number; width: number; height: number };
  };
  constructionData: {
    gridLines: { cx: number; cy: number; r: number }[];
    stats: {
      totalShapes: number;
      additiveCount: number;
      subtractiveCount: number;
      symmetryFolds: number;
    };
  };
  warnings: string[];
}
```

### Generator Plugin Interface

```typescript
interface LogoGenerator {
  id: string;
  name: string;
  description: string;
  version: string;                // Bump when generation semantics or defaults change
  extraParams: ParamDefinition[];
  generate(params: LogoParams, rng: SeededRandom): GenerationResult;
  getAnimationKeyframes?(params: LogoParams, rng: SeededRandom): AnimationKeyframe[];
}
```

New generators are registered via a simple registry — adding a generation style requires no changes to existing code.

### Determinism Contract

- A logo must be reproducible for the same `generatorId`, `generatorVersion`, and canonicalized params.
- All randomness flows through a seeded RNG wrapper. No use of `Math.random()` is allowed in generators, helpers, or animation keyframe generation.
- Organic primitives such as `blob` must use deterministic seeded noise derived from the same RNG stream; noise implementation and smoothing defaults are versioned with the generator.
- Shared URLs persist canonical params and `generatorVersion`, so future generator changes do not silently alter previously shared logos.
- Numeric outputs should be rounded to a stable precision before persistence/export to reduce drift across browsers and threads.

## Generation Algorithms

### GeometricRadialGenerator (Primary)

Replicates and extends the reference "Generative Logo System":

1. Initialize PRNG from seed
2. Create concentric grid: `gridRings` circles of increasing radius
3. For each ring, generate 1-N prototype shapes inside a single symmetry wedge
4. For each prototype shape:
   - PRNG picks shape primitive type (circle, rect, triangle, polygon, blob)
   - PRNG + `additiveRatio` decides additive or subtractive
   - Shape radius = `baseRadius` + ring-dependent variation
   - PRNG picks the prototype's angular offset within the wedge
5. Apply N-fold symmetry by rotating the prototype set around the center `symmetryFolds` times
6. Boolean composition: unite all additive shapes, subtract all subtractive shapes
7. Apply global rotation offset

This avoids double-applying symmetry. The canonical mental model is "design one wedge, then replicate it."

### ModularGenerator (Secondary)

Tile/repeat-based logo marks:

1. Generate a single tile unit using primitives + boolean ops
2. Repeat tile in a grid or radial pattern
3. Optional circular clipping mask to form a contained mark

## UI Layout

```
+---------------------------------------------------+----------------+
| TOOLBAR: Logo System | Seed #226           [Export]|                |
+---------------------------------------------------+                |
|                                                    | PARAMETER      |
|              MAIN CANVAS                           | PANEL          |
|          (Construction View)                       |                |
|                                                    | Generator [v]  |
|    Grid lines, guides, individual shapes,          | Seed [  ][Rnd] |
|    composed result overlaid                        | Grid Rings --| |
|                                                    | Additive ---| |
|                                                    | Base Rad ---| |
|                                                    | Rad Var ----| |
|  +------------------+  +---------------+           | Rotation ---| |
|  | CONSTRUCTION     |  | FINAL PREVIEW |           | Symmetry ---| |
|  | DATA             |  | (clean logo)  |           | Anim Spd ---| |
|  | Seed: 226        |  |               |           | Color [*]    |
|  | Folds: 7         |  |               |           |              |
|  | Add: 43 Sub: 26  |  |               |           | [x] Grid     |
|  +------------------+  +---------------+           | [x] Constr.  |
+---------------------------------------------------+ PRESETS       |
                                                     | [Gallery]     |
                                                     +----------------+
```

**Beginner flow:** Pick preset -> Randomize seed -> Tweak color -> Export
**Designer flow:** Full parameter control, construction view, generator switching

## Export

| Format | Method | Phase |
|--------|--------|-------|
| SVG | Serialize `GenerationResult.mark` into SVG using stored `viewBox`, fill rule, and path data | v1 |
| PNG | Canvas `toBlob()` | v1 |
| Animated SVG | SMIL/CSS animations | v2 |
| Lottie | svg-to-lottie conversion | v2 |
| GIF/MP4 | MediaRecorder API | v2 |

**Export contract:** Export must use the same composed geometry contract as rendering. SVG export cannot depend on scraping the live canvas DOM.

## Build Phases

### Phase 1: Foundation
Scaffold project, build engine core (seeded PRNG, concentric grid, circle + rectangle primitives, boolean ops, GeometricRadialGenerator), define serializable `GenerationResult`, Paper.js canvas integration, minimal parameter panel with seed + 3-4 sliders.

**Milestone:** Adjust seed slider, see a different geometric logo generate in real-time.

### Phase 2: Full Parameter Control
All sliders, color picker, construction view renderer, final preview canvas, construction data display, remaining primitives (triangle, polygon, blob), show grid/construction toggles.

**Milestone:** Feature parity with the reference image.

### Phase 3: Export and Presets
SVG + PNG export, export dialog, 8-12 built-in presets, preset selector UI, undo/redo, URL-based state persistence for sharing.

**Milestone:** Create, preset-browse, and export logos.

### Phase 4: Animation
Animator class with requestAnimationFrame, animation keyframes (rotation, scale, morph), play/pause controls, animated SVG export.

**Milestone:** Logos animate, exportable as animated SVG.

### Phase 5: Modular Generator and Polish
ModularGrid + ModularGenerator, generator switching UI, responsive design, keyboard shortcuts, performance optimization (Web Worker), accessibility.

**Milestone:** Polished two-generator app.

## Persistence and History Rules

- Shared URLs persist only canonical generation state: `generatorId`, `generatorVersion`, base params, and generator-specific `extra` params.
- Presets are curated parameter snapshots plus metadata (`name`, `description`, optional locked params), not stored geometry.
- Undo/redo tracks committed param changes and preset applications. It does not track zoom/pan, panel toggles, hover, or export dialogs.
- Importing state from a URL runs validation and clamps out-of-range values before generation.
- When a param no longer exists for a generator version, the loader drops it rather than failing hard.

## Technical Risks

| Risk | Mitigation |
|------|-----------|
| Paper.js boolean op failures on edge cases | Pre-validate shapes, try/catch with overlay fallback, epsilon offsets |
| Performance with complex logos (many shapes x folds) | Debounce sliders, Web Worker for generation, cap max complexity |
| Paper.js + React lifecycle conflicts | Imperative bridge pattern, stable canvas key, cleanup on unmount |
| Seed reproducibility across versions | Version generators (v1, v2), encode version in shared URLs |
| Worker migration blocked by engine/renderer coupling | Keep engine output serializable and geometry-backend-neutral from Phase 1 |
| Mobile slider UX | Radix UI touch support, bottom sheet panel, simple mode |

## Verification

1. Run `npm run dev` and open the app
2. Adjust the seed slider — a new logo should generate each time
3. Toggle construction view — grid lines and individual shapes should appear/disappear
4. Adjust each parameter slider — logo should update in real-time
5. Switch generators — different generation style should produce a different logo structure
6. Export SVG — open in Figma/browser, verify it matches the canvas
7. Export PNG — verify resolution and quality
8. Test presets — each preset should produce a distinct, visually appealing logo
9. Randomize rapidly — no crashes or rendering artifacts
10. Check undo/redo — parameter changes should be reversible
11. Reload a shared URL — the same logo should reproduce for the same `generatorVersion`
12. Re-run the same params in rapid succession — exported SVG path data should remain stable
