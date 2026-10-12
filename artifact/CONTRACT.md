# Marque artifact: module contract

This file is the shared contract for the three workstreams that build `artifact/`. Each workstream (WS1, WS2, WS3) builds against the signatures below without seeing the others' code. **If you need something that isn't here, don't invent a cross-module dependency. Do it inside your own files.**

## Thesis (keep it in every decision)

1. **One primitive, the path.** Every shape is an item with contours, and every contour is a list of anchor nodes with optional bezier handles. Every tool only generates nodes, so once drawn, everything edits the same way.
2. **One composition rule, add or cut.** The document is an ordered stack, bottom to top. An `add` item paints. A `cut` item erases only what is beneath it in the stack, and a later `add` can paint back over the hole.
3. **One output.** The exported SVG is exactly what is on screen.

Target size is about 3,150 LOC of source in total. This is the "stripped down" version of a 35k-LOC app, so prefer the plain solution every time.

## Platform rules (hard)

- **No build step.** Vanilla JS ES modules (`import … from './x.js'`, always with the `.js` extension). No framework, and no npm imports in browser code.
- **Paper.js** is a classic script loaded before the app: `https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js`, which defines the global `paper`. Only `js/paperBridge.js` touches Paper, and it receives the Paper object as an argument.
- **Pure modules** (`consts`, `model`, `geometry`, `render`, `assist`'s pure functions) must not touch `window`, `document` or `paper`, so that `node --test` can import them. Node 22 runs `artifact/**/*.js` as ESM because the root `package.json` has `"type":"module"`.
- **`index.html` is wrapped at publish time** in `<!doctype html><html><head>…</head><body>`. So it must **not** contain doctype, `html`, `head` or `body` tags. It starts with `<title>Marque</title>`, then `<link>`s for fonts, then `<style>`, then markup, then the scripts.
- **The only network** is the Paper CDN script and Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). Everything else is blocked.
- **Blocked browser features:**
  - `<a download>`, blob downloads, `alert`, `confirm`, `prompt` and `window.print` all do nothing. Build any confirmation into the page.
  - `localStorage` can throw, so wrap every access in try/catch.
- **Runtime capabilities.** `window.claude` may be **undefined**, for example in local dev or tests. When present it has only `use(name)`, which returns a Promise of the capability or `null`. That promise can take up to 10 s. Never block first paint on it.
  - `await claude.use("downloads")` returns `{ save({filename, data}) → Promise<{status}> }`. It rejects with `{code}`: `declined`, `rate_limited`, `unavailable`, `rejected_extension`, `too_large`, `bad_request`, `not_granted`, `capability_disabled` or `capability_removed`.
  - `await claude.use("sample")` returns the `sample` function. `sample.json(prompt, {signal, onText, modelTier})` resolves to parsed JSON, or rejects with `{code, message, text?}`.
- **Voice.** Plain, British spelling (colour, centre), sentence case, and real symbols: `512 × 512`, `2×`, `−`, `100%`. Labels say what happens: "Save SVG", "Copy SVG", then the toast "Copied".

## File ownership

| WS | Files (create ONLY these) | LOC budget |
|---|---|---|
| WS1 Core | `js/consts.js` 40, `js/model.js` 140, `js/geometry.js` 320, `js/render.js` 110, `js/paperBridge.js` 200, `tests/model.test.mjs`, `tests/geometry.test.mjs`, `tests/render.test.mjs`, `tests/paperBridge.test.mjs` (~450 total) | ~810 + tests |
| WS2 Interaction | `js/store.js` 300, `js/app.js` 300, `js/snap.js` 110, `js/hit.js` 60, `js/overlay.js` 60, `js/tools/select.js` 240, `js/tools/node.js` 180, `js/tools/pen.js` 110, `js/tools/pencil.js` 50, `js/tools/shape.js` 100 | ~1,450 |
| WS3 Shell | `index.html` 450 (incl. CSS), `js/ui.js` 380, `js/io.js` 180, `js/assist.js` 120 | ~1,130 |

All paths are relative to `artifact/`. Never edit another workstream's files. Never edit anything outside `artifact/`.

---

## Data model

All coordinates are in artboard units, with the origin at the top-left and y pointing down.

```js
Node    = { x, y, hi: {x,y}|null, ho: {x,y}|null }   // ABSOLUTE handle positions; null = no handle (the segment uses the anchor itself)
Contour = { closed: boolean, nodes: Node[] }
Item    = { id: string, name: string, contours: Contour[],
            fill: string|null,            // '#rrggbb' or null (no fill)
            stroke: string|null, strokeWidth: number,
            cap: 'butt'|'round'|'square', join: 'miter'|'round'|'bevel',
            fillRule: 'nonzero'|'evenodd',
            op: 'add'|'cut',
            opacity: number,              // 0..1
            visible: boolean, locked: boolean }
Doc     = { v: 1, w: number, h: number, items: Item[] }   // items[0] is the BOTTOM of the stack
Rect = {x, y, w, h}    Vec = {x, y}    Mat = [a, b, c, d, e, f]   // like SVG matrix(a b c d e f): x' = a*x + c*y + e, y' = b*x + d*y + f
```

**Docs are immutable.** Every function returns new objects, never mutates its inputs, and shares unchanged substructure (an untouched item keeps the same object reference). History stores doc references.

A segment `i` of a contour runs from `nodes[i]` to `nodes[(i+1) % n]`. Its cubic is `[a, a.ho ?? a, b.hi ?? b, b]`. An open contour has `n−1` segments and a closed one has `n`.

---

## WS1 Core

### `js/consts.js`
```js
export const TOOLS = [ {id:'select',key:'v',label:'Select'}, {id:'node',key:'a',label:'Edit points'},
  {id:'pen',key:'p',label:'Pen'}, {id:'pencil',key:'n',label:'Pencil'}, {id:'rect',key:'r',label:'Rectangle'},
  {id:'ellipse',key:'e',label:'Ellipse'}, {id:'polygon',key:'y',label:'Polygon'}, {id:'line',key:'l',label:'Line'} ]
export const ARTBOARDS = [ {id:'icon',label:'Icon',w:24,h:24}, {id:'square',label:'Square',w:512,h:512},
  {id:'large',label:'Large',w:1024,h:1024}, {id:'wide',label:'Wide',w:1920,h:1080} ]
export const LIMITS = { zoomMin: 0.05, zoomMax: 64, artboardMin: 1, artboardMax: 8192, history: 200,
  maxItems: 500, assistPaths: 40, assistNodes: 2000 }
export const DEFAULT_STYLE = { fill:'#16181d', stroke:null, strokeWidth:2, cap:'round', join:'round',
  fillRule:'nonzero', opacity:1 }
export const ACCENT = '#384ecb'
export const STORAGE = { doc: 'marque.doc.v1', prefs: 'marque.prefs.v1' }
export function gridFor(w, h)   // 2 ** round(log2(max(1, max(w,h)/64))) → 24→1, 512→8, 1024→16, 1920→32
```

