import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mat, contourBounds, itemBounds, boundsOf, transformContours, transformItem, segmentCount, segmentCubic, flattenContour,
  nearestOnContour, nearestOnItem, insertNode, removeNode, isSmooth, setSmooth, moveNode, moveHandle, dragRect, constrain45,
  rectContours, ellipseContours, polygonContours, lineContours, contoursToD, formatNumber,
} from '../js/geometry.js'
import { makeItem } from '../js/model.js'

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) Object.values(Object.freeze(o)).forEach(deepFreeze)
  return o
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} is not within ${eps} of ${b}`)
const nearPt = (p, q, eps = 1e-6) => { near(p.x, q.x, eps, `x: ${p.x} vs ${q.x}`); near(p.y, q.y, eps, `y: ${p.y} vs ${q.y}`) }
const n = (x, y, hi = null, ho = null) => ({ x, y, hi, ho })
const pt = (x, y) => ({ x, y })
// an arch from (0,0) to (100,0) whose handles pull the curve up to y = 75 at t = 0.5
const arch = { closed: false, nodes: [n(0, 0, null, pt(0, 100)), n(100, 0, pt(100, 100), null)] }

test('matrices: identity, multiply order, invert, apply', () => {
  const t = mat.translate(10, 20), s = mat.scale(2, 3)
  assert.deepEqual(mat.apply(mat.identity(), pt(4, 5)), pt(4, 5))
  assert.deepEqual(mat.apply(mat.multiply(t, s), pt(1, 1)), pt(12, 23), 'multiply(a, b) applies b first')
  assert.deepEqual(mat.apply(mat.multiply(s, t), pt(1, 1)), pt(22, 63))
  const m = mat.multiply(mat.rotate(0.7, 5, 6), mat.scale(2, 0.5, 1, 1))
  nearPt(mat.apply(mat.invert(m), mat.apply(m, pt(3, -4))), pt(3, -4))
  assert.deepEqual(mat.invert([0, 0, 0, 0, 1, 1]), mat.identity(), 'singular matrices fall back to identity')
  assert.deepEqual(mat.apply(mat.scale(2, 2, 10, 10), pt(10, 10)), pt(10, 10), 'scale keeps its centre fixed')
  nearPt(mat.apply(mat.rotate(Math.PI / 2, 10, 10), pt(20, 10)), pt(10, 20))
})

test('ellipse bounds equal the radii', () => {
  const b = contourBounds(ellipseContours(100, 50, 40, 20)[0])
  near(b.x, 60); near(b.y, 30); near(b.w, 80); near(b.h, 40)
})

test('bounds use exact cubic extrema, not control points', () => {
  const b = contourBounds(arch)
  near(b.y, 0); near(b.h, 75, 1e-9) // 3/4 of the handle height, nowhere near the control point at 100
  near(b.w, 100)
  // an S-curve overshoots in x on both sides
  const s = { closed: false, nodes: [n(0, 0, null, pt(-40, 30)), n(10, 60, pt(50, 30), null)] }
  const sb = contourBounds(s)
  assert.ok(sb.x < 0 && sb.x + sb.w > 10)
  assert.equal(contourBounds({ closed: false, nodes: [] }), null)
  assert.deepEqual(contourBounds({ closed: false, nodes: [n(3, 4)] }), { x: 3, y: 4, w: 0, h: 0 })
})

test('itemBounds and boundsOf union contours and items', () => {
  const a = makeItem(rectContours(0, 0, 10, 10)), b = makeItem(rectContours(20, -5, 10, 10))
  assert.deepEqual(itemBounds(a), { x: 0, y: 0, w: 10, h: 10 })
  assert.deepEqual(boundsOf([a, b]), { x: 0, y: -5, w: 30, h: 15 })
  assert.equal(boundsOf([]), null)
  assert.equal(itemBounds({ contours: [] }), null)
})

test('a 90° rotation swaps width and height', () => {
  const item = makeItem(rectContours(10, 20, 100, 40))
  const b = itemBounds(item), cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const r = itemBounds(transformItem(item, mat.rotate(Math.PI / 2, cx, cy)))
  near(r.w, 40); near(r.h, 100)
  near(r.x + r.w / 2, cx); near(r.y + r.h / 2, cy)
  const e = itemBounds(transformItem(makeItem(ellipseContours(0, 0, 50, 10)), mat.rotate(Math.PI / 2)))
  near(e.w, 20, 1e-9); near(e.h, 100, 1e-9)
})

test('transformContours moves handles with anchors; transformItem scales stroke width', () => {
  const [c] = transformContours(deepFreeze([arch]), mat.translate(5, 7))
  assert.deepEqual(c.nodes[0], n(5, 7, null, pt(5, 107)))
  assert.deepEqual(c.nodes[1], n(105, 7, pt(105, 107), null))
  const item = makeItem(rectContours(0, 0, 4, 4), { stroke: '#000000', strokeWidth: 3 })
  near(transformItem(item, mat.scale(2, 8)).strokeWidth, 12)
  near(transformItem(item, mat.rotate(1)).strokeWidth, 3)
  assert.equal(transformItem(item, mat.translate(1, 1)).fill, item.fill)
})

test('segments: counts and cubics, open and closed', () => {
  const [sq] = rectContours(0, 0, 10, 10)
  assert.equal(segmentCount(sq), 4)
  assert.equal(segmentCount({ ...sq, closed: false }), 3)
  assert.equal(segmentCount({ closed: true, nodes: [n(0, 0)] }), 0)
  assert.deepEqual(segmentCubic(sq, 3), [pt(0, 10), pt(0, 10), pt(0, 0), pt(0, 0)], 'last closed segment wraps to node 0')
  assert.deepEqual(segmentCubic(arch, 0), [pt(0, 0), pt(0, 100), pt(100, 100), pt(100, 0)])
})

test('flattenContour: straight edges stay exact, curves stay within tolerance, closed does not repeat', () => {
  const [sq] = rectContours(0, 0, 10, 10)
  assert.deepEqual(flattenContour(sq), sq.nodes.map((q) => pt(q.x, q.y)))
  assert.equal(flattenContour({ ...sq, closed: false }).length, 4)
  assert.deepEqual(flattenContour({ closed: false, nodes: [n(1, 2)] }), [pt(1, 2)])
  const [circle] = ellipseContours(0, 0, 100, 100)
  const pts = flattenContour(circle, 0.1)
  assert.ok(pts.length > 20 && pts.length < 400)
  for (const p of pts) near(Math.hypot(p.x, p.y), 100, 0.2)
  assert.ok(flattenContour(circle, 0.01).length > pts.length)
})

test('nearestOnContour finds the closest point on lines and curves', () => {
  const [sq] = rectContours(0, 0, 10, 10)
  const r = nearestOnContour(sq, pt(5, -3))
  assert.deepEqual([r.seg, r.dist], [0, 3])
  nearPt(r.point, pt(5, 0)); near(r.t, 0.5)
  const closing = nearestOnContour(sq, pt(-2, 4)) // on the wrap-around segment
  assert.equal(closing.seg, 3)
  near(closing.dist, 2)
  const [circle] = ellipseContours(0, 0, 100, 100)
  const c = nearestOnContour(circle, pt(300, 0))
  near(c.dist, 200, 0.2)
  near(c.point.x, 100, 0.2)
  assert.equal(nearestOnContour({ closed: false, nodes: [] }, pt(0, 0)), null)
  assert.deepEqual(nearestOnContour({ closed: false, nodes: [n(3, 4)] }, pt(0, 0)).dist, 5)
})

test('nearestOnItem reports the contour index', () => {
  const item = makeItem([...rectContours(0, 0, 10, 10), ...rectContours(50, 0, 10, 10)])
  const r = nearestOnItem(item, pt(48, 5))
  assert.equal(r.ci, 1)
  near(r.dist, 2)
  assert.equal(nearestOnItem({ contours: [] }, pt(0, 0)), null)
})

test('insertNode keeps the point at t and the shape of the curve', () => {
  const seg = segmentCubic(arch, 0)
  const at = (t) => {
    const u = 1 - t
    return pt(
      u ** 3 * seg[0].x + 3 * u * u * t * seg[1].x + 3 * u * t * t * seg[2].x + t ** 3 * seg[3].x,
      u ** 3 * seg[0].y + 3 * u * u * t * seg[1].y + 3 * u * t * t * seg[2].y + t ** 3 * seg[3].y,
    )
  }
  const t = 0.3, c = insertNode(deepFreeze(arch), 0, t)
  assert.equal(c.nodes.length, 3)
  nearPt(c.nodes[1], at(t))
  assert.ok(c.nodes[1].hi && c.nodes[1].ho)
  assert.ok(isSmooth(c.nodes[1]), 'a split of a smooth curve is smooth')
  // the two halves trace the original curve
  const left = segmentCubic(c, 0), right = segmentCubic(c, 1)
  const half = (s, a, b, u) => {
    const v = 1 - u
    return pt(
      v ** 3 * s[0].x + 3 * v * v * u * s[1].x + 3 * v * u * u * s[2].x + u ** 3 * s[3].x,
      v ** 3 * s[0].y + 3 * v * v * u * s[1].y + 3 * v * u * u * s[2].y + u ** 3 * s[3].y,
    )
  }
  for (const u of [0.1, 0.5, 0.9]) {
    nearPt(half(left, 0, 1, u), at(t * u))
    nearPt(half(right, 0, 1, u), at(t + (1 - t) * u))
  }
  near(contourBounds(c).h, contourBounds(arch).h, 1e-9)
})

test('insertNode on a line adds a handle-less node; on the closing segment it appends', () => {
  const [sq] = rectContours(0, 0, 10, 10)
  const a = insertNode(sq, 0, 0.25)
  assert.deepEqual(a.nodes[1], n(2.5, 0))
  const b = insertNode(sq, 3, 0.5)
  assert.equal(b.nodes.length, 5)
  assert.deepEqual(b.nodes[4], n(0, 5))
  assert.equal(insertNode(sq, 0, 0), sq, 't at an end would duplicate a node')
  assert.equal(insertNode(sq, 9, 0.5), sq)
  assert.equal(insertNode({ closed: false, nodes: [n(0, 0), n(1, 1)] }, 1, 0.5).nodes.length, 2, 'open contours have no closing segment')
})

test('removeNode keeps the neighbours as they are', () => {
  const c = { closed: true, nodes: [n(0, 0, null, pt(1, 0)), n(5, 5), n(10, 0, pt(9, 0), null)] }
  const r = removeNode(deepFreeze(c), 1)
  assert.equal(r.nodes.length, 2)
  assert.equal(r.nodes[0], c.nodes[0])
  assert.equal(r.nodes[1], c.nodes[2])
})

test('setSmooth gives collinear handles at a third of the neighbour chords', () => {
  const c = { closed: false, nodes: [n(0, 0), n(30, 0), n(30, 60)] }
  const s = setSmooth(deepFreeze(c), 1, true)
  const k = s.nodes[1]
  assert.ok(isSmooth(k))
  // tangent runs prev → next = (30, 60) / |…|
  const len = Math.hypot(30, 60), ux = 30 / len, uy = 60 / len
  nearPt(k.hi, pt(30 - ux * 10, 0 - uy * 10))
  nearPt(k.ho, pt(30 + ux * 20, 0 + uy * 20))
  assert.equal(s.nodes[0], c.nodes[0])
  const back = setSmooth(s, 1, false)
  assert.deepEqual(back.nodes[1], n(30, 0))
  assert.equal(setSmooth(c, 1, false), c, 'already a corner')
  const closed = setSmooth({ closed: true, nodes: [n(0, 0), n(10, 0), n(10, 10), n(0, 10)] }, 0, true)
  assert.ok(isSmooth(closed.nodes[0]), 'closed contours wrap around for the neighbours')
  const end = setSmooth(c, 0, true).nodes[0]
  assert.ok(isSmooth(end), 'an open end uses its single neighbour')
  assert.equal(setSmooth(c, 7, true), c)
})

test('isSmooth needs both handles, opposite and within about 2°', () => {
  assert.equal(isSmooth(n(0, 0, pt(-5, 0), pt(5, 0))), true)
  assert.equal(isSmooth(n(0, 0, pt(-5, 0), pt(9, 0))), true, 'lengths may differ')
  assert.equal(isSmooth(n(0, 0, pt(-5, 0), pt(5, 0.1))), true)
  assert.equal(isSmooth(n(0, 0, pt(-5, 0), pt(5, 0.5))), false)
  assert.equal(isSmooth(n(0, 0, pt(5, 0), pt(5, 0))), false, 'same side')
  assert.equal(isSmooth(n(0, 0, null, pt(5, 0))), false)
  assert.equal(isSmooth(n(0, 0, pt(0, 0), pt(5, 0))), false)
})

test('moveNode carries handles; moveHandle mirrors only smooth nodes', () => {
  const c = { closed: false, nodes: [n(0, 0), n(10, 10, pt(5, 10), pt(15, 10)), n(20, 0)] }
  const m = moveNode(deepFreeze(c), 1, pt(12, 14))
  assert.deepEqual(m.nodes[1], n(12, 14, pt(7, 14), pt(17, 14)))
  assert.equal(m.nodes[0], c.nodes[0])
  assert.equal(moveNode(c, 1, pt(10, 10)), c)

  const h = moveHandle(c, 1, 'ho', pt(10, 20)) // drag straight down: hi swings straight up, keeping length 5
  assert.deepEqual(h.nodes[1].ho, pt(10, 20))
  nearPt(h.nodes[1].hi, pt(10, 5))
  assert.ok(isSmooth(h.nodes[1]))
  const free = moveHandle(c, 1, 'ho', pt(10, 20), { mirror: false })
  assert.deepEqual(free.nodes[1].hi, pt(5, 10))
  const corner = { closed: false, nodes: [n(0, 0), n(10, 10, pt(5, 12), pt(15, 10))] }
  assert.deepEqual(moveHandle(corner, 1, 'ho', pt(10, 20)).nodes[1].hi, pt(5, 12), 'a corner keeps its other handle')
  assert.equal(moveHandle(c, 1, 'ho', pt(10, 10)).nodes[1].ho, null, 'a zero-length handle is none')
})

test('dragRect normalises, and applies square and centre modifiers', () => {
  assert.deepEqual(dragRect(pt(10, 10), pt(30, 20)), { x: 10, y: 10, w: 20, h: 10 })
  assert.deepEqual(dragRect(pt(30, 20), pt(10, 10)), { x: 10, y: 10, w: 20, h: 10 })
  assert.deepEqual(dragRect(pt(10, 10), pt(30, 20), { square: true }), { x: 10, y: 10, w: 20, h: 20 })
  assert.deepEqual(dragRect(pt(10, 10), pt(0, 4), { square: true }), { x: 0, y: 0, w: 10, h: 10 }, 'square follows the drag direction')
  assert.deepEqual(dragRect(pt(10, 10), pt(30, 20), { center: true }), { x: -10, y: 0, w: 40, h: 20 })
  assert.deepEqual(dragRect(pt(10, 10), pt(30, 20), { center: true, square: true }), { x: -10, y: -10, w: 40, h: 40 })
  assert.deepEqual(dragRect(pt(5, 5), pt(5, 5)), { x: 5, y: 5, w: 0, h: 0 })
})

test('constrain45 snaps the direction and keeps the distance', () => {
  assert.deepEqual(constrain45(pt(0, 0), pt(10, 2)), pt(Math.hypot(10, 2), 0))
  assert.deepEqual(constrain45(pt(5, 5), pt(5.5, 20)), pt(5, 5 + Math.hypot(0.5, 15)))
  const d = constrain45(pt(0, 0), pt(10, 12))
  near(d.x, d.y)
  near(Math.hypot(d.x, d.y), Math.hypot(10, 12))
  const up = constrain45(pt(0, 0), pt(-1, -10))
  assert.equal(up.x, 0)
  assert.ok(up.y < 0)
  assert.deepEqual(constrain45(pt(3, 3), pt(3, 3)), pt(3, 3))
})

test('rectContours: 4 nodes, or 8 with a radius clamped to half the short side', () => {
  const [plain] = rectContours(10, 20, 100, 50)
  assert.equal(plain.nodes.length, 4)
  assert.equal(plain.closed, true)
  assert.deepEqual(itemBounds({ contours: [plain] }), { x: 10, y: 20, w: 100, h: 50 })
  const [round] = rectContours(10, 20, 100, 50, 10)
  assert.equal(round.nodes.length, 8)
  const b = contourBounds(round)
  near(b.x, 10, 1e-6); near(b.w, 100, 1e-6); near(b.h, 50, 1e-6)
  assert.equal(round.nodes[0].x, 20)
  const pill = contourBounds(rectContours(0, 0, 100, 50, 999)[0])
  near(pill.w, 100, 1e-6); near(pill.h, 50, 1e-6)
  assert.equal(rectContours(0, 0, 100, 50, 999)[0].nodes[0].x, 25, 'radius clamps to 25')
  assert.equal(rectContours(0, 0, 10, 10, -3)[0].nodes.length, 4)
})

test('ellipseContours: 4 nodes, clockwise from the top, circle-accurate', () => {
  const [e] = ellipseContours(50, 50, 30, 30)
  assert.equal(e.nodes.length, 4)
  assert.deepEqual([e.nodes[0].x, e.nodes[0].y], [50, 20])
  assert.deepEqual([e.nodes[1].x, e.nodes[1].y], [80, 50])
  assert.equal(e.nodes[0].ho.x > 50, true, 'the top node leaves to the right')
  assert.ok(e.nodes.every(isSmooth))
  const mid = flattenContour(e, 0.01).filter((p) => Math.abs(p.x - p.y) < 1)
  for (const p of mid) near(Math.hypot(p.x - 50, p.y - 50), 30, 0.03)
  near(e.nodes[0].ho.x - 50, 30 * 0.5522847498, 1e-9)
})

test('polygonContours: sides clamp to 3..24; a 5-point star has 10 nodes', () => {
  const [tri] = polygonContours(0, 0, 10, 10, 3)
  assert.equal(tri.nodes.length, 3)
  nearPt(tri.nodes[0], pt(0, -10)) // first vertex points up
  assert.equal(polygonContours(0, 0, 10, 10, 1)[0].nodes.length, 3)
  assert.equal(polygonContours(0, 0, 10, 10, 99)[0].nodes.length, 24)
  const [star] = polygonContours(0, 0, 100, 100, 5, { star: true, inner: 0.4 })
  assert.equal(star.nodes.length, 10)
  near(Math.hypot(star.nodes[0].x, star.nodes[0].y), 100)
  near(Math.hypot(star.nodes[1].x, star.nodes[1].y), 40)
  nearPt(polygonContours(0, 0, 10, 10, 4, { rotation: 0 })[0].nodes[0], pt(10, 0))
  const [squashed] = polygonContours(0, 0, 20, 10, 4, { rotation: 0 })
  nearPt(squashed.nodes[1], pt(0, 10))
})

test('lineContours is one open contour of two nodes', () => {
  assert.deepEqual(lineContours(pt(1, 2), pt(3, 4)), [{ closed: false, nodes: [n(1, 2), n(3, 4)] }])
})

test('formatNumber rounds, strips zeros and never prints -0', () => {
  assert.equal(formatNumber(1.005), '1')
  assert.equal(formatNumber(1.5), '1.5')
  assert.equal(formatNumber(2), '2')
  assert.equal(formatNumber(0.126, 2), '0.13')
  assert.equal(formatNumber(-0.001), '0')
  assert.equal(formatNumber(-0), '0')
  assert.equal(formatNumber(123.456789, 4), '123.4568')
  assert.equal(formatNumber(10, 0), '10')
  assert.equal(formatNumber(-2.5), '-2.5')
})

test('contoursToD: M, then L or C per segment, Z when closed', () => {
  assert.equal(contoursToD(rectContours(0, 0, 10, 20)), 'M 0 0 L 10 0 L 10 20 L 0 20 Z')
  assert.equal(contoursToD(lineContours(pt(0, 0), pt(1.239, -0.001))), 'M 0 0 L 1.24 0')
  assert.equal(contoursToD([arch]), 'M 0 0 C 0 100 100 100 100 0')
  const oneHandle = { closed: false, nodes: [n(0, 0, null, pt(0, 5)), n(10, 0)] }
  assert.equal(contoursToD([oneHandle]), 'M 0 0 C 0 5 10 0 10 0', 'a missing handle uses the anchor itself')
  assert.equal(contoursToD(rectContours(0, 0, 10, 10), 2).includes('C'), false)
  assert.equal(contoursToD([...rectContours(0, 0, 1, 1), ...lineContours(pt(5, 5), pt(6, 6))]), 'M 0 0 L 1 0 L 1 1 L 0 1 Z M 5 5 L 6 6')
  assert.equal(contoursToD([]), '')
  assert.equal(contoursToD([{ closed: true, nodes: [] }]), '')
})

test('contoursToD closes a curved closing segment explicitly and honours precision', () => {
  const d = contoursToD(ellipseContours(10, 10, 10, 10), 1)
  assert.equal(d, 'M 10 0 C 15.5 0 20 4.5 20 10 C 20 15.5 15.5 20 10 20 C 4.5 20 0 15.5 0 10 C 0 4.5 4.5 0 10 0 Z')
  const closed = { closed: true, nodes: [n(0, 0), n(10, 0, null, pt(12, 5)), n(10, 10, pt(11, 3), pt(5, 12))] }
  assert.equal(contoursToD([closed]), 'M 0 0 L 10 0 C 12 5 11 3 10 10 C 5 12 0 0 0 0 Z')
  assert.equal(contoursToD(ellipseContours(0, 0, 1, 1), 4).includes('0.5523'), true)
})

test('geometry functions never mutate their inputs', () => {
  const [c] = deepFreeze(ellipseContours(50, 50, 30, 20))
  const item = deepFreeze(makeItem([c]))
  assert.doesNotThrow(() => {
    contourBounds(c); itemBounds(item); boundsOf([item]); transformContours([c], mat.scale(2, 2)); transformItem(item, mat.rotate(1))
    flattenContour(c); nearestOnContour(c, pt(1, 1)); nearestOnItem(item, pt(1, 1)); insertNode(c, 1, 0.5); removeNode(c, 0)
    setSmooth(c, 0, false); setSmooth(c, 0, true); moveNode(c, 0, pt(3, 3)); moveHandle(c, 0, 'hi', pt(3, 3)); contoursToD([c])
  })
})
