import { useMemo } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { describeCarve } from '../../engine/carve/spec.ts'
import { editableShapeOf } from '../../engine/illustrator/layerPath.ts'
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
 * The selection in words: what it is, and its numbers. A recipe reads by its
 * own numbers; a free shape or several layers by the box their handles sit
 * around, turned or not, so the size and angle read at rest too, on touch
 * where nothing hovers. Hidden and locked layers take no part, as on the
 * canvas: a recipe that is the only one left reads as that recipe.
 */
function describeSelection(
  doc: IllustratorDocument,
  objects: VectorObject[],
  selected: IllustratorLayer[],
): { name: string; numbers: string | null } {
  const usable = selected.filter((layer) => layer.visible && !layer.locked)
  const members = usable.length ? usable : selected
  const alone = members.length === 1 ? members[0] : null
  if (alone?.carve) {
    const [kind, ...numbers] = describeCarve(alone.carve).split(' · ')
    return { name: kind, numbers: numbers.join(' · ') || null }
  }
  const name = alone ? alone.name : `${members.length} layers`
  const byId = new Map(objects.map((object) => [object.id, object]))
  const around = selectionBox(doc, (layer) => {
    const object = byId.get(layer.id)
    return object?.type === 'path' ? editableShapeOf(object.contours) : null
  })
  if (!around) return { name, numbers: null }
  const { width, height, rotation } = around.box
  const turned = Math.round(rotation) ? ` · ${Math.round(rotation)}°` : ''
  return { name, numbers: `${Math.round(width)} × ${Math.round(height)}${turned}` }
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
    () => (selectedLayers.length ? describeSelection(illustrator, objects, selectedLayers) : null),
    [illustrator, objects, selectedLayers],
  )
  if (selectedLayers.length === 0) return null

  const selectedLayer = selectedLayers.length === 1 ? selectedLayers[0] : null
  const selectedPoint =
    selectedLayer && !selectedLayer.carve && illustrator.pointSelection?.layerId === selectedLayer.id
      ? illustrator.pointSelection
      : null

  // On a shape with a hole, the hole's points are told apart from the outline's.
  const pointLabel = selectedPoint
    ? (selectedLayer?.contourCount ?? 1) > 1
      ? `Point ${selectedPoint.segmentIndex + 1} · contour ${(selectedPoint.contourIndex ?? 0) + 1}`
      : `Point ${selectedPoint.segmentIndex + 1}`
    : ''

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
        {/*
          Only what is selected is read out as it changes: a burst of keys reads out its own numbers.
          The name is drawn afresh for each new selection, so moving from one slab to another is heard too.
        */}
        <p
          className="max-w-full truncate px-1.5 text-xs text-sidebar-text"
          title={selectedLayer ? (selectedLayer.carve ? RECIPE_HINT : FREE_SHAPE_HINT) : undefined}
        >
          <span aria-live="polite">
            <span key={illustrator.selectedLayerIds.join(' ')}>{description?.name}</span>
          </span>
          {description?.numbers && <span> · {description.numbers}</span>}
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
            <div className="flex items-center gap-1" role="group" aria-label={pointLabel}>
              <span aria-hidden="true" className="px-1 text-[10px] uppercase tracking-widest text-sidebar-text">
                {pointLabel}
              </span>
              <EditorButton
                title="Double-click a point to switch it between sharp and smooth."
                onClick={() => editAnchor(selectedPoint.layerId, selectedPoint.segmentIndex, 'toggle-smooth', selectedPoint.contourIndex)}
              >
                Sharp / Smooth
              </EditorButton>
              <EditorButton
                danger
                onClick={() => editAnchor(selectedPoint.layerId, selectedPoint.segmentIndex, 'delete', selectedPoint.contourIndex)}
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
