import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_STYLE, LIMITS, gridFor } from '../js/consts.js'
import { rectContours, lineContours } from '../js/geometry.js'
import {
  uid, makeNode, makeItem, makeDoc, exampleDoc, sanitizeItem, sanitizeDoc, serializeDoc, parseDoc,
  findItem, itemIndex, addItems, updateItems, replaceItems, removeItems, reorder, reorderTo, duplicateItems, setArtboard,
} from '../js/model.js'

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) Object.values(Object.freeze(o)).forEach(deepFreeze)
  return o
}
const box = (name, x = 0) => makeItem(rectContours(x, 0, 10, 10), {}, name)
const names = (doc) => doc.items.map((it) => it.name)
const stack = (...ns) => makeDoc({ items: ns.map((n) => box(n)) })

test('gridFor follows the artboard size', () => {
  assert.deepEqual([24, 512, 1024, 1920].map((n) => gridFor(n, n)), [1, 8, 16, 32])
})

test('makeNode and uid', () => {
  assert.deepEqual(makeNode(1, 2), { x: 1, y: 2, hi: null, ho: null })
  assert.notEqual(uid(), uid())
  assert.match(uid(), /^i[0-9a-z]+$/)
})

test('makeItem applies the default style', () => {
  const it = makeItem(rectContours(0, 0, 10, 10), {}, 'Box')
  assert.equal(it.name, 'Box')
  for (const [k, v] of Object.entries(DEFAULT_STYLE)) assert.equal(it[k], v, k)
  assert.deepEqual([it.op, it.visible, it.locked], ['add', true, false])
  assert.equal(makeItem(rectContours(0, 0, 1, 1)).name, 'Path')
})

test('makeItem merges style and ignores undefined values', () => {
  const it = makeItem(rectContours(0, 0, 10, 10), { fill: '#ff0000', stroke: '#000000', op: 'cut', opacity: undefined })
  assert.deepEqual([it.fill, it.stroke, it.op, it.opacity], ['#ff0000', '#000000', 'cut', 1])
})

test('makeItem turns all-open fills into strokes so the item is visible', () => {
  const line = makeItem(lineContours({ x: 0, y: 0 }, { x: 5, y: 5 }), { fill: '#ff0000', strokeWidth: 0.5 })
  assert.deepEqual([line.fill, line.stroke, line.strokeWidth], [null, '#ff0000', 2])
  assert.equal(makeItem(lineContours({ x: 0, y: 0 }, { x: 5, y: 5 })).stroke, DEFAULT_STYLE.fill)
  assert.equal(makeItem(lineContours({ x: 0, y: 0 }, { x: 5, y: 5 }), { strokeWidth: 6 }).strokeWidth, 6)
  // an explicit stroke, or any closed contour, leaves the style alone
  assert.equal(makeItem(lineContours({ x: 0, y: 0 }, { x: 1, y: 1 }), { stroke: '#00ff00' }).fill, DEFAULT_STYLE.fill)
  const mixed = [...rectContours(0, 0, 4, 4), ...lineContours({ x: 0, y: 0 }, { x: 1, y: 1 })]
  assert.equal(makeItem(mixed).fill, DEFAULT_STYLE.fill)
})

test('makeDoc defaults', () => {
  assert.deepEqual(makeDoc(), { v: 1, w: 512, h: 512, items: [] })
  assert.deepEqual(makeDoc({ w: 24, h: 24 }), { v: 1, w: 24, h: 24, items: [] })
})

test('exampleDoc is the ring, slit and core drawing', () => {
  const d = exampleDoc()
  assert.deepEqual(names(d), ['Disc', 'Window', 'Slit', 'Core'])
  assert.deepEqual(d.items.map((it) => it.op), ['add', 'cut', 'cut', 'add'])
  assert.deepEqual([d.w, d.h], [512, 512])
  assert.equal(d.items[3].fill, '#384ecb')
  assert.equal(d.items[2].contours[0].nodes.length, 4)
  assert.deepEqual(parseDoc(serializeDoc(d)), d, 'a valid doc passes sanitising unchanged')
})

test('sanitizeItem rejects non-finite numbers, short contours and junk', () => {
  const good = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }
  assert.equal(sanitizeItem(null), null)
  assert.equal(sanitizeItem('x'), null)
  assert.equal(sanitizeItem({}), null)
  assert.equal(sanitizeItem({ contours: [{ closed: true, nodes: [{ x: 0, y: 0 }] }] }), null)
  assert.equal(sanitizeItem({ contours: [{ closed: true, nodes: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }] }), null)
  const it = sanitizeItem({ contours: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }] })
  assert.equal(it.contours[0].nodes.length, 3, 'drops only the bad node')
  assert.equal(sanitizeItem({ contours: [good, { closed: false, nodes: [] }] }).contours.length, 1)
  const bad = sanitizeItem({ contours: [{ closed: true, nodes: [{ x: 0, y: 0, hi: { x: NaN, y: 0 } }, { x: 1, y: 1 }, { x: 2, y: 0 }] }] })
  assert.equal(bad.contours[0].nodes.length, 2, 'a node with an unusable handle is dropped')
})