### `js/model.js`
```js
export function uid(): string                       // short random id, e.g. 'i' + base36
export function makeNode(x, y, hi = null, ho = null): Node
export function makeItem(contours, style = {}, name = 'Path'): Item
   // Merges DEFAULT_STYLE with style. If EVERY contour is open and style.stroke is null:
   // fill = null, stroke = (style.fill ?? DEFAULT_STYLE.fill), strokeWidth = max(2, style.strokeWidth ?? 2)
   // (so lines, open pen paths and pencil strokes are visible). op defaults to 'add', visible true, locked false.
export function makeDoc({ w = 512, h = 512, items = [] } = {}): Doc
export function exampleDoc(): Doc        // see "Example drawing" below
export function sanitizeItem(raw): Item|null   // never throws; returns null if no contour survives; drops nodes with non-finite numbers and contours with < 2 nodes; bad enums → defaults; clamps opacity 0..1, strokeWidth ≥ 0; fresh id if missing
export function sanitizeDoc(raw): Doc|null     // clamps w,h to [artboardMin, artboardMax]; caps items at LIMITS.maxItems
export function serializeDoc(doc): string      // JSON
export function parseDoc(text): Doc|null       // JSON.parse + sanitizeDoc, never throws
export function findItem(doc, id): Item|undefined
export function itemIndex(doc, id): number     // -1 if missing
export function addItems(doc, items, index = doc.items.length): Doc
   // Inserts at the index (default: top). Names are made unique against existing names: 'Rectangle' → 'Rectangle 2'.
export function updateItems(doc, ids, patchOrFn): Doc   // patch object merged, or fn(item) → item
export function replaceItems(doc, items): Doc           // swap items with the same id
export function removeItems(doc, ids): Doc
export function reorder(doc, ids, to: 'front'|'back'|'forward'|'backward'): Doc   // keeps the relative order of the moved ids
export function reorderTo(doc, id, index): Doc
export function duplicateItems(doc, ids, offset = 16): { doc, ids }   // copies go directly above the top-most source, offset by (+offset, +offset), new ids, names "X copy"
export function setArtboard(doc, w, h): Doc     // clamped
```

### `js/geometry.js` (pure)
```js
export const mat = { identity(), multiply(a, b) /* a∘b: apply b then a */, translate(dx, dy), scale(sx, sy, cx = 0, cy = 0),
                     rotate(rad, cx = 0, cy = 0), invert(m), apply(m, p) → Vec }
export function contourBounds(c): Rect|null     // exact cubic extrema (solve derivative roots), ignores stroke
export function itemBounds(item): Rect|null
export function boundsOf(items): Rect|null      // union
export function transformContours(contours, m): Contour[]   // transforms anchors and handles
export function transformItem(item, m): Item               // also scales strokeWidth by sqrt(|det m|)
export function segmentCount(c): number
export function segmentCubic(c, i): [Vec, Vec, Vec, Vec]
export function flattenContour(c, tol = 0.25): Vec[]       // polyline approximation; closed contours do not repeat the first point
export function nearestOnContour(c, p): { seg, t, point, dist }
export function nearestOnItem(item, p): { ci, seg, t, point, dist } | null
export function insertNode(c, seg, t): Contour   // de Casteljau split, so the curve shape is unchanged
export function removeNode(c, i): Contour        // keeps the neighbours' outer handles
export function isSmooth(node): boolean          // both handles present and collinear through the anchor (within ~2°)
export function setSmooth(c, i, smooth): Contour // smooth: create or align handles (length = 1/3 of the neighbour chords, along the tangent of prev→next); corner: hi = ho = null
export function moveNode(c, i, p): Contour       // handles travel with the anchor
export function moveHandle(c, i, which /* 'hi'|'ho' */, p, { mirror = true } = {}): Contour
   // if mirror and the node isSmooth: the opposite handle stays collinear and keeps its length
export function dragRect(a, b, { square = false, center = false } = {}): Rect   // normalised, w/h ≥ 0
export function constrain45(from, to): Vec
export function rectContours(x, y, w, h, r = 0): Contour[]     // r clamped to min(w,h)/2; r = 0 gives 4 corner nodes; r > 0 gives 8 nodes with κ arcs
export function ellipseContours(cx, cy, rx, ry): Contour[]      // 4 nodes, κ = 0.5523, clockwise starting at the top
export function polygonContours(cx, cy, rx, ry, sides, { star = false, inner = 0.5, rotation = -Math.PI / 2 } = {}): Contour[]
   // sides clamped 3..24; a star has 2*sides nodes alternating r and r*inner
export function lineContours(a, b): Contour[]                   // one open contour of 2 nodes
export function contoursToD(contours, precision = 2): string
   // 'M x y' then 'L' or 'C' per segment, 'Z' for closed. Numbers are rounded to `precision` with trailing zeros stripped; '-0' becomes '0'.
```

### `js/render.js` (pure, returns strings)
```js
export function renderBody(doc, { clip = false, precision = 2, ids = false } = {}): string
   // '<defs>…masks…</defs>' + the stack markup. No <svg> wrapper.
export function renderSvg(doc, { background = null, precision = 2, pretty = true } = {}): string
   // '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">' + optional background rect + renderBody(doc, {clip: true}) + '</svg>'
```
**Algorithm.** Walk the **visible** items from bottom to top, keeping a string accumulator `acc`.

- **`add`:** `acc += pathEl(item)`, where `pathEl` is `<path d="…" fill="#…|none" fill-rule="…" stroke="#…" stroke-width stroke-linecap stroke-linejoin opacity>`.
  - Omit attributes that equal SVG defaults.
  - With `ids: true`, add `data-id="{id}"`.
- **`cut`:**
  - If `acc` is empty, skip it. Nothing is beneath it.
  - Otherwise emit `<mask id="mk{n}" maskUnits="userSpaceOnUse" x y width height>` into the defs.
  - The mask holds a white rect covering the region, then the cut shape painted **black**. Paint the fill if `fill !== null`, and the stroke (black, same width, cap and join) if `stroke !== null`. The cut's colours and opacity are ignored.
  - Then set `acc = '<g mask="url(#mk{n})">' + acc + '</g>'`.
  - The region is the artboard when `clip` is set, else a ±50000 box so off-artboard content stays visible in the editor.
- Mask ids are numbered from 0 in each call, so the output is deterministic.

### `js/paperBridge.js`
```js
export function createBridge(paper /* the Paper.js namespace, or null */): Bridge
Bridge = {
  available: boolean,                        // false when paper is null; every method then throws {code:'unavailable'}
  parsePathData(d): Contour[],               // throws on invalid; handles relative commands, arcs, H/V/S/T (Paper does it)
  booleanOp(items, kind: 'union'|'subtract'|'intersect'|'exclude'): Contour[],   // items in stack order; subtract = items[0] minus all the others; [] if empty
  flatten(items): { contours, warnings },    // ordered fold over VISIBLE items: add → unite, cut → subtract (skipped when nothing is beneath)
  simplify(points: Vec[], { tolerance = 2.5, close = false } = {}): Contour|null,   // Paper Path.simplify; null if < 2 points
  importSvg(text): { items: Item[], width, height, skipped: number },   // browser only (needs DOMParser); throws {code:'unsupported'} if unavailable
  area(contours): number                     // absolute filled area (nonzero), for tests
}
```
- Use one private `new paper.PaperScope()` with `scope.setup(new scope.Size(1, 1))`. `activate()` it at the start of each call, and `scope.project.clear()` afterwards, inside try/finally.
- Paper's segment handles are **relative** to the anchor. Convert to and from our absolute handles only in this file. Zero-length handles become `null`.
- `importSvg` uses `scope.project.importSVG(text, {expandShapes: true, insert: true})`.
  - Walk every `Path`/`CompoundPath`, baking `globalMatrix` into the geometry.
  - Take `fillColor`/`strokeColor` as `#rrggbb` (null if missing or not flat), plus `strokeWidth`, `opacity` and `fillRule` (when `evenodd`).
  - Names come from the SVG `id` if present, else 'Path'.
  - Skip clip paths and anything else, counting it in `skipped`.
  - Width and height come from the root `viewBox` or the width/height attributes, else the bounds.

