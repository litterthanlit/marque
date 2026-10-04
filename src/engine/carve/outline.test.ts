import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { cubicPoint, length, projectOnCubic, rotate, sub, type Vec } from '../path/bezier.ts'
import { applyLayerTransform } from '../illustrator/compose.ts'
import { bendCarve, dragCarveHandle, foldTransform, locateCarveGrab } from './edit.ts'
import { carveOutline, grooveSpine, outlineBounds } from './outline.ts'
import { slabSpec, type CarveSpec, type GrooveSpec, type SlabSpec } from './spec.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function item(pathData: string): paper.PathItem {
  scope.activate()
  return scope.PathItem.create(pathData)
}

/** paper.d.ts only declares `area` on Path and CompoundPath. */
function areaOf(shape: paper.PathItem): number {
  return Math.abs((shape as unknown as { area: number }).area)
}

/** Area of the symmetric difference of two shapes. */
function differenceArea(a: paper.PathItem, b: paper.PathItem): number {
  scope.activate()
  return areaOf(a.subtract(b, { insert: false })) + areaOf(b.subtract(a, { insert: false }))
}

function legacyBar(from: Vec, to: Vec, width: number, roundEnds: boolean): paper.PathItem {
  scope.activate()
  const a = new scope.Point(from.x, from.y)
  const b = new scope.Point(to.x, to.y)
  const r = width / 2
  const normal = b.subtract(a).normalize(r).rotate(90, new scope.Point(0, 0))
  const body = new scope.Path({
    segments: [a.add(normal), b.add(normal), b.subtract(normal), a.subtract(normal)],
    closed: true,
    insert: false,
  })
  if (!roundEnds) return body
  return body
    .unite(new scope.Path.Circle({ center: a, radius: r, insert: false }), { insert: false })
    .unite(new scope.Path.Circle({ center: b, radius: r, insert: false }), { insert: false })
}

function expectSameShape(spec: CarveSpec, legacy: paper.PathItem): void {
  const generated = item(carveOutline(spec).pathData)
  const area = areaOf(legacy)
  expect(Math.abs(areaOf(generated) - area) / area).toBeLessThan(0.001)
  expect(differenceArea(generated, legacy)).toBeLessThan(1)
}

describe('carveOutline matches the shapes carving made before recipes', () => {
  it('square, rounded, circle and tall slabs', () => {
    scope.activate()
    expectSameShape(slabSpec('square'), new scope.Path.Rectangle({ point: [-190, -190], size: [380, 380], insert: false }))
    expectSameShape(
      slabSpec('rounded'),
      new scope.Path.Rectangle({ point: [-190, -190], size: [380, 380], radius: 90, insert: false }),
    )
    expectSameShape(slabSpec('circle'), new scope.Path.Circle({ center: [0, 0], radius: 200, insert: false }))
    expectSameShape(
      slabSpec('tall'),
      new scope.Path.Rectangle({ point: [-125, -215], size: [250, 430], radius: 125, insert: false }),
    )
  })

  it('punches', () => {
    scope.activate()
    const center = { x: 37, y: -12 }
    expectSameShape(
      { v: 1, kind: 'punch', shape: 'circle', center, radius: 48, rotation: 0 },
      new scope.Path.Circle({ center: [37, -12], radius: 48, insert: false }),
    )
    expectSameShape(
      { v: 1, kind: 'punch', shape: 'square', center, radius: 48, rotation: 0 },
      new scope.Path.Rectangle({ point: [37 - 48, -12 - 48], size: [96, 96], insert: false }),
    )
    expectSameShape(
      { v: 1, kind: 'punch', shape: 'triangle', center, radius: 48, rotation: 0 },
      new scope.Path.RegularPolygon({ center: [37, -12], sides: 3, radius: 60, insert: false }),
    )
  })

  it('channels and slices', () => {
    const from = { x: -120, y: 40 }
    const to = { x: 90, y: -70 }
    expectSameShape({ v: 1, kind: 'channel', from, to, width: 44 }, legacyBar(from, to, 44, true))
    // Slices reach 4000 past each end; compare only near the artboard.
    const slice = item(carveOutline({ v: 1, kind: 'slice', from, to, width: 30 }).pathData)
    const dir = sub(to, from)
    const len = length(dir)
    const e = { x: dir.x / len, y: dir.y / len }
    const legacy = legacyBar(
      { x: from.x - e.x * 4000, y: from.y - e.y * 4000 },
      { x: to.x + e.x * 4000, y: to.y + e.y * 4000 },
      30,
      false,
    )
    // An 8000-unit bar: compare relative to its area.
    expect(differenceArea(slice, legacy) / areaOf(legacy)).toBeLessThan(1e-4)
  })
})

