import { describe, expect, it } from 'vitest'
import { add, cubicPoint, rotate, rotateAbout, scale, sub, type Vec } from '../path/bezier.ts'
import { affineOf, applyAffine } from '../box/box.ts'
import {
  bendCarve,
  carveHandles,
  carveUnderAffine,
  dragCarveHandle,
  isSideBent,
  locateCarveGrab,
  MAX_FULLNESS,
  rotateCarveAbout,
  scaleCarveAbout,
  straightenCarve,
  translateCarve,
  wholeCarveDrag,
} from './edit.ts'
import { carveOutline, grooveSpine } from './outline.ts'
import { isGroove, roundCarveSpec, slabSpec, type CarveSpec, type GrooveSpec, type PunchSpec, type SlabSpec } from './spec.ts'
import { isObjectCarveValid, segsToContour } from './sync.ts'

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

  it('the rounding dot follows the pointer and keeps clear of a circle’s middle', () => {
    const square = slabSpec('square')
    const dot = carveHandles(square).find((h) => h.id === 'radius')!
    const next = dragCarveHandle(square, 'radius', dot.at, add(dot.at, { x: 10, y: 10 })) as SlabSpec
    const moved = carveHandles(next).find((h) => h.id === 'radius')!
    expect(moved.at.x).toBeCloseTo(dot.at.x + 10, 6)
    expect(moved.at.y).toBeCloseTo(dot.at.y + 10, 6)
    const circleDot = carveHandles(slabSpec('circle')).find((h) => h.id === 'radius')!
    expect(Math.hypot(circleDot.at.x, circleDot.at.y)).toBeGreaterThan(100)
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

  it('Alt with Shift turns it about its middle in 15° steps, as it lands', () => {
    // From the other end this would read 30°; about the middle, which stays, it is 45°.
    const next = dragCarveHandle(groove, 'to', { x: 100, y: 0 }, { x: 54, y: 50 }, { shift: true, alt: true }) as GrooveSpec
    const angle = (Math.atan2(next.to.y - next.from.y, next.to.x - next.from.x) * 180) / Math.PI
    expect(angle).toBeCloseTo(45, 9)
    expect(add(next.from, next.to)).toEqual({ x: 0, y: 0 })
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

describe('handle drags at whole numbers', () => {
  it('turn the knob to whole degrees', () => {
    const next = dragCarveHandle(rotated, 'rotate', world(rotated, { x: 0, y: -200 }), world(rotated, { x: 37.3, y: -200 }))
    const whole = wholeCarveDrag(rotated, next, 'rotate') as SlabSpec
    expect(whole.rotation).toBe(Math.round((next as SlabSpec).rotation))
    expect(whole.center).toEqual(rotated.center)
  })

  it('size a slab in whole units, keeping the opposite side or corner where it was', () => {
    const corner = (spec: SlabSpec, fx: number, fy: number) => world(spec, { x: (fx * spec.width) / 2, y: (fy * spec.height) / 2 })
    const raw = dragCarveHandle(rotated, 'e', world(rotated, { x: rotated.width / 2, y: 0 }), world(rotated, { x: rotated.width / 2 + 23.4, y: 7 })) as SlabSpec
    const east = wholeCarveDrag(rotated, raw, 'e') as SlabSpec
    expect(east.width).toBe(Math.round(raw.width))
    expect(east.height).toBe(rotated.height)
    for (const fy of [-1, 1]) {
      expect(corner(east, -1, fy).x).toBeCloseTo(corner(rotated, -1, fy).x, 6)
      expect(corner(east, -1, fy).y).toBeCloseTo(corner(rotated, -1, fy).y, 6)
    }

    const shift = { shift: true, alt: false }
    const even = dragCarveHandle(rotated, 'se', corner(rotated, 1, 1), add(corner(rotated, 1, 1), { x: 17.3, y: 11.1 }), shift) as SlabSpec
    const evenWhole = wholeCarveDrag(rotated, even, 'se', shift) as SlabSpec
    expect(evenWhole.width).toBe(Math.round(even.width))
    expect(evenWhole.height / evenWhole.width).toBeCloseTo(rotated.height / rotated.width, 9)
    expect(evenWhole.radius / rotated.radius).toBeCloseTo(evenWhole.width / rotated.width, 9)
    expect(corner(evenWhole, -1, -1).x).toBeCloseTo(corner(rotated, -1, -1).x, 6)
    expect(corner(evenWhole, -1, -1).y).toBeCloseTo(corner(rotated, -1, -1).y, 6)
  })

  it('leave a side the handle does not pull at its size, whole or not', () => {
    const fractional: SlabSpec = { ...rotated, width: 201, height: 100.5 }
    const raw = dragCarveHandle(fractional, 'e', world(fractional, { x: 100.5, y: 0 }), world(fractional, { x: 120.3, y: 0 })) as SlabSpec
    const east = wholeCarveDrag(fractional, raw, 'e') as SlabSpec
    expect(east.width).toBe(Math.round(raw.width))
    expect(east.height).toBe(100.5)
    const west = world(fractional, { x: -100.5, y: 0 })
    expect(world(east, { x: -east.width / 2, y: 0 }).x).toBeCloseTo(west.x, 6)
    expect(world(east, { x: -east.width / 2, y: 0 }).y).toBeCloseTo(west.y, 6)
    const rawSouth = dragCarveHandle(fractional, 's', world(fractional, { x: 0, y: 50.25 }), world(fractional, { x: 0, y: 56.6 })) as SlabSpec
    const south = wholeCarveDrag(fractional, rawSouth, 's') as SlabSpec
    expect(south.width).toBe(201)
    expect(south.height).toBe(Math.round(rawSouth.height))
  })

  it('give a punch a whole diameter and a groove a whole width', () => {
    const punch: PunchSpec = { v: 1, kind: 'punch', shape: 'circle', center: { x: 10, y: 10 }, radius: 40, rotation: 0 }
    const grown = dragCarveHandle(punch, 'se', { x: 50, y: 10 }, { x: 63.3, y: 10 }) as PunchSpec
    expect((wholeCarveDrag(punch, grown, 'se') as PunchSpec).radius * 2).toBe(Math.round(grown.radius * 2))
    const groove: GrooveSpec = { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 100, y: 0 }, width: 40 }
    const wider = dragCarveHandle(groove, 'width', { x: 0, y: -20 }, { x: 0, y: -23.7 }) as GrooveSpec
    expect((wholeCarveDrag(groove, wider, 'width') as GrooveSpec).width).toBe(Math.round(wider.width))
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

describe('scaling and turning a recipe as part of a selection', () => {
  const pivot = { x: -40, y: 25 }
  const recipes: Array<[string, CarveSpec]> = [
    ['a bent, rounded, turned slab', { ...rotated, radius: 30, sides: { top: { a1: 0.05, o1: 18, a2: -0.05, o2: 12 } }, corners: { br: { k1: 1.3, k2: 0.8 } } }],
    ['a circle punch', { v: 1, kind: 'punch', shape: 'circle', center: { x: 60, y: 40 }, radius: 45, rotation: 0 }],
    ['a bent square punch', { v: 1, kind: 'punch', shape: 'square', center: { x: 60, y: 40 }, radius: 45, rotation: 20, sides: { right: { a1: 0, o1: 10, a2: 0, o2: 10 } } }],
    ['a triangle punch', { v: 1, kind: 'punch', shape: 'triangle', center: { x: -10, y: 70 }, radius: 50, rotation: 10 }],
    ['a bent channel', { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 120, y: 30 }, width: 36, bend: { a1: 0, o1: 25, a2: 0, o2: 25 } }],
    ['a slice', { v: 1, kind: 'slice', from: { x: -80, y: -60 }, to: { x: 90, y: 50 }, width: 20 }],
  ]

  /**
   * A box recipe's outline, point by point and handle by handle, is the old
   * one mapped by `map`. A groove's outline is rebuilt around its spine (and a
   * slice's reaches the same distance past its ends), so its spine is
   * compared instead, with its width scaled by `factor`.
   */
  function expectMapped(next: CarveSpec, start: CarveSpec, map: (p: Vec) => Vec, factor: number) {
    if (isGroove(start) || isGroove(next)) {
      if (!isGroove(start) || !isGroove(next)) throw new Error('a groove stays a groove')
      const was = grooveSpine(start)
      const now = grooveSpine(next)
      now.forEach((p, i) => {
        expect(p.x).toBeCloseTo(map(was[i]).x, 6)
        expect(p.y).toBeCloseTo(map(was[i]).y, 6)
      })
      expect(next.width).toBeCloseTo(start.width * factor, 6)
      return
    }
    const was = carveOutline(start).segs
    const now = carveOutline(next).segs
    expect(now).toHaveLength(was.length)
    now.forEach((seg, i) => {
      const p = map(was[i].p)
      expect(seg.p.x).toBeCloseTo(p.x, 6)
      expect(seg.p.y).toBeCloseTo(p.y, 6)
      for (const key of ['hIn', 'hOut'] as const) {
        const before = was[i][key]
        const after = seg[key]
        expect(Boolean(after)).toBe(Boolean(before))
        if (!before || !after) continue
        const tip = sub(map(add(was[i].p, before)), p)
        expect(after.x).toBeCloseTo(tip.x, 6)
        expect(after.y).toBeCloseTo(tip.y, 6)
      }
    })
  }

  const expectValid = (spec: CarveSpec) => {
    const rounded = roundCarveSpec(spec)
    expect(isObjectCarveValid(rounded, [segsToContour(carveOutline(rounded).segs)])).toBe(true)
  }

  it.each(recipes)('scales %s about a pivot, every length alike, and it stays a valid recipe', (_, spec) => {
    for (const factor of [0.6, 1.75]) {
      const next = scaleCarveAbout(spec, pivot, factor)
      expect(next.kind).toBe(spec.kind)
      expectMapped(next, spec, (p) => add(pivot, scale(sub(p, pivot), factor)), factor)
      expectValid(next)
    }
  })

  it.each(recipes)('turns %s about a pivot and it stays a valid recipe', (_, spec) => {
    const next = rotateCarveAbout(spec, pivot, 30)
    expectMapped(next, spec, (p) => rotateAbout(p, pivot, 30), 1)
    expectValid(next)
  })
})

describe('a recipe carried by a map', () => {
  const pivot = { x: -40, y: 25 }
  const slab: SlabSpec = { ...rotated, radius: 30, sides: { top: { a1: 0.05, o1: 18, a2: -0.05, o2: 12 } } }
  const channel: GrooveSpec = { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 120, y: 30 }, width: 36 }

  it('follows a turn, an even scale and a move exactly, and stays a valid recipe', () => {
    const map = affineOf((p) => add(rotateAbout(add(pivot, scale(sub(p, pivot), 1.4)), pivot, 30), { x: 12, y: -7 }))
    for (const spec of [slab, channel] as CarveSpec[]) {
      const next = carveUnderAffine(spec, map)
      const expected = translateCarve(rotateCarveAbout(scaleCarveAbout(spec, pivot, 1.4), pivot, 30), { x: 12, y: -7 })
      const outline = carveOutline(next).segs
      carveOutline(expected).segs.forEach((seg, i) => {
        expect(outline[i].p.x).toBeCloseTo(seg.p.x, 6)
        expect(outline[i].p.y).toBeCloseTo(seg.p.y, 6)
      })
      if (!isGroove(next) && next.kind !== 'band') expect(next.rotation).toBe(60)
      const rounded = roundCarveSpec(next)
      expect(isObjectCarveValid(rounded, [segsToContour(carveOutline(rounded).segs)])).toBe(true)
    }
  })

  it('takes the similarity nearest a stretch: its centre follows, its size scales by the area, its angle by the turn', () => {
    // Twice as wide along the x axis: the area doubles and nothing turns.
    const stretch = affineOf((p) => ({ x: pivot.x + (p.x - pivot.x) * 2, y: p.y }))
    const next = carveUnderAffine(slab, stretch) as SlabSpec
    expect(next.center).toEqual(applyAffine(stretch, slab.center))
    expect(next.rotation).toBe(slab.rotation)
    expect(next.width).toBeCloseTo(slab.width * Math.SQRT2, 9)
    expect(next.height).toBeCloseTo(slab.height * Math.SQRT2, 9)
    expect(next.radius).toBeCloseTo(slab.radius * Math.SQRT2, 9)
    expect(next.sides!.top!.o1).toBeCloseTo(18 * Math.SQRT2, 9)
    const groove = carveUnderAffine(channel, stretch) as GrooveSpec
    const middle = { x: (channel.from.x + channel.to.x) / 2, y: (channel.from.y + channel.to.y) / 2 }
    const grooveMiddle = { x: (groove.from.x + groove.to.x) / 2, y: (groove.from.y + groove.to.y) / 2 }
    expect(grooveMiddle.x).toBeCloseTo(applyAffine(stretch, middle).x, 9)
    expect(grooveMiddle.y).toBeCloseTo(applyAffine(stretch, middle).y, 9)
    expect(Math.hypot(groove.to.x - groove.from.x, groove.to.y - groove.from.y)).toBeCloseTo(
      Math.hypot(channel.to.x - channel.from.x, channel.to.y - channel.from.y) * Math.SQRT2,
      9,
    )
    expect(groove.width).toBeCloseTo(channel.width * Math.SQRT2, 9)

    // A stretch in a frame turned by 30°, then a quarter turn: the punch turns by the quarter turn alone, and stays round.
    const punch: PunchSpec = { v: 1, kind: 'punch', shape: 'circle', center: { x: 50, y: 20 }, radius: 10, rotation: 0 }
    const along = affineOf((p) => {
      const local = rotate(sub(p, pivot), -30)
      return rotateAbout(add(pivot, rotate({ x: local.x * 1.5, y: local.y * 0.6 }, 30)), pivot, 90)
    })
    const carried = carveUnderAffine(punch, along) as PunchSpec
    expect(carried.shape).toBe('circle')
    expect(carried.center.x).toBeCloseTo(applyAffine(along, punch.center).x, 9)
    expect(carried.center.y).toBeCloseTo(applyAffine(along, punch.center).y, 9)
    expect(carried.radius).toBeCloseTo(10 * Math.sqrt(1.5 * 0.6), 9)
    expect(carried.rotation).toBe(90)
  })
})