### Tests (`node --test artifact/tests/*.test.mjs`, from the repo root)
- **Model:** defaults; `sanitize` rejects NaN and bad enums; deep-freeze the inputs and assert immutability; JSON round-trip; unique names; `reorder` and `duplicate`.
- **Geometry:** ellipse bounds equal the radii; a 90° rotation swaps the bounds; `insertNode` keeps the point at t; `setSmooth` gives collinear handles; node counts for rect (4, and 8 with radius) and a 5-point star (10); `dragRect` square/center; the `contoursToD` format.
- **Render:**
  - add, cut, add gives exactly 1 mask, with the last add outside the masked group;
  - two cuts nest;
  - a leading cut is dropped;
  - hidden items are skipped;
  - output is deterministic;
  - `renderSvg` has `viewBox`.
- **Bridge** (`import paper from 'paper'`, then `createBridge(paper)`; skip the file gracefully if the import fails):
  - analytic areas for union, subtract, intersect and exclude of two squares;
  - `flatten([add A, cut B, add C])` area matches the expectation;
  - `simplify` of a noisy circle gives at most 16 nodes and is closed when `close` is set;
  - parsing a `d` string round-trips absolute handles.

---

## WS2 Interaction

### `js/store.js`
```js
export function createStore({ bridge }): Store
Store = {
  getState(): State,
  subscribe(fn: (state, prev) => void): () => void,   // synchronous notify after every change
  dispatch(type: string, payload?: object): void,
  // Gesture API, used by tools for drags: many transient doc updates become ONE undo step
  begin(): void,            // remembers the base doc and selection
  setDoc(doc): void,        // transient, no history
  commit(label, coalesceKey?): void,   // pushes the base onto undo if the doc changed; merges with the previous entry if the same coalesceKey within 1000 ms
  cancel(): void            // restores the base
}
State = {
  doc: Doc,
  selection: string[],                      // item ids
  tool: 'select'|'node'|'pen'|'pencil'|'rect'|'ellipse'|'polygon'|'line',
  live: null | { id, kind: 'rect'|'ellipse'|'polygon', box: Rect, params: {radius, sides, star, inner}, contours },
  toolOpts: { radius: 0, sides: 5, star: false, inner: 0.5 },
  style: { fill, stroke, strokeWidth, cap, join, fillRule, opacity },   // the style for NEW items, starts as DEFAULT_STYLE
  viewport: { zoom: 1, panX: 0, panY: 0, w: 0, h: 0, fitted: false },  // screen = doc * zoom + pan; w/h = #canvas-host size in px
  ui: { grid: false, snap: true, theme: 'system'|'light'|'dark', sheet: null|'inspector'|'layers',
        panel: null|'export'|'artboard', toast: null|{id, text}, example: false,
        assist: 'unknown'|'available'|'hidden', busy: null|string },
  history: { canUndo: boolean, canRedo: boolean }
}
```
**Actions** (`dispatch(type, payload)`). Each doc-changing action is exactly one undo step, and any undo step clears `ui.example`.

| Type | Payload | Effect |
|---|---|---|
| `newDoc` | `{w?, h?}` | Fresh empty doc (keeps the current w/h if omitted). Clears the selection and `live`. Undoable. Toast "New drawing. Undo brings the old one back." |
| `loadDoc` | `{doc, example?}` | Replaces the doc and **resets history** (not undoable). `ui.example = !!example`. Then zoomFit. |
| `setArtboard` | `{w, h}` | Then zoomFit. |
| `addItems` | `{items, select = true, fit = false, live?}` | `fit`: if the items' bounds exceed the artboard, scale them down uniformly to fit with 8% margin, then centre them. `live: {kind, box, params}` makes the first item live. |
| `updateItems` | `{ids?, patch, coalesce?}` | `ids` defaults to the selection. `coalesce` is passed to commit as the key, used for inspector scrubbing. |
| `deleteItems` / `duplicateItems` | `{ids?}` | `ids` defaults to the selection. Duplicate selects the copies. |
| `reorder` | `{ids?, to}` | `to` is `'front'`, `'back'`, `'forward'` or `'backward'`. |
| `reorderTo` | `{id, index}` | |
| `setBounds` | `{x?, y?, w?, h?}` | Moves and/or scales the selection so its union bounds match. Missing keys keep their current value. |
| `flip` | `{axis: 'x'\|'y'}` | Mirrors the selection about its bounds centre. |
| `rotate` | `{deg}` | Rotates the selection about its bounds centre. |
| `booleanOp` | `{kind}` | Needs 2 or more selected. The result replaces the sources at the bottom-most source's index, takes the bottom-most source's style with `fillRule: 'evenodd'` and the name `'Union'` etc., and is selected. If Paper is unavailable, toast "Boolean operations need Paper.js, which did not load." |
| `flatten` | `{}` | Selection, 2 or more: one item via `bridge.flatten`, with the fill of the top-most add, at the bottom-most index. |
| `setLive` | `{params}` | Regenerates the live item's contours from `live.box` and the new params (rect gets `radius`; polygon gets `sides`, `star`, `inner`). Coalesced by key `'live'`. |
| `select` | `{ids, mode = 'set'}` | `mode` is `'set'`, `'add'` or `'toggle'`. Ignores locked and hidden ids. |
| `selectAll` / `clearSelection` | | |
| `setTool` | `{id}` | |
| `setToolOpt` | `{key, value}` | |
| `setStyle` | `{patch}` | Updates the style for new items. If something is selected, ui.js ALSO dispatches `updateItems`. |
| `setViewport` | `{…partial}` | |
| `zoomBy` | `{factor, cx, cy}` | Keeps the screen point (cx, cy) fixed. Clamped to `LIMITS`. |
| `zoomTo` | `{zoom}` | Keeps the centre of the host fixed. |
| `zoomFit` | `{}` | Fits the artboard into the viewport with padding `fitPad` (see app.js). |
| `panBy` | `{dx, dy}` | |
| `setUI` | `{…partial ui}` | |
| `toast` | `{text}` | Sets `ui.toast = {id: n++, text}`. ui.js clears it after 2.4 s. |
| `undo` / `redo` | | History entries are `{doc, selection}`. Capped at `LIMITS.history`. |

`live` is cleared when the selection changes, or when `findItem(doc, live.id)?.contours !== live.contours` (the item was edited by other means).

### Tools: `js/tools/*.js`

Each tool module **default-exports** a factory. `select.js`, `node.js`, `pen.js` and `pencil.js` export `create(ctx)`. `shape.js` exports `create(ctx, kind)`, where `kind` is `'rect'`, `'ellipse'`, `'polygon'` or `'line'`.

