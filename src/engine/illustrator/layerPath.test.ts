import { describe, expect, it } from 'vitest'
import { pathDataToVectorPaths } from '../vector/pathSerialization.ts'
import { bakedEditablePath, bakedObjectPath, layersBounds } from './layerPath.ts'
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

const square = (x: number, y: number, side: number) => `M${x},${y}L${x + side},${y}L${x + side},${y + side}L${x},${y + side}Z`

describe('the box around several layers', () => {
  it('covers every layer as it is drawn, transform included', () => {
    const layers = [layer('a', square(0, 0, 100)), layer('b', square(0, 0, 100), { dx: 300, dy: 50, scale: 2 })]
    // The second square doubles about its own middle, then moves.
    expect(layersBounds(layers)).toEqual({ x: 0, y: 0, width: 450, height: 200 })
  })

  it('is missing when no layer has a path', () => {
    expect(layersBounds([])).toBeNull()
    expect(layersBounds([layer('empty', '')])).toBeNull()
  })
})

describe('a layer measured without drawing it', () => {
  it('bakes the transform as the drawn layer has it: about the middle of its bounds, then moved', () => {
    const pathData = 'M0,0L120,0C150,0 160,40 120,60L0,60Z'
    const transform = { dx: 30, dy: -12, scale: 1.5, rotation: 30 }
    const drawn = bakedEditablePath(layer('a', pathData, transform))!
    const read = bakedObjectPath(pathDataToVectorPaths(pathData)[0], { ...DEFAULT_ILLUSTRATOR_TRANSFORM, ...transform })
    expect(read.closed).toBe(drawn.closed)
    expect(read.segs).toHaveLength(drawn.segs.length)
    read.segs.forEach((seg, i) => {
      expect(seg.p.x).toBeCloseTo(drawn.segs[i].p.x, 6)
      expect(seg.p.y).toBeCloseTo(drawn.segs[i].p.y, 6)
      expect(Boolean(seg.hOut)).toBe(Boolean(drawn.segs[i].hOut))
      if (seg.hOut) expect(seg.hOut.x).toBeCloseTo(drawn.segs[i].hOut!.x, 6)
    })
  })
})
