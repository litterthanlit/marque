import { distance, dot, projectOnCubic, straightCubic, sub, type Vec } from '../../engine/path/bezier.ts'
import {
  boxContains,
  boxFrameSides,
  DEFAULT_HANDLE_LAYOUT,
  handleFraction,
  isCornerHandle,
  shapeBoundsInFrame,
  type OrientedBox,
} from '../../engine/box/box.ts'
import { curveOf, isCurveStraight, type EditablePath, type EditableShape } from '../../engine/path/editPath.ts'
import type { CarveHandle } from '../../engine/carve/edit.ts'
import { locateCarveGrab, type CarveGrab } from '../../engine/carve/edit.ts'
import type { HandleSet } from './handleSet.ts'
import { carveThickness } from '../../engine/carve/spec.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'

/** What is under the pointer, in priority order of the cases below. */
export type Zone =
  /** `ring`: just outside a corner of the handles' frame, where a drag turns it like the knob does. */
  | { kind: 'handle'; set: HandleSet; handle: CarveHandle; ring?: boolean }
  /** A point of a free shape: `index` on contour `contourIndex`. */
  | { kind: 'anchor'; layerId: string; contourIndex: number; index: number }
  | { kind: 'bezier'; layerId: string; contourIndex: number; index: number; which: 'in' | 'out' }
  | {
      kind: 'edge'
      layerId: string
      free: { contourIndex: number; curveIndex: number; t: number } | null
      carve: CarveGrab | null
      point: Vec
    }
  | { kind: 'body'; layerId: string }
  /** Inside a box's frame, off every shape: a drag moves the whole selection. */
  | { kind: 'frame'; set: HandleSet }
  | { kind: 'empty' }

export const EMPTY_ZONE: Zone = { kind: 'empty' }

export interface HitContext {
  doc: IllustratorDocument
  /** Invisible hit areas from the last render, in project space, keyed by layer id. */
  items: Map<string, paper.PathItem>
  ink: paper.PathItem | null
  /** Project-space position of the layer-space origin (the view centre). */
  center: Vec
  selectedIds: string[]
  /** The single selected free shape, baked, in layer space: every contour. */
  freePath: { layerId: string; shape: EditableShape } | null
  /** Its selected point, if any. */
  anchor: { contourIndex: number; index: number } | null
  /** The selection's handles, layer space: one recipe's own, or a box around one free shape or several layers. */
  handles: HandleSet | null
  /** Layer units per CSS pixel. */
  unitsPerPx: number
  touch: boolean
  /** Edge bending enabled. */
  edges: boolean
  /** Any free layer's contours with its transform baked in (cached by the caller). */
  freePathOf(layer: IllustratorLayer): EditableShape | null
}

function px(ctx: HitContext, value: number): number {
  return value * ctx.unitsPerPx * (ctx.touch ? 2 : 1)
}

const toProject = (ctx: HitContext, v: Vec): Vec => ({ x: v.x + ctx.center.x, y: v.y + ctx.center.y })
const toLayer = (ctx: HitContext, v: Vec): Vec => ({ x: v.x - ctx.center.x, y: v.y - ctx.center.y })

function contains(item: paper.PathItem | undefined, p: Vec): boolean {
  return Boolean(item && item.contains(p as unknown as paper.Point))
}

function layerThickness(layer: IllustratorLayer, item: paper.PathItem): number {
  if (layer.carve) return carveThickness(layer.carve)
  const shape = item as unknown as { area: number; length: number }
  return shape.length > 0 ? (2 * Math.abs(shape.area)) / shape.length : 0
}

/** The padding of a box's frame, in layer units. */
function framePad(ctx: HitContext): number {
  return DEFAULT_HANDLE_LAYOUT.pad * ctx.unitsPerPx
}

function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

function isSideId(handle: CarveHandle): boolean {
  if (handle.kind !== 'resize' && handle.kind !== 'scale') return false
  const f = handleFraction(handle.id)
  return Boolean(f && (f.x === 0 || f.y === 0))
}

/** Whether `p` is on one of the set's own shapes (not a cut): what is under the pointer there is the shape. */
function onMember(ctx: HitContext, set: HandleSet, p: Vec): boolean {
  return set.ids.some((id) => {
    const layer = ctx.doc.layers.find((candidate) => candidate.id === id)
    return layer?.operation === 'add' && contains(ctx.items.get(id), p)
  })
}

/**
 * The handle under the pointer. Among handles, the one whose centre is
 * nearest wins. Each side of a box's frame (unless the box only scales
 * evenly) is a resize zone along its whole length, standing for its side
 * handle even where that handle is hidden for crowding: it contests the
 * other handles by its middle, so a corner keeps its own square and a short
 * side keeps its middle. A box's side handle never reaches onto its own
 * shape. `d` is how far the pointer is from the handle, or from the side.
 */
