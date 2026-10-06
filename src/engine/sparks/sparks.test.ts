import paper from 'paper'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { composeOrderedPaths } from '../boolean/operations.ts'
import { composeIllustratorMark } from '../illustrator/compose.ts'
import {
  DEFAULT_ILLUSTRATOR_TRANSFORM,
  type IllustratorDocument,
  type IllustratorLayer,
} from '../illustrator/types.ts'
import { objectFromLayer } from '../../store/objectEdits.ts'
import { getStyleFamilyDefaults, STYLE_FAMILIES } from '../../store/modes.ts'
import { rollSparks, sparkLayers, type Spark } from './sparks.ts'

const TRAY = 8
const SHUFFLES = Array.from({ length: 40 }, (_, index) => index + 1)

let trays: Spark[][]
let sparks: Spark[]
/** Milliseconds each tray took to roll, in the order rolled. */
let rollTimes: number[]

beforeAll(() => {
  rollTimes = []
  trays = SHUFFLES.map((seed) => {
    const started = performance.now()
    const tray = rollSparks(TRAY, seed)
    rollTimes.push(performance.now() - started)
    return tray
  })
  sparks = trays.flat()
})

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function inked(pathData: string): paper.CompoundPath {
  scope.activate()
  const item = new scope.CompoundPath(pathData)
  item.fillRule = 'evenodd'
  return item
}

function measure(pathData: string) {
  const item = inked(pathData)
  const { left, top, right, bottom, width, height } = item.bounds
  const area = Math.abs(item.area)
  const closedSubpaths = item.children.map((child) => (child as paper.Path).closed)
  item.remove()
  return { area, left, top, right, bottom, width, height, closedSubpaths }
}

/** Connected pieces of ink: the contours that lie inside an even number of the others. */
function islands(pathData: string): number {
  const item = inked(pathData)
  const contours = (item.children as paper.Path[]).filter((contour) => Math.abs(contour.area) > 1e-6)
  const outer = contours.filter((contour) => {
    const inside = contours.filter((other) => other !== contour && other.contains(contour.firstSegment.point))
    return inside.length % 2 === 0
  })
  item.remove()
  return outer.length
}

const SAMPLES = 32
const sampled = new Map<string, Uint8Array>()

/**
 * The mark asked point by point whether it is inked, over the square about
 * its bounding box. Marks are compared by these points: Paper's boolean
 * operations give wrong areas for a shape met with its own mirror image.
 */
function sample(pathData: string): Uint8Array {
  const known = sampled.get(pathData)
  if (known) return known

  const item = inked(pathData)
  const { center, width, height } = item.bounds
  const side = Math.max(width, height)
  const points = new Uint8Array(SAMPLES * SAMPLES)
  for (let row = 0; row < SAMPLES; row++) {
    for (let column = 0; column < SAMPLES; column++) {
      const point = new paper.Point(
        center.x - side / 2 + ((column + 0.5) / SAMPLES) * side,
        center.y - side / 2 + ((row + 0.5) / SAMPLES) * side,
      )
      points[row * SAMPLES + column] = item.contains(point) ? 1 : 0
    }
  }
  item.remove()
  sampled.set(pathData, points)
  return points
}

/** Share of the mark its mirror image about the middle leaves uncovered, the smaller of left-right and top-bottom. */
function lopsidedness(pathData: string): number {
  const points = sample(pathData)
  let ink = 0
  let offSideways = 0
  let offUpright = 0
  for (let row = 0; row < SAMPLES; row++) {
    for (let column = 0; column < SAMPLES; column++) {
      if (!points[row * SAMPLES + column]) continue
      ink++
      if (!points[row * SAMPLES + (SAMPLES - 1 - column)]) offSideways++
      if (!points[(SAMPLES - 1 - row) * SAMPLES + column]) offUpright++
    }
  }
  return Math.min(offSideways, offUpright) / ink
}

/** Share of two marks' ink they do not have in common once both fill the same box: 0 the same mark, 1 none shared. */
function difference(first: string, second: string): number {
  const a = sample(first)
  const b = sample(second)
  let shared = 0
  let total = 0
  for (let point = 0; point < a.length; point++) {
    shared += a[point] & b[point]
    total += a[point] + b[point]
  }
  return 1 - (2 * shared) / total
}

function shareOf<T>(items: T[], matches: (item: T) => boolean): number {
  expect(items.length).toBeGreaterThan(0)
  return items.filter(matches).length / items.length
}

