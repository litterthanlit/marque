import paper from 'paper'
import {
  DEFAULT_PARAMS,
  type LogoParams,
  type SeededRandom,
  type ShapeNode,
  type StyleFamily,
} from '../types.ts'
import { SeededPRNG } from '../random.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { composeOrderedPaths } from '../boolean/operations.ts'
import { generatedShapesInApplyOrder } from '../illustrator/compose.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM, type IllustratorLayer, type MarkData } from '../illustrator/types.ts'
import { createPrimitivePath, type PrimitiveType } from '../primitives/index.ts'
import { getModeGeneratorId, getStyleFamilyDefaults, STYLE_FAMILIES } from '../../store/modes.ts'

export interface SparkShape {
  id: string
  name: string
  operation: 'add' | 'subtract'
  /** One closed subpath, in the 500-unit generator space. */
  pathData: string
}

export interface Spark {
  id: string
  /** What was rolled. The shapes and the mark follow from these alone. */
  params: LogoParams
  /** In apply order, adds first and cuts after. */
  shapes: SparkShape[]
  /** The composition of exactly those shapes. */
  mark: MarkData
}

export interface SparkTarget {
  center: { x: number; y: number }
  /** Length of the larger side of the fitted mark. */
  span: number
}

type ModeParams = Record<string, number | string>
type Piece = ShapeNode & { pathData: string }
type StyleDefaults = ReturnType<typeof getStyleFamilyDefaults>
type Box = { x: number; y: number; width: number; height: number }

interface SparkRecipe {
  /** Cards of the mode in the deck of eight a tray is dealt from. */
  weight: number
  /** Changes to the style defaults that make a few large pieces overlap, lopsided. */
  roll(rng: SeededRandom, style: StyleDefaults): { shared?: Partial<LogoParams>; mode?: ModeParams }
  /** Least and most of the generated pieces to keep, for a mode no parameter makes lopsided. */
  keepShare?: [number, number]
  /** How many times their generated size the cuts are drawn: more where they miss the ink, less where they swamp it. */
  cutScale?: number
  /** Whether a piece that touches nothing is moved onto the rest. Not for a mode that lays its pieces on a lattice. */
  gather?: boolean
}

const NO_BLOBS = DEFAULT_PARAMS.enabledShapes.filter((shape) => shape !== 'blob')

/** Circles and one kind of straight-edged shape: a mark drawn with two kinds of shape hangs together. */
function vocabulary(rng: SeededRandom): string[] {
  const straight = NO_BLOBS.filter((shape) => shape !== 'circle')
  return ['circle', straight[rng.nextInt(0, straight.length - 1)]]
}

const RECIPES: Record<string, SparkRecipe> = {
  'geometric-radial': {
    weight: 3,
    gather: true,
    cutScale: 0.8,
    // Two rings are three pieces a fold. A third ring makes seven, which reads as a lump.
    roll: (rng, style) => ({
      shared: {
        symmetryFolds: rng.nextBool(0.65) ? 1 : rng.nextInt(2, 3),
        gridRings: 2,
        baseRadius: (style.shared.baseRadius ?? DEFAULT_PARAMS.baseRadius) * rng.nextFloat(1.8, 2.6),
        radiusVariation: rng.nextFloat(0.6, 1.4),
        additiveRatio: 0.6,
        enabledShapes: vocabulary(rng),
      },
    }),
  },
  'grid-system': {
    weight: 2,
    // A generated cut sits in an emptied cell and touches nothing. At this size it bites the cells around it.
    cutScale: 3.1,
    // A frame leaves a bare outline. A negative inset laps each cell over its neighbours, so they fuse and two
    // cells that only meet at a corner still join by a quarter of a cell. At the style densities a small grid
    // fills up into a plain rectangle.
    roll: (rng, style) => ({
      shared: { rotation: 0, additiveRatio: 0.3 },
      mode: {
        mirrorX: 0,
        mirrorY: 0,
        frameMode: 0,
        cellInset: -0.12,
        density: Number(style.modeParams.density) * 0.6,
        columns: rng.nextInt(3, 5),
        rows: rng.nextInt(3, 5),
      },
    }),
  },
  modular: {
    weight: 2,
    gather: true,
    cutScale: 0.75,
    // Two or three modules a side, each over half a cell in radius, so neighbours overlap. The generator's
    // grid is 400 units across and a module's radius is 60 units for each unit of base radius. The style
    // keeps its clip disc.
    roll: (rng) => {
      const columns = rng.nextInt(2, 3)
      const rows = rng.nextInt(2, 3)
      const cell = 400 / Math.max(columns, rows)
      return {
        shared: {
          baseRadius: (rng.nextFloat(0.55, 0.8) * cell) / 60,
          additiveRatio: 0.66,
          enabledShapes: vocabulary(rng),
        },
        mode: { columns, rows },
      }
    },
  },
  'wave-arc': {
    weight: 1,
    keepShare: [0.4, 0.7],
    // Thick bands on two rings. One ring's copies are all alike, so any three of them mirror. Under 140
    // degrees a band thins to a horn, and near 180 it is half a disc.
    roll: (rng) => ({
      mode: {
        arcSymmetry: 'radial',
        symmetryFolds: rng.nextInt(3, 4),
        arcCount: 2,
        gapRatio: rng.nextFloat(0.12, 0.3),
        spreadAngle: rng.nextBool() ? rng.nextInt(140, 165) : rng.nextInt(195, 230),
      },
    }),
  },
}

