# Construction tools (stage 2)

**Date:** 2026-10-05
**Status:** Written from the owner's brief of 2026-10-05. The owner approved the order of work in chat. The open questions at the end list the default this build takes for each.
**Builds on:** `2026-10-05-start-in-vector-maker-design.md`

## What changes and why

The owner wants to build marks from first principles, the way their four reference sheets are drawn. A sheet starts from circles, squares and polygons. It places them on construction lines, joins them with bands, adds and cuts them, and rounds the joins with fillets whose circles stay on the sheet. The relationships are exact: a band touches its circles, two edges run parallel, a punch sits on a centre.

Stage 1 gave Vector Maker shapes, cuts and a construction look. It did not give it precision. Stage 2 adds the compass and the ruler: guides, snapping to every shape, polygons, offsets, bands, groups and fillets. Bands, offsets, fillets, pins and construction guides remember what they were made from, and follow it when it moves.

None of that can be stored today. Every edit passes through the legacy layer format. `mutateVectorViaIllustrator` in `src/store/logoStore.ts` turns the document into layers, edits the layers, and rebuilds every object from them. The rebuild drops groups, appearance, parent ids and any field the layers lack. It splits a shape with a hole into separate filled pieces, so a ring cannot exist. Undo stores two full copies of the document per step. Stage 2 starts by removing that round trip.

The four reference sheets are the acceptance tests for this stage. They are referred to as ref 1 to ref 4:

- **Ref 1.** A hexagon ring with rounded corners and a triangle across it. Dashed spokes from the centre, a circumscribed circle, and a fillet circle at each corner.
- **Ref 2.** Three circles of different sizes joined by narrow bars. Smooth concave fillets where the bars meet the circles, and a neck between two circles that do not touch. A frame of guides touches the circles.
- **Ref 3.** A glyph like an S or a 2 built from a square, two large circular cuts offset vertically, and two bars. Only two opposite corners are rounded, and their fillet circles are dashed.
- **Ref 4.** A ligature like N or 2. Circles are joined by straight bands at one fixed angle, each band edge tangent to a circle. A small punch sits on a circle's centre, and parallel guides run at the band angle.

## What the user sees

- Every layer, every group and every multi-selection has resize and rotate handles on the canvas. The Transform and Scale popovers in the selection bar are gone.
- **G** draws guides: a straight line with a drag, a circle with an Alt-drag. Under the Guide tool, hovering a shape shows its construction lines as ghosts. A click adds one and Shift-click adds them all. The pen gains **Draws: Shape | Guide**, so an open path can become a guide. **Cmd+;** shows and hides guides. Guides draw only in the construction look and never print.
- Snapping knows every shape and every guide. A circle snaps tangent to lines, edges and other circles. A centre dropped on a centre stays pinned to it, and the selection bar says so.
- The slab row gains a **Polygon** slab, a hexagon by default. The punch gains a polygon shape. **[** and **]** change the number of sides. A polygon has a corner-radius dot, and its corner circles show in the construction look.
- **Offset…** in the selection bar makes a linked copy that is larger or smaller by a set distance. **As cut** places a smaller copy as a cut, which makes a ring.
- **B** joins two circles with a band. The band has four fits: **Belt** wraps both circles, **Bar** runs centre to centre at a set width, **Strip** runs at a set angle with each edge tangent to one circle, and **Neck** joins two circles with concave arcs of a set radius. A band follows its circles.
- **Cmd+G** groups and **Cmd+Shift+G** ungroups. A click selects the group, and a double-click selects one piece. A dropped spark is a group. **Isolate cuts** in the selection bar keeps a group's cuts inside the group. The layers drawer shows groups as a tree.
- **O** rounds corners. A click on a corner of the mark rounds it, and a drag sets the radius. The fillet circle stays on the sheet: solid for a concave corner, dashed for a convex one. **Round all N like this** rounds every matching corner.

## Decisions

### Edits write the document directly

Every store action builds the next `objects` array from the current one. An object that the edit does not touch keeps its identity. `mutateVectorViaIllustrator`, `layerEditsUpdate` and the legacy-to-vector half of the adapter leave the write path. The adapter stays as the importer for old `#i=` links only.

`src/store/objectEdits.ts` holds the pure writes: replace, insert, remove, move, `writeRecipe` and `writeContours`. Each returns the input unchanged when nothing changed. Every action ends in one `commitObjects` call. That call:

1. runs the follow pass over the changed ids;
2. drops the edit when every element of the next array is the same object as before, so a no-op is not an undo step;
3. pushes a history step and clears redo;
4. freezes new objects in development builds, so an edit in place throws.

The invariants that the round trip enforced as a side effect each get an owner in `objectEdits.ts`:

- A recipe object's path is the outline of its rounded recipe, and its transform is the identity.
- A path edit drops the recipe and the object's own link.
- New objects take the current ink as their appearance. The appearance of existing objects no longer follows the ink, because the ink is `params.fillColor` and nothing reads appearance.

### History holds arrays, not copies

A history step stores the `objects` array before and after the edit, by reference, with the selection before and after. Undo puts the earlier array back, so every cache keyed on identity hits and undo never recomposes. A step costs a few kilobytes instead of two copies of the document; the 360-object mark was 514 KB per copy. The cap stays at 100 steps.

Keys are written at once, every press, so nothing waits on a timer to land over an undo, a press or a deleted point. A commit may carry a merge key: the kind of key edit (`nudge`, `key-turn` or `key-scale`) and the selected ids. It joins the newest step instead of pushing one when that step has the same key, its last join was under 1000 ms ago, the redo stack is empty and the document is still as the step left it. The step keeps its label and its before, and takes the new after and selection. So a burst of arrow keys is one undo step, and a pause of a second, another selection, another kind of key or any other edit starts the next. A burst picks the cuts it carries once, at its first key, as a drag does when it starts: a hole goes the whole way with its shape, and a stray cut the shape passes over partway is not picked up.

### The legacy layers stay as a read model

The canvas controller, the hit zones, snapping, compose sessions, the renderer, the drawer, the selection bar, the dev hook and the e2e helpers all read `state.illustrator`. Porting them would rewrite about 3,000 lines with no visible change. They keep reading it. `illustrator` becomes a view derived from the document, rebuilt per object through `layerCache`. New concepts reach it as optional fields, so existing test fixtures still compile. Readers move to the document only when a feature needs it.

The render effect in `LogoCanvas` depends on the view's layers, not on the whole view. A selection click redraws the overlay and no longer rebuilds the paper scope.

### Composition is cached by what it reads

The mark is cached three ways:

