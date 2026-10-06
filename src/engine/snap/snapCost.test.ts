import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import { getAllModeParamDefaults } from '../../store/modes.ts'
import { bakedEditableShape } from '../illustrator/layerPath.ts'
import type { IllustratorLayer } from '../illustrator/types.ts'
import type { EditableShape } from '../path/editPath.ts'
import type { Vec } from '../path/bezier.ts'
import { documentFromGeneratorLink } from '../vector/link.ts'
import { vectorDocumentToIllustratorDocument } from '../vector/view.ts'
import type { Guide } from '../vector/types.ts'
import { carveKeyPoints, documentSnapIndex, freeBoxPoints, snapMoving, snapRadiusTangent, type SnapIndex, type SnapOptions } from './snapping.ts'

/** What a frame may spend on snapping one pointer move. */
const MOVE_MS = 4

/**
 * The cost of one pointer move's snap at each place on a grid: the least of
 * a few runs, so a pause of the runtime between them does not count.
 */
function costs(index: SnapIndex, at: (x: number, y: number) => { moving: Vec[]; options: SnapOptions }, step: number): number[] {
  return costsOf((x, y) => {
    const { moving, options } = at(x, y)
    return () => snapMoving(index, moving, options)
  }, step)
}

/** The cost of any snap at each place on a grid, the least of a few runs. */
function costsOf(at: (x: number, y: number) => () => unknown, step: number): number[] {
  const out: number[] = []
  for (let x = -300; x <= 300; x += step) {
    for (let y = -300; y <= 300; y += step) {
      const snap = at(x, y)
      let least = Infinity
      for (let run = 0; run < 3; run++) {
        const started = performance.now()
        snap()
        least = Math.min(least, performance.now() - started)
      }
      out.push(least)
    }
  }
  return out
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
/** All but the slowest hundredth: one pause of the test machine (a collection, a busy core) is not the snap's cost. */
const nearlyAll = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.99)]

