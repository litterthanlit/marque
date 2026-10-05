import { useLogoStore } from '../../store/logoStore.ts'
import { PUNCH_SHAPES, SLAB_KINDS } from '../../engine/carve/geometry.ts'
import type { SlabKind } from '../../engine/carve/spec.ts'
import { cn } from '../../lib/utils.ts'
import { SliderControl } from '../controls/SliderControl.tsx'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented, SwitchButton } from './controls.tsx'
import { EDITOR_TOOLS } from './tools.ts'

const PUNCH_SHAPE_OPTIONS = PUNCH_SHAPES.map((shape) => ({ value: shape.id, label: shape.label }))

export function ToolPill() {
  const activeTool = useLogoStore((s) => s.ui.activeTool)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const carve = useLogoStore((s) => s.ui.carve)
  const setCarveSettings = useLogoStore((s) => s.setCarveSettings)

  // The wrapper spans the canvas and lets the pointer through: a press beside the pill still reaches the canvas.
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <div className={cn(FLOATING_SURFACE, 'pointer-events-auto flex max-w-full flex-col')}>
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
