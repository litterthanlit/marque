# Start in Vector Maker (stage 1)

**Date:** 2026-10-05
**Status:** Approved by the owner on 2026-10-05
**Replaces scope in:** `2026-05-25-vector-maker-v1-design.md`

## What changes and why

The owner finds generation rigid and wants the app to start in Vector Maker, with a simple screen that invites play. Today the app opens on the Generate surface behind a "Press Random" dialog, and the page header and stats describe the generated mark even inside Vector Maker.

Stage 1 makes Vector Maker the only surface. The app opens on an empty document. Generation survives as a tray of thumbnails that drop editable layers into the document. The canvas shows the mark the way a construction sheet does, with a key to switch to the clean result.

The May spec put a blank document out of scope and made the generated mark the start of every document. This spec reverses both.

Stage 2 is a separate design. It covers fillets where curves meet, guides that do not print, groups, tangent snapping for every shape, and edits that no longer pass through the legacy layer format. Stage 1 adds no field to the document model, because `mutateVectorViaIllustrator` in `src/store/logoStore.ts` rebuilds every object from legacy layers and would erase it.

## What the user sees

- The app opens on an empty canvas with a hint. No dialog.
- A tool pill sits at the top of the canvas with Select, Pen, Punch, Channel, Slice, the four slabs, and the snapping switch.
- A selection bar sits at the bottom of the canvas. It holds add or cut, duplicate, delete, the boolean actions, and the move, scale, and rotate sliders for layers that have no handles on the canvas.
- A **Layers** button opens a drawer that is closed by default. The drawer lists layers and lets the user show, hide, reorder, flip add or cut, and start over.
- The top bar holds the wordmark, undo, redo, the ink colour, the look switch, **Saved**, **Share**, the survival check, and **Export**. Copy SVG moves into the Export dialog.
- The canvas shows the construction look by default. The mark is light grey with a thin dark outline, and every cut layer shows as a dotted outline. **F** switches to the final look, which is the solid ink mark the app draws today.
- A spark tray runs along the bottom of the page with eight thumbnails and **Shuffle**. A click drops that mark into the document.

## Decisions

### An empty document, never a missing one

The store starts with `activeSurface: 'illustrator'` and a document from `createEmptyVectorDocument`. With `vectorDocument: null`, `addPenShape` and `addCarveCut` return the state unchanged, so the pen and the punch would do nothing.

`addSlab` stops replacing an untouched converted mark. That branch would wipe a mark opened from an old link on the first slab.

### Old links keep working

Link handling moves out of `src/hooks/useUrlState.ts` into a pure module, `src/engine/vector/link.ts`.

- A link with a `vd` document opens that document. The module decodes `vd` before the generator version check, so a version mismatch no longer discards a document.
- A link with generator parameters opens that mark converted into layers.
- `#v=1.0` alone opens the empty document. Every bookmark of the old app has that hash.
- The app writes a new hash only after the first edit, and writes nothing for an empty document.
- A link that carried the dissolve effect opens as the plain mark.

### Conversion must match the generated mark

Converting a generated mark is wrong today for two modes. `WaveArcGenerator` records only the first crescent of each pair in `shapes`, and `ModularGenerator` leaves its clip disc out. Both generators now record every shape they compose. A unit test compares the converted layers with `result.mark` for each mode and style.

### Sparks go in below, beside the ink

A spark is a random mode, style, and seed from geometric-radial, grid-system, modular, and wave-arc. Monogram and blob shapes are not offered.

- The roll prefers low symmetry. Radial uses one fold half the time and two or three otherwise. Grid-system turns both mirrors off and uses no frame, because a frame leaves only a bare outline. Modular turns the clip disc off. Wave-arc cannot be asymmetric through its parameters, so the roll picks it less often and drops a seeded subset of its pieces.
- `dropSpark` inserts the spark's layers below the existing layers, adds first and cuts after. A cut removes only what is below it, so the spark's cuts stay editable and cannot remove the user's work. The user's existing cuts also remove the spark where they overlap.
- The spark is fitted to 360 units and placed beside the existing ink with the logic in `src/engine/carve/placement.ts`. A spark dropped on top of a slab of the same colour would be invisible. The fit is written into the path data, because the adapter's matrix and the layer pivot disagree.
- One drop is one undo step, and every dropped layer is selected.
- A new scale control in the selection bar scales all selected free layers around their shared centre. Without it a dropped spark could be moved but not resized.

Pre-applying a spark's cuts to its own shapes was rejected. The adapter turns every subpath into its own add layer, so a shape with a hole comes back filled.

### The construction look is a view setting

`ui.look` is `'construction'` or `'final'`. It stays out of the undo history and out of the link. `renderIllustratorOnScope` in `src/renderer/IllustratorRenderer.ts` takes the look as an option. It styles the ink item grey with a dark outline and gives each cut layer's hit item a dotted stroke. Drags, cut previews, and the pen reuse the ink item, so they follow the look without more code.

A cut with nothing below it can be selected. Today `findBody` in `src/renderer/directEdit/hitZones.ts` needs an add layer under the pointer, so a punch on an empty canvas shows but cannot be clicked.

### Saved marks stay

**Saved** in the top bar opens the existing list from `SavedVariationsRail` and `useSavedVariations`. It is the only way to keep several marks apart from links.

### What stage 1 removes

- The Generate tab and everything only it uses: modes, styles, presets, sliders, effects, perspective, animation.
- The onboarding dialog, the page title block, the generator stats panel, the final mark tile, the palette tile, the export tile, and the history row.
- The permanent inspector and the mobile controls drawer.
- The generated branch of `LogoCanvas`, the `zundo` history of generator parameters, and the store actions that only the Generate surface called.

`params` stays, because `params.fillColor` is the ink. All five generators stay, because old links need them.

## Build order

Each step leaves `npm test`, `npm run build`, and `npm run test:e2e` passing.

1. **Open blank.** Initial store state, `link.ts`, the two generator fixes, the `addSlab` change, and removal of the onboarding dialog.
2. **Remove the Generate UI.** Delete the tabs, `GenerateTab`, the editorial chrome, `useGeneration`, and the R key. Export reads `useExport().canExport`.
3. **Construction look.** `ui.look`, the renderer option, the F key, the top-bar button, and the cut hit fallback.
4. **New layout.** `ToolPill`, `SelectionBar`, `LayersDrawer`, `SurvivalPopover`, `EmptyHint`, and `SavedMenu` in `src/components/editor/`. The canvas fills the main area. `ParameterPanel.tsx` and the tiles are deleted.
5. **Sparks.** `src/engine/sparks/sparks.ts`, `dropSpark`, the scale control, and `SparkTray`.
6. **Prune and rename.** Delete the files and store actions that nothing imports. The wordmark and the page title become "marque".

## Tests

- Unit tests cover the initial state, link decoding, conversion fidelity for every mode, `dropSpark`, and the look switch.
- `e2e/direct-edit.spec.ts` keeps its seven flows. Its helpers change to use the tool pill, the drawer, and the Export dialog. The tests that read pixels switch the app to the final look first.
- Each step is checked by hand in the browser before it is committed.

## Known limits

- A dropped spark has no group. After the first click elsewhere, its layers are selected one at a time.
- A converted old link can be heavy. A tech-style radial mark is 144 layers and takes about 200 ms to recompose per edit.
- Resize and rotate handles exist only for a single slab or cut. Every other layer uses the sliders in the selection bar.
