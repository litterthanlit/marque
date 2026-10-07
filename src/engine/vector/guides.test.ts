import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec, type PolygonSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { circleContour, clipLine, closedContourOf, constructionLines, constructionShape, guideRows, lineAngle, makeGuide, moveGuideShape, nearestOnGuide, respokeGuides, sameGuideShape, tangentFrame } from './guides.ts'
import type { ConstructionRole, Contour, Guide } from './types.ts'

const recipe = (carve: CarveSpec) => ({ carve, contours: [segsToContour(carveOutline(carve).segs)] })
const roles = (source: Parameters<typeof constructionLines>[0]) => constructionLines(source).map((line) => line.role)

describe('construction lines of a shape', () => {
  it('gives a circle its centre lines, its bounds and itself', () => {
    const circle = recipe({ ...slabSpec('circle'), center: { x: 10, y: 20 } })
    expect(roles(circle)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle'])
    expect(constructionShape(circle, 'centre-x')).toEqual({ kind: 'line', p: { x: 10, y: 20 }, angle: 90 })
    expect(constructionShape(circle, 'centre-y')).toEqual({ kind: 'line', p: { x: 10, y: 20 }, angle: 0 })
    expect(constructionShape(circle, 'top')).toEqual({ kind: 'line', p: { x: 10, y: -180 }, angle: 0 })
    expect(constructionShape(circle, 'right')).toEqual({ kind: 'line', p: { x: 210, y: 20 }, angle: 90 })
    expect(constructionShape(circle, 'circumcircle')).toEqual({ kind: 'circle', c: { x: 10, y: 20 }, r: 200 })
    expect(constructionShape(circle, 'incircle')).toEqual({ kind: 'circle', c: { x: 10, y: 20 }, r: 200 })
    expect(constructionShape(circle, 'axis-0')).toBeNull()
  })

  it("gives a slab the circles through and inside its sharp corners, and its two diagonals", () => {
    const slab = recipe({ ...slabSpec('rounded'), width: 300, height: 400 })
    expect(roles(slab)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle', 'incircle', 'axis-0', 'axis-1'])
    expect(constructionShape(slab, 'circumcircle')).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 250 })
    expect(constructionShape(slab, 'incircle')).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 150 })
    const diagonal = constructionShape(slab, 'axis-0')
    expect(diagonal?.kind).toBe('line')
    if (diagonal?.kind === 'line') expect(diagonal.angle).toBeCloseTo(lineAngle((Math.atan2(-200, -150) * 180) / Math.PI), 9)
  })

  it('gives a triangle punch a spoke through each corner, but its upright centre line only once, and its circles', () => {
    const triangle = recipe({ v: 1, kind: 'punch', shape: 'triangle', center: { x: 0, y: 0 }, radius: 80, rotation: 0 })
    // The spoke through its top corner is its upright centre line: offered once, as the centre line.
    expect(constructionShape(triangle, 'axis-0')).toEqual({ kind: 'line', p: { x: 0, y: 0 }, angle: 90 })
    const lines = constructionLines(triangle)
    expect(lines).toHaveLength(10)
    expect(lines.map((line) => line.role).filter((role) => role.startsWith('axis'))).toEqual(['axis-1', 'axis-2'])
    // Spokes are counted among those offered, with no gaps, and keep their names as the triangle turns.
    expect(lines.filter((line) => line.role.startsWith('axis')).map((line) => line.name)).toEqual(['Spoke 1', 'Spoke 2'])
    for (const [i, line] of lines.entries()) {
      for (const other of lines.slice(i + 1)) expect(sameGuideShape(line.shape, other.shape)).toBe(false)
    }
    // Turned, the triangle's centre line turns with it, and still runs through its first corner.
    const turned = recipe({ v: 1, kind: 'punch', shape: 'triangle', center: { x: 0, y: 0 }, radius: 80, rotation: 30 })
    expect(constructionLines(turned)).toHaveLength(10)
    for (let rotation = 0; rotation < 120; rotation += 5) {
      const spokes = constructionLines(recipe({ v: 1, kind: 'punch', shape: 'triangle', center: { x: 0, y: 0 }, radius: 80, rotation }))
        .filter((line) => line.role.startsWith('axis'))
        .map((line) => [line.role, line.name])
      expect(spokes).toEqual([
        ['axis-1', 'Spoke 1'],
        ['axis-2', 'Spoke 2'],
      ])
    }
    expect(constructionShape(triangle, 'circumcircle')).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 100 })
    expect(constructionShape(triangle, 'incircle')).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 50 })
  })

  it('offers a line or circle once when another role already gives it to within a hundredth', () => {
    // A fine polygon: its incircle lies a thousandth or so inside its circumcircle.
    const points = Array.from({ length: 100 }, (_, i) => ({ x: 3 * Math.cos((i * Math.PI) / 50), y: 3 * Math.sin((i * Math.PI) / 50) }))
    const fine: Contour = { closed: true, segments: points.map((point) => ({ point, handleIn: null, handleOut: null })) }
    expect(constructionShape({ contours: [fine] }, 'incircle')).not.toBeNull()
    expect(roles({ contours: [fine] })).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle'])
  })

  it('gives a square punch its two diagonals, opposite corners counted once', () => {
    const square = recipe({ v: 1, kind: 'punch', shape: 'square', center: { x: 0, y: 0 }, radius: 40, rotation: 0 })
    expect(roles(square).filter((role) => role.startsWith('axis'))).toEqual(['axis-0', 'axis-1'])
  })

  it("gives a free path that is no regular polygon circles about the middle of its bounds: through its farthest anchor, and touching the nearest point of its outline", () => {
    const contour: Contour = {
      closed: true,
      segments: [
        { point: { x: -100, y: -50 }, handleIn: null, handleOut: null },
        { point: { x: 100, y: -50 }, handleIn: null, handleOut: null },
        { point: { x: 0, y: 20 }, handleIn: null, handleOut: null },
        { point: { x: 100, y: 50 }, handleIn: null, handleOut: null },
        { point: { x: -100, y: 50 }, handleIn: null, handleOut: null },
      ],
    }
    const free = { contours: [contour] }
    expect(roles(free)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle', 'incircle'])
    expect(constructionShape(free, 'circumcircle')).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: Math.hypot(100, 50) })
    // The notch's side from (100, -50) to (0, 20) passes closest to the middle.
    const incircle = constructionShape(free, 'incircle')
    expect(incircle?.kind === 'circle' && incircle.c).toEqual({ x: 0, y: 0 })
    expect(incircle?.kind === 'circle' && incircle.r).toBeCloseTo(2000 / Math.hypot(100, 70), 6)
  })

  it('gives a free regular polygon, as sparks and the pen draw them, the circles through its corners and touching its sides, about its own centre', () => {
    const polygon = (n: number): Contour => ({
      closed: true,
      segments: Array.from({ length: n }, (_, i) => ({ point: { x: 100 * Math.sin((2 * Math.PI * i) / n), y: -100 * Math.cos((2 * Math.PI * i) / n) }, handleIn: null, handleOut: null })),
    })
    for (const [n, apothem] of [
      [3, 50],
      [4, 100 / Math.SQRT2],
      [6, 50 * Math.sqrt(3)],
    ]) {
      const free = { contours: [polygon(n)] }
      expect(roles(free)).toContain('incircle')
      const circum = constructionShape(free, 'circumcircle')
      const inner = constructionShape(free, 'incircle')
      if (circum?.kind !== 'circle' || inner?.kind !== 'circle') throw new Error('no circles')
      expect(circum.c.x).toBeCloseTo(0, 6)
      expect(circum.c.y).toBeCloseTo(0, 6)
      expect(circum.r).toBeCloseTo(100, 6)
      expect(inner.c).toEqual(circum.c)
      expect(inner.r).toBeCloseTo(apothem, 4)
    }
  })

  it('gives a free shape whose centre lies outside it no incircle', () => {
    const bent: Contour = {
      closed: true,
      segments: [
        { point: { x: -100, y: -100 }, handleIn: null, handleOut: null },
        { point: { x: 100, y: -100 }, handleIn: null, handleOut: null },
        { point: { x: 100, y: -80 }, handleIn: null, handleOut: null },
        { point: { x: -80, y: -80 }, handleIn: null, handleOut: null },
        { point: { x: -80, y: 100 }, handleIn: null, handleOut: null },
        { point: { x: -100, y: 100 }, handleIn: null, handleOut: null },
      ],
    }
    expect(roles({ contours: [bent] })).not.toContain('incircle')
    expect(constructionShape({ contours: [bent] }, 'incircle')).toBeNull()
  })

  it("measures a turned slab in its own frame: its bounds and centre lines run along its sides", () => {
    const strip = recipe({ ...slabSpec('square'), width: 120, height: 230, radius: 0, rotation: -30, center: { x: 10, y: 20 } })
    const line = (role: Parameters<typeof constructionShape>[1]) => {
      const shape = constructionShape(strip, role)
      if (shape?.kind !== 'line') throw new Error(`no line for ${role}`)
      return shape
    }
    expect(line('centre-y')).toEqual({ kind: 'line', p: { x: 10, y: 20 }, angle: 150 })
    expect(line('centre-x')).toEqual({ kind: 'line', p: { x: 10, y: 20 }, angle: 60 })
    // The long sides run at 60°, 60 units either side of the centre.
    for (const [role, side] of [
      ['left', -60],
      ['right', 60],
    ] as const) {
      const { p, angle } = line(role)
      expect(angle).toBe(60)
      const across = { x: Math.cos((-30 * Math.PI) / 180), y: Math.sin((-30 * Math.PI) / 180) }
      expect((p.x - 10) * across.x + (p.y - 20) * across.y).toBeCloseTo(side, 6)
    }
    const top = line('top')
    expect(top.angle).toBe(150)
    expect(Math.hypot(top.p.x - 10, top.p.y - 20)).toBeCloseTo(115, 6)
  })

  it('measures a slab turned by a quarter in its own frame, names its lines where they lie, and measures a circle always upright', () => {
    const turned = recipe({ ...slabSpec('square'), width: 100, height: 200, rotation: 90 })
    const top = constructionShape(turned, 'top')
    if (top?.kind !== 'line') throw new Error('no line')
    // Its own top, 100 from the centre, is now the line on its right.
    expect(top.angle).toBe(90)
    expect(top.p.x).toBeCloseTo(100, 9)
    expect(top.p.y).toBeCloseTo(0, 9)
    // Each line is named where it lies on screen: its own top is the line on the right, its upright centre line now flat.
    expect(constructionLines(turned).map((line) => [line.role, line.name]).slice(0, 6)).toEqual([
      ['centre-x', 'Centre ↔'],
      ['centre-y', 'Centre ↕'],
      ['top', 'Right'],
      ['right', 'Bottom'],
      ['bottom', 'Left'],
      ['left', 'Top'],
    ])
    const circle = recipe({ ...slabSpec('circle'), rotation: 20 })
    expect(constructionShape(circle, 'top')).toEqual({ kind: 'line', p: { x: 0, y: -200 }, angle: 0 })
  })

  it('keeps each role on the same side of a slab as it turns past 45°', () => {
    for (const rotation of [40, 44, 46, 50, 89, 91, 135]) {
      const slab = recipe({ ...slabSpec('square'), width: 120, height: 230, rotation, center: { x: 5, y: -5 } })
      const top = constructionShape(slab, 'top')
      const right = constructionShape(slab, 'right')
      if (top?.kind !== 'line' || right?.kind !== 'line') throw new Error('no line')
      expect(top.angle).toBeCloseTo(lineAngle(rotation), 9)
      expect(Math.hypot(top.p.x - 5, top.p.y + 5)).toBeCloseTo(115, 6)
      expect(right.angle).toBeCloseTo(lineAngle(rotation + 90), 9)
      expect(Math.hypot(right.p.x - 5, right.p.y + 5)).toBeCloseTo(60, 6)
    }
  })

  it('keeps every role on the same side of a slab, read as the live preview reads it, as it turns from 0° to 90° in 5° steps', () => {
    const spec = { ...slabSpec('square'), width: 120, height: 230, radius: 0, center: { x: 5, y: -5 } }
    const sides: Array<[ConstructionRole, number, number]> = [
      ['top', 0, -115],
      ['bottom', 0, 115],
      ['left', -60, 0],
      ['right', 60, 0],
    ]
    for (let rotation = 0; rotation <= 90; rotation += 5) {
      // As the preview of a turn reads its source: the live recipe, no contours.
      const source = { carve: { ...spec, rotation }, contours: [] }
      for (const [role, x, y] of sides) {
        const shape = constructionShape(source, role)
        if (shape?.kind !== 'line') throw new Error(`no line for ${role}`)
        // The line through the side's own middle, turned with the slab, along that side.
        const t = (rotation * Math.PI) / 180
        const middle = { x: 5 + x * Math.cos(t) - y * Math.sin(t), y: -5 + x * Math.sin(t) + y * Math.cos(t) }
        expect(shape.angle).toBeCloseTo(lineAngle(rotation + (x === 0 ? 0 : 90)), 6)
        expect(nearestOnGuide(shape, middle).distance).toBeCloseTo(0, 6)
      }
    }
  })

  it('keeps each role on the same side of a channel as its end goes past 45°', () => {
    for (const deg of [40, 50, 130]) {
      const to = { x: 200 * Math.cos((deg * Math.PI) / 180), y: 200 * Math.sin((deg * Math.PI) / 180) }
      const channel = recipe({ v: 1, kind: 'channel', from: { x: 0, y: 0 }, to, width: 20 })
      const top = constructionShape(channel, 'top')
      if (top?.kind !== 'line') throw new Error('no line')
      // Along its side, half its width from its spine.
      expect(top.angle).toBeCloseTo(lineAngle(deg), 9)
      expect(Math.abs((top.p.x - to.x / 2) * -Math.sin((deg * Math.PI) / 180) + (top.p.y - to.y / 2) * Math.cos((deg * Math.PI) / 180))).toBeCloseTo(10, 6)
    }
  })

  it("measures a free shape in its frame when it has been turned", () => {
    const corners = [
      { x: -50, y: -100 },
      { x: 50, y: -100 },
      { x: 50, y: 100 },
      { x: -50, y: 100 },
    ].map((p) => ({ x: p.x * Math.cos(Math.PI / 4) - p.y * Math.sin(Math.PI / 4), y: p.x * Math.sin(Math.PI / 4) + p.y * Math.cos(Math.PI / 4) }))
    const contour: Contour = { closed: true, segments: corners.map((point) => ({ point, handleIn: null, handleOut: null })) }
    const turned = { contours: [contour], frame: { rotation: 45 } }
    const right = constructionShape(turned, 'right')
    if (right?.kind !== 'line') throw new Error('no line')
    expect(right.angle).toBe(135)
    expect(Math.hypot(right.p.x, right.p.y)).toBeCloseTo(50, 6)
    // Without its frame, the same shape is measured upright.
    expect(constructionShape({ contours: [contour] }, 'right')).toMatchObject({ angle: 90 })
  })

  it('names a groove\'s lines where they lie, whichever way it was drawn', () => {
    const named = (from: { x: number; y: number }, to: { x: number; y: number }) =>
      Object.fromEntries(
        constructionLines(recipe({ v: 1, kind: 'channel', from, to, width: 40 })).map((line) => {
          if (line.shape.kind !== 'line') throw new Error('no line')
          return [line.name, { p: { x: Math.round(line.shape.p.x) + 0, y: Math.round(line.shape.p.y) + 0 }, angle: Math.round(line.shape.angle) }]
        }),
      )
    const upright = { 'Centre ↕': { p: { x: 0, y: 0 }, angle: 90 }, 'Centre ↔': { p: { x: 0, y: 0 }, angle: 0 } }
    // Drawn upward: its spine is the upright centre line, its sides left and right, its ends top and bottom.
    const up = named({ x: 0, y: 120 }, { x: 0, y: -120 })
    expect(up).toMatchObject(upright)
    expect(up['Left'].p.x).toBe(-20)
    expect(up['Right'].p.x).toBe(20)
    expect(up['Top'].p.y).toBeLessThan(-120)
    expect(up['Bottom'].p.y).toBeGreaterThan(120)
    // Drawn downward, the same names in the same places.
    expect(named({ x: 0, y: -120 }, { x: 0, y: 120 })).toEqual(up)
    // Drawn leftward: its spine is the flat centre line, its sides top and bottom.
    const left = named({ x: 100, y: 0 }, { x: -100, y: 0 })
    expect(left).toMatchObject(upright)
    expect(left['Top'].p.y).toBe(-20)
    expect(left['Bottom'].p.y).toBe(20)
    expect(left['Left'].p.x).toBeLessThan(-100)
    expect(left['Right'].p.x).toBeGreaterThan(100)
    expect(named({ x: -100, y: 0 }, { x: 100, y: 0 })).toEqual(left)
  })

  it('measures a slice by its spine, not by its reach past the canvas', () => {
    const slice = recipe({ v: 1, kind: 'slice', from: { x: -50, y: 0 }, to: { x: 50, y: 0 }, width: 20 })
    expect(roles(slice)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left'])
    expect(constructionShape(slice, 'right')).toEqual({ kind: 'line', p: { x: 60, y: 0 }, angle: 90 })
  })
})

