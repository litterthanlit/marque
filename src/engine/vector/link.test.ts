import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import type { IllustratorDocument } from '../illustrator/types.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { DEFAULT_PARAMS } from '../types.ts'
import { createEmptyVectorDocument } from './document.ts'
import { composeVectorMark } from './export.ts'
import { illustratorDocumentToVectorDocument } from './legacyImport.ts'
import { decodeLink, documentFromGeneratorLink, encodeLink } from './link.ts'
import { readVectorDocument, upgradeV1 } from './migrate.ts'

/** A document the test expects to read. */
function readable<T>(value: T | null): T {
  if (value === null) throw new Error('could not be read')
  return value
}

const square: IllustratorDocument = {
  id: 'doc',
  source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
  layers: [
    {
      id: 'square',
      name: 'Square',
      operation: 'add',
      visible: true,
      locked: false,
      pathData: 'M-50,-50L50,-50L50,50L-50,50Z',
      fillRule: 'evenodd',
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    },
  ],
  selectedLayerIds: [],
  pointSelection: null,
  mode: 'object',
}

// As a link carries it: JSON has no undefined and no negative zero.
const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value))
/** As stage 1 wrote it: schema version 1. */
const squareV1 = stored(illustratorDocumentToVectorDocument(square))
const squareDocument = stored(readable(upgradeV1(squareV1)))
const packed = (value: unknown) => compressToEncodedURIComponent(JSON.stringify(value))

describe('opening a link', () => {
  it('opens the empty document when there is no hash', () => {
    expect(decodeLink('')).toEqual({ kind: 'blank' })
    expect(decodeLink('#')).toEqual({ kind: 'blank' })
  })

  it('opens the empty document for the hash every untouched old tab has', () => {
    expect(decodeLink('#v=1.0')).toEqual({ kind: 'blank' })
  })

  it('ignores effect parameters', () => {
    expect(decodeLink('#v=1.0&e.dissolve=1&e.threshold=0.4')).toEqual({ kind: 'blank' })
    expect(decodeLink('#seed=7&v=1.0&e.dissolve=1')).toEqual(decodeLink('#seed=7&v=1.0'))
  })

  it('reads a generator link into the full parameters of its mark', () => {
    const link = decodeLink(
      '#mode=wave-arc&style=playful&seed=7&rotation=400&fillColor=%23ff3300&v=1.0' +
        '&m.arcSymmetry=radial&m.spreadAngle=150&m.symmetryFolds=99',
    )
    if (link.kind !== 'generator') throw new Error(`decoded as ${link.kind}`)
    expect(link.params).toMatchObject({
      modeId: 'wave-arc',
      generatorId: 'wave-arc',
      styleFamily: 'playful',
      seed: 7,
      rotation: 360,
      fillColor: '#ff3300',
      gridRings: DEFAULT_PARAMS.gridRings,
    })
    expect(link.params.modeParams['wave-arc']).toMatchObject({
      arcSymmetry: 'radial',
      spreadAngle: 150,
      symmetryFolds: 12,
      arcCount: 5,
    })
  })

  it('turns a generator link into layers that compose to its mark', () => {
    const link = decodeLink(
      '#mode=modular&style=tech&seed=1234&additiveRatio=0.82&baseRadius=0.34&radiusVariation=0.08' +
        '&fillColor=%230f172a&animationSpeed=0.9&v=1.0&m.columns=6&m.rows=6',
    )
    if (link.kind !== 'generator') throw new Error(`decoded as ${link.kind}`)
    const document = documentFromGeneratorLink(link.params)
    expect(document.objects.length).toBeGreaterThan(1)
    const converted = composeVectorMark(document)!.viewBox
    const generated = generate(link.params).mark.viewBox
    for (const side of ['x', 'y', 'width', 'height'] as const) {
      expect(converted[side]).toBeCloseTo(generated[side], 1)
    }
  })

  it('refuses a generator link made by another generator version', () => {
    expect(decodeLink('#seed=7&v=0.9').kind).toBe('invalid')
  })

  it('opens a document link whatever generator version it names', () => {
    const link = decodeLink(`#seed=7&fillColor=%23ff3300&v=0.9&surface=generated&vd=${packed(squareDocument)}`)
    expect(link).toEqual({ kind: 'vector', document: squareDocument, inkColor: '#ff3300' })
  })

  it('opens a version 1 document link, upgraded, without its selection', () => {
    const link = decodeLink(`#fillColor=%23ff3300&vd=${packed(squareV1)}`)
    expect(link).toEqual({ kind: 'vector', document: readVectorDocument(squareV1), inkColor: '#ff3300' })
    if (link.kind !== 'vector') return
    expect(link.document).toMatchObject({ schemaVersion: 2, guides: [], fillets: [] })
    expect(link.document).not.toHaveProperty('selection')
    expect(link.document.objects).toEqual([
      expect.objectContaining({ id: 'square', operation: 'add', contours: [expect.objectContaining({ closed: true })] }),
    ])
  })

  it('opens a layer document from before the vector format', () => {
    expect(decodeLink(`#v=1.0&surface=illustrator&i=${packed(square)}`)).toEqual({
      kind: 'legacy-layers',
      document: square,
      inkColor: DEFAULT_PARAMS.fillColor,
    })
  })

  it('says so when a document cannot be read', () => {
    expect(decodeLink('#v=1.0&vd=not-a-document').kind).toBe('invalid')
    expect(decodeLink(`#vd=${packed({ kind: 'something-else' })}`).kind).toBe('invalid')
  })
})

describe('writing a link', () => {
  it('writes nothing for an empty document', () => {
    expect(encodeLink(createEmptyVectorDocument(), '#ff3300')).toBe('')
  })

  it('writes a document with only guides, and reads its guides back', () => {
    const guide = { id: 'g', name: 'Line', visible: true, locked: false, style: 'dashed' as const, shape: { kind: 'line' as const, p: { x: 0, y: 40 }, angle: 60 } }
    const document = { ...createEmptyVectorDocument(), guides: [guide] }
    const decoded = decodeLink(encodeLink(document, '#ff3300'))
    expect(decoded.kind).toBe('vector')
    if (decoded.kind === 'vector') expect(decoded.document.guides).toEqual([guide])
  })

  it('writes the ink colour and the document, and reads them back', () => {
    const hash = encodeLink(squareDocument, '#ff3300')
    expect([...new URLSearchParams(hash.slice(1)).keys()]).toEqual(['fillColor', 'vd'])
    expect(decodeLink(hash)).toEqual({ kind: 'vector', document: squareDocument, inkColor: '#ff3300' })
  })
})
