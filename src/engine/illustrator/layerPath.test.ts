import { describe, expect, it } from 'vitest'
import { layersBounds, scaleLayers } from './layerPath.ts'
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

/** The layers as `scaleLayers` leaves them: the new paths, with nothing left for a transform to do. */
function scaled(layers: IllustratorLayer[], factor: number): IllustratorLayer[] {
  const edits = scaleLayers(layers, factor)
  return layers.map((original) => {
    const edit = edits.find((candidate) => candidate.layerId === original.id)!
    return layer(original.id, edit.pathData)
  })
}

const centre = (layers: IllustratorLayer[]) => {
  const box = layersBounds(layers)!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

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

describe('scaling layers together', () => {
  const layers = [
    layer('a', square(-200, -100, 100)),
    layer('b', square(100, 20, 60), { rotation: 30, scale: 1.5, dx: 12, dy: -8 }),
    layer('c', 'M0,-40C22,-40 40,-22 40,0C40,22 22,40 0,40C-22,40 -40,22 -40,0C-40,-22 -22,-40 0,-40Z'),
  ]

  it.each([0.5, 2, 1.37])('by %f keeps the middle of their box still and scales the box', (factor) => {
    const before = layersBounds(layers)!
    const after = layersBounds(scaled(layers, factor))!
    expect(after.width).toBeCloseTo(before.width * factor, 3)
    expect(after.height).toBeCloseTo(before.height * factor, 3)
    expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 3)
    expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 3)
  })

  it('keeps the arrangement: every layer grows by the factor and moves away from the middle by it', () => {
    const factor = 1.6
    const pivot = centre(layers)
    const after = scaled(layers, factor)
    for (const [index, original] of layers.entries()) {
      const was = layersBounds([original])!
      const now = layersBounds([after[index]])!
      expect(now.width).toBeCloseTo(was.width * factor, 3)
      expect(now.height).toBeCloseTo(was.height * factor, 3)
      expect(centre([after[index]]).x - pivot.x).toBeCloseTo((centre([original]).x - pivot.x) * factor, 3)
      expect(centre([after[index]]).y - pivot.y).toBeCloseTo((centre([original]).y - pivot.y) * factor, 3)
    }
  })

  it('down and back up lands where it started', () => {
    const there = scaled(layers, 0.25)
    const back = layersBounds(scaled(there, 4))!
    const start = layersBounds(layers)!
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(back[key]).toBeCloseTo(start[key], 2)
  })
})