```js
Tool = {
  id, cursor: string /* CSS cursor */, hint(): string,
  activate?(), deactivate?() /* commit or clean up drafts */, cancel?() /* abort the current gesture */,
  onPointerDown(e), onPointerMove(e) /* called with e.down false for hover */, onPointerUp(e),
  onDoubleClick?(e), onKeyDown?(ke): boolean /* true = handled */, onKeyUp?(ke),
  renderOverlay(): string     // SVG markup in SCREEN px (relative to #canvas-host), using the overlay.js helpers
}
PointerEvt = { x, y /* doc units, unsnapped */, sx, sy /* screen px relative to #canvas-host */,
               shift, alt, meta /* metaKey || ctrlKey */, button, down: boolean, pointerType, detail /* click count */ }
ctx = { store, bridge, getState: store.getState,
        view: { toDoc(sx, sy) → Vec, toScreen(x, y) → Vec, zoom() → number },
        hit:  { item(p, tolPx = 4) → id|null, itemsInRect(rect) → ids },
        snap,                 // snap.js instance
        px(e) → number,       // hit tolerance in screen px: 8 for mouse/pen, 16 for touch
        newItem(contours, name, extra = {}) → Item,   // makeItem with state.style, plus extra (e.g. {fill:null})
        requestOverlay(),     // schedule an overlay redraw
        setCursor(css) }
```
- **select** (V):
  - Pointing: click selects the topmost item (shift toggles); a drag on empty space draws a marquee (shift adds); a drag on a selected item moves the selection, snapped via `snap.bbox`.
  - Scaling: 8 square handles on the selection bbox. Shift keeps proportions and alt scales from the centre.
  - Rotating: just outside a corner (8–24 px), the cursor shows rotate. Shift snaps to 15° steps.
  - Everything bakes into geometry with `transformItem`, and each gesture is begin, setDoc, then commit.
  - The overlay shows outlines of the selected items, the bbox, the handles and the marquee.
  - Double-click on an item switches to `node` with that item selected.
  - Arrow keys nudge by 1, or 10 with shift. Arrows are coalesced by key `'nudge'`.
- **node** (A):
  - Shows the anchors and handles of the selected items. Clicking a non-selected item selects it.
  - Click an anchor to select it (shift adds), then drag the selected anchors. Drag a handle with `moveHandle` (alt breaks the mirroring).
  - Alt-click an anchor toggles smooth/corner. Double-click a segment inserts a node at the nearest t.
  - Delete or Backspace removes the selected anchors. A contour with fewer than 2 nodes is dropped, and an item with no contours is deleted.
  - Arrows nudge the selected anchors. Esc clears the node selection, then switches to select.
- **pen** (P):
  - Click adds a corner node; press-and-drag sets a smooth node (`ho` = pointer, `hi` = mirror).
  - Clicking the first node (within `px`) closes the path and commits it. Enter, Esc, or switching tool commits an open path of 2 or more nodes, else discards it.
  - Shift constrains to 45°. The overlay shows the path so far plus a rubber band to the pointer.
  - The tool stays active after commit.
- **pencil** (N):
  - Collects doc points while down; the overlay shows the polyline.
  - On up it calls `bridge.simplify(points, {tolerance: 2.5 / zoom, close})`, where `close` is true when the end is within 12 screen px of the start.
  - A closed result becomes a filled item and an open result a stroked one (`makeItem` rule). The tool stays active.
- **shape** (R, E, Y, L):
  - Drag to draw via `dragRect` (shift = square/circle, alt = from centre). Line uses `constrain45` with shift.
  - A click without a drag (< 3 px) creates a default shape of 25% of min(w, h), centred on the click.
  - On release, dispatch `addItems{items:[item], select:true, live:{kind, box, params: state.toolOpts}}` (no live for line), then `setTool{id:'select'}`.
  - Snaps the drag points via `snap.point`.

### `js/overlay.js`
Small string helpers that emit SVG with **class names** only, never colours. WS3 styles these classes in `index.html`.
```js
export function outline(contoursScreen, cls = 'ov-outline'): string     // <path class=…>
export function box(rect, cls = 'ov-bbox'): string
export function handle(x, y, cls = 'ov-handle'): string                 // 8×8 square centred on the point
export function anchor(x, y, selected = false): string                  // class 'ov-anchor' (+ ' is-selected')
export function ctrl(x, y): string                                      // circle r=3.5, class 'ov-ctrl'
export function line(a, b, cls = 'ov-ctrl-line'): string
export function toScreenContours(contours, viewport): Contour[]         // transformContours with [zoom,0,0,zoom,panX,panY]
```
The classes are `ov-outline`, `ov-bbox`, `ov-handle`, `ov-anchor`, `ov-anchor is-selected`, `ov-ctrl`, `ov-ctrl-line`, `ov-guide`, `ov-ghost` (dashed outline of a cut item), `ov-marquee`, `ov-preview` (pen, pencil and shape previews) and `ov-rubber`.

### `js/snap.js`
```js
export function createSnap(ctx): {
  setTargets(excludeIds = []),   // call at gesture start: collects anchors, bbox edges and centres of the other visible items, plus the artboard edges and centre
  point(p, { meta = false } = {}) → Vec,          // snapped point (grid if ui.grid, then targets if ui.snap); meta bypasses
  bbox(rect, dx, dy, { meta = false } = {}) → {dx, dy},   // snaps the moved box's edges and centre on x and y independently
  guidesSvg() → string,          // screen-space ov-guide lines for the last snap (empty if none)
  clear()
}
```
The threshold is `6 / zoom` doc units. The grid size is `gridFor(doc.w, doc.h)`.

### `js/hit.js`
```js
export function createHit(getState): { item(p, tolPx = 4) → id|null, itemsInRect(rect) → id[] }
```
It uses an offscreen canvas 2D context with `new Path2D(contoursToD(item.contours, 3))` in doc coordinates.
- It tests from the topmost item down and skips hidden and locked items.
- A fill hit (`isPointInPath(path, x, y, fillRule)`) counts when `fill !== null` or the item is a cut.
- A stroke hit (`isPointInStroke`) uses `lineWidth = max(strokeWidth, 2 * tolPx / zoom)`.
- `itemsInRect` returns the ids whose bounds intersect the rect.

### `js/app.js` (entry module, the only `<script type="module">`)
On load it does the following:

1. **Boot.**
   - `bridge = createBridge(window.paper ?? null)` and `store = createStore({bridge})`.
   - Create the tools (`select`, `node`, `pen`, `pencil`, and `shape` × 4), plus `snap` and `hit`.
2. **Mount and start.**
   - Call `mountUI({store, bridge, io, assist})`, then `io.bindGlobalIO({store, bridge})`.
   - Prefs are `io.prefs.load()`, which returns `{grid, snap, theme}` or `{}`; apply them via `setUI`.
   - Dispatch `loadDoc({doc: io.autosave.load() ?? exampleDoc(), example: !saved})`.
3. **Persist.**
   - Subscribe so that when the `doc` reference changes and `!ui.example`, it calls `io.autosave.save(doc)`.
   - When `ui.grid`, `ui.snap` or `ui.theme` change, it calls `io.prefs.save(...)`.
4. **Viewport.**
   - A ResizeObserver on `#canvas-host` dispatches `setViewport({w, h})`. The first time both are non-zero, it calls zoomFit.
   - `fitPad` is `parseFloat(getComputedStyle(host).getPropertyValue('--fit-pad')) || 48`.
5. **Render loop** (rAF, only when something changed):
   - `#doc.innerHTML = renderBody(doc, {ids: true})`, only when the doc reference changed.
   - `#viewport` gets `transform="translate(panX panY) scale(zoom)"`.
   - `#artboard` gets `width`/`height` equal to `doc.w`/`doc.h`.
   - `#grid` has the same size and is hidden unless `ui.grid` and `grid * zoom ≥ 6`. Its `fill` is `url(#grid-pattern)`. Update `#grid-pattern` `width`/`height` and the `#grid-path` `d` and stroke-width (`1 / zoom`).
   - `#overlay-layer.innerHTML` is built from: dashed `ov-ghost` outlines of the visible cut items (screen space), then `tool.renderOverlay()`, then `snap.guidesSvg()`.