describe("a polygon's spokes through a new count of sides", () => {
  const polygon = (sides: number, rotation = 0) => ({
    id: 'p',
    ...recipe({ v: 1, kind: 'polygon', center: { x: 40, y: -30 }, sides, radius: 200, rotation, cornerRadius: 30 } satisfies PolygonSpec),
  })
  const construction = (source: ReturnType<typeof polygon>): Guide[] =>
    constructionLines(source).map(({ role, shape, name }) => makeGuide(shape, 'dashed', { kind: 'construction', of: source.id, role }, name))
  const spokeRoles = (guides: Guide[]) => guides.filter((guide) => guide.link?.role.startsWith('axis-')).map((guide) => guide.link!.role)
  /** Steps through the counts, one at a time, as [ and ] do. */
  const walk = (guides: Guide[], counts: number[], rotation = 0) => counts.slice(1).reduce((list, sides) => respokeGuides(list, polygon(sides, rotation)), guides)

  it("gives a square no spoke guides, its spokes being its centre lines, and gives them back when it gains or loses a side, at any turn", () => {
    for (const rotation of [0, 17]) {
      const hexagon = construction(polygon(6, rotation))
      const square = walk(hexagon, [6, 5, 4], rotation)
      expect(spokeRoles(square)).toEqual([])
      expect(spokeRoles(walk(hexagon, [6, 5, 4, 3], rotation))).toEqual(['axis-1', 'axis-2'])
      const back = walk(hexagon, [6, 5, 4, 3, 4, 5, 6], rotation)
      expect(spokeRoles(back)).toEqual(['axis-1', 'axis-2'])
      for (const role of ['axis-1', 'axis-2'] as const) {
        const guide = back.find((each) => each.link?.role === role)!
        expect(sameGuideShape(guide.shape, constructionShape(polygon(6, rotation), role)!)).toBe(true)
        expect(guide.style).toBe('dashed')
      }
      // The spokes come in after the shape's last guide when there are none to take the place of.
      expect(back.slice(-2).map((guide) => guide.link!.role)).toEqual(['axis-1', 'axis-2'])
    }
  })

  it('gives a heptagon its upright spoke when its upright centre line was taken off', () => {
    const hexagon = construction(polygon(6)).filter((guide) => guide.link?.role !== 'centre-x')
    expect(spokeRoles(walk(hexagon, [6, 7]))).toEqual(['axis-0', 'axis-1', 'axis-2', 'axis-3', 'axis-4', 'axis-5', 'axis-6'])
    expect(spokeRoles(walk(construction(polygon(6)), [6, 7]))).toEqual(['axis-1', 'axis-2', 'axis-3', 'axis-4', 'axis-5', 'axis-6'])
  })

  it('makes the spokes again from a circle of the polygon when its spokes were taken off, in the look of that circle', () => {
    const circles = construction(polygon(6))
      .filter((guide) => !guide.link?.role.startsWith('axis-'))
      .map((guide) => (guide.link?.role === 'incircle' ? { ...guide, style: 'solid' as const, locked: true } : guide))
      .filter((guide) => guide.link?.role !== 'circumcircle')
    const heptagon = respokeGuides(circles, polygon(7))
    expect(spokeRoles(heptagon)).toEqual(['axis-1', 'axis-2', 'axis-3', 'axis-4', 'axis-5', 'axis-6'])
    expect(heptagon.filter((guide) => guide.link?.role.startsWith('axis-')).every((guide) => guide.style === 'solid' && guide.locked)).toBe(true)
  })

  it('gives no spokes to a polygon whose circles and spokes were all taken off, nor to one with no guides', () => {
    const plain = construction(polygon(6)).filter((guide) => !/^(axis-|circumcircle|incircle)/.test(guide.link?.role ?? ''))
    expect(respokeGuides(plain, polygon(7))).toBe(plain)
    const none: Guide[] = []
    expect(respokeGuides(none, polygon(5))).toBe(none)
  })

  it('names the spokes in order among those it keeps, with no gaps', () => {
    const names = (guides: Guide[]) => guides.filter((guide) => guide.link?.role.startsWith('axis-')).map((guide) => guide.name)
    expect(names(construction(polygon(6)))).toEqual(['Spoke 1', 'Spoke 2'])
    expect(names(walk(construction(polygon(6)), [6, 7, 8]))).toEqual(['Spoke 1', 'Spoke 2'])
    expect(names(walk(construction(polygon(6)), [6, 7]))).toEqual(['Spoke 1', 'Spoke 2', 'Spoke 3', 'Spoke 4', 'Spoke 5', 'Spoke 6'])
  })
})