function findHandle(ctx: HitContext, p: Vec): { zone: Zone; d: number } | null {
  const set = ctx.handles
  if (!set) return null
  let best: { handle: CarveHandle; rank: number; d: number } | null = null
  let onShape: boolean | null = null
  const inside = () => (onShape ??= onMember(ctx, set, p))
  for (const candidate of set.list) {
    const d = distance(toProject(ctx, candidate.at), p)
    if (d > px(ctx, 7) || (set.kind === 'box' && isSideId(candidate) && inside())) continue
    if (!best || d < best.rank) best = { handle: candidate, rank: d, d }
  }
  if (set.kind === 'box' && set.box && !set.uniform) {
    for (const side of boxFrameSides(set.box, framePad(ctx))) {
      const d = segmentDistance(p, toProject(ctx, side.a), toProject(ctx, side.b))
      if (d > px(ctx, 4)) continue
      const rank = distance(p, toProject(ctx, side.mid))
      if (best && rank >= best.rank) continue
      const handle: CarveHandle = { id: side.id, kind: 'resize', at: side.mid, axisDeg: side.axisDeg, turn: set.box.rotation }
      best = { handle, rank, d }
    }
  }
  return best ? { zone: { kind: 'handle', set, handle: best.handle }, d: best.d } : null
}

/**
 * Handles and points. The selection's handles sit above every body and
 * edge, except that a side handle and its own shape's edge contest by
 * distance (see `findZone`). A free shape's points and its box's handles
 * never cover each other for good: whichever is nearer the pointer wins,
 * and a point wins a tie, so each can be pressed on its own centre.
 */
function findControl(ctx: HitContext, p: Vec): { zone: Zone; d: number } | null {
  const handle = findHandle(ctx, p)
  const point = findPoint(ctx, p)
  if (point && (!handle || point.d <= handle.d)) return point
  return handle
}

/** How far out from a corner's centre its turning ring reaches, in CSS pixels (doubled on touch). */
const RING_PX = 18

/** The frame running through four corner squares, or null when the handles have no four corners. */
function cornerFrame(handles: CarveHandle[]): OrientedBox | null {
  const at = (id: string) => handles.find((candidate) => candidate.id === id)?.at
  const nw = at('nw')
  const ne = at('ne')
  const se = at('se')
  const sw = at('sw')
  if (!nw || !ne || !se || !sw) return null
  return {
    center: { x: (nw.x + ne.x + se.x + sw.x) / 4, y: (nw.y + ne.y + se.y + sw.y) / 4 },
    width: distance(nw, ne),
    height: distance(ne, se),
    rotation: (Math.atan2(ne.y - nw.y, ne.x - nw.x) * 180) / Math.PI,
  }
}

/**
 * Just outside a corner of the handles' frame, a drag turns the selection
 * like the knob does, so it can be turned even when its knob is off the
 * canvas or under the floating controls. This holds for a box and for a
 * recipe that turns (a slab, a punch other than a circle) alike.
 */
function findRing(ctx: HitContext, p: Vec): Zone | null {
  const set = ctx.handles
  const knob = set?.list.find((candidate) => candidate.kind === 'rotate')
  const frame = set && knob ? cornerFrame(set.list) : null
  if (!set || !knob || !frame || boxContains(frame, toLayer(ctx, p))) return null
  const near = set.list.some((candidate) => isCornerHandle(candidate.id) && distance(toProject(ctx, candidate.at), p) <= px(ctx, RING_PX))
  return near ? { kind: 'handle', set, handle: knob, ring: true } : null
}

/**
 * A Bézier handle of the selected point, or a point of the single selected
 * free shape. Inside a shape small on screen, a point reaches only a third
 * of its longer side, so its middle stays free to drag the whole shape; a
 * long thin shape keeps the full reach of its points.
 */
function findPoint(ctx: HitContext, p: Vec): { zone: Zone; d: number } | null {
  if (!ctx.freePath) return null
  const { layerId, shape } = ctx.freePath
  const anchor = ctx.anchor
  const selected = anchor ? shape[anchor.contourIndex]?.segs[anchor.index] : undefined
  if (anchor && selected) {
    for (const which of ['in', 'out'] as const) {
      const h = which === 'in' ? selected.hIn : selected.hOut
      if (!h) continue
      const d = distance(toProject(ctx, { x: selected.p.x + h.x, y: selected.p.y + h.y }), p)
      if (d <= px(ctx, 5)) return { zone: { kind: 'bezier', layerId, contourIndex: anchor.contourIndex, index: anchor.index, which }, d }
    }
  }
  let best: { contourIndex: number; index: number } | null = null
  let bestD = px(ctx, 6)
  if (contains(ctx.items.get(layerId), p)) {
    const b = shapeBoundsInFrame(shape)
    bestD = Math.min(bestD, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 3)
  }
  for (let contourIndex = 0; contourIndex < shape.length; contourIndex++) {
    const segs = shape[contourIndex].segs
    for (let index = 0; index < segs.length; index++) {
      const d = distance(toProject(ctx, segs[index].p), p)
      if (d <= bestD) {
        bestD = d
        best = { contourIndex, index }
      }
    }
  }
  return best ? { zone: { kind: 'anchor', layerId, ...best }, d: bestD } : null
}