6. **Hint.** `#hint` text is set by app.js. When `ui.example` is set it reads "This is an example. Press New to start your own." Otherwise it is `tool.hint()`.
7. **Pointer and wheel** on `#canvas-host`:
   - Pointer capture is taken on down.
   - Middle button, or Space held, pans.
   - A second touch pointer cancels the tool gesture (`tool.cancel()`), and two pointers pinch-zoom and pan.
   - `dblclick` goes to `tool.onDoubleClick`.
   - Wheel:
     - ctrlKey or metaKey (pinch) zooms by `exp(−deltaY * 0.01)` around the pointer.
     - With no modifier and a non-zero `deltaX`, or a pixel-mode trackpad, it pans.
     - A line-mode wheel (`deltaMode === 1`) zooms.
   - Always `preventDefault`.
8. **Keyboard** (window keydown):
   - Ignored when the target is an `input`, `textarea`, `select` or contenteditable, except Esc, which blurs.
   - The active tool's `onKeyDown` gets first refusal.
   - Then this map applies (meta = Cmd or Ctrl):
     ```
     V A P N R E Y L → setTool          X → toggle op add/cut on the selection     G → grid      S → snap (no meta)
     Esc → close ui.panel/ui.sheet if open, else tool.cancel(), else clearSelection, else setTool select
     Delete/Backspace → deleteItems     meta+Z undo · meta+shift+Z / meta+Y redo    meta+A selectAll   meta+D duplicate
     [ / ] → backward/forward            meta+[ / meta+] → back/front
     meta+0 zoomFit · meta+1 zoomTo 1 · meta+= / meta+- zoomBy 1.25 / 0.8 (around the host centre)
     meta+E → setUI {panel:'export'}     / → focus #describe-input (if visible)     Space (held) → pan mode
     ```
9. **Test handle.** Expose `window.__marque = { store, bridge, io, assist, view }`.

---

## WS3 Shell

### `index.html`
Elements appear in this order:
1. `<title>Marque</title>`.
2. A Google Fonts `<link>` for Geist (400, 500, 600) and Geist Mono (400, 500). Give both a fallback stack.
3. `<style>`.
4. Markup.
5. `<script src="https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js"></script>`, then `<script type="module" src="js/app.js"></script>`.

**Required ids and structure.** WS2 binds these exactly.
```html
<div id="canvas-host" style="--fit-pad: …">        <!-- position:relative; overflow:hidden; touch-action:none; user-select:none -->
  <svg id="doc-layer">                              <!-- position:absolute; inset:0; width:100%; height:100% -->
    <defs><pattern id="grid-pattern" patternUnits="userSpaceOnUse" width="8" height="8"><path id="grid-path" d="M 8 0 L 0 0 0 8" fill="none"/></pattern></defs>
    <g id="viewport"><rect id="artboard" x="0" y="0"/><rect id="grid" x="0" y="0"/><g id="doc"></g></g>
  </svg>
  <svg id="overlay-layer"></svg>                    <!-- position:absolute; inset:0; width:100%; height:100%; pointer-events:none -->
</div>
<p id="hint" aria-live="polite"></p>
<input type="file" id="file-input" accept=".svg,image/svg+xml" hidden>
<input id="describe-input" …>                       <!-- inside the Describe bar -->
```
- `#artboard` is always white paper (`fill:#fff`) with a hairline ring and a soft shadow (use CSS `filter: drop-shadow` on the rect, or a sibling). Its look must not change with the theme, because the artboard is the drawing.
- `#grid-path` uses a stroke of a faint cool grey.
- The overlay classes from overlay.js are styled here:
  - `ov-outline`, `ov-bbox` and `ov-preview` use `stroke: var(--accent)`, `fill: none`, at 1 to 1.5 px.
  - `ov-handle` and `ov-anchor` have a white fill and an accent stroke; `ov-anchor.is-selected` is filled with the accent.
  - `ov-ctrl` and `ov-ctrl-line` are accent, with thinner lines.
  - `ov-guide` is a magenta-ish hairline (`--guide`).
  - `ov-ghost` is accent, dashed `4 3`, at 45% opacity.
  - `ov-marquee` has an accent stroke and an 8% accent fill.
  - `ov-rubber` is dashed.
- All other markup belongs to WS3. Use the `data-tool="{id}"`, `data-action="…"` and `data-id` attributes as you like, and wire them in ui.js.

**Design direction: fresh editorial minimal.**
- References are Linear, Vercel and Stripe restraint. Use generous whitespace and strong but small type hierarchy.
- The artboard is the hero. Use one accent, `#384ecb`, for selection, focus and the primary action only.
- Use cool neutrals, not warm cream.
- Floating panels use subtle glass (`backdrop-filter: blur(16px) saturate(1.4)` on a translucent surface token) with a hairline border.
- Every colour is a token, defined in three places:
  - bare `:root` (light);
  - `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { …; color-scheme: dark } }`;
  - `:root[data-theme="dark"] { … }`.
  `body` gets `background: var(--bg)` explicitly.
- Write a short layout comment and the token plan at the top of `<style>`.
- Wordmark: lowercase **marque** in Geist 600, tracking −0.03em.
- Figures that change use Geist Mono with tabular numerals.
- `:focus-visible` gets a 2 px accent ring.
- Under `prefers-reduced-motion`, transitions are off.
- Micro-interactions are 120–200 ms ease-out. Panels fade in and rise 3 px.

**Layout.** Use `html, body { height: 100% }` (not `100vh`). The app is a full-height grid.
- **Desktop (above 720 px):**
  - A slim top bar holds:
    - the wordmark;
    - New and Import;
    - Undo and Redo;
    - the artboard chip "512 × 512", which opens the artboard popover;
    - the zoom readout "100%" (click to fit);
    - grid and snap toggles;
    - the theme toggle;
    - the primary **Export** button.
  - Below it, `#canvas-host` fills the remaining space.
  - A floating vertical glass tool rail sits over the canvas's left edge. Set `--fit-pad` large enough that the fitted artboard clears it, about 88 px.
  - A floating glass right column (about 272 px) holds the Inspector card and the Layers card. It scrolls if tall. Leave room for it: either `#canvas-host` ends before it, or `--fit-pad` accounts for it. Prefer giving the right column its own grid column, so the canvas is the free area and the tool rail floats.
  - The Describe bar floats at the bottom centre of the canvas, with `#hint` just above it, small and muted.
- **Mobile (720 px and below; must work at 400 px with no horizontal scroll):**
  - The top bar is compact: wordmark, undo, redo, Inspector and Layers sheet toggles, and Export. Overflow actions go in a "More" popover.
  - The tool bar is fixed at the bottom: 8 tools, 44 px targets, padded with `env(safe-area-inset-bottom)`.
  - Inspector and Layers are bottom sheets driven by `ui.sheet`.
  - The Describe bar sits above the tool bar.
  - `--fit-pad` is about 20 px.
- **Icons:** draw them inline as SVG, 18–20 px, 1.5 px stroke, `currentColor`. Each tool button gets `aria-label` "Rectangle (R)" and a tooltip-style `title`.

### `js/ui.js`
```js
export function mountUI({ store, bridge, io, assist }): { destroy() }
```
- Renders everything outside `#canvas-host` from `store.getState()` via `subscribe`, batched in rAF. Updates only what changed; it's fine to re-render small panels wholesale with innerHTML, but keep focus stable: don't re-render an input the user is typing in.
- Owns **all** chrome events and changes state only through `store.dispatch`. No direct DOM writes into `#canvas-host`.
- **Toolbar:** buttons `data-tool` get `aria-pressed`, and a click dispatches `setTool`.
- **Inspector** (contextual):
  - *Nothing selected:* "New shapes" style (fill, stroke, width), the artboard size, and the tool options for the current tool (rect radius; polygon sides, star and inner).
  - *Something selected:* X, Y, W and H numeric fields (from `boundsOf`, which you import from `geometry.js`), dispatching `setBounds`.
    - Rotate 90°, flip horizontally and flip vertically.
    - Fill: colour input, hex text and a "None" toggle. Stroke: colour, hex, None, plus width, cap and join.
    - The **Add / Cut** segmented control (`updateItems {patch: {op}}`).
    - Opacity (0–100%) and fill rule.
    - When `state.live` is the selected item: live params (Corner radius for rect; Sides, Star and Inner for polygon) dispatching `setLive`.
    - Arrange (front, forward, backward, back), Duplicate and Delete.
  - *Two or more selected:* a Combine row with Union, Subtract, Intersect, Exclude and Flatten.
  - Scrubbing inputs use `coalesce` keys such as `'fill'` and `'sw'`, so one drag of a colour picker is one undo step.
