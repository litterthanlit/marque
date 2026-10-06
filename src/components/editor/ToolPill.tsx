import { useSyncExternalStore } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { pinnedGhosts } from '../../renderer/tools/GuideTool.ts'
import { PUNCH_SHAPES, SLAB_KINDS } from '../../engine/carve/geometry.ts'
import type { SlabKind } from '../../engine/carve/spec.ts'
import { cn } from '../../lib/utils.ts'
import { SliderControl } from '../controls/SliderControl.tsx'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented, SwitchButton } from './controls.tsx'
import { EDITOR_TOOLS } from './tools.ts'

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
        <div className="flex items-center justify-center gap-x-2 gap-y-1.5 p-1.5 max-md:flex-col">
          <div className="flex flex-wrap justify-center gap-1" role="group" aria-label="Tools">
            {EDITOR_TOOLS.map((tool) => {
              const pressed = activeTool === tool.id
              return (
                <EditorButton
                  key={tool.label}
                  pressed={pressed}
                  title={`${tool.label} (${tool.shortcut}). ${tool.hint}`}
                  onClick={() => setActiveTool(pressed ? null : tool.id)}
                >
                  {tool.label}
                </EditorButton>
              )
            })}
          </div>
          <Divider className="max-md:hidden" />
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
            <SlabButtons />
            <Divider className="max-[379px]:hidden" />
            <SnappingSwitch />
          </div>
        </div>

        {activeTool === 'punch' && (
          <div className="flex justify-center border-t border-border p-1.5">
            <Segmented
              label="Punch shape"
              options={PUNCH_SHAPE_OPTIONS}
              value={carve.punchShape}
              onChange={(punchShape) => setCarveSettings({ punchShape })}
            />
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

function OptionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="px-1 text-[10px] uppercase tracking-widest text-sidebar-text">
      {children}
    </span>
  )
}

function SlabButtons() {
  const addSlab = useLogoStore((s) => s.addSlab)
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Add a slab">
      <span aria-hidden="true" className="px-1 text-[10px] uppercase tracking-widest text-sidebar-text">
        Slab
      </span>
      {SLAB_KINDS.map((slab) => (
        <EditorButton
          key={slab.id}
          aria-label={`Add ${slab.label.toLowerCase()} slab`}
          title={`Add a ${slab.label.toLowerCase()} slab`}
          onClick={() => addSlab(slab.id)}
          className="w-8 px-0"
        >
          <SlabGlyph kind={slab.id} />
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

const SLAB_GLYPHS: Record<SlabKind, React.ReactNode> = {
  square: <rect x="2" y="2" width="10" height="10" />,
  rounded: <rect x="2" y="2" width="10" height="10" rx="3" />,
  circle: <circle cx="7" cy="7" r="5" />,
  tall: <rect x="4" y="1" width="6" height="12" />,
}

function SlabGlyph({ kind }: { kind: SlabKind }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      {SLAB_GLYPHS[kind]}
    </svg>
  )
}
