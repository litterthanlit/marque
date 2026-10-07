import { describe, expect, it } from 'vitest'
import type { IllustratorDocument, IllustratorGroup, IllustratorLayer } from '../../engine/illustrator/types.ts'
import { bandEnds, layerNumber, nearNumber } from './layerNumber.ts'

function layer(id: string, parentId?: string): IllustratorLayer {
  return {
    id,
    name: id,
    operation: 'add',
    visible: true,
    locked: false,
    pathData: 'M0,0L10,0L10,10Z',
    fillRule: 'nonzero',
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    ...(parentId ? { parentId } : {}),
  }
}

function group(id: string, parentId?: string): IllustratorGroup {
  return { id, name: id, visible: true, locked: false, isolated: false, operation: 'add', ...(parentId ? { parentId } : {}) }
}

// 01 a; 02 g holding 02.1 b, 02.2 c, 02.3 h holding 02.3.1 d; 03 e.
const doc: Pick<IllustratorDocument, 'layers' | 'groups' | 'guides'> = {
  layers: [layer('a'), layer('b', 'g'), layer('c', 'g'), layer('d', 'h'), layer('e')],
  groups: [group('g'), group('h', 'g')],
  guides: [],
}

describe('a number as a row inside a group writes it', () => {
  it('writes a layer or group in the same group by its place there alone', () => {
    expect(layerNumber(doc, 'c')).toBe('02.2')
    expect(nearNumber(doc, 'b', 'c')).toBe('.1')
    expect(nearNumber(doc, 'h', 'b')).toBe('.3')
  })

  it('writes anything else whole: at the root, in another group, or deeper in the same one', () => {
    expect(nearNumber(doc, 'a', 'e')).toBe('01')
    expect(nearNumber(doc, 'a', 'b')).toBe('01')
    expect(nearNumber(doc, 'b', 'd')).toBe('02.1')
    expect(nearNumber(doc, 'd', 'b')).toBe('02.3.1')
    expect(nearNumber(doc, 'gone', 'b')).toBeNull()
  })

  it("writes a band's circles short only on its row, and whole wherever it is named", () => {
    const link = { a: 'b', b: 'c' }
    expect(bandEnds(doc, link)).toEqual(['02.1', '02.2'])
    expect(bandEnds(doc, link, true)).toEqual(['02.1', '02.2'])
    expect(bandEnds(doc, link, true, 'h')).toEqual(['.1', '.2'])
    expect(bandEnds(doc, link, true, 'a')).toEqual(['02.1', '02.2'])
  })
})