describe('a frame touching circles', () => {
  it('touches the highest, rightmost, lowest and leftmost circle from outside, linked to each', () => {
    const frame = tangentFrame([
      { id: 'a', circle: { c: { x: -100, y: -80 }, r: 100 } },
      { id: 'b', circle: { c: { x: -60, y: 130 }, r: 65 } },
      { id: 'c', circle: { c: { x: 160, y: 130 }, r: 65 } },
    ])
    expect(frame).toEqual([
      { of: 'a', role: 'top', shape: { kind: 'line', p: { x: -100, y: -180 }, angle: 0 } },
      { of: 'c', role: 'right', shape: { kind: 'line', p: { x: 225, y: 130 }, angle: 90 } },
      { of: 'b', role: 'bottom', shape: { kind: 'line', p: { x: -60, y: 195 }, angle: 0 } },
      { of: 'a', role: 'left', shape: { kind: 'line', p: { x: -200, y: -80 }, angle: 90 } },
    ])
    // Each line is the matching bounds line of its circle, so following it keeps it touching.
    for (const line of frame) {
      const circle = { carve: { ...slabSpec('circle'), center: line.of === 'a' ? { x: -100, y: -80 } : line.of === 'b' ? { x: -60, y: 130 } : { x: 160, y: 130 }, width: line.of === 'a' ? 200 : 130, height: line.of === 'a' ? 200 : 130, radius: line.of === 'a' ? 100 : 65 }, contours: [] }
      expect(constructionShape(circle, line.role)).toEqual(line.shape)
    }
  })
})

