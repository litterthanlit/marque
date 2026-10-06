import { describe, expect, it } from 'vitest'
import { slabSpec } from '../carve/spec.ts'
import type { Vec } from '../path/bezier.ts'
import {
  carveKeyPoints,
  documentSnapTargets,
  snapCircleTangent,
  snapMoving,
  snapValue,
  type EdgeHit,
  type SnapIndex,
} from './snapping.ts'

/** Another shape's edge along y = 0. */
const floor = (p: Vec): EdgeHit => ({ point: { x: p.x, y: 0 }, distance: Math.abs(p.y), tangent: { x: 1, y: 0 } })

const tol = 8

describe('snapping priority', () => {
  it('lands on a point within the tolerance, and not beyond it', () => {
    const index: SnapIndex = { targets: [{ p: { x: 100, y: 100 }, kind: 'point' }] }
    const near = snapMoving(index, [{ x: 100 + 7.9, y: 100 }], { tolerance: tol })
    expect(near.label).toBe('point')
    expect(near.d.x).toBeCloseTo(-7.9, 9)
    // 8.1 away on x: no point snap, but still aligned on y.
    const far = snapMoving(index, [{ x: 100 + 8.1, y: 100 }], { tolerance: tol })
    expect(far.label).toBe('aligned')
    expect(far.d).toEqual({ x: 0, y: 0 })
  })

  it('prefers a centre when two targets are equally close', () => {
    const index: SnapIndex = {
      targets: [
        { p: { x: 10, y: 0 }, kind: 'point' },
        { p: { x: 10, y: 0 }, kind: 'centre' },
      ],
    }
    expect(snapMoving(index, [{ x: 12, y: 1 }], { tolerance: tol }).label).toBe('centre')
  })

  it('aligns both axes to different targets before one', () => {
    const index: SnapIndex = {
      targets: [
        { p: { x: 100, y: 0 }, kind: 'point' },
        { p: { x: 0, y: 50 }, kind: 'point' },
      ],
    }
    const both = snapMoving(index, [{ x: 103, y: 54 }], { tolerance: tol })
    expect(both.label).toBe('aligned')
    expect(both.d).toEqual({ x: -3, y: -4 })
    expect(both.hints).toHaveLength(2)
    const one = snapMoving(index, [{ x: 103, y: 200 }], { tolerance: tol })
    expect(one.d).toEqual({ x: -3, y: 0 })
    expect(one.hints).toEqual([{ kind: 'line', a: { x: 100, y: 0 }, b: { x: 100, y: 200 } }])
  })

  it('only snaps along the axes the geometry may move on', () => {
    const index: SnapIndex = { targets: [{ p: { x: 100, y: 100 }, kind: 'point' }] }
    const result = snapMoving(index, [{ x: 103, y: 104 }], { tolerance: tol, axes: { x: true, y: false } })
    expect(result.d).toEqual({ x: -3, y: 0 })
  })

  it('moves a group by the best offset any of its points finds', () => {
    const index: SnapIndex = { targets: [{ p: { x: 0, y: 0 }, kind: 'centre' }] }
    const result = snapMoving(index, [{ x: 50, y: 50 }, { x: 2, y: -3 }], { tolerance: tol })
    expect(result.label).toBe('centre')
    expect(result.d).toEqual({ x: -2, y: 3 })
  })

  it('lands on an edge, and where an alignment line crosses it', () => {
    const far: SnapIndex = { targets: [{ p: { x: 1000, y: 1000 }, kind: 'point' }], nearestEdge: floor }
    const edge = snapMoving(far, [{ x: 400, y: 5 }], { tolerance: tol, edges: true })
    expect(edge.label).toBe('edge')
    expect(edge.d).toEqual({ x: 0, y: -5 })
    expect(snapMoving(far, [{ x: 400, y: 5 }], { tolerance: tol }).label).toBeNull()

    const crossing: SnapIndex = { targets: [{ p: { x: 50, y: 300 }, kind: 'point' }], nearestEdge: floor }
    const combo = snapMoving(crossing, [{ x: 53, y: 4 }], { tolerance: tol, edges: true })
    expect(combo.label).toBe('edge')
    expect(combo.d.x).toBeCloseTo(-3, 9)
    expect(combo.d.y).toBeCloseTo(-4, 9)
  })

  it('follows 15° rays from an origin, but not right next to it', () => {
    const index: SnapIndex = { targets: [] }
    const flat = snapMoving(index, [{ x: 100, y: 4 }], { tolerance: tol, rays: [{ x: 0, y: 0 }] })
    expect(flat.label).toBe('0°')
    expect(flat.d.y).toBeCloseTo(-4, 9)
    const steep = snapMoving(index, [{ x: 70, y: -72 }], { tolerance: tol, rays: [{ x: 0, y: 0 }] })
    expect(steep.label).toBe('45°')
    expect(snapMoving(index, [{ x: 5, y: 1 }], { tolerance: tol, rays: [{ x: 0, y: 0 }] }).label).toBeNull()
  })
})

describe('value snaps', () => {
  it('matches a size already in use within the tolerance', () => {
    expect(snapValue(47.9 + 8 - 0.1, [47.9], tol)).toBe(47.9)
    expect(snapValue(47.9 + 8.1, [47.9], tol)).toBeNull()
    expect(snapValue(60, [52, 58, 66], tol)).toBe(58)
  })

  it('moves or sizes a round punch so its rim just touches an edge', () => {
    const index: SnapIndex = { targets: [], nearestEdge: floor }
    const moved = snapCircleTangent(index, { x: 0, y: 30 }, 27, tol, 'move')
    expect(moved?.center).toEqual({ x: 0, y: 27 })
    const sized = snapCircleTangent(index, { x: 0, y: 30 }, 27, tol, 'radius')
    expect(sized?.radius).toBe(30)
    expect(snapCircleTangent(index, { x: 0, y: 30 }, 10, tol, 'move')).toBeNull()
  })
})

describe('snap targets', () => {
  it('offers a slab’s centre, corners and side middles, turned with it', () => {
    const points = carveKeyPoints({ ...slabSpec('square'), rotation: 90 })
    expect(points[0]).toEqual({ p: { x: 0, y: 0 }, kind: 'centre' })
    expect(points).toHaveLength(9)
    const corner = points[1].p
    expect(Math.abs(corner.x)).toBeCloseTo(190, 9)
    expect(Math.abs(corner.y)).toBeCloseTo(190, 9)
  })

  it('leaves out the layers being edited and always offers the artboard centre', () => {
    const slab = {
      id: 'a',
      name: 'a',
      operation: 'add' as const,
      visible: true,
      locked: false,
      pathData: '',
      fillRule: 'nonzero' as const,
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      carve: slabSpec('square', { x: 50, y: 0 }),
    }
    const doc = {
      id: 'doc',
      source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
      layers: [slab, { ...slab, id: 'b', carve: slabSpec('square', { x: -50, y: 0 }) }],
      selectedLayerIds: [],
      pointSelection: null,
      mode: 'object' as const,
    }
    const targets = documentSnapTargets(doc, new Set(['b']), () => null)
    expect(targets[0]).toEqual({ p: { x: 0, y: 0 }, kind: 'centre' })
    expect(targets.some((t) => t.p.x === 50 && t.p.y === 0 && t.kind === 'centre')).toBe(true)
    expect(targets.some((t) => t.p.x === -50 && t.p.y === 0)).toBe(false)
  })
})
