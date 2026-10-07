import { describe, expect, it } from 'vitest'
import { slabSpec } from '../carve/spec.ts'
import { add, distance, rotate, sub, type Vec } from '../path/bezier.ts'
import { contoursPrimitives, recipePrimitives, type Primitive } from './primitives.ts'
import { commonTangents, roundPrimitives, tangentAtAngle, tangentMove, tangentRadius, tangentThrough } from './tangent.ts'

const floor: Primitive = { kind: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 }, owner: 'floor', guide: true }
const wall: Primitive = { kind: 'line', p: { x: 0, y: 0 }, d: { x: 0, y: 1 }, owner: 'wall', guide: true }
const disc: Primitive = { kind: 'circle', c: { x: 0, y: 0 }, r: 100, owner: 'disc' }

/** How far a point is from an infinite line through `p` along `angle` degrees. */
function offLine(q: Vec, p: Vec, angle: number): number {
  const d = rotate({ x: 1, y: 0 }, angle)
  const v = sub(q, p)
  return Math.abs(v.x * d.y - v.y * d.x)
}

describe('a moved circle touching things', () => {
  it('settles onto a line it nearly touches, on the side it is on', () => {
    const above = tangentMove([floor], { c: { x: 40, y: -27 }, r: 30 }, 8)
    expect(above?.center).toEqual({ x: 40, y: -30 })
    expect(above?.touches).toEqual([{ p: { x: 40, y: 0 }, owner: 'floor', guide: true }])
    const below = tangentMove([floor], { c: { x: 40, y: 34 }, r: 30 }, 8)
    expect(below?.center).toEqual({ x: 40, y: 30 })
    expect(tangentMove([floor], { c: { x: 40, y: -40 }, r: 30 }, 8)).toBeNull()
  })

  it('touches another circle from outside or from inside, whichever is nearer', () => {
    const outside = tangentMove([disc], { c: { x: 135, y: 0 }, r: 30 }, 8)
    expect(outside!.center.x).toBeCloseTo(130, 9)
    expect(outside!.touches[0].p.x).toBeCloseTo(100, 9)
    const inside = tangentMove([disc], { c: { x: 74, y: 0 }, r: 30 }, 8)
    expect(inside!.center.x).toBeCloseTo(70, 9)
    expect(inside!.touches[0].p.x).toBeCloseTo(100, 9)
    // A circle that holds the other touches it from outside it.
    const around = tangentMove([disc], { c: { x: 0, y: 55 }, r: 150 }, 8)
    expect(distance(around!.center, disc.c)).toBeCloseTo(50, 9)
    expect(around!.touches[0].p.y).toBeCloseTo(-100, 9)
  })

  it('goes into a corner, touching both lines at once', () => {
    const corner = tangentMove([floor, wall], { c: { x: 34, y: -25 }, r: 30 }, 8)
    expect(corner?.center).toEqual({ x: 30, y: -30 })
    expect(corner?.touches.map((touch) => touch.owner)).toEqual(['floor', 'wall'])
  })

  it('touches a segment only along it, and its end beyond it', () => {
    const segment: Primitive = { kind: 'segment', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, owner: 's' }
    expect(tangentMove([segment], { c: { x: 50, y: -28 }, r: 30 }, 8)?.center).toEqual({ x: 50, y: -30 })
    const past = tangentMove([segment], { c: { x: 120, y: -16 }, r: 25 }, 8)
    expect(past?.touches[0].p).toEqual({ x: 100, y: 0 })
    expect(distance(past!.center, { x: 100, y: 0 })).toBeCloseTo(25, 9)
  })

  it('slides past where a rounded slab’s side runs into its corner, with no sticky spot at the join', () => {
    const slab = recipePrimitives({ ...slabSpec('square'), width: 200, height: 200, radius: 40 }, 'slab')
    // The top side runs straight to x = 60, where its corner's arc takes over; the circle sits within reach of both.
    let last = -Infinity
    for (let x = 50; x <= 70; x += 0.5) {
      const found = tangentMove(slab, { c: { x, y: -128 }, r: 30 }, 8)
      expect(found).not.toBeNull()
      expect(found!.touches).toHaveLength(1)
      // It moves only onto the line of centres touching the edge, never sideways along it to the join.
      expect(Math.abs(found!.center.x - x)).toBeLessThan(0.5)
      expect(found!.center.x).toBeGreaterThan(last)
      last = found!.center.x
    }
  })

  it('slides past a smooth join of two curves, as along one curve', () => {
    const k = 0.5523
    const at = (x: number, y: number, hIn: Vec, hOut: Vec) => ({ point: { x, y }, handleIn: hIn, handleOut: hOut })
    const ellipse = contoursPrimitives(
      [
        {
          closed: true,
          segments: [
            at(150, 0, { x: 0, y: -k * 90 }, { x: 0, y: k * 90 }),
            at(0, 90, { x: k * 150, y: 0 }, { x: -k * 150, y: 0 }),
            at(-150, 0, { x: 0, y: k * 90 }, { x: 0, y: -k * 90 }),
            at(0, -90, { x: -k * 150, y: 0 }, { x: k * 150, y: 0 }),
          ],
        },
      ],
      'ellipse',
    )
    for (let x = -6; x <= 6; x += 1) {
      const found = tangentMove(ellipse, { c: { x, y: -123 }, r: 30 }, 8)
      expect(found!.touches).toHaveLength(1)
      expect(Math.abs(found!.center.x - x)).toBeLessThan(0.2)
    }
  })

  it('touches a curved edge, its distance from it the radius', () => {
    const curve: Primitive = { kind: 'cubic', curve: [{ x: -100, y: 0 }, { x: -30, y: 60 }, { x: 30, y: 60 }, { x: 100, y: 0 }], owner: 'c' }
    const touch = tangentMove([curve], { c: { x: 0, y: 67 }, r: 20 }, 8)
    expect(touch).not.toBeNull()
    expect(distance(touch!.center, touch!.touches[0].p)).toBeCloseTo(20, 3)
  })
})