test('sanitizeItem replaces bad enums and clamps numbers', () => {
  const it = sanitizeItem({
    contours: [{ nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    cap: 'sharp', join: 'x', fillRule: 'even', op: 'xor', opacity: 7, strokeWidth: -3, fill: 'red', stroke: '#ABC', visible: 0, id: '',
  })
  assert.deepEqual(
    [it.cap, it.join, it.fillRule, it.op, it.opacity, it.strokeWidth, it.fill, it.stroke, it.closed],
    [DEFAULT_STYLE.cap, DEFAULT_STYLE.join, 'nonzero', 'add', 1, 0, DEFAULT_STYLE.fill, '#aabbcc', undefined],
  )
  assert.equal(it.visible, true, 'only an explicit false hides')
  assert.equal(it.contours[0].closed, false)
  assert.match(it.id, /^i/)
  assert.equal(sanitizeItem({ contours: [{ nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], opacity: -1, fill: null, stroke: 12 }).opacity, 0)
  assert.equal(sanitizeItem({ contours: [{ nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], fill: null }).fill, null)
})

test('sanitizeDoc clamps the artboard, caps items and repairs ids', () => {
  const item = { contours: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] }
  assert.equal(sanitizeDoc(null), null)
  assert.equal(sanitizeDoc({ w: 10, h: 10 }), null)
  const d = sanitizeDoc({ w: 0, h: 99999, items: [item, { nope: 1 }, { ...item, id: 'a' }, { ...item, id: 'a' }] })
  assert.deepEqual([d.v, d.w, d.h, d.items.length], [1, LIMITS.artboardMin, LIMITS.artboardMax, 3])
  assert.equal(new Set(d.items.map((it) => it.id)).size, 3, 'duplicate ids are replaced')
  assert.equal(sanitizeDoc({ w: 'x', h: NaN, items: [] }).w, 512)
  assert.equal(sanitizeDoc({ items: Array.from({ length: LIMITS.maxItems + 20 }, () => item) }).items.length, LIMITS.maxItems)
})

test('serialize and parse round-trip; parseDoc never throws', () => {
  const doc = exampleDoc()
  assert.deepEqual(parseDoc(serializeDoc(doc)), doc)
  for (const bad of ['', 'nope', '{', '[]', 'null', '{"items":5}', undefined]) assert.equal(parseDoc(bad), null)
})

test('findItem and itemIndex', () => {
  const d = stack('A', 'B')
  assert.equal(findItem(d, d.items[1].id), d.items[1])
  assert.equal(findItem(d, 'zzz'), undefined)
  assert.equal(itemIndex(d, d.items[1].id), 1)
  assert.equal(itemIndex(d, 'zzz'), -1)
})

test('addItems inserts at an index and makes names unique', () => {
  const d = stack('A', 'B')
  const e = addItems(d, [box('Rectangle'), box('Rectangle')], 1)
  assert.deepEqual(names(e), ['A', 'Rectangle', 'Rectangle 2', 'B'])
  assert.deepEqual(names(addItems(e, [box('Rectangle')])), ['A', 'Rectangle', 'Rectangle 2', 'B', 'Rectangle 3'])
  assert.deepEqual(names(addItems(e, [box('Rectangle 2')])).slice(-1), ['Rectangle 3'])
  assert.equal(addItems(d, []), d)
  assert.deepEqual(names(addItems(d, [box('Z')], 99)), ['A', 'B', 'Z'])
  assert.deepEqual(names(addItems(d, [box('Z')], -4)), ['Z', 'A', 'B'])
})

test('updateItems takes a patch or a function and shares what did not change', () => {
  const d = stack('A', 'B', 'C')
  const [a, b, c] = d.items
  const e = updateItems(d, [b.id], { fill: '#ff0000' })
  assert.equal(e.items[1].fill, '#ff0000')
  assert.equal(e.items[0], a)
  assert.equal(e.items[2], c)
  assert.equal(updateItems(d, [b.id], { fill: b.fill }), d, 'a no-op patch keeps the doc')
  assert.equal(updateItems(d, ['missing'], { fill: '#fff' }), d)
  const f = updateItems(d, [a.id, c.id], (it) => ({ ...it, name: it.name + '!' }))
  assert.deepEqual(names(f), ['A!', 'B', 'C!'])
  assert.equal(f.items[1], b)
})

test('replaceItems and removeItems', () => {
  const d = stack('A', 'B', 'C')
  const b2 = { ...d.items[1], name: 'B2' }
  const e = replaceItems(d, [b2, box('stranger')])
  assert.deepEqual(names(e), ['A', 'B2', 'C'])
  assert.equal(replaceItems(d, [d.items[0]]), d)
  assert.deepEqual(names(removeItems(d, [d.items[0].id, d.items[2].id])), ['B'])
  assert.equal(removeItems(d, ['missing']), d)
})

test('reorder front, back, forward and backward keep relative order', () => {
  const d = stack('A', 'B', 'C', 'D', 'E')
  const id = (...ns) => ns.map((n) => d.items.find((it) => it.name === n).id)
  assert.deepEqual(names(reorder(d, id('B', 'D'), 'front')), ['A', 'C', 'E', 'B', 'D'])
  assert.deepEqual(names(reorder(d, id('B', 'D'), 'back')), ['B', 'D', 'A', 'C', 'E'])
  assert.deepEqual(names(reorder(d, id('B', 'D'), 'forward')), ['A', 'C', 'B', 'E', 'D'])
  assert.deepEqual(names(reorder(d, id('B', 'D'), 'backward')), ['B', 'A', 'D', 'C', 'E'])
  assert.deepEqual(names(reorder(d, id('B', 'C'), 'forward')), ['A', 'D', 'B', 'C', 'E'], 'a block moves as one')
  assert.deepEqual(names(reorder(d, id('D', 'E'), 'forward')), ['A', 'B', 'C', 'D', 'E'], 'already on top')
  assert.equal(reorder(d, id('D', 'E'), 'front'), d)
  assert.equal(reorder(d, id('A'), 'backward'), d)
})

test('reorderTo moves one item to an index', () => {
  const d = stack('A', 'B', 'C')
  assert.deepEqual(names(reorderTo(d, d.items[0].id, 2)), ['B', 'C', 'A'])
  assert.deepEqual(names(reorderTo(d, d.items[2].id, 0)), ['C', 'A', 'B'])
  assert.deepEqual(names(reorderTo(d, d.items[0].id, 99)), ['B', 'C', 'A'])
  assert.equal(reorderTo(d, d.items[1].id, 1), d)
  assert.equal(reorderTo(d, 'missing', 0), d)
})

test('duplicateItems places copies above the top-most source, offset, with new ids and names', () => {
  const d = stack('A', 'B', 'C')
  const { doc, ids } = duplicateItems(d, [d.items[0].id, d.items[1].id])
  assert.deepEqual(names(doc), ['A', 'B', 'A copy', 'B copy', 'C'])
  assert.deepEqual(doc.items.slice(2, 4).map((it) => it.id), ids)
  assert.equal(new Set(doc.items.map((it) => it.id)).size, 5)
  const n = doc.items[2].contours[0].nodes[0], o = d.items[0].contours[0].nodes[0]
  assert.deepEqual([n.x - o.x, n.y - o.y], [16, 16])
  assert.equal(duplicateItems(d, [d.items[0].id], 4).doc.items[1].contours[0].nodes[0].x, 4)
  const again = duplicateItems(doc, [doc.items[2].id])
  assert.equal(again.doc.items[3].name, 'A copy 2')
  assert.deepEqual(duplicateItems(d, ['missing']), { doc: d, ids: [] })
})

test('setArtboard clamps and keeps the doc when unchanged', () => {
  const d = makeDoc({ items: [box('A')] })
  const e = setArtboard(d, 0, 100000)
  assert.deepEqual([e.w, e.h], [LIMITS.artboardMin, LIMITS.artboardMax])
  assert.equal(e.items, d.items)
  assert.equal(setArtboard(d, 512, 512), d)
  assert.deepEqual([setArtboard(d, NaN, 64).w, setArtboard(d, NaN, 64).h], [512, 64])
})

test('no edit mutates a deep-frozen doc, and untouched items are shared', () => {
  const d = deepFreeze(stack('A', 'B', 'C'))
  const snapshot = JSON.stringify(d)
  const [a, b] = d.items
  const results = [
    addItems(d, [box('N')], 1), updateItems(d, [a.id], { fill: '#fff' }), updateItems(d, [a.id], (it) => ({ ...it, name: 'x' })),
    replaceItems(d, [{ ...b, name: 'B2' }]), removeItems(d, [a.id]), reorder(d, [a.id], 'front'),
    reorder(d, [b.id], 'backward'), reorderTo(d, a.id, 2), duplicateItems(d, [a.id, b.id]).doc, setArtboard(d, 64, 64),
  ]
  assert.equal(JSON.stringify(d), snapshot)
  for (const r of results) assert.notEqual(r, d)
  assert.equal(results[0].items[0], a)
  assert.equal(results[4].items[0], b)
  assert.equal(results[9].items, d.items)
  assert.doesNotThrow(() => sanitizeItem(deepFreeze(box('F'))))
  assert.doesNotThrow(() => sanitizeDoc(deepFreeze(stack('X'))))
  assert.doesNotThrow(() => serializeDoc(d))
})
