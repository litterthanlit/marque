import { useMemo } from 'react'
import { tangentCircles, useLogoStore } from '../../store/logoStore.ts'
import { describeCarve } from '../../engine/carve/spec.ts'
import { editableShapeOf } from '../../engine/illustrator/layerPath.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { closedContourOf, describeGuide } from '../../engine/vector/guides.ts'
import type { Guide, VectorObject } from '../../engine/vector/types.ts'
import { selectionBox } from '../../renderer/directEdit/handleSet.ts'
import { cn } from '../../lib/utils.ts'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented } from './controls.tsx'
import { layerNumber } from './layerNumber.ts'
import { Popover } from './Popover.tsx'
import { GUIDE_STYLE_OPTIONS } from './ToolPill.tsx'

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
  if (!illustrator.selectedLayerIds.length && illustrator.selectedGuideIds?.length) return <GuideBar />
  return <LayerBar />
}

/** The bar for a selection of layers. */
function LayerBar() {
  const illustrator = useLogoStore((s) => s.illustrator)
  const objects = useLogoStore((s) => s.vectorDocument.objects)
  const duplicateIllustratorLayer = useLogoStore((s) => s.duplicateIllustratorLayer)
  const deleteIllustratorLayers = useLogoStore((s) => s.deleteIllustratorLayers)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const booleanIllustratorLayers = useLogoStore((s) => s.booleanIllustratorLayers)
  const editAnchor = useLogoStore((s) => s.editAnchor)
  const makeGuidesFromSelection = useLogoStore((s) => s.makeGuidesFromSelection)

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
        data-canvas-cover
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
          <GuidesMenu />
          <EditorButton title="Turn each outline of the selection into a guide. The shapes go." onClick={makeGuidesFromSelection}>
            Make guide
          </EditorButton>
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

/** Guides ▸ Construction and Tangent frame: guides for the selected shapes, linked so they follow them. */
function GuidesMenu() {
  const addConstructionGuides = useLogoStore((s) => s.addConstructionGuides)
  const addTangentFrame = useLogoStore((s) => s.addTangentFrame)
  const circles = useLogoStore((s) => tangentCircles(s) !== null)
  return (
    <Popover
      label="Guides"
      className="relative"
      panelClassName="absolute bottom-full left-0 mb-2 flex w-56 flex-col gap-1 p-1.5"
      trigger={(props) => (
        <EditorButton {...props} title="Add guides that follow the selection">
          Guides ▸
        </EditorButton>
      )}
    >
      {(close) => (
        <>
          <EditorButton
            className="justify-start"
            title="Centre lines and bounds, with the circumcircle, incircle and spokes where the shape has them"
            onClick={() => {
              addConstructionGuides()
              close()
            }}
          >
            Construction
          </EditorButton>
          <EditorButton
            className="justify-start"
            disabled={!circles}
            title={circles ? 'The four lines touching the circles from outside' : 'Select two or more circles'}
            onClick={() => {
              addTangentFrame()
              close()
            }}
          >
            Tangent frame
          </EditorButton>
        </>
      )}
    </Popover>
  )
}

/** Can Make shape turn this guide into a shape? The store's own test, so the button only shows when it acts. */
function isClosedGuide(guide: Guide): boolean {
  return closedContourOf(guide.shape) !== null
}

/** The bar for a selection of guides. */
function GuideBar() {
  const illustrator = useLogoStore((s) => s.illustrator)
  const guides = useLogoStore((s) => s.vectorDocument.guides)
  const setGuidesStyle = useLogoStore((s) => s.setGuidesStyle)
  const setGuidesLocked = useLogoStore((s) => s.setGuidesLocked)
  const deleteGuides = useLogoStore((s) => s.deleteGuides)
  const detachGuides = useLogoStore((s) => s.detachGuides)
  const makeShapeFromGuides = useLogoStore((s) => s.makeShapeFromGuides)
  const ids = useMemo(() => new Set(illustrator.selectedGuideIds ?? []), [illustrator.selectedGuideIds])
  const selected = useMemo(() => guides.filter((guide) => ids.has(guide.id)), [guides, ids])
  if (!selected.length) return null
  const alone = selected.length === 1 ? selected[0] : null
  const name = alone ? `Guide · ${alone.shape.kind}` : `${selected.length} guides`
  // As the drawer tells it: the measure, and for a guide that follows a shape its line and the shape's number.
  const described = alone ? describeGuide(alone, (id) => layerNumber(illustrator.layers, id)) : null
  const locked = selected.every((guide) => guide.locked)
  const style = selected.every((guide) => guide.style === selected[0].style) ? selected[0].style : null
  const selectedIds = selected.map((guide) => guide.id)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label="Selection"
        data-canvas-cover
        className={cn(
          FLOATING_SURFACE,
          'pointer-events-auto relative flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 p-1.5',
        )}
      >
        <p className="max-w-full truncate px-1.5 text-xs text-sidebar-text" title="Drag a guide to move it, or nudge it with the arrow keys. Guides show in the construction look and never print.">
          <span aria-live="polite">
            <span key={selectedIds.join(' ')}>{name}</span>
          </span>
          {described && <span> · {described.measure}</span>}
          {described && alone?.link && (
            <span>
              {' '}
              · {described.name}
              {described.follows && ` · ${described.follows}`}
            </span>
          )}
        </p>
        <Segmented
          label="Guide style"
          options={GUIDE_STYLE_OPTIONS}
          value={style ?? ('' as Guide['style'])}
          onChange={(next) => setGuidesStyle(selectedIds, next)}
        />
        <Divider className="max-sm:hidden" />
        <div className="flex gap-1">
          <EditorButton pressed={locked} title="A locked guide stays put: the canvas does not pick it up." onClick={() => setGuidesLocked(selectedIds, !locked)}>
            Lock
          </EditorButton>
          {selected.some((guide) => guide.link) && (
            <EditorButton title="Stop following the shape: it stays where it is." onClick={() => detachGuides(selectedIds)}>
              Detach
            </EditorButton>
          )}
          {selected.some(isClosedGuide) && (
            <EditorButton title="Turn each closed guide into a shape that adds." onClick={makeShapeFromGuides}>
              Make shape
            </EditorButton>
          )}
          <EditorButton danger onClick={() => deleteGuides(selectedIds)}>
            Delete
          </EditorButton>
        </div>
      </div>
    </div>
  )
}