describe('a circle that grows until it touches', () => {
  it('grows about its centre to a line, or to a circle from outside or inside', () => {
    expect(tangentRadius([floor], { c: { x: 0, y: -50 }, r: 46 }, { x: 0, y: -50 }, 8)?.radius).toBeCloseTo(50, 9)
    expect(tangentRadius([disc], { c: { x: 150, y: 0 }, r: 47 }, { x: 150, y: 0 }, 8)?.radius).toBeCloseTo(50, 9)
    expect(tangentRadius([disc], { c: { x: 40, y: 0 }, r: 57 }, { x: 40, y: 0 }, 8)?.radius).toBeCloseTo(60, 9)
    expect(tangentRadius([disc], { c: { x: 40, y: 0 }, r: 136 }, { x: 40, y: 0 }, 8)?.radius).toBeCloseTo(140, 9)
    expect(tangentRadius([floor], { c: { x: 0, y: -50 }, r: 30 }, { x: 0, y: -50 }, 8)).toBeNull()
  })

  it('grows from a corner that stays put, its centre moving with it', () => {
    // Pulled from its lower right, about its upper left corner at (−50, −150): it touches the floor at radius 75.
    const pivot = { x: -50, y: -150 }
    const found = tangentRadius([floor], { c: { x: 22, y: -78 }, r: 72 }, pivot, 8)
    expect(found).not.toBeNull()
    expect(found!.radius).toBeCloseTo(75, 9)
    expect(found!.center.y + found!.radius).toBeCloseTo(0, 9)
    expect(found!.center.x - found!.radius).toBeCloseTo(-50, 9)
  })

  it('takes no snap from a line it sits on along the side that stays put, and lands on the same size every frame (ref 4)', () => {
    // B sits on the bottom line y = 190 and grows from its top right corner, about its bottom left one.
    const bottom: Primitive = { kind: 'line', p: { x: 0, y: 190 }, d: { x: 1, y: 0 }, owner: 'bottom', guide: true }
    const right: Primitive = { kind: 'line', p: { x: 40, y: 0 }, d: { x: 0, y: 1 }, owner: 'right', guide: true }
    const pivot = { x: -100, y: 190 }
    const at = (r: number) => ({ c: { x: pivot.x + r, y: pivot.y - r }, r })
    const tolerance = 6.36
    const found = new Set<string>()
    for (let r = 40; r <= 100; r += 0.25) {
      expect(tangentRadius([bottom], at(r), pivot, tolerance)).toBeNull()
      const touch = tangentRadius([bottom, right], at(r), pivot, tolerance)
      // It touches the right line at radius 70, and only within reach of it.
      if (Math.abs(r - 70) <= tolerance) found.add(touch!.radius.toFixed(9))
      else expect(touch).toBeNull()
    }
    expect([...found]).toEqual(['70.000000000'])
    // A circle on the left line, resized about a corner on it, likewise.
    const left: Primitive = { kind: 'line', p: { x: -200, y: 0 }, d: { x: 0, y: 1 }, owner: 'left', guide: true }
    for (let r = 60; r <= 260; r += 0.5) expect(tangentRadius([left], { c: { x: -200 + r, y: -200 + r }, r }, { x: -200, y: -200 }, tolerance)).toBeNull()
  })

  it('grows from a corner until it touches another circle, exactly', () => {
    const pivot = { x: -50, y: -150 }
    // Centre (−50 + r, −150 + r): it touches the disc from outside where its centre is 100 + r from the origin, at r = 300 − √75000.
    const found = tangentRadius([disc], { c: { x: -50 + 30, y: -150 + 30 }, r: 30 }, pivot, 8)
    expect(found).not.toBeNull()
    expect(distance(found!.center, { x: 0, y: 0 })).toBeCloseTo(100 + found!.radius, 9)
    expect(found!.radius).toBeCloseTo(300 - Math.sqrt(75000), 9)
  })
})