describe('the cost of snapping a pointer move', () => {
  const params = {
    ...DEFAULT_PARAMS,
    modeParams: getAllModeParamDefaults(),
    modeId: 'geometric-radial',
    generatorId: 'geometric-radial',
    styleFamily: 'tech',
    gridRings: 8,
    symmetryFolds: 12,
  } as LogoParams
  const doc = vectorDocumentToIllustratorDocument(documentFromGeneratorLink(params))
  const shapes = new Map<IllustratorLayer, EditableShape | null>()
  const freePathOf = (layer: IllustratorLayer) => {
    if (layer.carve) return null
    if (!shapes.has(layer)) shapes.set(layer, bakedEditableShape(layer))
    return shapes.get(layer)!
  }
  const keyPoints = (layer: IllustratorLayer) => (layer.carve ? carveKeyPoints(layer.carve).map((target) => target.p) : freeBoxPoints(freePathOf(layer)!))

  it('stays well inside a frame for one shape moved anywhere over the 360-object mark, and on a dense grid of guides', () => {
    expect(doc.layers).toHaveLength(360)
    const one = doc.layers[5]
    const keys = keyPoints(one)
    const index = documentSnapIndex({ doc, exclude: new Set([one.id]), freePathOf })
    const shape = costs(index, (x, y) => ({ moving: keys.map((k) => ({ x: k.x - keys[0].x + x, y: k.y - keys[0].y + y })), options: { tolerance: 8, primary: 0 } }), 15)
    const point = costs(index, (x, y) => ({ moving: [{ x, y }], options: { tolerance: 8, edges: true } }), 15)
    const circle = costs(index, (x, y) => ({ moving: [{ x, y }], options: { tolerance: 8, circle: { c: { x, y }, r: 60 } } }), 15)

    // Lines every 10 units both ways, a fan of lines every 15°, and twenty rings, over the mark.
    const guides: Guide[] = []
    const guide = (id: string, shape: Guide['shape']): Guide => ({ id, name: id, visible: true, locked: false, style: 'solid', shape })
    for (let i = -20; i <= 20; i++) guides.push(guide(`v${i}`, { kind: 'line', p: { x: i * 10, y: 0 }, angle: 90 }), guide(`h${i}`, { kind: 'line', p: { x: 0, y: i * 10 }, angle: 0 }))
    for (let i = 0; i < 12; i++) guides.push(guide(`f${i}`, { kind: 'line', p: { x: 0, y: 0 }, angle: i * 15 }))
    for (let i = 1; i <= 20; i++) guides.push(guide(`c${i}`, { kind: 'circle', c: { x: 0, y: 0 }, r: i * 10 }))
    const gridded = documentSnapIndex({ doc, exclude: new Set([one.id]), freePathOf, guides })
    const onGrid = costs(gridded, (x, y) => ({ moving: keys.map((k) => ({ x: k.x - keys[0].x + x + 0.3, y: k.y - keys[0].y + y + 0.7 })), options: { tolerance: 12, primary: 0 } }), 15)
    const pointOnGrid = costs(gridded, (x, y) => ({ moving: [{ x: x + 0.3, y: y + 0.7 }], options: { tolerance: 12, edges: true } }), 15)

    for (const each of [shape, point, circle, onGrid, pointOnGrid]) {
      expect(median(each)).toBeLessThan(MOVE_MS / 4)
      expect(nearlyAll(each)).toBeLessThan(MOVE_MS)
    }
  })

  it("stays well inside a frame for the pen's point, its draft's own points snapped to as well", () => {
    const index = documentSnapIndex({ doc, exclude: new Set(), freePathOf })
    // A new array of the draft's points for every move, as the pen asks.
    const pen = costs(index, (x, y) => ({ moving: [{ x, y }], options: { tolerance: 8, edges: true, extra: [{ p: { x: x + 40, y: y - 30 }, kind: 'point' }, { p: { x: 0, y: 0 }, kind: 'point' }] } }), 15)
    expect(median(pen)).toBeLessThan(MOVE_MS / 4)
    expect(nearlyAll(pen)).toBeLessThan(MOVE_MS)
  })

  it('stays inside a frame for a large circle moved, or resized about its centre or a corner, anywhere over the mark', () => {
    const index = documentSnapIndex({ doc, exclude: new Set(), freePathOf })
    for (const r of [100, 200]) {
      const at = (x: number, y: number) => ({ x: x + 0.37, y: y + 0.61 })
      const moved = costs(index, (x, y) => ({ moving: [at(x, y)], options: { tolerance: 8, circle: { c: at(x, y), r } } }), 30)
      const aboutCentre = costsOf((x, y) => () => snapRadiusTangent(index, { c: at(x, y), r }, at(x, y), 8), 30)
      const aboutCorner = costsOf((x, y) => () => snapRadiusTangent(index, { c: at(x, y), r }, { x: at(x, y).x - r, y: at(x, y).y + r }, 8), 30)
      for (const each of [moved, aboutCentre, aboutCorner]) {
        expect(median(each)).toBeLessThan(MOVE_MS / 2)
        expect(nearlyAll(each)).toBeLessThan(MOVE_MS)
      }
    }
  })

  it('stays inside a frame for a third of the mark, or nearly all of it, moved at once: only one point looks for crossings', () => {
    for (const count of [120, 300]) {
      const many = doc.layers.slice(0, count)
      const all = many.flatMap(keyPoints)
      expect(all.length).toBeGreaterThan(1000)
      const index = documentSnapIndex({ doc, exclude: new Set(many.map((layer) => layer.id)), freePathOf })
      const moves = costs(index, (x, y) => ({ moving: all.map((k) => ({ x: k.x + x / 10, y: k.y + y / 10 })), options: { tolerance: 8, primary: 0 } }), 100)
      expect(median(moves)).toBeLessThan(MOVE_MS / 2)
      expect(nearlyAll(moves)).toBeLessThan(MOVE_MS)
    }
  })
})