1. by the `objects` array, as today, which undo now hits;
2. by an ink key: for each visible material object, its geometry and its operation. Renames, locks, group edits, guide edits and frame rotation keep the key. Until the schema step, the key includes the legacy transform, because the Transform sliders still write it;
3. as a base mark and a fillet pass, so a fillet edit never recomposes the base.

Runs of adds and runs of cuts are united as balanced trees instead of one at a time. A full compose of the 360-object mark falls from about 392 ms to 96 ms. The result differs from the old fold by 0.02 square units, within the tolerance the tests already use.

`pathSerialization.ts` activates its own paper scope. Today it leaves two paper items in the caller's scope on every commit.

### Handles on every layer

The eight box handles and the rotate knob move out of `carveHandles` into a shared box. They appear on:

- a single free path or group, around its frame, which keeps its rotation in `frame.rotation`;
- a multi-selection, around the axis-aligned bounds of its members.

A drag makes an affine map about the opposite handle, or about the centre with Alt. Free paths take the full affine. Recipes take only rotation, translation and uniform scale, so when a selection holds a recipe only the corner handles show and they scale uniformly. Slices are left out of every box, because their paths reach 4000 units past each end. Shift-rotate snaps to 15°. A single recipe keeps its own handles, also when the other selected layers are hidden or locked.

Just outside a corner, a drag turns the selection as the knob does, with the rotate cursor. This holds for a box and for a recipe whose handles have a knob (a slab, a punch that is not a circle), so a shape can be turned when its knob is off the canvas.

A box's turn or resize carries the cuts that a move of its members would carry, with or without Alt, since Alt already means "about the centre" there. A carried free cut takes the full affine. A carried recipe takes the similarity nearest it: its centre follows the affine, its size scales by the square root of the affine's area factor, and it turns by the affine's rotation, so a punch stays round. Dragging a single recipe's own handles leaves its cuts where they are.

With snapping on, a knob turn without Shift lands on whole degrees and a resize lands on whole units, so the number shown is the number stored. A single recipe's own handles do the same when no snap target applies: its knob turns to whole degrees, a slab's width and height, a punch's diameter and a groove's width land on whole units. Cmd/Ctrl keeps the raw values. The selection bar shows a free shape's or a multi-selection's size and angle at rest, as it does for a recipe: "Shape 1 · 267 × 150 · 26°", "6 layers · 410 × 380". It counts only the usable layers, as the handles do, so a recipe that is the only visible, unlocked layer selected reads as that recipe. Screen readers hear only what is selected ("Shape 1", "6 layers") as it changes, a new selection of the same kind (one slab, then another) too; the numbers sit beside it, outside the live region, so a burst of keys is not read out twice.

The box hides a side's square when the padded side is shorter than 48 pixels on screen. That side of the frame still resizes along its whole length, and the corners always show.

Alt with the arrow keys turns and scales the selection about its box's centre, evenly, so recipes stay recipes: Left and Right turn by 1°, or 15° with Shift, so the box lands on a whole degree; Up and Down scale so the longer side of the box grows or shrinks by 1 unit, or 10 with Shift, and a whole size stays whole. Like a nudge, every key is written at once, and a burst of the same kind of key on the same selection is one undo step. The keys of a burst turn about the point its first key turned about, though the box around several layers is measured upright again after each. A box carries its cuts as a drag of its handles does, but a recipe alone turns and scales as its own knob and handles do, and its cuts stay where they are. Each key reads out where the selection now is, such as "Turned to 45°" or "Size 267 × 150", and the number shows by the box for a moment, in place of a handle's number under a resting pointer, which comes back after.

Linked objects are not transformed directly. The follow pass rebuilds them from their sources. Pins and offset copies take turns until a round moves nothing, so a chain such as a recipe pinned to a copy's centre, and an offset of that recipe, follows to its end; guides follow last.

### Schema version 2

The document gains `schemaVersion: 2`. The format changes in its own build step, after the direct writes and the handles have shipped while still writing version 1.

```ts
interface VectorDocument {
  schemaVersion: 2
  id: string; kind: 'brand-vector' | 'font'; activeMode: 'logo' | 'wordmark'; name: string
  artboards: VectorArtboard[]
  objects: VectorObject[]    // stack order, index 0 at the bottom
  guides: Guide[]            // never composed or exported
  fillets: Fillet[]          // a finishing pass over the composed ink
  source: VectorDocumentSource | null
  createdAt: string; updatedAt: string
}

interface Segment { point: Vec2; handleIn: Vec2 | null; handleOut: Vec2 | null }
interface Contour { closed: boolean; segments: Segment[] }
interface ObjectBase { id: string; name: string; parentId: string | null; visible: boolean; locked: boolean }

interface PathObject extends ObjectBase {
  type: 'path'
  operation: 'add' | 'subtract'
  contours: Contour[]        // holes are further contours
  fillRule: 'nonzero' | 'evenodd'
  carve?: CarveSpec          // contours are the outline of the recipe
  link?: ObjectLink          // contours are made by the follow pass
  pin?: { centreOf: string } // the recipe's centre is held on another object's centre
  frame?: { rotation: number }
  sourceShapeId?: string
}

interface GroupObject extends ObjectBase {
  type: 'group'
  isolated: boolean          // members compose alone and enter the stack as one input
  operation: 'add' | 'subtract'  // read only when isolated
  frame?: { rotation: number }
}

type VectorObject = PathObject | GroupObject

type ObjectLink =
  | { kind: 'band'; a: string; b: string }           // carve is a BandSpec
  | { kind: 'offset'; of: string; distance: number }  // + outward, − inward

interface Guide {
  id: string; name: string; visible: boolean; locked: boolean
  style: 'solid' | 'dashed' | 'dotted'
  shape:
    | { kind: 'line'; p: Vec2; angle: number }        // infinite
    | { kind: 'circle'; c: Vec2; r: number }
    | { kind: 'path'; contour: Contour }
  link?: { kind: 'construction'; of: string; role: ConstructionRole }
}

interface Fillet {
  id: string; visible: boolean
  radius: number
  at: Vec2                       // the corner where it last solved
  between: [string, string]      // the objects whose outlines meet there; equal for a corner of one object
}
```

Groups are contiguous: a group's header object sits directly below its first member, and its members follow in stack order. `parentId` is the only record of membership.

The selection leaves the document and becomes store state. It was stored in links, saved marks and every undo snapshot. Per-object `appearance`, per-object `source` apart from `sourceShapeId`, `transform`, `artboardId`, path ids and point types leave too. `ShapeObject` and `TextObject` go, because nothing creates or reads them. For the 360-object mark the link falls from 121,721 to 67,124 characters.

