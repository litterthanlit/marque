import { describe, expect, it } from 'vitest'
import { add, cubicPoint, rotate } from '../path/bezier.ts'
import {
  bendCarve,
  carveHandles,
  dragCarveHandle,
  isSideBent,
  locateCarveGrab,
  MAX_FULLNESS,
  rotateCarveAbout,
  straightenCarve,
  translateCarve,
} from './edit.ts'
import { carveOutline } from './outline.ts'
import { slabSpec, type GrooveSpec, type PunchSpec, type SlabSpec } from './spec.ts'

const rotated: SlabSpec = { ...slabSpec('rounded'), center: { x: 30, y: -10 }, rotation: 30 }

/** World position of a point given in the slab's own unrotated frame. */
const world = (spec: SlabSpec, local: { x: number; y: number }) => add(spec.center, rotate(local, spec.rotation))

describe('slab resize handles', () => {
  it('east handle keeps the west edge fixed, even rotated', () => {
    const start = world(rotated, { x: 202, y: 0 })
    const pointer = world(rotated, { x: 262, y: 0 })
    const next = dragCarveHandle(rotated, 'e', start, pointer) as SlabSpec
    expect(next.width).toBeCloseTo(440, 6)
    const westBefore = world(rotated, { x: -190, y: 0 })
    const westAfter = world(next, { x: -next.width / 2, y: 0 })
    expect(westAfter.x).toBeCloseTo(westBefore.x, 6)
    expect(westAfter.y).toBeCloseTo(westBefore.y, 6)
  })

  it('Alt resizes symmetrically about the centre', () => {
    const next = dragCarveHandle(rotated, 'e', world(rotated, { x: 202, y: 0 }), world(rotated, { x: 262, y: 0 }), {
      shift: false,
      alt: true,
    }) as SlabSpec
    expect(next.width).toBeCloseTo(500, 6)
    expect(next.center.x).toBeCloseTo(rotated.center.x, 6)
    expect(next.center.y).toBeCloseTo(rotated.center.y, 6)
  })

  it('Shift on a corner scales the whole recipe, bends included', () => {
    const bent: SlabSpec = { ...rotated, sides: { top: { a1: 0, o1: 20, a2: 0, o2: 20 } } }
    const corner = world(bent, { x: 190, y: 190 })
    const pulled = world(bent, { x: 190 + 76, y: 190 + 76 })
    const next = dragCarveHandle(bent, 'se', corner, pulled, { shift: true, alt: false }) as SlabSpec
    expect(next.width).toBeCloseTo(456, 6)
    expect(next.height).toBeCloseTo(456, 6)
    expect(next.radius).toBeCloseTo(108, 6)
    expect(next.sides?.top?.o1).toBeCloseTo(24, 6)
    // The opposite corner stays put.
    const nwBefore = world(bent, { x: -190, y: -190 })
    const nwAfter = world(next, { x: -next.width / 2, y: -next.height / 2 })
    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 6)
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 6)
  })

  it('never flips or shrinks below the minimum size', () => {
    const next = dragCarveHandle(rotated, 'e', world(rotated, { x: 202, y: 0 }), world(rotated, { x: -900, y: 0 })) as SlabSpec
    expect(next.width).toBeCloseTo(4, 6)
  })

  it('clamps the corner radius to half the shorter side', () => {
    const next = dragCarveHandle(rotated, 'radius', world(rotated, { x: -100, y: -100 }), world(rotated, { x: 500, y: 500 })) as SlabSpec
    expect(next.radius).toBeCloseTo(190, 6)
  })

  it('rotates in 15° steps with Shift', () => {
    const start = add(rotated.center, { x: 0, y: -250 })
    const pointer = add(rotated.center, rotate({ x: 0, y: -250 }, 37))
    const next = dragCarveHandle(rotated, 'rotate', start, pointer, { shift: true, alt: false }) as SlabSpec
    expect(next.rotation % 15).toBeCloseTo(0, 6)
    expect(next.rotation).toBe(60)
  })
})

