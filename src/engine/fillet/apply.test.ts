import { describe, expect, it } from 'vitest'
import { polygonSpec } from '../carve/spec.ts'
import { composeBaseMark, composeVectorMarkCached } from '../vector/export.ts'
import { createEmptyVectorDocument } from '../vector/document.ts'
import { add, cross, cubicPoint, distance, projectOnCubic, scale, splitCubic, sub, type Cubic, type Vec } from '../path/bezier.ts'
import type { Fillet, PathObject, VectorDocument, VectorObject } from '../vector/types.ts'
import { attributedCorners, cornerKind, inkGeometry, markGeometry, type AttributedCorner } from './corners.ts'
import { applyFillets, cornerSources, cornersLike, freeCorners, roundAllPlan } from './apply.ts'
import { bar, block, circle, fillet, made, measure, numbers, polyline, recipe } from './testShapes.ts'

function polyArea(points: Vec[]): number {
  return Math.abs(points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0)) / 2
}

/** The area a chord cuts from a circle. */
function segmentArea(r: number, chord: number): number {
  const half = chord / 2
  return r * r * Math.asin(Math.min(1, half / r)) - half * Math.sqrt(Math.max(0, r * r - half * half))
}

/** How much a fillet of radius ρ fills or takes off between two straight sides meeting at angle θ. */
function lineLineArea(rho: number, angle: number): number {
  return (rho * rho) / Math.tan(angle / 2) - (rho * rho * (Math.PI - angle)) / 2
}

/** Fillets on every corner given, as the Round tool would add them. */
function filletsOn(corners: ReadonlyArray<{ p: Vec; between: [string, string] }>, radius: number | ((i: number) => number)): Fillet[] {
  return corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, typeof radius === 'number' ? radius : radius(i)))
}

function cornersOf(objects: VectorObject[]) {
  return attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
}

/** Points along a side from its corner to where the fillet touches it. */
function sideTo(run: readonly Cubic[], touch: Vec): Vec[] {
  let best = { index: 0, t: 0, distance: Infinity }
  run.forEach((curve, index) => {
    const hit = projectOnCubic(curve, touch)
    if (hit.distance < best.distance) best = { index, t: hit.t, distance: hit.distance }
  })
  const curves = [...run.slice(0, best.index), splitCubic(run[best.index], best.t)[0]]
  return curves.flatMap((curve) => Array.from({ length: 64 }, (_, i) => cubicPoint(curve, i / 64)))
}

/** The area between a corner, its two sides as far as the touch points and the fillet's arc: what rounding it adds or takes off. */
function notchArea(corner: AttributedCorner, centre: Vec, touches: [Vec, Vec], radius: number): number {
  const start = Math.atan2(touches[0].y - centre.y, touches[0].x - centre.x)
  let sweep = Math.atan2(touches[1].y - centre.y, touches[1].x - centre.x) - start
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep <= -Math.PI) sweep += 2 * Math.PI
  const at = (angle: number) => add(centre, scale({ x: Math.cos(angle), y: Math.sin(angle) }, radius))
  if (distance(at(start + sweep / 2), corner.p) > distance(centre, corner.p)) sweep += sweep > 0 ? -2 * Math.PI : 2 * Math.PI
  const arc = Array.from({ length: 257 }, (_, i) => at(start + (sweep * i) / 256))
  return polyArea([...sideTo(corner.sides[0], touches[0]), ...arc, ...sideTo(corner.sides[1], touches[1]).reverse()])
}

/**
 * One fillet on one corner, measured against its notch: how far the ink it
 * gained (or, at a convex corner, lost) is from the notch's area, and
 * whether the pieces and holes are as they were.
 */
function roundOne(objects: VectorObject[], corner: AttributedCorner, radius: number) {
  const base = composeBaseMark(objects)
  const mark = applyFillets(base, [fillet('f', corner.p, corner.between, radius)], cornerSources(objects))
  const resolved = mark.fillets![0]
  if (resolved.lost) return { lost: true, error: Infinity, notch: 0, same: false }
  const notch = notchArea(corner, resolved.centre, resolved.touches, resolved.used)
  const before = measure(base.compoundPathData)
  const after = measure(mark.compoundPathData)
  const gained = (after.area - before.area) * (corner.convex ? -1 : 1)
  const contours = (pathData: string) => (pathData.match(/M/gi) ?? []).length
  const same = after.pieces === before.pieces && contours(mark.compoundPathData) === contours(base.compoundPathData) && !mark.warnings
  return { lost: false, error: Math.abs(gained - notch), notch, same }
}

