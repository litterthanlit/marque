import { describe, expect, it } from 'vitest'
import { rotate, type Vec } from '../path/bezier.ts'
import type { EditablePath } from '../path/editPath.ts'
import {
  applyAffine,
  boxHandles,
  boxToBox,
  boxPoint,
  boxHandlePoint,
  boxFrameSides,
  boxRotateHandle,
  DEFAULT_HANDLE_LAYOUT,
  evenFactorTo,
  scaleBoxBy,
  MIN_BOX_SIZE,
  pathBoundsInFrame,
  resizeBox,
  rotateBox,
  settleAngle,
  transformPath,
  wholeBoxResize,
  type OrientedBox,
} from './box.ts'

const NONE = { shift: false, alt: false }
const SHIFT = { shift: true, alt: false }
const ALT = { shift: false, alt: true }

const upright: OrientedBox = { center: { x: 10, y: -20 }, width: 200, height: 100, rotation: 0 }
const turned: OrientedBox = { ...upright, rotation: 30 }

/** A point given in the box's own frame, as a fraction of each half side. */
const at = (box: OrientedBox, fx: number, fy: number): Vec => boxPoint(box, { x: (fx * box.width) / 2, y: (fy * box.height) / 2 })

function expectNear(a: Vec, b: Vec, digits = 6) {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}

describe('the handles around a box', () => {
  it('sit on a frame padded around it, the knob above the top side', () => {
    const handles = boxHandles(upright, DEFAULT_HANDLE_LAYOUT, { kind: 'resize', edges: true })
    expect(handles.map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
    expect(handles.find((h) => h.id === 'e')!.at).toEqual({ x: 10 + 100 + 12, y: -20 })
    expect(handles.find((h) => h.id === 'nw')!.at).toEqual({ x: 10 - 112, y: -20 - 62 })
    expect(boxRotateHandle(upright, DEFAULT_HANDLE_LAYOUT).at).toEqual({ x: 10, y: -20 - 62 - 22 })
  })

  it('turn with the box', () => {
    const handles = boxHandles(turned, DEFAULT_HANDLE_LAYOUT, { kind: 'resize', edges: true })
    const east = handles.find((h) => h.id === 'e')!
    expectNear(east.at, boxPoint(turned, { x: 112, y: 0 }))
    expect(east.axisDeg).toBe(30)
  })

  it('show only the corners when they scale uniformly, and no side handles on a short side', () => {
    const corners = boxHandles(upright, DEFAULT_HANDLE_LAYOUT, { kind: 'scale', edges: false })
    expect(corners.map((h) => h.id)).toEqual(['nw', 'ne', 'se', 'sw'])
    expect(corners.every((h) => h.kind === 'scale')).toBe(true)
    const thin = boxHandles({ ...upright, height: 2 }, DEFAULT_HANDLE_LAYOUT, { kind: 'resize', edges: true })
    expect(thin.map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'se', 's', 'sw'])
  })

  it("hide a side's square where its padded side is shorter than asked, keeping every corner", () => {
    // Padded by 12 each way, a 23-unit side is 47 long, and a 24-unit side 48.
    const small: OrientedBox = { center: { x: 0, y: 0 }, width: 23, height: 60, rotation: 0 }
    expect(boxHandles(small, DEFAULT_HANDLE_LAYOUT, { kind: 'resize', edges: true })).toHaveLength(8)
    const fewer = boxHandles(small, DEFAULT_HANDLE_LAYOUT, { kind: 'resize', edges: true, minSide: DEFAULT_HANDLE_LAYOUT.minBoxSide })
    expect(fewer.map((h) => h.id)).toEqual(['nw', 'ne', 'e', 'se', 'sw', 'w'])
    const enough = boxHandles({ ...small, width: 24 }, DEFAULT_HANDLE_LAYOUT, { kind: 'resize', edges: true, minSide: DEFAULT_HANDLE_LAYOUT.minBoxSide })
    expect(enough).toHaveLength(8)
  })
})

