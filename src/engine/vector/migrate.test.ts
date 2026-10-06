import paper from 'paper'
import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { STAGE_1_LINK } from '../../../e2e/fixtures/stage1Link.ts'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec, type SlabSpec } from '../carve/spec.ts'
import { isObjectCarveValid, segsToContour } from '../carve/sync.ts'
import { composeIllustratorMark } from '../illustrator/compose.ts'
import type { IllustratorDocument, IllustratorLayer, IllustratorTransform } from '../illustrator/types.ts'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import { getAllModeParamDefaults } from '../../store/modes.ts'
import { composeVectorMark } from './export.ts'
import { illustratorDocumentToVectorDocument, matrixFromIllustratorTransform } from './legacyImport.ts'
import { decodeLink, documentFromGeneratorLink, encodeLink } from './link.ts'
import { bakeLegacyTransform, readLegacyLayers, readVectorDocument, upgradeV1 } from './migrate.ts'
import { pathDataToContours } from './pathSerialization.ts'
import { createSavedVariation, savedDocument } from './saved.ts'
import type { PathObject, VectorDocument } from './types.ts'
import type { PathObjectV1, VectorDocumentV1 } from './v1.ts'

/** A document the test expects to read. */
function readable<T>(value: T | null): T {
  if (value === null) throw new Error('could not be read')
  return value
}

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function areaOf(pathData: string): number {
  scope.activate()
  const item = scope.PathItem.create(pathData)
  const area = Math.abs((item as unknown as { area: number }).area)
  scope.project.clear()
  return area
}

/**
 * The area two marks do not share, each read even-odd as it is drawn. The
 * two differences are measured apart: summed in one shape they would turn
 * opposite ways and cancel.
 */
function symmetricDifference(a: string, b: string): number {
  scope.activate()
  const x = scope.PathItem.create(a)
  const y = scope.PathItem.create(b)
  x.fillRule = 'evenodd'
  y.fillRule = 'evenodd'
  const inkOf = (item: paper.PathItem) => Math.abs((item as unknown as { area: number }).area)
  const area = inkOf(x.subtract(y)) + inkOf(y.subtract(x))
  scope.project.clear()
  return area
}

const IDENTITY: IllustratorTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 }
const PEN_TRANSFORM: IllustratorTransform = { dx: 30, dy: -12, scale: 1.2, rotation: 20 }
const PEN = 'M-120,-40C-60,-160 80,-140 140,-30C160,40 40,150 -30,120C-110,90 -150,20 -120,-40Z'

function layer(id: string, pathData: string, extra: Partial<IllustratorLayer> = {}): IllustratorLayer {
  return { id, name: id, operation: 'add', visible: true, locked: false, pathData, fillRule: 'nonzero', transform: IDENTITY, ...extra }
}

function layers(list: IllustratorLayer[]): IllustratorDocument {
  return {
    id: 'doc',
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers: list,
    selectedLayerIds: list.map((each) => each.id),
    pointSelection: null,
    mode: 'object',
  }
}

const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const packed = (value: unknown) => compressToEncodedURIComponent(JSON.stringify(value))

/** A version 1 document with a pen shape turned and scaled by a legacy transform, under a punch. */
function penDocument(): { v1: VectorDocumentV1; drawn: string } {
  const punch = carveOutline({ v: 1, kind: 'punch', shape: 'circle', center: { x: 10, y: 0 }, radius: 40, rotation: 0 }).pathData
  const doc = layers([layer('pen', PEN), layer('punch', punch, { operation: 'subtract', fillRule: 'evenodd' })])
  const v1 = stored(illustratorDocumentToVectorDocument(doc))
  ;(v1.objects[0] as PathObjectV1).transform = matrixFromIllustratorTransform(PEN_TRANSFORM)
  // As stage 1 drew it: the layer keeps the transform and compose applies it.
  const drawn = composeIllustratorMark({ ...doc, layers: [{ ...doc.layers[0], transform: PEN_TRANSFORM }, doc.layers[1]] }).compoundPathData
  return { v1, drawn }
}

