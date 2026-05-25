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


## Vector Maker — Logo/Brand Vector Editor Spec

**Date:** 2026-05-25
**Status:** Draft
**Depends on:** `2026-03-31-generative-logo-maker-design.md` and `2026-04-01-wave-arc-and-dissolution-design.md`
**Product surface name:** `Vector Maker`
**Scope:** Second major product mode. The existing generative logo maker remains the first mode and feeds Vector Maker by converting generated marks into editable logo/brand-vector documents.
**Concrete v1 build spec:** `2026-05-25-vector-maker-v1-design.md`

### Product Direction

Vector Maker is a focused logo/brand-vector editor with generative creation built in. It should feel powerful enough for serious brand-symbol work, but it is not a general-purpose Adobe Illustrator replacement. The editor exists to take generated marks, refine them, combine them with typography, and export production-ready brand assets.

The UI must use the name **Vector Maker**. Avoid **Illustrator** in user-facing copy, tab labels, export labels, onboarding, and docs aimed at users. Existing internal names such as `IllustratorDocument` may remain temporarily, but the refactor target is `VectorDocument`, `VectorNode`, and `VectorWorkspace`.

The long-term quality bar is industry-leading for the logo/brand-vector workflow: fast canvas, precise editing, clean exports, reliable undo, and a generative layer that can create editable starting points instead of static output.

### Current Baseline

Implemented today:

- A `generated` surface and an `illustrator` surface selected from the inspector.
- Conversion of the current generated mark into an `IllustratorDocument` with one flat layer per generated shape.
- Object mode with layer selection, visibility toggles, add/subtract operation toggles, duplicate, delete, move, scale, and rotate.
- Point mode with anchor/handle selection and dragging for one selected path layer.
- Freehand tools: select, pencil, pen, graffiti, and closed shape-builder path creation.
- Boolean operations on selected editor layers: union, subtract, intersect.
- SVG/PNG export through the active mark, including the existing dissolution effect.
- URL persistence of the whole editor document through compressed hash state.
- Undo/redo snapshots through the existing Zustand/Zundo temporal store.

This baseline is an editable-vector prototype. It is not yet Vector Maker.

### Product Goals

1. Convert any generated mark into an editable vector document without losing the generated source metadata.
2. Let users refine a generated logo into a clean brand asset: edit paths, combine shapes, adjust proportions, set fill/stroke, add type, and export.
3. Preserve the generative layer as a first-class workflow: seed, parameters, construction data, effects, source freshness, and reconversion remain visible and useful.
4. Ship a reliable focused editor before expanding into broad illustration features.
5. Keep the system browser-native, local-first, and shareable by URL while documents remain small enough.

### Non-Goals

These are explicitly out of scope for the first Vector Maker release:

- General illustration workflows unrelated to logos/brand assets.
- Multi-artboard UI.
- Full SVG import.
- PDF import.
- Plugin system.
- Mesh gradients.
- Raster/photo editing.
- Advanced brushes.
- Variable font UI beyond basic family/weight/size controls.
- AI vector editing in the MVP.
- A full Adobe Illustrator compatibility layer.

### Core Workflows

#### 1. Generate to Vector Maker

- User generates a mark in the existing generator surface.
- User opens the **Vector Maker** surface.
- App creates a `VectorDocument` from the generated result.
- App stores source metadata: `seed`, `modeId`, `generatorId`, `generatorVersion`, source params hash, and conversion timestamp.
- If generation params change after conversion, Vector Maker shows a stale-source notice with three actions:
  - `Keep Edit`: leave the current vector document unchanged.
  - `Reconvert`: replace the current vector document from the latest generated mark after user confirmation.
  - `Duplicate From Current Mark`: create a new vector document branch from the latest generated mark while keeping the old document available in local state.

#### 2. Refine Generated Shapes

- User selects objects from the canvas or layer list.
- User moves, scales, rotates, hides, locks, duplicates, deletes, and reorders objects.
- User combines objects with pathfinder commands.
- User edits anchors and Bezier handles for final geometry cleanup.
- User exports SVG/PNG matching the visible Vector Maker result.

#### 3. Add Brand Typography

- After the path/object model is stable, user can add editable text objects.
- User sets font family, size, weight, letter spacing, line height, alignment, fill, stroke, and opacity.
- User can export text as SVG `<text>` or convert text to outlines for handoff.

