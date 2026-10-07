import { describe, expect, it } from 'vitest'
import type { EditableShape } from '../path/editPath.ts'
import { bakeLegacyTransform } from '../vector/migrate.ts'
import { pathDataToContours } from '../vector/pathSerialization.ts'
import { bakedEditablePath, bakedEditableShape, editableShapeOf } from './layerPath.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM, type IllustratorLayer, type IllustratorTransform } from './types.ts'

function layer(id: string, pathData: string, transform: Partial<IllustratorTransform> = {}): IllustratorLayer {
  return {
    id,
    name: id,
    operation: 'add',
    visible: true,
    locked: false,
    pathData,
    fillRule: 'evenodd',
    transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM, ...transform },
  }
}

function expectSameShape(read: EditableShape, drawn: EditableShape) {
  expect(read).toHaveLength(drawn.length)
  read.forEach((path, c) => {
    expect(path.closed).toBe(drawn[c].closed)
    expect(path.segs).toHaveLength(drawn[c].segs.length)
    path.segs.forEach((seg, i) => {
      expect(seg.p.x).toBeCloseTo(drawn[c].segs[i].p.x, 6)
      expect(seg.p.y).toBeCloseTo(drawn[c].segs[i].p.y, 6)
      expect(Boolean(seg.hOut)).toBe(Boolean(drawn[c].segs[i].hOut))
      if (seg.hOut) expect(seg.hOut.x).toBeCloseTo(drawn[c].segs[i].hOut!.x, 6)
    })
  })
}

describe('a layer measured without drawing it', () => {
  it('bakes the transform as the drawn layer has it: about the middle of its bounds, then moved', () => {
    const pathData = 'M0,0L120,0C150,0 160,40 120,60L0,60Z'
    const transform = { dx: 30, dy: -12, scale: 1.5, rotation: 30 }
    const drawn = bakedEditableShape(layer('a', pathData, transform))!
    const read = editableShapeOf(bakeLegacyTransform(pathDataToContours(pathData), { ...DEFAULT_ILLUSTRATOR_TRANSFORM, ...transform }))
    expectSameShape(read, drawn)
  })

  it('reads every contour of a layer in the order its object holds them', () => {
    const pathData = 'M-100,-100L100,-100L100,100L-100,100Z M-40,-40L-40,40L40,40L40,-40Z'
    const shape = bakedEditableShape(layer('ring', pathData))!
    expectSameShape(shape, editableShapeOf(pathDataToContours(pathData)))
    expect(shape[1].segs[0].p).toEqual({ x: -40, y: -40 })
    // A single path is only for a layer of one contour.
    expect(bakedEditablePath(layer('ring', pathData))).toBeNull()
    expect(bakedEditablePath(layer('square', 'M0,0L10,0L10,10Z'))?.segs).toHaveLength(3)
  })
})