The validator for version 2 repairs instead of refusing. A recipe kind, link kind or guide shape it does not know is dropped and the geometry kept, the way stage 1 already treats an invalid recipe. So two stage 2 builds shipped at different times can open each other's data. A dangling `parentId` moves the object to the root. A link to a missing object is detached, and an empty group is removed.

### Old links and saved marks keep working

`readVectorDocument` in `src/engine/vector/migrate.ts` replaces the validators that `decodeLink` and `savedDocument` call.

- A version 1 document passes the old validator, then is upgraded. `operation` comes from `source.compatOperation`, and the path becomes the first contour. A legacy transform is baked into the points the way compose draws it: scale and rotate about the bounds centre, then translate. The symmetric difference against the version 1 drawing is 0. A recipe takes the transform through `foldTransform` and is kept only if it still matches its path.
- An `#i=` link goes through the legacy adapter, which keeps its split into one object per subpath, then the upgrade. Old `#i=` links draw exactly as stage 1 draws them.
- A generator link builds version 2 directly.
- A saved mark is upgraded when it is opened and is never rewritten in storage.
- Changes made while opening a document are not undo steps.

A stage 1 build shows its existing "could not be read" message for version 2 data. That is better than the alternatives: an older build that accepted it would fill holes, print guides and erase groups.

### Compose honours holes and isolation

Compose reads `operation` and `contours`. It sets the fill rule only for objects with two or more contours, so every version 1 mark composes exactly as before. A subtract on circles of radius 200 and 100 now gives one ring object of area 94,248, not a full disk.

Compose walks the stack. A group header is skipped unless the group is isolated. An isolated group composes its members alone, caches the result by its members' identities, and enters the stack as one input with the group's operation. A cut inside an isolated group reaches only the members below it in that group.

Compose drops subpaths smaller than 0.01 square units. A failed boolean step becomes a notice in the construction look and a `console.warn`, never a silent gap. It cannot be a `console.error`, because the e2e fixture fails on one.

### Guides

Guides live in `guides`, outside `objects`. Compose, hit testing for material, `carriedCuts`, bounds and placement never see them, so they cannot leak into the ink. A guide edit leaves `objects` alone, so it never recomposes. `useUrlState` writes the link when `guides` changes too.

- **G** is the Guide tool. A drag draws an infinite line through the press point, at the drag angle, with Shift for 15° steps. An Alt-drag draws a circle from its centre.
- Under the Guide tool, hovering a shape shows its construction lines as ghosts: centre lines, bounds, the circumcircle and incircle of a polygon, and its spokes. A click adds one and Shift-click adds them all. They are linked to the shape and follow it. Construction lines lie in the shape's own frame, so a role such as top keeps to the same side of the shape through any turn. A guide is named for where its line lies on screen, as Top or Centre ↕, whatever the shape's turn or the way a groove was drawn, and is renamed when its shape turns it onto another side. Spokes are named Spoke 1, Spoke 2 and so on, counted in order among the spokes actually present, with no gaps. Their stored role stays `axis-N`, by corner, so they follow the shape.
- **Guides ▸ Construction** and **Guides ▸ Tangent frame** in the selection bar do the same for the selection. A tangent frame is the four lines that touch a set of circles, linked to the circles (ref 2).
- The pen's options row gains **Draws: Shape | Guide**. In Guide mode, Enter keeps an open path as a guide. Shape mode is unchanged.
- **Make guide** turns a selected path into a guide, and **Make shape** turns a closed path guide back into a shape.
- A guide is drawn above the ink and below the outline, as a 0.75 px neutral grey line, solid, dashed or dotted. Grey keeps red, green and blue equal, so the e2e checks that read the slab's pale grey still pass. Guides are hidden in the final look and never reach `mark()`, Copy SVG or the export.
- Under Select, a guide is the last zone a press can hit, after handles, edges and bodies. Under the Guide tool it is the first. A guide that lies along a shape's edge therefore never steals an edge drag.
- **Cmd+;** shows and hides guides. The setting is view state, outside the history and the link. The toolbar's switch and the drawer's are the same setting. Guides leave the selection when they leave the canvas, so the bar and Delete only act on guides that can be seen.
- The word "guide" already names the pink snapping feedback. That feedback is renamed `SnapHint`.

### Snapping knows every shape

The snap index is built per gesture from analytic outline primitives, not from the composed ink. `outlinePrimitives(object)` returns lines, arcs and cubics: a slab's sides and corner arcs, a circle punch's circle, a polygon's sides and arcs, a groove's lines and caps, a band's lines and arcs, a free path's cubics. Guides add their lines, circles and paths. Every feature carries its owner's id. Edges buried inside the ink become targets.

`asCircle(object)` reads an object as a circle when it is a circle slab (its width, height and half its corner radius each within 0.02 of each other, as storage rounds them apart; a box or handle scale of a slab rounded all the way, by a corner or, with Shift, by a side, keeps its radius exactly half its shorter side), an unbent circle punch, a circle guide, or a single closed contour whose anchors and curve midpoints lie within max(0.05, 0.001 r) of one circle. The last case covers spark circles, which carry no recipe.

The priority order extends the one in `snapping.ts`:

1. a point, including intersections of guides and edges;
2. tangency: a moved or resized circle touching a line, an edge or another circle, from inside or outside;
3. both axes aligned;
4. an edge where it crosses an alignment line;
5. one axis aligned;
6. on an edge or a guide;
7. a 15° ray.

Size snaps cover polygon radii, band widths and fillet radii as well as today's sizes. An offset copy that carries a recipe offers its sizes as any recipe does; the Distance sliders do not snap to other copies' distances (see Known limits).

### Centres stay pinned

When a drag releases a recipe's centre snapped onto another object's centre, the recipe records `pin: { centreOf }`. The HUD shows "pinned", and the selection bar reads "Pinned to 02 · Unpin". When the target moves or resizes, the follow pass moves the pinned recipe with it. Dragging the pinned object itself releases the pin, unless it is dropped back on a centre. A pin to a deleted object is removed in the same undo step.

Pins are the only snap that persists. Tangency and equal sizes are exact when made and are not kept, because stage 2 has no constraint solver.

### Polygons

`PolygonSpec` is a new recipe kind:

```ts
interface PolygonSpec { v: 1; kind: 'polygon'; center: Vec; sides: number /* 3 to 12 */
  radius: number /* circumradius of the sharp polygon */; rotation: number; cornerRadius: number }
```

