import { useMemo } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { layersBounds } from '../../engine/illustrator/layerPath.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM, type IllustratorLayer } from '../../engine/illustrator/types.ts'
import { describeCarve } from '../../engine/carve/spec.ts'
import { cn } from '../../lib/utils.ts'
import { SliderControl } from '../controls/SliderControl.tsx'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented } from './controls.tsx'
import { Popover } from './Popover.tsx'

const OPERATION_OPTIONS = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Cut' },
] as const

const BOOLEAN_OPS = [
  { op: 'unite', label: 'Union' },
  { op: 'subtract', label: 'Subtract' },
  { op: 'intersect', label: 'Intersect' },
] as const

const RECIPE_HINT =
  'Drag the handles on the canvas to resize, round or turn it. Drag an edge to bend it; double-click a bent edge to straighten it.'
const FREE_SHAPE_HINT =
  'Drag an edge on the canvas to bend it, or click it to add a point. Double-click a point to make it sharp or smooth.'

export function SelectionBar() {
  const illustrator = useLogoStore((s) => s.illustrator)
  const duplicateIllustratorLayer = useLogoStore((s) => s.duplicateIllustratorLayer)
  const deleteIllustratorLayers = useLogoStore((s) => s.deleteIllustratorLayers)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const booleanIllustratorLayers = useLogoStore((s) => s.booleanIllustratorLayers)
  const editAnchor = useLogoStore((s) => s.editAnchor)

  const selectedLayers = useMemo(() => {
    if (!illustrator) return []
    return illustrator.selectedLayerIds
      .map((id) => illustrator.layers.find((layer) => layer.id === id))
      .filter((layer) => layer != null)
  }, [illustrator])
  if (selectedLayers.length === 0) return null

  const selectedLayer = selectedLayers.length === 1 ? selectedLayers[0] : null
  // Slabs and cuts are resized by their handles, one at a time.
  const scalable = selectedLayers.length >= 2 && selectedLayers.every((layer) => !layer.carve)
  const selectedPoint =
    selectedLayer && !selectedLayer.carve && illustrator?.pointSelection?.layerId === selectedLayer.id
      ? illustrator.pointSelection
      : null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label="Selection"
        className={cn(
          FLOATING_SURFACE,
          'pointer-events-auto relative flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 p-1.5',
        )}
      >
        <p
          className="max-w-full truncate px-1.5 text-xs text-sidebar-text"
          aria-live="polite"
          title={selectedLayer ? (selectedLayer.carve ? RECIPE_HINT : FREE_SHAPE_HINT) : undefined}
        >
          {selectedLayer
            ? selectedLayer.carve
              ? describeCarve(selectedLayer.carve)
              : selectedLayer.name
            : `${selectedLayers.length} layers`}
        </p>

        {selectedLayer && (
          <Segmented
            label="Add or cut"
            options={OPERATION_OPTIONS}
            value={selectedLayer.operation}
            onChange={(operation) => setIllustratorLayerOperation(selectedLayer.id, operation)}
          />
        )}

        {selectedPoint && (
          <>
            <Divider className="max-sm:hidden" />
            <div className="flex items-center gap-1" role="group" aria-label={`Point ${selectedPoint.segmentIndex + 1}`}>
              <span aria-hidden="true" className="px-1 text-[10px] uppercase tracking-widest text-sidebar-text">
                Point {selectedPoint.segmentIndex + 1}
              </span>
              <EditorButton
                title="Double-click a point to switch it between sharp and smooth."
                onClick={() => editAnchor(selectedPoint.layerId, selectedPoint.segmentIndex, 'toggle-smooth')}
              >
                Sharp / Smooth
              </EditorButton>
              <EditorButton
                danger
                onClick={() => editAnchor(selectedPoint.layerId, selectedPoint.segmentIndex, 'delete')}
              >
                Delete point
              </EditorButton>
            </div>
          </>
        )}

        {selectedLayers.length >= 2 && (
          <div className="flex gap-1" role="group" aria-label="Boolean">
            {BOOLEAN_OPS.map(({ op, label }) => (
              <EditorButton key={op} onClick={() => booleanIllustratorLayers(op)}>
                {label}
              </EditorButton>
            ))}
          </div>
        )}

        <Divider className="max-sm:hidden" />

        <div className="flex gap-1">
          {selectedLayer && !selectedLayer.carve && <TransformPopover layer={selectedLayer} />}
          {scalable && <ScalePopover layers={selectedLayers} />}
          {selectedLayer && (
            <EditorButton onClick={() => duplicateIllustratorLayer(selectedLayer.id)}>Copy</EditorButton>
          )}
          <EditorButton danger onClick={() => deleteIllustratorLayers()}>
            Delete
          </EditorButton>
        </div>
      </div>
    </div>
  )
}

