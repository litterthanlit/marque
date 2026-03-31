# Wave Arc Generator & Pixel Dissolution Effect — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Depends on:** `2026-03-31-generative-logo-maker-design.md` (base app spec)

---

## Overview

Two additions to the generative logo maker:

1. **Wave Arc Generator** — A new 5th mode that produces concentric crescent/arc marks with bilateral or radial symmetry.
2. **Pixel Dissolution Effect** — A post-processing layer that decomposes any generator's solid mark into a field of particles, with controllable erosion depth.

These are architecturally separate: Wave Arc is a generator (produces marks), Dissolution is an effect (transforms marks). Dissolution works on all modes, including Wave Arc.

---

## Feature 1: Wave Arc Generator

### Mode Identity

- **Mode ID:** `wave-arc`
- **User-facing name:** "Wave Arc"
- **Generator file:** `src/engine/generators/WaveArcGenerator.ts`
- **Mode definition:** Added to `src/store/modes.ts`

### Core Algorithm

Each crescent is built by boolean-subtracting an inner ellipse from an outer ellipse. The inner ellipse is offset along the crescent's open-end axis by `taperAmount * outerRadius`, producing tapered tips (thick middle, thin ends).

Crescents are concentrically spaced outward from the center, with gap controlled by `gapRatio`.

**Bilateral symmetry:** Generate crescents on the right side, mirror across the vertical axis, boolean-union both sides.

**Radial symmetry:** Generate one spoke of crescents, replicate `symmetryFolds` times around the center, boolean-union all spokes.

All output is a single compound path via boolean union.

### Parameters (mode-specific)

| Param | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `arcCount` | int | 2–8 | 4 | Concentric crescents per side/spoke |
| `spreadAngle` | float | 30–180° | 120° | Angular opening of each crescent. 180° = semicircle, 30° = narrow sliver |
| `gapRatio` | float | 0.1–0.8 | 0.3 | Gap between crescents as fraction of thickness. 0.1 = tight, 0.8 = airy |
| `taperAmount` | float | 0.2–1.0 | 0.7 | Inner ellipse offset controlling tip sharpness. 1.0 = sharp, 0.2 = blunt |
| `arcSymmetry` | enum | `bilateral` \| `radial` | `bilateral` | Symmetry mode |
| `symmetryFolds` | int | 2–12 | 4 | Radial repetitions (only active when `arcSymmetry` is `radial`) |

### Shared Controls

`seed`, `fillColor`, `rotation`, `animationSpeed`

### Boolean/Geometry Composition

- Each crescent = `outerEllipse - innerEllipse` (boolean subtract)
- Inner ellipse offset = `taperAmount * outerRadius` along the crescent axis
- All crescents within a side/spoke are unioned
- Bilateral: right side generated, mirrored, both sides unioned
- Radial: one spoke generated, replicated N times, all spokes unioned

### Edge Cases

- `spreadAngle` at 180° + bilateral: crescents from each side touch at top/bottom. Boolean union produces closed rings. Acceptable.
- High `arcCount` + low `gapRatio`: crescents may overlap. Union merges them cleanly.
- `taperAmount` at 0.2: near-uniform thickness arcs. Subtraction still valid, tips are blunt.
- Radial with 2 folds: equivalent to bilateral. Consistent behavior, no special-casing needed.

### Construction View

Shows individual crescent outlines before boolean composition, plus:
- Vertical symmetry axis guide line (bilateral mode)
- Radial guide lines (radial mode)

### Presets (3)

1. **"Signal"** — bilateral, 4 arcs, 120° spread, moderate taper (matches reference image)
2. **"Radial Pulse"** — radial, 3 arcs, 6 folds, wide spread, sharp taper
3. **"Ripple"** — bilateral, 7 arcs, 90° spread, tight gaps, blunt taper

### Output

Standard `GenerationResult` with `mark.layers`, `mark.compoundPathData`, `mark.fillRule`, `mark.viewBox`, and `warnings[]`. Same contract as all other generators.

---

## Feature 2: Pixel Dissolution Effect

### Architecture: Post-Effect Layer

Dissolution is NOT a generator. It reads the active generator's output and produces a derived particle representation. The generator's `GenerationResult` is never mutated.

**Pipeline position:** After generation, before rendering/export. The effect subscribes to `result` + `effectParams` and produces memoized derived data.

### Core Algorithm

1. Take the generator's `compoundPathData` and sample it onto a bounding-box-aligned grid.
2. For each grid cell, determine overlap with the filled area of the path.
3. Compute a distance field: each filled cell gets a normalized distance (0 = nearest edge, 1 = deepest interior).
4. Apply the threshold slider: cells with normalized distance below the threshold dissolve into particles. Cells above remain as solid fill.
5. Emit a particle (square or circle) at each dissolved cell, sized proportionally to the cell's fill density.