const MODE_DECK = Object.entries(RECIPES).flatMap(([modeId, recipe]) =>
  Array.from({ length: recipe.weight }, () => modeId),
)

const MAX_SHAPES = 40
const MIN_SHAPES = 3
const MIN_ADDS = 2
/** Most separate pieces of ink a mark may fall into. */
const MAX_ISLANDS = 3
/** Smallest share of the ink one of those pieces may be. Less reads as a stray bit, not a part of the mark. */
const MIN_ISLAND = 0.15
/** Smallest larger side of a mark, in the 500-unit generator space. */
const MIN_SIDE = 150
/** Smallest share of a mark's bounding box that is ink. */
const MIN_INKED = 0.2
/** Cells a side of the grid a spark is judged on, about what a tray tile shows. */
const TILE = 40
const CURVE_STEPS = 8
/** Smallest share of the ink that taking a piece away must change, or the piece is a layer nobody would miss. */
const MIN_EFFECT = 0.03
/** Smallest share of what was added that the cuts must leave. */
const MIN_KEPT = 0.5
/** Smallest share of a mark's ink that either of its mirror images leaves uncovered. */
const MIN_LOPSIDED = 0.12
/** Smallest share of two marks' ink they may have apart, or the tray shows one mark twice. */
const MIN_DIFFERENCE = 0.2
/** How far a gathered piece is pushed in: the distance between centres, as a share of the two inner radii. */
const GATHERED_REACH = 0.75

const PIECE_NAMES: Record<ShapeNode['type'], string> = {
  circle: 'Circle',
  rectangle: 'Rectangle',
  triangle: 'Triangle',
  polygon: 'Polygon',
  blob: 'Blob',
  ellipse: 'Crescent',
}

let sparkScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!sparkScope) {
    sparkScope = new paper.PaperScope()
    sparkScope.setup(new paper.Size(1, 1))
  }
  sparkScope.activate()
  return sparkScope
}

function shuffled<T>(items: T[], rng: SeededRandom): T[] {
  const deck = [...items]
  for (let last = deck.length - 1; last > 0; last--) {
    const pick = rng.nextInt(0, last)
    ;[deck[last], deck[pick]] = [deck[pick], deck[last]]
  }
  return deck
}

/**
 * The mode and style of every slot. A tray takes the whole deck, so it shows
 * each mode as often as its weight says, and a mode walks through the styles
 * before it repeats one: no two sparks in eight share both.
 */
function dealer(shuffleSeed: number): (slot: number) => { modeId: string; styleFamily: StyleFamily } {
  const rng = new SeededPRNG(`deal:${shuffleSeed}`)
  const deck = shuffled(MODE_DECK, rng)
  const styles = new Map(
    Object.keys(RECIPES).map((modeId) => [
      modeId,
      shuffled(
        STYLE_FAMILIES.map((style) => style.id),
        rng,
      ),
    ]),
  )

  return (slot) => {
    const modeId = deck[slot % deck.length]
    const inCycle = deck.slice(0, slot % deck.length).filter((dealt) => dealt === modeId).length
    const earlier = Math.floor(slot / deck.length) * RECIPES[modeId].weight + inCycle
    const ofMode = styles.get(modeId)!
    return { modeId, styleFamily: ofMode[earlier % ofMode.length] }
  }
}

function rollParams(rng: SeededRandom, modeId: string, styleFamily: StyleFamily): LogoParams {
  const style = getStyleFamilyDefaults(modeId, styleFamily)
  const rolled = RECIPES[modeId].roll(rng, style)

  return {
    ...DEFAULT_PARAMS,
    ...style.shared,
    enabledShapes: NO_BLOBS,
    ...rolled.shared,
    fillColor: DEFAULT_PARAMS.fillColor,
    seed: rng.nextInt(0, 999_999),
    modeId,
    generatorId: getModeGeneratorId(modeId),
    styleFamily,
    modeParams: { [modeId]: { ...style.modeParams, ...rolled.mode } },
  }
}

