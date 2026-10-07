import type { IllustratorDocument, IllustratorGroup, IllustratorLayer, IllustratorSource, PointSelection } from '../illustrator/types.ts'
import { contoursToPathData } from './pathSerialization.ts'
import type { GroupObject, PathObject, VectorDocument, VectorDocumentSource, VectorObject, VectorSelection } from './types.ts'

/**
 * The document seen as layers: the read model the canvas, the controller,
 * the panels and the e2e checks work from. It is derived, never written.
 * Each path is one layer, its contours joined in its path data, and its
 * transform always the identity: nothing in the document holds one.
 */

const IDENTITY = { dx: 0, dy: 0, scale: 1, rotation: 0 } as const

function sourceFromVector(source: VectorDocumentSource | null): IllustratorSource {
  return {
    seed: source?.seed ?? 0,
    modeId: source?.modeId ?? 'generated',
    generatorId: source?.generatorId ?? 'unknown',
    generatorVersion: source?.generatorVersion ?? 'v0',
  }
}

// Objects are immutable once in a document, so their layer view can be
// reused: a selection change then costs nothing per path.
const layerCache = new WeakMap<PathObject, IllustratorLayer>()

/** A path's layer view. */
export function vectorObjectToLayer(object: PathObject): IllustratorLayer {
  const cached = layerCache.get(object)
  if (cached) return cached
  const layer: IllustratorLayer = {
    id: object.id,
    name: object.name,
    sourceShapeId: object.sourceShapeId,
    operation: object.operation,
    visible: object.visible,
    locked: object.locked,
    pathData: contoursToPathData(object.contours),
    fillRule: object.fillRule,
    transform: { ...IDENTITY },
    ...(object.carve ? { carve: object.carve } : {}),
    ...(object.frame && !object.carve ? { frameRotation: object.frame.rotation } : {}),
    ...(object.parentId !== null ? { parentId: object.parentId } : {}),
    ...(object.contours.length > 1 ? { contourCount: object.contours.length } : {}),
    ...(object.pin ? { pin: object.pin.centreOf } : {}),
    ...(object.link ? { link: object.link } : {}),
  }
  layerCache.set(object, layer)
  return layer
}

// A member of a hidden group shows as hidden: kept per layer view.
const hiddenCache = new WeakMap<IllustratorLayer, IllustratorLayer>()

function hiddenLayer(layer: IllustratorLayer): IllustratorLayer {
  if (!layer.visible) return layer
  let hidden = hiddenCache.get(layer)
  if (!hidden) {
    hidden = { ...layer, visible: false }
    hiddenCache.set(layer, hidden)
  }
  return hidden
}

const groupCache = new WeakMap<GroupObject, IllustratorGroup>()

function groupView(group: GroupObject): IllustratorGroup {
  let view = groupCache.get(group)
  if (!view) {
    view = {
      id: group.id,
      name: group.name,
      ...(group.parentId !== null ? { parentId: group.parentId } : {}),
      visible: group.visible,
      locked: group.locked,
      isolated: group.isolated,
      operation: group.operation,
    }
    groupCache.set(group, view)
  }
  return view
}

interface ObjectsView {
  layers: IllustratorLayer[]
  groups: IllustratorGroup[] | undefined
  /** Every path inside each group, in stack order. */
  leaves: Map<string, string[]>
}

// The view is kept per objects array, so a selection change hands the canvas
// the very same layers and it does not redraw them.
const viewCache = new WeakMap<VectorObject[], ObjectsView>()

