import { useSyncExternalStore } from 'react'
import { MAX_FILLET_RADIUS, MIN_FILLET_RADIUS, useLogoStore } from '../../store/logoStore.ts'
import { pinnedGhosts } from '../../renderer/tools/GuideTool.ts'
import { PUNCH_SHAPES, SLAB_KINDS, type SlabEntry } from '../../engine/carve/geometry.ts'
import { clampSides, MAX_SIDES, MIN_SIDES } from '../../engine/carve/spec.ts'
import { cn } from '../../lib/utils.ts'
import { SliderControl } from '../controls/SliderControl.tsx'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented, Stepper, SwitchButton } from './controls.tsx'
import { EDITOR_TOOLS } from './tools.ts'
import { BandFitControl, BandSettingControl } from './BandControls.tsx'
import { RadiusSteps } from './RadiusSteps.tsx'

const PUNCH_SHAPE_OPTIONS = PUNCH_SHAPES.map((shape) => ({ value: shape.id, label: shape.label }))

export const GUIDE_STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
] as const

const GUIDE_DRAWS_OPTIONS = [
  { value: 'line', label: 'Line', title: 'A drag draws a line (Alt-drag a circle)' },
  { value: 'circle', label: 'Circle', title: 'A drag draws a circle from its centre (Alt-drag a line)' },
] as const

const PEN_DRAWS_OPTIONS = [
  { value: 'shape', label: 'Shape', title: 'The pen draws a filled shape: click the first point, or press Enter or double-click, to close it' },
  { value: 'guide', label: 'Guide', title: 'The pen draws a guide: Enter or double-click keeps the open path, a click on the first point closes it' },
] as const