/** Does one fillet on one corner change its notch and nothing else, within 2% of the notch? */
function roundsJustItsNotch(objects: VectorObject[], corner: AttributedCorner, radius: number): boolean {
  const result = roundOne(objects, corner, radius)
  return !result.lost && result.same && result.error <= 0.02 * result.notch + 0.05
}

describe('the fillet pass', () => {
  it('rounds the concave corners where bars meet circles over random bars, as one piece, adding what a fillet adds', () => {
    const rand = numbers(7)
    let trials = 0
    let failures = 0
    for (let t = 0; t < 140; t++) {
      const r = 30 + rand() * 90
      const h = (0.1 + rand() * 0.75) * r
      const length = r + 60 + rand() * 200
      const theta = rand() * 360
      const u = { x: Math.cos((theta * Math.PI) / 180), y: Math.sin((theta * Math.PI) / 180) }
      const n = { x: -u.y, y: u.x }
      const objects = made([circle('c', 0, 0, r), block('bar', scale(u, length / 2), length, 2 * h, theta)]).objects
      const corners = cornersOf(objects).filter((corner) => !corner.convex)
      expect(corners).toHaveLength(2)
      const rho = 5 + rand() * 50
      const base = composeBaseMark(objects)
      const mark = applyFillets(base, filletsOn(corners, rho), cornerSources(objects))
      // From first principles: the quadrilateral of the corner, the touch points and the centre, less the fillet's sector and the circle's segment.
      let expected = 0
      let clamped = false
      for (const s of [1, -1]) {
        const fa = Math.sqrt((r + rho) ** 2 - (h + rho) ** 2)
        if (fa + 1 > length) clamped = true
        const P = add(scale(u, Math.sqrt(r * r - h * h)), scale(n, s * h))
        const F = add(scale(u, fa), scale(n, s * (h + rho)))
        const TL = add(scale(u, fa), scale(n, s * h))
        const TC = scale(F, r / (r + rho))
        const sweep = Math.acos(Math.max(-1, Math.min(1, (sub(TL, F).x * sub(TC, F).x + sub(TL, F).y * sub(TC, F).y) / (rho * rho))))
        expected += polyArea([P, TL, F, TC]) - 0.5 * rho * rho * sweep - segmentArea(r, distance(P, TC))
      }
      if (clamped) continue
      trials++
      const before = measure(base.compoundPathData)
      const after = measure(mark.compoundPathData)
      const gained = after.area - before.area
      if (after.pieces !== 1 || mark.warnings || Math.abs(gained - expected) > 0.02 * expected + 1) failures++
    }
    expect(trials).toBeGreaterThan(100)
    expect(failures).toBe(0)
  })

  it('leaves no kink where a fillet meets a circle: the arc touches the circle as drawn, not just the true one', () => {
    const objects = made([
      circle('a', -170, -130, 73),
      circle('b', 135, -110, 91),
      circle('c', 0, 110, 110),
      bar('ab', 'a', 'b', 40),
      bar('ac', 'a', 'c', 36),
      bar('bc', 'b', 'c', 44),
    ]).objects
    const joins = cornersOf(objects).filter((each) => cornerKind(each) === 'band · circle')
    expect(joins.length).toBeGreaterThanOrEqual(6)
    const base = composeBaseMark(objects)
    for (const rho of [5, 10, 25]) {
      const mark = applyFillets(base, filletsOn(joins, rho), cornerSources(objects))
      const shown = mark.fillets!.flatMap((each) => (each.lost ? [] : [each]))
      expect(shown).toHaveLength(joins.length)
      const touches = shown.flatMap((each) => each.touches)
      // Two fillets on one short stretch of circle can overlap, and their arcs cross: a corner of their own, not a kink.
      const onArcs = (p: Vec) => shown.filter((each) => Math.abs(distance(p, each.centre) - each.used) < 0.05).length
      const kinks = markGeometry(mark).corners.filter((corner) => touches.some((touch) => distance(touch, corner.p) < 2) && onArcs(corner.p) < 2)
      expect(kinks).toEqual([])
    }
  })

  it('rounds the hole corners where a triangle crosses a hexagon ring, over random rings', () => {
    const rand = numbers(11)
    let trials = 0
    let failures = 0
    for (let t = 0; t < 40; t++) {
      const R = 250 + rand() * 150
      const thick = 30 + rand() * 50
      const corner = thick + 5 + rand() * 40
      const hexagon = recipe('hex', polygonSpec({ x: 0, y: 0 }, R, 6, corner))
      const inset = recipe('inset', polygonSpec({ x: 0, y: 0 }, R - thick / Math.cos(Math.PI / 6), 6, corner - thick), 'subtract')
      const triangle = recipe('tri', { ...polygonSpec({ x: (rand() - 0.5) * 20, y: (rand() - 0.5) * 20 }, R * (0.9 + rand() * 0.1), 3), rotation: 180 + (rand() - 0.5) * 20 })
      const objects = made([hexagon, inset, triangle]).objects
      // Where both sides run straight from the corner, a fillet's area is known from its angle alone.
      const straight = (run: readonly (readonly Vec[])[]) => Math.abs(cross(sub(run[0][3], run[0][0]), sub(run[0][1], run[0][0]))) < 1e-6
      const candidates = cornersOf(objects).filter((each) => cornerKind(each) === 'cut polygon · polygon' && each.sides.every(straight))
      const radii = candidates.map(() => 2 + rand() * 8)
      // … as long as each touch point, ρ / tan(θ/2) from the corner, lies on that straight piece.
      const fits = candidates.map((each, i) => each.sides.every((run) => radii[i] / Math.tan(each.angle / 2) < distance(run[0][0], run[0][3])))
      const holes = candidates.filter((_, i) => fits[i])
      radii.splice(0, radii.length, ...radii.filter((_, i) => fits[i]))
      const base = composeBaseMark(objects)
      // Every hole corner at once, straight or not, keeps the ring one piece and only adds ink.
      const every = cornersOf(objects).filter((each) => cornerKind(each) === 'cut polygon · polygon')
      const all = applyFillets(base, filletsOn(every, 6), cornerSources(objects))
      const allAfter = measure(all.compoundPathData)
      if (allAfter.pieces !== measure(base.compoundPathData).pieces || all.warnings || allAfter.area <= measure(base.compoundPathData).area) failures++
      if (!holes.length) continue
      const mark = applyFillets(base, filletsOn(holes, (i) => radii[i]), cornerSources(objects))
      if (mark.fillets!.some((each) => each.lost || each.used !== each.radius)) continue
      trials++
      const expected = holes.reduce((sum, hole, i) => sum + lineLineArea(radii[i], hole.angle), 0)
      const before = measure(base.compoundPathData)
      const after = measure(mark.compoundPathData)
      if (after.pieces !== before.pieces || mark.warnings || Math.abs(after.area - before.area - expected) > 0.02 * expected + 0.5) failures++
    }
    expect(trials).toBeGreaterThan(30)
    expect(failures).toBe(0)
  })

  it('rounds the convex corners of random turned slabs with holes in them, taking off what a fillet takes off', () => {
    const rand = numbers(23)
    let failures = 0
    for (let t = 0; t < 60; t++) {
      const w = 80 + rand() * 320
      const h = 80 + rand() * 320
      const c = { x: (rand() - 0.5) * 100, y: (rand() - 0.5) * 100 }
      const objects = made([block('slab', c, w, h, rand() * 360), circle('hole', c.x, c.y, Math.min(w, h) / 5, 'subtract')]).objects
      const corners = cornersOf(objects).filter((each) => each.convex)
      expect(corners).toHaveLength(4)
      const rho = 2 + rand() * (Math.min(w, h) / 2 - 4)
      const base = composeBaseMark(objects)
      const mark = applyFillets(base, filletsOn(corners, rho), cornerSources(objects))
      const before = measure(base.compoundPathData)
      const after = measure(mark.compoundPathData)
      const expected = 4 * (1 - Math.PI / 4) * rho * rho
      if (after.pieces !== 1 || mark.warnings || Math.abs(before.area - after.area - expected) > 0.01 * expected + 0.5) failures++
    }
    expect(failures).toBe(0)
  })

  it('keeps a turned square hole in a slab when its corners and the slab\'s are all rounded at once', () => {
    const punch = recipe('p', { v: 1, kind: 'punch', shape: 'square', center: { x: -50, y: 0 }, radius: 30, rotation: 45 }, 'subtract')
    const objects = made([block('s', { x: 0, y: 0 }, 300, 200), punch]).objects
    const corners = cornersOf(objects)
    expect(corners.filter((each) => each.convex)).toHaveLength(4)
    expect(corners.filter((each) => !each.convex)).toHaveLength(4)
    const base = composeBaseMark(objects)
    const mark = applyFillets(base, filletsOn(corners, 12), cornerSources(objects))
    // Four convex corners take off what four concave ones of the same right angle add.
    expect(mark.fillets!.every((each) => !each.lost)).toBe(true)
    expect(mark.compoundPathData.match(/M/gi)).toHaveLength(2)
    expect(measure(mark.compoundPathData).area).toBeCloseTo(measure(base.compoundPathData).area, -0.3)
    expect(mark.warnings).toBeUndefined()
  })

  it('rounds every corner of random slabs with a square punch and a notch cut into an edge, keeping the hole', () => {
    const rand = numbers(31)
    let measured = 0
    let failures = 0
    // Neighbouring fillets crowded on a short edge are cut down to meet, and not measured: enough slabs that more than twenty are.
    for (let t = 0; t < 60; t++) {
      const objects = made([
        block('s', { x: 0, y: 0 }, 300, 200, rand() * 20),
        recipe('p', { v: 1, kind: 'punch', shape: 'square', center: { x: -60 + rand() * 30, y: (rand() - 0.5) * 60 }, radius: 30 + rand() * 30, rotation: rand() * 90 }, 'subtract'),
        block('n', { x: 150, y: (rand() - 0.5) * 80 }, 60 + rand() * 40, 40 + rand() * 40, rand() * 60, 'subtract'),
      ]).objects
      const corners = cornersOf(objects)
      const rho = 3 + rand() * 12
      const base = composeBaseMark(objects)
      const mark = applyFillets(base, filletsOn(corners, rho), cornerSources(objects))
      const contours = (pathData: string) => (pathData.match(/M/gi) ?? []).length
      if (contours(mark.compoundPathData) !== contours(base.compoundPathData) || mark.warnings) failures++
      // Where no fillet is crowded by its neighbours, what each adds or takes off is its notch.
      if (mark.fillets!.some((each) => each.lost || each.used !== each.radius)) continue
      measured++
      let expected = 0
      let notches = 0
      for (const resolved of mark.fillets!) {
        if (resolved.lost) continue
        const corner = corners.find((each) => each.p === resolved.corner)!
        const notch = notchArea(corner, resolved.centre, resolved.touches, resolved.used)
        expected += corner.convex ? -notch : notch
        notches += notch
      }
      const gained = measure(mark.compoundPathData).area - measure(base.compoundPathData).area
      if (Math.abs(gained - expected) > 0.02 * notches + 1) failures++
    }
    expect(measured).toBeGreaterThan(20)
    expect(failures).toBe(0)
  })

  it('rounds a corner inside a hole circle by just its notch, however far the hole curves away, at radii up to 0.6 of the hole', () => {
    const rand = numbers(3)
    let trials = 0
    let failures = 0
    for (let t = 0; t < 80; t++) {
      const inner = 60 + rand() * 60
      const objects = made([
        circle('outer', 0, 0, 150),
        circle('inner', 0, 0, inner, 'subtract'),
        block('bar', { x: 0, y: (rand() - 0.5) * inner }, 400, 16 + rand() * 40, rand() * 180),
      ]).objects
      const holes = cornersOf(objects).filter((each) => !each.convex && each.between.includes('inner'))
      if (!holes.length) continue
      trials++
      if (!roundsJustItsNotch(objects, holes[Math.floor(rand() * holes.length)], (0.05 + rand() * 0.55) * inner)) failures++
    }
    expect(trials).toBeGreaterThan(60)
    expect(failures).toBe(0)
  })

  it('rounds the tips of crescents, even ones sharper than 30°, leaving no sliver of the tip behind', () => {
    const rand = numbers(43)
    let sharp = 0
    let failures = 0
    for (let t = 0; t < 120; t++) {
      const objects = made([circle('a', 0, 0, 100), circle('b', 30 + rand() * 80, (rand() - 0.5) * 60, 50 + rand() * 60, 'subtract')]).objects
      const tips = cornersOf(objects)
      if (tips.length !== 2) continue
      const tip = tips[Math.floor(rand() * 2)]
      if (tip.angle < Math.PI / 6) sharp++
      if (!roundsJustItsNotch(objects, tip, 3 + rand() * 25)) failures++
    }
    expect(sharp).toBeGreaterThan(20)
    expect(failures).toBe(0)
  })

  it('rounds one side of a thin bar where it meets a circle without reaching through the bar', () => {
    const rand = numbers(9)
    let failures = 0
    for (let t = 0; t < 60; t++) {
      const width = 4 + rand() * 8
      const theta = rand() * 360
      const u = { x: Math.cos((theta * Math.PI) / 180), y: Math.sin((theta * Math.PI) / 180) }
      const objects = made([circle('c', 0, 0, 80), block('bar', scale(u, 160), 200, width, theta)]).objects
      const corners = cornersOf(objects).filter((each) => !each.convex)
      expect(corners).toHaveLength(2)
      if (!roundsJustItsNotch(objects, corners[Math.floor(rand() * 2)], width * (5 + rand() * 5))) failures++
    }
    expect(failures).toBe(0)
  })

  it('leaves a dot beside a rounded convex corner, and a hole beside a rounded concave one', () => {
    for (const rho of [20, 50, 80]) {
      // A dot just above the slab's top edge, 0.3ρ in from its corner.
      const dotted = made([block('s', { x: 0, y: 0 }, 200, 100), circle('dot', 100 - 0.3 * rho, -55, 2)]).objects
      const corner = cornersOf(dotted).find((each) => distance(each.p, { x: 100, y: -50 }) < 1e-6)!
      expect(roundsJustItsNotch(dotted, corner, rho)).toBe(true)
      // An L with a small hole 3 units in from one of the sides meeting at its inner corner.
      const holed = made([
        block('v', { x: -150, y: 0 }, 100, 400),
        block('h', { x: 0, y: 150 }, 400, 100),
        circle('hole', -100 + 0.3 * rho, 100 + 4.5, 1.5, 'subtract'),
      ]).objects
      const inner = cornersOf(holed).find((each) => distance(each.p, { x: -100, y: 100 }) < 1e-6)!
      expect(inner.convex).toBe(false)
      expect(roundsJustItsNotch(holed, inner, rho)).toBe(true)
    }
  })

  it('rounds the corners of a pen shape whose sides bow between the corner and the touch points', () => {
    const rand = numbers(29)
    let failures = 0
    let trials = 0
    for (let t = 0; t < 80; t++) {
      const points: Vec[] = []
      const n = 5 + Math.floor(rand() * 4)
      for (let i = 0; i < 2 * n; i++) {
        const angle = (i / (2 * n)) * Math.PI * 2
        const r = i % 2 ? 50 + rand() * 40 : 140 + rand() * 40
        points.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })
      }
      const star = polyline('star', points)
      // Every other side bows out or in, by up to a fifth of its length.
      star.contours[0].segments.forEach((segment, i) => {
        if (i % 2) return
        const chord = sub(points[i + 1], points[i])
        segment.handleOut = add(scale(chord, 0.25), scale({ x: -chord.y, y: chord.x }, (rand() - 0.5) * 0.8))
      })
      // A dot far off makes the booleans read the star: one whose bowed sides cross is left out.
      const objects = made([star, circle('dot', 400, 0, 5)]).objects
      if (composeBaseMark(objects).compoundPathData.split(/M/i).length !== 3) continue
      for (const corner of cornersOf(objects)) {
        trials++
        if (!roundsJustItsNotch(objects, corner, 4 + rand() * 20)) failures++
      }
    }
    expect(trials).toBeGreaterThan(150)
    expect(failures).toBe(0)
  })

  it('draws a fillet whose corner is gone as lost, and rounds it again when the corner comes back', () => {
    const at = { x: 100, y: -50 }
    const fillets = [fillet('f', at, ['s', 's'], 20)]
    const square = made([block('s', { x: 0, y: 0 }, 200, 100)]).objects
    const round = applyFillets(composeBaseMark(square), fillets, cornerSources(square))
    expect(round.fillets).toEqual([expect.objectContaining({ id: 'f', lost: false, used: 20, convex: true })])
    // The slab moved far off: no corner of it is near where the fillet was.
    const away = made([block('s', { x: 900, y: 0 }, 200, 100)]).objects
    const lost = applyFillets(composeBaseMark(away), fillets, cornerSources(away))
    // Lost, it draws where its circle last was, at the radius it last had.
    expect(lost.fillets).toEqual([{ id: 'f', lost: true, radius: 20, at, centre: { x: 80, y: -30 }, used: 20 }])
    expect(lost.compoundPathData).toBe(composeBaseMark(away).compoundPathData)
    const back = made([block('s', { x: 0.3, y: 0 }, 200, 100)]).objects
    expect(applyFillets(composeBaseMark(back), fillets, cornerSources(back)).fillets?.[0]).toMatchObject({ lost: false, corner: { x: 100.3, y: -50 } })
    // The mark finds a fillet only within two pixels or a quarter of its radius of its place: carrying it to where its objects moved its corner is the follow pass's.
    const near = made([block('s', { x: 4.9, y: 0 }, 200, 100)]).objects
    expect(applyFillets(composeBaseMark(near), fillets, cornerSources(near)).fillets?.[0]).toMatchObject({ lost: false })
    const aside = made([block('s', { x: 5.1, y: 0 }, 200, 100)]).objects
    expect(applyFillets(composeBaseMark(aside), fillets, cornerSources(aside)).fillets?.[0]).toMatchObject({ lost: true })
  })

  it('never lets two fillets take one corner: the nearer has it, and the other is lost', () => {
    const objects = made([block('s', { x: 0, y: 0 }, 200, 100)]).objects
    const twins = [fillet('a', { x: 100.4, y: -50 }, ['s', 's'], 10), fillet('b', { x: 100.2, y: -50 }, ['s', 's'], 10)]
    const mark = applyFillets(composeBaseMark(objects), twins, cornerSources(objects))
    expect(mark.fillets!.map((each) => [each.id, each.lost])).toEqual([['a', true], ['b', false]])
  })

  it('cuts a fillet crowding a neighbour on one short edge down to stop where the neighbour touches it, leaving no corner where their arcs meet', () => {
    // Each alone fits the slab's 30-high end at r 25; together they would cross. The one earlier in the list keeps its radius.
    const objects = made([block('s', { x: 0, y: 0 }, 200, 30)]).objects
    const ends = cornersOf(objects).filter((corner) => corner.p.x > 0)
    expect(ends).toHaveLength(2)
    const alone = applyFillets(composeBaseMark(objects), filletsOn(ends.slice(0, 1), 25), cornerSources(objects))
    expect(alone.fillets).toEqual([expect.objectContaining({ lost: false, used: 25 })])
    expect(alone.fillets![0]).not.toHaveProperty('byNeighbour')
    for (const order of [ends, [...ends].reverse()]) {
      const mark = applyFillets(composeBaseMark(objects), filletsOn(order, 25), cornerSources(objects))
      const [first, second] = mark.fillets!.flatMap((each) => (each.lost ? [] : [each]))
      expect(first.used).toBe(25)
      expect(first).not.toHaveProperty('byNeighbour')
      expect(Math.abs(second.used - 5)).toBeLessThan(0.01)
      expect(second.byNeighbour).toBe(true)
      // Where they meet on the end, both touch it at one point.
      const onEnd = [first, second].map((each) => each.touches.find((touch) => Math.abs(touch.x - 100) < 1e-6)!)
      expect(distance(onEnd[0], onEnd[1])).toBeLessThan(0.01)
      expect(inkGeometry(mark.compoundPathData).corners.filter((corner) => corner.p.x > 50)).toEqual([])
      expect(mark.warnings).toBeUndefined()
    }
  })

  it('gives a fillet whose neighbour takes the whole shared side no room, not lost, and Round all nothing from it', () => {
    // On the slab's 30-high end, the first fillet at r 30 or 40 touches the end at or past the other corner.
    const objects = made([block('s', { x: 0, y: 0 }, 200, 30)]).objects
    const ends = cornersOf(objects).filter((corner) => corner.p.x > 0)
    const top = ends.find((corner) => corner.p.y < 0)!
    const bottom = ends.find((corner) => corner.p.y > 0)!
    for (const first of [30, 40]) {
      const fillets = [fillet('a', top.p, top.between, first), fillet('b', bottom.p, bottom.between, 20)]
      const mark = applyFillets(composeBaseMark(objects), fillets, cornerSources(objects))
      expect(mark.fillets![0]).toMatchObject({ lost: false })
      // It keeps its corner, and says why it rounds nothing.
      expect(mark.fillets![1]).toMatchObject({ lost: true, noRoom: 'neighbour', at: bottom.p })
      expect(roundAllPlan(composeBaseMark(objects), fillets, cornerSources(objects), 'b')).toEqual({ corners: [], skipped: 0 })
    }
    // A fillet whose corner is gone is lost, with no word of room.
    const gone = applyFillets(composeBaseMark(objects), [fillet('c', { x: 0, y: 0 }, ['s', 's'], 10)], cornerSources(objects)).fillets![0]
    expect(gone).toMatchObject({ lost: true })
    expect(gone).not.toHaveProperty('noRoom')
  })

  it('never reaches across a narrowing: over random polygons cut by polygons, a fillet takes off no more than the triangle of its corner and touch points and its circle\'s segment', () => {
    const rand = numbers(4242)
    let rounded = 0
    for (let t = 0; t < 15; t++) {
      const objects = made([
        recipe('p', { ...polygonSpec({ x: 0, y: 0 }, 160, 5 + Math.floor(rand() * 3), rand() < 0.5 ? 0 : 10 + rand() * 30), rotation: rand() * 60 }),
        recipe('q', { ...polygonSpec({ x: 60 + rand() * 60, y: (rand() - 0.5) * 60 }, 60 + rand() * 40, 3 + Math.floor(rand() * 4), rand() < 0.5 ? 0 : 5 + rand() * 15), rotation: rand() * 60 }, 'subtract'),
      ]).objects
      const base = composeBaseMark(objects)
      const area = measure(base.compoundPathData).area
      for (const corner of cornersOf(objects)) {
        for (const radius of [4, 8, 16, 32]) {
          const mark = applyFillets(base, [fillet('f', corner.p, corner.between, radius)], cornerSources(objects))
          const resolved = mark.fillets![0]
          if (resolved.lost) continue
          rounded++
          const { centre, touches, used } = resolved
          const chord = distance(touches[0], touches[1])
          // The circle's segment beyond the chord, on the corner's side: the arc the fillet draws.
          const facing = distance(scale(add(touches[0], touches[1]), 0.5), corner.p) < distance(centre, corner.p)
          const segment = facing ? segmentArea(used, chord) : Math.PI * used * used - segmentArea(used, chord)
          const bound = polyArea([corner.p, touches[0], touches[1]]) + segment
          // The patch's band reaches 0.05 past the sides; booleans round to about a hundredth.
          const slack = 0.05 * (distance(corner.p, touches[0]) + distance(corner.p, touches[1])) + 0.5
          expect(Math.abs(measure(mark.compoundPathData).area - area)).toBeLessThan(bound + slack)
        }
      }
    }
    expect(rounded).toBeGreaterThan(200)
  })

  it('leaves no new corner beside a clamped fillet’s touch points, at random bar–circle joins and crescent tips', () => {
    const rand = numbers(17)
    let clamped = 0
    for (let t = 0; t < 24; t++) {
      const objects =
        t % 2
          ? made([circle('a', 0, 0, 100), circle('b', 30 + rand() * 80, (rand() - 0.5) * 60, 50 + rand() * 60, 'subtract')]).objects
          : made([circle('a', 0, 0, 60 + rand() * 40), circle('b', 260 + rand() * 80, (rand() - 0.5) * 80, 40 + rand() * 50), bar('bar', 'a', 'b', 20 + rand() * 30)]).objects
      const base = composeBaseMark(objects)
      const before = markGeometry(base).corners
      for (const corner of cornersOf(objects)) {
        const mark = applyFillets(base, [fillet('f', corner.p, corner.between, 60 + rand() * 140)], cornerSources(objects))
        const resolved = mark.fillets![0]
        if (resolved.lost || resolved.used === resolved.radius) continue
        clamped++
        const fresh = inkGeometry(mark.compoundPathData).corners.filter((each) => !before.some((old) => distance(old.p, each.p) < 0.5))
        expect(fresh.filter((each) => resolved.touches.some((touch) => distance(touch, each.p) < 2))).toEqual([])
      }
    }
    expect(clamped).toBeGreaterThan(20)
  })

  it('leaves a hidden fillet out, and a mark with none showing as it is', () => {
    const objects = made([block('s', { x: 0, y: 0 }, 200, 100)]).objects
    const base = composeBaseMark(objects)
    expect(applyFillets(base, [{ ...fillet('f', { x: 100, y: -50 }, ['s', 's'], 20), visible: false }], cornerSources(objects))).toBe(base)
  })

  it('offers the corners with no fillet on them, and Round all the others of the same kind and turn', () => {
    const hexagon = recipe('hex', polygonSpec({ x: 0, y: 0 }, 370, 6, 60))
    const inset = recipe('inset', polygonSpec({ x: 0, y: 0 }, 370 - 55 / Math.cos(Math.PI / 6), 6, 5), 'subtract')
    const triangle = recipe('tri', { ...polygonSpec({ x: 0, y: 0 }, 370, 3), rotation: 180 })
    const objects = made([hexagon, inset, triangle]).objects
    const base = composeBaseMark(objects)
    const sources = cornerSources(objects)
    const hole = cornersOf(objects).find((each) => cornerKind(each) === 'cut polygon · polygon')!
    const one = [fillet('f', hole.p, hole.between, 5)]
    expect(freeCorners(base, one, sources)).not.toContainEqual(expect.objectContaining({ p: hole.p }))
    expect(freeCorners(base, one, sources)).toHaveLength(cornersOf(objects).length - 1)
    const like = cornersLike(base, one, sources, 'f')
    expect(like).toHaveLength(5)
    expect(like.every((each) => cornerKind(each) === 'cut polygon · polygon' && !each.convex)).toBe(true)
    // With all six rounded, none is left like them.
    const all = [...one, ...filletsOn(like, 5).map((each) => ({ ...each, id: `${each.id}-all` }))]
    expect(cornersLike(base, all, sources, 'f')).toEqual([])
    expect(applyFillets(base, all, sources).fillets!.every((each) => !each.lost)).toBe(true)
  })
})