describe('a version 1 document', () => {
  it('draws exactly as stage 1 drew it, its legacy transform baked into the points', () => {
    const { v1, drawn } = penDocument()
    const upgraded = readable(upgradeV1(v1))
    const pen = upgraded.objects[0] as PathObject
    expect(pen).not.toHaveProperty('transform')
    expect(pen.contours).toHaveLength(1)
    const mark = composeVectorMark(upgraded).compoundPathData
    expect(symmetricDifference(mark, drawn)).toBeLessThan(0.5)
    expect(areaOf(mark)).toBeCloseTo(areaOf(drawn), 3)

    // The check sees a bake turned one degree too far, though its area is the same.
    const misturned = bakeLegacyTransform(pathDataToContours(PEN), { ...PEN_TRANSFORM, rotation: PEN_TRANSFORM.rotation + 1 })
    const wrong = composeVectorMark({ ...upgraded, objects: [{ ...pen, contours: misturned }, upgraded.objects[1]] }).compoundPathData
    expect(areaOf(wrong)).toBeCloseTo(areaOf(drawn), 1)
    expect(symmetricDifference(wrong, drawn)).toBeGreaterThan(100)
  })

  it('takes its operation from its source, and leaves appearance, source, transform, artboard and selection behind', () => {
    const { v1 } = penDocument()
    const upgraded = readable(upgradeV1(v1))
    expect(upgraded).toMatchObject({ schemaVersion: 2, id: v1.id, name: v1.name, guides: [], fillets: [] })
    expect(upgraded).not.toHaveProperty('selection')
    expect(upgraded.objects.map((object) => object.type === 'path' && object.operation)).toEqual(['add', 'subtract'])
    for (const object of upgraded.objects) {
      expect(Object.keys(object).sort()).toEqual(
        expect.arrayContaining(['contours', 'fillRule', 'id', 'locked', 'name', 'operation', 'parentId', 'type', 'visible']),
      )
      for (const gone of ['appearance', 'source', 'transform', 'artboardId', 'path']) expect(object).not.toHaveProperty(gone)
      if (object.type !== 'path') continue
      for (const segment of object.contours[0].segments) expect(segment).not.toHaveProperty('pointType')
    }
  })

  it('folds a stray transform on a recipe into the recipe, which still matches its contour', () => {
    const spec = slabSpec('square')
    const v1 = stored(illustratorDocumentToVectorDocument(layers([layer('slab', carveOutline(spec).pathData, { carve: spec, fillRule: 'evenodd' })])))
    const drawnLayer = layer('slab', carveOutline(spec).pathData, { fillRule: 'evenodd', transform: { dx: 10, dy: -4, scale: 1.5, rotation: 30 } })
    ;(v1.objects[0] as PathObjectV1).transform = matrixFromIllustratorTransform(drawnLayer.transform)
    const upgraded = readable(upgradeV1(v1))
    const slab = upgraded.objects[0] as PathObject
    const carve = slab.carve as SlabSpec
    expect(carve).toMatchObject({ kind: 'slab', center: { x: 10, y: -4 }, width: 570, height: 570, rotation: 30 })
    expect(isObjectCarveValid(carve, slab.contours)).toBe(true)
    const drawn = composeIllustratorMark(layers([drawnLayer])).compoundPathData
    expect(symmetricDifference(composeVectorMark(upgraded).compoundPathData, drawn)).toBeLessThan(0.5)
  })

  /** A version 1 document holding one recipe under a stray transform, and how stage 1 drew it. */
  function strayRecipe(spec: CarveSpec, transform: IllustratorTransform): { v1: VectorDocumentV1; drawn: string } {
    const pathData = carveOutline(spec).pathData
    const v1 = stored(illustratorDocumentToVectorDocument(layers([layer('cut', pathData, { carve: spec, fillRule: 'evenodd' })])))
    ;(v1.objects[0] as PathObjectV1).transform = matrixFromIllustratorTransform(transform)
    const drawn = composeIllustratorMark(layers([layer('cut', pathData, { fillRule: 'evenodd', transform })])).compoundPathData
    return { v1, drawn }
  }

  it('draws a slice under a stray scale as stage 1 drew it, dropping the recipe whose reach would not scale', () => {
    const spec: CarveSpec = { v: 1, kind: 'slice', from: { x: -100, y: -20 }, to: { x: 120, y: 30 }, width: 24 }
    const { v1, drawn } = strayRecipe(spec, { dx: 0, dy: 0, scale: 2, rotation: 0 })
    const cut = readable(upgradeV1(v1)).objects[0] as PathObject
    expect(cut.carve).toBeUndefined()
    // The slice runs 16,000 units, so the old mark's three decimals alone leave a few square units.
    expect(symmetricDifference(composeVectorMark(readable(upgradeV1(v1))).compoundPathData, drawn)).toBeLessThan(areaOf(drawn) * 1e-5)
  })

  it('draws a bent channel under a stray turn and scale as stage 1 drew it', () => {
    const spec: CarveSpec = { v: 1, kind: 'channel', from: { x: -150, y: 0 }, to: { x: 150, y: 10 }, width: 30, bend: { a1: 0.1, o1: 40, a2: -0.05, o2: 25 } }
    const { v1, drawn } = strayRecipe(spec, { dx: 12, dy: -7, scale: 2.3, rotation: -71.5 })
    const upgraded = readable(upgradeV1(v1))
    const cut = upgraded.objects[0] as PathObject
    if (cut.carve !== undefined) expect(isObjectCarveValid(cut.carve, cut.contours)).toBe(true)
    expect(symmetricDifference(composeVectorMark(upgraded).compoundPathData, drawn)).toBeLessThan(0.5)
  })

  it('drops a recipe that no longer matches its path, and keeps the path', () => {
    const spec = slabSpec('square')
    const v1 = stored(illustratorDocumentToVectorDocument(layers([layer('slab', carveOutline(spec).pathData, { carve: spec })])))
    ;(v1.objects[0] as PathObjectV1).carve = { ...spec, width: 100 }
    const slab = readable(upgradeV1(v1)).objects[0] as PathObject
    expect(slab.carve).toBeUndefined()
    expect(slab.contours[0].segments).toHaveLength(carveOutline(spec).segs.length)
  })

  it('drops shapes, text and groups, which no stage 1 edit ever kept', () => {
    const { v1 } = penDocument()
    const base = { parentId: null, artboardId: v1.artboards[0].id, visible: true, locked: false, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, source: null }
    const appearance = (v1.objects[0] as PathObjectV1).appearance
    const extra = [
      { ...base, id: 's', type: 'shape', name: 's', appearance, shape: { type: 'circle', cx: 0, cy: 0, radius: 5 } },
      { ...base, id: 'g', type: 'group', name: 'g', childIds: ['pen'] },
    ]
    const document = readVectorDocument({ ...v1, objects: [...v1.objects, ...extra] })
    expect(document?.objects.map((object) => object.id)).toEqual(['pen', 'punch'])
  })

  it('that stage 1 itself would refuse is refused', () => {
    const { v1 } = penDocument()
    expect(readVectorDocument({ ...v1, artboards: [] })).toBeNull()
    expect(readVectorDocument({ ...v1, objects: [{ ...v1.objects[0], appearance: null }] })).toBeNull()
    expect(readVectorDocument({ ...v1, schemaVersion: 3 })).toBeNull()
  })
})