describe('outline structure', () => {
  const specs: CarveSpec[] = [
    slabSpec('square'),
    slabSpec('rounded'),
    slabSpec('circle'),
    slabSpec('tall'),
    { ...slabSpec('rounded'), sides: { top: { a1: 0.1, o1: 40, a2: -0.05, o2: 30 } }, corners: { br: { k1: 1.6, k2: 0.7 } } },
    { v: 1, kind: 'punch', shape: 'triangle', center: { x: 0, y: 0 }, radius: 50, rotation: 15, sides: { s1: { a1: 0, o1: 20, a2: 0, o2: 20 } } },
    { v: 1, kind: 'channel', from: { x: -100, y: 0 }, to: { x: 100, y: 0 }, width: 40, bend: { a1: 0, o1: 60, a2: 0, o2: 60 } },
    { v: 1, kind: 'slice', from: { x: -100, y: 0 }, to: { x: 100, y: 20 }, width: 24, bend: { a1: 0, o1: -50, a2: 0, o2: 30 } },
  ]

  it('is always one closed path with no zero-length curves', () => {
    for (const spec of specs) {
      const generated = item(carveOutline(spec).pathData)
      const paths = generated instanceof scope.CompoundPath ? (generated.children as paper.Path[]) : [generated as paper.Path]
      expect(paths).toHaveLength(1)
      expect(paths[0].closed).toBe(true)
      for (const curve of paths[0].curves) expect(curve.length).toBeGreaterThan(1e-3)
    }
  })

  it('emits only the anchors a shape needs', () => {
    expect(carveOutline(slabSpec('square')).segs).toHaveLength(4)
    expect(carveOutline(slabSpec('circle')).segs).toHaveLength(4)
    expect(carveOutline(slabSpec('tall')).segs).toHaveLength(6)
    expect(carveOutline(slabSpec('rounded')).segs).toHaveLength(8)
  })

  it('clamps the radius to half the shorter side', () => {
    const big: SlabSpec = { ...slabSpec('rounded'), radius: 1000 }
    const half: SlabSpec = { ...slabSpec('rounded'), radius: 190 }
    expect(carveOutline(big).pathData).toBe(carveOutline(half).pathData)
  })

  it('rotation equals rotating the unrotated outline', () => {
    const base: SlabSpec = { ...slabSpec('rounded'), center: { x: 20, y: 10 }, sides: { left: { a1: 0, o1: 25, a2: 0, o2: 10 } } }
    const turned = carveOutline({ ...base, rotation: 30 })
    const flat = carveOutline(base)
    flat.segs.forEach((seg, i) => {
      const expected = { x: 20 + rotate(sub(seg.p, base.center), 30).x, y: 10 + rotate(sub(seg.p, base.center), 30).y }
      expect(turned.segs[i].p.x).toBeCloseTo(expected.x, 6)
      expect(turned.segs[i].p.y).toBeCloseTo(expected.y, 6)
    })
  })
})

