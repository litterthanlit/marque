# Marque: the artifact

Marque is a small vector tool built from first principles and published as a Claude artifact. It sits beside the original app in `src/`, which it does not change.

## The three ideas

1. **One primitive, the path.** Each item holds contours, and each contour is a list of anchor nodes, each with an optional bezier handle on either side. Every tool (rectangle, ellipse, polygon, line, pen, pencil) only creates nodes. After that, every shape edits the same way.
2. **One rule, add or cut.** The drawing is an ordered stack. An *add* paints. A *cut* erases only what is beneath it, and anything added above a cut paints over the hole again.
3. **One output.** The exported SVG matches the screen exactly, because both are drawn by the same renderer using nested SVG masks. *Flatten* turns the stack into real boolean geometry when you need a single path.

## Layout

```
index.html          page shell: tokens, layout, markup (no doctype; the publish step wraps it)
js/consts.js        tools, artboards, limits, default style
js/model.js         document model; every function is pure and immutable
js/geometry.js      bezier maths: bounds, transforms, split, shapes, path data
js/render.js        document to SVG, using masks for cuts
js/paperBridge.js   Paper.js adapter: booleans, flatten, pencil smoothing, SVG import
js/store.js         state, actions, undo history
js/app.js           entry point: render loop, pointer, wheel and keyboard
js/snap.js hit.js overlay.js
js/tools/*.js       select, node, pen, pencil, shape
js/ui.js            top bar, tool rail, inspector, layers, popovers, Describe
js/io.js            export, import, autosave, clipboard, file saving
js/assist.js        Describe: turns text into editable paths via Claude
CONTRACT.md         the module contract the code follows
tests/              unit tests (node --test) and a Playwright smoke test
```

Paper.js loads as a classic script from `cdn.jsdelivr.net/npm/paper@0.12.18`. There is no build step and no other dependencies.

## Test

Run these from the repo root after `npm ci`:

```sh
node --test artifact/tests/*.test.mjs   # model, geometry, render, Paper bridge
node artifact/tests/smoke.mjs           # Playwright smoke test against the preinstalled Chromium
```

## Publish

Publish `artifact/index.html` as a Claude artifact:

- Map every `js/**` file into `files` at the same relative path.
- Declare `capabilities: { sample: {}, downloads: true }`.

`sample` powers Describe. `downloads` lets the page offer SVG and PNG files to save, which plain `<a download>` links cannot do inside the artifact viewer. If either capability is missing, the page still works: Describe is hidden, and Export falls back to Copy SVG.

## Organic and asymmetric shapes

- **Blob (O):** drag out a blob, then set Points, Wobble and Smoothness in the Inspector. Shuffle gives you another one.
- **Bend:** in Edit points, grab any curve or edge and pull it. The point you grab follows your pointer exactly.
- **Push (W):** a soft brush that moves nearby outline like clay. Size and strength are in the Inspector.
- **Ink brush (B):** draws filled strokes with tapered ends. Faster strokes are thinner, and pen pressure works too.
- **Smooth and Roughen:** in the Inspector, for any selection. Smooth turns corners into curves; Roughen adds irregular edges. Both stay adjustable until you make another edit, and amount 0 gives back the original.
- **Distort:** a switch in Transform. Drag a corner to move it on its own, or drag a side to skew.

## Keys

| Key | Action |
|---|---|
| V A W | Select, Edit points, Push (sculpt like clay) |
| P N B | Pen, Pencil, Ink brush |
| R E Y L O | Rectangle, Ellipse, Polygon, Line, Blob |
| X | Switch the selection between add and cut |
| G / S | Grid / snapping |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘D, Delete | Duplicate, delete |
| [ ] and ⌘[ ⌘] | Move backward or forward, to the back or front |
| ⌘0 / ⌘1 / ⌘= / ⌘− | Fit, 100%, zoom in, zoom out |
| Space-drag | Pan |
| ⌘E | Export |
| / | Describe |
