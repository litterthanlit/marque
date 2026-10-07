import { describe, expect, it } from 'vitest'
import { polygonSpec } from '../carve/spec.ts'
import { composeBaseMark } from '../vector/export.ts'
import { cubicTangent, distance, dot, projectOnCubic, sub, type Cubic, type Vec } from '../path/bezier.ts'
import type { PathObject } from '../vector/types.ts'
import { attributedCorners, markGeometry, type AttributedCorner } from './corners.ts'
import { cornerSources } from './apply.ts'
import { solveFillet } from './solve.ts'
import { bar, block, circle, made, numbers, recipe } from './testShapes.ts'

/** The ink corner nearest a point, read from some objects as they compose. */
function cornerNear(objects: PathObject[], at: Vec): AttributedCorner {
  const lists = made(objects).objects
  const corners = attributedCorners(markGeometry(composeBaseMark(lists)), cornerSources(lists))
  const corner = corners.reduce((best, each) => (distance(each.p, at) < distance(best.p, at) ? each : best))
  // A circle drawn as cubics strays from its true circle by up to 0.03% of its radius: the ink corner moves with it.
  expect(distance(corner.p, at)).toBeLessThan(0.05)
  return corner
}

function expectNear(actual: Vec, expected: Vec, within = 1e-6) {
  expect(distance(actual, expected)).toBeLessThan(within)
}

