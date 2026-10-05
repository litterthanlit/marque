# Dalat — Logo Illustrator

> This document describes the app as it stood in April 2026, when it was a parameter-driven logo generator. The app is now called Marque and opens in Vector Maker. The current design is in [`docs/superpowers/specs/2026-10-05-start-in-vector-maker-design.md`](superpowers/specs/2026-10-05-start-in-vector-maker-design.md).

> An easy-to-use, browser-based logo illustrator. Built with React, Paper.js, Zustand, and Tailwind.

---

## Vision

Build an illustrator purpose-built for logos — with the power of tools like Illustrator but without the complexity. The app should feel intuitive enough that someone with no design background can create professional-quality logo marks, while still giving experienced designers precise vector control.

---

## Build Summary

### Foundation (PRs #1-2)

**Procedural Generation Engine**
- 5 generator strategies: Geometric Radial, Grid System, Modular, Monogram, Wave Arc
- Seeded PRNG for deterministic, reproducible logos — same seed always produces the same output
- 6 shape primitives: circle, rectangle, triangle, polygon, blob, ellipse
- Radial symmetry system (1-12 folds) and concentric/modular grid point generation
- Boolean composition engine: unite all additive shapes, then subtract all subtractive shapes

**Effects**
- Dissolution/particle effect with distance field emission and configurable density, radius, and speed
- Animation keyframes with playback controls

**UI/UX Overhaul**
- Dark studio aesthetic inspired by Vercel/Linear dashboards
- Tabbed sidebar with parameter sliders for generation control
- 5 style families: minimal, heritage, luxe, playful, tech
- Edit mode: select, move, scale, rotate, delete generated shapes
- Undo/redo with 50-state temporal history (Zundo)
- URL state persistence — every parameter change updates the URL for sharing
- Export pipeline: SVG, PNG, PDF