describe('punch and groove handles', () => {
  it('a punch corner scales its radius about the centre', () => {
    const punch: PunchSpec = { v: 1, kind: 'punch', shape: 'triangle', center: { x: 10, y: 10 }, radius: 40, rotation: 0 }
    const next = dragCarveHandle(punch, 'se', { x: 60, y: 10 }, { x: 110, y: 10 }) as PunchSpec
    expect(next.radius).toBeCloseTo(80, 6)
    expect(next.center).toEqual(punch.center)
  })

  const groove: GrooveSpec = { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 100, y: 0 }, width: 40 }

  it('Shift snaps an end point to 15° from the other end', () => {
    const next = dragCarveHandle(groove, 'to', { x: 100, y: 0 }, { x: 100, y: 37 }, { shift: true, alt: false }) as GrooveSpec
    const angle = (Math.atan2(next.to.y - next.from.y, next.to.x - next.from.x) * 180) / Math.PI
    expect(Math.abs(angle / 15 - Math.round(angle / 15))).toBeLessThan(1e-6)
  })

  it('Alt mirrors the other end about the middle', () => {
    const next = dragCarveHandle(groove, 'to', { x: 100, y: 0 }, { x: 120, y: 30 }, { shift: false, alt: true }) as GrooveSpec
    expect(next.from).toEqual({ x: -120, y: -30 })
  })

  it('width never drops below 2', () => {
    const next = dragCarveHandle(groove, 'width', { x: 0, y: -32 }, { x: 0, y: 400 }) as GrooveSpec
    expect(next.width).toBe(2)
  })
})

describe('bending and straightening', () => {
  it('a corner bend changes its fullness and hits the cursor', () => {
    const spec = slabSpec('rounded')
    const corner = { x: 100 + 90 * Math.SQRT1_2, y: -100 - 90 * Math.SQRT1_2 }
    const grab = locateCarveGrab(spec, corner)!
    expect(grab.side).toEqual({ type: 'corner', id: 'tr' })
    const cursor = { x: corner.x + 12, y: corner.y - 12 }
    const next = bendCarve(spec, grab, cursor) as SlabSpec
    expect(next.corners?.tr?.k1).toBeGreaterThan(1)
    expect(isSideBent(next, grab.side)).toBe(true)
    expect(isSideBent(straightenCarve(next, grab.side), grab.side)).toBe(false)
  })

  it('a corner never pokes out past its square corner, however far it is pulled', () => {
    const spec = slabSpec('rounded')
    const corner = { x: 100 + 90 * Math.SQRT1_2, y: -100 - 90 * Math.SQRT1_2 }
    const grab = locateCarveGrab(spec, corner)!
    const next = bendCarve(spec, grab, { x: corner.x + 200, y: corner.y - 200 }) as SlabSpec
    expect(next.corners?.tr?.k1).toBeCloseTo(MAX_FULLNESS, 6)
    for (const c of carveOutline(next).curves) {
      for (let i = 0; i <= 20; i++) {
        const p = cubicPoint(c, i / 20)
        expect(p.x).toBeLessThanOrEqual(190 + 1e-6)
        expect(p.y).toBeGreaterThanOrEqual(-190 - 1e-6)
      }
    }
  })

  it('a tiny bend snaps back to straight', () => {
    const spec = slabSpec('square')
    const grab = locateCarveGrab(spec, { x: 0, y: -190 })!
    const next = bendCarve(spec, grab, { x: 0, y: -191 }) as SlabSpec
    expect(next.sides).toBeUndefined()
  })

  it('bending a channel bends its spine and keeps its width', () => {
    const spec: GrooveSpec = { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 100, y: 0 }, width: 40 }
    const grab = locateCarveGrab(spec, { x: 0, y: -20 })!
    expect(grab.side.type).toBe('rail')
    const next = bendCarve(spec, grab, { x: 0, y: -60 }) as GrooveSpec
    expect(next.bend).toBeDefined()
    expect(next.width).toBe(40)
  })
})

describe('moving recipes', () => {
  it('translates and rotates about a pivot', () => {
    const moved = translateCarve(rotated, { x: 5, y: 6 }) as SlabSpec
    expect(moved.center).toEqual({ x: 35, y: -4 })
    const turned = rotateCarveAbout(rotated, { x: 0, y: 0 }, 90) as SlabSpec
    expect(turned.center.x).toBeCloseTo(10, 6)
    expect(turned.center.y).toBeCloseTo(30, 6)
    expect(turned.rotation).toBe(120)
  })

  it('handles sit outside the outline so edges stay free for bending', () => {
    const handles = carveHandles(slabSpec('square'))
    const east = handles.find((h) => h.id === 'e')!
    expect(east.at.x).toBeCloseTo(202, 6)
    const ids = handles.map((h) => h.id)
    expect(ids).toEqual(expect.arrayContaining(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'radius', 'rotate']))
  })
})
