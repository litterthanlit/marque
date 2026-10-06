import type { Vec } from '../path/bezier.ts'

/**
 * A carve recipe: everything needed to regenerate a slab or cut exactly.
 * Stored on its layer next to the baked path, so the path keeps working for
 * composition and export while the recipe drives editing.
 */

export type SlabKind = 'square' | 'rounded' | 'circle' | 'tall'
export type PunchShape = 'circle' | 'square' | 'triangle'
export type CarveToolKind = 'punch' | 'channel' | 'slice'

/** Straight sides of a box ('top'…'left') and of the triangle punch ('s0'…'s2'). */
export type LineSideId = 'top' | 'right' | 'bottom' | 'left' | 's0' | 's1' | 's2'
/** Rounded corners of a box. */
export type CornerId = 'tr' | 'br' | 'bl' | 'tl'

/**
 * A bent straight side. Its handles sit at ⅓ and ⅔ of the chord, then move by
 * `a` (a fraction of the chord, along it) and `o` (layer units, outward).
 * Resizing therefore stretches a bend along the side but keeps its depth.
 */
export interface SideBend {
  a1: number
  o1: number
  a2: number
  o2: number
}

/**
 * How full a rounded corner is: handle length = k·κ·r, so 1 is a true
 * circular arc, lower is closer to a chamfer, and 1/κ (about 1.81, the
 * largest a bend makes) puts both handles on the square corner.
 */
export interface CornerFullness {
  k1: number
  k2: number
}

export interface CarveBends {
  sides?: Partial<Record<LineSideId, SideBend>>
  corners?: Partial<Record<CornerId, CornerFullness>>
}

export interface SlabSpec extends CarveBends {
  v: 1
  kind: 'slab'
  preset: SlabKind
  center: Vec
  width: number
  height: number
  /** Corner radius. Clamped to half the shorter side when generating, never when stored. */
  radius: number
  rotation: number
}

export interface PunchSpec extends CarveBends {
  v: 1
  kind: 'punch'
  shape: PunchShape
  center: Vec
  radius: number
  rotation: number
}

export interface GrooveSpec {
  v: 1
  kind: 'channel' | 'slice'
  from: Vec
  to: Vec
  width: number
  /** A bend of the spine; the groove keeps an even width around it. */
  bend?: SideBend
}

/**
 * A regular polygon with every corner rounded alike. Its first corner is at
 * the top before it turns. A polygon is the same recipe whether it adds or
 * cuts: the punch's polygon is one too.
 */
export interface PolygonSpec {
  v: 1
  kind: 'polygon'
  center: Vec
  /** How many sides: a whole number from 3 to 12. */
  sides: number
  /** Circumradius of the sharp polygon: how far its corners would reach unrounded. */
  radius: number
  rotation: number
  /** Radius of every corner. Clamped to the apothem when generating, never when stored. */
  cornerRadius: number
}

export type CarveSpec = SlabSpec | PunchSpec | PolygonSpec | GrooveSpec

export const MIN_SIDES = 3
export const MAX_SIDES = 12
/** A new polygon is a hexagon. */
export const DEFAULT_SIDES = 6

/** A number of sides as a polygon takes it: whole, from 3 to 12. */
export function clampSides(sides: number): number {
  return Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(sides)))
}

/** The distance from a polygon's centre to the middle of a side: R·cos(π/n). */
export function polygonApothem(spec: Pick<PolygonSpec, 'sides' | 'radius'>): number {
  return spec.radius * Math.cos(Math.PI / spec.sides)
}

/**
 * How far short of its apothem a polygon's corner radius may be stored and
 * still be fully round: the hundredth that storage rounds to.
 */
export const FULL_ROUND_SLACK = 0.01

/**
 * The corner radius a polygon draws with: at most its apothem, where the
 * corners of each side meet in its middle and the polygon is a circle. A
 * radius stored within FULL_ROUND_SLACK of the apothem is the apothem, so a
 * polygon rounded all the way keeps no flats after storage rounds it down.
 */
export function polygonCornerRadius(spec: Pick<PolygonSpec, 'sides' | 'radius' | 'cornerRadius'>): number {
  const apothem = polygonApothem(spec)
  return spec.cornerRadius >= apothem - FULL_ROUND_SLACK ? apothem : Math.max(spec.cornerRadius, 0)
}

