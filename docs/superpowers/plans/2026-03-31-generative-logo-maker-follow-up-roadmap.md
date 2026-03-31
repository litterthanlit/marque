# Generative Logo Maker Follow-up Roadmap

## Overview

This roadmap covers the next round of product and implementation work after the current logo maker release. It focuses on three goals:

1. Make the current app feel more reliable and shareable
2. Improve the creative workflow for comparing and exporting marks
3. Add a new grid-based generator that feels distinct from the existing radial and modular modes

## Current Baseline

The app already supports:

- Deterministic seeded generation
- Geometric radial generation
- Modular generation
- Construction and final views
- Undo/redo
- URL-based state persistence
- SVG and PNG export
- Animation controls

The next step is not more foundation work. It is workflow and product depth.

## Priority Order

### Priority 1: Share and Export

#### 1. Copy Share Link

Add a toolbar action that copies the current URL state to the clipboard.

Why:

- The URL state already exists, but users have no visible way to share it
- This turns reproducibility into a real product feature instead of a hidden implementation detail

Deliverables:

- `Copy Link` button in toolbar
- success toast or inline confirmation
- fallback behavior if clipboard access fails

#### 2. Better Export Controls

Expand export from a simple download dialog into a logo workflow.

Add:

- transparent PNG toggle
- tight bounds vs square artboard export
- padding presets: `none`, `compact`, `presentation`
- export preview or summary text that explains the output mode

Why:

- logo usage often depends on background transparency and artboard shape
- current export is correct enough for demos but too thin for brand work

### Priority 2: Creative Workflow

#### 3. Preset Thumbnails

Show each preset with a small visual preview instead of text-only buttons.

Why:

- presets are currently hard to browse
- visual previews make the app feel much more intentional and creative

Possible implementation:

- pre-render lightweight SVG thumbnails from preset params
- cache preview markup in memory

#### 4. Saved Variations Rail

Let users save strong generations and compare them side by side.

Add:

- `Save Variation` action
- horizontal strip of saved marks
- restore/delete actions

Why:

- logo exploration is comparative by nature
- undo/redo is not enough when users want to keep three or four promising directions

#### 5. Generator-specific Panels

Make each generator feel like its own tool, not just the same panel with slightly different controls.

Add:

- clearer generator descriptions
- grouped parameter sections
- contextual helper text

Why:

- generator identity is part of the product
- modular mode and future generators should feel purpose-built

## New Generator: Grid Generator

### Goal

Add a true grid-based generator that builds marks from orthogonal cell systems instead of radial placement or free modular tiling.

This should feel different from:

- `Geometric Radial`: concentric and rotational
- `Modular`: repeated tiles and optional clipping

The new mode should produce:

- monograms
- emblem-like marks
- pixel-clean symbols
- geometric badges
- letterform-adjacent abstractions

### Working Name

`grid-system`

User-facing name:

`Grid System`

### Design Direction

The generator should work on a bounded square matrix. Shapes occupy cells, spans, or corridors inside the matrix and are then combined through boolean operations.

The visual language should emphasize:

- alignment
- repetition
- negative space
- strong silhouettes
- more logo-system behavior and less decorative complexity

### Core Parameters

Base params still apply where relevant:

- `seed`
- `additiveRatio`
- `rotation`
- `fillColor`
- `animationSpeed`

Generator-specific params:

- `columns`: number of grid columns
- `rows`: number of grid rows
- `cellInset`: padding inside each occupied cell
- `strokeBias`: tendency toward bars/lines instead of blocks
- `mirrorX`: horizontal mirroring toggle
- `mirrorY`: vertical mirroring toggle
- `frameMode`: none / square / rounded / badge
- `density`: percentage of occupied cells

Optional later params:

- `cornerStyle`: sharp / rounded / chamfered
- `diagonalBias`: allow diagonal triangles and cuts
- `centerWeight`: bias occupied cells toward the center

### Generation Model

1. Create a bounded square cell grid
2. Use seeded randomness to mark cells or spans as occupied
3. Apply optional mirroring rules
4. Convert occupied cells and spans into primitives
5. Boolean-unite additive regions
6. Apply subtractive cuts for inner negative space and counters
7. Optionally wrap the result in a frame shape

### Construction View

Construction mode should show:

- visible cell grid
- occupied cells
- subtractive cuts
- mirror axes when enabled

This generator is a great candidate for a richer construction overlay because its logic is easier to understand visually than the radial system.

### Why This Generator Matters

It gives the app a third creative lane:

- radial for ornamental and symbolic marks
- modular for pattern-like marks
- grid system for branding, monograms, and harder-edged identity work

This broadens the app from a visual toy into a more useful logo concepting tool.

## Suggested Build Order

### Track A: Workflow

1. Copy Share Link
2. Better Export Controls
3. Preset Thumbnails
4. Saved Variations Rail

### Track B: Generator Expansion

1. Add `GridGenerator.ts`
2. Add `GridMatrix.ts` placement helper
3. Add generator registration and selector support
4. Add generator-specific controls
5. Add presets tuned for the new grid mode

### Track C: Polish

1. Better empty/loading/error states
2. Keyboard shortcut hints in UI
3. Browser-level smoke tests for generation, share links, and export

## File Targets

### Workflow

- `src/components/layout/Toolbar.tsx`
- `src/components/export/ExportDialog.tsx`
- `src/hooks/useExport.ts`
- `src/components/controls/PresetSelector.tsx`
- `src/store/logoStore.ts`

### Grid Generator

- `src/engine/grid/GridMatrix.ts`
- `src/engine/generators/GridGenerator.ts`
- `src/engine/generators/registry.ts`
- `src/components/controls/ParameterPanel.tsx`
- `src/store/presets.ts`

### UI Polish

- `src/App.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/preview/*`

## Recommended Next Task

If we want the highest product value with the least implementation risk, do this next:

1. Add `Copy Share Link`
2. Add export padding/artboard options
3. Implement `Grid System` generator

That combination makes the app more useful immediately and gives it a genuinely new creative mode instead of just more polish around the same outputs.
