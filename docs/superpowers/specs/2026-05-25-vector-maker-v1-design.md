# Vector Maker v1 Design

**Date:** 2026-05-25
**Status:** Approved direction
**Parent specs:** `2026-03-31-generative-logo-maker-design.md`, `2026-04-01-wave-arc-and-dissolution-design.md`

## Summary

Marque v1 is a generative logo + wordmark editor called **Vector Maker**.

Build a clean vector core first. Ship **Logo Mode** and **Wordmark Mode**. Reserve font work only at the schema and architecture level. Do not expose glyph editing, font metrics, kerning, font export, `GlyphObject`, or any Font Mode UI in v1.

The product is not a general Illustrator clone. It is a focused brand-vector studio where generated marks become editable vector documents, users refine marks and wordmarks, and exports are clean enough for real brand asset work.

V1 should prioritize a reliable generated-mark-to-editable-lockup workflow over breadth. Do not add SVG import, AI edits, multi-artboards, font tooling, gradients, symbols, or blank-document complexity until Logo + Wordmark editing is stable.

## Product Scope

### In Scope for v1

- Logo Mode.
- Wordmark Mode.
- One-artboard vector documents.
- Command-based mutation and undo/redo.
- Structured path/object model.
- Generated mark to editable object conversion.
- Object selection and transforms.
- Path editing foundation.
- Text and wordmark composition tools.
- SVG and PNG export from `VectorDocument`.
- Paper.js renderer with item cache and dirty-object updates.

### Out of Scope for v1

- General illustration workflows.
- Multi-artboard UI.
- Full SVG import.
- PDF import/export.
- Font editing UI.
- Font metrics UI.
- Kerning pair editor.
- `.otf` or `.ttf` export.
- `GlyphObject` in the live v1 object union.
- AI vector editing.
- Adobe Illustrator compatibility.

## Product Modes

### Logo Mode

Logo Mode is the primary editing surface for generated and manually refined marks.

It supports:

- Generated mark conversion.
- Shape and path editing.
- Object transforms.
- Fill, stroke, and opacity.
- Boolean/pathfinder operations.
- Clean SVG/PNG export.

### Wordmark Mode

Wordmark Mode builds on the same vector core, but focuses on typography and lockups.

It supports:

- Text objects.
- Font family, style, weight, size, line height, tracking, and alignment.
- Fill and opacity.
- Text positioning relative to marks.
- Text-to-outline conversion.
- Export as SVG/PNG.

### Font Mode Reserved

Font Mode is reserved at the document/schema level only. It must not appear in the v1 UI.

The v1 architecture should avoid decisions that block future font work, but it must not implement:

- Glyph editor.
- Glyph overview.
- Baseline/cap-height/x-height UI.
- Side bearings.
- Kerning pairs.
- Unicode mapping.
- Font preview strings.
- Font export.

## Architecture

### Vector Document

`VectorDocument` is the canonical editor model. Rendering, selection, history, persistence, and export must use this model instead of scraping canvas state or treating SVG strings as the editing source of truth.

Document kind should describe the file family. Workspace mode should describe the current editing surface. Logo and wordmark workflows can both operate on one brand-vector document, because a real brand asset often contains a mark and text lockup together.

```ts
type VectorDocumentKind = "brand-vector" | "font";
type VectorWorkspaceMode = "logo" | "wordmark";

interface VectorDocument {
  schemaVersion: 1;
  id: string;
  kind: VectorDocumentKind;
  activeMode: VectorWorkspaceMode;
  name: string;
  artboards: VectorArtboard[];
  objects: VectorObject[];
  selection: VectorSelection;
  source: VectorDocumentSource | null;
  createdAt: string;
  updatedAt: string;
}
```

`"font"` is reserved for future migration compatibility only. A document with `kind: "font"` must not be creatable from the v1 UI.

### Vector Objects

The v1 object union is intentionally small.

```ts
type VectorObject =
  | PathObject
  | ShapeObject
  | TextObject
  | GroupObject;
```

Do not add `GlyphObject` to this union in v1. Future font work can introduce:

```ts
type FutureVectorObject = GlyphObject;
```

That placeholder is documentation only. It must not affect v1 selection, transforms, export, serialization, undo, hit testing, or inspector UI.

### Path Model

Paths use structured commands as canonical data.

```ts
interface VectorPath {
  id: string;
  closed: boolean;
  segments: VectorPathSegment[];
}

interface VectorPathSegment {
  point: Vec2;
  handleIn: Vec2 | null;
  handleOut: Vec2 | null;
  pointType: "corner" | "smooth" | "symmetric";
}
```

SVG path commands/strings are serializer and export output, not the editor source of truth.

### Artboard

v1 has one artboard per document.

Default sizes:

- `1024x1024`
- `1080x1080`
- `1200x1200`
- Custom square or custom width/height

No `A4` default in v1.

## Command-Based History

Add command-based mutation before converting major editor features.

Every document edit should be represented as an undoable command:

