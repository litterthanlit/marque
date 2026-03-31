# Generative Logo Maker Implementation Plan

> For agentic workers: implement this plan in order. Do not skip Phase 0. The revised design spec is the source of truth for engine contracts, determinism, persistence, and export behavior.

**Goal:** Ship the generative logo maker from the current Phase 1 foundation to a polished two-generator app, while first aligning the codebase with the revised spec's serializable engine contract.

**Design Source:** `docs/superpowers/specs/2026-03-31-generative-logo-maker-design.md`

**Key rule:** No feature work should cement the old engine contract. Before adding presets/export/blob/animation/modular generation, the engine output, persistence model, and generator semantics must match the revised spec.

---

## Current State

The repo has a working Phase 1-style foundation:

- Engine files exist for params, RNG, concentric grid, primitives, boolean ops, symmetry, generator registry, and generation pipeline.
- Renderer files exist for Paper.js-backed construction/final rendering.
- Zustand store exists, but undo/redo, URL state, presets, export, animation, and modular generation are incomplete or missing.
- The current implementation plan predates the revised spec and should not be followed verbatim.

---

## Success Criteria

The implementation is complete when all of the following are true:

- Engine returns a serializable `GenerationResult` with `mark.layers`, `mark.compoundPathData`, `fillRule`, `viewBox`, and `warnings`.
- Generation is deterministic for the same `generatorId + generatorVersion + canonical params`.
- The geometric radial generator uses the "single wedge -> replicate" symmetry model.
- Shared URLs persist canonical generation state only.
- Undo/redo tracks committed parameter changes only.
- SVG export serializes engine output directly and does not scrape the live canvas.
- Blob primitives, presets, animation, and modular generation all build on the same engine contract.
- The app remains responsive on desktop and mobile and is ready for later worker migration.

---

## File Ownership

### Engine

- `src/engine/types.ts`
- `src/engine/Engine.ts`
- `src/engine/random.ts`
- `src/engine/boolean/operations.ts`
- `src/engine/primitives/*`
- `src/engine/symmetry/radial.ts`
- `src/engine/generators/*`
- `src/engine/pipeline/GenerationPipeline.ts`

### Store and Hooks

- `src/store/logoStore.ts`
- `src/store/historyMiddleware.ts`
- `src/store/presets.ts`
- `src/hooks/useGeneration.ts`
- `src/hooks/useExport.ts`
- `src/hooks/useUrlState.ts`
- `src/hooks/useAnimation.ts`

### Renderer and UI

- `src/renderer/*`
- `src/components/layout/*`
- `src/components/canvas/*`
- `src/components/controls/*`
- `src/components/preview/*`
- `src/components/export/*`

---

## Phase 0: Contract Alignment

This phase is required before any additional feature work.

