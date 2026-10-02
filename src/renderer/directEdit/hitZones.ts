import { distance, projectOnCubic, straightCubic, type Vec } from '../../engine/path/bezier.ts'
import { curveOf, isCurveStraight, type EditablePath } from '../../engine/path/editPath.ts'
import type { CarveHandle } from '../../engine/carve/edit.ts'
import { locateCarveGrab, type CarveGrab } from '../../engine/carve/edit.ts'
import { carveThickness } from '../../engine/carve/spec.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'

/** What is under the pointer, in priority order of the cases below. */
export type Zone =
  | { kind: 'handle'; layerId: string; handle: CarveHandle }
  | { kind: 'anchor'; layerId: string; index: number }
  | { kind: 'bezier'; layerId: string; index: number; which: 'in' | 'out' }
  | { kind: 'edge'; layerId: string; free: { curveIndex: number; t: number } | null; carve: CarveGrab | null; point: Vec }
  | { kind: 'body'; layerId: string }
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
  /** The single selected free shape, baked, in layer space. */
  freePath: { layerId: string; path: EditablePath } | null
  anchorIndex: number | null
  /** Recipe handles of the single selected recipe layer, layer space. */
  handles: { layerId: string; list: CarveHandle[] } | null
  /** Layer units per CSS pixel. */
  unitsPerPx: number
  touch: boolean
  /** Edge bending enabled. */
  edges: boolean
  /** Any free layer's single path with its transform baked in (cached by the caller). */
  freePathOf(layer: IllustratorLayer): EditablePath | null
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

function findControl(ctx: HitContext, p: Vec): Zone | null {
  if (ctx.handles) {
    let best: CarveHandle | null = null
    let bestD = px(ctx, 7)
    for (const handle of ctx.handles.list) {
      const d = distance(toProject(ctx, handle.at), p)
      if (d <= bestD) {
        bestD = d
        best = handle
      }
    }
    if (best) return { kind: 'handle', layerId: ctx.handles.layerId, handle: best }
  }

  if (ctx.freePath) {
    const { layerId, path } = ctx.freePath
    if (ctx.anchorIndex !== null && path.segs[ctx.anchorIndex]) {
      const seg = path.segs[ctx.anchorIndex]
      for (const which of ['in', 'out'] as const) {
        const h = which === 'in' ? seg.hIn : seg.hOut
        if (!h) continue
        const at = toProject(ctx, { x: seg.p.x + h.x, y: seg.p.y + h.y })
        if (distance(at, p) <= px(ctx, 5)) return { kind: 'bezier', layerId, index: ctx.anchorIndex, which }
      }
    }
    let bestIndex = -1
    let bestD = px(ctx, 6)
    path.segs.forEach((seg, i) => {
      const d = distance(toProject(ctx, seg.p), p)
      if (d <= bestD) {
        bestD = d
        bestIndex = i
      }
    })
    if (bestIndex >= 0) return { kind: 'anchor', layerId, index: bestIndex }
  }
  return null
}

interface EdgeCandidate {
  layer: IllustratorLayer
  d: number
  point: Vec
  selected: boolean
  order: number
}

function findEdge(ctx: HitContext, p: Vec, onInk: boolean): Zone | null {
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
    return { kind: 'edge', layerId: best.layer.id, free: null, carve: grab, point: layerPoint }
  }

  const free = ctx.freePathOf(best.layer)
  if (!free) return null
  const hit = nearestCurve(free, layerPoint)
  if (!hit) return null
  return { kind: 'edge', layerId: best.layer.id, free: { curveIndex: hit.curveIndex, t: hit.t }, carve: null, point: hit.point }
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
  return null
}

/** Decide what the pointer is over. `p` is in project space. */
export function findZone(ctx: HitContext, p: Vec): Zone {
  const control = findControl(ctx, p)
  if (control) return control
  const onInk = contains(ctx.ink ?? undefined, p)
  if (ctx.edges) {
    const edge = findEdge(ctx, p, onInk)
    if (edge) return edge
  }
  return findBody(ctx, p, onInk) ?? EMPTY_ZONE
}

export function zoneKey(zone: Zone): string {
  switch (zone.kind) {
    case 'handle':
      return `handle:${zone.layerId}:${zone.handle.id}`
    case 'anchor':
      return `anchor:${zone.layerId}:${zone.index}`
    case 'bezier':
      return `bezier:${zone.layerId}:${zone.index}:${zone.which}`
    case 'edge':
      return `edge:${zone.layerId}:${zone.carve ? JSON.stringify(zone.carve.side) : zone.free?.curveIndex}`
    case 'body':
      return `body:${zone.layerId}`
    default:
      return 'empty'
  }
}