#### 4. Optional Blank Document

- First release mainly starts from generated marks.
- Add `New Blank Vector Document` only after the new document model exists and the implementation is simple.
- Blank document must create one default artboard, one empty layer, and default appearance values.
- Blank document must not delay the generated-mark editing MVP.

### Workspace Requirements

#### First Release

- Use one artboard only.
- Store artboards as an array in the data model, but only create and expose one artboard in the UI.
- The default artboard size is `1024 x 1024` unless a generated mark or export preset specifies another size.
- Show a pasteboard around the artboard.
- Support zoom and pan:
  - Space + drag pans.
  - Trackpad/mouse wheel zooms around cursor.
  - `Cmd/Ctrl + 0` fits artboard.
  - `Cmd/Ctrl + 1` zooms to 100%.
  - `Cmd/Ctrl + +` zooms in.
  - `Cmd/Ctrl + -` zooms out.
- Show canvas zoom percentage in the workspace chrome.
- Keep the existing construction/final-preview concept available, but do not let it dominate the Vector Maker workspace.
- Vector Maker canvas must not be constrained to the current logo preview card layout.

#### Later Release

- Multi-artboard creation, duplication, renaming, reordering, and export.
- Rulers.
- Movable guides.
- Grid controls.
- Advanced snapping controls.

### Selection Model

- Split selection into two tools:
  - `Selection Tool` selects whole objects/groups.
  - `Direct Selection Tool` selects anchors, segments, and Bezier handles.
- Selection Tool requirements:
  - Click selects one object.
  - Shift-click toggles object selection.
  - Drag on empty canvas creates marquee selection.
  - Delete removes selected unlocked objects.
  - Locked objects cannot be selected from canvas.
  - Hidden objects cannot be selected.
- Direct Selection requirements:
  - Click anchor selects anchor.
  - Shift-click toggles anchor selection.
  - Drag anchor moves anchor.
  - Drag handle moves handle.
  - Clicking a segment selects the segment.
- Selection state must be explicit and serializable:

```typescript
type SelectionTarget =
  | { type: 'object'; nodeId: string }
  | { type: 'anchor'; nodeId: string; pathId: string; segmentIndex: number }
  | { type: 'handle'; nodeId: string; pathId: string; segmentIndex: number; handle: 'in' | 'out' }
  | { type: 'segment'; nodeId: string; pathId: string; segmentIndex: number }
  | { type: 'artboard'; artboardId: string }
```

### Object Transform Requirements

- Selection bounds must render on canvas for selected objects.
- Bounds must expose resize handles and rotate handles.
- Dragging a selected object moves it.
- Dragging a bounds corner scales it.
- Dragging near a corner rotates it.
- `Shift` constrains scale or rotation.
- `Alt/Option` transforms from center.
- Inspector exposes numeric `x`, `y`, `width`, `height`, `rotation`, `scaleX`, `scaleY`.
- Add commands:
  - Bring Forward
  - Send Backward
  - Bring to Front
  - Send to Back
  - Align Left/Center/Right
  - Align Top/Middle/Bottom
  - Distribute Horizontal
  - Distribute Vertical
- Alignment target options:
  - Selection bounds
  - Active object
  - Active artboard

### Path and Pen Requirements

The current `pathData: string` model must be replaced as the canonical editable form. SVG path strings may be cached/exported, but editing must operate on a structured path model.

```typescript
interface VectorPath {
  id: string
  closed: boolean
  segments: VectorPathSegment[]
}

interface VectorPathSegment {
  point: Vec2
  handleIn: Vec2 | null
  handleOut: Vec2 | null
  pointType: 'corner' | 'smooth' | 'symmetric'
}
```

Pen Tool must support:

- Click creates corner anchor.
- Drag creates smooth anchor with linked handles.
- Click first anchor closes path.
- `Esc` cancels current path.
- `Enter` commits current open path.
- `Alt/Option` breaks handle linkage while drawing.
- `Shift` constrains handle angle to 45-degree increments.

Direct Selection must support:

- Move selected anchor.
- Move in/out handles.
- Convert corner to smooth.
- Convert smooth to corner.
- Delete selected anchor.
- Add anchor on selected segment.
- Split path at selected anchor.
- Join two selected open endpoints.
- Close/open selected path.
- Reverse path direction.