### DissolutionResult Shape

```typescript
interface DissolutionResult {
  particlePathData: string              // Combined SVG path of all particles
  solidCorePath: string | null          // Remaining un-eroded mark (null at 100% threshold)
  cells: DissolutionCell[]              // Per-cell metadata for animation and debugging
  viewBox: ViewBox                      // Copied from the base mark for render/export alignment
}

interface DissolutionCell {
  x: number
  y: number
  width: number
  height: number
  distance: number                      // Normalized distance from edge (0–1)
  revealRank: number                    // Animation ordering (0 = first to appear)
  shape: 'square' | 'circle'
}
```

### Parameters (effect-level, available in all modes)

| Param | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `dissolveEnabled` | boolean | — | `false` | Master toggle |
| `dissolveThreshold` | float | 0–100% | 50% | Erosion depth. 0% = fully solid, 100% = fully dissolved |
| `dissolveCellSize` | int | 4–32px | 12 | Particle grid resolution |
| `dissolveShape` | enum | `square` \| `circle` | `square` | Particle shape |
| `dissolveScatter` | float | 0–1 | 0 | Seeded random displacement from grid centers (via shared RNG) |
| `dissolveSizeVariation` | float | 0–1 | 0.3 | How much particle sizes vary by fill density |

### Threshold Behavior

- **0%** — No dissolution. Solid mark rendered as-is. `DissolutionResult` is null.
- **Partial (1–99%)** — Outer cells dissolve into particles, inner core stays solid. Two layers rendered: `solidCorePath` + `particlePathData`.
- **100%** — Entire mark dissolved. `solidCorePath` is null. Only particles rendered.

### Grid Alignment

Bounding-box aligned. The particle grid starts at the mark's bounding box edges, so particles are always positioned relative to the shape. Moving or resizing the mark moves the grid with it. Deterministic regardless of canvas position.

### Animation

When animation is enabled and dissolution is active, particles stagger in using the `revealRank` field (derived from normalized distance). Edge particles appear first, interior particles last. Stagger timing controlled by the existing `animationSpeed` param.

---

## Architecture: Effect Pipeline

### Directory Structure

New `src/engine/effects/` directory, parallel to `src/engine/generators/`.

### Effect Registration

An `EffectRegistry` holds available effects (dissolution for now, extensible for future effects like halftone, grain). Each effect declares:
- Its params interface
- A `process(result: GenerationResult, params: EffectParams): EffectResult` function

### Store Integration

- `effectParams` lives in the store as canonical state — persisted, tracked by undo/redo, encoded in URLs.
- `effectResults` (e.g. `DissolutionResult`) are memoized derived data, NOT stored as canonical state. Computed reactively from `result` + `effectParams`.
- Store shape: `{ params, result, effectParams, ui }`. No `effectResults` key.

### Render Integration

- `renderLogoOnScope` receives memoized effect results alongside the generator `result`.
- When dissolution is active: renders solid core (if any) + particle layer.
- When dissolution is off: renders the raw mark as before.
- Construction view always shows raw generator output, ignoring effects.

### Export Integration

- `generateSVGString` accepts optional effect results.
- Serializes whichever layers are active: at 0% only the solid mark, at partial threshold both solid core and particles, at 100% only particles.
- The export dialog shows a visual indicator when effects are active (e.g. "Dissolution applied") to make clear the export includes the dissolved output.

### URL Encoding

Effect params use an `e.` prefix to avoid collision with generation params (e.g. `e.dissolveThreshold=60`, `e.dissolveCellSize=12`).

### History

Effect param changes are tracked by undo/redo alongside generation params. Both are part of the canonical state.

---

## UI: Effect Controls

### Parameter Panel

A new collapsible "Effects" section appears below mode-specific controls, available in all modes:
- Dissolution toggle (on/off)
- When enabled: threshold slider, cell size slider, shape toggle, scatter slider, size variation slider

### Mode Independence

The effects section is identical regardless of active mode. Switching modes preserves effect params. Effects are a layer on top of generation, not part of it.

### Visual Feedback

When dissolution is active, the canvas updates particles in real-time as sliders change, with the same debounced regeneration used for other params.

---

## Compatibility

- Wave Arc produces the same `GenerationResult` contract as all other generators. No special handling needed.
- Dissolution works on any generator's output, including Wave Arc.
- Existing features (presets, URL sharing, undo/redo, export, animation) work with both new features without modification beyond the documented integration points.