function hasPath(shape: ShapeNode): shape is Piece {
  return Boolean(shape.pathData)
}

function keepSome<T>(pieces: T[], [least, most]: [number, number], rng: SeededRandom): T[] {
  // An odd count cannot be whole opposite pairs, so what is left is lopsided.
  let needed = Math.max(3, Math.round(pieces.length * rng.nextFloat(least, most))) | 1

  return pieces.filter((_, index) => {
    const keep = rng.next() * (pieces.length - index) < needed
    if (keep) needed--
    return keep
  })
}

function redrawn(piece: Piece, change: { center?: Piece['center']; radius?: number }): Piece {
  const next = { ...piece, ...change }
  const { x, y } = next.center
  return {
    ...next,
    pathData: createPrimitivePath(next.type as PrimitiveType, x, y, next.radius, next.rotation, next.params),
  }
}

function overlaps(a: paper.Path, b: paper.Path): boolean {
  return a.intersects(b) || a.contains(b.firstSegment.point) || b.contains(a.firstSegment.point)
}

interface Placed {
  piece: Piece
  outline: paper.Path
  centre: paper.Point
  /** Radius of the largest circle about the centre that fits inside the piece. */
  inner: number
}

function place(piece: Piece): Placed {
  const outline = new (getScope().Path)(piece.pathData)
  const centre = new paper.Point(piece.center)
  return { piece, outline, centre, inner: outline.getNearestPoint(centre).getDistance(centre) }
}

/** The largest group of pieces that overlaps hold together, the earliest on a tie. */
function mainBody(adds: Placed[]): Placed[] {
  const grouped = new Set<Placed>()
  let largest: Placed[] = []

  for (const first of adds) {
    if (grouped.has(first)) continue
    const group = [first]
    grouped.add(first)
    // The group grows while it is walked, so every member's neighbours are visited.
    for (const member of group) {
      for (const other of adds) {
        if (grouped.has(other) || !overlaps(member.outline, other.outline)) continue
        grouped.add(other)
        group.push(other)
      }
    }
    if (group.length > largest.length) largest = group
  }
  return largest
}

/**
 * The piece moved along the line to the nearest anchor until the circles
 * inside the two overlap. A piece already that deep stays where it is.
 */
function pulledOnto(loose: Placed, anchors: Placed[]): Placed {
  const gap = (anchor: Placed) => anchor.centre.getDistance(loose.centre) - anchor.inner - loose.inner
  const nearest = anchors.reduce((best, anchor) => (gap(anchor) < gap(best) ? anchor : best))
  const reach = (nearest.inner + loose.inner) * GATHERED_REACH
  const apart = loose.centre.subtract(nearest.centre)
  if (apart.length <= reach) return loose

  const centre = nearest.centre.add(apart.normalize(reach))
  return place(
    redrawn(loose.piece, { center: { x: Math.round(centre.x * 1000) / 1000, y: Math.round(centre.y * 1000) / 1000 } }),
  )
}

/**
 * Loose adds are moved onto the main body, then every cut far enough onto
 * the nearest add to bite it. Each move is worked out from the body as it
 * stood, so a piece and its rotated copies move alike.
 */
function gathered(pieces: Piece[]): Piece[] {
  const placed = pieces.map(place)
  const adds = placed.filter(({ piece }) => piece.operation === 'add')
  if (adds.length === 0) return pieces

  const body = mainBody(adds)
  const settled = adds.map((add) => (body.includes(add) ? add : pulledOnto(add, body)))
  const cuts = placed.filter(({ piece }) => piece.operation === 'subtract').map((cut) => pulledOnto(cut, settled))
  getScope().project.clear()
  return [...settled, ...cuts].map(({ piece }) => piece)
}

/**
 * The cells of a TILE by TILE grid over the square about the box that the
 * path inks, by the even-odd rule: 1 where a cell's centre is inside. Shapes
 * are compared cell by cell, because Paper's boolean operations give wrong
 * areas for a shape met with its own mirror image.
 */
