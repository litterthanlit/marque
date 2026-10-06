import { useMemo } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { describeCarve } from '../../engine/carve/spec.ts'
import { bakedObjectPath } from '../../engine/illustrator/layerPath.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import type { VectorObject } from '../../engine/vector/types.ts'
import { selectionBox } from '../../renderer/directEdit/handleSet.ts'
import { cn } from '../../lib/utils.ts'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented } from './controls.tsx'

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
  'Drag the handles on the canvas to resize or turn it. Drag an edge to bend it, or click it to add a point. Double-click a point to make it sharp or smooth.'

/**
 * The selection in words: a recipe by its own numbers; a free shape or
 * several layers by the box their handles sit around, turned or not. So the
 * size and angle read at rest too, on touch where nothing hovers, and a
 * screen reader hears where every resize or turn landed.
 */
function describeSelection(doc: IllustratorDocument, objects: VectorObject[], selected: IllustratorLayer[]): string {
  const alone = selected.length === 1 ? selected[0] : null
  if (alone?.carve) return describeCarve(alone.carve)
  const name = alone ? alone.name : `${selected.length} layers`
  const byId = new Map(objects.map((object) => [object.id, object]))
  const around = selectionBox(doc, (layer) => {
    const object = byId.get(layer.id)
    return object?.type === 'path' ? bakedObjectPath(object.path, layer.transform) : null
  })
  if (!around) return name
  const { width, height, rotation } = around.box
  const turned = Math.round(rotation) ? ` · ${Math.round(rotation)}°` : ''
  return `${name} · ${Math.round(width)} × ${Math.round(height)}${turned}`
}

export function SelectionBar() {
  const illustrator = useLogoStore((s) => s.illustrator)
  const objects = useLogoStore((s) => s.vectorDocument.objects)
  const duplicateIllustratorLayer = useLogoStore((s) => s.duplicateIllustratorLayer)
  const deleteIllustratorLayers = useLogoStore((s) => s.deleteIllustratorLayers)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const booleanIllustratorLayers = useLogoStore((s) => s.booleanIllustratorLayers)
  const editAnchor = useLogoStore((s) => s.editAnchor)

  const selectedLayers = useMemo(
    () =>
      illustrator.selectedLayerIds
        .map((id) => illustrator.layers.find((layer) => layer.id === id))
        .filter((layer) => layer != null),
    [illustrator],
  )
  const description = useMemo(
    () => (selectedLayers.length ? describeSelection(illustrator, objects, selectedLayers) : ''),
    [illustrator, objects, selectedLayers],
  )
  if (selectedLayers.length === 0) return null

  const selectedLayer = selectedLayers.length === 1 ? selectedLayers[0] : null
  const selectedPoint =
    selectedLayer && !selectedLayer.carve && illustrator.pointSelection?.layerId === selectedLayer.id
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
          {description}
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