function viewOf(objects: VectorObject[]): ObjectsView {
  const cached = viewCache.get(objects)
  if (cached) return cached
  const hasGroups = objects.some((object) => object.type === 'group')
  let view: ObjectsView
  if (!hasGroups) {
    const layers = objects.filter((object): object is PathObject => object.type === 'path').map(vectorObjectToLayer)
    view = { layers, groups: undefined, leaves: new Map() }
  } else {
    const byId = new Map(objects.map((object) => [object.id, object]))
    const ancestors = (object: VectorObject): GroupObject[] => {
      const chain: GroupObject[] = []
      let parent = object.parentId === null ? undefined : byId.get(object.parentId)
      while (parent && parent.type === 'group' && !chain.includes(parent)) {
        chain.push(parent)
        parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
      }
      return chain
    }
    const layers: IllustratorLayer[] = []
    const leaves = new Map<string, string[]>()
    for (const object of objects) {
      if (object.type !== 'path') continue
      const chain = ancestors(object)
      const layer = vectorObjectToLayer(object)
      layers.push(chain.every((group) => group.visible) ? layer : hiddenLayer(layer))
      for (const group of chain) leaves.set(group.id, [...(leaves.get(group.id) ?? []), object.id])
    }
    const groups = objects.filter((object): object is GroupObject => object.type === 'group').map(groupView)
    view = { layers, groups, leaves }
  }
  viewCache.set(objects, view)
  return view
}

/** The layers of some objects: one per path, in stack order. */
export function layersOf(objects: VectorObject[]): IllustratorLayer[] {
  return viewOf(objects).layers
}

/**
 * The document and its selection as layers. A selected group stands for
 * every path inside it. With `previous`, an unchanged selection keeps its
 * arrays, so the canvas does not redraw the overlay for it.
 */
export function vectorDocumentToIllustratorDocument(
  document: VectorDocument,
  selection: VectorSelection = { targets: [] },
  previous?: IllustratorDocument | null,
): IllustratorDocument {
  const view = viewOf(document.objects)
  const ids = [
    ...new Set(
      selection.targets.flatMap((target) => (target.type === 'guide' ? [] : (view.leaves.get(target.objectId) ?? [target.objectId]))),
    ),
  ]
  const selectedLayerIds = previous && sameIds(previous.selectedLayerIds, ids) ? previous.selectedLayerIds : ids
  const guideIds = selection.targets.flatMap((target) => (target.type === 'guide' ? [target.guideId] : []))
  const selectedGuideIds =
    previous?.selectedGuideIds && sameIds(previous.selectedGuideIds, guideIds) ? previous.selectedGuideIds : guideIds
  const point = pointSelectionOf(selection)
  const pointSelection = previous && samePoint(previous.pointSelection, point) ? previous.pointSelection : point
  return {
    id: previous?.id ?? document.id,
    source: sourceFromVector(document.source),
    layers: view.layers,
    selectedLayerIds,
    pointSelection,
    mode: previous?.mode ?? (point ? 'points' : 'object'),
    ...(view.groups ? { groups: view.groups } : {}),
    guides: document.guides,
    selectedGuideIds,
  }
}

function pointSelectionOf(selection: VectorSelection): PointSelection | null {
  for (const target of selection.targets) {
    if (target.type === 'object' || target.type === 'guide') continue
    return {
      layerId: target.objectId,
      contourIndex: target.contourIndex,
      segmentIndex: target.segmentIndex,
      handle: target.type === 'anchor' ? 'anchor' : target.handle,
    }
  }
  return null
}

/** The selection a layer view describes: a selected point, or the selected layers. */
export function pointSelectionToVectorSelection(
  pointSelection: PointSelection | null,
  selectedLayerIds: string[],
): VectorSelection {
  if (pointSelection) {
    const { layerId: objectId, contourIndex, segmentIndex } = pointSelection
    return {
      targets: [
        pointSelection.handle === 'anchor' || pointSelection.handle === null
          ? { type: 'anchor', objectId, contourIndex, segmentIndex }
          : { type: 'handle', objectId, contourIndex, segmentIndex, handle: pointSelection.handle },
      ],
    }
  }
  return { targets: selectedLayerIds.map((objectId) => ({ type: 'object', objectId })) }
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function samePoint(a: PointSelection | null, b: PointSelection | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.layerId === b.layerId &&
    a.contourIndex === b.contourIndex &&
    a.segmentIndex === b.segmentIndex &&
    a.handle === b.handle
  )
}