describe('old links', () => {
  it('a link stage 1 wrote opens upgraded and draws the mark stage 1 drew', () => {
    const link = decodeLink(STAGE_1_LINK.hash)
    if (link.kind !== 'vector') throw new Error(`decoded as ${link.kind}`)
    expect(link.inkColor).toBe(STAGE_1_LINK.inkColor)
    expect(link.document.schemaVersion).toBe(2)
    expect(link.document.objects.map((object) => object.type === 'path' && object.operation)).toEqual(['add', 'subtract', 'subtract'])
    const mark = composeVectorMark(link.document)
    expect(symmetricDifference(mark.compoundPathData, STAGE_1_LINK.mark.compoundPathData)).toBeLessThan(0.5)
    expect(areaOf(mark.compoundPathData)).toBeCloseTo(STAGE_1_LINK.area, 2)
    expect(mark.viewBox).toEqual(STAGE_1_LINK.mark.viewBox)
  })

  it('an `#i=` link splits a layer into one object per subpath and draws as stage 1 drew it', () => {
    const doc = layers([
      layer('frame', 'M-100,-100L100,-100L100,100L-100,100Z M-50,-50L50,-50L50,50L-50,50Z'),
      layer('bar', 'M-150,-10L150,-10L150,10L-150,10Z', { transform: { dx: 0, dy: 20, scale: 1, rotation: 15 } }),
    ])
    const link = decodeLink(`#v=1.0&i=${packed(doc)}`)
    if (link.kind !== 'legacy-layers') throw new Error(`decoded as ${link.kind}`)
    const document = readable(readLegacyLayers(link.document))
    expect(document.objects.map((object) => object.id)).toEqual(['frame_1', 'frame_2', 'bar'])
    expect(document.objects.every((object) => object.type === 'path' && object.contours.length === 1)).toBe(true)
    const drawn = composeIllustratorMark(doc).compoundPathData
    expect(symmetricDifference(composeVectorMark(document).compoundPathData, drawn)).toBeLessThan(0.5)
  })

  it('an `#i=` layer missing what stage 1 tolerated opens with the values stage 1 drew it with', () => {
    const square = 'M-100,-100L100,-100L100,100L-100,100Z'
    const { fillRule: _fillRule, name: _name, visible: _visible, locked: _locked, transform: _transform, ...bare } = layer('bare', square)
    const doc = { ...layers([]), layers: [bare, { ...layer('', 'M150,-20L190,-20L190,20L150,20Z'), id: 7 }], selectedLayerIds: [] }
    const link = decodeLink(`#v=1.0&i=${packed(doc)}`)
    if (link.kind !== 'legacy-layers') throw new Error(`decoded as ${link.kind}`)
    const document = readable(readLegacyLayers(link.document))
    expect(document.objects).toEqual([
      expect.objectContaining({ id: 'bare', name: '', visible: false, locked: false, fillRule: 'nonzero' }),
      expect.objectContaining({ id: '7' }),
    ])
    expect(areaOf(composeVectorMark(document).compoundPathData)).toBeCloseTo(40 * 40, 3)
  })

  it('an `#i=` layer whose path holds a number that is not finite adds nothing, and the rest of the link draws', () => {
    const square = 'M-200,-200L0,-200L0,0L-200,0Z'
    for (const bad of ['M0,0L100,0L100', 'M0,0LNaN,0L100,100Z', 'M1e400,0L100,0L100,100Z']) {
      const doc = layers([layer('a', square), layer('b', bad), layer('c', `M300,300L400,300L400,400Z ${bad}`)])
      const link = decodeLink(`#v=1.0&i=${packed(doc)}`)
      if (link.kind !== 'legacy-layers') throw new Error(`decoded as ${link.kind}`)
      const document = readable(readLegacyLayers(link.document))
      expect(document.objects.map((object) => object.id)).toEqual(['a', 'c_1'])
      expect(areaOf(composeVectorMark(document).compoundPathData)).toBeCloseTo(200 * 200 + 100 * 100 / 2, 3)
    }
  })

  it('a generator link builds version 2 directly, one object per subpath', () => {
    const params = { ...DEFAULT_PARAMS, modeParams: getAllModeParamDefaults(), seed: 42 } as LogoParams
    const document = documentFromGeneratorLink(params)
    expect(document).toMatchObject({ schemaVersion: 2, guides: [], fillets: [] })
    expect(document.objects.every((object) => object.type === 'path' && object.contours.length === 1)).toBe(true)
    expect(readVectorDocument(stored(document))).toEqual(stored(document))
  })
})