/**
 * A polygon's corner radius once its size is multiplied by `factor`: a fully
 * round polygon stays fully round, whatever storage rounded its radius to.
 */
export function scaledPolygonCorner(spec: Pick<PolygonSpec, 'sides' | 'radius' | 'cornerRadius'>, factor: number): number {
  const round = polygonCornerRadius(spec) === polygonApothem(spec)
  return round ? polygonApothem({ sides: spec.sides, radius: spec.radius * factor }) : spec.cornerRadius * factor
}

/** The shape a carve tool produces while dragging, before it becomes a recipe. */
export type CutSpec =
  | { kind: 'punch'; shape: PunchShape; center: Vec; radius: number }
  | { kind: 'polygon'; center: Vec; radius: number; sides: number }
  | { kind: 'channel'; from: Vec; to: Vec; width: number }
  | { kind: 'slice'; from: Vec; to: Vec; width: number }

export const SLAB_PRESETS: Record<SlabKind, { width: number; height: number; radius: number }> = {
  square: { width: 380, height: 380, radius: 0 },
  rounded: { width: 380, height: 380, radius: 90 },
  circle: { width: 400, height: 400, radius: 200 },
  tall: { width: 250, height: 430, radius: 125 },
}

/** The polygon slab: as wide as the circle slab, its corners sharp. */
export const POLYGON_SLAB_RADIUS = 200

export function slabSpec(preset: SlabKind, center: Vec = { x: 0, y: 0 }, size = 1): SlabSpec {
  const p = SLAB_PRESETS[preset]
  return {
    v: 1,
    kind: 'slab',
    preset,
    center: { ...center },
    width: p.width * size,
    height: p.height * size,
    radius: p.radius * size,
    rotation: 0,
  }
}

/** A polygon of `sides`, upright, its corners sharp unless `cornerRadius` says. */
export function polygonSpec(center: Vec, radius: number, sides = DEFAULT_SIDES, cornerRadius = 0): PolygonSpec {
  return { v: 1, kind: 'polygon', center: { ...center }, sides: clampSides(sides), radius, rotation: 0, cornerRadius }
}

export function carveFromCut(cut: CutSpec): CarveSpec {
  switch (cut.kind) {
    case 'punch':
      return { v: 1, kind: 'punch', shape: cut.shape, center: { ...cut.center }, radius: cut.radius, rotation: 0 }
    case 'polygon':
      return polygonSpec(cut.center, cut.radius, cut.sides)
    case 'channel':
    case 'slice':
      return { v: 1, kind: cut.kind, from: { ...cut.from }, to: { ...cut.to }, width: cut.width }
    default:
      return cut satisfies never
  }
}

export function carveLayerName(spec: CarveSpec): string {
  switch (spec.kind) {
    case 'slab':
      return 'Slab'
    case 'punch':
      return `Punch · ${spec.shape}`
    case 'polygon':
      return `Polygon · ${spec.sides}`
    case 'channel':
      return 'Channel'
    case 'slice':
      return 'Slice'
    default:
      return spec satisfies never
  }
}

/** Thickness used to scale hit bands: thin things get narrower bend zones. */
export function carveThickness(spec: CarveSpec): number {
  switch (spec.kind) {
    case 'slab':
      return Math.min(spec.width, spec.height)
    case 'punch':
      return spec.radius * 2
    case 'polygon':
      return 2 * polygonApothem(spec)
    case 'channel':
    case 'slice':
      return spec.width
    default:
      return spec satisfies never
  }
}

export function isSlab(spec: CarveSpec | undefined | null): spec is SlabSpec {
  return spec?.kind === 'slab'
}

export function isGroove(spec: CarveSpec | undefined | null): spec is GrooveSpec {
  return spec?.kind === 'channel' || spec?.kind === 'slice'
}

/* ─── Validation and rounding ─── */