function inMode(modeId: string): Spark[] {
  const matching = sparks.filter((spark) => spark.params.modeId === modeId)
  expect(matching.length, `${modeId} sparks in the sample`).toBeGreaterThan(0)
  return matching
}

function modeParams(spark: Spark) {
  return spark.params.modeParams[spark.params.modeId]
}

function everyFifth(): Spark[] {
  const sample = sparks.filter((_, index) => index % 5 === 0)
  expect(sample.length).toBeGreaterThan(30)
  return sample
}

function withCuts(): Spark[] {
  const matching = sparks.filter((spark) => spark.shapes.some((shape) => shape.operation === 'subtract'))
  expect(matching.length, 'sparks with a cut in the sample').toBeGreaterThan(0)
  return matching
}

const label = (spark: Spark) => `${spark.id} (${spark.params.modeId}, ${spark.params.styleFamily})`

describe('rolling sparks', () => {
  it('returns the same sparks for the same shuffle seed', () => {
    expect(trays[0]).toHaveLength(TRAY)
    expect(rollSparks(TRAY, SHUFFLES[0])).toEqual(trays[0])
  })

  it('returns a different set for a different shuffle seed', () => {
    const [first, second] = trays
    const firstIds = new Set(first.map((spark) => spark.id))

    expect(second.filter((spark) => firstIds.has(spark.id))).toEqual([])
    expect(second.map((spark) => spark.mark.compoundPathData)).not.toEqual(
      first.map((spark) => spark.mark.compoundPathData),
    )
  })

  it('returns exactly the count asked for, each spark with its own id', () => {
    for (const tray of trays) {
      expect(tray).toHaveLength(TRAY)
      expect(new Set(tray.map((spark) => spark.id)).size).toBe(TRAY)
    }
    expect(rollSparks(11, 99)).toHaveLength(11)
  })

  it('keeps each spark in its slot when the count changes', () => {
    for (const count of [0, 1, 3]) {
      for (const index of [0, 1]) {
        expect(rollSparks(count, SHUFFLES[index])).toEqual(trays[index].slice(0, count))
      }
    }
  })

  it('offers the four modes in every style, never monogram or blob shapes', () => {
    expect(new Set(sparks.map((spark) => spark.params.modeId))).toEqual(
      new Set(['geometric-radial', 'grid-system', 'modular', 'wave-arc']),
    )
    for (const modeId of ['geometric-radial', 'grid-system', 'modular', 'wave-arc']) {
      expect(new Set(inMode(modeId).map((spark) => spark.params.styleFamily)), modeId).toEqual(
        new Set(STYLE_FAMILIES.map((style) => style.id)),
      )
    }
    for (const spark of sparks) {
      expect(spark.params.generatorId).toBe(spark.params.modeId)
      expect(spark.params.enabledShapes).not.toContain('blob')
      expect(spark.shapes.filter((shape) => shape.name.startsWith('Blob'))).toEqual([])
    }
  })

  it('deals every tray three radial, two grid, two modular and one wave-arc spark', () => {
    for (const tray of trays) {
      const dealt = tray.map((spark) => spark.params.modeId).sort()

      expect(dealt, tray[0].id).toEqual([
        ...Array(3).fill('geometric-radial'),
        ...Array(2).fill('grid-system'),
        ...Array(2).fill('modular'),
        'wave-arc',
      ])
    }
  })

  it('gives a spark no colour of its own', () => {
    expect(sparks.length).toBeGreaterThan(0)
    for (const spark of sparks) {
      expect(spark.params.fillColor).toBe(DEFAULT_PARAMS.fillColor)
    }
  })

  it('draws a radial or modular spark with circles and one kind of straight-edged shape', () => {
    for (const spark of [...inMode('geometric-radial'), ...inMode('modular')]) {
      const [round, straight, ...more] = spark.params.enabledShapes

      expect(round).toBe('circle')
      expect(['rectangle', 'triangle', 'polygon']).toContain(straight)
      expect(more).toEqual([])
      for (const shape of spark.shapes) {
        expect(['circle', straight], `${label(spark)}: ${shape.name}`).toContain(shape.name.split(' ')[0].toLowerCase())
      }
    }
  })

  it('rolls geometric-radial on two rings, with one fold more often than not and never more than three', () => {
    const radial = inMode('geometric-radial')
    for (const spark of radial) {
      expect([1, 2, 3]).toContain(spark.params.symmetryFolds)
      expect(spark.params.gridRings).toBe(2)
    }

    expect(shareOf(radial, (spark) => spark.params.symmetryFolds === 1)).toBeGreaterThan(0.5)
    expect(new Set(radial.map((spark) => spark.params.symmetryFolds))).toEqual(new Set([1, 2, 3]))
  })

  it('rolls grid-system without mirrors, frame or rotation, on three to five overlapping cells a side', () => {
    for (const spark of inMode('grid-system')) {
      expect(modeParams(spark)).toMatchObject({ mirrorX: 0, mirrorY: 0, frameMode: 0 })
      expect(spark.params.rotation).toBe(0)
      expect([3, 4, 5]).toContain(modeParams(spark).columns)
      expect([3, 4, 5]).toContain(modeParams(spark).rows)
      expect(modeParams(spark).cellInset).toBeLessThan(0)
    }
  })

  it('rolls modular on two or three modules a side and leaves the clip disc to the style', () => {
    const modular = inMode('modular')
    for (const spark of modular) {
      const style = getStyleFamilyDefaults('modular', spark.params.styleFamily).modeParams

      expect([2, 3]).toContain(modeParams(spark).columns)
      expect([2, 3]).toContain(modeParams(spark).rows)
      expect(modeParams(spark).circleClip, label(spark)).toBe(style.circleClip)
    }

    const clipped = modular.filter((spark) => modeParams(spark).circleClip === 1)
    expect(shareOf(clipped, (spark) => spark.shapes[0].id === 'mod_clip')).toBeGreaterThan(0.9)
    expect(modular.length).toBeGreaterThan(clipped.length)
  })

  it('rolls wave-arc as rotated copies on two rings, three or four to a ring', () => {
    for (const spark of inMode('wave-arc')) {
      expect(modeParams(spark)).toMatchObject({ arcSymmetry: 'radial', arcCount: 2 })
      expect([3, 4]).toContain(modeParams(spark).symmetryFolds)
    }
  })

  it('drops some wave-arc pieces and keeps at least three', () => {
    for (const spark of inMode('wave-arc').slice(0, 5)) {
      const generated = generate(spark.params).shapes

      expect(spark.shapes.length).toBeGreaterThanOrEqual(3)
      expect(spark.shapes.length).toBeLessThan(generated.length)
      for (const shape of spark.shapes) {
        expect(generated.find((piece) => piece.id === shape.id)?.pathData).toBe(shape.pathData)
      }
    }
  })

  it('leaves a wave-arc ring without one of its copies, so the mark is lopsided', () => {
    for (const spark of inMode('wave-arc')) {
      const copies = Number(modeParams(spark).symmetryFolds)
      const kept = new Map<string, number>()
      for (const shape of spark.shapes) {
        const ring = shape.id.match(/^crescent_\d+/)![0]
        kept.set(ring, (kept.get(ring) ?? 0) + 1)
      }

      expect(Math.min(...kept.values()), `${spark.id}: copies of the emptiest ring`).toBeLessThan(copies)
    }
  })

  it('offers no spark that is empty, crowded, tiny or sparse', () => {
    expect(sparks.length).toBeGreaterThan(0)
    for (const spark of sparks) {
      const context = label(spark)
      const adds = spark.shapes.filter((shape) => shape.operation === 'add')
      const ink = measure(spark.mark.compoundPathData)

      expect(spark.shapes.length, `${context}: shapes`).toBeLessThanOrEqual(40)
      expect(spark.shapes.length, `${context}: shapes`).toBeGreaterThanOrEqual(3)
      expect(adds.length, `${context}: add shapes`).toBeGreaterThanOrEqual(2)
      expect(ink.area, `${context}: ink`).toBeGreaterThan(0)
      expect(Math.max(ink.width, ink.height), `${context}: larger side`).toBeGreaterThanOrEqual(150)
      expect(ink.area / (ink.width * ink.height), `${context}: share of its bounds inked`).toBeGreaterThanOrEqual(0.2)
    }
  })

  it('lists adds before cuts', () => {
    for (const spark of withCuts()) {
      const operations = spark.shapes.map((shape) => shape.operation)

      expect(operations.lastIndexOf('add')).toBeLessThan(operations.indexOf('subtract'))
    }
  })

  it('composes each mark from the shapes it lists', () => {
    for (const spark of everyFifth()) {
      const composed = composeOrderedPaths(spark.shapes)
      const expected = measure(composed.compoundPathData)
      const actual = measure(spark.mark.compoundPathData)

      expect(spark.mark.fillRule).toBe('evenodd')
      expect(spark.mark.viewBox).toEqual(composed.viewBox)
      expect(Math.abs(actual.area - expected.area) / expected.area, `${spark.id}: area`).toBeLessThan(0.001)
    }
  })

  it('keeps only shapes that show: taking any one away changes the mark', () => {
    for (const spark of everyFifth().slice(0, 24)) {
      const whole = measure(spark.mark.compoundPathData).area

      for (const shape of spark.shapes) {
        const without = composeOrderedPaths(spark.shapes.filter((other) => other !== shape)).compoundPathData
        const changed = Math.abs(measure(without).area - whole) / whole

        expect(changed, `${label(spark)}: ${shape.name}`).toBeGreaterThan(0.01)
      }
    }
  })

  it('leaves over half of what the adds ink after the cuts', () => {
    // The 40 trays hold no roll that this rule alone turns away. Without it, a slot of each of these two
    // shuffles keeps under 0.36 of its ink.
    const narrowEscapes = [117, 124].flatMap((seed) => rollSparks(TRAY, seed))
    const cut = (spark: Spark) => spark.shapes.some((shape) => shape.operation === 'subtract')

    for (const spark of [...withCuts(), ...narrowEscapes.filter(cut)]) {
      const uncut = composeOrderedPaths(spark.shapes.filter((shape) => shape.operation === 'add')).compoundPathData

      expect(measure(spark.mark.compoundPathData).area / measure(uncut).area, label(spark)).toBeGreaterThan(0.45)
    }
  })
})