/** Sliders for a layer that has no resize or rotate handles on the canvas. Each release is one undo step. */
function TransformPopover({ layer }: { layer: IllustratorLayer }) {
  const updateIllustratorLayer = useLogoStore((s) => s.updateIllustratorLayer)
  const updateIllustratorLayerTransform = useLogoStore((s) => s.updateIllustratorLayerTransform)

  return (
    <Popover
      label="Transform"
      panelClassName="absolute bottom-full left-1/2 mb-2 grid w-80 max-w-full -translate-x-1/2 grid-cols-2 gap-x-4 gap-y-2.5"
      trigger={(props) => <EditorButton {...props}>Transform</EditorButton>}
    >
      <SliderControl
        label="Move X"
        value={layer.transform.dx}
        min={-180}
        max={180}
        step={1}
        onChange={(v) => updateIllustratorLayerTransform(layer.id, { dx: v })}
      />
      <SliderControl
        label="Move Y"
        value={layer.transform.dy}
        min={-180}
        max={180}
        step={1}
        onChange={(v) => updateIllustratorLayerTransform(layer.id, { dy: v })}
      />
      <SliderControl
        label="Scale"
        value={layer.transform.scale}
        min={0.25}
        max={3}
        step={0.01}
        onChange={(v) => updateIllustratorLayerTransform(layer.id, { scale: v })}
      />
      <SliderControl
        label="Rotate"
        value={layer.transform.rotation}
        min={-180}
        max={180}
        step={1}
        onChange={(v) => updateIllustratorLayerTransform(layer.id, { rotation: v })}
      />
      <EditorButton
        onClick={() => updateIllustratorLayer(layer.id, { transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM } })}
        className="col-span-2"
      >
        Reset
      </EditorButton>
    </Popover>
  )
}

const SIZE_RANGE = { min: 40, max: 800 }

/** One slider for several free shapes at once, which have no handles either. Each release is one undo step. */
function ScalePopover({ layers }: { layers: IllustratorLayer[] }) {
  return (
    <Popover
      label="Scale"
      panelClassName="absolute bottom-full left-1/2 mb-2 w-64 max-w-full -translate-x-1/2"
      trigger={(props) => <EditorButton {...props}>Scale</EditorButton>}
    >
      <SizeSlider layers={layers} />
    </Popover>
  )
}

/** The longer side of the box around the shapes. The shapes keep their arrangement and the middle of the box stays put. */
function SizeSlider({ layers }: { layers: IllustratorLayer[] }) {
  const scaleSelection = useLogoStore((s) => s.scaleSelection)
  const size = useMemo(() => {
    const box = layersBounds(layers)
    return box ? Math.max(box.width, box.height) : 0
  }, [layers])
  if (size <= 0) return null
  const shown = Math.round(size)

  return (
    <SliderControl
      label="Size"
      value={shown}
      min={SIZE_RANGE.min}
      max={SIZE_RANGE.max}
      step={1}
      onChange={(next) => {
        if (next !== shown) scaleSelection(next / size)
      }}
    />
  )
}