describe('resizing a box', () => {
  it('pulls one side and keeps the opposite side where it was, even turned', () => {
    for (const box of [upright, turned]) {
      const east = at(box, 1, 0)
      const r = resizeBox(box, 'e', east, boxPoint(box, { x: 160, y: 0 }), NONE)
      expect(r.box.width).toBeCloseTo(260, 6)
      expect(r.box.height).toBeCloseTo(100, 6)
      expect(r.sy).toBeCloseTo(1, 9)
      for (const fy of [-1, 0, 1]) expectNear(applyAffine(r.affine, at(box, -1, fy)), at(box, -1, fy))
      expectNear(applyAffine(r.affine, east), at(r.box, 1, 0))
    }
  })

  it('pulls a corner freely, about the opposite corner', () => {
    const r = resizeBox(turned, 'se', at(turned, 1, 1), boxPoint(turned, { x: 140, y: 90 }), NONE)
    expect(r.box.width).toBeCloseTo(240, 6)
    expect(r.box.height).toBeCloseTo(140, 6)
    expectNear(applyAffine(r.affine, at(turned, -1, -1)), at(turned, -1, -1))
    expectNear(r.pivot, at(turned, -1, -1))
  })

  it('resizes about the centre with Alt', () => {
    const r = resizeBox(upright, 'e', at(upright, 1, 0), { x: 140, y: -20 }, ALT)
    expect(r.box.width).toBeCloseTo(260, 6)
    expectNear(r.box.center, upright.center)
    expectNear(applyAffine(r.affine, upright.center), upright.center)
  })

  it('scales uniformly from a corner with Shift, or always when asked to', () => {
    for (const [mods, uniform] of [
      [SHIFT, false],
      [NONE, true],
    ] as const) {
      const r = resizeBox(turned, 'se', at(turned, 1, 1), boxPoint(turned, { x: 150, y: 60 }), mods, uniform)
      expect(r.sx).toBeCloseTo(r.sy, 9)
      expect(r.box.width / r.box.height).toBeCloseTo(2, 9)
      expectNear(applyAffine(r.affine, at(turned, -1, -1)), at(turned, -1, -1))
      // A uniform map is a scaling about the pivot.
      const p = { x: 33, y: -7 }
      const scaled = { x: r.pivot.x + (p.x - r.pivot.x) * r.sx, y: r.pivot.y + (p.y - r.pivot.y) * r.sx }
      expectNear(applyAffine(r.affine, p), scaled)
    }
  })

  it('keeps the proportions from a side with Shift, growing across the middle', () => {
    const r = resizeBox(upright, 'e', at(upright, 1, 0), { x: 160, y: -20 }, SHIFT)
    expect(r.box.width).toBeCloseTo(250, 6)
    expect(r.box.height).toBeCloseTo(125, 6)
    expect(r.box.center.y).toBeCloseTo(upright.center.y, 6)
    expectNear(applyAffine(r.affine, at(upright, -1, 0)), at(upright, -1, 0))
  })

  it('never flips or shrinks below the smallest size', () => {
    const r = resizeBox(upright, 'e', at(upright, 1, 0), { x: -500, y: -20 }, NONE)
    expect(r.box.width).toBeCloseTo(MIN_BOX_SIZE, 6)
    expect(r.sx).toBeGreaterThan(0)
    const corner = resizeBox(upright, 'se', at(upright, 1, 1), { x: -500, y: -500 }, SHIFT)
    expect(Math.min(corner.box.width, corner.box.height)).toBeCloseTo(MIN_BOX_SIZE, 6)
    expect(corner.sx).toBeGreaterThan(0)
  })

  it('never jumps a side that is already thinner than the smallest size', () => {
    const thin: OrientedBox = { center: { x: 0, y: 0 }, width: 2, height: 200, rotation: 0 }
    for (const mods of [NONE, ALT]) {
      const pulled = resizeBox(thin, 'e', at(thin, 1, 0), { x: 1.001, y: 0 }, mods)
      expect(pulled.box.width).toBeLessThan(2.01)
      expect(pulled.sx).toBeGreaterThanOrEqual(1)
    }
    expect(resizeBox(thin, 'se', at(thin, 1, 1), at(thin, 1, 1), NONE).sx).toBe(1)
    // Pushed inward, it stays as thin as it was rather than widening.
    expect(resizeBox(thin, 'e', at(thin, 1, 0), { x: -30, y: 0 }, NONE).box.width).toBeCloseTo(2, 9)
  })

  it('keeps both sides at their smallest size when Shift on a side shrinks them together', () => {
    const wide: OrientedBox = { center: { x: 0, y: 0 }, width: 300, height: 20, rotation: 0 }
    for (const mods of [SHIFT, { shift: true, alt: true }]) {
      const r = resizeBox(wide, 'e', at(wide, 1, 0), { x: -900, y: 0 }, mods)
      expect(r.box.height).toBeCloseTo(MIN_BOX_SIZE, 6)
      expect(r.box.width).toBeCloseTo(60, 6)
      expect(r.sx).toBeCloseTo(r.sy, 9)
    }
    // Without Alt the opposite side stays put.
    const r = resizeBox(wide, 'e', at(wide, 1, 0), { x: -900, y: 0 }, SHIFT)
    expectNear(applyAffine(r.affine, at(wide, -1, 0)), at(wide, -1, 0))
  })

  it('solves an even scale that brings a corner onto a given line', () => {
    for (const box of [upright, turned]) {
      for (const alt of [false, true]) {
        const factor = evenFactorTo(box, 'se', alt, 'x', 140)!
        const r = scaleBoxBy(box, 'se', factor, alt)
        expect(boxHandlePoint(r.box, 'se')!.x).toBeCloseTo(140, 6)
        expect(r.box.width / r.box.height).toBeCloseTo(2, 9)
        expectNear(applyAffine(r.affine, r.pivot), r.pivot)
      }
    }
    // A corner straight above its pivot cannot move along x.
    const square: OrientedBox = { center: { x: 0, y: 0 }, width: 0, height: 100, rotation: 0 }
    expect(evenFactorTo(square, 'se', false, 'x', 50)).toBeNull()
  })

  it('leaves a side with no length alone', () => {
    const flat: OrientedBox = { center: { x: 0, y: 0 }, width: 100, height: 0, rotation: 0 }
    const r = resizeBox(flat, 'se', at(flat, 1, 1), { x: 80, y: 40 }, NONE)
    expect(r.sy).toBe(1)
    expect(r.box.width).toBeCloseTo(130, 6)
    expect(Number.isFinite(r.affine.d)).toBe(true)
  })
})