### Task 0.1: Align Engine Types to the Revised Spec

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/generators/types.ts` or equivalent generator interface file
- Modify: `src/store/logoStore.ts`
- Modify: `src/hooks/useGeneration.ts`
- Modify: any renderer or preview code that consumes the old result shape

- [ ] Add `PersistedLogoState`, `CompositeLayer`, and the revised `GenerationResult.mark` structure.
- [ ] Add `warnings: string[]` to `GenerationResult`.
- [ ] Add generator `version` to the generator interface and registry shape.
- [ ] Update all call sites that still expect a flat `compositePath`.
- [ ] Keep engine output plain-data only. Do not store Paper.js objects in Zustand or React state.

**Definition of done:**

- TypeScript compiles with no references to the old flat result contract.
- Renderer and export consumers read from `result.mark`.

### Task 0.2: Fix the Geometric Symmetry Semantics

**Files:**
- Modify: `src/engine/generators/GeometricRadialGenerator.ts`
- Modify: `src/engine/symmetry/radial.ts`
- Modify: `src/engine/pipeline/GenerationPipeline.ts` if needed

- [ ] Refactor generation so each ring creates prototype shapes within one wedge.
- [ ] Apply symmetry by replicating the prototype set `symmetryFolds` times.
- [ ] Mark generated shapes as `role: 'prototype' | 'symmetry-instance'` when useful for construction rendering/debugging.
- [ ] Remove any duplicate-placement logic that effectively applies symmetry twice.

**Definition of done:**

- Shape counts scale linearly with prototype count times fold count.
- Construction view matches the new mental model: one wedge designed, then replicated.

### Task 0.3: Lock in Determinism and Canonical Params

**Files:**
- Modify: `src/engine/random.ts`
- Modify: `src/engine/primitives/blob.ts` when created
- Modify: `src/store/logoStore.ts`
- Create: `src/hooks/useUrlState.ts`

- [ ] Ensure all randomness flows through the seeded RNG wrapper.
- [ ] Define canonical param serialization order for URL persistence and history equality.
- [ ] Round persisted/exported numeric outputs to stable precision.
- [ ] Persist `generatorVersion` in URL state alongside params.

**Definition of done:**

- Two runs with identical canonical state produce identical exported SVG path data.

---

## Phase 1: Finish Core Shape Generation

### Task 1.1: Add Blob Primitive with Deterministic Seeded Noise

**Files:**
- Create: `src/engine/primitives/blob.ts`
- Modify: `src/engine/primitives/index.ts`
- Modify: `src/engine/generators/GeometricRadialGenerator.ts`
- Modify: `src/renderer/ConstructionView.ts` if blob outlines need explicit support

- [ ] Implement a blob primitive using deterministic seeded noise from the shared RNG stream.
- [ ] Version any blob defaults through the generator version, not hidden constants in UI code.
- [ ] Update primitive picking and path creation to support `blob`.
- [ ] Make construction rendering reflect the actual blob path, not a fallback circle.

**Definition of done:**

- Randomized outputs can include blobs.
- Blob shapes reproduce exactly for the same seed/version.

### Task 1.2: Surface Full Construction Data

**Files:**
- Modify: `src/engine/pipeline/GenerationPipeline.ts`
- Modify: `src/renderer/ConstructionView.ts`
- Modify: `src/components/preview/ConstructionData.tsx`

- [ ] Ensure construction data includes grid lines, shape counts, additive/subtractive stats, and symmetry info.
- [ ] Render prototype and instance geometry in construction mode when useful for debugging.
- [ ] Preserve a clean final view that renders only the composed mark.

---

## Phase 2: Store, History, and Shareability

### Task 2.1: Add History Middleware

**Files:**
- Create: `src/store/historyMiddleware.ts`
- Modify: `src/store/logoStore.ts`
- Modify: `src/components/layout/Toolbar.tsx`

- [ ] Add undo/redo middleware scoped to canonical generation params only.
- [ ] Snapshot only on committed parameter changes and preset applications.
- [ ] Exclude zoom/pan, modal open state, hover state, and overlay toggles from history.
- [ ] Add undo/redo controls and disabled states to the toolbar.

### Task 2.2: Add URL State

**Files:**
- Create: `src/hooks/useUrlState.ts`
- Modify: `src/App.tsx`
- Modify: `src/store/logoStore.ts`

- [ ] Encode canonical params, `generatorId`, and `generatorVersion` into the URL.
- [ ] Validate and clamp incoming URL state before applying it.
- [ ] Drop unknown params for older/newer versions rather than crashing.

### Task 2.3: Add Presets

**Files:**
- Create: `src/store/presets.ts`
- Create: `src/components/controls/PresetSelector.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`
- Modify: `src/store/logoStore.ts`

- [ ] Define 8-12 curated parameter snapshots plus metadata.
- [ ] Support preset apply from the parameter panel.
- [ ] Treat presets as params plus metadata only, never precomputed geometry.

---

## Phase 3: Export

### Task 3.1: SVG and PNG Export

**Files:**
- Create: `src/hooks/useExport.ts`
- Create: `src/components/export/ExportDialog.tsx`
- Modify: `src/components/layout/Toolbar.tsx`

- [ ] Serialize SVG directly from `GenerationResult.mark`.
- [ ] Use `viewBox`, fill rule, and path data from engine output.
- [ ] Export PNG by rasterizing the generated SVG string, not by scraping the live Paper.js canvas.
- [ ] Name files predictably using seed and generator metadata.

**Definition of done:**

- Exported SVG matches the rendered mark.
- Exported PNG matches the same geometry at the requested scale.

---

## Phase 4: Animation

Animation is allowed only after deterministic static output and export are stable.

### Task 4.1: Add Animation Types and Keyframes

**Files:**
- Create: `src/engine/animation/types.ts`
- Create: `src/engine/animation/keyframes.ts`
- Modify: generator interface files

- [ ] Define `AnimationKeyframe`.
- [ ] Allow generators to provide deterministic keyframes based on seed/version/params.
- [ ] Keep animation metadata separate from the static mark contract.

### Task 4.2: Add Animation Runtime

**Files:**
- Create: `src/hooks/useAnimation.ts`
- Create: `src/components/canvas/AnimationControls.tsx`
- Modify: `src/components/canvas/LogoCanvas.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] Add play/pause state and speed controls.
- [ ] Ensure static rendering still works when animation is disabled.
- [ ] Do not let animation mutate canonical params or export state accidentally.