describe('a version 2 document', () => {
  it('goes through a link and back unchanged, without its selection', () => {
    const { v1 } = penDocument()
    const document = stored(readable(upgradeV1(v1)))
    const link = decodeLink(encodeLink(document, '#ff3300'))
    expect(link).toEqual({ kind: 'vector', document, inkColor: '#ff3300' })
  })

  it("a ring's contours go through a link and back as one object", () => {
    const { v1 } = penDocument()
    const document = stored(readable(upgradeV1(v1)))
    const ring: PathObject = {
      id: 'ring',
      name: 'Ring',
      parentId: null,
      visible: true,
      locked: false,
      type: 'path',
      operation: 'add',
      fillRule: 'evenodd',
      contours: [
        { closed: true, segments: [-1, 1].flatMap((y) => [-1, 1].map((x) => ({ point: { x: 200 * x * y, y: 200 * y }, handleIn: null, handleOut: null }))) },
        { closed: true, segments: [-1, 1].flatMap((y) => [-1, 1].map((x) => ({ point: { x: 50 * x * y, y: 50 * y }, handleIn: null, handleOut: null }))) },
      ],
    }
    const withRing = { ...document, objects: [ring] }
    const link = decodeLink(encodeLink(withRing, '#111111'))
    if (link.kind !== 'vector') throw new Error(`decoded as ${link.kind}`)
    expect(link.document.objects).toEqual([ring])
    expect(areaOf(composeVectorMark(link.document).compoundPathData)).toBeCloseTo(400 * 400 - 100 * 100, 3)
  })

  it('keeps its guides, fillets, groups, links and pins through a link and a saved mark', () => {
    const spec = slabSpec('circle')
    const circle = segsToContour(carveOutline(spec).segs)
    const document = stored({
      ...readable(upgradeV1(penDocument().v1)),
      objects: [
        { id: 'g', name: 'Group', parentId: null, visible: true, locked: false, type: 'group', isolated: true, operation: 'add', frame: { rotation: 10 } },
        { id: 'a', name: 'A', parentId: 'g', visible: true, locked: false, type: 'path', operation: 'add', contours: [circle], fillRule: 'evenodd', carve: spec },
        {
          id: 'b',
          name: 'B',
          parentId: 'g',
          visible: true,
          locked: false,
          type: 'path',
          operation: 'subtract',
          contours: [circle],
          fillRule: 'evenodd',
          carve: spec,
          pin: { centreOf: 'a' },
          link: { kind: 'offset', of: 'a', distance: -20 },
        },
      ],
      guides: [{ id: 'h', name: 'Centre', visible: true, locked: false, style: 'dashed', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 0 }, link: { kind: 'construction', of: 'a', role: 'centre-y' } }],
      fillets: [{ id: 'f', visible: true, radius: 12, at: { x: 200, y: 0 }, between: ['a', 'b'] }],
    }) as VectorDocument
    expect(readVectorDocument(document)).toBe(document)
    const link = decodeLink(encodeLink(document, '#111111'))
    expect(link).toEqual({ kind: 'vector', document, inkColor: '#111111' })
    const params = { ...DEFAULT_PARAMS, modeParams: getAllModeParamDefaults() } as LogoParams
    expect(savedDocument(stored(createSavedVariation(document, params)))?.document).toEqual(document)
  })

  it("keeps the 360-object mark's link far shorter than version 1 did (121,631 characters)", () => {
    const params = {
      ...DEFAULT_PARAMS,
      modeParams: getAllModeParamDefaults(),
      modeId: 'geometric-radial',
      generatorId: 'geometric-radial',
      styleFamily: 'tech',
      gridRings: 8,
      symmetryFolds: 12,
    } as LogoParams
    const document = documentFromGeneratorLink(params)
    expect(document.objects).toHaveLength(360)
    expect(encodeLink(document, '#111111').length).toBeLessThan(75_000)
  })
})