The first vertex is at the top. A corner of radius ρ has its tangent points ρ·tan(α/2) from the vertex, where α = 2π/n is the turn, and its arc handles are (4/3)·tan(α/4)·ρ long. `cornerCubic` in `outline.ts` takes the turn angle instead of assuming 90°. A triangle's corners turn more than a quarter, so each is drawn as two arcs of half the turn, as `arcToCubics` splits any arc. ρ is clamped to the apothem when the outline is built, never when stored. A ρ stored within 0.01 of the apothem, the hundredth that storage rounds to, counts as the apothem: the polygon is fully round, with no flats. The outline's frame lists each corner's circle, so the construction look can draw them as solid hairlines in the lightest grey on the sheet, with a ringed dot at the centre. A fully rounded polygon lists none, since they would lie on its outline. Slabs and punches list none yet.

A polygon has four scale handles, a rotate knob and a corner-radius dot. A corner scales the polygon about its centre. With Shift its rounding scales too, and the HUD chip reads both, "r 200 · corner 60". The dot starts an inset in from the top corner and moves towards the middle at half the rate the corner's circle does. It never comes within 16 CSS px of the polygon's centre on screen, or 32 px under a finger, so a press on the middle always moves the shape. A polygon too small on screen for that has no dot, and the selection bar offers a **Corner** slider instead, in whole units from 0 to the apothem. A slab's dot keeps the same distance from its centre and gives way to the same slider. Dragged all the way in, to within the snap tolerance, the dot snaps exactly to the apothem ("fully round"), not to the whole number below it. While the dot is dragged, the corner circles and the centre dot are drawn from the previewed spec, so they follow it.

**[** and **]** take a side off or add one, one undo step each, from 3 to 12. The selection bar's **Sides** stepper does the same for the selected polygons, and its summary then leaves out the count of sides. With no polygon selected, the keys set the sides of the next polygon, and the HUD and the polite status say so: "Next polygon: 7 sides". The slab row gains **Polygon**, and its glyph stays centred with the count in the button's corner. The punch gains a polygon shape. A punch is drawn upright from its centre, with no turn while drawing, and is turned afterwards by its knob. While the punch shape is Polygon, the punch's options row keeps its own **Sides** stepper, for the next punch, whatever is selected. Both start as hexagons.

When the side count changes, the polygon's spoke guides are rebuilt for the new count in the same undo step, whenever any guide of its circles or spokes (circumcircle, incircle or a spoke) follows it. A spoke that lies on one of the polygon's centre-line guides is left out, as a square's two are. It comes back when a later count sets it apart, so a hexagon stepped down through a square to a triangle and back keeps its spokes. New spokes take the look, visibility and lock of the polygon's first spoke, or else of its first circle guide.

Every function that dispatches on a recipe kind becomes an exhaustive `switch` checked with `satisfies never`. Today each falls through to its last branch, so a new kind would silently take the groove branch.

### Offset

**Offset…** in the selection bar opens a distance slider from −120 to 120 with a live preview, and an **As cut** switch. The copy is linked to its source and placed directly above it. An inset placed as a cut makes a ring.

Recipes offset exactly:

| Source | Copy |
|---|---|
| Circle slab or circle punch | radius ± d |
| Unbent slab | width and height ± 2d, corner radius max(r ± d, 0) |
| Square punch | an inset stays a square punch; an outset becomes a slab rounded by d |
| Polygon | radius ± d / cos(π/n), corner radius max(ρ ± d, 0) |
| Channel or slice, bent or not, or bar band | width ± 2d |
| Belt band | both circle radii ± d |
| Strip band | both circle radii ± d, so each edge moves out by d |
| Neck band | both circle radii ± d, arc radius ∓ d, so the arcs keep their centres |
| Triangle punch | becomes a polygon of radius 1.25 r, then as above |

A belt's copy is its exact offset, since it wraps its circles. A strip's and a neck's copies are exact for the mark the band makes with its circles offset alike, whose edges and arcs they are, though not for the band alone, whose ends and chords lie inside the circles. A band copy that would take a circle under half a unit, or a neck's arcs to nothing, or whose circles would allow it no fit, leaves nothing. A bent groove's copy is the same groove 2d wider, as for a straight one, and no groove takes the general method: where half the wider groove passes the spine's tightest radius its rails leave spurs, as any groove that wide draws them, rather than the true offset of the narrower outline; and a slice's copy still cuts edge to edge. An offset that leaves less than 1 unit across leaves nothing. For ref 1, an inset of −55 on a corner radius of 60 gives an inner corner radius of 5, as the sheet shows.

Free paths, compound paths and bent slabs and punches offset by a general method at commit only. The contours are flattened to 0.05 units and read under their fill rule without paper's booleans (whose union of a path with itself gave phantom holes and lost others where contours both share an edge and overlap): every line is cut where another crosses it, ends on it or runs along it, a piece is kept, once, where the winding of the contours just off its two sides fills one and not the other (read off its middle by less than half the way to any other piece, so a line that nearly touches it is not stepped over), turned so the filled side is on its left, and the pieces join end to end into rings, each turning at a point into the piece that bounds the same filled corner. So contours meeting along an edge read as one shape, and overlaps read as the fill rule says. The offset is then every point whose signed distance from the shape is at most d: the distance is read on a lattice 0.5 units apart, finely only where the offset's edge can pass (a cell whose centre lies further from d than its half-diagonal holds none of it), each cell carrying only the lines that can be nearest to it. Where the edge crosses a lattice line the crossing is solved exactly from the nearest lines and corners; where it turns sharply, where two parts of the shape are equally near, the corner is put back exactly; and the rings are refitted with `simplify` to 0.2 units, sharp corners kept sharp. Moving lines and joining them at corners was tried first and dropped: a concave corner between short lines, as on a curve tighter than d, put the join past the lines' ends, and the non-zero rule turned the loops into fins, notches and lost pieces. Nothing can fold back on the lattice: holes close, parts join and vanish as the distance says, and pieces under 0.5 square units go. The result stays within 0.5 units of the true offset (0.23 at worst over 500 random stars, blobs, holes, combs, overlaps and self-crossing paths, and 0.32 over 324 shapes whose contours share edges, overlap, nest, repeat or touch at a point; 0.5 in the tests, with a region oracle that reads the fill by winding, not by paper). It takes 10–50 ms for a typical contour (a 50-segment blob 500 across, 25–40 ms; a 400-point wavy contour moved by 120, about 50 ms), longer with many contours far apart. One general offset is kept for each copy the last follow pass met, and 12 more for the slider's last steps, and a source that has only moved reuses its kept offset moved alike, so a drag's commit or a nudge costs nothing more. In one follow pass, pins and copies take turns, each seeing only what the others moved since its last turn, so no copy is made twice; whether a recipe pinned to a copy lets go is decided once everything has settled, so a pin moved together with its copy's source holds. The preview moves the old copy with its source until the commit; the Offset popover and a copy's Distance slider show an exact offset on every step, and a general one once the slider rests for 150 ms.

