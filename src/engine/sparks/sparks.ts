import paper from 'paper'
import { DEFAULT_PARAMS, type LogoParams, type SeededRandom, type ShapeNode } from '../types.ts'
import { SeededPRNG } from '../random.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { composeOrderedPaths } from '../boolean/operations.ts'
import { generatedShapesInApplyOrder } from '../illustrator/compose.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM, type IllustratorLayer, type MarkData } from '../illustrator/types.ts'
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

interface SparkRecipe {
  /** Odds of the mode against the others. */
  weight: number
  /** Changes to the style defaults that lower the symmetry and keep the piece count small. */
  roll(rng: SeededRandom, style: ModeParams): { shared?: Partial<LogoParams>; mode?: ModeParams }
  /** Least and most of the generated pieces to keep, for a mode no parameter makes lopsided. */
  keepShare?: [number, number]
}

const MAX_CELLS_PER_SIDE = 5
const MAX_WAVE_RINGS = 3

const RECIPES: Record<string, SparkRecipe> = {
  'geometric-radial': {
    weight: 3,
    roll: (rng) => ({
      shared: { symmetryFolds: rng.nextBool() ? 1 : rng.nextInt(2, 3), gridRings: rng.nextInt(2, 4) },
    }),
  },
  'grid-system': {
    weight: 2,
    // A frame leaves a bare outline. The style grids run to 8 cells a side,
    // which is up to 63 pieces, and a 3 by 3 grid fills every cell a third of
    // the time, so the size is rolled between the two.
    roll: (rng) => ({
      shared: { rotation: 0 },
      mode: {
        mirrorX: 0,
        mirrorY: 0,
        frameMode: 0,
        columns: rng.nextInt(4, MAX_CELLS_PER_SIDE),
        rows: rng.nextInt(4, MAX_CELLS_PER_SIDE),
      },
    }),
  },
  modular: {
    weight: 2,
    roll: (_rng, style) => ({
      mode: {
        circleClip: 0,
        columns: Math.min(Number(style.columns), MAX_CELLS_PER_SIDE),
        rows: Math.min(Number(style.rows), MAX_CELLS_PER_SIDE),
      },
    }),
  },
  'wave-arc': {
    weight: 1,
    keepShare: [0.4, 0.7],
    // Crescents cross each other, so uniting them is slow. The style defaults
    // of up to 6 rings and 8 folds take 30 to 400 ms, and these take about 8.
    roll: (rng, style) => ({
      mode: { symmetryFolds: rng.nextInt(2, 3), arcCount: Math.min(Number(style.arcCount), MAX_WAVE_RINGS) },
    }),
  },
}

const MODE_DECK = Object.entries(RECIPES).flatMap(([modeId, recipe]) =>
  Array.from({ length: recipe.weight }, () => modeId),
)

const MAX_SHAPES = 40
const MIN_ADDS = 2
/** Smallest larger side of a mark, in the 500-unit generator space. */
const MIN_SIDE = 150
/** Smallest share of a mark's bounding box that is ink. */
const MIN_INKED = 0.08

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

function rollParams(rng: SeededRandom): LogoParams {
  const modeId = MODE_DECK[rng.nextInt(0, MODE_DECK.length - 1)]
  const styleFamily = STYLE_FAMILIES[rng.nextInt(0, STYLE_FAMILIES.length - 1)].id
  const style = getStyleFamilyDefaults(modeId, styleFamily)
  const lowSymmetry = RECIPES[modeId].roll(rng, style.modeParams)

  return {
    ...DEFAULT_PARAMS,
    ...style.shared,
    ...lowSymmetry.shared,
    fillColor: DEFAULT_PARAMS.fillColor,
    seed: rng.nextInt(0, 999_999),
    modeId,
    generatorId: getModeGeneratorId(modeId),
    styleFamily,
    enabledShapes: DEFAULT_PARAMS.enabledShapes.filter((shape) => shape !== 'blob'),
    modeParams: { [modeId]: { ...style.modeParams, ...lowSymmetry.mode } },
  }
}

function hasPath(shape: ShapeNode): shape is Piece {
  return Boolean(shape.pathData)
}

function keepSome<T>(pieces: T[], [least, most]: [number, number], rng: SeededRandom): T[] {
  // An odd count cannot be whole mirrored pairs, so what is left is lopsided.
  let needed = Math.max(3, Math.round(pieces.length * rng.nextFloat(least, most))) | 1

  return pieces.filter((_, index) => {
    const keep = rng.next() * (pieces.length - index) < needed
    if (keep) needed--
    return keep
  })
}

function overlaps(a: paper.Path, b: paper.Path): boolean {
  return a.intersects(b) || a.contains(b.firstSegment.point) || b.contains(a.firstSegment.point)
}

/** Most generated cuts miss every add. A cut that removes nothing would be a layer the thumbnail does not show. */
function withoutIdleCuts(pieces: Piece[]): Piece[] {
  const scope = getScope()
  const outlines = pieces.map((piece) => new scope.Path(piece.pathData))
  const adds = outlines.filter((_, index) => pieces[index].operation === 'add')
  const kept = pieces.filter(
    (piece, index) => piece.operation === 'add' || adds.some((add) => overlaps(add, outlines[index])),
  )
  scope.project.clear()
  return kept
}

function inkArea(pathData: string): number {
  const scope = getScope()
  const ink = new scope.CompoundPath(pathData)
  const area = Math.abs(ink.area)
  ink.remove()
  return area
}

function buildSpark(id: string, params: LogoParams): Spark | null {
  const { keepShare } = RECIPES[params.modeId]
  const generated = generatedShapesInApplyOrder(generate(params).shapes.filter(hasPath))
  const pieces = keepShare ? keepSome(generated, keepShare, new SeededPRNG(`pieces:${params.seed}`)) : generated
  const shapes = withoutIdleCuts(pieces).map((piece, index): SparkShape => ({
    id: piece.id,
    name: `${PIECE_NAMES[piece.type]} ${index + 1}`,
    operation: piece.operation,
    pathData: piece.pathData,
  }))
  const adds = shapes.filter((shape) => shape.operation === 'add')
  if (shapes.length > MAX_SHAPES || adds.length < MIN_ADDS) return null

  const { compoundPathData, viewBox } = composeOrderedPaths(shapes)
  const { width, height } = viewBox
  if (Math.max(width, height) < MIN_SIDE) return null
  if (inkArea(compoundPathData) < MIN_INKED * width * height) return null

  return { id, params, shapes, mark: { compoundPathData, fillRule: 'evenodd', viewBox } }
}

export function rollSparks(count: number, shuffleSeed: number): Spark[] {
  return Array.from({ length: count }, (_, slot) => {
    const id = `spark-${shuffleSeed}-${slot}`
    // One stream per slot. A rejected roll draws again from it, and the slot
    // rolls the same spark whatever the count.
    const rng = new SeededPRNG(id)

    for (;;) {
      const spark = buildSpark(id, rollParams(rng))
      if (spark) return spark
    }
  })
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