- **Layers:** a list from top to bottom (reverse of `doc.items`).
  - Each row shows an add or cut glyph (solid square vs dashed hollow square), the name (double-click to rename inline), an eye toggle and a lock toggle.
  - Click selects; shift-click toggles.
  - Rows are buttons or `role="option"` inside `role="listbox"`, with aria labels.
  - The empty state reads "Nothing here yet. Pick a tool and draw on the artboard."
- **Artboard popover:** presets from `ARTBOARDS` showing "512 × 512", plus custom W × H fields and an Apply button.
- **Export popover:**
  - Format SVG or PNG. PNG offers scale 1×, 2× or 4×. SVG offers "Flatten to one path". Background: transparent or white.
  - Buttons are "Save SVG" or "Save PNG", plus "Copy SVG".
  - **Saving:** "Save" calls `io.saveFile`. When it returns `{ok:false, fallback:'copy'}`, show the SVG in a selectable read-only textarea with a short note: "Saving files isn't available here. Copy the SVG instead."
  - **Copying:** "Copy SVG" calls `io.copyText(svg)` **synchronously in the click handler**. Toast "Copied", or show the textarea if it fails.
  - Use `io.exportSvgString(doc, {flatten, background, bridge})`.
- **Top-bar buttons:**
  - New dispatches `newDoc`.
  - Import clicks `#file-input`.
  - Undo and Redo are disabled via `history`.
  - The zoom readout shows `Math.round(zoom * 100) + '%'` and dispatches `zoomFit` on click.
  - Grid and snap use `aria-pressed`.
  - Theme cycles system, light and dark: it sets `document.documentElement.dataset.theme`, or removes it for system, and dispatches `setUI{theme}`.
- **Toasts:** a polite live region, cleared after 2.4 s.
- **Describe bar:**
  - It is visible only when `ui.assist === 'available'`, and holds `#describe-input`, a "Draw" button and a status line.
  - **Boot:** `assist.getSample().then(s => dispatch('setUI', {assist: s ? 'available' : 'hidden'}))`.
  - **On submit:**
    1. `ui.busy = 'describe'`. The button turns into **Stop**, which aborts a fresh AbortController, and the status reads "Thinking…" until the first `onText`, then "Drawing…".
    2. Call `assist.describe(...)`, then `dispatch('addItems', {items, select: true, fit: true})` and toast `Added N paths`.
    3. On error, use `assist.errorInfo(err)`. If `hide`, set `assist: 'hidden'`; otherwise show the message. A `cancelled` error stays silent.
- **Escape** closes popovers and sheets. app.js also handles Esc globally via `ui.panel`/`ui.sheet`. Clicking outside a popover closes it.

### `js/io.js`
```js
export async function getDownloads(): Promise<cap|null>   // memoised; window.claude?.use ? race(use('downloads'), 10500 ms → null) : null
export function exportSvgString(doc, { flatten = false, background = null, bridge = null } = {}): string
   // flatten && bridge?.available → one <path> (the fill of the top-most add) built from bridge.flatten(visible items); else renderSvg(doc, {background})
export async function rasterize(doc, scale = 1, { background = null } = {}): Promise<Blob>
   // data:image/svg+xml;charset=utf-8,… → Image → canvas (w*scale, h*scale, larger side clamped to 8192) → toBlob('image/png')
export async function saveFile({ filename, data }): Promise<{ok:true} | {ok:false, code, fallback?:'copy'}>
   // no downloads cap → {ok:false, code:'unavailable', fallback:'copy'}; 'declined' → {ok:false, code:'declined'} (silent)
export function copyText(text): Promise<boolean>   // navigator.clipboard.writeText; MUST be called synchronously inside the click handler
export function importSvgText(text, store, bridge): { count, warnings }   // bridge.importSvg → dispatch addItems {select:true, fit:true}; toast on failure
export function bindGlobalIO({ store, bridge }): void
   // paste (text containing '<svg') anywhere outside inputs; drop of .svg files or text on #canvas-host; change on #file-input
export const autosave = { load(): Doc|null, save(doc) /* debounced 400 ms */, clear() }   // STORAGE.doc, all try/catch
export const prefs = { load(): object, save(patch) }                                   // STORAGE.prefs
```
Filenames are `marque-{w}x{h}.svg` and `marque-{w}x{h}@{scale}x.png`.

### `js/assist.js`
The pure functions in this file must stay DOM-free so they can be tested.
```js
export async function getSample(): Promise<fn|null>    // memoised; window.claude?.use ? race(use('sample'), 10500 ms → null) : null
export function buildPrompt(description, { w, h }): string
export function parseAssistResult(json, { w, h, bridge }): { items: Item[], warnings: string[] }
export async function describe({ description, w, h, signal, onText, sample, bridge }): Promise<{ items, warnings }>
   // sample.json(buildPrompt(...), { signal, onText, modelTier: 'default', cache: false })
export function errorInfo(err): { message: string, hide: boolean, silent: boolean }
```
**Prompt** (fill in `<description>`, `<w>` and `<h>`):
```
You are a vector illustrator. Draw: "<description>"
Artboard: <w> × <h> units, origin top-left, y down. Keep the drawing inside it, centred, with an 8% margin.
Reply with JSON only, exactly this shape:
{"paths":[{"name":string,"d":string,"op":"add"|"cut","fill":"#rrggbb"|null,"stroke":"#rrggbb"|null,"strokeWidth":number}]}
Rules:
- "d" uses absolute M L C Q Z commands only; close filled shapes with Z.
- Paths stack bottom to top. "add" paints. "cut" erases only what lies beneath it; a later "add" can paint over the hole.
- Prefer few, bold, well-built shapes: at most 12 paths and 60 segments each. Flat colours, 1 to 4 of them, no gradients.
```
**Validation:**
- Accept `{paths:[…]}` or a bare array, at most `LIMITS.assistPaths`.
- `d` must be a string of at most 20,000 characters, parsed with `bridge.parsePathData` inside try/catch.
- Skip a path if any number is non-finite or its absolute value is beyond `10 × max(w, h)`.
- Total nodes are capped at `LIMITS.assistNodes`.
- Colours must match `/^#[0-9a-f]{3}([0-9a-f]{3})?$/i`, else `null`. `strokeWidth` is clamped to `[0, max(w, h) / 4]`. `op` is `'add'` unless it is `'cut'`. `name` is sliced to 40 characters.
- If a path has neither fill nor stroke, it gets the default fill.
- Build items with `makeItem` (from `model.js`). Skipped paths go into `warnings`.

**`errorInfo`:**

| Code(s) | Behaviour | Message |
|---|---|---|
| `cancelled` | silent | — |
| `not_granted`, `sampling_disabled`, `not_declared`, `capability_disabled`, `capability_removed` | hide | — |
| `rate_limited` | show | "Claude is busy for you right now. Try again in a minute." |
| `session_expired` | show | "Sign in to Claude again, then retry." |
| `refused` | show | "Claude won't draw that one. Try describing it differently." |
| `invalid_json` / `empty_completion` | show | "That drawing came back unreadable. Try again, or ask for fewer shapes." |
| anything else | show | "Something went wrong reaching Claude. Try again." |