A copy is a path with `link: { kind: 'offset', of, distance }`, named "Inset −55" or "Outset 12"; the drawer shows "Inset −55 · 03" with a link glyph (a broken one, and "empty" in its spoken name, while nothing is left of it), and the bar "Inset −55 of 03" with a Distance slider, one undo step per release (a burst of arrow keys, or of presses on its − and + steps, is one undo step), and **Detach**. Both Distance sliders have − and + steps of one unit ("In 1", "Out 1"), or 5 with Shift or a long press, which steps again while held, over 0 to the other side: on touch, the slider moves one or two units a pixel, and the steps are how an exact distance is set; on a phone the copy's Distance takes a row of its own. A copy takes no pin. A side step ([, ] or the bar's Sides) of a copy steps the polygon it follows, as a nudge of it moves its source, and the HUD says "steps the source"; with a copy of anything else selected, [ and ] do nothing, not even set the next polygon's sides, and say "Offset copies keep their source's shape". Dragging or nudging it moves its source, and the HUD says "moves the source"; while that source is locked or hidden nothing moves and no undo step is made, the HUD says "source is locked" (or "hidden") and it is read out with the layer to unlock; a handle, box, key or point edit of the copy alone detaches it, the HUD says "detached" throughout and it is read out, whether the edit is a drag, a double-click, a key or a button in the bar. A copy that stops following no longer takes its name from its distance: unless it was named by hand, it is named as a new layer of its kind, its recipe's name or the next "Shape N", and so is a copy of a copy. A box or key edit that takes in a copy and its source edits the source alone, and the copy follows it, still linked. As cut follows the side of 0 until it is set by hand: on for an inset, off for an outset, which as a cut would take the whole shape away (a note says so when it is set on, and the bar says the same while a cut copy's own Distance slider is past 0). A copy of a cut always cuts, and the switch gives way to a line saying so. The popover's button is named for what it makes, "Cut inset −55" or "Add outset 12", and the keyboard goes on to the copy's Distance slider once it is made; both Distance sliders read "Inset −55" or "Outset 12", in 12 px figures as plain as the bar's other numbers, with a mark at 0, and fill from 0 to the thumb on either side. With As cut off, an inset of a filled shape lies inside it and changes nothing, and the popover says "Lies inside its source — As cut makes a ring". The source's bar names the copies that follow it, "Copies 03", as it names the pins a shape holds; its drawer row shows their numbers after a glyph of an outline within an outline, giving way to the row's own number and name, and says "copies 03" in full in its spoken name and title. In the construction look a linked copy draws no corner circles of its own: its corners share its source's centres, and only the source's are drawn. Deleting the source detaches the copy in the same undo step, and "detached" shows by it and is read out, as for a pin; an empty copy, with no geometry to keep, goes with its source instead, and a recipe pinned to it lets go and is read out as for any shape deleted. Detach and Copy wait while a copy is empty. A copy whose source leaves nothing at its distance keeps its link, empties, and reads "empty" in the drawer and "nothing left" in the bar until the source grows back; a recipe pinned to it and guides made from it wait as they are, keeping their pin and links, and follow it again when it comes back; a recipe its own edit moves meanwhile (a drag, a key, the box) lets go, as from any target. A document opens with its copies as stored, a saved mark too; the read repair breaks a loop of copies, detaches an offset of a group, reads a copy further than 600 from its source at 600, and detaches one whose distance is not a finite number, keeping its geometry (the slider reaches 120, and the general method's work grows with the square of the distance; it gives nothing beyond 1000).

### Bands

**B** is the Band tool. Its options row, labelled **Next band**, holds **Fit** (Belt, Bar, Strip, Neck) and the fit's setting: Width for Bar (40 to start), Angle for Strip, from 0° to 179° in whole degrees or 15° steps with Shift (60° to start), Radius for Neck (30 to start); Belt has none. Every circle a band can join is ringed 2 px wide just outside its outline in the hint colour, so the ring reads apart from the outline in either look: each object `asCircle` accepts, spark circles, punches and offset copies of circles included, and each circle guide on the canvas, dashed; the one under the pointer is ringed 3 px wide. A click picks circle a, which stays ringed, and the band previews live in the hint colour from it to the circle under the pointer, or to a circle of a's size at the pointer while none is under it; the HUD says "band to here" or "no fit". A second click on another circle makes the band, one undo step, and selects it; the tool stays on for the next band. A second click on a circle the band has no fit to makes nothing, keeps circle a and holds "no fit". A click off every circle makes nothing and says "pick a circle"; a click on circle a again, or Escape, drops it, and Escape with nothing picked leaves the tool. A press inside an object's circle picks that circle before a neighbour's rim in reach; a rim in reach picks its circle otherwise, and a circle guide's always, as a guide has no inside to press. A touch screen has no hover: a tap picks a, a tap on another circle makes the band, and the HUD's words hold for 1.2 s after a tap, past the pointer leaving as the finger lifts.

A band is a path object with a `BandSpec` recipe and a band link:

```ts
interface BandSpec { v: 1; kind: 'band'
  a: { c: Vec; r: number }; b: { c: Vec; r: number }   // snapshots of the circles
  fit: 'belt' | 'bar' | 'strip' | 'neck'
  width?: number; angle?: number; side?: 1 | -1; radius?: number }
```

The recipe holds snapshots of both circles, so `carveOutline` stays a pure function of the spec and its cache keeps working. The link holds the circles' ids: an object's or a circle guide's, since the sheets use both. The follow pass refreshes the snapshots whenever a circle changes, in the same edit, and a live frame of a drag draws the band from the circles as they are in that frame, rounded as the commit stores it, so the two are the same. That holds too for a band on a construction circle guide of a shape being dragged (a polygon's circumcircle, a neck's arc): the frame reads the guide from the shape as it is in the frame. A band is never a circle itself, so no band joins bands. Each fit reads only its own setting; a band keeps the others, so one put back to a fit has the setting it had there. The read check requires the fit's own setting, except a strip's side.

With d the distance between centres and u the unit vector from a to b, each outline runs clockwise like every recipe's (`src/engine/carve/band.ts`):