- Create object.
- Delete object.
- Move object.
- Transform object.
- Change appearance.
- Edit path point.
- Add/remove path point.
- Create text.
- Edit text.
- Convert text to outlines.
- Apply boolean operation.

Drag operations must be coalesced so one drag produces one undo step.

The old full-document snapshot approach may remain temporarily around legacy state, but Vector Maker v1 mutations should move to commands as early as possible.

## Generated Mark Conversion

Generated marks must become editable `VectorDocument` objects where possible.

Conversion rules:

- Generated primitive circles, rectangles, polygons, and other recoverable primitives become `ShapeObject`s.
- Generated path output becomes `PathObject`s with structured path segments.
- Compound generated artwork becomes grouped objects where grouping preserves useful generation structure.
- Each converted object keeps source metadata such as generator id, generator version, source shape id, seed, params hash, and conversion timestamp where available.
- Unsupported source features degrade gracefully into `PathObject`s.
- The original generated source remains as provenance metadata on the document.

Do not convert generated marks into one opaque SVG blob unless no better structure is available.

If generation params change after conversion, Vector Maker should treat the document as derived from a stale source and offer:

- Keep current edit.
- Reconvert from current generated mark.
- Duplicate from current generated mark.

## Selection and Transforms

v1 needs a stable object selection model:

- Click selection.
- Shift multi-select.
- Marquee selection.
- Keyboard nudging.
- Move, scale, rotate.
- Direct transform bounds.
- Duplicate and delete.
- Group and ungroup.

Transforms should update object data through commands, not direct renderer state.

## Path Editing Foundation

v1 path editing should support:

- Anchor selection.
- Handle selection.
- Move anchor.
- Move handles.
- Add anchor.
- Delete anchor.
- Open/close path.
- Convert corner/smooth/broken handles.

Advanced simplify, offset path, and outline stroke can wait until after v1.

## Wordmark Tools

Text support ships before SVG import.

Minimum v1 typography controls:

- Font family.
- Weight/style.
- Size.
- Line height.
- Tracking.
- Alignment.
- Fill.
- Opacity.
- Text-to-outline conversion.

Text-to-outline may use browser/font rendering only if it is reliable enough for export. If reliable outline extraction is not available, defer outline conversion while preserving SVG text export. Do not fake outlines with broken approximations.

Wordmark composition must support aligning text with marks, spacing marks and type, and exporting combined lockups.

## Export

SVG and PNG export must use `VectorDocument`.

SVG export rules:

- Export visible objects on the selected artboard.
- Serialize paths from structured path segments.
- Preserve fill, stroke, opacity, and group transforms.
- Clean SVG is the default.
- Optional Marque metadata can be included for round-trip editing later.

PNG export rules:

- Render from the same `VectorDocument` composition as SVG.
- Respect artboard bounds.
- Respect current visible object state.

## Renderer

Keep Paper.js for v1, but stop full clear/rebuild loops for ordinary edits.

Renderer requirements:

- Maintain item cache keyed by object id.
- Update dirty objects only.
- Keep hit-testing mapped to `VectorObject` ids.
- Keep view state separate from document state.
- Keep export independent from scraped Paper.js canvas state.

## Persistence

Keep URL/local persistence for v1 while documents remain small enough.

Required:

- Persist `VectorDocument.schemaVersion`.
- Persist generated source provenance.
- Validate and migrate loaded documents.
- Drop unsupported future fields safely.

Add `.marque` only when document size or round-trip needs exceed URL/local persistence.

## Build Order

1. Rename user-facing `Illustrator` copy to **Vector Maker**.
2. Add one-artboard `VectorDocument` schema.
3. Add command-based mutation/history layer.
4. Convert generated marks into editable `VectorDocument` objects.
5. Keep the current editor behavior working through the new model.
6. Add stable selection, transforms, workspace foundation, and Paper.js item cache.
7. Rebuild path editing on structured path segments.
8. Add text and wordmark tools.
9. Export SVG/PNG from `VectorDocument`.
10. Expand renderer dirty-object updates where path/text editing exposes performance gaps.

## Acceptance Criteria

- User can generate a mark and open it in Vector Maker.
- Generated primitives become editable objects where recoverable.
- Generated path data becomes structured `PathObject` data.
- User can select, move, scale, rotate, duplicate, delete, group, and ungroup objects.
- User can edit path anchors and handles.
- User can add text, adjust basic type settings, and compose a wordmark lockup.
- User can convert text to outlines.
- User can export SVG/PNG from the edited `VectorDocument`.
- Undo/redo works for object, path, text, and appearance edits.
- Font Mode does not appear in the v1 UI.
- `GlyphObject` is not part of the live v1 `VectorObject` union.

## Future Phases

### Marque v2: Brand Asset System

- Logo variants.
- Icon sets.
- Colorways.
- Export sets.
- Brand sheets.
- Multi-artboard UI.
- Optional `.marque` files.

### Marque v3: Custom Font Studio

- Font document UI.
- Glyph overview.
- One-glyph editor.
- Metrics model.
- Spacing and kerning.
- Preview strings.
- `.otf` and `.ttf` export.
- Generative glyph family tools.