describe('bends', () => {
  const rounded = slabSpec('rounded')

  function bendTop(spec: SlabSpec, lift: number): SlabSpec {
    const grabPoint = { x: -50, y: -190 }
    const grab = locateCarveGrab(spec, grabPoint)
    expect(grab?.side).toEqual({ type: 'line', id: 'top' })
    return bendCarve(spec, grab!, { x: grabPoint.x, y: grabPoint.y - lift }) as SlabSpec
  }

  it('the bent edge passes through the cursor', () => {
    const bent = bendTop(rounded, 30)
    const outline = carveOutline(bent)
    const topIndex = outline.curveSides.findIndex((s) => s.type === 'line' && s.id === 'top')
    const hit = projectOnCubic(outline.curves[topIndex], { x: -50, y: -220 })
    expect(hit.distance).toBeLessThan(0.05)
  })

  it('stays smooth where a bent side meets its rounded corner', () => {
    const outline = carveOutline(bendTop(rounded, 40))
    const top = outline.curveSides.findIndex((s) => s.type === 'line' && s.id === 'top')
    const corner = outline.curveSides.findIndex((s) => s.type === 'corner' && s.id === 'tr')
    const a = sub(outline.curves[top][3], outline.curves[top][2])
    const b = sub(outline.curves[corner][1], outline.curves[corner][0])
    const angle = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * (180 / Math.PI)
    expect(angle).toBeLessThan(0.5)
  })

  it('survives a resize: same depth, stretched along the side', () => {
    const bent = bendTop(rounded, 30)
    const wider = dragCarveHandle(bent, 'e', { x: 202, y: 0 }, { x: 262, y: 0 }) as SlabSpec
    expect(wider.width).toBeCloseTo(440, 6)
    expect(wider.sides?.top).toEqual(bent.sides?.top)
    const depth = (spec: SlabSpec) => {
      const outline = carveOutline(spec)
      const top = outline.curves[outline.curveSides.findIndex((s) => s.type === 'line' && s.id === 'top')]
      let min = Infinity
      for (let i = 0; i <= 200; i++) min = Math.min(min, cubicPoint(top, i / 200).y)
      return -190 - min
    }
    expect(Math.abs(depth(wider) - depth(bent)) / depth(bent)).toBeLessThan(0.01)
  })

  it('never grows a needle as a bent side shrinks', () => {
    const bent: SlabSpec = { ...rounded, width: 190, sides: { top: { a1: 0, o1: 200, a2: 0, o2: 200 } } }
    const outline = carveOutline(bent)
    const top = outline.curves[outline.curveSides.findIndex((s) => s.type === 'line' && s.id === 'top')]
    const chord = length(sub(top[3], top[0]))
    let min = Infinity
    for (let i = 0; i <= 200; i++) min = Math.min(min, cubicPoint(top, i / 200).y)
    expect(-190 - min).toBeLessThanOrEqual(chord)
  })

  it('a bent channel stays an even-width groove with no self-crossing', () => {
    for (const o of [60, 150]) {
      const spec: GrooveSpec = { v: 1, kind: 'channel', from: { x: -80, y: 0 }, to: { x: 80, y: 0 }, width: 40, bend: { a1: 0, o1: o, a2: 0, o2: o } }
      const outline = carveOutline(spec)
      const spine = grooveSpine(spec)
      outline.curves.forEach((curve, i) => {
        if (outline.curveSides[i].type !== 'rail') return
        for (let k = 0; k <= 10; k++) {
          const d = projectOnCubic(spine, cubicPoint(curve, k / 10)).distance
          expect(Math.abs(d - 20)).toBeLessThan(0.75)
        }
      })
      const path = item(outline.pathData)
      const crossings = path.getIntersections(path).filter((loc) => loc.isCrossing())
      expect(crossings).toHaveLength(0)
    }
  })
})

describe('foldTransform', () => {
  it('matches applying the layer transform', () => {
    const spec: SlabSpec = {
      ...slabSpec('rounded'),
      center: { x: 10, y: -20 },
      rotation: 12,
      sides: { right: { a1: 0.05, o1: 30, a2: 0, o2: 18 } },
    }
    const t = { dx: 30, dy: -20, scale: 1.3, rotation: 25 }
    const outline = carveOutline(spec)
    const original = item(outline.pathData)
    const b = outlineBounds(outline)
    const pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    expect(original.bounds.center.x).toBeCloseTo(pivot.x, 4)
    expect(original.bounds.center.y).toBeCloseTo(pivot.y, 4)
    applyLayerTransform(original, {
      id: 'l',
      name: 'l',
      operation: 'add',
      visible: true,
      locked: false,
      pathData: outline.pathData,
      fillRule: 'evenodd',
      transform: t,
    })
    const folded = item(carveOutline(foldTransform(spec, t, pivot)).pathData)
    expect(differenceArea(original, folded)).toBeLessThan(0.5)
  })
})