- **Belt** uses the two external tangents. With cos φ = (r_a − r_b)/d, the normals are n± = cos φ·u ± sin φ·u⊥ and the tangent points are c + r·n±. The outline is a tangent, the far arc on b, the other tangent and the far arc on a. It needs d > |r_a − r_b|: nested circles have no outer tangents. Equal circles are fine.
- **Bar** is a channel from c_a to c_b of the set width, with half circles about the centres, as the channel recipe draws one (ref 2). It needs the centres apart. Its round caps stay inside the circles while half the width is less than the smaller radius.
- **Strip** runs at the set angle θ, clockwise from flat, with normal n = (−sin θ, cos θ). One edge is a's support line, at n·c_a + side·r_a. The other is b's support line on the opposite side, at n·c_b − side·r_b. The ends run through each centre at right angles to θ, so the strip is the rectangle between those four lines (ref 4). It needs each edge to cross the other circle, so its ends stay inside the circles, and the edges in the order the side gives. For ref 4's circles (r 100 and 65) at 60° the width comes out as 81.2, against bars of about 82 on the sheet. The side is not a setting: where the circles lie across θ decides it, as at most one side fits (both only for equal circles lying along θ, which are then the same strip). A strip takes the side that fits whenever it is written, made, followed or set, and keeps the side it has while both fit or neither does, so it follows a circle dragged across its line. θ and θ + 180° with the side flipped are the same strip, so the angle is stored in [0°, 180°). There is no Flip.
- **Neck** joins two circles with two concave arcs of radius ρ, each tangent to both circles from outside. The arc centres are where the circles of radius r_a + ρ and r_b + ρ around the centres meet. Each arc runs the short way between its touch points, and the outline closes across each circle by a chord between the arcs' touch points: the chords lie inside the circles, so the neck unites with them cleanly, with no shared edge and no sliver. It needs those circles to meet and the arcs not to reach the line between the centres, which would cross them: the neck must keep a waist. Ref 2's neck, between circles 40.9 apart, takes arcs of 38; there the arcs reach both circles from 20.45 but leave a waist only from about 22.55.

Arcs are split into pieces of at most 90°, with handles (4/3)·tan(θ/4)·r long, by `arcToCubics`. Tangency holds to 1e-6 unrounded and to 0.01 as stored. The construction look draws a neck's arc circles whole, as the faint corner circles of a polygon, which is how ref 2 shows them. It strokes a linked band's outline only where it lies outside its two circles, as the sheets do: a bar's caps, a strip's ends and a neck's chords, and the runs of a bar's or strip's sides inside a circle, are not stroked (`bandOuterPathData`); the fill is whole. The Band tool's preview strokes the same.

A band sits directly above the higher of its circles that are objects, in the group they share; between two circle guides it goes on top. It is a cut when both circles are cut objects. It is named for its fit, "Band · strip", and a name it was made with follows its fit. A band takes no pin and has no handles of its own. A press on a linked band inside one of its circles is a press on that circle (the higher where they overlap), as the ink there is the circle's, unless that circle is locked or hidden: so a belt, which covers both its circles, leaves each to drag alone. Dragging or nudging its body outside them moves its circles that are objects, each as a move of it would, and the band follows them; the HUD says "moves its circles". Dragging or nudging an offset copy of a band moves the band's circles the same way, through the band: copy, band, circles, one undo step, nothing detached. Its circle guides stay where they are. While a circle it would move is locked or hidden, nothing moves and no undo step is made: the HUD says "circle is locked" (or "hidden") and it is read out with the layer to unlock. A band whose two circles are guides moves nothing, and the HUD says "follows guides: move them". A box, key or Alt-arrow edit of a band alone gives it a recipe of its own: it is detached, and the HUD says "detached". A box that takes in a band and either of its circles edits the circles, and the band follows them, still linked. A circle end that is a construction guide counts as the shape the guide follows: a drag or box of that shape takes the band along, still linked, and the HUD never says "detached". One that takes in both its circles (or what they follow, or the shapes whose construction circles they are) turns and scales the band with them: a turn turns a strip's angle, and an even scale scales a bar's width and a neck's radius, so a mark turned or scaled whole keeps its bands; an uneven scale takes the similarity nearest it, as the circles do.

When a configuration stops being valid, for example nested circles, a strip whose edges cross or miss, or a neck with no waist, or when an end is no longer a circle, the band keeps its link and its recipe, empties its outline, and reads "no fit" in the drawer and the bar until the circles allow it again. The edit that empties it holds "band 05: no fit" in the HUD and reads it out, whoever made it, past the release of a drag; a drag says so on the frames that leave it none. An empty band, like an empty offset copy, takes no part in a box: Alt with an arrow on it alone writes nothing, makes no undo step and holds "band 05: no fit" ("03: empty" for a copy), and a box or key edit that takes it in with other shapes edits them while it waits, still linked; the store refuses a recipe or path written to either. Its construction guides wait meanwhile, as an empty offset copy's do, and its offset copies are empty too, however they would fit at their own distance: they come back with the band, and go with it. A selected band marks its two circles on the canvas, dashed in the selection colour; an empty one shows a dashed red line between their centres where it would run, and the construction look draws that line for every empty band. A band's own controls never empty it: the Band tool makes none its circles leave no room for, and the store refuses a setting that would leave a band with an outline none. A new fit takes the setting the band had there where its circles allow it, or else the nearest whole setting in the sliders' reach that they do (width 2 to 160, angle 0° to 179°, turning round, radius 2 to 200): a bar between circles 300 apart switched to Neck takes the smallest radius that keeps a waist. Only a fit the circles allow at no setting is refused. Deleting a circle, or a circle guide it follows, detaches its bands in the same undo step, keeping their geometry and their recipe as plain bands, and undo restores both; an empty band, with nothing to keep, goes with its circle.