describe('a resize at whole units', () => {
  const fractional: OrientedBox = { center: { x: 10.3, y: -20.6 }, width: 200.4, height: 100.2, rotation: 30 }

  it('stores the whole width the readout shows, keeping the opposite side and the height', () => {
    const raw = resizeBox(fractional, 'e', at(fractional, 1, 0), boxPoint(fractional, { x: 127.37, y: 0 }), NONE)
    expect(raw.box.width).toBeCloseTo(227.57, 6)
    const whole = wholeBoxResize(fractional, raw, false)
    expect(whole.box.width).toBeCloseTo(228, 9)
    expect(whole.box.width).toBeCloseTo(Number(Math.round(raw.box.width)), 9)
    expect(whole.box.height).toBe(fractional.height)
    for (const fy of [-1, 0, 1]) expectNear(applyAffine(whole.affine, at(fractional, -1, fy)), at(fractional, -1, fy))
    expectNear(applyAffine(whole.affine, at(fractional, 1, 0)), at(whole.box, 1, 0))
  })

  it('rounds both sides a corner moves, and keeps an even scale even, on its longer side', () => {
    const free = wholeBoxResize(fractional, resizeBox(fractional, 'se', at(fractional, 1, 1), boxPoint(fractional, { x: 133.6, y: 71.7 }), NONE), false)
    expect(free.box.width).toBeCloseTo(234, 9)
    expect(free.box.height).toBeCloseTo(122, 9)
    expectNear(applyAffine(free.affine, at(fractional, -1, -1)), at(fractional, -1, -1))
    const raw = resizeBox(fractional, 'se', at(fractional, 1, 1), boxPoint(fractional, { x: 133.6, y: 71.7 }), SHIFT)
    const even = wholeBoxResize(fractional, raw, true)
    expect(even.box.width).toBeCloseTo(Math.round(raw.box.width), 9)
    expect(even.sx).toBeCloseTo(even.sy, 12)
    expectNear(even.pivot, raw.pivot)
    expectNear(applyAffine(even.affine, raw.pivot), raw.pivot)
  })

  it('leaves a side that rounding would take below its floor', () => {
    const thin: OrientedBox = { center: { x: 0, y: 0 }, width: 2.4, height: 50, rotation: 0 }
    const raw = resizeBox(thin, 'e', at(thin, 1, 0), { x: 1.3, y: 0 }, NONE)
    expect(raw.box.width).toBeCloseTo(2.5, 9)
    expect(wholeBoxResize(thin, raw, false).box.width).toBeCloseTo(3, 9)
    // 2.45 would round to 2, thinner than the 2.4 it started at.
    const barely = resizeBox(thin, 'e', at(thin, 1, 0), { x: 1.25, y: 0 }, NONE)
    expect(wholeBoxResize(thin, barely, false)).toBe(barely)
  })
})