export function ToolPill() {
  const activeTool = useLogoStore((s) => s.ui.activeTool)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const carve = useLogoStore((s) => s.ui.carve)
  const setCarveSettings = useLogoStore((s) => s.setCarveSettings)
  const guideStyle = useLogoStore((s) => s.ui.guideStyle)
  const setGuideStyle = useLogoStore((s) => s.setGuideStyle)
  const penDraws = useLogoStore((s) => s.ui.penDraws)
  const guideDraws = useLogoStore((s) => s.ui.guideDraws)
  const setGuideDraws = useLogoStore((s) => s.setGuideDraws)
  const setPenDraws = useLogoStore((s) => s.setPenDraws)

  // The wrapper spans the canvas and lets the pointer through: a press beside the pill still reaches the canvas.
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <div data-canvas-cover className={cn(FLOATING_SURFACE, 'pointer-events-auto flex max-w-full flex-col')}>
        {/* Eight tools and the slabs need about 940px in one row: narrower, they stack, and on a phone the tools are icons. */}
        <div className="flex items-center justify-center gap-x-2 gap-y-1.5 p-1.5 max-[940px]:flex-col">
          {/* Below 360px the icons' buttons narrow, so the eight still fit one row at 320. */}
          <div className="flex flex-wrap justify-center gap-1 max-[359px]:gap-0.5" role="group" aria-label="Tools">
            {EDITOR_TOOLS.map((tool) => {
              const pressed = activeTool === tool.id
              return (
                <EditorButton
                  key={tool.label}
                  pressed={pressed}
                  aria-label={tool.label}
                  className="max-md:px-2 max-[359px]:w-7 max-[359px]:px-0"
                  title={`${tool.label} (${tool.shortcut}). ${tool.hint}`}
                  onClick={() => setActiveTool(pressed ? null : tool.id)}
                >
                  {/* Narrower than a tablet, eight tools fit one row as icons; their names stay in the label and title. */}
                  <ToolIcon tool={tool.id} />
                  <span className="max-md:hidden">{tool.label}</span>
                </EditorButton>
              )
            })}
          </div>
          <Divider className="max-[940px]:hidden" />
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
            <SlabButtons />
            <Divider className="max-[379px]:hidden" />
            <SnappingSwitch />
          </div>
        </div>

        {activeTool === 'punch' && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-border p-1.5">
            <Segmented
              label="Punch shape"
              options={PUNCH_SHAPE_OPTIONS}
              value={carve.punchShape}
              onChange={(punchShape) => setCarveSettings({ punchShape })}
            />
            {/*
              Every punch selects its cut, so this stepper is only ever the next punch's: it stays put
              while cuts come and go. The bar's Sides is always the selected polygon's.
            */}
            {carve.punchShape === 'polygon' && (
              <Stepper
                label="Sides"
                name="Sides of the next punch"
                value={carve.polygonSides}
                min={MIN_SIDES}
                max={MAX_SIDES}
                lessLabel="One side fewer"
                moreLabel="One side more"
                title="The sides of the next punch ([ and ] with no polygon selected)"
                onStep={(delta) => setCarveSettings({ polygonSides: clampSides(carve.polygonSides + delta) })}
              />
            )}
          </div>
        )}
        {(activeTool === 'guide' || activeTool === 'pen') && (
          // One row, so the pill stays short over the canvas; it wraps on a phone.
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-border p-1.5">
            {activeTool === 'pen' && (
              <div className="flex items-center gap-2">
                <OptionLabel>Draws</OptionLabel>
                <Segmented label="Pen draws" options={PEN_DRAWS_OPTIONS} value={penDraws} onChange={setPenDraws} />
              </div>
            )}
            {activeTool === 'guide' && (
              // A phone has no Alt: circles have their own switch, and Alt flips it for one drag.
              <div className="flex items-center gap-2">
                <OptionLabel>Draws</OptionLabel>
                <Segmented label="Guide draws" options={GUIDE_DRAWS_OPTIONS} value={guideDraws} onChange={setGuideDraws} />
              </div>
            )}
            {(activeTool === 'guide' || penDraws === 'guide') && (
              <div className="flex items-center gap-2">
                <OptionLabel>Style</OptionLabel>
                <Segmented label="Guide style" options={GUIDE_STYLE_OPTIONS} value={guideStyle} onChange={setGuideStyle} />
              </div>
            )}
            {activeTool === 'guide' && <AddAllGhosts />}
          </div>
        )}
        {activeTool === 'band' && <BandOptions />}
        {activeTool === 'round' && <RoundOptions />}
        {(activeTool === 'channel' || activeTool === 'slice') && (
          <div className="flex justify-center border-t border-border px-3 py-2">
            <div className="w-56 max-w-full">
              <SliderControl
                label="Width"
                value={carve.cutWidth}
                min={4}
                max={160}
                step={1}
                onChange={(cutWidth) => setCarveSettings({ cutWidth })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * On a touch screen, the ghosts a tap pinned can all be added at once, as
 * Shift-click adds them with a mouse. On a phone its place is kept while
 * nothing is pinned, so the Style control beside it never moves.
 */
function AddAllGhosts() {
  const pinned = useSyncExternalStore(pinnedGhosts.subscribe, pinnedGhosts.get)
  return (
    <EditorButton
      title="Add every construction line of the shape (Shift-click)"
      onClick={pinned?.addAll}
      disabled={!pinned}
      aria-hidden={pinned ? undefined : true}
      className={cn('min-w-[5.5rem]', !pinned && 'invisible md:hidden')}
    >
      Add all {pinned?.count ?? ''}
    </EditorButton>
  )
}

/**
 * The next band's fit and the fit's setting, labelled so: the band just made
 * is selected, and the bar below shows its own, alike. The tool's preview
 * follows a slider as it moves.
 */
function BandOptions() {
  const band = useLogoStore((s) => s.ui.band)
  const setBandSettings = useLogoStore((s) => s.setBandSettings)
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-border p-1.5" role="group" aria-label="Next band">
      <div className="flex items-center gap-2">
        <OptionLabel>Next band</OptionLabel>
        <BandFitControl fit={band.fit} onChange={(fit) => setBandSettings({ fit })} />
      </div>
      <BandSettingControl
        fit={band.fit}
        values={band}
        onInput={(update) => setBandSettings(update)}
        onChange={(update) => setBandSettings(update)}
        className="w-44 max-w-full px-1.5"
      />
    </div>
  )
}

/**
 * The radius of the next fillet, labelled so: a click on a corner takes it,
 * a drag from one sets its own. The fillet just made is selected, and the
 * bar below shows its own radius.
 */
function RoundOptions() {
  const radius = useLogoStore((s) => s.ui.round.radius)
  const setRoundRadius = useLogoStore((s) => s.setRoundRadius)
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-border p-1.5" role="group" aria-label="Next fillet">
      <OptionLabel>Next fillet</OptionLabel>
      <div className="flex items-center gap-1">
        <div className="w-44 max-w-full px-1.5">
          <SliderControl label="Radius" value={radius} min={MIN_FILLET_RADIUS} max={MAX_FILLET_RADIUS} step={1} scale="sqrt" emphasis onInput={setRoundRadius} onChange={setRoundRadius} />
        </div>
        <RadiusSteps value={radius} onStep={setRoundRadius} />
      </div>
    </div>
  )
}

/** Each tool's icon, drawn on a 14-unit grid in the text colour, for the narrow pill. */
const TOOL_ICONS: Record<string, React.ReactNode> = {
  select: <path d="M3.5 2v9.5l2.6-2.4 1.8 3.9 1.6-.7-1.8-3.9h3.5z" fill="currentColor" stroke="none" />,
  pen: (
    <>
      <path d="M2.5 11.5l1.2-4 5.5-5.5 2.8 2.8-5.5 5.5z" />
      <circle cx="6.3" cy="7.7" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  punch: (
    <>
      <circle cx="7" cy="7" r="5" />
      <circle cx="7" cy="7" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  channel: <path d="M2 5h10M2 9h10M2 5a2 2 0 0 0 0 4M12 5a2 2 0 0 1 0 4" />,
  slice: <path d="M1.5 12.5l11-11M4 12.5l8.5-8.5" />,
  guide: <path d="M1 7h12" strokeDasharray="2 1.6" />,
  band: (
    <>
      <circle cx="3.8" cy="7" r="2.5" />
      <circle cx="10.2" cy="7" r="2.5" />
      <path d="M3.8 4.5h6.4M3.8 9.5h6.4" />
    </>
  ),
  round: (
    <>
      <path d="M2 12V7a5 5 0 0 1 5-5h5" />
      <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
    </>
  ),
}

function ToolIcon({ tool }: { tool: string | null }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="md:hidden"
    >
      {TOOL_ICONS[tool ?? 'select']}
    </svg>
  )
}

function OptionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="px-1 text-[10px] uppercase tracking-widest text-sidebar-text">
      {children}
    </span>
  )
}