describe('a fillet in a corner', () => {
  it('between two lines sits where the lines moved in by ρ cross, touching each ρ from the corner', () => {
    const corner = cornerNear([block('s', { x: 0, y: 0 }, 200, 100)], { x: 100, y: -50 })
    const solved = solveFillet(corner, 20)!
    expectNear(solved.centre, { x: 80, y: -30 })
    const touches = [...solved.touches].sort((a, b) => a.x - b.x)
    expectNear(touches[0], { x: 80, y: -50 })
    expectNear(touches[1], { x: 100, y: -30 })
    expect(solved).toMatchObject({ radius: 20, clamped: false })
  })

  it('between a line and a circle, outside the circle, sits where the moved line meets the circle of radius r + ρ', () => {
    const corner = cornerNear([circle('a', 0, 0, 100), circle('b', 400, 0, 70), bar('bar', 'a', 'b', 40)], { x: Math.sqrt(100 ** 2 - 20 ** 2), y: -20 })
    const solved = solveFillet(corner, 25)!
    const centre = { x: Math.sqrt(125 ** 2 - 45 ** 2), y: -45 }
    expectNear(solved.centre, centre)
    expect(solved.touches.some((touch) => distance(touch, { x: centre.x, y: -20 }) < 1e-6)).toBe(true)
    expect(solved.touches.some((touch) => distance(touch, { x: (centre.x * 100) / 125, y: (-45 * 100) / 125 }) < 1e-6)).toBe(true)
  })

  it('between a line and a cut circle, at a convex corner, sits inside the ink and outside the cut', () => {
    const corner = cornerNear([block('s', { x: 0, y: 0 }, 200, 200), circle('hole', 100, 0, 40, 'subtract')], { x: 100, y: -40 })
    expect(corner.convex).toBe(true)
    const solved = solveFillet(corner, 10)!
    expectNear(solved.centre, { x: 90, y: -Math.sqrt(50 ** 2 - 10 ** 2) })
  })

  it('between two circles sits where the circles of radius r₁ + ρ and r₂ + ρ meet', () => {
    // Two discs that overlap: the waist on each side is a concave corner.
    const along = (100 ** 2 - 80 ** 2 + 150 ** 2) / 300
    const corner = cornerNear([circle('a', 0, 0, 100), circle('b', 150, 0, 80)], { x: along, y: -Math.sqrt(100 ** 2 - along ** 2) })
    const solved = solveFillet(corner, 20)!
    const x = (120 ** 2 - 100 ** 2 + 150 ** 2) / 300
    const centre = { x, y: -Math.sqrt(120 ** 2 - x * x) }
    expectNear(solved.centre, centre)
    expect(Math.abs(distance(solved.centre, { x: 0, y: 0 }) - 120)).toBeLessThan(1e-9)
    expect(Math.abs(distance(solved.centre, { x: 150, y: 0 }) - 100)).toBeLessThan(1e-9)
  })

  it('beside a free curve is found by Newton’s method, ρ from the line and from the curve', () => {
    // A D: a straight back, and a curve round from its bottom to its top.
    const d: PathObject = {
      id: 'd', name: 'D', parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'evenodd',
      contours: [{ closed: true, segments: [
        { point: { x: 0, y: -100 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 180, y: 10 } },
        { point: { x: 0, y: 100 }, handleIn: { x: 140, y: -20 }, handleOut: null },
      ] }],
    }
    const corner = cornerNear([d], { x: 0, y: -100 })
    expect(corner.carriers.map((carrier) => carrier.kind).sort()).toEqual(['cubic', 'segment'])
    const solved = solveFillet(corner, 15)!
    const curve = [{ x: 0, y: -100 }, { x: 180, y: -90 }, { x: 140, y: 80 }, { x: 0, y: 100 }] as const
    expect(Math.abs(solved.centre.x - 15)).toBeLessThan(1e-6)
    expect(Math.abs(projectOnCubic(curve, solved.centre).distance - 15)).toBeLessThan(1e-6)
    expect(projectOnCubic(curve, solved.touches.find((touch) => touch.x > 1e-3)!).distance).toBeLessThan(1e-6)
  })

  it('is cut down to the largest radius whose touch points stay on their curves, and says so', () => {
    const corner = cornerNear([block('s', { x: 0, y: 0 }, 40, 40)], { x: 20, y: -20 })
    const solved = solveFillet(corner, 50)!
    expect(solved.clamped).toBe(true)
    expect(solved.radius).toBeGreaterThan(39.9)
    expect(solved.radius).toBeLessThan(40.1)
    expect(solveFillet(corner, 30)).toMatchObject({ radius: 30, clamped: false })
  })

  it('cuts a bar’s fillet down where its touch point would pass the bar’s far end', () => {
    // At radius 1000 the bar's touch point would lie at x 412, past where the bar meets the second circle at x 333.
    const corner = cornerNear([circle('a', 0, 0, 100), circle('b', 400, 0, 70), bar('bar', 'a', 'b', 40)], { x: Math.sqrt(100 ** 2 - 20 ** 2), y: -20 })
    const solved = solveFillet(corner, 1000)!
    expect(solved.clamped).toBe(true)
    // The largest that fits touches the bar where it meets the second circle.
    const reach = Math.sqrt(70 ** 2 - 20 ** 2)
    expect(Math.min(...solved.touches.map((touch) => Math.abs(touch.x - (400 - reach))))).toBeLessThan(0.1)
  })

  it('keeps to the corner it starts in: a narrow finger of ink rounded at its tip holds what its width holds, however much more is asked', () => {
    // A seven-sided polygon with a square cut out of it, leaving a finger about 8 wide whose tip turns 30.6°.
    const objects = [
      recipe('p', { v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 7, radius: 160, rotation: 45.14, cornerRadius: 12.3 }),
      recipe('q', { v: 1, kind: 'polygon', center: { x: 104.14, y: -10.35 }, sides: 4, radius: 71.68, rotation: 56.47, cornerRadius: 18.12 }, 'subtract'),
    ]
    const tip = cornerNear(objects, { x: 153.33, y: 2.11 })
    expect(tip.convex).toBe(true)
    let last = 0
    for (const asked of [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 40]) {
      const solved = solveFillet(tip, asked)!
      expect(solved.radius).toBeGreaterThanOrEqual(last - 1e-6)
      // Within the finger: never on the far side of its narrowing, where the ink widens 50 from the tip.
      expect(distance(solved.centre, tip.p)).toBeLessThan(20)
      last = solved.radius
    }
    expect(last).toBeLessThan(4)
  })

  it('never gives less as more is asked, its centre moving on smoothly, over random corners of a polygon cut by another', () => {
    const rand = numbers(29)
    let corners = 0
    for (let t = 0; t < 12; t++) {
      const objects = [
        recipe('p', { ...polygonSpec({ x: 0, y: 0 }, 160, 5 + Math.floor(rand() * 3), rand() < 0.5 ? 0 : 10 + rand() * 30), rotation: rand() * 60 }),
        recipe('q', { ...polygonSpec({ x: 60 + rand() * 60, y: (rand() - 0.5) * 60 }, 60 + rand() * 40, 3 + Math.floor(rand() * 4), rand() < 0.5 ? 0 : 5 + rand() * 15), rotation: rand() * 60 }, 'subtract'),
      ]
      const lists = made(objects).objects
      for (const corner of attributedCorners(markGeometry(composeBaseMark(lists)), cornerSources(lists))) {
        corners++
        let last: { radius: number; centre: Vec } | null = null
        for (let asked = 2; asked <= 60; asked += 2) {
          const solved = solveFillet(corner, asked)
          if (!solved) {
            expect(last).toBeNull()
            continue
          }
          if (last) {
            // Cut down at the same limit each time, to the thousandth the halving reaches.
            expect(solved.radius).toBeGreaterThanOrEqual(last.radius - 0.01)
            const grew = Math.max(0, solved.radius - last.radius)
            expect(distance(solved.centre, last.centre)).toBeLessThan((4 * grew) / Math.sin(corner.angle / 2) + 0.1)
          }
          last = solved
        }
      }
    }
    expect(corners).toBeGreaterThan(40)
  })

  it('cuts a fillet in a crescent’s tip down to the crescent’s width, touching both sides as the ink draws them', () => {
    // The crescent is 80 across at its thickest: no fillet larger than 40 fits its tip.
    const objects = [circle('a', 0, 0, 100), circle('b', 60, 0, 80, 'subtract')]
    const tip = cornerNear(objects, { x: 60, y: -80 })
    const solved = solveFillet(tip, 45)!
    expect(solved.clamped).toBe(true)
    // A circle drawn as cubics strays from its true circle by up to 0.03% of its radius: so may the width.
    expect(solved.radius).toBeLessThan(40 + 0.03)
    expect(solved.radius).toBeGreaterThan(39.9)
    tip.sides.forEach((run, side) => {
      const foot = nearest(run, solved.centre)
      expect(Math.abs(foot.distance - solved.radius)).toBeLessThan(1e-6)
      expect(distance(foot.point, solved.touches[side])).toBeLessThan(1e-6)
    })
    expect(solveFillet(tip, 30)).toMatchObject({ radius: 30, clamped: false })
  })
})

/** The nearest point of a run of curves, how far it is, and whether the way from it is square to the run. */
function nearest(run: readonly Cubic[], q: Vec): { point: Vec; distance: number } {
  let best = { point: run[0][0], distance: Infinity, square: false }
  for (const curve of run) {
    const hit = projectOnCubic(curve, q)
    if (hit.distance < best.distance) best = { point: hit.point, distance: hit.distance, square: Math.abs(dot(cubicTangent(curve, hit.t), sub(q, hit.point))) < 1e-6 * hit.distance }
  }
  expect(best.square).toBe(true)
  return best
}
