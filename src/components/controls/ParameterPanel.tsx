import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { SavedVariationsRail } from './SavedVariationsRail.tsx'
import { cn } from '../../lib/utils.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../../engine/illustrator/types.ts'
import type { MarkData } from '../../engine/illustrator/types.ts'
import { PUNCH_SHAPES, SLAB_KINDS } from '../../engine/carve/geometry.ts'
import { describeCarve } from '../../engine/carve/spec.ts'
import { checkSurvival, SURVIVAL_SIZES } from '../../engine/carve/survival.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'

export function ParameterPanel() {
  return (
    <div className="text-sm">
      <VectorMakerControls />
      <div className="border-t border-border">
        <Section title="Saved">
          <SavedVariationsRail />
        </Section>
      </div>
    </div>
  )
}

function VectorMakerControls() {
  const illustrator = useLogoStore((s) => s.illustrator)
  const selectIllustratorLayer = useLogoStore((s) => s.selectIllustratorLayer)
  const updateIllustratorLayer = useLogoStore((s) => s.updateIllustratorLayer)
  const updateIllustratorLayerTransform = useLogoStore((s) => s.updateIllustratorLayerTransform)
  const duplicateIllustratorLayer = useLogoStore((s) => s.duplicateIllustratorLayer)
  const deleteIllustratorLayers = useLogoStore((s) => s.deleteIllustratorLayers)
  const moveIllustratorLayer = useLogoStore((s) => s.moveIllustratorLayer)
  const toggleIllustratorLayerVisibility = useLogoStore((s) => s.toggleIllustratorLayerVisibility)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const booleanIllustratorLayers = useLogoStore((s) => s.booleanIllustratorLayers)
  const editAnchor = useLogoStore((s) => s.editAnchor)
  const addSlab = useLogoStore((s) => s.addSlab)
  const startOver = useLogoStore((s) => s.startOver)

  const selectedLayers = useMemo(() => {
    if (!illustrator) return []
    return illustrator.selectedLayerIds
      .map((id) => illustrator.layers.find((layer) => layer.id === id))
      .filter((layer) => layer != null)
  }, [illustrator])
  const selectedLayer = selectedLayers.length === 1 ? selectedLayers[0] : null
  const selectedLayerIndex = selectedLayer && illustrator
    ? illustrator.layers.findIndex((layer) => layer.id === selectedLayer.id)
    : -1
  const hasLayerSelection = selectedLayers.length > 0
  const hasBooleanSelection = selectedLayers.length >= 2
  const selectedPoint =
    selectedLayer && !selectedLayer.carve && illustrator?.pointSelection?.layerId === selectedLayer.id
      ? illustrator.pointSelection
      : null

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={startOver}
          disabled={!illustrator || illustrator.layers.length === 0}
          title="Clear the mark. Undo brings it back."
          className={cn(
            'h-8 px-3 rounded-lg text-xs transition-all',
            'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
            'disabled:opacity-40 disabled:cursor-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
          )}
        >
          Start over
        </button>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Add a slab</div>
        <div className="grid grid-cols-4 gap-1">
          {SLAB_KINDS.map((slab) => (
            <button
              key={slab.id}
              type="button"
              onClick={() => addSlab(slab.id)}
              className={cn(
                'h-8 rounded-lg text-xs transition-all',
                'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
              )}
            >
              {slab.label}
            </button>
          ))}
        </div>
      </div>

      {illustrator && (
        <>
          <EditorTools />

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[10px] uppercase tracking-widest text-sidebar-muted">Layers</div>
              <div className="text-[10px] text-sidebar-muted">
                {illustrator.layers.length} total
              </div>
            </div>
            <p className="mb-2 text-[11px] leading-snug text-sidebar-muted">
              Applied in order from 01. A cut removes only what is below it; point at a hole on the canvas to find its cut.
            </p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-interactive-active/40">
              {illustrator.layers.length === 0 ? (
                <div className="px-3 py-2 text-xs text-sidebar-muted">No layers yet.</div>
              ) : (
                [...illustrator.layers].reverse().map((layer, reverseIndex) => {
                  const index = illustrator.layers.length - 1 - reverseIndex
                  const selected = illustrator.selectedLayerIds.includes(layer.id)
                  return (
                    <div
                      key={layer.id}
                      className={cn(
                        'flex items-center gap-1 border-b border-border/60 px-1.5 py-1 last:border-b-0',
                        selected && 'bg-interactive',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleIllustratorLayerVisibility(layer.id)}
                        className={cn(
                          'h-7 w-7 shrink-0 rounded-md text-[10px] transition-colors',
                          layer.visible
                            ? 'text-fg hover:bg-interactive-hover'
                            : 'text-sidebar-muted/60 hover:text-sidebar-muted hover:bg-interactive-hover',
                        )}
                        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      >
                        {layer.visible ? 'On' : 'Off'}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => selectIllustratorLayer(
                          layer.id,
                          event.shiftKey || event.metaKey,
                        )}
                        className="min-w-0 flex-1 h-7 rounded-md px-2 text-left text-xs text-sidebar-text hover:text-fg hover:bg-interactive-hover truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                      >
                        <span className="mr-1 text-sidebar-muted font-mono-tabular">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        {layer.name}
                      </button>
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveIllustratorLayer(layer.id, 'up')}
                          disabled={index === 0}
                          className="h-7 w-6 rounded-md text-[10px] text-sidebar-muted hover:text-fg hover:bg-interactive-hover disabled:opacity-30 disabled:cursor-default"
                          aria-label={`Move ${layer.name} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveIllustratorLayer(layer.id, 'down')}
                          disabled={index === illustrator.layers.length - 1}
                          className="h-7 w-6 rounded-md text-[10px] text-sidebar-muted hover:text-fg hover:bg-interactive-hover disabled:opacity-30 disabled:cursor-default"
                          aria-label={`Move ${layer.name} down`}
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIllustratorLayerOperation(
                          layer.id,
                          layer.operation === 'add' ? 'subtract' : 'add',
                        )}
                        className={cn(
                          'h-7 w-8 shrink-0 rounded-md text-[10px] transition-colors',
                          layer.operation === 'add'
                            ? 'text-emerald-300 hover:bg-interactive-hover'
                            : 'text-rose-300 hover:bg-interactive-hover',
                        )}
                        aria-label={layer.operation === 'add' ? `${layer.name} adds material. Make it a cut` : `${layer.name} cuts material. Make it add`}
                        title={layer.operation === 'add' ? 'Adds material' : 'Cuts material'}
                      >
                        {layer.operation === 'add' ? 'Add' : 'Cut'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {hasBooleanSelection && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Boolean</div>
              <div className="grid grid-cols-3 gap-1">
                {(['unite', 'subtract', 'intersect'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => booleanIllustratorLayers(op)}
                    className="h-8 rounded-lg text-xs capitalize bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  >
                    {op === 'unite' ? 'Union' : op}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedLayer && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-[10px] uppercase tracking-widest text-sidebar-muted truncate">
                  Selected · {selectedLayer.name}
                </div>
                <div className="shrink-0 text-[10px] text-sidebar-muted font-mono-tabular">
                  {selectedLayerIndex + 1}/{illustrator.layers.length}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setIllustratorLayerOperation(selectedLayer.id, 'add')}
                  className={cn(
                    'flex-1 h-8 rounded-lg text-xs transition-all',
                    selectedLayer.operation === 'add'
                      ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                      : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                  )}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setIllustratorLayerOperation(selectedLayer.id, 'subtract')}
                  className={cn(
                    'flex-1 h-8 rounded-lg text-xs transition-all',
                    selectedLayer.operation === 'subtract'
                      ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                      : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                  )}
                >
                  Cut
                </button>
              </div>
              {selectedLayer.carve ? (
                <div className="rounded-lg border border-border bg-interactive-active/40 px-3 py-2">
                  <p className="text-xs text-sidebar-text" aria-live="polite">
                    {describeCarve(selectedLayer.carve)}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-sidebar-muted">
                    Drag the handles on the canvas to resize, round or turn it. Drag an edge to bend it; double-click a bent edge to straighten it.
                  </p>
                </div>
              ) : (
                <>
                <p className="text-[11px] leading-snug text-sidebar-muted">
                  Drag an edge on the canvas to bend it, or click it to add a point. Double-click a point to make it sharp or smooth.
                </p>
                <SliderControl
                  label="Move X"
                  value={selectedLayer.transform.dx}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { dx: v })}
                />
                <SliderControl
                  label="Move Y"
                  value={selectedLayer.transform.dy}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { dy: v })}
                />
                <SliderControl
                  label="Scale"
                  value={selectedLayer.transform.scale}
                  min={0.25}
                  max={3}
                  step={0.01}
                  onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { scale: v })}
                />
                <SliderControl
                  label="Rotate"
                  value={selectedLayer.transform.rotation}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { rotation: v })}
                />
                </>
              )}
              <div className={cn('grid gap-1', selectedLayer.carve ? 'grid-cols-2' : 'grid-cols-3')}>
                {!selectedLayer.carve && (
                  <button
                    type="button"
                    onClick={() => updateIllustratorLayer(selectedLayer.id, {
                      transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
                    })}
                    className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => duplicateIllustratorLayer(selectedLayer.id)}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => deleteIllustratorLayers([selectedLayer.id])}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-red-400 hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Delete
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => moveIllustratorLayer(selectedLayer.id, 'up')}
                  disabled={selectedLayerIndex <= 0}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Move Up
                </button>
                <button
                  type="button"
                  onClick={() => moveIllustratorLayer(selectedLayer.id, 'down')}
                  disabled={!illustrator || selectedLayerIndex >= illustrator.layers.length - 1}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Move Down
                </button>
              </div>
            </div>
          )}

          {selectedPoint && (
            <div className="rounded-lg border border-border bg-interactive-active/40 p-2.5">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-sidebar-muted">
                Point {selectedPoint.segmentIndex + 1}
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => editAnchor(selectedPoint.layerId, selectedPoint.segmentIndex, 'toggle-smooth')}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Sharp / Smooth
                </button>
                <button
                  type="button"
                  onClick={() => editAnchor(selectedPoint.layerId, selectedPoint.segmentIndex, 'delete')}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-red-400 hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Delete point
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-sidebar-muted">
                Double-click a point to switch it between sharp and smooth.
              </p>
            </div>
          )}

          {!hasLayerSelection && (
            <p className="text-xs text-sidebar-muted">
              Select a layer on the canvas or in the list to edit it.
            </p>
          )}

          <SurvivalCheck />
        </>
      )}
    </div>
  )
}

/* ─── Carving ─── */

const EDITOR_TOOLS = [
  { id: 'pen', label: 'Pen', key: 'Click to place points, drag an edge to bend it. Close by clicking the first point, pressing Enter or double-clicking.' },
  { id: 'punch', label: 'Punch', key: 'Stamp a hole. Click, or drag to size it.' },
  { id: 'channel', label: 'Channel', key: 'Drag to gouge a groove between two points.' },
  { id: 'slice', label: 'Slice', key: 'Drag a line to cut clean through, edge to edge.' },
] as const

function EditorTools() {
  const activeTool = useLogoStore((s) => s.ui.activeTool)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const carve = useLogoStore((s) => s.ui.carve)
  const setCarveSettings = useLogoStore((s) => s.setCarveSettings)
  const active = EDITOR_TOOLS.find((tool) => tool.id === activeTool)

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-widest text-sidebar-muted">Tools</div>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Tools">
        {EDITOR_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            aria-pressed={activeTool === tool.id}
            title={tool.key}
            onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
            className={cn(
              'h-8 rounded-lg text-xs transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
              activeTool === tool.id
                ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
            )}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {/* Pink like the guides it draws: the switch reads as part of the same system. */}
      <button
        type="button"
        role="switch"
        aria-checked={carve.snapping}
        onClick={() => setCarveSettings({ snapping: !carve.snapping })}
        className="flex h-8 items-center justify-between rounded-lg bg-interactive-active px-2.5 text-xs text-sidebar-muted transition-all hover:text-fg hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        <span>Snapping</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-sidebar-muted">{carve.snapping ? 'Hold ⌘ / Ctrl to skip' : 'Off'}</span>
          <span
            aria-hidden="true"
            className={cn(
              'relative h-4 w-7 rounded-full transition-colors duration-150',
              carve.snapping ? 'bg-pink-500' : 'bg-neutral-700',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none',
                carve.snapping ? 'translate-x-3' : 'translate-x-0',
              )}
            />
          </span>
        </span>
      </button>

      {active && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-interactive-active/40 p-2.5">
          <p className="text-[11px] leading-snug text-sidebar-muted">{active.key}</p>
          {active.id === 'punch' ? (
            <div className="flex gap-1 p-0.5 bg-interactive-active rounded-lg" role="group" aria-label="Punch shape">
              {PUNCH_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  aria-pressed={carve.punchShape === shape.id}
                  onClick={() => setCarveSettings({ punchShape: shape.id })}
                  className={cn(
                    'flex-1 h-7 rounded-md text-xs transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                    carve.punchShape === shape.id
                      ? 'bg-interactive text-fg font-medium shadow-sm'
                      : 'text-sidebar-muted hover:text-fg',
                  )}
                >
                  {shape.label}
                </button>
              ))}
            </div>
          ) : active.id === 'pen' ? null : (
            <>
              <SliderControl
                label="Width"
                value={carve.cutWidth}
                min={4}
                max={160}
                step={1}
                onChange={(v) => setCarveSettings({ cutWidth: v })}
              />
              <p className="text-[11px] text-sidebar-muted">Hold Shift to lock the angle to 15° steps.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SurvivalCheck() {
  const carve = useLogoStore((s) => s.ui.carve)
  const setCarveSettings = useLogoStore((s) => s.setCarveSettings)
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const mark = useActiveMark()
  const survival = useMemo(() => checkSurvival(mark, carve.survivalSize), [mark, carve.survivalSize])
  const percent = survival ? Math.max(1, Math.round(survival.weakRatio * 100)) : 0
  const weak = Boolean(survival && survival.weakRatio > 0)

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="text-[10px] uppercase tracking-widest text-sidebar-muted">Survival check</div>
      <div className="flex items-end gap-3" aria-label="Mark at actual size">
        {SURVIVAL_SIZES.map((size) => (
          <figure key={size} className="m-0 flex flex-col items-center gap-1">
            <SizePreview mark={mark} size={size} color={fillColor} />
            <figcaption className="text-[10px] font-mono-tabular text-sidebar-muted">{size}px</figcaption>
          </figure>
        ))}
      </div>
      <div>
        <div className="text-xs text-sidebar-text mb-1.5">Smallest size it must hold up at</div>
        <div className="flex gap-1 p-0.5 bg-interactive-active rounded-lg" role="group" aria-label="Smallest size in pixels">
          {SURVIVAL_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={carve.survivalSize === size}
              onClick={() => setCarveSettings({ survivalSize: size })}
              className={cn(
                'flex-1 h-7 rounded-md text-xs font-mono-tabular transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                carve.survivalSize === size
                  ? 'bg-interactive text-fg font-medium shadow-sm'
                  : 'text-sidebar-muted hover:text-fg',
              )}
            >
              {size}px
            </button>
          ))}
        </div>
      </div>
      <ToggleRow
        label={carve.showWeakSpots ? 'Weak spots shown on canvas' : 'Show weak spots on canvas'}
        checked={carve.showWeakSpots}
        onChange={(checked) => setCarveSettings({ showWeakSpots: checked })}
      />
      <p className="flex items-start gap-2 text-xs text-sidebar-text" aria-live="polite">
        <span
          aria-hidden="true"
          className={cn('mt-1 size-2 shrink-0 rounded-full', weak ? 'bg-rose-500' : 'bg-emerald-400')}
        />
        {!survival
          ? 'Nothing to check yet.'
          : weak
            ? `About ${percent}% of the ink is too thin to show at ${carve.survivalSize}px. Widen the walls marked in pink.`
            : `Every wall holds up at ${carve.survivalSize}px.`}
      </p>
    </div>
  )
}

function SizePreview({ mark, size, color }: { mark: MarkData | null; size: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size * ratio)
    canvas.height = Math.round(size * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!mark?.compoundPathData) return
    const { x, y, width, height } = mark.viewBox
    const longest = Math.max(width, height)
    if (longest <= 0) return
    // Fill the tile edge to edge, the way an app icon or favicon would.
    const scale = (size * ratio) / longest
    ctx.setTransform(scale, 0, 0, scale, -(x + width / 2 - longest / 2) * scale, -(y + height / 2 - longest / 2) * scale)
    ctx.fillStyle = color
    ctx.fill(new Path2D(mark.compoundPathData), mark.fillRule)
  }, [mark, size, color])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Mark at ${size} pixels`}
      className="rounded-[3px] bg-white"
      style={{ width: size, height: size }}
    />
  )
}

/* ─── Shared Components ─── */

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-3 py-2.5 text-[10px] uppercase tracking-widest text-sidebar-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        <span>{title}</span>
        <svg className={cn('size-3 transition-transform', open && 'rotate-180')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex-1 min-w-0 h-8 px-2 rounded-lg text-xs transition-all truncate',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
        checked
          ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
          : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
      )}
    >
      {label}
    </button>
  )
}