function SlabButtons() {
  const addSlab = useLogoStore((s) => s.addSlab)
  const sides = useLogoStore((s) => s.ui.carve.polygonSides)
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Add a slab">
      <span aria-hidden="true" className="px-1 text-[10px] uppercase tracking-widest text-sidebar-text">
        Slab
      </span>
      {SLAB_KINDS.map((slab) => (
        <EditorButton
          key={slab.id}
          aria-label={`Add ${slab.label.toLowerCase()} slab`}
          title={slab.id === 'polygon' ? `Add a polygon slab of ${sides} sides ([ and ] change them)` : `Add a ${slab.label.toLowerCase()} slab`}
          onClick={() => addSlab(slab.id)}
          className="relative w-8 px-0"
        >
          <SlabGlyph kind={slab.id} sides={sides} />
        </EditorButton>
      ))}
    </div>
  )
}

function SnappingSwitch() {
  const snapping = useLogoStore((s) => s.ui.carve.snapping)
  const setCarveSettings = useLogoStore((s) => s.setCarveSettings)
  return (
    <SwitchButton
      label="Snapping"
      checked={snapping}
      onChange={(checked) => setCarveSettings({ snapping: checked })}
      title={snapping ? 'Snapping is on. Hold ⌘ / Ctrl while dragging to skip it.' : 'Snapping is off.'}
    />
  )
}

const SLAB_GLYPHS: Record<Exclude<SlabEntry, 'polygon'>, React.ReactNode> = {
  square: <rect x="2" y="2" width="10" height="10" />,
  rounded: <rect x="2" y="2" width="10" height="10" rx="3" />,
  circle: <circle cx="7" cy="7" r="5" />,
  tall: <rect x="4" y="1" width="6" height="12" />,
}

/**
 * The most sides the polygon glyph draws. With more it would read as a
 * second circle beside the circle slab's, so it stays a hexagon; the count
 * is written in the button's corner.
 */
const GLYPH_SIDES = 6

/** The next polygon, a corner at the top, as it starts, about as large as the other glyphs. */
function polygonGlyphPoints(sides: number): string {
  return Array.from({ length: sides }, (_, i) => {
    const angle = (2 * Math.PI * i) / sides
    return `${(7 + 5.5 * Math.sin(angle)).toFixed(2)},${(7 - 5.5 * Math.cos(angle)).toFixed(2)}`
  }).join(' ')
}

/**
 * A slab's glyph, centred in its button like every other. The polygon's
 * count of sides sits in the button's bottom right corner, out of the
 * glyph's way, so the glyph never moves as the count changes.
 */
function SlabGlyph({ kind, sides }: { kind: SlabEntry; sides: number }) {
  return (
    <>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
        {kind === 'polygon' ? <polygon points={polygonGlyphPoints(Math.min(sides, GLYPH_SIDES))} /> : SLAB_GLYPHS[kind]}
      </svg>
      {kind === 'polygon' && (
        <span aria-hidden="true" className="absolute bottom-0.5 right-1 text-[9px] font-semibold leading-none tabular-nums">
          {sides}
        </span>
      )}
    </>
  )
}
