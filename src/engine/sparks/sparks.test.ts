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
import { illustratorDocumentToVectorDocument } from '../vector/legacyIllustratorAdapter.ts'
import { STYLE_FAMILIES } from '../../store/modes.ts'
import { rollSparks, sparkLayers, type Spark } from './sparks.ts'

const TRAY = 8
const SHUFFLES = Array.from({ length: 24 }, (_, index) => index + 1)

// Shuffle seeds whose first roll only one rule turns away. The trays are too
// few to reach these. 35, 73 and 155 thin a wave-arc to whole mirrored pairs
// if the count may be even, and 476 rolls two shapes huddled 90 units across.
const NARROW_ESCAPES = [35, 73, 155, 476]

let trays: Spark[][]
let sparks: Spark[]

beforeAll(() => {
  trays = SHUFFLES.map((seed) => rollSparks(TRAY, seed))
  sparks = [...trays.flat(), ...NARROW_ESCAPES.flatMap((seed) => rollSparks(1, seed))]
})

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function measure(pathData: string) {
  scope.activate()
  const item = new scope.CompoundPath(pathData)
  const { left, top, right, bottom, width, height } = item.bounds
  const area = Math.abs(item.area)
  const closedSubpaths = item.children.map((child) => (child as paper.Path).closed)
  item.remove()
  return { area, left, top, right, bottom, width, height, closedSubpaths }
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
    expect(new Set(sparks.map((spark) => spark.params.styleFamily))).toEqual(
      new Set(STYLE_FAMILIES.map((style) => style.id)),
    )
    for (const spark of sparks) {
      expect(spark.params.generatorId).toBe(spark.params.modeId)
      expect(spark.params.enabledShapes).toEqual(['circle', 'rectangle', 'triangle', 'polygon'])
    }
  })

  it('gives a spark no colour of its own', () => {
    expect(sparks.length).toBeGreaterThan(0)
    for (const spark of sparks) {
      expect(spark.params.fillColor).toBe(DEFAULT_PARAMS.fillColor)
    }
  })

  it('rolls geometric-radial with one fold about half the time and never more than three', () => {
    const radial = inMode('geometric-radial')
    for (const spark of radial) {
      expect([1, 2, 3]).toContain(spark.params.symmetryFolds)
      expect([2, 3, 4]).toContain(spark.params.gridRings)
    }

    const oneFold = radial.filter((spark) => spark.params.symmetryFolds === 1).length / radial.length
    expect(oneFold).toBeGreaterThan(0.3)
    expect(oneFold).toBeLessThan(0.7)
    expect(new Set(radial.map((spark) => spark.params.symmetryFolds))).toEqual(new Set([1, 2, 3]))
  })

  it('rolls grid-system without mirrors, frame or rotation, on four or five cells a side', () => {
    for (const spark of inMode('grid-system')) {
      expect(modeParams(spark)).toMatchObject({ mirrorX: 0, mirrorY: 0, frameMode: 0 })
      expect(spark.params.rotation).toBe(0)
      expect([4, 5]).toContain(modeParams(spark).columns)
      expect([4, 5]).toContain(modeParams(spark).rows)
    }
  })

  it('rolls modular without the clip disc, on at most five cells a side', () => {
    for (const spark of inMode('modular')) {
      expect(modeParams(spark).circleClip).toBe(0)
      expect(modeParams(spark).columns).toBeLessThanOrEqual(5)
      expect(modeParams(spark).rows).toBeLessThanOrEqual(5)
      expect(spark.shapes.map((shape) => shape.id)).not.toContain('mod_clip')
    }
  })

  it('picks wave-arc for at most about one spark in eight', () => {
    const rolled = trays.flat()
    const waveArc = rolled.filter((spark) => spark.params.modeId === 'wave-arc')

    expect(waveArc.length).toBeGreaterThan(0)
    expect(waveArc.length / rolled.length).toBeLessThan(0.18)
  })

  it('rolls wave-arc with two or three folds and at most three rings', () => {
    for (const spark of inMode('wave-arc')) {
      expect([2, 3]).toContain(modeParams(spark).symmetryFolds)
      expect(modeParams(spark).arcCount).toBeLessThanOrEqual(3)
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
      const copies = modeParams(spark).arcSymmetry === 'radial' ? Number(modeParams(spark).symmetryFolds) : 2
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
      const context = `${spark.id} (${spark.params.modeId}, ${spark.params.styleFamily})`
      const adds = spark.shapes.filter((shape) => shape.operation === 'add')
      const ink = measure(spark.mark.compoundPathData)

      expect(spark.shapes.length, `${context}: shapes`).toBeLessThanOrEqual(40)
      expect(adds.length, `${context}: add shapes`).toBeGreaterThanOrEqual(2)
      expect(ink.area, `${context}: ink`).toBeGreaterThan(0)
      expect(Math.max(ink.width, ink.height), `${context}: larger side`).toBeGreaterThanOrEqual(150)
      expect(ink.area / (ink.width * ink.height), `${context}: share of its bounds inked`).toBeGreaterThanOrEqual(0.08)
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

  it('keeps only cuts that remove ink', () => {
    for (const spark of withCuts().slice(0, 12)) {
      const uncut = composeOrderedPaths(spark.shapes.filter((shape) => shape.operation === 'add')).compoundPathData
      const uncutArea = measure(uncut).area

      for (const cut of spark.shapes.filter((shape) => shape.operation === 'subtract')) {
        const cutOnce = composeOrderedPaths([{ pathData: uncut, operation: 'add' }, cut]).compoundPathData

        expect(uncutArea - measure(cutOnce).area, `${spark.id}: ${cut.id}`).toBeGreaterThan(0.01)
      }
    }
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
      const objects = illustratorDocumentToVectorDocument(documentOf(layers)).objects

      expect(objects.map((object) => object.id)).toEqual(layers.map((layer) => layer.id))
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