interface EdgeCandidate {
  layer: IllustratorLayer
  d: number
  point: Vec
  selected: boolean
  order: number
}

function findEdge(ctx: HitContext, p: Vec, onInk: boolean): { zone: Zone; d: number } | null {
  const reach = px(ctx, 8)
  let best: EdgeCandidate | null = null

  for (let order = 0; order < ctx.doc.layers.length; order++) {
    const layer = ctx.doc.layers[order]
    if (!layer.visible || layer.locked) continue
    const item = ctx.items.get(layer.id)
    if (!item) continue
    const b = item.bounds
    if (p.x < b.left - reach || p.x > b.right + reach || p.y < b.top - reach || p.y > b.bottom + reach) continue

    const loc = item.getNearestLocation(p as unknown as paper.Point)
    if (!loc) continue
    const d = loc.distance
    const selected = ctx.selectedIds.length === 1 && ctx.selectedIds[0] === layer.id
    const inside = item.contains(p as unknown as paper.Point)
    // The material side of a shape is its inside; of a cut, its outside.
    const onMaterialSide = layer.operation === 'add' ? inside : !inside
    const thickness = layerThickness(layer, item)

    let ok: boolean
    if (selected) {
      // A selected shape bends from either side: generously from the empty
      // side, and from a thin band just inside its material.
      ok = onMaterialSide ? d <= Math.min(px(ctx, 2), 0.2 * thickness) : d <= px(ctx, 6)
    } else if (onInk || onMaterialSide || !ctx.ink) {
      // Pressing ink always grabs material; other shapes bend only from the empty side.
      ok = false
    } else {
      const inkLoc = ctx.ink.getNearestLocation(loc.point)
      ok = Boolean(inkLoc && inkLoc.distance <= 1) && d <= Math.min(px(ctx, 6), 0.35 * thickness)
    }
    if (!ok) continue

    const better =
      !best ||
      d < best.d - 1e-6 ||
      (Math.abs(d - best.d) <= 1e-6 && ((selected && !best.selected) || (selected === best.selected && order > best.order)))
    if (better) {
      best = { layer, d, point: { x: loc.point.x, y: loc.point.y }, selected, order }
    }
  }

  if (!best) return null
  const layerPoint = toLayer(ctx, best.point)

  if (best.layer.carve) {
    const grab = locateCarveGrab(best.layer.carve, layerPoint)
    // The round ends of a channel have their own handles; pressing them moves the cut.
    if (!grab || grab.side.type === 'cap') return null
    return { zone: { kind: 'edge', layerId: best.layer.id, free: null, carve: grab, point: layerPoint }, d: best.d }
  }

  const free = ctx.freePathOf(best.layer)
  if (!free) return null
  const hit = nearestShapeCurve(free, layerPoint)
  if (!hit) return null
  return {
    zone: {
      kind: 'edge',
      layerId: best.layer.id,
      free: { contourIndex: hit.contourIndex, curveIndex: hit.curveIndex, t: hit.t },
      carve: null,
      point: hit.point,
    },
    d: best.d,
  }
}

/** The curve of a free shape nearest to `p`, on whichever contour it lies. */
export function nearestShapeCurve(
  shape: EditableShape,
  p: Vec,
): { contourIndex: number; curveIndex: number; t: number; point: Vec; distance: number } | null {
  let best: { contourIndex: number; curveIndex: number; t: number; point: Vec; distance: number } | null = null
  for (let contourIndex = 0; contourIndex < shape.length; contourIndex++) {
    const hit = nearestCurve(shape[contourIndex], p)
    if (hit && (!best || hit.distance < best.distance)) best = { contourIndex, ...hit }
  }
  return best
}

/**
 * The curve of a free path nearest to `p`, with the position along it.
 * Straight sides are measured as evenly-spaced cubics, so `t` is a fraction
 * of their length (what bending and inserting points expect).
 */
export function nearestCurve(path: EditablePath, p: Vec): { curveIndex: number; t: number; point: Vec; distance: number } | null {
  const count = path.closed ? path.segs.length : path.segs.length - 1
  let best: { curveIndex: number; t: number; point: Vec; distance: number } | null = null
  for (let i = 0; i < count; i++) {
    const hit = projectOnCubic(freeCurve(path, i), p)
    if (!best || hit.distance < best.distance) best = { curveIndex: i, t: hit.t, point: hit.point, distance: hit.distance }
  }
  return best
}

