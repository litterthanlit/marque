import { describe, expect, it } from 'vitest'
import type { IllustratorDocument } from '../illustrator/types.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import { getAllModeParamDefaults } from '../../store/modes.ts'
import { composeVectorMark } from './export.ts'
import { illustratorDocumentToVectorDocument } from './legacyImport.ts'
import { readLegacyLayers, upgradeV1 } from './migrate.ts'
import { createSavedVariation, savedDocument, type SavedVariation } from './saved.ts'

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

const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value))
/** As stage 1 saved it: schema version 1. */
const squareV1 = stored(illustratorDocumentToVectorDocument(square))
const squareDocument = stored(readable(readLegacyLayers(square)))

const params: LogoParams = {
  ...DEFAULT_PARAMS,
  seed: 1234,
  modeId: 'modular',
  generatorId: 'modular',
  styleFamily: 'tech',
  fillColor: '#ff3300',
  modeParams: getAllModeParamDefaults(),
}

// The fields every entry was written with before Vector Maker was the only screen.
const fromGenerateScreen = {
  id: 'a',
  name: 'modular #1234',
  savedAt: '2026-09-01T10:00:00.000Z',
  params,
  activeSurface: 'generated',
  effectParams: {
    dissolution: { enabled: true, threshold: 0.5, cellSize: 12, shape: 'square', scatter: 0, sizeVariation: 0.3 },
  },
}

describe('what a saved entry opens', () => {
  it('is its own document, in its ink', () => {
    const entry = stored({ ...fromGenerateScreen, vectorDocument: squareDocument, illustrator: square })
    expect(savedDocument(entry)).toEqual({ document: squareDocument, inkColor: '#ff3300' })
  })

  it('is its version 1 document upgraded, and the entry itself is left as it was', () => {
    const entry = stored({ ...fromGenerateScreen, vectorDocument: squareV1 }) as unknown as SavedVariation
    const before = JSON.stringify(entry)
    const saved = savedDocument(entry)
    expect(saved).toEqual({ document: readable(upgradeV1(squareV1)), inkColor: '#ff3300' })
    expect(saved?.document.schemaVersion).toBe(2)
    expect(composeVectorMark(saved!.document).viewBox).toEqual({ x: -50, y: -50, width: 100, height: 100 })
    expect(JSON.stringify(entry)).toBe(before)
  })

  it('is its generated mark as layers when it holds no document', () => {
    const generated = generate(params).mark.viewBox
    const entries: SavedVariation[] = [
      stored({ ...fromGenerateScreen, vectorDocument: null, illustrator: null }),
      // Entries from before the app had layers hold nothing but the parameters.
      stored({ id: 'b', name: 'modular #1234', savedAt: fromGenerateScreen.savedAt, params }),
    ]
    for (const entry of entries) {
      const saved = savedDocument(entry)
      expect(saved?.inkColor).toBe('#ff3300')
      expect(saved?.document.objects.length).toBeGreaterThan(1)
      const converted = composeVectorMark(saved!.document)!.viewBox
      for (const side of ['x', 'y', 'width', 'height'] as const) {
        expect(converted[side]).toBeCloseTo(generated[side], 1)
      }
    }
  })

  it('is its layer document when it predates the vector format', () => {
    const entry = stored({ ...fromGenerateScreen, activeSurface: 'illustrator', illustrator: square })
    const saved = savedDocument(entry)
    expect(saved?.inkColor).toBe('#ff3300')
    expect(saved?.document.objects.map((object) => object.name)).toEqual(['Square'])
    expect(composeVectorMark(saved!.document)?.viewBox).toEqual({ x: -50, y: -50, width: 100, height: 100 })
  })

  it('is nothing when the entry cannot be read', () => {
    expect(savedDocument(stored({ ...fromGenerateScreen, vectorDocument: { kind: 'something-else' } }) as never)).toBeNull()
    expect(savedDocument(stored({ ...fromGenerateScreen, illustrator: { layers: 'none' } }) as never)).toBeNull()
    expect(savedDocument(stored({ ...fromGenerateScreen, params: { ...params, generatorId: 'retired' } }))).toBeNull()
  })
})

describe('saving', () => {
  it('keeps the document and the ink, and storage gives them back', () => {
    const entry = stored(createSavedVariation(squareDocument, params))
    expect(savedDocument(entry)).toEqual({ document: squareDocument, inkColor: '#ff3300' })
    expect(Date.parse(entry.savedAt)).not.toBeNaN()
    expect(entry.name).not.toBe('')
  })

  it('gives every entry its own id', () => {
    expect(createSavedVariation(squareDocument, params).id).not.toBe(createSavedVariation(squareDocument, params).id)
  })
})