**Drawing Tools (PR #2)**
- Pencil: freehand drawing with auto-simplify for smooth strokes
- Pen: cubic bezier curve editing with control handles
- Graffiti/Spray: spray paint particle effect tool
- All tools produce `DrawnPath` entries stored in the global state

### Shape Builder + Boolean Operations (PR #3)

This work came from a brainstorming session focused on two user needs:

1. **Creating freeform organic shapes** — smooth, curved forms like swooshes, stars, and abstract marks that go beyond geometric primitives
2. **Boolean cutouts** — punching one shape through another, Figma-style

#### Brainstorming Session

**The problem:** The existing tools could generate procedural logos and draw stroked paths, but there was no way to create filled, closed organic shapes by hand, and no way to combine shapes with boolean operations interactively.

**Approaches considered:**

| Approach | Description | Verdict |
|----------|-------------|---------|
| A. Shape Builder + Selection Booleans | Dedicated tool for placing bezier points to build filled shapes. Separate selection-based boolean operations (select 2+ shapes, click Union/Subtract/Intersect). | **Selected** — familiar Figma/Illustrator model, clean separation of drawing and combining |
| B. Modal Drawing with Inline Preview | Draw on top of existing shapes with live boolean preview based on mode toggle. | Rejected — complex interaction model, couples drawing and booleans |
| C. Extend Pen Tool + Add/Subtract Toggle | Modify existing pen to support closed fills, keep per-shape operation toggle. | Rejected — per-shape toggle is less intuitive, risks breaking existing pen behavior |

**Shape creation approaches considered:**

| Approach | Description | Verdict |
|----------|-------------|---------|
| A. Click-to-place bezier shape builder | Click to place anchor points, drag to create curve handles, close to fill | **Selected** — precise control, familiar to vector tool users |
| B. Freehand draw + auto-close | Draw outline with pencil tool, auto-close and fill | Rejected — less precise, hard to get clean shapes |
| C. Warp primitives | Start from stars/polygons, drag points to warp | Rejected — limiting starting point for truly organic forms |

#### What was built

**Shape Builder Tool**
- New tool in the toolbar (star icon), between Select and Pencil
- Click to place anchor points on the canvas
- Drag while clicking to pull out symmetric bezier handles for curves
- Semi-transparent fill preview updates as you add points
- Dotted preview line from last point to cursor
- Blue anchor dots with handle visualization
- Close the shape by: clicking the first point (highlights when close), double-clicking, or pressing Enter
- Escape cancels the in-progress shape
- Produces closed, filled `DrawnPath` entries with `tool: 'shapebuilder'`

**Boolean Operations**
- Switch to Select tool, click drawn paths to toggle selection (shift not needed — click toggles)
- Blue dashed outline shows selected shapes
- When 2+ shapes are selected, three buttons appear in the toolbar: Union, Subtract, Intersect
- Operations use Paper.js boolean engine in a headless scope
- Result replaces selected shapes with a single combined shape
- Click empty space to deselect all

---

## Architecture

```
src/
  engine/           # Pure computation, no UI — structured-clone safe for future Worker migration
    boolean/        # composeBooleanResult() — Paper.js unite/subtract
    generators/     # 5 logo generation strategies
    primitives/     # Shape factories (circle, rect, triangle, polygon, blob, ellipse)
    grid/           # Concentric + modular grid point generation
    symmetry/       # Radial symmetry (applyRadialSymmetry)
    effects/        # Dissolution processor
    animation/      # Keyframe generation
    pipeline/       # GenerationPipeline — entry point for generate()
  renderer/         # Paper.js rendering layer
    tools/          # PencilTool, PenTool, GraffitiTool, ShapeBuilderTool
    PaperRenderer   # Main render orchestrator
    FinalView       # Final composed logo rendering
    ConstructionView # Grid, guides, construction details
    InteractionLayer # Hit-testing, selection, dragging
  store/            # Zustand + Zundo (undo/redo)
    logoStore       # Global state: params, result, UI, drawn paths, boolean ops
  components/       # React UI
    canvas/         # LogoCanvas, DrawingOverlay, AnimationControls
    controls/       # ParameterPanel, PresetSelector, EffectControls
    layout/         # AppShell, Toolbar
    export/         # ExportDialog (SVG/PNG/PDF)
```

**Key data flow:**
1. User adjusts params (sliders, presets, mode) -> `useGeneration()` hook detects changes
2. `GenerationPipeline.generate(params)` runs deterministically with seeded RNG
3. Returns `GenerationResult` (shapes, composite path, construction data)
4. `LogoCanvas` renders via Paper.js, layering: construction -> mark -> effects -> drawn paths -> interaction
5. Drawing tools produce `DrawnPath` entries stored in Zustand
6. Boolean ops run in headless Paper.js scope, replace selected paths with combined result

---

## Roadmap

### Phase 1 — Core Illustrator Tools
- [ ] **Direct Selection tool** — click any anchor point or curve handle and drag to reshape existing paths
- [ ] **Fill/stroke editor** — change color, opacity, stroke width on any selected shape
- [ ] **Layers panel** — see all shapes stacked, reorder with drag, toggle visibility
- [ ] **Snap & alignment** — snap to grid, to other shapes, center/distribute commands

### Phase 2 — Content & Typography
- [ ] **Text tool** — place editable text, choose fonts, convert text to outlines
- [ ] **Shape library** — drag-and-drop common logo elements (arrows, shields, badges, leaves, abstract marks)
- [ ] **Artboard system** — multiple logo variations side by side
- [ ] **Color palette system** — generate harmonious palettes, apply across all shapes

### Phase 3 — Polish & Power Features
- [ ] **Gradient & pattern fills**
- [ ] **Path offset / outline stroke** — expand strokes into filled shapes
- [ ] **Smart guides & rulers**
- [ ] **Template gallery** — start from curated logo templates
- [ ] **AI-assisted generation** — describe a logo concept, get a starting point

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite 8 |
| Vector Engine | Paper.js 0.12 |
| State | Zustand 5 + Zundo 2 (temporal undo/redo) |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI (select, slider, toggle) |
| Randomization | seedrandom (deterministic PRNG) |
