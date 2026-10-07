import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { groupRefusalOf, MAX_FILLET_RADIUS, MIN_FILLET_RADIUS, roundAllOf, tangentCircles, ungroupRefusalOf, useLogoStore, type Refused } from '../../store/logoStore.ts'
import { useActiveMark } from '../../hooks/useActiveMark.ts'
import { filletPreview } from '../../renderer/directEdit/filletPreview.ts'
import { radiusReadout } from '../../renderer/directEdit/filletEdit.ts'
import type { ResolvedFillet } from '../../engine/fillet/apply.ts'
import { BAND_FITS, bandSettings, describeCarve, MAX_SIDES, MIN_SIDES, polygonApothem, type BandFit, type BandSpec, type CarveSpec } from '../../engine/carve/spec.ts'
import { bandParts } from '../../engine/carve/band.ts'
import { bandRefitted, bandsOf, bandWith, noFitReason, type BandUpdate } from '../../engine/vector/bands.ts'
import { BandFitControl, BandSettingControl } from './BandControls.tsx'
import { editableShapeOf } from '../../engine/illustrator/layerPath.ts'
import type { IllustratorDocument, IllustratorGroup, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { closedContourOf, describeGuide } from '../../engine/vector/guides.ts'
import type { Guide, PathObject, VectorObject } from '../../engine/vector/types.ts'
import { hiddenRadiusDots, selectedGroup, selectionBox } from '../../renderer/directEdit/handleSet.ts'
import { hud } from '../../renderer/directEdit/hud.ts'
import { bandPreview } from '../../renderer/directEdit/bandPreview.ts'
import { offsetPreview } from '../../renderer/directEdit/offsetPreview.ts'
import { refusals } from '../../renderer/directEdit/refusal.ts'
import { MAX_OFFSET, offsetGeometry, offsetIsQuick, offsetName, type OffsetGeometry } from '../../engine/vector/offsets.ts'
import { cn } from '../../lib/utils.ts'
import { SliderControl } from '../controls/SliderControl.tsx'
import { Divider, EditorButton, FLOATING_SURFACE, Segmented, StepButtons, Stepper, SUMMARY_LCD, SwitchButton } from './controls.tsx'
import { RadiusSteps } from './RadiusSteps.tsx'
import { bandEnds, filletEnds, layerNumber } from './layerNumber.ts'
import { steppedPolygonSides } from './tools.ts'
import { Popover } from './Popover.tsx'
import { useShiftHeld } from './useShiftHeld.ts'
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
const GROUP_HINT = 'Double-click one of its pieces on the canvas to work on it alone (double-tap on touch). Esc, or the group\'s name in the bar, comes back.'
const FREE_SHAPE_HINT =
  'Drag the handles on the canvas to resize or turn it. Drag an edge to bend it, or click it to add a point. Double-click a point to make it sharp or smooth.'

/**
 * The selection in words: what it is, and its numbers. A recipe reads by its
 * own numbers; a free shape or several layers by the box their handles sit
 * around, turned or not, so the size and angle read at rest too, on touch
 * where nothing hovers. Hidden and locked layers take no part, as on the
 * canvas: a recipe that is the only one left reads as that recipe. Where the
 * Sides stepper shows beside it, a polygon's sides are not read twice.
 */
/** A band's fit and the fit's setting, short: "strip 60°", "bar 40", "neck r 38", "belt". */
function bandFitText(carve: BandSpec): string {
  const settings = bandSettings(carve)
  switch (carve.fit) {
    case 'belt':
      return 'belt'
    case 'bar':
      return `bar ${Math.round(settings.width)}`
    case 'strip':
      return `strip ${Math.round(settings.angle)}°`
    case 'neck':
      return `neck r ${Math.round(settings.radius)}`
    default:
      return carve.fit satisfies never
  }
}

function describeSelection(
  doc: IllustratorDocument,
  objects: VectorObject[],
  selected: IllustratorLayer[],
): { name: string; numbers: string | null } {
  const usable = selected.filter((layer) => layer.visible && !layer.locked)
  const members = usable.length ? usable : selected
  // A group reads by its name and how many pieces it holds: "Spark · radial · 3 pieces · 360 × 297".
  const group = selectedGroup(doc)
  const alone = members.length === 1 && !group ? members[0] : null
  // An offset copy is named for what it follows: "Inset −55 of 03".
  const link = alone?.link?.kind === 'offset' ? alone.link : null
  const copyName = link ? `${offsetName(link.distance)} of ${layerNumber(doc, link.of) ?? '—'}` : null
  if (alone && copyName && !alone.pathData) return { name: copyName, numbers: 'nothing left' }
  // A band by its fit and the circles it follows, "Band · strip 60° · 02, 05", and "no fit" while they allow it none.
  if (alone?.carve?.kind === 'band' && !copyName) {
    const ends = alone.link?.kind === 'band' ? ` · ${bandEnds(doc, alone.link).join(', ')}` : ''
    return { name: `Band · ${bandFitText(alone.carve)}${ends}`, numbers: alone.pathData ? null : 'no fit' }
  }
  if (alone?.carve) {
    const stepped = steppedPolygonSides(selected, doc.layers).length > 0
    const [kind, ...numbers] = describeCarve(alone.carve)
      .split(' · ')
      .filter((part) => !(stepped && / sides$/.test(part)))
    return { name: copyName ?? kind, numbers: numbers.join(' · ') || null }
  }
  const name = group ? group.name : (copyName ?? (alone ? alone.name : `${members.length} layers`))
  const pieces = group ? `${selected.length} ${selected.length === 1 ? 'piece' : 'pieces'}` : null
  const byId = new Map(objects.map((object) => [object.id, object]))
  const around = selectionBox(doc, (layer) => {
    const object = byId.get(layer.id)
    return object?.type === 'path' ? editableShapeOf(object.contours) : null
  })
  if (!around) return { name, numbers: pieces }
  const { width, height, rotation } = around.box
  const turned = Math.round(rotation) ? ` · ${Math.round(rotation)}°` : ''
  return { name, numbers: `${pieces ? `${pieces} · ` : ''}${Math.round(width)} × ${Math.round(height)}${turned}` }
}

export function SelectionBar() {
  const illustrator = useLogoStore((s) => s.illustrator)
  if (!illustrator.selectedLayerIds.length && illustrator.selectedGuideIds?.length) return <GuideBar />
  if (!illustrator.selectedLayerIds.length && illustrator.selectedFilletIds?.length) return <FilletBar />
  return <LayerBar />
}

/**
 * A fillet as the bar reads it: "Fillet · r 25", "r 18 · clamped from 25",
 * "r 18 · clamped by a neighbour", lost, or with no room at its corner.
 */
export function describeFillet(radius: number, resolved: ResolvedFillet | undefined): string {
  if (!resolved) return 'Off'
  if (resolved.lost) return noRoomWords(resolved.noRoom) ?? 'Lost its corner'
  return radiusReadout(radius, resolved)
}

/** Why a fillet whose corner is there rounds nothing: a neighbour leaves it no room, or its corner holds none; null for none of these. */
export function noRoomWords(noRoom: 'neighbour' | 'corner' | undefined): string | null {
  if (noRoom === 'neighbour') return 'No room: too close to a neighbour'
  if (noRoom === 'corner') return 'No fillet fits its corner'
  return null
}

/** What the bar says of the corners Round all leaves: "2 skipped: too close to a neighbour". */
export function skippedWords(skipped: number): string {
  return `${skipped} skipped: too close to a neighbour`
}

/** How long the HUD says what Round all skipped, in milliseconds. */
const SKIPPED_MS = 2400

/** The radii of several fillets as the bar reads them: "r 12", or "r 5–12" when they differ. */
export function describeRadii(radii: readonly number[]): string {
  const low = Math.min(...radii)
  const high = Math.max(...radii)
  return low === high ? `r ${low}` : `r ${low}–${high}`
}

/**
 * The bar for a selection of fillets: the radius as it rounds, a Radius
 * slider that shows on the canvas as the thumb moves (one undo step per
 * release, a burst of arrow keys one step) and sets every selected fillet
 * alike, Round all N like this for one alone, and Delete.
 */
function FilletBar() {
  const illustrator = useLogoStore((s) => s.illustrator)
  const document = useLogoStore((s) => s.vectorDocument)
  const setFilletsRadius = useLogoStore((s) => s.setFilletsRadius)
  const deleteFillets = useLogoStore((s) => s.deleteFillets)
  const roundAllLike = useLogoStore((s) => s.roundAllLike)
  const mark = useActiveMark()
  const ids = useMemo(() => new Set(illustrator.selectedFilletIds ?? []), [illustrator.selectedFilletIds])
  const selected = useMemo(() => document.fillets.filter((fillet) => ids.has(fillet.id)), [document.fillets, ids])
  const alone = selected.length === 1 ? selected[0] : null
  const resolved = alone ? mark.fillets?.find((fillet) => fillet.id === alone.id) : undefined
  // How many corners Round all would round, and skip: read again only when the mark or the fillets change.
  const { count: like, skipped } = useMemo(() => (alone ? roundAllOf({ vectorDocument: document }, alone.id) : { count: 0, skipped: 0 }), [alone, document])
  const byKey = useRef(false)
  const selectedKey = selected.map((fillet) => fillet.id).join(' ')
  useEffect(() => () => filletPreview.set(null), [selectedKey])
  // While the slider's thumb moves, the radius it shows.
  const preview = useSyncExternalStore(filletPreview.subscribe, filletPreview.get)
  const sliding = preview && preview.ids.join(' ') === selectedKey ? preview.radius : null
  if (!selected.length) return null
  const selectedIds = selected.map((fillet) => fillet.id)
  const name = alone ? 'Fillet' : `${selected.length} fillets`
  const numbers =
    sliding !== null
      ? `r ${sliding}`
      : alone
        ? describeFillet(alone.radius, resolved)
        : describeRadii(selected.map((fillet) => fillet.radius))
  const between = alone ? filletEnds(illustrator, alone.between) : null
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
        <p
          className={SUMMARY_LCD}
          title={`Drag its dot on the canvas to change its radius. It rounds the corner between ${between ?? 'its shapes'} and follows it as they move.`}
        >
          <span aria-live="polite">
            <span key={selectedIds.join(' ')}>{name}</span>
          </span>
          {numbers && <span className={resolved?.lost ? 'text-(--device-rec)' : undefined}> · {numbers}</span>}
          {between && <span> · {between}</span>}
        </p>
        <div
          className="w-44 max-w-full px-1.5"
          onKeyDownCapture={() => (byKey.current = true)}
          onPointerDownCapture={() => (byKey.current = false)}
        >
          {/* Several fillets of different radii start from the first one's; a move sets them all to one. */}
          <SliderControl
            label="Radius"
            value={selected[0].radius}
            min={MIN_FILLET_RADIUS}
            max={MAX_FILLET_RADIUS}
            step={1}
            scale="sqrt"
            emphasis
            onInput={(radius) => filletPreview.set({ ids: selectedIds, radius })}
            onChange={(radius) => {
              filletPreview.set(null)
              setFilletsRadius(selectedIds, radius, byKey.current ? 'fillet-radius' : undefined)
            }}
          />
        </div>
        <RadiusSteps value={selected[0].radius} onStep={(radius) => setFilletsRadius(selectedIds, radius, 'fillet-radius')} />
        <Divider className="max-sm:hidden" />
        <div className="flex gap-1">
          {/* Shown only while some corner is left to round like this one. */}
          {alone && like > 0 && (
            <EditorButton
              title={`Round every other corner like this one, between the same kinds of shape and turning the same way, at r ${alone.radius}${skipped ? `. ${skippedWords(skipped)}` : ''}`}
              onClick={() => {
                roundAllLike(alone.id)
                hud.announce(`${like} more ${like === 1 ? 'corner' : 'corners'} rounded at radius ${alone.radius}${skipped ? `; ${skippedWords(skipped)}` : ''}`)
                if (skipped) hud.hold(skippedWords(skipped), SKIPPED_MS)
              }}
            >
              Round all {like} like this
            </EditorButton>
          )}
          {alone && like > 0 && skipped > 0 && <span className="self-center px-1 text-[11px] text-muted">{skippedWords(skipped)}</span>}
          <EditorButton danger onClick={() => deleteFillets(selectedIds)}>
            Delete
          </EditorButton>
        </div>
      </div>
    </div>
  )
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
  const setSelection = useLogoStore((s) => s.setSelection)

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

  // A group of one is the group: its member's own controls wait until it is entered.
  const group = selectedGroup(illustrator)
  // Inside a group, the bar names it first, "Group 1 › Slab": a press goes back to it, as Escape does.
  const entered = illustrator.enteredGroupId ? illustrator.groups?.find((each) => each.id === illustrator.enteredGroupId) : undefined
  const roots = illustrator.selectedRootIds ?? illustrator.selectedLayerIds
  const holdsGroup = roots.some((id) => illustrator.groups?.some((each) => each.id === id))
  const selectedLayer = selectedLayers.length === 1 && !group ? selectedLayers[0] : null
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
        {/* A button like the bar's others, so it reads as one on touch too, where nothing hovers: the one tap from a piece back to its group. */}
        {entered && (
          <EditorButton
            onClick={() => setSelection([entered.id])}
            title={`Select ${entered.name}, leaving it (Esc)`}
            aria-label={`Select group ${entered.name}`}
            className="-mr-1 max-w-[40%] shrink gap-1 pr-2"
          >
            <span className="truncate">{entered.name}</span>
            <span aria-hidden="true">›</span>
          </EditorButton>
        )}
        <p
          className={SUMMARY_LCD}
          title={selectedLayer ? (selectedLayer.carve ? RECIPE_HINT : FREE_SHAPE_HINT) : group ? GROUP_HINT : undefined}
        >
          <span aria-live="polite">
            <span key={illustrator.selectedLayerIds.join(' ')}>{description?.name}</span>
          </span>
          {description?.numbers && <span> · {description.numbers}</span>}
        </p>

        {group && <GroupControls group={group} />}
        {selectedLayer?.pin && <PinnedTo target={selectedLayer.pin} />}
        {selectedLayer && <Holds id={selectedLayer.id} />}
        {selectedLayer && <Copies id={selectedLayer.id} />}
        {selectedLayer && <Bands id={selectedLayer.id} />}
        {selectedLayer?.link?.kind === 'offset' && <OffsetDistance layer={selectedLayer} />}

        <PolygonSides layers={selectedLayers} />
        {selectedLayer && !selectedLayer.link && <CornerRadius layer={selectedLayer} />}

        {/*
          A band's own controls keep together where the bar wraps, so Detach is never left on a row of its own.
          A copy of a band is made from the band: its own fit and setting would change nothing.
        */}
        {selectedLayer && (
          <div className="flex items-center gap-x-2">
            {selectedLayer.carve?.kind === 'band' && selectedLayer.link?.kind !== 'offset' && <BandMenu layer={selectedLayer} />}
            <Segmented
              label="Add or cut"
              options={OPERATION_OPTIONS}
              value={selectedLayer.operation}
              onChange={(operation) => setIllustratorLayerOperation(selectedLayer.id, operation)}
            />
            {selectedLayer.link?.kind === 'band' && <DetachBand layer={selectedLayer} />}
          </div>
        )}

        {selectedPoint && (
          <>
            <Divider className="max-sm:hidden" />
            <div className="flex items-center gap-1" role="group" aria-label={pointLabel}>
              <span aria-hidden="true" className="px-1 engraved">
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

        {roots.length >= 2 && <GroupButton />}

        {/* Not with a group in the selection: they would join its pieces' raw outlines, dropping its isolation and their Add or Cut. */}
        {selectedLayers.length >= 2 && !holdsGroup && (
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
          {selectedLayer && selectedLayer.link?.kind !== 'offset' && selectedLayer.pathData && <OffsetMenu layer={selectedLayer} />}
          <GuidesMenu />
          <EditorButton title="Turn each outline of the selection into a guide. The shapes go." onClick={makeGuidesFromSelection}>
            Make guide
          </EditorButton>
          {group && (
            <EditorButton title="Copy the group with everything in it" onClick={() => duplicateIllustratorLayer(group.id)}>
              Copy
            </EditorButton>
          )}
          {selectedLayer && (
            <EditorButton
              title={selectedLayer.link && !selectedLayer.pathData ? 'Nothing is left of it to copy: it comes back when what it follows allows it' : undefined}
              disabled={Boolean(selectedLayer.link) && !selectedLayer.pathData}
              onClick={() => duplicateIllustratorLayer(selectedLayer.id)}
            >
              Copy
            </EditorButton>
          )}
          <EditorButton danger onClick={() => deleteIllustratorLayers()}>
            Delete
          </EditorButton>
        </div>
      </div>
    </div>
  )
}

/**
 * A selected group's own controls: Isolate cuts, which keeps its cuts to
 * itself, so they cut only what is in it; then, while it isolates them,
 * whether the group adds or cuts as one; and Ungroup. Each is one undo step.
 */
function GroupControls({ group }: { group: IllustratorGroup }) {
  const setGroupIsolated = useLogoStore((s) => s.setGroupIsolated)
  const setGroupOperation = useLogoStore((s) => s.setGroupOperation)
  return (
    <div className="flex items-center gap-x-2" role="group" aria-label="Group">
      <SwitchButton
        label="Isolate cuts"
        checked={group.isolated}
        onChange={(isolated) => setGroupIsolated(group.id, isolated)}
        title={group.isolated ? 'Its cuts cut only what is in it' : 'Keep its cuts to itself: they cut only what is in it'}
      />
      {group.isolated && (
        <Segmented
          label="Add or cut"
          options={OPERATION_OPTIONS}
          value={group.operation}
          onChange={(operation) => setGroupOperation(group.id, operation)}
        />
      )}
      <UngroupButton />
    </div>
  )
}

/**
 * Ungroup, as Cmd+Shift+G does: for touch, which has no keyboard. Dimmed,
 * saying why, when ungrouping would change the mark or the group is locked.
 */
export function UngroupButton() {
  const ungroupSelection = useLogoStore((s) => s.ungroupSelection)
  const refusal = useLogoStore((s) => ungroupRefusalOf(s)?.words ?? null)
  return (
    <RefusableButton
      label="Ungroup"
      title="Ungroup (Cmd+Shift+G): its members stay where they are"
      refusal={refusal}
      refused={() => ungroupRefusalOf(useLogoStore.getState())}
      onClick={ungroupSelection}
    />
  )
}

/**
 * Group, as Cmd+G does: for touch, which has no keyboard. Dimmed, saying
 * why, when gathering the selection would change the mark.
 */
export function GroupButton() {
  const groupSelection = useLogoStore((s) => s.groupSelection)
  const refusal = useLogoStore((s) => groupRefusalOf(s)?.words ?? null)
  return (
    <RefusableButton label="Group" title="Group (Cmd+G)" refusal={refusal} refused={() => groupRefusalOf(useLogoStore.getState())} onClick={groupSelection} />
  )
}

/**
 * A command button that may be refused: then it is dimmed and named with
 * the reason, and a press, which a tooltip never answers on touch, says
 * the reason on the canvas as the key does, with what is in the way outlined.
 */
function RefusableButton({
  label,
  title,
  refusal,
  refused,
  onClick,
}: {
  label: string
  title: string
  refusal: string | null
  refused: () => Refused | null
  onClick: () => void
}) {
  return (
    <EditorButton
      aria-disabled={refusal !== null || undefined}
      title={refusal ?? title}
      aria-label={refusal ? `${label}: ${refusal}` : label}
      onClick={() => {
        const now = refused()
        if (now) refusals.say(now)
        else onClick()
      }}
    >
      {label}
    </EditorButton>
  )
}

/**
 * The sides of the selected polygons, a side more or fewer a press, one undo
 * step each, as [ and ] do: on touch the only way. Nothing unless the
 * selection holds a polygon, or an offset copy of one, which steps the
 * polygon it follows; other shapes in it stay as they are. The Punch
 * tool's own Sides is the next punch's; this one is always the selection's.
 */
function PolygonSides({ layers }: { layers: IllustratorLayer[] }) {
  const stepPolygonSides = useLogoStore((s) => s.stepPolygonSides)
  const all = useLogoStore((s) => s.illustrator.layers)
  const sides = steppedPolygonSides(layers, all)
  if (!sides.length) return null
  const same = sides.every((count) => count === sides[0]) ? sides[0] : null
  return (
    <Stepper
      label="Sides"
      name="Sides of the selected polygons"
      value={same}
      min={MIN_SIDES}
      max={MAX_SIDES}
      lessLabel="Take a side off ([)"
      moreLabel="Add a side (])"
      title="Sides ([ and ])"
      onStep={(step) => {
        stepPolygonSides(step)
        // A copy's sides are its source's: say which moved, as [ and ] do.
        if (layers.every((layer) => layer.link?.kind === 'offset')) {
          hud.hold('steps the source', SOURCE_STEP_MS)
          hud.announce(`steps the source \u00b7 ${useLogoStore.getState().ui.carve.polygonSides} sides`)
        }
      }}
    />
  )
}

/** How long the bar's word on a stepped source stays, as [ and ] keep theirs. */
const SOURCE_STEP_MS = 1500

/** The largest corner radius a recipe draws: a polygon's apothem, half a slab's shorter side. */
function cornerLimit(carve: CarveSpec): number | null {
  if (carve.kind === 'polygon') return polygonApothem(carve)
  if (carve.kind === 'slab') return Math.min(carve.width, carve.height) / 2
  return null
}

/**
 * The corner radius of a slab or polygon too small on screen for its rounding
 * dot, which would cover its middle: in whole units, from sharp to as round
 * as it goes. One undo step a release.
 */
function CornerRadius({ layer }: { layer: IllustratorLayer }) {
  const commitLayerEdits = useLogoStore((s) => s.commitLayerEdits)
  const dotless = useSyncExternalStore(hiddenRadiusDots.subscribe, hiddenRadiusDots.get)
  const carve = layer.carve
  const limit = carve ? cornerLimit(carve) : null
  if (!carve || limit === null || !layer.visible || layer.locked || !dotless.split(' ').includes(layer.id)) return null
  const now = carve.kind === 'polygon' ? carve.cornerRadius : carve.kind === 'slab' ? carve.radius : 0
  // The last step is as round as it goes, a whole number or not.
  const top = Math.ceil(limit - 1e-9)
  const exact = (value: number) => Math.min(value, limit)
  return (
    <div className="w-36 px-1.5" title="Its rounding dot would cover its middle at this size: round its corners here, or zoom in">
      <SliderControl
        label="Corner"
        value={Math.min(Math.round(now), top)}
        min={0}
        max={top}
        step={1}
        format={(value) => String(Math.round(exact(value)))}
        onChange={(value) => {
          const next = exact(value)
          if (Math.abs(next - now) < 1e-9) return
          const edited: CarveSpec = carve.kind === 'polygon' ? { ...carve, cornerRadius: next } : carve.kind === 'slab' ? { ...carve, radius: next } : carve
          commitLayerEdits({ label: 'Round corners', edits: [{ layerId: layer.id, carve: edited }], select: [layer.id] })
        }}
      />
    </div>
  )
}

/** A recipe's centre pinned to another shape's: which, by its number, and a way to let go. */
function PinnedTo({ target }: { target: string }) {
  const illustrator = useLogoStore((s) => s.illustrator)
  const unpinSelection = useLogoStore((s) => s.unpinSelection)
  const number = layerNumber(illustrator, target)
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Pin">
      <span className="px-1 text-xs text-muted" title="Its centre stays on that shape's centre when the shape moves or resizes">
        Pinned to {number ?? '—'}
      </span>
      <EditorButton
        title="Let go of the pin: the shape stays where it is"
        onClick={() => {
          unpinSelection()
          hud.announce('Unpinned: it no longer stays on the centre it was pinned to')
        }}
      >
        Unpin
      </EditorButton>
    </div>
  )
}

/** A shape that recipes are pinned to: which, by their numbers, and a way to let them all go. Nothing when none is. */
function Holds({ id }: { id: string }) {
  const illustrator = useLogoStore((s) => s.illustrator)
  const releasePinsTo = useLogoStore((s) => s.releasePinsTo)
  const numbers = illustrator.layers.flatMap((layer) => (layer.pin === id ? [layerNumber(illustrator, layer.id)!] : []))
  if (!numbers.length) return null
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Pins held">
      <span className="px-1 text-xs text-muted" title="Their centres stay on this shape's centre when it moves or resizes">
        Holds {numbers.join(', ')}
      </span>
      <EditorButton
        title="Let go of every pin held to this shape: the shapes stay where they are"
        onClick={() => {
          releasePinsTo(id)
          hud.announce(numbers.length > 1 ? `Released ${numbers.join(', ')}: they no longer stay on this centre` : `Released ${numbers[0]}: it no longer stays on this centre`)
        }}
      >
        Release
      </EditorButton>
    </div>
  )
}

/** A shape that offset copies follow: which, by their numbers. Nothing when none does. */
function Copies({ id }: { id: string }) {
  const illustrator = useLogoStore((s) => s.illustrator)
  const numbers = illustrator.layers.flatMap((layer) => (layer.link?.kind === 'offset' && layer.link.of === id ? [layerNumber(illustrator, layer.id)!] : []))
  if (!numbers.length) return null
  return (
    <span className="px-1 text-xs text-muted" title="Offset copies that follow this shape as it changes">
      Copies {numbers.join(', ')}
    </span>
  )
}

/** A circle that bands follow: which, by their numbers. Nothing when none does. */
function Bands({ id }: { id: string }) {
  const illustrator = useLogoStore((s) => s.illustrator)
  const numbers = bandsOf(illustrator.layers, id).map((band) => layerNumber(illustrator, band)!)
  if (!numbers.length) return null
  return (
    <span className="px-1 text-xs text-muted" title="Bands that follow this circle as it moves and resizes">
      Bands {numbers.join(', ')}
    </span>
  )
}

/**
 * Band…: the band's fit and the fit's setting, in a popover that keeps the
 * bar short. One undo step a release, a burst of arrow keys one too; the
 * canvas shows the band as the slider moves. A fit its circles leave no
 * room for is disabled, its title saying why, and a setting let go of where
 * they allow none is refused and said: a band's own controls never empty it.
 * While it has no fit, it says why as it is selected.
 */
function BandMenu({ layer }: { layer: IllustratorLayer }) {
  const carve = layer.carve?.kind === 'band' ? layer.carve : null
  const empty = !layer.pathData
  // Read out once as an empty band is selected, or as it empties: not again as its recipe follows its circles.
  const reason = carve && empty ? noFitReason(carve) : null
  const said = useRef<string | null>(null)
  useEffect(() => {
    const key = reason && `${layer.id} ${reason}`
    if (key && said.current !== key) hud.announce(`No fit: ${reason}`)
    said.current = key
  }, [layer.id, reason])
  if (!carve) return null
  return (
    <Popover
      label="This band"
      // On a phone it opens across the bar, which it is placed against, so it never runs off the screen.
      className="sm:relative"
      panelClassName="absolute bottom-full mb-2 flex flex-col gap-2.5 p-3 max-sm:inset-x-0 sm:left-0 sm:w-64"
      trigger={(props) => (
        <EditorButton {...props} title="The band's fit and its setting">
          Band…
        </EditorButton>
      )}
    >
      <BandSettings layer={layer} carve={carve} />
    </Popover>
  )
}

function BandSettings({ layer, carve }: { layer: IllustratorLayer; carve: BandSpec }) {
  const setBand = useLogoStore((s) => s.setBand)
  // A preview left by a slider goes with the band's controls.
  useEffect(() => () => bandPreview.set(null), [layer.id])
  const fits = Boolean(layer.pathData)
  // A band that fits is refused only the fits its circles leave no room for at any setting: their titles say why.
  // Any other fit takes its setting there, or the nearest its circles allow.
  const refused: Partial<Record<BandFit, string>> = {}
  if (fits) {
    for (const fit of BAND_FITS) if (!bandRefitted(carve, fit)) refused[fit] = noFitReason(bandWith(carve, { fit }), true)
  }
  // False when refused: the slider goes back to the band's setting.
  const change = (update: BandUpdate, merge?: 'band-setting'): boolean => {
    bandPreview.set(null)
    const next = bandWith(carve, update)
    if (fits && !update.fit && !bandParts(next)) {
      hud.hold('no fit', NO_FIT_MS)
      hud.announce(`No fit: ${noFitReason(next)}`)
      return false
    }
    setBand(layer.id, update, merge)
    return true
  }
  return (
    <>
      <span aria-hidden="true" className="engraved">
        This band
      </span>
      <BandFitControl fit={carve.fit} refused={refused} onChange={(fit) => change({ fit })} />
      <BandSettingControl
        fit={carve.fit}
        values={bandSettings(carve)}
        className="min-w-0 px-1.5"
        onChange={(update, byKey) => change(update, byKey ? 'band-setting' : undefined)}
        onInput={(update) => {
          const next = bandWith(carve, update)
          bandPreview.set({ id: layer.id, carve: next })
          if (fits && !bandParts(next)) hud.hold('no fit', NO_FIT_MS)
        }}
      />
    </>
  )
}

/** How long "no fit" shows when a band's setting is refused. */
const NO_FIT_MS = 1200

/** Detach: the band keeps its geometry and recipe and stops following its circles. An empty one, with nothing to keep, waits. */
function DetachBand({ layer }: { layer: IllustratorLayer }) {
  const detachBands = useLogoStore((s) => s.detachBands)
  const empty = !layer.pathData
  return (
    <EditorButton
      title={empty ? 'Nothing is left of it to keep: it comes back when its circles allow it' : 'Stop following the circles: the band stays as it is'}
      disabled={empty}
      onClick={() => {
        detachBands([layer.id])
        hud.announce('Detached: it no longer follows its circles')
      }}
    >
      Detach
    </EditorButton>
  )
}

/** The longest offset the bar makes, out or in. */
const OFFSET_REACH = 120

/**
 * An offset distance as the slider lands it: whole units, steps of 5 with
 * Shift, and never 0, which offsets nothing: coming from `was`, it steps
 * over 0 to the other side.
 */
function landDistance(value: number, shift: boolean, was: number): number {
  const landed = shift ? Math.round(value / 5) * 5 : Math.round(value)
  if (landed !== 0) return landed
  const step = shift ? 5 : 1
  return was < 0 ? step : -step
}

/**
 * A unit in or out from a distance, over 0 to the other side, or 5 with
 * Shift or a long press, which steps again while held.
 */
function DistanceSteps({ value, onStep }: { value: number; onStep: (next: number) => void }) {
  return (
    <StepButtons
      value={value}
      label="Distance steps"
      land={(from, by, five) => {
        // A copy opened further out than the slider reaches steps from where it is, never jumps back to the slider's end.
        const reach = Math.min(MAX_OFFSET, Math.max(OFFSET_REACH, Math.abs(from)))
        return Math.max(-reach, Math.min(reach, landDistance(from + (five ? 5 : 1) * by, five, from)))
      }}
      onStep={onStep}
      less={{ label: 'In 1', title: 'In 1 (Shift or hold: 5)', disabled: value <= -OFFSET_REACH }}
      more={{ label: 'Out 1', title: 'Out 1 (Shift or hold: 5)', disabled: value >= OFFSET_REACH }}
    />
  )
}

/** Offset…: opens the panel that sets and makes an offset copy of the selected shape. */
function OffsetMenu({ layer }: { layer: IllustratorLayer }) {
  return (
    <Popover
      label="Offset"
      className="relative"
      panelClassName="absolute bottom-full left-0 mb-2 flex w-60 flex-col gap-2.5 p-3"
      trigger={(props) => (
        <EditorButton {...props} title="A copy larger or smaller by a set distance, which follows this shape">
          Offset…
        </EditorButton>
      )}
    >
      {(close) => <OffsetPanel layer={layer} close={close} />}
    </Popover>
  )
}

/** How long a slider must rest before the general method makes an offset it has not made yet. */
const SETTLE_MS = 150

/**
 * A source's offset at a distance, as a live control reads it: at once when
 * it is exact or already made, else once the distance has rested a moment,
 * so a large free shape does not hold up every step of a slider. Undefined
 * while it is being waited for.
 */
function useSettledOffset(source: PathObject | null, distance: number): OffsetGeometry | null | undefined {
  const quick = source !== null && offsetIsQuick(source, distance)
  const [settled, setSettled] = useState<{ source: PathObject; distance: number; made: OffsetGeometry | null } | null>(null)
  useEffect(() => {
    if (!source || quick) return
    const timer = window.setTimeout(() => setSettled({ source, distance, made: offsetGeometry(source, distance) }), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [source, distance, quick])
  if (!source) return null
  if (quick) return offsetGeometry(source, distance)
  return settled?.source === source && settled.distance === distance ? settled.made : undefined
}

/** The ends of a distance slider: left goes in, right goes out. */
const DISTANCE_ENDS = ['in', 'out'] as const

/** What an outset as a cut of a filled shape does, said where its distance is set. */
const CUTS_ALL_AWAY = 'Cuts the whole shape away.'
/** What an inset of a filled shape added rather than cut does: nothing that shows. */
const INSIDE_ITS_SOURCE = 'Lies inside its source \u2014 As cut makes a ring'

/**
 * Set as Offset… makes a copy, read as the copy's own Distance appears in
 * the bar: the keyboard goes on to it, since the popover's button, and the
 * Offset… it came from, go as the copy is selected.
 */
let focusCopyDistance = false

/**
 * Offset…: a copy of the selected shape, larger or smaller by a distance,
 * that follows it. The popover shows it on the canvas as the slider moves,
 * dashed, with the ink as it would be, so an inset as a cut shows its ring.
 * Its button makes it, one undo step, and selects it.
 *
 * As cut follows the side of 0 until it is set by hand: on for an inset of
 * a filled shape, which makes a ring, and off for an outset, which as a cut
 * would take the whole shape away. A copy of a cut cuts as its shape does.
 */
function OffsetPanel({ layer, close }: { layer: IllustratorLayer; close: () => void }) {
  const addOffset = useLogoStore((s) => s.addOffset)
  const found = useLogoStore((s) => s.vectorDocument.objects.find((object) => object.id === layer.id))
  const source = found?.type === 'path' ? found : null
  const [distance, setDistance] = useState(-20)
  const [chosen, setChosen] = useState<boolean | null>(null)
  const cutSource = layer.operation === 'subtract'
  const asCut = cutSource || (chosen ?? distance < 0)
  const shift = useShiftHeld()
  useEffect(() => {
    offsetPreview.set({ of: layer.id, distance, asCut })
  }, [layer.id, distance, asCut])
  // The preview goes with the panel.
  useEffect(() => () => offsetPreview.set(null), [])
  const made = useSettledOffset(source, distance)
  const empty = made === null
  const action = `${asCut ? 'Cut' : 'Add'} ${offsetName(distance).toLowerCase()}`
  return (
    <>
      <SliderControl
        label="Distance"
        value={distance}
        min={-OFFSET_REACH}
        max={OFFSET_REACH}
        step={1}
        format={offsetName}
        mark={0}
        emphasis
        ends={DISTANCE_ENDS}
        adjust={(value) => landDistance(value, shift.current, distance)}
        onInput={setDistance}
        onChange={setDistance}
      />
      <div className="-mt-1 flex justify-end">
        <DistanceSteps value={distance} onStep={setDistance} />
      </div>
      {cutSource ? (
        <p className="text-xs text-muted">Cuts, as its shape does.</p>
      ) : (
        <SwitchButton label="As cut" checked={asCut} onChange={setChosen} title="Place the copy as a cut: an inset then makes a ring" />
      )}
      {!cutSource && asCut && distance > 0 && <p className="text-xs text-muted">{CUTS_ALL_AWAY}</p>}
      {!asCut && distance < 0 && layer.operation === 'add' && <p className="text-xs text-muted">{INSIDE_ITS_SOURCE}</p>}
      {empty && (
        <p className="text-xs text-muted" role="status">
          Nothing is left at this distance.
        </p>
      )}
      <EditorButton
        primary
        disabled={empty}
        onClick={() => {
          // Read by the copy's bar as it appears, in this same event; forgotten after it.
          focusCopyDistance = true
          window.setTimeout(() => (focusCopyDistance = false))
          addOffset(layer.id, distance, asCut)
          hud.announce(`${offsetName(distance)} added${asCut ? ' as a cut' : ''}`)
          close()
        }}
      >
        {action}
      </EditorButton>
    </>
  )
}

/**
 * An offset copy's distance from its source, changed live on the canvas as
 * the slider moves and written when it is let go, one undo step; a burst of
 * arrow keys, or of presses on its steps, is one undo step too. And Detach,
 * which keeps the copy as it is and stops it following. A cut copy of a
 * filled shape taken past 0 cuts the whole shape away, and says so, as the
 * popover does. On a phone it takes a row of its own.
 */
function OffsetDistance({ layer }: { layer: IllustratorLayer }) {
  const setOffsetDistance = useLogoStore((s) => s.setOffsetDistance)
  const detachOffsets = useLogoStore((s) => s.detachOffsets)
  const link = layer.link?.kind === 'offset' ? layer.link : null
  const sourceAdds = useLogoStore((s) => s.illustrator.layers.find((each) => each.id === link?.of)?.operation === 'add')
  const shift = useShiftHeld()
  // Whether the slider was last moved by a key, whose every press it lets go on.
  const byKey = useRef(false)
  const [draft, setDraft] = useState<number | null>(null)
  const [focused] = useState(() => focusCopyDistance)
  // A preview left by a slider still moving goes with the copy.
  useEffect(() => () => offsetPreview.set(null), [layer.id])
  // The thumb's last place goes once the distance is written, or another copy, an undo or a redo sets it.
  useEffect(() => setDraft(null), [layer.id, link?.distance])
  const cutsAll = link !== null && layer.operation === 'subtract' && sourceAdds && (draft ?? link.distance) > 0
  // An empty copy has nothing to keep: Detach waits until its source leaves something at its distance.
  const empty = !layer.pathData
  // Said as the thumb crosses into it, not again on every step past it.
  useEffect(() => {
    if (cutsAll) hud.announce(CUTS_ALL_AWAY)
  }, [cutsAll])
  if (!link) return null
  const show = (next: number) => {
    setDraft(next)
    offsetPreview.set({ of: link.of, distance: next, asCut: layer.operation === 'subtract', replaces: layer.id })
  }
  return (
    <div className="flex items-center gap-1 max-sm:w-full max-sm:flex-wrap" role="group" aria-label="Offset">
      <div
        className="min-w-0 px-1.5 max-sm:order-last max-sm:basis-full sm:w-36"
        title="How far the copy lies from the shape it follows"
        onKeyDownCapture={() => (byKey.current = true)}
        onPointerDownCapture={() => (byKey.current = false)}
      >
        <SliderControl
          label="Distance"
          value={link.distance}
          min={-OFFSET_REACH}
          max={OFFSET_REACH}
          step={1}
          format={offsetName}
          mark={0}
          emphasis
          autoFocus={focused}
          adjust={(value) => landDistance(value, shift.current, link.distance)}
          onInput={show}
          onChange={(next) => {
            setDraft(null)
            offsetPreview.set(null)
            setOffsetDistance(layer.id, next, byKey.current ? 'offset-distance' : undefined)
          }}
        />
      </div>
      <DistanceSteps value={link.distance} onStep={(next) => setOffsetDistance(layer.id, next, 'offset-distance')} />
      {/* On a phone the note takes a line of its own under the slider, which keeps its width. */}
      {cutsAll && (
        <p className="max-w-32 px-1 text-xs text-muted max-sm:order-last max-sm:max-w-none max-sm:basis-full">{CUTS_ALL_AWAY}</p>
      )}
      <EditorButton
        title={empty ? 'Nothing is left of it to keep: it comes back when its shape grows' : 'Stop following the shape: the copy stays as it is'}
        disabled={empty}
        onClick={() => {
          detachOffsets([layer.id])
          hud.announce('Detached: it no longer follows its shape')
        }}
      >
        Detach
      </EditorButton>
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
  const described = alone ? describeGuide(alone, (id) => layerNumber(illustrator, id)) : null
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
        <p className={SUMMARY_LCD} title="Drag a guide to move it, or nudge it with the arrow keys. Guides show in the construction look and never print.">
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
