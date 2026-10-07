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
import { cutReach } from '../../engine/illustrator/compose.ts'
import type { Guide } from '../../engine/vector/types.ts'
import { nearestGuide, nearestGuideHandle, type GuideHandle } from './guideEdit.ts'

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
  /** A handle of the selected guide: a line's knob, a circle's radius square. */
  | { kind: 'guide-handle'; handle: GuideHandle }
  /** A guide, at `point` (layer space): the point of it nearest the pointer. */
  | { kind: 'guide'; guideId: string; point: Vec }
  /** The selected fillet's radius dot. */
  | { kind: 'fillet-dot'; filletId: string }
  /** A fillet's circle, or the dot at its centre. */
  | { kind: 'fillet'; filletId: string }
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
  /**
   * Can this layer's edges bend? A member of a group that a click selects
   * whole cannot: a press by its edge takes the group, as a press on its
   * body does. Missing is every layer.
   */
  bendable?(layerId: string): boolean
  /** Any free layer's contours with its transform baked in (cached by the caller). */
  freePathOf(layer: IllustratorLayer): EditableShape | null
  /** The guides a press can reach: shown, visible and unlocked. Missing is none. */
  guides?: readonly Guide[]
  /** The handles of the selected guide. */
  guideHandles?: readonly GuideHandle[]
  /** Under the Guide tool, guides are the first zone; under Select, the last. */
  guidesFirst?: boolean
  /** The fillets' circles a press can reach, layer space: a lost one where it sat, at its radius. Missing is none. */
  fillets?: readonly FilletCircle[]
  /** The selected fillet's radius dot, layer space. */
  filletDot?: { filletId: string; p: Vec } | null
  /** Under the Round tool, fillets are the first zone; under Select, they come after every material zone. */
  filletsFirst?: boolean
}

/** A fillet's circle as a press finds it. */
export interface FilletCircle {
  id: string
  c: Vec
  r: number
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
  // By the edge of a piece reached through its group, a press takes the group as its body would.
  if (ctx.bendable && !ctx.bendable(best.layer.id)) return { zone: { kind: 'body', layerId: best.layer.id }, d: best.d }
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
  const body = findBodyLayer(ctx, p, onInk)
  return body === null ? null : { kind: 'body', layerId: bandCircleAt(ctx, body, p) ?? body }
}

/**
 * A press on a band inside one of its circles is a press on that circle:
 * the ink there is the circle's, and a belt, which covers both of its
 * circles, would leave neither to drag alone. The higher of the two wins
 * where they overlap; a locked or hidden one leaves the press to the band.
 */
function bandCircleAt(ctx: HitContext, id: string, p: Vec): string | null {
  const layers = ctx.doc.layers
  const link = layers.find((layer) => layer.id === id)?.link
  if (link?.kind !== 'band') return null
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if ((layer.id === link.a || layer.id === link.b) && layer.visible && !layer.locked && contains(ctx.items.get(layer.id), p)) return layer.id
  }
  return null
}

function findBodyLayer(ctx: HitContext, p: Vec, onInk: boolean): string | null {
  const layers = ctx.doc.layers
  const usable = (layer: IllustratorLayer) => layer.visible && !layer.locked
  // Inside an isolated group a cut reaches only the group's own members.
  const reach = cutReach(ctx.doc)
  /** With isolated groups: is the shape at `index` cut away at the point, by a cut above it that reaches it? */
  const cutAway = (index: number) => {
    if (!reach) return false
    for (let j = index + 1; j < layers.length; j++) {
      const cut = layers[j]
      if (cut.visible && cut.operation === 'subtract' && reach(cut, layers[index]) && contains(ctx.items.get(cut.id), p)) return true
    }
    return false
  }
  if (onInk) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]
      if (usable(layer) && layer.operation === 'add' && contains(ctx.items.get(layer.id), p) && !cutAway(i)) {
        return layer.id
      }
    }
  } else {
    // A hole belongs to the topmost cut that actually removed material there.
    for (let i = layers.length - 1; i >= 0; i--) {
      const cut = layers[i]
      if (!usable(cut) || cut.operation !== 'subtract' || !contains(ctx.items.get(cut.id), p)) continue
      for (let j = i - 1; j >= 0; j--) {
        const below = layers[j]
        if (below.visible && below.operation === 'add' && (!reach || reach(cut, below)) && contains(ctx.items.get(below.id), p)) {
          return cut.id
        }
      }
    }
  }
  if (ctx.selectedIds.length === 1) {
    const id = ctx.selectedIds[0]
    const layer = layers.find((candidate) => candidate.id === id)
    if (layer && usable(layer) && contains(ctx.items.get(id), p)) return id
  }
  // A cut removes nothing where no shape lies under it, but it is still there to pick up.
  const overShape = layers.some((layer) => layer.visible && layer.operation === 'add' && contains(ctx.items.get(layer.id), p))
  if (overShape) return null
  for (let i = layers.length - 1; i >= 0; i--) {
    const cut = layers[i]
    if (usable(cut) && cut.operation === 'subtract' && contains(ctx.items.get(cut.id), p)) {
      return cut.id
    }
  }
  return null
}