---

## Example drawing (`exampleDoc()`)

A 512 × 512 artboard, listed bottom to top. It shows that a cut only affects what is beneath it.

1. **Disc** (`add`): `ellipseContours(256, 256, 208, 208)`, fill `#16181d`.
2. **Window** (`cut`): `ellipseContours(256, 256, 136, 136)`. This turns the disc into a ring.
3. **Slit** (`cut`): a closed 4-node bar with corners (59.5, 427.1), (84.9, 452.5), (452.5, 84.9), (427.1, 59.5), along the 45° diagonal.
4. **Core** (`add`): `ellipseContours(256, 256, 72, 72)`, fill `#384ecb`. It sits above both cuts, so it paints back over the hole and the slit.

---

# v2 addendum: organic and asymmetric shapes

This section extends the contract above and wins wherever the two disagree. The thesis stays the same: every new feature only produces or moves nodes, so the result is always an ordinary editable path. There is no new primitive and no new render path.

The new features are:
- **Blob tool (O):** live Points, Wobble and Smoothness, plus Shuffle.
- **Bend:** drag a segment in the Edit points tool.
- **Push brush (W).**
- **Ink brush (B):** filled, tapered strokes.
- **Organic actions:** Smooth and Roughen, as live ops.
- **Distort:** a Transform toggle. Corners move freely and sides skew.

## Workstream ownership (v2)

| WS | Files (create or edit ONLY these) | LOC budget |
|---|---|---|
| WS-A | `js/organic.js` (new, 230), `tests/organic.test.mjs` (new, 150), `js/tools/brush.js` (new, 60) | ~440 |
| WS-B | `js/store.js` (+45), `js/app.js` (+8), `js/consts.js` (+3), `js/tools/shape.js` (+4), `js/tools/node.js` (+25), `js/tools/select.js` (+45), `js/tools/push.js` (new, 65) | ~195 |
| WS-C | `js/ui.js` (+80), `index.html` (+22), `tests/smoke.mjs` (+90; case 3 becomes `live.targets[0].id`) | ~190 |

- WS-A lands an identity stub of `organic.js` first, with every export present and returning its input or a trivial value, so WS-B and WS-C can import it at once.
- WS-B and WS-C never import each other. They share only the names in this addendum.

## `js/organic.js` (pure; imports only `./geometry.js`)
```js
export const MAX_NODES = 600
export function rng(seed: number|string): () => number    // mulberry32; strings hashed (e.g. FNV-1a); ints pre-mixed; returns [0,1)
export function blobContours(box, { points = 8, wobble = .35, smooth = .55, seed = 1 } = {}): Contour[]
   // N = clamp(round(points), 3, 24). Random start angle; node i at angle start + 2πi/N + jitter(±.35·wobble·2π/N),
   // radius ×(1 + (2u−1)·.6·wobble) on a unit circle. Handles: tangent = (next − prev), handle = ±tangent·.3·smooth
   // (no handles when smooth = 0). Then affine-fit (translate + scale x/y) so contourBounds == box (within 1e-6).
   // One closed contour. Deterministic for a given seed.
export function smoothContours(contours, amount = 1): Contour[]
   // amount ≤ 0 → same reference. Only NON-smooth nodes change: each handle = anchor + (H − anchor)·amount, where H is the
   // handle setSmooth would compute from the ORIGINAL contour (a null handle is treated as the anchor). Anchors never move.
   // Already-smooth nodes are untouched (circles and blobs don't deform). Open-path ends keep only their inward handle.
export function subdivide(c, maxLen, { only = null, cap = MAX_NODES, smoothNew = false } = {}): Contour
   // For each segment where only?.(cubic) !== false, split into ceil(len/maxLen) equal-t pieces via insertNode
   // (len ≈ (chord + control-polygon length)/2). Shape unchanged. Never exceeds cap nodes. Same reference if nothing split.
   // smoothNew: nodes cut from STRAIGHT (handle-less) segments get setSmooth after all splits.
export function roughenContours(contours, { amount = .4, detail = 4, seed = 1 } = {}, size?): Contour[]
   // amount ≤ 0 → same reference. size defaults to max(w,h) of the contours' bounds. Subdivide to maxLen = size/(3+4·detail),
   // then anchor += unitNormal·(2u−1)·amount·size·.08, with handles riding along; u from rng(seed + 7919·ci).
   // Nodes that were smooth are re-smoothed (setSmooth); corner nodes stay corners.
export function bendSegment(c, seg, t, delta): Contour
   // Clamp t to [.15,.85]. If both handles on the segment are null, first set them at the thirds (P1 = lerp(P0,P3,1/3), P2 = lerp(P0,P3,2/3)).
   // k = 1/(3t(1−t)((1−t)²+t²)); P1 += k(1−t)·delta; P2 += k·t·delta, so B(t) moves exactly by delta.
   // If a segment end node was smooth, keep it smooth by rotating its opposite handle (moveHandle with mirror:true).
export function pushContours(contours, center, delta, radius, strength): Contour[]
   // First subdivide(radius/3, { only: segments whose control-point bbox lies within 4·radius/3 of center, smoothNew: true }).
   // Then each anchor and each handle moves by w·delta, w = strength·(1−s²)², s = dist(point, center)/radius, applied only where s < 1
   // (the anchor's weight moves the anchor; each handle uses its own weight). Respect MAX_NODES. Same reference if nothing moves.
export function distortContours(contours, rect, quad): Contour[]
   // quad = [TL, TR, BR, BL]. Projective (Heckbert) map from rect to quad, applied to every anchor and handle.
   // Same reference if rect.w or rect.h is 0, or if !isConvexQuad(quad).
export function isConvexQuad(quad): boolean
export function inkOutline(samples /* {x,y,t?,p?}[] */, { size = 16, thinning = .5, taper = .5, streamline = .5 } = {}): Vec[]
   // Returns a closed polygon (first point not repeated). [] if no samples; 1 sample gives a 16-gon of r = size/2.
   // Streamline: each point = lerp(prev, raw, 1 − .85·streamline).
   // Pressure pr: the p values if they vary by more than .05, else 1 − clamp(speed / (.1·size)), low-passed by .25 (dt defaults to 16 ms).
   // Radius r = (size/2)(1 − thinning(1 − pr)), floored at .05·size.
   // Taper length = taper·min(L/2, 6·size), smoothstep to 0 at both ends.
   // Left side forward, round cap (7 points), right side backward, round cap.
```

## State and actions (`js/store.js`)
- **New `toolOpts` keys:** `{ points: 8, wobble: .35, smooth: .55, seed: 7, brushSize: 16, thinning: .5, taper: .5, pushSize: 80, pushStrength: .7 }`. `brushSize` and `pushSize` are **screen px**.
- **`ui.distort: false`:** cleared by `set()` when the tool or the selection changes.
- **Generalised `live`:** `null | { kind: 'rect'|'ellipse'|'polygon'|'blob'|'smooth'|'roughen', params, targets: [{ id, contours, box?, base?, size? }] }`.
  - Shapes have exactly one target, with a `box`. Their `params` is a snapshot of `toolOpts`.
  - Ops (`smooth`, `roughen`) have one target per selected item. `base` holds the contours when the op started, and `size` is max(w,h) of that item's bounds.
  - `live` goes stale (becomes `null`) when the selection list changes, or when any target's item `contours !== target.contours`.