describe('the mark with its fillets', () => {
  function documentOf(objects: VectorObject[], fillets: Fillet[]): VectorDocument {
    return { ...createEmptyVectorDocument(), objects, fillets }
  }

  it('keeps the base mark when only a fillet changes, and composes the fillet pass again', () => {
    const objects = made([block('s', { x: 0, y: 0 }, 200, 100)]).objects
    const base = composeBaseMark(objects)
    const small = documentOf(objects, [fillet('f', { x: 100, y: -50 }, ['s', 's'], 10)])
    const large = documentOf(objects, [fillet('f', { x: 100, y: -50 }, ['s', 's'], 30)])
    const first = composeVectorMarkCached(small)
    const second = composeVectorMarkCached(large)
    expect(composeBaseMark(objects)).toBe(base)
    expect(first).not.toBe(second)
    expect(measure(first.compoundPathData).area - measure(second.compoundPathData).area).toBeCloseTo((1 - Math.PI / 4) * (900 - 100), 0)
    // The same fillets again, or a document with none, cost nothing more.
    expect(composeVectorMarkCached({ ...small })).toBe(first)
    expect(composeVectorMarkCached(documentOf(objects, []))).toBe(base)
  })

  it('is what a document with fillets composes to afresh', async () => {
    const { composeVectorMark } = await import('../vector/export.ts')
    const objects = made([block('s', { x: 0, y: 0 }, 200, 100)]).objects as PathObject[]
    const document = documentOf(objects, [fillet('f', { x: -100, y: 50 }, ['s', 's'], 25)])
    expect(composeVectorMark(document).compoundPathData).toBe(composeVectorMarkCached(document).compoundPathData)
  })
})