function cellsInked(pathData: string, box: Box): Uint8Array {
  const cell = Math.max(box.width, box.height) / TILE
  const left = box.x + box.width / 2 - (cell * TILE) / 2
  const top = box.y + box.height / 2 - (cell * TILE) / 2

  const ink = new (getScope().CompoundPath)(pathData)
  const edges: number[] = []
  for (const contour of ink.children as paper.Path[]) {
    for (const curve of contour.curves) {
      const steps = curve.isStraight() ? 1 : CURVE_STEPS
      let from = curve.point1
      for (let step = 1; step <= steps; step++) {
        const to = step === steps ? curve.point2 : curve.getPointAtTime(step / steps)
        edges.push((from.x - left) / cell, (from.y - top) / cell, (to.x - left) / cell, (to.y - top) / cell)
        from = to
      }
    }
  }
  ink.remove()

  const cells = new Uint8Array(TILE * TILE)
  for (let row = 0; row < TILE; row++) {
    const level = row + 0.5
    const crossings: number[] = []
    for (let edge = 0; edge < edges.length; edge += 4) {
      const [x1, y1, x2, y2] = [edges[edge], edges[edge + 1], edges[edge + 2], edges[edge + 3]]
      if (y1 <= level !== y2 <= level) crossings.push(x1 + ((level - y1) / (y2 - y1)) * (x2 - x1))
    }
    crossings.sort((a, b) => a - b)
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const last = Math.min(TILE - 1, Math.floor(crossings[pair + 1] - 0.5))
      for (let column = Math.max(0, Math.ceil(crossings[pair] - 0.5)); column <= last; column++) {
        cells[row * TILE + column] = 1
      }
    }
  }
  return cells
}

function boxAround(pieces: Piece[]): Box {
  const scope = getScope()
  const box = pieces
    .map((piece) => new scope.Path(piece.pathData).bounds)
    .reduce((all, bounds) => all.unite(bounds))
  scope.project.clear()
  return box
}

interface Tally {
  /** Cells inked once every piece is applied. */
  ink: number
  /** Cells the adds ink before any cut. */
  added: number
  /** Per piece, the cells whose ink would change were it taken away. */
  effects: number[]
}

function tally(pieces: Piece[], cells: Uint8Array[]): Tally {
  const adding = new Uint8Array(TILE * TILE)
  const cutting = new Uint8Array(TILE * TILE)
  pieces.forEach((piece, index) => {
    const counts = piece.operation === 'add' ? adding : cutting
    for (let cell = 0; cell < counts.length; cell++) counts[cell] += cells[index][cell]
  })

  let ink = 0
  let added = 0
  for (let cell = 0; cell < adding.length; cell++) {
    if (adding[cell]) added++
    if (adding[cell] && !cutting[cell]) ink++
  }
  // An add shows where it alone adds and nothing cuts. A cut shows where it alone cuts ink.
  const shows = {
    add: (cell: number) => adding[cell] === 1 && !cutting[cell],
    subtract: (cell: number) => cutting[cell] === 1 && adding[cell] > 0,
  }
  const effects = pieces.map((piece, index) => {
    let changed = 0
    for (let cell = 0; cell < adding.length; cell++) {
      if (cells[index][cell] && shows[piece.operation](cell)) changed++
    }
    return changed
  })
  return { ink, added, effects }
}

/**
 * The pieces that show. A piece is dropped when taking it away would change
 * under MIN_EFFECT of the ink: an add inside the others, a cut that misses or
 * only nicks. The least telling goes first, since one going changes what the
 * rest do. Null when the cuts leave under MIN_KEPT of what was added.
 */
function tellingPieces(pieces: Piece[]): Piece[] | null {
  const adds = pieces.filter((piece) => piece.operation === 'add')
  if (adds.length === 0) return null

  const box = boxAround(adds)
  let shown = pieces
  let cells = pieces.map((piece) => cellsInked(piece.pathData, box))
  while (shown.length > 0) {
    const { ink, added, effects } = tally(shown, cells)
    const weakest = effects.indexOf(Math.min(...effects))
    if (effects[weakest] >= MIN_EFFECT * ink) return ink < MIN_KEPT * added ? null : shown
    shown = shown.filter((_, index) => index !== weakest)
    cells = cells.filter((_, index) => index !== weakest)
  }
  return null
}

/** The area of a composed mark, and the areas of its separate pieces of ink. */
function inkOf(pathData: string): { area: number; islands: number[] } {
  const scope = getScope()
  const ink = new scope.CompoundPath(pathData)
  const { area } = ink
  // A hole runs the other way round from the piece it is in, so it counts against the total.
  const islands = (ink.children as paper.Path[])
    .map((contour) => contour.area * Math.sign(area))
    .filter((contourArea) => contourArea > 0)
  ink.remove()
  return { area: Math.abs(area), islands }
}

