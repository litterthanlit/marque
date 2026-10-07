import { describe, expect, it } from 'vitest'
import { slabSpec } from '../carve/spec.ts'
import type { Vec } from '../path/bezier.ts'
import type { Primitive } from '../geometry/primitives.ts'
import type { IllustratorDocument } from '../illustrator/types.ts'
import {
  carveKeyPoints,
  documentSizes,
  documentSnapTargets,
  primitiveIndex,
  snapMoving,
  snapRadiusTangent,
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

  it('snaps to extra targets, read one by one, as it would were they among the index’s own', () => {
    const own = [
      { p: { x: 100, y: 0 }, kind: 'point' as const },
      { p: { x: 0, y: 50 }, kind: 'point' as const },
      { p: { x: -40, y: -40 }, kind: 'centre' as const, owner: 'a' },
    ]
    const extra = [
      { p: { x: 30, y: 30 }, kind: 'point' as const },
      { p: { x: 100, y: 3 }, kind: 'point' as const },
    ]
    for (const p of [
      { x: 33, y: 28 },
      { x: 104, y: 2 },
      { x: 97, y: 52 },
      { x: 31, y: -44 },
      { x: -200, y: 200 },
    ]) {
      const merged = snapMoving({ targets: [...own, ...extra] }, [p], { tolerance: tol })
      expect(snapMoving({ targets: own }, [p], { tolerance: tol, extra })).toEqual(merged)
    }
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

  it("prefers a shape's centre to the artboard's or a guide's on the same spot, so a pin can hold to it", () => {
    const index: SnapIndex = {
      targets: [
        { p: { x: 0, y: 0 }, kind: 'centre' },
        { p: { x: 0, y: 0 }, kind: 'centre', owner: 'g', guide: true },
        { p: { x: 0, y: 0 }, kind: 'centre', owner: 'slab' },
      ],
    }
    expect(snapMoving(index, [{ x: 2, y: 1 }], { tolerance: tol }).hit).toEqual({ kind: 'centre', owner: 'slab', guide: false, moving: 0 })
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

describe('snapping to pieces', () => {
  const across: Primitive = { kind: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 }, owner: 'across', guide: true }
  const upright: Primitive = { kind: 'line', p: { x: 200, y: 0 }, d: { x: 0, y: 1 }, owner: 'upright', guide: true }
  const disc: Primitive = { kind: 'circle', c: { x: -200, y: 0 }, r: 60, owner: 'disc' }

  it('lands where two guides cross, found only near the pointer', () => {
    const index = primitiveIndex([], [across, upright])
    const result = snapMoving(index, [{ x: 205, y: 4 }], { tolerance: tol })
    expect(result.label).toBe('intersection')
    expect(result.d).toEqual({ x: -5, y: -4 })
    expect(snapMoving(index, [{ x: 220, y: 4 }], { tolerance: tol }).label).toBeNull()
  })

  it('lands on a guide as "on guide", and on a shape\'s edge as "edge", naming whose it is', () => {
    const index = primitiveIndex([], [across, disc])
    const guide = snapMoving(index, [{ x: 50, y: 5 }], { tolerance: tol, edges: true })
    expect(guide.label).toBe('on guide')
    expect(guide.hit).toMatchObject({ kind: 'edge', owner: 'across', guide: true })
    const rim = snapMoving(index, [{ x: -200, y: -64 }], { tolerance: tol, edges: true })
    expect(rim.label).toBe('edge')
    expect(rim.hit?.owner).toBe('disc')
    expect(rim.d.y).toBeCloseTo(4, 9)
  })

  it('puts a moved circle\'s touch above alignment, and a point above both', () => {
    // A circle of radius 30 just above the guide, its centre also within reach of a target's x.
    const aligned = { p: { x: 52, y: -400 }, kind: 'point' as const, owner: 'far' }
    const index = primitiveIndex([aligned], [across])
    const circle = { c: { x: 50, y: -27 }, r: 30 }
    const touch = snapMoving(index, [circle.c], { tolerance: tol, circle })
    expect(touch.label).toBe('tangent')
    expect(touch.d).toEqual({ x: 0, y: -3 })
    expect(touch.hints).toMatchObject([{ kind: 'tangent', p: { x: 50, y: 0 } }])
    const [hint] = touch.hints
    // Drawn along the guide it touches.
    expect(hint.kind === 'tangent' && Math.abs(hint.dir.x)).toBeCloseTo(1, 12)
    const withPoint = primitiveIndex([aligned, { p: { x: 53, y: -25 }, kind: 'centre', owner: 'other' }], [across])
    const point = snapMoving(withPoint, [circle.c], { tolerance: tol, circle })
    expect(point.label).toBe('centre')
    expect(point.hit).toEqual({ kind: 'centre', owner: 'other', guide: false, moving: 0 })
    // Locked to one axis, a circle does not slide off it to touch.
    expect(snapMoving(index, [circle.c], { tolerance: tol, circle, axes: { x: true, y: false } }).label).toBe('aligned')
  })

  it('puts a moved line\'s touch above alignment, as a circle\'s', () => {
    // A level line through the grab point, 4 below a circle's rim; the grab point also lines up on x with a far point.
    const index = primitiveIndex([{ p: { x: 2, y: -500 }, kind: 'point', owner: 'far' }], [{ kind: 'circle', c: { x: 0, y: 0 }, r: 100, owner: 'disc' }])
    const grab = { x: 0, y: 104 }
    const touch = snapMoving(index, [grab], { tolerance: tol, line: { p: grab, angle: 0 } })
    expect(touch.label).toBe('tangent')
    expect(touch.d.x).toBeCloseTo(0, 9)
    expect(touch.d.y).toBeCloseTo(-4, 9)
    expect(touch.hit).toMatchObject({ kind: 'tangent', owner: 'disc' })
  })

  it('slides a circle along the one axis Shift keeps until it touches a line across it', () => {
    // It sits on the bottom line y = 190 and slides right towards the line x = 200.
    const bottom: Primitive = { kind: 'line', p: { x: 0, y: 190 }, d: { x: 1, y: 0 }, owner: 'bottom', guide: true }
    const right: Primitive = { kind: 'line', p: { x: 200, y: 0 }, d: { x: 0, y: 1 }, owner: 'right', guide: true }
    const index = primitiveIndex([], [bottom, right])
    const circle = { c: { x: 131, y: 125 }, r: 65 }
    const slid = snapMoving(index, [circle.c], { tolerance: tol, circle, axes: { x: true, y: false } })
    expect(slid.label).toBe('tangent')
    expect(slid.d.x).toBeCloseTo(4, 9)
    expect(slid.d.y).toBe(0)
    expect(slid.hit?.owner).toBe('right')
    // A line moved along one axis likewise keeps to it.
    const disc: Primitive = { kind: 'circle', c: { x: 0, y: 0 }, r: 100, owner: 'disc' }
    const line = snapMoving(primitiveIndex([], [disc]), [{ x: 0, y: 147 }], { tolerance: tol, axes: { x: false, y: true }, line: { p: { x: 0, y: 147 }, angle: 45 } })
    expect(line.label).toBe('tangent')
    expect(line.d.x).toBe(0)
    expect((147 + line.d.y) / Math.SQRT2).toBeCloseTo(100, 9)
  })

  it('sizes a circle about its centre, or about a corner, until it touches', () => {
    const index = primitiveIndex([], [across])
    const about = snapRadiusTangent(index, { c: { x: 0, y: -50 }, r: 45 }, { x: 0, y: -50 }, tol)
    expect(about?.radius).toBeCloseTo(50, 9)
    expect(about?.snap.label).toBe('tangent')
    const fromCorner = snapRadiusTangent(index, { c: { x: 22, y: -78 }, r: 72 }, { x: -50, y: -150 }, tol)
    expect(fromCorner?.radius).toBeCloseTo(75, 9)
    expect(fromCorner!.center.y).toBeCloseTo(-75, 9)
  })
})

describe('value snaps', () => {
  it('matches a size already in use within the tolerance', () => {
    expect(snapValue(47.9 + 8 - 0.1, [47.9], tol)).toBe(47.9)
    expect(snapValue(47.9 + 8.1, [47.9], tol)).toBeNull()
    expect(snapValue(60, [52, 58, 66], tol)).toBe(58)
  })

  it('moves or sizes a round punch so its rim just touches an edge', () => {
    const index = primitiveIndex([], [{ kind: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 }, owner: 'floor' }])
    const moved = snapMoving(index, [{ x: 0, y: 30 }], { tolerance: tol, circle: { c: { x: 0, y: 30 }, r: 27 } })
    expect(moved.d).toEqual({ x: 0, y: -3 })
    const sized = snapRadiusTangent(index, { c: { x: 0, y: 30 }, r: 27 }, { x: 0, y: 30 }, tol)
    expect(sized?.radius).toBeCloseTo(30, 9)
    expect(snapMoving(index, [{ x: 0, y: 30 }], { tolerance: tol, circle: { c: { x: 0, y: 30 }, r: 10 } }).label).toBeNull()
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

  it('offers a circle\'s quadrants when it is turned, and names the owner of each point', () => {
    const points = carveKeyPoints({ ...slabSpec('circle'), rotation: 30 }, 'c')
    expect(points.every((point) => point.owner === 'c')).toBe(true)
    expect(points.some((point) => Math.abs(point.p.x) < 1e-9 && Math.abs(point.p.y + 200) < 1e-9)).toBe(true)
  })

  it('knows the sizes of every circle, guides included, and of slabs', () => {
    const layer = (id: string, carve: ReturnType<typeof slabSpec>) => ({
      id,
      name: id,
      operation: 'add' as const,
      visible: true,
      locked: false,
      pathData: '',
      fillRule: 'nonzero' as const,
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      carve,
    })
    const doc: IllustratorDocument = {
      id: 'doc',
      source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
      layers: [layer('a', slabSpec('circle', { x: 0, y: 0 }, 0.5)), layer('b', slabSpec('tall'))],
      selectedLayerIds: [],
      pointSelection: null,
      mode: 'object',
      guides: [{ id: 'g', name: 'g', visible: true, locked: false, style: 'solid', shape: { kind: 'circle', c: { x: 0, y: 0 }, r: 65 } }],
    }
    const sizes = documentSizes(doc, new Set())
    expect(sizes.circleRadii).toEqual([100, 65])
    expect(sizes.slabSides).toEqual([200, 200, 250, 430])
    expect(documentSizes(doc, new Set(['a', 'g'])).circleRadii).toEqual([])
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