Later path commands:

- Simplify Path.
- Offset Path.
- Outline Stroke.
- Expand Appearance.

### Shape Tool Requirements

Required shape tools for the focused brand-vector scope:

- Rectangle.
- Ellipse.
- Polygon.
- Star.
- Line.

Shape tools must create typed shape nodes first, not immediately flattened SVG strings.

Typed shape inspector params:

- Rectangle: `x`, `y`, `width`, `height`, `cornerRadius`.
- Ellipse: `cx`, `cy`, `rx`, `ry`.
- Polygon: `sides`, `radius`, `rotation`.
- Star: `points`, `innerRadius`, `outerRadius`, `rotation`.
- Line: `x1`, `y1`, `x2`, `y2`, `strokeWidth`.

Every typed shape must support `Expand to Path`.

### Appearance Requirements

The editor must move from global fill color to per-object appearance.

```typescript
interface VectorAppearance {
  fill: Paint
  stroke: Paint | null
  strokeWidth: number
  strokeCap: 'butt' | 'round' | 'square'
  strokeJoin: 'miter' | 'round' | 'bevel'
  strokeMiterLimit: number
  strokeDashArray: number[]
  opacity: number
  blendMode: 'normal'
}

type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | { type: 'linearGradient'; gradientId: string }
  | { type: 'radialGradient'; gradientId: string }
```

First release requirements:

- Solid fill.
- No fill.
- Solid stroke.
- Stroke width.
- Stroke cap/join.
- Opacity.

Next release requirements:

- Linear gradients.
- Radial gradients.
- Gradient stop editing.
- On-canvas gradient handles.

SVG export must preserve appearance fields that are supported by the active release.

### Boolean and Pathfinder Requirements

Existing union/subtract/intersect must become reliable pathfinder commands.

First release:

- Union.
- Subtract Front.
- Intersect.
- Exclude.

Requirements:

- Pathfinder commands operate on selected unlocked vector objects.
- Result is a new editable path object.
- Source objects are removed after command unless user holds `Alt/Option`, which creates the result while preserving sources.
- Result inherits appearance from the topmost selected object.
- Subtractive rendering must not rely on white painted shapes. Export must produce actual compound paths, masks, or boolean-composed geometry.
- Boolean failures must show a non-destructive error and leave source objects unchanged.

Later:

- Divide.
- Trim.
- Merge.
- Crop.
- Outline.

### Text Requirements

Text ships after path/object model stabilization and before SVG import.

```typescript
interface VectorTextNode extends VectorBaseNode {
  type: 'text'
  text: string
  box: Rect
  fontFamily: string
  fontSize: number
  fontWeight: number | string
  lineHeight: number
  letterSpacing: number
  textAlign: 'left' | 'center' | 'right'
  appearance: VectorAppearance
}
```

Requirements:

- Create point text by clicking with Text Tool.
- Create box text by dragging with Text Tool.
- Edit text in place on canvas.
- Inspector exposes text content and typography controls.
- Export modes:
  - Preserve editable SVG text when possible.
  - Convert text to outlines when `Export text as outlines` is enabled.
- The app must not expose bundled font files for download.
- Use system fonts and web fonts already loaded by the app.

### Layers, Groups, and Object Hierarchy

Replace flat layers with a document tree.

```typescript
interface VectorDocument {
  schemaVersion: number
  id: string
  name: string
  source: VectorDocumentSource | null
  artboards: VectorArtboard[]
  rootNodeIds: string[]
  nodes: Record<string, VectorNode>
  symbols: Record<string, VectorSymbol>
  assets: Record<string, VectorAsset>
  gradients: Record<string, VectorGradient>
  view: VectorWorkspaceView
  createdAt: string
  updatedAt: string
}

type VectorNode =
  | VectorGroupNode
  | VectorPathNode
  | VectorShapeNode
  | VectorTextNode
  | VectorSymbolInstanceNode
  | VectorGuideNode

interface VectorBaseNode {
  id: string
  name: string
  parentId: string | null
  artboardId: string
  visible: boolean
  locked: boolean
  transform: Matrix2D
  appearance?: VectorAppearance
  metadata?: Record<string, unknown>
}
```