/** Share of the ink that a mirror image about the middle leaves uncovered, the smaller of left-right and top-bottom. */
function lopsidedness(tile: Uint8Array): number {
  let ink = 0
  let offSideways = 0
  let offUpright = 0
  for (let row = 0; row < TILE; row++) {
    for (let column = 0; column < TILE; column++) {
      if (!tile[row * TILE + column]) continue
      ink++
      if (!tile[row * TILE + (TILE - 1 - column)]) offSideways++
      if (!tile[(TILE - 1 - row) * TILE + column]) offUpright++
    }
  }
  return Math.min(offSideways, offUpright) / ink
}

/** Share of two marks' ink they do not have in common: 0 for the same mark, 1 for nothing shared. */
function difference(first: Uint8Array, second: Uint8Array): number {
  let shared = 0
  let total = 0
  for (let cell = 0; cell < first.length; cell++) {
    shared += first[cell] & second[cell]
    total += first[cell] + second[cell]
  }
  return 1 - (2 * shared) / total
}

interface Rolled {
  spark: Spark
  /** The mark on the grid, fitted to its own bounding box as a tray tile fits it. */
  tile: Uint8Array
}

function buildSpark(id: string, params: LogoParams): Rolled | null {
  const { keepShare, cutScale, gather } = RECIPES[params.modeId]
  const generated = generatedShapesInApplyOrder(generate(params).shapes.filter(hasPath))
  const kept = keepShare ? keepSome(generated, keepShare, new SeededPRNG(`pieces:${params.seed}`)) : generated
  const resized = (piece: Piece) =>
    cutScale && piece.operation === 'subtract' ? redrawn(piece, { radius: piece.radius * cutScale }) : piece
  const sized = kept.map(resized)
  const pieces = tellingPieces(gather ? gathered(sized) : sized)
  if (!pieces) return null

  const shapes = pieces.map((piece, index): SparkShape => ({
    id: piece.id,
    name: `${PIECE_NAMES[piece.type]} ${index + 1}`,
    operation: piece.operation,
    pathData: piece.pathData,
  }))
  const adds = shapes.filter((shape) => shape.operation === 'add')
  if (shapes.length > MAX_SHAPES || shapes.length < MIN_SHAPES || adds.length < MIN_ADDS) return null

  const { compoundPathData, viewBox } = composeOrderedPaths(shapes)
  const { width, height } = viewBox
  if (Math.max(width, height) < MIN_SIDE) return null
  const { area, islands } = inkOf(compoundPathData)
  if (islands.length > MAX_ISLANDS || Math.min(...islands) < MIN_ISLAND * area) return null
  if (area < MIN_INKED * width * height) return null

  const tile = cellsInked(compoundPathData, viewBox)
  if (lopsidedness(tile) < MIN_LOPSIDED) return null

  return { spark: { id, params, shapes, mark: { compoundPathData, fillRule: 'evenodd', viewBox } }, tile }
}

export function rollSparks(count: number, shuffleSeed: number): Spark[] {
  const deal = dealer(shuffleSeed)
  const tray: Rolled[] = []

  for (let slot = 0; slot < count; slot++) {
    const id = `spark-${shuffleSeed}-${slot}`
    const { modeId, styleFamily } = deal(slot)
    // One stream per slot. A rejected roll draws again from it. A slot depends
    // on the slots before it alone, so it rolls the same spark whatever the count.
    const rng = new SeededPRNG(id)
    const beside = tray.slice(-(MODE_DECK.length - 1))

    for (;;) {
      const rolled = buildSpark(id, rollParams(rng, modeId, styleFamily))
      if (rolled && beside.every((other) => difference(other.tile, rolled.tile) >= MIN_DIFFERENCE)) {
        tray.push(rolled)
        break
      }
    }
  }

  return tray.map(({ spark }) => spark)
}

/**
 * The fit is baked into the path data. A layer transform scales about the
 * layer's own centre and the store adapter's matrix about the origin, so only
 * the identity transform means the same in both.
 */
export function sparkLayers(spark: Spark, target: SparkTarget): IllustratorLayer[] {
  const { x, y, width, height } = spark.mark.viewBox
  const fit = new paper.Matrix()
    .translate(target.center.x, target.center.y)
    .scale(target.span / Math.max(width, height))
    .translate(-(x + width / 2), -(y + height / 2))

  const scope = getScope()
  const layers = spark.shapes.map((shape): IllustratorLayer => {
    const outline = new scope.Path(shape.pathData)
    outline.transform(fit)
    return {
      id: crypto.randomUUID(),
      name: shape.name,
      operation: shape.operation,
      visible: true,
      locked: false,
      pathData: outline.pathData,
      fillRule: 'evenodd',
      transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
    }
  })
  scope.project.clear()
  return layers
}