const SLAB_KIND_SET = new Set<string>(['square', 'rounded', 'circle', 'tall'])
const PUNCH_SHAPE_SET = new Set<string>(['circle', 'square', 'triangle'])
const LINE_SIDES = new Set<string>(['top', 'right', 'bottom', 'left', 's0', 's1', 's2'])
const CORNERS = new Set<string>(['tr', 'br', 'bl', 'tl'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isVec(value: unknown): value is Vec {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isSideBend(value: unknown): value is SideBend {
  return (
    isRecord(value) &&
    isFiniteNumber(value.a1) &&
    isFiniteNumber(value.o1) &&
    isFiniteNumber(value.a2) &&
    isFiniteNumber(value.o2)
  )
}

function isCornerFullness(value: unknown): value is CornerFullness {
  return isRecord(value) && isFiniteNumber(value.k1) && isFiniteNumber(value.k2)
}

function areBendsValid(value: Record<string, unknown>): boolean {
  if (value.sides !== undefined) {
    if (!isRecord(value.sides)) return false
    for (const [id, bend] of Object.entries(value.sides)) {
      if (!LINE_SIDES.has(id) || (bend !== undefined && !isSideBend(bend))) return false
    }
  }
  if (value.corners !== undefined) {
    if (!isRecord(value.corners)) return false
    for (const [id, corner] of Object.entries(value.corners)) {
      if (!CORNERS.has(id) || (corner !== undefined && !isCornerFullness(corner))) return false
    }
  }
  return true
}

/**
 * Structural check for recipes read from URLs, saved variations or old
 * builds. A polygon must have a whole number of sides from 3 to 12: any
 * other count would draw another outline than the one stored, so the recipe
 * is not trusted and goes, and the shape stays as its path.
 */
export function isCarveSpec(value: unknown): value is CarveSpec {
  if (!isRecord(value) || value.v !== 1) return false
  if (value.kind === 'polygon') {
    return (
      isVec(value.center) &&
      typeof value.sides === 'number' &&
      Number.isInteger(value.sides) &&
      value.sides >= MIN_SIDES &&
      value.sides <= MAX_SIDES &&
      isFiniteNumber(value.radius) &&
      value.radius > 0 &&
      isFiniteNumber(value.rotation) &&
      isFiniteNumber(value.cornerRadius) &&
      value.cornerRadius >= 0
    )
  }
  if (value.kind === 'slab') {
    return (
      typeof value.preset === 'string' &&
      SLAB_KIND_SET.has(value.preset) &&
      isVec(value.center) &&
      isFiniteNumber(value.width) &&
      value.width > 0 &&
      isFiniteNumber(value.height) &&
      value.height > 0 &&
      isFiniteNumber(value.radius) &&
      value.radius >= 0 &&
      isFiniteNumber(value.rotation) &&
      areBendsValid(value)
    )
  }
  if (value.kind === 'punch') {
    return (
      typeof value.shape === 'string' &&
      PUNCH_SHAPE_SET.has(value.shape) &&
      isVec(value.center) &&
      isFiniteNumber(value.radius) &&
      value.radius > 0 &&
      isFiniteNumber(value.rotation) &&
      areBendsValid(value)
    )
  }
  if (value.kind === 'channel' || value.kind === 'slice') {
    return (
      isVec(value.from) &&
      isVec(value.to) &&
      isFiniteNumber(value.width) &&
      value.width > 0 &&
      (value.bend === undefined || isSideBend(value.bend))
    )
  }
  return false
}

const round2 = (v: number): number => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? 0 : r
}
const roundVec = (v: Vec): Vec => ({ x: round2(v.x), y: round2(v.y) })
const roundBend = (b: SideBend): SideBend => ({ a1: round2(b.a1), o1: round2(b.o1), a2: round2(b.a2), o2: round2(b.o2) })
const roundCorner = (c: CornerFullness): CornerFullness => ({ k1: round2(c.k1), k2: round2(c.k2) })

function isZeroBend(b: SideBend): boolean {
  return b.a1 === 0 && b.o1 === 0 && b.a2 === 0 && b.o2 === 0
}

function isRoundCorner(c: CornerFullness): boolean {
  return c.k1 === 1 && c.k2 === 1
}

function roundBends(spec: CarveBends): CarveBends {
  const out: CarveBends = {}
  if (spec.sides) {
    const sides: Partial<Record<LineSideId, SideBend>> = {}
    for (const [id, bend] of Object.entries(spec.sides) as Array<[LineSideId, SideBend | undefined]>) {
      if (!bend) continue
      const r = roundBend(bend)
      if (!isZeroBend(r)) sides[id] = r
    }
    if (Object.keys(sides).length) out.sides = sides
  }
  if (spec.corners) {
    const corners: Partial<Record<CornerId, CornerFullness>> = {}
    for (const [id, corner] of Object.entries(spec.corners) as Array<[CornerId, CornerFullness | undefined]>) {
      if (!corner) continue
      const r = roundCorner(corner)
      if (!isRoundCorner(r)) corners[id] = r
    }
    if (Object.keys(corners).length) out.corners = corners
  }
  return out
}

/**
 * Round to 0.01 and drop neutral bends, so the stored path always equals the
 * path generated from the stored recipe.
 */
export function roundCarveSpec(spec: CarveSpec): CarveSpec {
  switch (spec.kind) {
    case 'slab':
      return roundSlab(spec)
    case 'punch':
      return roundPunch(spec)
    case 'polygon':
      return {
        v: 1,
        kind: 'polygon',
        center: roundVec(spec.center),
        sides: spec.sides,
        radius: round2(spec.radius),
        rotation: round2(spec.rotation),
        cornerRadius: round2(spec.cornerRadius),
      }
    case 'channel':
    case 'slice':
      return roundGroove(spec)
    default:
      return spec satisfies never
  }
}

function roundSlab(spec: SlabSpec): SlabSpec {
  return {
    v: 1,
    kind: 'slab',
    preset: spec.preset,
    center: roundVec(spec.center),
    width: round2(spec.width),
    height: round2(spec.height),
    radius: round2(spec.radius),
    rotation: round2(spec.rotation),
    ...roundBends(spec),
  }
}

function roundPunch(spec: PunchSpec): PunchSpec {
  return {
    v: 1,
    kind: 'punch',
    shape: spec.shape,
    center: roundVec(spec.center),
    radius: round2(spec.radius),
    rotation: round2(spec.rotation),
    ...roundBends(spec),
  }
}

function roundGroove(spec: GrooveSpec): GrooveSpec {
  const out: GrooveSpec = {
    v: 1,
    kind: spec.kind,
    from: roundVec(spec.from),
    to: roundVec(spec.to),
    width: round2(spec.width),
  }
  if (spec.bend) {
    const bend = roundBend(spec.bend)
    if (!isZeroBend(bend)) out.bend = bend
  }
  return out
}

/** Count of bent sides and reshaped corners, for summaries. */
export function bentEdgeCount(spec: CarveSpec): number {
  switch (spec.kind) {
    case 'slab':
    case 'punch':
      return Object.keys(spec.sides ?? {}).length + Object.keys(spec.corners ?? {}).length
    case 'polygon':
      // A polygon does not bend: its sides stay straight and its corners round.
      return 0
    case 'channel':
    case 'slice':
      return spec.bend ? 1 : 0
    default:
      return spec satisfies never
  }
}

const n0 = (v: number): string => String(Math.round(v))

/** One-line, human description of a recipe for the panel and screen readers. */
export function describeCarve(spec: CarveSpec): string {
  const bent = bentEdgeCount(spec)
  const bentText = bent ? ` · ${bent} bent ${bent === 1 ? 'edge' : 'edges'}` : ''
  switch (spec.kind) {
    case 'slab': {
      const radius = Math.min(spec.radius, spec.width / 2, spec.height / 2)
      const turned = spec.rotation ? ` · ${n0(spec.rotation)}°` : ''
      return `Slab · ${n0(spec.width)} × ${n0(spec.height)} · corner ${n0(radius)}${turned}${bentText}`
    }
    case 'punch': {
      const turned = spec.rotation ? ` · ${n0(spec.rotation)}°` : ''
      return `Punch · ${spec.shape} · ${n0(spec.radius * 2)} across${turned}${bentText}`
    }
    case 'polygon': {
      const turned = spec.rotation ? ` · ${n0(spec.rotation)}°` : ''
      return `Polygon · ${spec.sides} sides · r ${n0(spec.radius)} · corner ${n0(polygonCornerRadius(spec))}${turned}`
    }
    case 'channel':
    case 'slice': {
      const len = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y)
      const name = spec.kind === 'channel' ? 'Channel' : 'Slice'
      return `${name} · ${n0(len)} long · ${n0(spec.width)} wide${bentText}`
    }
    default:
      return spec satisfies never
  }
}
