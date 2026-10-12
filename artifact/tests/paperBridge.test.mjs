import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridge } from '../js/paperBridge.js'
import { makeItem } from '../js/model.js'
import { rectContours, ellipseContours, lineContours, contoursToD, boundsOf } from '../js/geometry.js'

// Paper is only needed for the real bridge; without it the whole suite below is skipped.
let paper = null
try { paper = (await import('paper')).default } catch { /* skipped below */ }
const skip = paper ? false : 'paper is not installed'
const bridge = createBridge(paper)

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) Object.values(Object.freeze(o)).forEach(deepFreeze)
  return o
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} is not within ${eps} of ${b}`)
const sq = (x, y, s, style = {}) => makeItem(rectContours(x, y, s, s), style, 'Sq')
const A = sq(0, 0, 10), B = sq(5, 5, 10) // overlap 5 × 5 → union 175, A−B 75, A∩B 25, A⊕B 150

test('without Paper the bridge is unavailable and every method throws {code:"unavailable"}', () => {
  for (const b of [createBridge(null), createBridge(undefined), createBridge({})]) {
    assert.equal(b.available, false)
    for (const m of ['parsePathData', 'booleanOp', 'flatten', 'simplify', 'importSvg', 'area']) {
      assert.throws(() => b[m]([]), { code: 'unavailable' }, m)
    }
  }
})

test('with Paper the bridge reports available', { skip }, () => {
  assert.equal(bridge.available, true)
})

test('area: squares, circles, holes and overlaps follow the nonzero rule', { skip }, () => {
  near(bridge.area(A.contours), 100, 1e-9)
  near(bridge.area(ellipseContours(0, 0, 10, 10)), Math.PI * 100, 0.5)
  const hole = [...rectContours(0, 0, 10, 10), { ...rectContours(2, 2, 4, 4)[0], nodes: rectContours(2, 2, 4, 4)[0].nodes.slice().reverse() }]
  near(bridge.area(hole), 84, 1e-9)
  near(bridge.area([...A.contours, ...rectContours(2, 2, 4, 4)]), 100, 1e-9) // same winding: no hole
  near(bridge.area([...A.contours, ...B.contours]), 175, 1e-9)
  assert.equal(bridge.area([]), 0)
})

test('booleanOp: union, subtract, intersect and exclude of two squares', { skip }, () => {
  const area = (kind) => bridge.area(bridge.booleanOp([A, B], kind))
  near(area('union'), 175, 1e-6)
  near(area('subtract'), 75, 1e-6)
  near(area('intersect'), 25, 1e-6)
  near(area('exclude'), 150, 1e-6)
  near(bridge.area(bridge.booleanOp([B, A], 'subtract')), 75, 1e-6, 'subtract is ordered')
})

test('booleanOp: subtract removes every later item from the first; union and exclude fold', { skip }, () => {
  const C = sq(0, 0, 4)
  near(bridge.area(bridge.booleanOp([A, B, C], 'subtract')), 75 - 16, 1e-6)
  near(bridge.area(bridge.booleanOp([A, B, C], 'union')), 175, 1e-6)
  near(bridge.area(bridge.booleanOp([A, B, C], 'intersect')), 0, 1e-6)
  near(bridge.area(bridge.booleanOp([A, B, sq(7, 7, 2)], 'exclude')), 150 + 4, 1e-6, 'a square inside the overlap fills it again')
})

test('booleanOp: edge cases', { skip }, () => {
  assert.deepEqual(bridge.booleanOp([], 'union'), [])
  assert.throws(() => bridge.booleanOp([A, B], 'blend'), { code: 'bad_request' })
  const alone = bridge.booleanOp([A], 'union')
  near(bridge.area(alone), 100, 1e-9)
  assert.deepEqual(bridge.booleanOp([sq(0, 0, 10), sq(20, 20, 5)], 'intersect'), [], 'disjoint intersect is empty')
  const lone = makeItem(lineContours({ x: 0, y: 0 }, { x: 5, y: 5 }))
  near(bridge.area(bridge.booleanOp([A, lone], 'union')), 100, 1e-9, 'open contours are closed, a line has no area')
})

test('booleanOp respects fill rules and leaves its inputs alone', { skip }, () => {
  const star = (rule) => makeItem([{ closed: true, nodes: [0, 2, 4, 1, 3].map((i) => ({ x: 50 * Math.cos(-Math.PI / 2 + i * 1.2566370614) , y: 50 * Math.sin(-Math.PI / 2 + i * 1.2566370614), hi: null, ho: null })) }], { fillRule: rule })
  const far = sq(500, 500, 1)
  const nonzero = bridge.area(bridge.booleanOp([star('nonzero'), far], 'union')) - 1
  const evenodd = bridge.area(bridge.booleanOp([star('evenodd'), far], 'union')) - 1
  assert.ok(evenodd < nonzero - 100, `evenodd leaves the pentagon hole (${evenodd} < ${nonzero})`)
  const frozen = deepFreeze([sq(0, 0, 10), sq(5, 5, 10)])
  assert.doesNotThrow(() => bridge.booleanOp(frozen, 'union'))
})

test('results use absolute handles and null for zero-length ones', { skip }, () => {
  for (const c of bridge.booleanOp([A, B], 'union')) {
    assert.equal(c.closed, true)
    for (const n of c.nodes) assert.deepEqual([n.hi, n.ho], [null, null])
  }
  const circle = bridge.booleanOp([makeItem(ellipseContours(100, 100, 20, 20)), makeItem(ellipseContours(100, 100, 5, 5))], 'subtract')
  const b = boundsOf([makeItem(circle)])
  near(b.x, 80, 0.1); near(b.w, 40, 0.1)
  const handles = circle.flatMap((c) => c.nodes).flatMap((n) => [n.hi, n.ho]).filter(Boolean)
  assert.ok(handles.length > 0)
  for (const h of handles) assert.ok(h.x > 70 && h.x < 130 && h.y > 70 && h.y < 130, 'handles are absolute positions near the shape')
})

test('flatten: add, cut, add folds in order', { skip }, () => {
  const cut = sq(5, 5, 10, { op: 'cut' })
  const far = sq(20, 0, 10)
  const r = bridge.flatten([A, cut, far])
  near(bridge.area(r.contours), 75 + 100, 1e-6)
  assert.deepEqual(r.warnings, [])
  // a later add paints back over the hole: C covers [4,8]²
  const back = bridge.flatten([A, cut, sq(4, 4, 4)])
  near(bridge.area(back.contours), 75 + 9, 1e-6)
  // the same add placed BEFORE the cut is erased by it
  near(bridge.area(bridge.flatten([A, sq(4, 4, 4), cut]).contours), 75, 1e-6)
})

test('flatten: leading cuts and hidden items are skipped, and the doc rules match render', { skip }, () => {
  const cut = sq(5, 5, 10, { op: 'cut' })
  near(bridge.area(bridge.flatten([cut, A]).contours), 100, 1e-6)
  assert.deepEqual(bridge.flatten([cut]).contours, [])
  assert.deepEqual(bridge.flatten([]), { contours: [], warnings: [] })
  near(bridge.area(bridge.flatten([A, { ...sq(30, 0, 10), visible: false }, { ...cut, visible: false }]).contours), 100, 1e-6)
  const holes = bridge.flatten([sq(0, 0, 20), sq(5, 5, 10, { op: 'cut' })])
  near(bridge.area(holes.contours), 300, 1e-6)
  assert.equal(holes.contours.length, 2, 'a ring: outer contour and a hole')
})

test('flatten warns about strokes and open paths, and uses fills only', { skip }, () => {
  const stroked = sq(30, 0, 10, { stroke: '#000000' })
  assert.deepEqual(bridge.flatten([stroked]).warnings, ['Strokes were left out.'])
  const outline = sq(0, 0, 10, { fill: null, stroke: '#000000' })
  assert.deepEqual(bridge.flatten([outline]), { contours: [], warnings: ['Strokes were left out.'] })
  const open = makeItem([{ closed: false, nodes: rectContours(0, 0, 10, 10)[0].nodes }], { fill: '#112233', stroke: null })
  const fillOpen = { ...open, fill: '#112233', stroke: null }
  const r = bridge.flatten([fillOpen])
  assert.deepEqual(r.warnings, ['Open paths were closed.'])
  near(bridge.area(r.contours), 100, 1e-9)
})

test('simplify: a noisy circle collapses to a few nodes, closed on request', { skip }, () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2
  const pts = Array.from({ length: 80 }, (_, i) => {
    const t = (i / 80) * Math.PI * 2
    return { x: 100 + 50 * Math.cos(t) + rnd(), y: 100 + 50 * Math.sin(t) + rnd() }
  })
  const closed = bridge.simplify(pts, { close: true })
  assert.equal(closed.closed, true)
  assert.ok(closed.nodes.length >= 3 && closed.nodes.length <= 16, `${closed.nodes.length} nodes`)
  const open = bridge.simplify(pts, { tolerance: 2.5 })
  assert.equal(open.closed, false)
  assert.ok(open.nodes.length <= 16)
  const b = boundsOf([makeItem([closed])]) // a coarse fit at tolerance 2.5, but still the same circle
  near(b.x + b.w / 2, 100, 4); near(b.y + b.h / 2, 100, 4); near(b.w, 100, 10); near(b.h, 100, 10)
  assert.ok(closed.nodes.some((n) => n.hi || n.ho), 'a curve fit, not a polygon')
  assert.ok(bridge.simplify(pts, { tolerance: 20, close: true }).nodes.length <= closed.nodes.length)
})

test('simplify: too few points give null; a straight run stays straight', { skip }, () => {
  assert.equal(bridge.simplify([]), null)
  assert.equal(bridge.simplify([{ x: 1, y: 1 }]), null)
  assert.equal(bridge.simplify([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }]), null)
  const line = bridge.simplify(Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 0 })))
  assert.equal(line.nodes.length, 2)
  assert.deepEqual([line.nodes[0].x, line.nodes[1].x], [0, 95])
})

test('parsePathData round-trips absolute handles', { skip }, () => {
  const [c] = bridge.parsePathData('M10 10 C 20 0 40 0 50 10 L 50 30 Z')
  assert.equal(c.closed, true)
  assert.deepEqual(c.nodes, [
    { x: 10, y: 10, hi: null, ho: { x: 20, y: 0 } },
    { x: 50, y: 10, hi: { x: 40, y: 0 }, ho: null },
    { x: 50, y: 30, hi: null, ho: null },
  ])
  assert.equal(contoursToD([c]), 'M 10 10 C 20 0 40 0 50 10 L 50 30 Z')
  const [open] = bridge.parsePathData('M0 0 C 0 100 100 100 100 0')
  assert.deepEqual(open, { closed: false, nodes: [{ x: 0, y: 0, hi: null, ho: { x: 0, y: 100 } }, { x: 100, y: 0, hi: { x: 100, y: 100 }, ho: null }] })
  // our own output survives a trip through Paper unchanged
  const ring = ellipseContours(50, 50, 30, 20)
  const back = bridge.parsePathData(contoursToD(ring, 6))
  assert.equal(back.length, 1)
  assert.equal(back[0].closed, true)
  for (const [i, n] of ring[0].nodes.entries()) {
    for (const k of ['x', 'y']) near(back[0].nodes[i][k], n[k], 1e-4)
    for (const h of ['hi', 'ho']) for (const k of ['x', 'y']) near(back[0].nodes[i][h][k], n[h][k], 1e-4)
  }
})

test('parsePathData handles relative commands, H/V, S, Q, T, arcs and several subpaths', { skip }, () => {
  const [r] = bridge.parsePathData('m 10 10 h 20 v 20 h -20 z')
  assert.equal(contoursToD([r]), 'M 10 10 L 30 10 L 30 30 L 10 30 Z')
  const [s] = bridge.parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0')
  assert.equal(s.nodes.length, 3)
  near(s.nodes[1].ho.x, 10, 1e-9); near(s.nodes[1].ho.y, -10, 1e-9) // S reflects the previous handle
  const [q] = bridge.parsePathData('M0 0 Q 5 10 10 0 T 20 0')
  assert.equal(q.nodes.length, 3)
  assert.ok(q.nodes[0].ho && q.nodes[1].hi && q.nodes[1].ho)
  const arc = bridge.parsePathData('M 0 0 A 10 10 0 0 1 20 0')
  const b = boundsOf([makeItem(arc)])
  near(b.w, 20, 1e-6); near(b.h, 10, 0.05)
  const two = bridge.parsePathData('M0 0 h10 v10 h-10 z M20 0 h5 v5 h-5 z')
  assert.equal(two.length, 2)
  assert.ok(two.every((c) => c.closed && c.nodes.length === 4))
  near(bridge.area(two), 125, 1e-9)
})

test('parsePathData throws on invalid data', { skip }, () => {
  for (const bad of ['', '   ', 'hello', 'L 10 10', 'M', 'M 5 5', 'M 0 0 L 1 1 <script>', 42, null, undefined]) {
    assert.throws(() => bridge.parsePathData(bad), { code: 'invalid_path' }, String(bad))
  }
})

test('the bridge is reusable: calls do not leak state into each other', { skip }, () => {
  for (let i = 0; i < 5; i++) near(bridge.area(bridge.booleanOp([A, B], 'union')), 175, 1e-6)
  assert.equal(paper.project?.activeLayer?.children?.length ?? 0, 0, 'nothing leaks into the global project')
  assert.throws(() => bridge.parsePathData('nonsense'))
  near(bridge.area(A.contours), 100, 1e-9, 'still healthy after an error')
})

test('importSvg needs a browser DOM and says so', { skip }, () => {
  if (typeof globalThis.DOMParser === 'undefined') assert.throws(() => bridge.importSvg('<svg/>'), { code: 'unsupported' })
})
