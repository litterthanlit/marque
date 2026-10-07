# Design

How Marque wears the litt design language. The language itself is written down in `DESIGN.md` in [litterthanlit/components](https://github.com/litterthanlit/components): read that for the reasons. This file says how it maps onto a logo maker, so new work lands in the same place.

The values live in code. `src/design/tokens.css` holds every colour, material, radius, duration and curve, in a light and a dark value; `src/index.css` builds the materials from them (`.plate`, `.well`, `.lcd`, `.engraved`, `.lamp`, `.device-key`, `.flat-key`); the shared controls are in `src/components/editor/controls.tsx`; sound is `src/lib/sound.ts`, the theme `src/lib/theme.ts`. If this file and the code disagree, the code is right.

## The instrument and the sheet

Marque is a marking instrument laid over a sheet of paper.

- **The sheet** is the drawing: white in both themes, as the mark prints, lifted off the page by a hairline ring and a soft shadow (`shadow-lg`). What sits on it reads in fixed colours, not theme tokens.
- **The instrument** is every control that works the drawing. The tool pill, the selection bar, the popovers, the Layers drawer, the Export panel and the spark deck along the bottom are plates of the body's finish (`.plate`, grained, lit on the top edge). They combine in one order: **plate, then well, then part**. Keys sit in wells; a list sits in a recess as a small white sheet.
- **The page** is what is around them: the top bar on the `canvas` ground, with quiet flat buttons and one primary key, Export.

## Parts

| Part | Where | How it behaves |
| --- | --- | --- |
| Key (`EditorButton`) | Pill, bar, popovers, deck | Raised on a 2px base, lettering in small capitals set by CSS. Sinks in 75ms, comes back at 150ms. Clicks down and up (`data-sound="key"`). |
| Latching key | Tools, toggles (`pressed`) | Carries a light in a window across its top, lit while latched. It keeps its place, so the hit area never moves. |
| Interlocked keys (`Segmented`) | Add / Cut, fits, shapes, export options | A row in a well: the chosen one is a key face, latched down; the others are lettering printed on the well. |
| Switch (`SwitchButton`) | Snapping, Isolate cuts, weak spots, As cut | A cap snaps across a recessed slot on a spring curve, showing the orange of a switch that is on. Two tiny clicks. |
| HOLD | The deck | Mutes every sound; M does the same. Orange while held. |
| LCD | Selection summary, stepper values, the HUD, the layer count, faults on the sheet | Black glass, light tabular figures, in both themes. |
| Fader (`SliderControl`) | Widths, radii, distances | A slot pressed into the plate, lit from its start to the cap. Detents click as they pass, pitched with the travel; the ends bump. |
| Lamp | Survival | Unlit with nothing to check, lit while every wall holds, red where one is too thin. |

## Colour means one thing each

Monochrome, plus:

- **Blue** (`--accent`, `#384ecb`) is the selection: handles, outlines, what a tool is about to make, a selected row, the focus ring.
- **Red** (`--device-rec`) is a light that fires: a snap as it catches, a weak wall, a fault. Faults on the page use `--danger`.
- **Orange** (`--device-hold`) is a switch that is on, and HOLD. It is a light beside a word, never text (2.3:1 on the light plate).

Colours that must be told apart differ in lightness as well as hue. Nothing is coloured for decoration.

## Type

Geist for everything, Geist Mono for figures that change (`font-mono-tabular`). Small sizes, weights 400 to 600. Lettering on the instrument: engraved captions at 10px, semibold capitals tracked 0.14em (`.engraved`); key lettering at 10px, medium capitals tracked 0.03em (`KEY_LETTERING`). Capitals belong to the hardware: the source and the accessible name keep sentence case.

## Motion

Exits are quicker than entrances (150ms out, 210ms in), on `--ease-out`. Keys go down in 75ms. Panels fade in and settle the last 3px (`animate-drop`); never animate from nothing. Under reduced motion every transition collapses to instant.

## Sound

Synthesized with Web Audio; nothing loads. Silent until the first gesture, muted by HOLD or M, remembered per device. Keys click through `data-sound`; switches play `toggle`; a spark dropped plays `select`; the Export panel opens and closes with `open` and `close`; a fader's detents `tick`; a refused command `bump`s; a snap caught under a drag ticks once. Use the voices in `sound.ts` and no others: vary a repeated one with `pitch` and `gain`.

## Accessibility

One focus ring everywhere, for the keyboard only (`:focus-visible`, 2px in `--focus`). Text greys hold 4.5:1 on the grounds they sit on: a plate scopes `--muted` and `--danger` to darker values (`--device-muted`, `--device-danger`) so they hold there too, down to the plate's lowest edge. `subtle` is for decoration only. Latching keys carry `aria-pressed`, switches `role="switch"`, state changes are said once in a live region (the HUD's). The theme follows the viewer's choice, else their system's.

## Writing

Plain, precise, British-spelled and quiet: colour, centre; synthesized. Sentence case in the source. Labels say what happens: "Download PNG", "Copy SVG", then "Copied". Numbers carry units and real symbols: `190 × 190`, `−20`, `2×`.