The selection bar stays short: it reads "Band · strip 60° · 02, 05" (the fit, its setting and the circles' numbers; "bar 40", "neck r 38", "belt"), with "no fit" after it while the band is empty, and offers **Band…**, a popover reading "This band" that holds the Fit control and the fit's setting, then Add or Cut, **Detach**, which keeps the band and its recipe and stops it following, and the bar's usual Offset…, Guides ▸, Make guide, Copy and Delete: an offset copy of a band and a band's construction guides are made there, as for any shape. Band…, Add or Cut and Detach keep together where the bar wraps, so on a phone they share a row under the summary and Detach is never left alone. A fit the circles leave no room for at any setting is disabled in the popover, its title saying why ("These circles leave no room for a neck of any radius", "… for a belt: one lies inside the other"); a setting let go of where they allow none is refused, the HUD holds "no fit" and reads out why, and the slider goes back to the band's value, by a drag or a key alike. The Width, Angle and Radius sliders show the band on the canvas as the thumb moves, one undo step per release, and a burst of arrow keys on a slider is one step. Switching fit writes the fit's setting into the recipe, so a reopened document keeps it. Detach and Copy wait while a band is empty, and an empty band reads out why it has no fit as it is selected. An offset copy of a band shows the copy's controls only (Distance, Detach), never the band's: it is made from the band. With the layers drawer open, the bar and the tool pill centre in the canvas left of it, so nothing of them sits under the drawer. A circle guide end reads as "guide 3", its place among the guides, and on a drawer row as "g3". The drawer names a band "Band · belt · 02, 05" in its spoken name and title; its row shows its own number, a link glyph, the fit, "Belt", which gives way first, and the circles' numbers in a column that never truncates (the number never does either), followed while it is empty by a "no fit" glyph whose title says so; its spoken name ends "no fit". A circle's row lists its bands, "bands 07", after a glyph of two circles joined, and its bar reads "Bands 07". A band offers construction guides of its own: **Centre line** through its circles' centres, and **Edge 1** and **Edge 2**, a belt's tangents, a bar's or strip's sides; a neck's are its arc circles, named **Arc 1** and **Arc 2**.

On a phone or a narrow tablet (below the md breakpoint) the tool pill's buttons are icons, each named by its label and title, so the seven tools fit one row; wider, they keep their words.

Snapping reads a band's edges and arcs exactly, and offers its middle as a centre and its touch points as points. A bar's and a strip's width join the groove widths among same-size snaps.

The read repair keeps a band link only on a band recipe of a fit it knows, to two different circles that are each an object other than a band or a group, or a guide; anything else is detached, keeping the geometry. A recipe of an unknown fit is dropped, and the link with it. A band waiting empty keeps its recipe. A link or saved mark opens with its bands as stored.

### Groups

A group is a contiguous run in the stack under a header object.

- A click on a member selects its outermost group. A double-click on a body selects the piece and enters the group. Escape steps back from the piece to the group to nothing. The double-click compares zones by the piece's id, so it still pairs after the first click selected the group.
- A double-click on an edge straightens it only when that layer is selected on its own, so a double-click into a group never straightens a piece by accident.
- **Cmd+G** groups the selection at the position of its topmost member. Gathering moves the lower members up. That changes the mark when a moved member crosses a layer of the other operation that overlaps it, so in that case Cmd+G is disabled and its hint names the layer in the way. **Cmd+Shift+G** ungroups one level. Both call `preventDefault`, because the browser uses Cmd+G for find-next, and both wait while a gesture is in progress.
- **Isolate cuts** in the selection bar turns isolation on and off as one undoable step.
- A dropped spark becomes an isolated group named after the spark and is selected as a group. It still goes below existing work, so the user's cuts still reach it. Two sparks no longer cut each other.
- The drawer shows a tree. A group row has a disclosure toggle and a member count, and ↑ and ↓ move the whole run. Numbers count within each level.
- The view expands a selected group into its leaves in `selectedLayerIds`, so the controller moves, nudges and outlines a group without knowing about groups.

### Fillets

**O** is the Round tool, with a Radius option from 2 to 200. Hovering shows a dot and a preview circle on the nearest corner of the mark within 10 px. A click adds a fillet at that radius, and a drag sets the radius with the HUD reading "r 25". Alt-click reuses the last radius. **Round all N like this** in the selection bar adds the same fillet to every corner of the mark with the same pair of object kinds and the same turn within 1°.

A fillet is a finishing pass over the composed ink. Fillets live in `fillets`, outside the stack, so they need no stacking rules and a fillet edit never recomposes the base mark. Each fillet records the corner it was made on (`at`) and the two objects whose outlines meet there (`between`). The pass finds the corner again on each compose: the ink corner nearest to `at` whose two curves belong to those objects.

The centre lies ρ from both curves, on the side that the ink sector gives:

| Curves | Centre |
|---|---|
| line and line | where the two lines offset by ρ meet |
| line and circle | where the offset line meets the circle of radius r ± ρ |
| circle and circle | where the circles of radius r₁ ± ρ and r₂ ± ρ meet |
| any cubic | Newton's method on the two distances, from P + bisector·ρ / sin(θ/2), at most 8 steps |

The fillet is applied as a wedge patch: tangent point, arc, tangent point, then a point Q on the bisector, 0.5·min(ρ, local thickness) from the corner. At a concave corner Q lies in the material and the patch is added. At a convex corner Q lies outside the ink and the patch is cut. The patch shares no edge with the ink. In probes, this wedge failed 0 times in 568 bar and circle cases. An unclamped wedge added stray ink in 48 of them.

In the construction look, a fillet circle is a full 0.75 px grey circle, solid at a concave corner and dashed at a convex one. A selected fillet shows in the selection colour, with a radius dot and the HUD. A fillet whose corner has gone shows as a red dashed circle at `at`, and comes back when the corner returns. When a tangent point would fall off its curve, the radius is clamped and the bar shows the radius used.

Fillets are hit only by their circle and dot. Under Select they come after every material zone, as guides do. The drawer lists them in a **Fillets** section.

A fillet on a single object's corner rounds one corner of a slab (ref 3). The slab's recipe still holds one radius for all four corners, so the per-corner slab radius the owner deferred stays deferred.

### Construction marks

The construction look adds the small marks the sheets carry:

- a dot at each centre of a circle or polygon;
- an open circle at each tangent point of a band or fillet;
- a small square at each sharp vertex of the ink and each crossing of guides.

They are drawn in neutral grey and scaled with the other construction lines.

## Build order

Each step leaves `npm test`, `npm run build` and `npm run test:e2e` passing. A test that pins behaviour a step changes is rewritten in that step and named in its commit. Each step is checked by hand in the browser before it is committed.

1. **Direct writes, still version 1.** `objectEdits.ts` and `commitObjects`. Every store action ported off `mutateVectorViaIllustrator`. History by reference, no-op detection, dev freeze. The view built per object. The mark cache with the ink key, balanced runs, the render effect keyed on layers, the paper scope fix.
   *Accept:* moving one of three layers leaves the other two objects identical by reference; a no-op is not an undo step; undo hits the mark cache; full compose of the 360-object mark takes under 150 ms; every existing test passes unchanged apart from the appearance-follows-ink test.
2. **Handles on every layer, still version 1.** The shared box, `frame.rotation`, uniform corners for selections with a recipe. The Transform and Scale popovers removed. Keys written at once, with bursts merged into one undo step. `devHook.handles()` returns box handles. e2e tests 594, 698 and 847 rewritten.
   *Accept:* Shift-rotate a dropped spark to 30° and resize a pen shape on one axis, each as one undo step.
3. **Schema version 2.** Types, `migrate.ts`, the repairing validator, links and saved marks, contours with holes, compose with fill rules and isolation, selection in store state, point editing per contour, `guides` and `fillets` lists defined.
   *Accept:* a version 1 link with a rotated and scaled pen shape draws identically; `#i=` links, generator links and version 1 saved marks open; Subtract on two circles gives one ring of area 94,248 ± 0.1% with a valid selection; the ring's inner contour can be point-edited.
4. **Guides.** Guide data and rendering, **G**, ghost construction lines, the pen's Guide mode, Make guide and Make shape, construction and tangent-frame guides, the drawer section, **Cmd+;**.
   *Accept:* ref 4's frame and 60° lines appear only in the construction look; `mark()` and Copy SVG are identical with and without guides; a circle slab's construction guides follow a resize.
5. **Snapping.** Outline primitives with ids, `asCircle`, intersections, tangency for every circle and line, new size snaps, pins.
   *Accept:* ref 2's circles snap tangent to the frame guides; in ref 4, circle C snaps into the frame corner and B snaps to C's size; a punch pinned to a circle's centre stays there when the circle is resized from a corner.
6. **Polygons.** `PolygonSpec` through every dispatcher, now exhaustive. Slab and punch entries, **[** and **]**, the corner-radius dot, corner circles.
   *Accept:* ref 1's hexagon with corner radius 60 shows six corner circles centred about 301 units from the middle.
7. **Offset.** Linked exact offsets, As cut, the general method at commit.
   *Accept:* in ref 1, resizing the hexagon keeps the ring 55 ± 0.01 thick with an inner corner radius of 5.
8. **Bands.** **B**, `BandSpec` with its four fits, the follow pass in previews and commits, the bar and drawer entries.
   *Accept:* in ref 4, dragging B keeps its strip tangent within 0.01 as one undo step; in ref 2, the bars follow the circle centres and the neck's arcs stay tangent to both circles; deleting a circle detaches its band and undo restores both.
9. **Groups.** Group headers, isolation with its cache, sparks as isolated groups, click, double-click and Escape, **Cmd+G** with its gather rule, the drawer tree, the Isolate switch. e2e tests 698 and 753 rewritten.
   *Accept:* ref 3's upper half, built as two isolated groups, keeps the sheet points (300, 470) and (560, 580) as ink with the counter clear; Cmd+G is disabled when a cut lies between the members.
10. **Fillets.** **O**, the fillet list, the solver, wedge patches, fillet circles, Round all, the lost state, construction marks.
    *Accept:* ref 2's fillets follow a dragged circle and the mark stays one piece with no warnings; ref 1's six hole corners take radius 5 in one step; ref 3's two convex corners round at 22 with dashed circles; a fillet whose corner vanishes goes red, and comes back when the corner returns.

## Tests

- Unit tests cover identity and no-ops in `objectEdits`, history by reference, the migration with a symmetric-difference check, the repairing validator, compose with holes and isolation, balanced runs against the old fold, every new recipe kind against an area oracle, offsets against exact offsets, every band fit against tangency, the fillet solver for each pair of curve kinds, and the wedge patch over random bar and circle cases.
- Each new recipe kind gets the randomized area test that `outline.test.ts` uses for slabs. Each band fit is checked at random against an area worked out from first principles (the hull of the circles for a belt, a stadium for a bar, a rectangle for a strip, the quadrilateral of the touch points less two circular segments for a neck), for tangency, for being one ring that crosses itself nowhere, and for a construction stroke that never enters its circles.
- e2e tests gain one flow per step, built from the reference it accepts against. The existing flows keep passing, or are rewritten in the step that changes them.

## Known limits

- A strip's width comes from where its circles sit, so moving a circle changes the band's weight. Same-size snapping helps; a width lock is not in this stage.
- A band follows a circle guide dragged on its own at the commit, not on every frame of the drag (a construction circle of a shape being dragged is followed live).
- A band's setting sliders do not mark the values its circles allow no fit: such a value previews as no band and is refused on release.
- A strip is a rectangle between its circles' centres: an offset of it alone does not round its ends, which lie inside the circles.
- Fillets join two curves that meet. A smooth join between two shapes that do not touch is the Neck band, and works only between circles.
- Tangency and equal sizes are not kept after the snap. Only centre pins persist.
- The general offset runs at commit only, so its preview shows the old copy moving with the source.
- Offset distances are not size snaps: the Distance sliders land on whole units (steps of 5 with Shift) and do not snap to other copies' distances.
- A bent groove's copy is the groove 2d wider, not the true offset of its drawn outline: where half the wider groove passes the spine's tightest radius, its rails draw spurs.
- There are no rulers. Guides come from the Guide tool, the pen and shapes.
- A stage 1 build cannot open version 2 links or saved marks.
- Touch has no way to add to a selection, so **Guides ▸ Tangent frame**, which needs two or more circles selected, needs a keyboard and pointer.
- There is no numeric entry for position, size or angle. Exact values come from snapping to whole units and degrees, Shift's 15° steps, arrow nudges, and Alt with the arrow keys.

## Open questions

The build takes the default on each. The owner can change any of them.

1. **Isolated groups.** Sparks drop as isolated groups, and Cmd+G groups start shared, with a switch. *Default: yes.* Ref 3 cannot be built in one shared stack, and sparks stop cutting each other.
2. **Rounding one corner of a slab with the Round tool.** *Default: yes.* It covers ref 3 without storing a radius per corner of the slab.
3. **Centre pins.** A centre released on a centre stays pinned. *Default: yes,* shown in the HUD and the bar, released by dragging the pinned object away.
4. **Band fits.** Belt, Bar, Strip and Neck. *Default: all four.* Ref 2 needs Bar and Neck, and ref 4 needs Strip. Belt is the band the owner first described.
5. **Older builds.** A stage 1 build refuses version 2 data with its existing message. *Default: accept.*
6. **The tangent band.** The stage 1 spec lists a tool that joins two circles with a tangent band as deferred. The owner moved it into stage 2 on 2026-10-05.

## Not in this stage

A radius stored per corner of a slab, symmetry tools, changes to point editing, monogram sparks, rulers, a constraint solver, and smooth joins between shapes that are not circles.