/** How near a guide a press must be, in CSS pixels (doubled on touch). */
export const GUIDE_PX = 4

/** The selected guide's handle under the pointer. */
function findGuideHandle(ctx: HitContext, p: Vec): Zone | null {
  if (!ctx.guideHandles?.length) return null
  const handle = nearestGuideHandle(ctx.guideHandles, toLayer(ctx, p), px(ctx, 7))
  return handle ? { kind: 'guide-handle', handle } : null
}

/** The guide under the pointer: the nearest within reach. */
function findGuide(ctx: HitContext, p: Vec): Zone | null {
  if (!ctx.guides?.length) return null
  const hit = nearestGuide(ctx.guides, toLayer(ctx, p), px(ctx, GUIDE_PX))
  return hit ? { kind: 'guide', guideId: hit.guide.id, point: hit.point } : null
}

/** How near a fillet's circle a press must be, in CSS pixels (doubled on touch); its centre dot and radius dot take a little more. */
export const FILLET_PX = 4
const FILLET_DOT_PX = 7

/** The selected fillet's radius dot under the pointer. */
function findFilletDot(ctx: HitContext, p: Vec): Zone | null {
  const dot = ctx.filletDot
  return dot && distance(toLayer(ctx, p), dot.p) <= px(ctx, FILLET_DOT_PX) ? { kind: 'fillet-dot', filletId: dot.filletId } : null
}

/** The fillet whose circle or centre is under the pointer: the nearest within reach. */
function findFillet(ctx: HitContext, p: Vec): Zone | null {
  if (!ctx.fillets?.length) return null
  const q = toLayer(ctx, p)
  let best: { id: string; d: number } | null = null
  for (const fillet of ctx.fillets) {
    const fromCentre = distance(q, fillet.c)
    const d = Math.min(Math.abs(fromCentre - fillet.r), fromCentre <= px(ctx, FILLET_DOT_PX) ? 0 : Infinity)
    if (d <= px(ctx, FILLET_PX) && (!best || d < best.d)) best = { id: fillet.id, d }
  }
  return best ? { kind: 'fillet', filletId: best.id } : null
}

/** A resize handle in the middle of a side: it sits right where that side's edge is pressed to bend it. */
function isSideHandle(zone: Zone): boolean {
  return zone.kind === 'handle' && isSideId(zone.handle)
}

/**
 * Decide what the pointer is over. `p` is in project space. The selected
 * guide's handles come first. Under the Guide tool guides come next; under
 * Select they come last, after every handle, point, edge and body. A side handle
 * reaches over its own shape's edge (on touch, by more than its gap), so
 * the two contest by distance like points and handles do: an edge of the
 * selection nearer than the handle's centre bends, and the handle wins a
 * tie. Just outside the corners of the handles' frame, off every shape, a
 * drag turns the selection; inside a box's frame, off every shape, a press
 * moves the selection.
 */
export function findZone(ctx: HitContext, p: Vec): Zone {
  // A selected guide's handles are only there while no layer is selected, so they come first either way.
  const guideHandle = findGuideHandle(ctx, p)
  if (guideHandle) return guideHandle
  // So is a selected fillet's radius dot, and under the Round tool every fillet.
  const filletDot = findFilletDot(ctx, p)
  if (filletDot) return filletDot
  if (ctx.filletsFirst) {
    const fillet = findFillet(ctx, p)
    if (fillet) return fillet
  }
  if (ctx.guidesFirst) {
    const guide = findGuide(ctx, p)
    if (guide) return guide
  }
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
  // Under Select fillets and guides are the last things a press can reach: one lying along an edge never takes the edge's drag.
  return (!ctx.filletsFirst && findFillet(ctx, p)) || (!ctx.guidesFirst && findGuide(ctx, p)) || EMPTY_ZONE
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
    case 'guide-handle':
      return `guide-handle:${zone.handle.guideId}:${zone.handle.id}`
    case 'guide':
      return `guide:${zone.guideId}`
    case 'fillet-dot':
      return `fillet-dot:${zone.filletId}`
    case 'fillet':
      return `fillet:${zone.filletId}`
    default:
      return 'empty'
  }
}