describe('a tray of sparks reads as eight different marks', () => {
  /** Two marks that have less than this much of their ink apart, fitted to the same box, look like one mark twice. */
  const NEAR_DUPLICATE = 0.15

  it('holds a mark together: three pieces at most for nearly all, never more than five', () => {
    const pieces = sparks.map((spark) => islands(spark.mark.compoundPathData))

    expect(shareOf(pieces, (count) => count <= 3)).toBeGreaterThanOrEqual(0.85)
    sparks.forEach((spark, index) => {
      expect(pieces[index], `${label(spark)}: pieces`).toBeGreaterThanOrEqual(1)
      expect(pieces[index], `${label(spark)}: pieces`).toBeLessThanOrEqual(5)
    })
  })

  it('cuts ink out of at least half the sparks', () => {
    expect(withCuts().length / sparks.length).toBeGreaterThanOrEqual(0.5)
  })

  it('rolls lopsided marks: nearly all differ from both their mirror images by over a tenth of their ink', () => {
    expect(shareOf(sparks, (spark) => lopsidedness(spark.mark.compoundPathData) > 0.1)).toBeGreaterThanOrEqual(0.85)
  })

  it('never deals the same mode and style twice in a tray', () => {
    for (const tray of trays) {
      const dealt = tray.map((spark) => `${spark.params.modeId}/${spark.params.styleFamily}`)

      expect(new Set(dealt).size, `${tray[0].id}: ${dealt.join(' ')}`).toBe(TRAY)
    }
  })

  it('never deals two near-duplicate marks in a tray', () => {
    for (const tray of trays) {
      tray.forEach((spark, slot) => {
        for (const earlier of tray.slice(0, slot)) {
          expect(
            difference(earlier.mark.compoundPathData, spark.mark.compoundPathData),
            `${label(earlier)} and ${label(spark)}`,
          ).toBeGreaterThanOrEqual(NEAR_DUPLICATE)
        }
      })
    }
  })

  it('measures those with rulers that tell a mark from itself, its mirror image and its pieces', () => {
    const slab = 'M0 0L100 0L100 60L0 60Z'
    const wedge = 'M0 0L100 0L0 60Z'

    expect(difference(slab, slab)).toBe(0)
    expect(difference(slab, wedge)).toBeGreaterThan(0.3)
    expect(difference(slab, 'M0 0L50 0L50 30L0 30Z')).toBe(0)
    expect(lopsidedness(slab)).toBe(0)
    expect(lopsidedness(wedge)).toBeGreaterThan(0.3)
    expect(islands('M0 0L10 0L10 10L0 10ZM20 0L30 0L30 10L20 10Z')).toBe(2)
    // A ring with a dot in its hole: the hole is not a piece, the dot is.
    expect(islands('M0 0L30 0L30 30L0 30ZM5 5L5 25L25 25L25 5ZM12 12L18 12L18 18L12 18Z')).toBe(2)
  })

  it('keeps a spark to 40 layers, and usually between 3 and 20', () => {
    for (const spark of sparks) {
      expect(spark.shapes.length, `${label(spark)}: layers`).toBeLessThanOrEqual(40)
    }
    const usual = (spark: Spark) => spark.shapes.length >= 3 && spark.shapes.length <= 20
    expect(shareOf(sparks, usual)).toBeGreaterThanOrEqual(0.8)
  })

  it('rolls a tray in about 120 ms on average, and never takes more than about 300, once warm', () => {
    // The first trays also pay for compiling the geometry code, three times over when the other test files
    // share the processor: 370 to 410 ms for the first, 80 by the fourth.
    const warm = rollTimes.slice(4)
    const average = warm.reduce((sum, time) => sum + time, 0) / warm.length

    expect(warm.length).toBeGreaterThan(30)
    expect(average).toBeLessThan(120)
    expect(Math.max(...warm)).toBeLessThan(300)
  })
})