- **`liveContours(kind, box, p)`** gains `'blob'`, which calls `blobContours(box, p)`.
- **New export `regen(kind, params, target)`:**
  - Shapes give `liveContours(kind, target.box, params)`.
  - `'smooth'` gives `smoothContours(target.base, params.amount)`.
  - `'roughen'` gives `roughenContours(target.base, params, target.size)`.
- **`addItems{ …, live }`** builds `targets`. When the kind is `'blob'`, it also sets `toolOpts.seed = newSeed()`, so the next blob differs.
- **`setLive{ kind?, params }`:**
  - With no kind, or the same kind as `live.kind`: merge the params, regenerate every target, and commit with coalesce key `'live'`.
  - With kind `'smooth'` or `'roughen'` different from the current kind: start a new op from the current selection (no selection means no-op). Defaults are `smooth { amount: 1 }` and `roughen { amount: .4, detail: 4, seed: newSeed() }`. This is its own undo step.
  - If no contours changed, update only `live`.
- **`shuffle{}`:** if `live?.params` has a `seed`, dispatch `setLive{ params: { seed: newSeed() } }`. Otherwise set `toolOpts.seed = newSeed()`.
- **Updated shape tool payload:** `shape.js` still dispatches `addItems{ items, select: true, live: { kind, box, params } }`. The store turns that into `targets`.

## Tools and events
- **`consts.js` TOOLS** gains `{ id: 'push', key: 'w', label: 'Push' }`, `{ id: 'brush', key: 'b', label: 'Ink brush' }` and `{ id: 'blob', key: 'o', label: 'Blob' }`.
- **`PointerEvt`** gains `pressure` (`e.pressure` when `pointerType === 'pen'`, else 0) and `time` (`e.timeStamp`).
- **app.js** creates `brush` (`tools/brush.js`), `push` (`tools/push.js`), and shape kind `'blob'` via `createShape(ctx, 'blob')`.
- **shape.js:** the blob kind is named "Blob", with the hint "Drag to draw a blob. Shuffle in the Inspector for another." It draws through `liveContours('blob', box, toolOpts)`.
- **node.js, bend:**
  - Trigger: after the anchor and handle tests, before the item hit and marquee, and not with Alt. If the pointer is within `ctx.px(e)` of a segment of a selected item (`nearestOnItem`), start a bend gesture.
  - Drag: once the pointer has moved 3 px or more, `setDoc` with that contour replaced by `bendSegment(baseContour, seg, t, {x: e.x − e0.x, y: e.y − e0.y})`, always computed from the base. Commit as `'Bend'`.
  - Release without moving: clear the picked anchors unless Shift is held.
  - Hover over a segment shows the cursor `grab`.
- **select.js, distort:** active when `ui.distort && selection.length`.
  - **Overlay:** the quad outline (`ov-bbox`), four corner `handle()`s, four side `ctrl()` circles, and no rotate zones.
  - **Gesture:**
    - Start from `quad0` = the bounds corners `[TL, TR, BR, BL]`.
    - A corner moves to `snap.point(pointer − grabOffset)`.
    - A side handle shifts its two corners along that edge's axis, which is an exact skew.
    - With Alt, the opposite corner or side moves by −Δ.
    - Ignore moves that give `!isConvexQuad`.
    - Apply `distortContours(item.contours, bounds0, quad)` to every selected item, computed from the base items. Commit as `'Distort'`.
  - **Cursors:** corner `crosshair`, top and bottom `ew-resize`, left and right `ns-resize`.
  - **Esc:** `setUI{ distort: false }`.
- **tools/brush.js** (`create(ctx)`, WS-A):
  - **Sampling:** like the pencil (samples at least 1.5 screen px apart), recording `{x, y, t: e.time, p: e.pressure}` in doc units.
  - **Preview:** `outline([{ closed: true, nodes }], 'ov-ink')` from `inkOutline` on the SCREEN samples (size = `brushSize`).
  - **On up:**
    1. `poly = inkOutline(docSamples, { size: brushSize / zoom, thinning, taper })`.
    2. `bridge.simplify(poly, { tolerance: 1 / zoom, close: true })`. If Paper is unavailable or the call throws, decimate the polygon to spacing of at least size/3, turn it into a closed corner contour, and apply `smoothContours(..., 1)`.
    3. `dispatch('addItems', { items: [ctx.newItem([contour], 'Ink', { stroke: null })] })`, with the fill taken from `state.style.fill`.
  - The tool stays active, and a tap makes a dot.
- **tools/push.js** (`create(ctx)`, WS-B):
  - **Down:** targets are the selection; otherwise the item under the pointer (`hit.item(e, 4)`), which is then selected; otherwise nothing. Then `store.begin()`.
  - **Move:**
    - `R = pushSize / 2 / zoom`.
    - `n = ceil(|Δ| / (R/4))` sub-steps of `pushContours(current, center, Δ/n, R, pushStrength)`, accumulated per item.
    - Then `setDoc(updateItems(...))`.
  - **Up:** `commit('Push')` if anything changed. `cancel()` calls `store.cancel()`.
  - **Overlay:** the selected outlines plus a brush ring, `outline(ellipse ring in screen px, 'ov-preview')`.

## UI (`js/ui.js`, `index.html`)
- **ICONS** add `blob`, `brush`, `push`, `shuffle`, `smooth` and `roughen`.
- **Rail order:** [select, node, push] | [pen, pencil, brush] | [rect, ellipse, polygon, line, blob]. Each `data-tool` equals the tool id.
- **LIVE_FIELDS** adds `points wobble smooth o-amount o-detail t-points t-wobble t-smooth t-brushSize t-thinning t-taper t-pushSize t-pushStrength`.
- **Live blob section** (`live.kind === 'blob'` and the selection is that item): sliders `points` 3–16 (step 1), `wobble` 0–1 and `smooth` 0–1 (step .05). Each dispatches `setLive{ params: { [f]: v } }`, plus a Shuffle button.
- **Tool options** (sliders dispatch `setToolOpt{ key: f.slice(2), value }`):
  - Blob, when nothing is selected: `t-points`, `t-wobble`, `t-smooth`.
  - Brush, **always shown while the tool is active**, even with a selection: `t-brushSize` 2–96, `t-thinning` 0–1, `t-taper` 0–1.
  - Push, always shown while active: `t-pushSize` 20–240, `t-pushStrength` .05–1.
- **Shuffle:** a button with `data-action="shuffle"` and `id="in-shuffle"` that dispatches `shuffle`. It appears in the live-blob, tool-blob and roughen sections.
- **Organic section** (one or more selected, after the live-shape section):
  - Buttons `data-action="organic" data-v="smooth"` and `data-v="roughen"` dispatch `setLive{ kind }`.
  - A live smooth shows `o-amount` (0–1).
  - A live roughen shows `o-amount` (0–1), `o-detail` (1–10, step 1) and Shuffle.
  - Sliders dispatch `setLive{ params: { amount | detail } }`.
- **Transform section:** a Distort switch `#in-distort` that toggles `setUI{ distort }`. Turning it on also dispatches `setTool{ id: 'select' }` and `setUI{ sheet: null }`.
- When the tool changes, call `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on the active tile.
- **CSS:**
  - `#overlay-layer .ov-ink { fill: var(--ov); fill-opacity: .85; stroke: none }`.
  - At ≤720px: `.rail { overflow-x: auto; overflow-y: hidden; scroll-snap-type: x proximity; overscroll-behavior-x: contain; touch-action: pan-x }`, and tiles `flex: 1 0 44px; scroll-snap-align: start`. The page itself still never scrolls horizontally.