---

## Phase 5: Modular Generator

### Task 5.1: Add Modular Grid and Generator

**Files:**
- Create: `src/engine/grid/ModularGrid.ts`
- Create: `src/engine/generators/ModularGenerator.ts`
- Modify: `src/engine/generators/registry.ts`
- Create: `src/components/controls/GeneratorSelector.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] Implement tile/repeat placement.
- [ ] Generate a tile unit, repeat it in a grid or radial pattern, and optionally clip it.
- [ ] Register the new generator with its own `version`.
- [ ] Expose generator switching in the UI.

**Definition of done:**

- Switching generators produces visibly different structures without breaking persistence or export.

---

## Phase 6: Responsive and Performance Polish

### Task 6.1: Responsive Layout

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/canvas/CanvasControls.tsx`
- Modify: `src/components/controls/ParameterPanel.tsx`

- [ ] Ensure the parameter panel works on smaller screens.
- [ ] Use a bottom sheet or collapsible controls pattern on mobile if needed.
- [ ] Preserve access to export, seed, presets, and generator selection on mobile.

### Task 6.2: Prepare for Worker Migration

**Files:**
- Modify: engine/pipeline/boolean integration as needed

- [ ] Audit generation code for structured-clone-safe data only.
- [ ] Remove any lingering renderer assumptions from engine code.
- [ ] Cap maximum complexity to avoid UI stalls.
- [ ] Defer actual worker move until after profiling unless the main thread is already unstable.

---

## Verification Checklist

- [ ] `npm run dev` starts cleanly.
- [ ] TypeScript passes with `npx tsc --noEmit`.
- [ ] Changing the seed changes the logo.
- [ ] Reusing the same seed/version/params reproduces the same logo.
- [ ] Construction view toggles correctly.
- [ ] Exported SVG matches the rendered mark.
- [ ] Exported PNG matches the rendered mark.
- [ ] Presets are visually distinct and reversible via undo.
- [ ] Shared URLs reload the same logo.
- [ ] Generator switching works and persists correctly.
- [ ] Rapid randomization does not crash or corrupt rendering.
- [ ] Mobile layout remains usable.

---

## Suggested Commit Order

1. `refactor: align engine result contract with revised logo spec`
2. `fix: update radial generator to wedge-based symmetry`
3. `feat: add deterministic blob primitive`
4. `feat: add undo redo and canonical URL state`
5. `feat: add presets and generator selection`
6. `feat: add SVG and PNG export`
7. `feat: add animation controls and deterministic keyframes`
8. `feat: add modular generator`
9. `feat: polish responsive layout and performance guards`

---

## Notes for Implementers

- Prefer small, verifiable patches over large rewrites.
- Keep the engine contract stable once Phase 0 lands.
- If the existing codebase diverges from the "Current State" summary, inspect the actual files and update this plan before proceeding.
- If a task reveals the spec is still ambiguous, stop and resolve that ambiguity in the spec first instead of coding through it.