describe('turning a spark into layers', () => {
  const CENTRED = { center: { x: 0, y: 0 }, span: 360 }
  const OFF_CENTRE = { center: { x: 140, y: -90 }, span: 120 }

  function documentOf(layers: IllustratorLayer[]): IllustratorDocument {
    return {
      id: 'spark-test',
      source: { seed: 0, modeId: 'spark', generatorId: 'spark', generatorVersion: 'v0' },
      layers,
      selectedLayerIds: [],
      pointSelection: null,
      mode: 'object',
    }
  }

  function compose(layers: IllustratorLayer[]) {
    return measure(composeIllustratorMark(documentOf(layers))!.compoundPathData)
  }

  it('makes one plain layer per shape, adds before cuts', () => {
    for (const spark of [...everyFifth(), ...withCuts()]) {
      const layers = sparkLayers(spark, CENTRED)

      expect(layers).toEqual(
        spark.shapes.map((shape) => ({
          id: expect.any(String),
          name: shape.name,
          operation: shape.operation,
          visible: true,
          locked: false,
          pathData: expect.any(String),
          fillRule: 'evenodd',
          transform: DEFAULT_ILLUSTRATOR_TRANSFORM,
        })),
      )
      expect(layers.every((layer) => layer.name.length > 0)).toBe(true)
    }
  })

  it('gives every layer a fresh id on each call', () => {
    const spark = sparks[0]
    const ids = [...sparkLayers(spark, CENTRED), ...sparkLayers(spark, CENTRED)].map((layer) => layer.id)

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('makes every layer path one closed subpath', () => {
    for (const spark of everyFifth()) {
      for (const layer of sparkLayers(spark, CENTRED)) {
        expect(measure(layer.pathData).closedSubpaths, `${spark.id}: ${layer.name}`).toEqual([true])
      }
    }
  })

  it('keeps every layer id through the store adapter', () => {
    for (const spark of everyFifth()) {
      const layers = sparkLayers(spark, CENTRED)
      const objects = layers.map((layer) => objectFromLayer(layer))

      expect(objects.map((object) => object.id)).toEqual(layers.map((layer) => layer.id))
      expect(objects.every((object) => object.contours.length === 1)).toBe(true)
    }
  })

  it('fits the mark to the span and centres it on the target', () => {
    for (const spark of everyFifth()) {
      const fitted = compose(sparkLayers(spark, CENTRED))

      expect(Math.abs(Math.max(fitted.width, fitted.height) - CENTRED.span), `${spark.id}: span`).toBeLessThan(0.5)
      expect(Math.abs((fitted.left + fitted.right) / 2 - CENTRED.center.x), `${spark.id}: centre x`).toBeLessThan(0.5)
      expect(Math.abs((fitted.top + fitted.bottom) / 2 - CENTRED.center.y), `${spark.id}: centre y`).toBeLessThan(0.5)
    }
  })

  it('composes to the thumbnail mark, scaled and moved by the fit', () => {
    const target = OFF_CENTRE

    for (const spark of everyFifth()) {
      const { x, y, width, height } = spark.mark.viewBox
      const scale = target.span / Math.max(width, height)
      const source = measure(spark.mark.compoundPathData)
      const fitted = compose(sparkLayers(spark, target))
      const expected = {
        left: target.center.x + (source.left - (x + width / 2)) * scale,
        right: target.center.x + (source.right - (x + width / 2)) * scale,
        top: target.center.y + (source.top - (y + height / 2)) * scale,
        bottom: target.center.y + (source.bottom - (y + height / 2)) * scale,
      }

      expect(
        Math.abs(fitted.area - source.area * scale * scale) / (source.area * scale * scale),
        `${spark.id}: area`,
      ).toBeLessThan(0.001)
      for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
        expect(Math.abs(fitted[edge] - expected[edge]), `${spark.id}: ${edge} edge`).toBeLessThan(0.05)
      }
    }
  })
})