describe('guide geometry', () => {
  it('keeps a line angle in [0, 180)', () => {
    expect(lineAngle(180)).toBe(0)
    expect(lineAngle(-60)).toBe(120)
    expect(lineAngle(420)).toBe(60)
  })

  it('clips an infinite line to a rectangle, or misses it', () => {
    const rect = { minX: -100, minY: -100, maxX: 100, maxY: 100 }
    expect(clipLine({ x: 0, y: 50 }, 0, rect)).toEqual([{ x: -100, y: 50 }, { x: 100, y: 50 }])
    const diagonal = clipLine({ x: 0, y: 0 }, 45, rect)!
    expect(diagonal[0].x).toBeCloseTo(-100, 9)
    expect(diagonal[1].y).toBeCloseTo(100, 9)
    expect(clipLine({ x: 0, y: 150 }, 0, rect)).toBeNull()
  })

  it('measures how far a point is from a line, a circle and a path', () => {
    expect(nearestOnGuide({ kind: 'line', p: { x: 0, y: 0 }, angle: 90 }, { x: 3, y: 40 })).toEqual({ point: { x: 0, y: 40 }, distance: 3 })
    expect(nearestOnGuide({ kind: 'circle', c: { x: 0, y: 0 }, r: 10 }, { x: 0, y: 14 }).distance).toBeCloseTo(4, 9)
    expect(nearestOnGuide({ kind: 'path', contour: circleContour({ x: 0, y: 0 }, 10) }, { x: 14, y: 0 }).distance).toBeCloseTo(4, 6)
  })

  it('moves a guide and stores where it lands to hundredths', () => {
    expect(moveGuideShape({ kind: 'line', p: { x: -155.8940518, y: 0 }, angle: 60 }, { x: 0, y: 20.0000323 })).toEqual({ kind: 'line', p: { x: -155.89, y: 20 }, angle: 60 })
    expect(moveGuideShape({ kind: 'circle', c: { x: 10, y: 0 }, r: 65.4321 }, { x: 20.0000141, y: 0 })).toEqual({ kind: 'circle', c: { x: 30, y: 0 }, r: 65.4321 })
  })

  it('makes a shape only of a closed path of three segments or more, or a circle', () => {
    const point = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
    const lens: Contour = { closed: true, segments: [point(-100, 0), point(100, 0)] }
    expect(closedContourOf({ kind: 'path', contour: lens })).toBeNull()
    expect(closedContourOf({ kind: 'path', contour: { closed: false, segments: [point(0, 0), point(10, 0), point(0, 10)] } })).toBeNull()
    expect(closedContourOf({ kind: 'path', contour: { closed: true, segments: [point(0, 0), point(10, 0), point(0, 10)] } })).not.toBeNull()
    expect(closedContourOf({ kind: 'circle', c: { x: 0, y: 0 }, r: 10 })).not.toBeNull()
    expect(closedContourOf({ kind: 'line', p: { x: 0, y: 0 }, angle: 0 })).toBeNull()
  })
})

