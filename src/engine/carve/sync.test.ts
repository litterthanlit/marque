import { describe, expect, it } from 'vitest'
import type { IllustratorDocument, IllustratorLayer } from '../illustrator/types.ts'
import { illustratorDocumentToVectorDocument } from '../vector/legacyImport.ts'
import { readLegacyLayers } from '../vector/migrate.ts'
import { vectorDocumentToIllustratorDocument } from '../vector/view.ts'
import { sanitizeVectorDocument } from '../vector/document.ts'
import type { PathObject } from '../vector/types.ts'
import { isIdentityMatrix, type PathObjectV1 } from '../vector/v1.ts'
import { carveOutline } from './outline.ts'
import { roundCarveSpec, slabSpec, type CarveSpec, type SlabSpec } from './spec.ts'

/** A document the test expects to read. */
function readable<T>(value: T | null): T {
  if (value === null) throw new Error('could not be read')
  return value
}

function recipeLayer(spec: CarveSpec, extra: Partial<IllustratorLayer> = {}): IllustratorLayer {
  return {
    id: 'layer-1',
    name: 'Slab',
    operation: 'add',
    visible: true,
    locked: false,
    pathData: carveOutline(spec).pathData,
    fillRule: 'evenodd',
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    carve: spec,
    ...extra,
  }
}

function doc(layers: IllustratorLayer[]): IllustratorDocument {
  return {
    id: 'doc',
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers,
    selectedLayerIds: [],
    pointSelection: null,
    mode: 'object',
  }
}

function roundTrip(layer: IllustratorLayer): IllustratorLayer {
  const vector = readable(readLegacyLayers(doc([layer])))
  return vectorDocumentToIllustratorDocument(vector).layers[0]
}

const bentSlab: SlabSpec = {
  ...slabSpec('rounded'),
  center: { x: 12.3456, y: -7 },
  rotation: 17.123,
  sides: { top: { a1: 0.1, o1: 31.234, a2: 0, o2: 22 } },
  corners: { bl: { k1: 1.4, k2: 0.8 } },
}

describe('recipes through the document adapter', () => {
  it('survive a round trip, rounded to 0.01', () => {
    const back = roundTrip(recipeLayer(bentSlab))
    expect(back.carve).toEqual(roundCarveSpec(bentSlab))
    expect(back.transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
  })

  it('are dropped when the path no longer matches, keeping the shape', () => {
    const stale = recipeLayer(bentSlab, { carve: { ...bentSlab, width: 500 } })
    const vector = illustratorDocumentToVectorDocument(doc([stale]))
    const object = vector.objects[0] as PathObjectV1
    expect(object.carve).toBeUndefined()
    expect(object.path.segments.length).toBe(carveOutline(bentSlab).segs.length)
  })

  it('are dropped for multi-part paths', () => {
    const layer = recipeLayer(bentSlab, { pathData: `${carveOutline(bentSlab).pathData}M0,0L10,0L10,10Z` })
    const vector = illustratorDocumentToVectorDocument(doc([layer]))
    expect(vector.objects.every((o) => (o as PathObjectV1).carve === undefined)).toBe(true)
  })

  it('are dropped when invalid', () => {
    const layer = recipeLayer(bentSlab, { carve: { v: 1, kind: 'slab', width: 'wide' } as unknown as CarveSpec })
    const object = illustratorDocumentToVectorDocument(doc([layer])).objects[0] as PathObjectV1
    expect(object.carve).toBeUndefined()
  })

  it('absorb a stray layer transform', () => {
    const spec = slabSpec('square')
    const moved = recipeLayer(spec, { transform: { dx: 10, dy: -4, scale: 1.5, rotation: 0 } })
    const object = illustratorDocumentToVectorDocument(doc([moved])).objects[0] as PathObjectV1
    expect(isIdentityMatrix(object.transform)).toBe(true)
    const carve = object.carve as SlabSpec
    expect(carve.center).toEqual({ x: 10, y: -4 })
    expect(carve.width).toBe(570)
  })
})

describe('sanitizeVectorDocument', () => {
  it('keeps valid recipes and drops broken ones', () => {
    const vector = readable(readLegacyLayers(doc([recipeLayer(bentSlab), recipeLayer(slabSpec('circle'), { id: 'layer-2' })])))
    const tampered = structuredClone(vector)
    ;(tampered.objects[1] as PathObject).carve = { ...slabSpec('circle'), width: 10 }
    const clean = sanitizeVectorDocument(tampered)!
    expect((clean.objects[0] as PathObject).carve).toBeDefined()
    expect((clean.objects[1] as PathObject).carve).toBeUndefined()
    expect(clean.objects[1]).toMatchObject({ contours: (vector.objects[1] as PathObject).contours })
    expect(sanitizeVectorDocument(vector)).toBe(vector)
  })
})