Requirements:

- Groups can contain paths, shapes, text, and other groups.
- Groups support lock, hide, rename, duplicate, delete, reorder.
- Layer panel displays hierarchy, visibility, lock state, object type, and selected state.
- Dragging in the layer panel reorders objects.
- Generated shapes should receive readable names during conversion, for example `Generated Circle 01`, `Cutout 03`, `Wave Arc 02`.

### Symbols / Components

Symbols are not MVP, but the data model must avoid blocking them.

Later requirements:

- Create symbol from selection.
- Insert symbol instance.
- Edit source symbol updates instances.
- Detach instance converts it to normal nodes.
- Use case: brand marks, repeated accents, badges, submarks.

### Generative Layer Integration

The generative layer is a core differentiator, not a separate toy.

Requirements:

- Vector Maker documents converted from generated marks must retain source params and generator version.
- A converted object should keep `sourceShapeId` metadata where available.
- The UI must show whether the vector document is synced with the current generated mark or stale.
- Reconvert must be explicit and destructive only after confirmation.
- Effects such as Dissolution must be available as editable/expandable appearances later, not only as export-time raster-like paths.
- Construction data should be viewable as a reference overlay, not editable artwork by default.
- The original creative-code/editor concept can return as a later `Generative Layer` panel: prompt/task history, generation recipes, parameter changes, and explainable construction steps.

### AI-Assisted Vector Editing

AI vector editing is later phase only. Do not include it in the first reliable editor release.

When added, AI must produce editable vector commands, not opaque images.

Allowed AI command examples:

- `Make this mark more symmetrical`.
- `Create three simpler variants`.
- `Round the outer corners`.
- `Add a wordmark layout using the current brand name`.
- `Turn selected shape into a monoline icon`.

Requirements for later AI phase:

- AI output appears as a preview branch.
- User must accept/apply before document mutation.
- Applied AI edits become normal undoable commands.
- AI-generated objects use the same `VectorDocument` schema as manual edits.
- AI cannot bypass export, appearance, history, or selection rules.

### Import Requirements

SVG import comes after text support.

First import release:

- Import SVG files into the active single artboard.
- Parse paths, compound paths, groups, transforms, fills, strokes, opacity, linear gradients, radial gradients, and viewBox.
- Preserve unsupported features as import warnings.
- Unsupported filters, masks, patterns, and clipping paths may be flattened or skipped with explicit warnings.
- Imported objects become normal editable Vector Maker nodes where possible.

Image import is later and only for reference/tracing, not brand-vector export.

### Export Requirements

First Vector Maker release:

- SVG export.
- PNG export.
- Copy SVG to clipboard.
- Export active artboard.
- Export selected objects.

Requirements:

- Export must use `VectorDocument`, not scraped canvas state.
- Exported SVG must preserve viewBox, paths, compound paths, fill, stroke, opacity, transforms, and supported gradients.
- PNG export must render from the same export serializer used for SVG.
- Export dialog must show whether export uses Generated Mark or Vector Maker document.
- Export dialog must show warning if text will be preserved as text or outlined.

Later:

- PDF export after text/stroke/gradient model is stable.
- `.marque` document export/import after documents become too large or complex for URL state.

### Persistence Requirements

Current persistence direction:

- Keep URL/local persistence for now.
- Continue supporting shareable URLs for small generated and edited documents.
- Store larger local documents in localStorage or IndexedDB once hash URLs become too large.
- Add `.marque` file format later when documents exceed practical URL state.

Requirements:

- `VectorDocument.schemaVersion` is required from the first refactor.
- Every persisted document must run through validation and migration on load.
- URL persistence must reject invalid documents safely and show a recoverable error.
- History and persistence must not store Paper.js runtime objects.

Future `.marque` format:

```typescript
interface MarqueFile {
  fileVersion: number
  appVersion: string
  document: VectorDocument
  thumbnails?: Record<string, string>
}
```

### Undo/Redo Requirements

The existing full-state snapshot model is acceptable for the current prototype but must be replaced before serious editor work.

Use command-based history for Vector Maker.

```typescript
interface VectorCommand {
  id: string
  label: string
  timestamp: number
  apply(document: VectorDocument): VectorDocument
  invert(document: VectorDocument): VectorDocument
  mergeWith?(next: VectorCommand): VectorCommand | null
}
```