describe("the drawer's guide rows", () => {
  const guide = (id: string, shape: Guide['shape'], name: string, link?: Guide['link']): Guide => ({ id, name, visible: true, locked: false, style: 'solid', shape, ...(link ? { link } : {}) })

  it('lead with what tells guides apart: a role and the shape it follows, or a kind and measure numbered among its kind', () => {
    const rows = guideRows(
      [
        guide('a', { kind: 'line', p: { x: 0, y: 0 }, angle: 90 }, 'Centre ↕', { kind: 'construction', of: 's', role: 'centre-x' }),
        guide('b', { kind: 'line', p: { x: 0, y: 0 }, angle: 60 }, 'Line'),
        guide('c', { kind: 'line', p: { x: 50, y: 0 }, angle: 60 }, 'Line'),
        guide('d', { kind: 'circle', c: { x: 0, y: 0 }, r: 65 }, 'Circle'),
      ],
      (id) => (id === 's' ? '03' : null),
    )
    expect(rows.map(({ label, tag }) => [label, tag])).toEqual([
      ['Centre ↕', '03'],
      ['Line 60°', '1'],
      ['Line 60°', '2'],
      ['Circle r 65', null],
    ])
    expect(rows[0].title).toBe('Centre ↕ · 90° · follows 03')
    expect(rows[2].title).toBe('Line 2 · 60°')
  })

  it('number guides that follow the same shape by the same role, so no two rows read the same', () => {
    const top = { kind: 'construction' as const, of: 's', role: 'top' as const }
    const rows = guideRows(
      [
        guide('a', { kind: 'line', p: { x: 0, y: -100 }, angle: 0 }, 'Top', top),
        guide('b', { kind: 'line', p: { x: 0, y: -100 }, angle: 0 }, 'Top', top),
        guide('c', { kind: 'line', p: { x: 0, y: -100 }, angle: 0 }, 'Top', { ...top, of: 't' }),
      ],
      (id) => (id === 's' ? '03' : '04'),
    )
    expect(rows.map(({ label, tag }) => [label, tag])).toEqual([
      ['Top', '03 · 1'],
      ['Top', '03 · 2'],
      ['Top', '04'],
    ])
    expect(rows[1].title).toBe('Top 2 · 0° · follows 03')
  })
})