describe('carrying one box onto another', () => {
  it('keeps every point at its share of each side', () => {
    const to: OrientedBox = { center: { x: -40, y: 12 }, width: 300, height: 50, rotation: 75 }
    const m = boxToBox(turned, to)
    for (const [fx, fy] of [
      [-1, -1],
      [1, 0],
      [0.3, 0.8],
    ]) {
      expectNear(applyAffine(m, at(turned, fx, fy)), at(to, fx, fy))
    }
  })
})

describe('turning a box', () => {
  it('follows the pointer about the centre, and settles on 15° steps with Shift', () => {
    const start = { x: 10, y: -150 }
    const pointer = { x: 10 + Math.cos((-90 + 37) * (Math.PI / 180)) * 130, y: -20 + Math.sin((-90 + 37) * (Math.PI / 180)) * 130 }
    expect(rotateBox(0, upright.center, start, pointer, false)).toBeCloseTo(37, 6)
    expect(rotateBox(0, upright.center, start, pointer, true)).toBe(30)
    expect(rotateBox(20, upright.center, start, pointer, true)).toBe(60)
  })
})

describe('settling a turn on 15° steps', () => {
  // A 30-unit box at 1 unit per pixel: its knob sits 15 + 12 + 22 = 49 units from the centre.
  const knob = 49

  it('measures the band where the pointer is, so dragging farther out gives finer control', () => {
    expect(settleAngle(22, 3 * knob, 8)).toBeNull()
    expect(settleAngle(17, 3 * knob, 8)).toBe(15)
    // At five times the knob's reach the band is under 2°.
    expect(settleAngle(17, 5 * knob, 8)).toBeNull()
    expect(settleAngle(16, 5 * knob, 8)).toBe(15)
    // Far out, the band is narrower still.
    expect(settleAngle(16, 1000, 8)).toBeNull()
  })

  it('never lets the band swallow a whole step, however close the pointer is to the centre', () => {
    for (const reach of [knob, 10, 1]) {
      expect(settleAngle(5, reach, 8)).toBeNull()
      expect(settleAngle(22, reach, 8)).toBeNull()
      expect(settleAngle(37, reach, 8)).toBeNull()
      expect(settleAngle(32, reach, 8)).toBe(30)
    }
    expect(settleAngle(-179, 50, 8)).toBe(180)
  })
})

describe('the sides of the frame', () => {
  it('run between the corner handles, each standing for its side handle', () => {
    const sides = boxFrameSides(turned, 12)
    expect(sides.map((side) => side.id)).toEqual(['n', 'e', 's', 'w'])
    const handles = boxHandles(turned, { ...DEFAULT_HANDLE_LAYOUT, pad: 12 }, { kind: 'resize', edges: true })
    const by = (id: string) => handles.find((h) => h.id === id)!
    const east = sides.find((side) => side.id === 'e')!
    expectNear(east.a, by('ne').at)
    expectNear(east.b, by('se').at)
    expectNear(east.mid, by('e').at)
    expect(east.axisDeg).toBe(by('e').axisDeg)
  })
})

describe('a path under an affine map', () => {
  const path: EditablePath = {
    closed: true,
    segs: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 10, y: 0 } },
      { p: { x: 40, y: 0 }, hIn: { x: 0, y: -10 }, hOut: null },
      { p: { x: 40, y: 30 }, hIn: null, hOut: null },
    ],
  }

  it('moves its points by the whole map and turns its handles by the linear part', () => {
    const r = resizeBox(upright, 'e', at(upright, 1, 0), { x: 310, y: -20 }, NONE)
    const next = transformPath(path, r.affine)
    expectNear(next.segs[1].p, applyAffine(r.affine, path.segs[1].p))
    // Twice as wide: handles double along x and keep their y, with no translation.
    expectNear(next.segs[0].hOut!, { x: 20, y: 0 })
    expectNear(next.segs[1].hIn!, { x: 0, y: -10 })
    expect(next.segs[2].hIn).toBeNull()
  })

  it('is measured in its own frame', () => {
    const square: EditablePath = {
      closed: true,
      segs: [
        { x: -50, y: -30 },
        { x: 50, y: -30 },
        { x: 50, y: 30 },
        { x: -50, y: 30 },
      ].map((p) => ({ p: rotate(p, 40), hIn: null, hOut: null })),
    }
    const b = pathBoundsInFrame(square, 40)
    expect(b.maxX - b.minX).toBeCloseTo(100, 6)
    expect(b.maxY - b.minY).toBeCloseTo(60, 6)
    const upright = pathBoundsInFrame(square, 0)
    expect(upright.maxX - upright.minX).toBeGreaterThan(100)
  })
})