Requirements:

- Coalesce pointer drags into one undo step.
- Coalesce text typing into sensible undo chunks.
- Every document mutation must go through a command.
- Undo/redo labels should be visible in debug or history UI.
- Undo/redo must not include zoom/pan, panel open state, hover state, or transient previews.
- Undo/redo must include object creation, deletion, transform, path edits, appearance changes, grouping, pathfinder operations, and text edits.

### Renderer Requirements

Keep Paper.js for now. Add an item cache and dirty-object updates.

Requirements:

- Renderer consumes `VectorDocument` and workspace view state.
- Renderer maps `nodeId -> paper.Item`.
- Renderer updates only dirty objects after document changes.
- Renderer clears/rebuilds only when document schema, artboard, or renderer mode requires it.
- Hit testing returns typed selection targets, not raw Paper.js items.
- Export does not depend on live Paper.js canvas state.
- Paper.js item cache must be disposable on document close/reset.
- If Paper.js becomes a proven blocker, evaluate a custom scene graph renderer later.

Performance targets:

- 500 vector objects remain interactive at 60fps for selection and simple transforms on modern laptops.
- 2,000 vector objects remain usable for pan/zoom and selection.
- Path dragging should not re-run full boolean composition every pointer move.
- Boolean/pathfinder operations may run async and show progress if they exceed 150ms.

### Keyboard Shortcuts

Minimum shortcuts:

| Shortcut | Action |
|---|---|
| `V` | Selection Tool |
| `A` | Direct Selection Tool |
| `P` | Pen Tool |
| `N` | Pencil Tool |
| `T` | Text Tool |
| `R` | Rectangle Tool, unless focus is in generator mode where `R` randomizes seed |
| `L` | Ellipse Tool |
| `Space + drag` | Pan |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Delete/Backspace` | Delete selection |
| `Cmd/Ctrl + G` | Group |
| `Cmd/Ctrl + Shift + G` | Ungroup |
| `Cmd/Ctrl + D` | Duplicate |
| `Cmd/Ctrl + E` | Export |
| `Cmd/Ctrl + 0` | Fit artboard |
| `Cmd/Ctrl + 1` | 100% zoom |
| `Cmd/Ctrl + +` | Zoom in |
| `Cmd/Ctrl + -` | Zoom out |

### UI/UX Requirements

- The main inspector tab label must be **Vector Maker**.
- Toolbar status pill must say **Vector Maker**, not Illustrator.
- Empty state must say: `Generate a mark, then open Vector Maker to refine it.`
- The editor must have a dedicated workspace layout: left toolbar, center artboard/pasteboard, right inspector, optional layer panel.
- The generative mode keeps its current editorial/construction layout.
- Vector Maker must expose the generated source status near the document title.
- Canvas controls must be visible but minimal: zoom, fit, pan, snapping toggle, preview/export mode.
- On mobile, Vector Maker may be view/export-first. Full path editing can be desktop-first for the first release.

### Implementation Phases

#### Phase 0 — Naming and Spec Alignment

- Rename user-facing `Illustrator` copy to `Vector Maker`.
- Add this spec section.
- Keep internal code names temporarily if needed.
- Add explicit migration notes for internal `IllustratorDocument` -> `VectorDocument` work.

Acceptance criteria:

- No user-facing UI text says `Illustrator`.
- Product docs describe the second mode as `Vector Maker`.

#### Phase 1 — VectorDocument Foundation

- Add versioned `VectorDocument` model.
- Add one-artboard document support.
- Add migration from current flat `IllustratorDocument`.
- Convert generated marks into `VectorDocument` nodes.
- Keep SVG/PNG export parity with current active mark export.

Acceptance criteria:

- Generated mark can convert to Vector Maker document.
- Converted document persists through URL/local state.
- Reload restores the same visible artwork.
- Exported SVG visually matches the canvas.

#### Phase 2 — Workspace and Object Editing

- Build dedicated Vector Maker workspace.
- Add pan/zoom/pasteboard/single artboard UI.
- Add item cache and dirty-object rendering.
- Add object selection, marquee selection, transform bounds, z-order, align/distribute.

Acceptance criteria:

- User can select, move, scale, rotate, duplicate, delete, align, distribute, and reorder generated objects.
- 500 simple objects remain interactive for selection and transforms.

#### Phase 3 — Path Editing

- Replace canonical editable path storage with structured path segments.
- Rebuild Pen Tool around structured paths.
- Add Direct Selection for anchors, handles, and segments.
- Add add/delete anchor, corner/smooth conversion, join/split/close/open path.

Acceptance criteria:

- User can clean up generated path geometry without corrupting export.
- Path edits are undoable as commands.
- SVG export reflects edited anchors and handles.

#### Phase 4 — Appearance and Pathfinder

- Add per-object appearance.
- Add solid fill/stroke/opacity/stroke style controls.
- Make pathfinder produce editable compound paths.
- Remove white-paint subtractive rendering from export path.

Acceptance criteria:

- Each object can have independent fill/stroke/opacity.
- Union/subtract/intersect/exclude produce editable result paths.
- Export preserves visible appearance.

#### Phase 5 — Brand Typography

- Add Text Tool.
- Add text objects and inspector typography controls.
- Add in-place text editing.
- Add text export as SVG text and optional outlines.

Acceptance criteria:

- User can create a simple logo lockup with symbol + wordmark.
- User can export text as text or outlines.

#### Phase 6 — Import and Document Scale

- Add SVG import.
- Add unsupported-feature warnings.
- Move large documents from URL-only persistence to local document storage if needed.
- Add `.marque` file format when URL state becomes impractical.

Acceptance criteria:

- User can import a simple SVG logo and edit paths/fills.
- Large documents do not break sharing/local restore.

#### Phase 7 — Generative Layer and AI Commands

- Add generative layer panel for source recipes, prompt/task history, branches, and variants.
- Add AI vector editing as previewed command batches.
- Keep all AI output editable, undoable, and schema-compliant.

Acceptance criteria:

- AI edits never create opaque raster output.
- User can accept/reject AI changes before mutation.
- Applied AI changes are normal undoable Vector Maker commands.

#### Phase 8 — Advanced Artboards and Production Export

- Add multi-artboard UI.
- Add PDF export.
- Add symbols/components.
- Add gradients and advanced snapping/guides/rulers.

Acceptance criteria:

- User can create a small brand sheet with mark, wordmark, icon, and alternate lockups.
- User can export production SVG/PNG/PDF assets from one document.

### Risks and Required Refactors

| Risk | Required action |
|---|---|
| User-facing `Illustrator` name creates wrong expectation and legal/product confusion | Rename UI to `Vector Maker` immediately |
| Flat layer model cannot support groups/text/artboards/symbols | Replace with versioned `VectorDocument` tree |
| Opaque SVG path strings make path editing fragile | Store structured path segments as canonical data |
| Full-state undo will become slow and noisy | Move Vector Maker mutations to command history |
| Paper.js project clear/rebuild will limit scale | Add item cache and dirty-object updates |
| URL state can become too large | Keep URL/local now; add `.marque` once document size demands it |
| Subtractive layers rendered as white break export fidelity | Use real compound paths/masks/boolean results |
| AI can destabilize editor if added too early | Delay AI until manual editing is reliable |
| Blank documents can distract from core workflow | Make generated-mark editing the MVP; blank doc only if cheap after model refactor |

### Open Questions

Resolved decisions:

- UI name is **Vector Maker**.
- Scope is logo/brand-vector editor, not general vector editor.
- First release starts mainly from generated marks.
- One artboard ships first.
- Text ships before SVG import.
- AI vector editing is later phase.
- Persistence remains URL/local for now; `.marque` comes later.
- Renderer remains Paper.js for now with item cache and dirty updates.

Resolved for the concrete v1 build:

- Default artboard sizes are `1024x1024`, `1080x1080`, `1200x1200`, and custom. Do not offer `A4` as a default in v1.
- Support simple local branches through `Duplicate From Current Mark`, not full version control.
- Bring back the generative task/prompt rail after the manual Vector Maker MVP.
- Minimum typography controls are font family, weight/style, size, line height, tracking, alignment, fill, opacity, and text-to-outline.
- Export clean SVG by default. Add optional Marque metadata later for round-trip editing.
- Generated construction geometry may become optional locked guide layers later, but should not become normal editable artwork by default.
