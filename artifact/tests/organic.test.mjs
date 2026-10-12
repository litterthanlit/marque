import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_NODES, rng, blobContours, smoothContours, subdivide, roughenContours, bendSegment, pushContours,
  distortContours, isConvexQuad, inkOutline,
} from '../js/organic.js'
import {
  contourBounds, isSmooth, nearestOnContour, segmentCubic, rectContours, ellipseContours, polygonContours, transformContours,
} from '../js/geometry.js'
import create from '../js/tools/brush.js'

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) Object.values(Object.freeze(o)).forEach(deepFreeze)
  return o
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} is not within ${eps} of ${b}`)
const nearPt = (p, q, eps = 1e-9) => { near(p.x, q.x, eps, `x: ${p.x} vs ${q.x}`); near(p.y, q.y, eps, `y: ${p.y} vs ${q.y}`) }
const nearContours = (a, b, eps = 1e-9) => {
  assert.equal(a.length, b.length)
  a.forEach((c, i) => c.nodes.forEach((n, k) => {
    nearPt(n, b[i].nodes[k], eps)
    for (const h of ['hi', 'ho']) n[h] ? nearPt(n[h], b[i].nodes[k][h], eps) : assert.equal(b[i].nodes[k][h], null)
  }))
}
const pt = (x, y) => ({ x, y })
const cubicAt = ([p0, p1, p2, p3], t) => {
  const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return pt(...['x', 'y'].map((k) => w[0] * p0[k] + w[1] * p1[k] + w[2] * p2[k] + w[3] * p3[k]))
}
const nodeCount = (cs) => cs.reduce((n, c) => n + c.nodes.length, 0)
const maxAbsY = (poly, x0, x1) => Math.max(...poly.filter((p) => p.x >= x0 && p.x <= x1).map((p) => Math.abs(p.y)))
// a straight horizontal stroke along x, one sample every `step` units
const stroke = (n, step, extra = () => ({})) => Array.from({ length: n }, (_, i) => ({ x: i * step, y: 0, ...extra(i) }))

// ---- rng ----

test('rng: same seed, same stream; strings work; values in [0, 1) with mean near .5', () => {
  const a = rng(7), b = rng(7), s1 = rng('blob'), s2 = rng('blob')
  for (let i = 0; i < 20; i++) { assert.equal(a(), b()); assert.equal(s1(), s2()) }
  assert.notEqual(rng(7)(), rng(8)())
  assert.notEqual(rng('a')(), rng('b')())
  for (const seed of [1, 'abc', 123456]) {
    const r = rng(seed)
    let sum = 0
    for (let i = 0; i < 10000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); sum += v }
    near(sum / 10000, 0.5, 0.02)
  }
})

// ---- blob ----

test('blob: one closed contour, N nodes, smooth nodes, bounds equal the box', () => {
  const box = deepFreeze({ x: 10, y: 20, w: 200, h: 120 })
  const cs = blobContours(box, deepFreeze({ seed: 3 }))
  assert.equal(cs.length, 1)
  assert.equal(cs[0].closed, true)
  assert.equal(cs[0].nodes.length, 8)
  assert.ok(cs[0].nodes.every(isSmooth))
  for (const points of [3, 5, 8, 12, 24]) for (const wobble of [0, 0.35, 1]) for (const seed of [1, 'x', 99]) {
    const b = contourBounds(blobContours(box, { points, wobble, seed })[0])
    near(b.x, 10); near(b.y, 20); near(b.w, 200); near(b.h, 120)
  }
})

test('blob: points are clamped and rounded; smooth 0 has no handles', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 }
  assert.equal(blobContours(box, { points: 1 })[0].nodes.length, 3)
  assert.equal(blobContours(box, { points: 99 })[0].nodes.length, 24)
  assert.equal(blobContours(box, { points: 5.4 })[0].nodes.length, 5)
  const flat = blobContours(box, { smooth: 0 })[0]
  assert.ok(flat.nodes.every((n) => n.hi === null && n.ho === null))
  near(contourBounds(flat).w, 100)
})

test('blob: deterministic per seed, different seeds differ, and it is asymmetric', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 }
  assert.deepEqual(blobContours(box, { seed: 5 }), blobContours(box, { seed: 5 }))
  assert.notDeepEqual(blobContours(box, { seed: 5 }), blobContours(box, { seed: 6 }))
  const radii = blobContours(box, { wobble: 0.5, seed: 2 })[0].nodes.map((n) => Math.hypot(n.x - 50, n.y - 50))
  assert.ok(Math.max(...radii) / Math.min(...radii) > 1.2)
})

// ---- smooth ----

const triangle = deepFreeze(polygonContours(100, 100, 80, 80, 3))

test('smooth: amount 0 is the same reference; a triangle becomes all smooth without moving anchors', () => {
  assert.equal(smoothContours(triangle, 0), triangle)
  assert.equal(smoothContours(triangle, -1), triangle)
  const out = smoothContours(triangle, 1)
  assert.ok(out[0].nodes.every(isSmooth))
  out[0].nodes.forEach((n, i) => nearPt(n, triangle[0].nodes[i], 0))
})

test('smooth: amount .5 puts handles midway', () => {
  const full = smoothContours(triangle, 1)[0], half = smoothContours(triangle, 0.5)[0]
  half.nodes.forEach((n, i) => {
    for (const h of ['hi', 'ho']) {
      nearPt(n[h], pt(n.x + (full.nodes[i][h].x - n.x) / 2, n.y + (full.nodes[i][h].y - n.y) / 2))
    }
  })
})

test('smooth: already smooth shapes are untouched; open ends keep only the inward handle', () => {
  const ellipse = deepFreeze(ellipseContours(100, 100, 80, 50)), blob = deepFreeze(blobContours({ x: 0, y: 0, w: 90, h: 70 }))
  assert.deepEqual(smoothContours(ellipse, 1), ellipse)
  assert.deepEqual(smoothContours(blob, 1), blob)
  const open = deepFreeze([{ closed: false, nodes: [0, 1, 2].map((i) => ({ x: i * 50, y: i === 1 ? 40 : 0, hi: null, ho: null })) }])
  const [a, b, c] = smoothContours(open, 1)[0].nodes
  assert.equal(a.hi, null); assert.ok(a.ho)
  assert.equal(c.ho, null); assert.ok(c.hi)
  assert.ok(isSmooth(b))
})

// ---- subdivide ----

test('subdivide: new nodes lie on the original curve at equal t, bounds unchanged', () => {
  const c = deepFreeze(ellipseContours(100, 100, 80, 50)[0])
  const out = subdivide(c, 40)
  const k = out.nodes.length / 4
  assert.ok(Number.isInteger(k) && k > 1)
  out.nodes.forEach((n, i) => {
    nearPt(n, cubicAt(segmentCubic(c, Math.floor(i / k)), (i % k) / k)) // exact parametric position
    assert.ok(nearestOnContour(c, n).dist < 1e-4) // nearestOnContour's own search resolution is ~1e-5
  })
  const b0 = contourBounds(c), b1 = contourBounds(out)
  for (const key of ['x', 'y', 'w', 'h']) near(b1[key], b0[key], 1e-9)
})

test('subdivide: respects cap and only; same reference when nothing splits', () => {
  const c = deepFreeze(ellipseContours(100, 100, 80, 80)[0])
  const capped = subdivide(c, 1, { cap: 50 })
  assert.ok(capped.nodes.length <= 50 && capped.nodes.length > 4)
  const right = subdivide(c, 10, { only: (s) => s[0].x === 180 })
  assert.deepEqual(right.nodes[0], c.nodes[0])
  assert.deepEqual(right.nodes.at(-1), c.nodes[3])
  assert.ok(right.nodes.length > 4)
  assert.equal(subdivide(c, 1e6), c)
  assert.equal(subdivide(c, 10, { only: () => false }), c)
  assert.equal(subdivide(c, 10, { cap: 4 }), c)
})

test('subdivide: smoothNew smooths nodes cut from straight segments without changing the outline', () => {
  const c = deepFreeze(rectContours(0, 0, 200, 100)[0])
  const plain = subdivide(c, 50), soft = subdivide(c, 50, { smoothNew: true })
  assert.equal(plain.nodes.length, soft.nodes.length)
  assert.ok(plain.nodes.every((n) => n.hi === null && n.ho === null))
  const added = soft.nodes.filter((n) => !c.nodes.some((o) => o.x === n.x && o.y === n.y))
  assert.equal(added.length, 8)
  assert.ok(added.every(isSmooth))
  const b = contourBounds(soft)
  near(b.w, 200, 1e-9); near(b.h, 100, 1e-9)
  // handles run along the edge they sit on, so the sides stay straight
  assert.ok(added.every((n) => (n.hi.x === n.x && n.ho.x === n.x) || (n.hi.y === n.y && n.ho.y === n.y)))
})

// ---- roughen ----

test('roughen: amount 0 is the same reference; deterministic per seed', () => {
  const cs = deepFreeze(ellipseContours(200, 200, 100, 100))
  assert.equal(roughenContours(cs, { amount: 0 }), cs)
  assert.deepEqual(roughenContours(cs, { seed: 4 }), roughenContours(cs, { seed: 4 }))
  assert.notDeepEqual(roughenContours(cs, { seed: 4 }), roughenContours(cs, { seed: 5 }))
})

test('roughen: anchors move at most amount·size·.08; higher detail adds nodes; smooth stays smooth', () => {
  const cs = deepFreeze(ellipseContours(200, 200, 100, 100)), amount = 0.5, detail = 3, size = 200
  const out = roughenContours(cs, { amount, detail, seed: 2 })
  const base = subdivide(cs[0], size / (3 + 4 * detail))
  assert.equal(out[0].nodes.length, base.nodes.length)
  let moved = 0
  out[0].nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - base.nodes[i].x, n.y - base.nodes[i].y)
    assert.ok(d <= amount * size * 0.08 + 1e-9)
    if (d > 1e-6) moved++
  })
  assert.ok(moved > out[0].nodes.length / 2)
  assert.ok(out[0].nodes.every(isSmooth))
  assert.ok(roughenContours(cs, { detail: 8 })[0].nodes.length > roughenContours(cs, { detail: 2 })[0].nodes.length)
})

test('roughen: rect corners stay corners; an explicit size sets the amplitude', () => {
  const rect = deepFreeze(rectContours(0, 0, 100, 100))
  const out = roughenContours(rect, { amount: 0.6, detail: 3 })
  assert.ok(out[0].nodes.length > 4)
  assert.ok(out[0].nodes.every((n) => n.hi === null && n.ho === null))
  const big = roughenContours(rect, { amount: 1, detail: 1 }, 1000)
  assert.ok(big[0].nodes.some((n) => n.x < -10 || n.x > 110 || n.y < -10 || n.y > 110))
})

// ---- bend ----

test('bend: B(t) moves by exactly delta on curved and straight segments', () => {
  const curved = deepFreeze(ellipseContours(100, 100, 80, 60)[0]), straight = deepFreeze(rectContours(0, 0, 100, 60)[0])
  const delta = pt(13, -7)
  for (const [c, ref] of [[curved, (s, t) => cubicAt(s, t)], [straight, (s, t) => pt(s[0].x + (s[3].x - s[0].x) * t, s[0].y + (s[3].y - s[0].y) * t)]]) {
    for (const t of [0.2, 0.5, 0.8]) {
      const before = ref(segmentCubic(c, 1), t), after = cubicAt(segmentCubic(bendSegment(c, 1, t, delta), 1), t)
      nearPt(after, pt(before.x + delta.x, before.y + delta.y))
    }
  }
})

test('bend: t is clamped to .15–.85', () => {
  const c = deepFreeze(ellipseContours(100, 100, 80, 60)[0]), d = pt(5, 9)
  assert.deepEqual(bendSegment(c, 0, 0.02, d), bendSegment(c, 0, 0.15, d))
  assert.deepEqual(bendSegment(c, 0, 0.99, d), bendSegment(c, 0, 0.85, d))
  const moved = cubicAt(segmentCubic(bendSegment(c, 0, 0.02, d), 0), 0.15), orig = cubicAt(segmentCubic(c, 0), 0.15)
  nearPt(moved, pt(orig.x + 5, orig.y + 9))
})

test('bend: smooth ends stay smooth, other anchors and nodes are untouched', () => {
  const c = deepFreeze(ellipseContours(100, 100, 80, 60)[0])
  const out = bendSegment(c, 1, 0.5, pt(20, 30))
  assert.ok(out.nodes.every(isSmooth))
  out.nodes.forEach((n, i) => nearPt(n, c.nodes[i], 0))
  assert.deepEqual(out.nodes[0], c.nodes[0])
  assert.deepEqual(out.nodes[3], c.nodes[3])
  // the opposite handles rotate to stay collinear but keep their length
  const len = (n, h) => Math.hypot(n[h].x - n.x, n[h].y - n.y)
  near(len(out.nodes[1], 'hi'), len(c.nodes[1], 'hi'), 1e-9)
  near(len(out.nodes[2], 'ho'), len(c.nodes[2], 'ho'), 1e-9)
  assert.equal(bendSegment(c, 9, 0.5, pt(1, 1)), c)
  const open = { closed: false, nodes: [{ x: 0, y: 0, hi: null, ho: null }, { x: 10, y: 0, hi: null, ho: null }] }
  assert.equal(bendSegment(open, 1, 0.5, pt(0, 5)), open)
})

// ---- push ----

test('push: no-ops return the same reference', () => {
  const rect = deepFreeze(rectContours(0, 0, 100, 100))
  assert.equal(pushContours(rect, pt(500, 500), pt(0, 10), 40, 0.7), rect)
  assert.equal(pushContours(rect, pt(50, 0), pt(0, 10), 40, 0), rect)
  assert.equal(pushContours(rect, pt(50, 0), pt(0, 0), 40, 0.7), rect)
})

test('push: the nearest node moves most, falloff is monotone, far nodes are identical', () => {
  const line = deepFreeze([{ closed: false, nodes: [pt(0, 100), pt(400, 100)].map((p) => ({ ...p, hi: null, ho: null })) }])
  const out = pushContours(line, pt(200, 100), pt(0, 20), 80, 0.7)[0].nodes
  assert.ok(out.length > 2)
  assert.deepEqual(out[0], line[0].nodes[0])
  assert.deepEqual(out.at(-1), line[0].nodes[1])
  const byDistance = out.map((n) => ({ d: Math.abs(n.x - 200), y: n.y - 100 })).sort((a, b) => a.d - b.d)
  byDistance.forEach((p, i) => { if (i) assert.ok(p.y <= byDistance[i - 1].y + 1e-9) })
  assert.ok(byDistance[0].y > 0.5 * 0.7 * 20 && byDistance[0].y <= 0.7 * 20)
  assert.ok(byDistance.filter((p) => p.d >= 80).every((p) => p.y === 0))
})

test('push: respects MAX_NODES, and pushing again in the same place adds no nodes', () => {
  const huge = deepFreeze(ellipseContours(0, 0, 1000, 1000))
  const out = pushContours(huge, pt(0, -1000), pt(0, 2), 3, 1)
  assert.ok(nodeCount(out) <= MAX_NODES && nodeCount(out) > 4)
  const c = deepFreeze(ellipseContours(200, 200, 150, 150))
  const first = pushContours(c, pt(200, 50), pt(0, 6), 60, 0.7)
  assert.ok(nodeCount(first) > 4)
  let again = first
  for (let i = 0; i < 5; i++) again = pushContours(again, pt(200, 50), pt(0, 6), 60, 0.7)
  assert.equal(nodeCount(again), nodeCount(first))
})

test("push: dragging a rect's top edge down leaves corners outside the radius alone", () => {
  const rect = deepFreeze(rectContours(0, 0, 300, 200))
  const out = pushContours(rect, pt(150, 0), pt(0, 30), 60, 0.8)[0].nodes
  for (const corner of rect[0].nodes) assert.deepEqual(out.find((n) => n.x === corner.x && n.y === corner.y), corner)
  const dent = out.filter((n) => n.y > 0 && n.y < 30 && n.x > 90 && n.x < 210)
  assert.ok(dent.length >= 3)
  assert.ok(Math.max(...out.map((n) => n.y)) <= 200)
})

// ---- distort ----

const quad = deepFreeze([pt(5, 8), pt(130, 20), pt(120, 90), pt(0, 70)])

test('distort: rect corners land on the quad corners; the centre lands on the diagonals’ crossing', () => {
  const rect = deepFreeze({ x: 10, y: 20, w: 100, h: 50 }), cs = deepFreeze(rectContours(10, 20, 100, 50))
  const out = distortContours(cs, rect, quad)[0].nodes
  out.forEach((n, i) => nearPt(n, quad[i]))
  const mid = distortContours([{ closed: true, nodes: [{ x: 60, y: 45, hi: null, ho: null }] }], rect, quad)[0].nodes[0]
  const [a, b, c, d] = quad, den = (a.x - c.x) * (b.y - d.y) - (a.y - c.y) * (b.x - d.x)
  const t1 = (a.x * c.y - a.y * c.x), t2 = (b.x * d.y - b.y * d.x)
  nearPt(mid, pt((t1 * (b.x - d.x) - (a.x - c.x) * t2) / den, (t1 * (b.y - d.y) - (a.y - c.y) * t2) / den), 1e-9)
})

test('distort: identity quad changes nothing; a parallelogram is the affine map', () => {
  const rect = { x: 10, y: 20, w: 100, h: 50 }, cs = deepFreeze(ellipseContours(60, 45, 50, 25))
  nearContours(distortContours(cs, rect, [pt(10, 20), pt(110, 20), pt(110, 70), pt(10, 70)]), cs)
  const o = pt(30, 5), u = pt(120, 10), v = pt(25, 80)
  const para = [o, pt(o.x + u.x, o.y + u.y), pt(o.x + u.x + v.x, o.y + u.y + v.y), pt(o.x + v.x, o.y + v.y)]
  const m = [u.x / 100, u.y / 100, v.x / 50, v.y / 50, 0, 0]
  m[4] = o.x - m[0] * 10 - m[2] * 20
  m[5] = o.y - m[1] * 10 - m[3] * 20
  nearContours(distortContours(cs, rect, para), transformContours(cs, m))
})

test('distort: non-convex quads and empty rects return the same reference', () => {
  const cs = deepFreeze(rectContours(0, 0, 10, 10)), rect = { x: 0, y: 0, w: 10, h: 10 }
  assert.equal(distortContours(cs, rect, [pt(0, 0), pt(10, 10), pt(10, 0), pt(0, 10)]), cs)
  assert.equal(distortContours(cs, { x: 0, y: 0, w: 0, h: 10 }, quad), cs)
  assert.equal(distortContours(cs, { x: 0, y: 0, w: 10, h: 0 }, quad), cs)
})

test('isConvexQuad', () => {
  assert.equal(isConvexQuad([pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)]), true)
  assert.equal(isConvexQuad([pt(0, 0), pt(0, 10), pt(10, 10), pt(10, 0)]), true) // other winding
  assert.equal(isConvexQuad(quad), true)
  assert.equal(isConvexQuad([pt(0, 0), pt(10, 10), pt(10, 0), pt(0, 10)]), false) // bow-tie
  assert.equal(isConvexQuad([pt(0, 0), pt(10, 0), pt(3, 3), pt(0, 10)]), false) // dart
  assert.equal(isConvexQuad([pt(0, 0), pt(5, 0), pt(10, 0), pt(15, 0)]), false) // flat
  assert.equal(isConvexQuad([pt(0, 0), pt(10, 0), pt(10, 10)]), false)
  assert.equal(isConvexQuad([pt(0, 0), pt(10, 0), pt(10, 10), pt(NaN, 10)]), false)
})

// ---- ink ----

test('ink: no samples gives nothing; one sample gives a circle of radius size/2', () => {
  assert.deepEqual(inkOutline([]), [])
  const dot = inkOutline(deepFreeze([{ x: 30, y: 40 }]), { size: 20 })
  assert.ok(dot.length >= 8)
  dot.forEach((p) => near(Math.hypot(p.x - 30, p.y - 40), 10, 1e-9))
})

test('ink: the polygon is closed, finite and does not repeat its first point', () => {
  const poly = inkOutline(deepFreeze(stroke(60, 3, (i) => ({ t: i * 16 }))), { size: 12 })
  assert.ok(poly.length >= 8)
  assert.ok(poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  assert.ok(Math.hypot(poly[0].x - poly.at(-1).x, poly[0].y - poly.at(-1).y) > 1e-9)
  assert.ok(poly.every((p, i) => i === 0 || Math.hypot(p.x - poly[i - 1].x, p.y - poly[i - 1].y) > 1e-9))
})

test('ink: even a two-sample flick has a body', () => {
  const poly = inkOutline([{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 16 }], { size: 12, streamline: 0 })
  assert.ok(poly.length >= 8)
  assert.ok(maxAbsY(poly, 4, 6) > 2)
})

test('ink: taper 1 narrows the ends; taper 0 keeps round, full-width ends', () => {
  const samples = deepFreeze(stroke(101, 2, (i) => ({ t: i * 16 }))), opts = { size: 20, thinning: 0, streamline: 0 }
  const tapered = inkOutline(samples, { ...opts, taper: 1 })
  assert.ok(maxAbsY(tapered, 8, 12) < 0.35 * maxAbsY(tapered, 98, 102))
  const round = inkOutline(samples, { ...opts, taper: 0 })
  near(maxAbsY(round, 0, 2), 10, 1e-9)
  near(Math.min(...round.map((p) => p.x)), -10, 1e-9) // round caps reach one radius past the ends
  near(Math.max(...round.map((p) => p.x)), 210, 1e-9)
})

test('ink: pen pressure ramp widens the high-pressure end', () => {
  const samples = deepFreeze(stroke(100, 2, (i) => ({ t: i * 16, p: 0.2 + (0.8 * i) / 99 })))
  const poly = inkOutline(samples, { size: 20, thinning: 1, taper: 0, streamline: 0 })
  assert.ok(maxAbsY(poly, 170, 200) > 2 * maxAbsY(poly, 0, 30))
})

test('ink: without pressure a faster half is thinner; thinning 0 gives constant width', () => {
  const slow = Array.from({ length: 80 }, (_, i) => ({ x: i, y: 0, t: i * 16 }))
  const fast = Array.from({ length: 50 }, (_, i) => ({ x: 80 + i * 8, y: 0, t: (80 + i) * 16 }))
  const samples = deepFreeze([...slow, ...fast]), opts = { size: 20, taper: 0, streamline: 0 }
  const thin = inkOutline(samples, { ...opts, thinning: 1 })
  assert.ok(maxAbsY(thin, 250, 450) < 0.9 * maxAbsY(thin, 20, 70))
  const flat = inkOutline(samples, { ...opts, thinning: 0 })
  flat.filter((p) => p.x > 0 && p.x < 472).forEach((p) => near(Math.abs(p.y), 10, 1e-9))
})

test('ink: streamline smooths a jittery stroke', () => {
  const zigzag = deepFreeze(stroke(80, 1, (i) => ({ t: i * 16 })).map((p, i) => ({ ...p, y: i % 2 ? 1.5 : -1.5 })))
  const opts = { size: 8, thinning: 0, taper: 0 }
  const wobble = (streamline) => maxAbsY(inkOutline(zigzag, { ...opts, streamline }), 10, 70) - 4 // beyond the radius
  assert.ok(wobble(0) > 1 && wobble(1) < 0.5 * wobble(0))
})

// ---- brush tool ----

function brushHarness({ bridge } = {}) {
  const dispatched = [], toolOpts = { brushSize: 16, thinning: 0.5, taper: 0.5 }
  const store = { getState: () => ({ toolOpts, style: { fill: '#112233', stroke: '#ff0000' } }), dispatch: (type, payload) => dispatched.push({ type, payload }) }
  const ctx = {
    store, bridge: bridge ?? { available: false }, view: { zoom: () => 2 }, requestOverlay() {},
    newItem: (contours, name, extra) => ({ contours, name, fill: '#112233', stroke: '#ff0000', ...extra }),
  }
  const ev = (sx, sy, down = true) => ({ x: sx / 2, y: sy / 2, sx, sy, down, time: sx * 4, pressure: 0 })
  return { tool: create(ctx), dispatched, ev }
}

test('brush: a drag adds a closed, filled Ink item; the overlay previews while dragging', () => {
  const { tool, dispatched, ev } = brushHarness()
  tool.onPointerDown(ev(10, 10))
  for (let x = 12; x <= 120; x += 4) tool.onPointerMove(ev(x, 10 + Math.sin(x / 15) * 8))
  assert.match(tool.renderOverlay(), /class="ov-ink"/)
  tool.onPointerUp(ev(120, 10))
  assert.equal(tool.renderOverlay(), '')
  assert.equal(dispatched.length, 1)
  const { type, payload } = dispatched[0], item = payload.items[0]
  assert.equal(type, 'addItems')
  assert.equal(item.name, 'Ink')
  assert.equal(item.stroke, null)
  assert.equal(item.contours[0].closed, true)
  assert.ok(item.contours[0].nodes.length >= 3)
  const b = contourBounds(item.contours[0])
  assert.ok(b.w > 40 && b.h > 3) // doc units: 110 screen px at zoom 2
})

test('brush: a tap makes a dot; a failing bridge falls back to a smoothed outline', () => {
  const bridge = { available: true, simplify() { throw new Error('boom') } }
  const { tool, dispatched, ev } = brushHarness({ bridge })
  tool.onPointerDown(ev(40, 40))
  tool.onPointerUp(ev(40, 40))
  const c = dispatched[0].payload.items[0].contours[0], b = contourBounds(c)
  assert.ok(c.nodes.length >= 3 && c.nodes.every(isSmooth))
  assert.ok(Math.abs(b.w - 8) < 1 && Math.abs(b.h - 8) < 1) // 16 screen px at zoom 2 = 8 doc units
})

test('brush: uses the bridge when available; cancel drops the stroke', () => {
  const calls = []
  const bridge = { available: true, simplify: (poly, o) => { calls.push(o); return { closed: true, nodes: poly.slice(0, 5).map((p) => ({ ...p, hi: null, ho: null })) } } }
  const { tool, dispatched, ev } = brushHarness({ bridge })
  tool.onPointerDown(ev(10, 10)); tool.onPointerMove(ev(60, 10)); tool.onPointerUp(ev(60, 10))
  assert.deepEqual(calls, [{ tolerance: 0.5, close: true }])
  assert.equal(dispatched.length, 1)
  tool.onPointerDown(ev(10, 10)); tool.onPointerMove(ev(60, 10))
  assert.equal(tool.cancel(), true)
  tool.onPointerUp(ev(60, 10))
  assert.equal(dispatched.length, 1)
})