/** Curve `i` of a free path, with straight sides as evenly-spaced cubics. */
export function freeCurve(path: EditablePath, i: number) {
  const c = curveOf(path, i)
  return isCurveStraight(path, i) ? straightCubic(c[0], c[3]) : c
}

function findBody(ctx: HitContext, p: Vec, onInk: boolean): Zone | null {
  const layers = ctx.doc.layers
  const usable = (layer: IllustratorLayer) => layer.visible && !layer.locked
  if (onInk) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]
      if (usable(layer) && layer.operation === 'add' && contains(ctx.items.get(layer.id), p)) {
        return { kind: 'body', layerId: layer.id }
      }
    }
  } else {
    // A hole belongs to the topmost cut that actually removed material there.
    for (let i = layers.length - 1; i >= 0; i--) {
      const cut = layers[i]
      if (!usable(cut) || cut.operation !== 'subtract' || !contains(ctx.items.get(cut.id), p)) continue
      for (let j = i - 1; j >= 0; j--) {
        const below = layers[j]
        if (below.visible && below.operation === 'add' && contains(ctx.items.get(below.id), p)) {
          return { kind: 'body', layerId: cut.id }
        }
      }
    }
  }
  if (ctx.selectedIds.length === 1) {
    const id = ctx.selectedIds[0]
    const layer = layers.find((candidate) => candidate.id === id)
    if (layer && usable(layer) && contains(ctx.items.get(id), p)) return { kind: 'body', layerId: id }
  }
  // A cut removes nothing where no shape lies under it, but it is still there to pick up.
  const overShape = layers.some((layer) => layer.visible && layer.operation === 'add' && contains(ctx.items.get(layer.id), p))
  if (overShape) return null
  for (let i = layers.length - 1; i >= 0; i--) {
    const cut = layers[i]
    if (usable(cut) && cut.operation === 'subtract' && contains(ctx.items.get(cut.id), p)) {
      return { kind: 'body', layerId: cut.id }
    }
  }
  return null
}

/** A resize handle in the middle of a side: it sits right where that side's edge is pressed to bend it. */
function isSideHandle(zone: Zone): boolean {
  return zone.kind === 'handle' && isSideId(zone.handle)
}

/**
 * Decide what the pointer is over. `p` is in project space. A side handle
 * reaches over its own shape's edge (on touch, by more than its gap), so
 * the two contest by distance like points and handles do: an edge of the
 * selection nearer than the handle's centre bends, and the handle wins a
 * tie. Just outside the corners of the handles' frame, off every shape, a
 * drag turns the selection; inside a box's frame, off every shape, a press
 * moves the selection.
 */
export function findZone(ctx: HitContext, p: Vec): Zone {
  const onInk = contains(ctx.ink ?? undefined, p)
  const control = findControl(ctx, p)
  if (control) {
    if (ctx.edges && control.zone.kind === 'handle' && isSideHandle(control.zone)) {
      const members = control.zone.set.ids
      const edge = findEdge(ctx, p, onInk)
      if (edge && edge.zone.kind === 'edge' && members.includes(edge.zone.layerId) && edge.d < control.d) return edge.zone
    }
    return control.zone
  }
  if (ctx.edges) {
    const edge = findEdge(ctx, p, onInk)
    if (edge) return edge.zone
  }
  const body = findBody(ctx, p, onInk)
  if (body) return body
  const ring = findRing(ctx, p)
  if (ring) return ring
  const set = ctx.handles
  if (set?.kind === 'box' && set.box && boxContains(set.box, toLayer(ctx, p), framePad(ctx))) {
    return { kind: 'frame', set }
  }
  return EMPTY_ZONE
}

export function zoneKey(zone: Zone): string {
  switch (zone.kind) {
    case 'handle':
      return `handle:${zone.set.kind}:${zone.set.ids.join(',')}:${zone.handle.id}${zone.ring ? ':ring' : ''}`
    case 'anchor':
      return `anchor:${zone.layerId}:${zone.contourIndex}:${zone.index}`
    case 'bezier':
      return `bezier:${zone.layerId}:${zone.contourIndex}:${zone.index}:${zone.which}`
    case 'edge':
      return `edge:${zone.layerId}:${zone.carve ? JSON.stringify(zone.carve.side) : `${zone.free?.contourIndex}:${zone.free?.curveIndex}`}`
    case 'body':
      return `body:${zone.layerId}`
    case 'frame':
      return `frame:${zone.set.ids.join(',')}`
    default:
      return 'empty'
  }
}