describe('lines touching circles', () => {
  it('turns a line from a point until it touches a circle', () => {
    const from = { x: -300, y: -100 }
    const found = tangentThrough(from, { x: 0, y: -103 }, roundPrimitives([disc]), 8)
    expect(found).not.toBeNull()
    expect(offLine(disc.kind === 'circle' ? disc.c : from, from, found!.angle)).toBeCloseTo(100, 9)
    expect(found!.touch.owner).toBe('disc')
  })

  it('never turns a line to a circle it does not already pass close to touching, however short the drag', () => {
    const rounds = roundPrimitives([
      { kind: 'circle', c: { x: -120, y: 0 }, r: 80, owner: 'a' },
      { kind: 'circle', c: { x: 120, y: 40 }, r: 50, owner: 'b' },
    ])
    const from = { x: 200, y: -200 }
    for (const reach of [0.5, 4, 6, 8, 20, 100, 400]) {
      expect(tangentThrough(from, add(from, rotate({ x: reach, y: 0 }, 14)), rounds, 8)).toBeNull()
    }
    // Drawn to pass 5 units outside b's rim, it turns to touch b.
    const toB = sub({ x: 120, y: 40 }, from)
    const passing = rotate(toB, (Math.asin(55 / Math.hypot(toB.x, toB.y)) * 180) / Math.PI)
    const found = tangentThrough(from, add(from, passing), rounds, 8)
    expect(found?.touch.owner).toBe('b')
    expect(offLine({ x: 120, y: 40 }, from, found!.angle)).toBeCloseTo(50, 9)
  })

  it('moves a line at its angle across itself until it touches a circle', () => {
    const found = tangentAtAngle({ x: 0, y: 104 }, 0, roundPrimitives([disc]), 8)
    expect(found!.p.y).toBeCloseTo(100, 9)
    expect(found!.touch.p.y).toBeCloseTo(100, 9)
    const steep = tangentAtAngle({ x: 110, y: 0 }, 60, roundPrimitives([disc]), 8)
    expect(offLine({ x: 0, y: 0 }, steep!.p, 60)).toBeCloseTo(100, 9)
  })

  it('finds the four lines two circles apart share, and two when one holds part of the other', () => {
    const a = { c: { x: 0, y: 0 }, r: 50 }
    const b = { c: { x: 200, y: 0 }, r: 30 }
    const lines = commonTangents(a, b)
    expect(lines.map((line) => line.kind)).toEqual(['external', 'external', 'internal', 'internal'])
    for (const line of lines) {
      expect(offLine(a.c, line.p, line.angle)).toBeCloseTo(50, 9)
      expect(offLine(b.c, line.p, line.angle)).toBeCloseTo(30, 9)
      expect(distance(line.touches[0], a.c)).toBeCloseTo(50, 9)
      expect(distance(line.touches[1], b.c)).toBeCloseTo(30, 9)
    }
    expect(commonTangents(a, { c: { x: 60, y: 0 }, r: 30 }).map((line) => line.kind)).toEqual(['external', 'external'])
    expect(commonTangents(a, { c: { x: 10, y: 0 }, r: 10 })).toEqual([])
    // Touching from outside: the line where they meet is the one internal line.
    expect(commonTangents(a, { c: { x: 80, y: 0 }, r: 30 }).map((line) => line.kind)).toEqual(['external', 'external', 'internal'])
  })
})
