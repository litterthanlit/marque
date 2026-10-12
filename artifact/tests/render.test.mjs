import test from 'node:test'
import assert from 'node:assert/strict'
import { renderBody, renderSvg } from '../js/render.js'
import { makeItem, makeDoc, exampleDoc } from '../js/model.js'
import { rectContours, lineContours } from '../js/geometry.js'

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) Object.values(Object.freeze(o)).forEach(deepFreeze)
  return o
}
const rect = (name, x, style = {}) => makeItem(rectContours(x, 0, 10, 10), style, name)
const doc = (...items) => makeDoc({ w: 100, h: 80, items })
const count = (s, re) => (s.match(re) || []).length
const A = rect('A', 0, { fill: '#aa0000' }), B = rect('B', 5, { op: 'cut' }), C = rect('C', 20, { fill: '#00aa00' })

test('add, cut, add yields exactly one mask, and the last add sits outside the masked group', () => {
  const body = renderBody(doc(A, B, C))
  assert.equal(count(body, /<mask /g), 1)
  assert.equal(count(body, /<path /g), 3, 'two adds and the cut shape inside the mask')
  const group = /<g mask="url\(#mk0\)">(.*?)<\/g>/.exec(body)
  assert.ok(group, 'one masked group')
  assert.ok(group[1].includes('#aa0000'))
  assert.ok(!group[1].includes('#00aa00'), 'the later add is not masked')
  assert.ok(body.endsWith(`</g><path d="M 20 0 L 30 0 L 30 10 L 20 10 Z" fill="#00aa00"/>`))
})

test('the mask paints the region white and the cut shape black', () => {
  const body = renderBody(doc(A, B))
  const mask = /<mask [^>]*>.*?<\/mask>/.exec(body)[0]
  assert.match(mask, /<rect [^>]*fill="#fff"\/>/)
  assert.match(mask, /<path d="M 5 0 L 15 0 L 15 10 L 5 10 Z" fill="#000"\/>/)
  assert.ok(body.startsWith('<defs><mask id="mk0" maskUnits="userSpaceOnUse"'))
})

test('the cut ignores its own colour and opacity', () => {
  const a = renderBody(doc(A, rect('B', 5, { op: 'cut', fill: '#123456', opacity: 0.2 })))
  const b = renderBody(doc(A, B))
  assert.equal(a, b)
  assert.ok(!a.includes('#123456'))
})

test('a stroke-only cut erases with its stroke; fill and stroke both paint black', () => {
  const stroked = renderBody(doc(A, rect('S', 5, { op: 'cut', fill: null, stroke: '#ff00ff', strokeWidth: 4, cap: 'butt', join: 'miter' })))
  assert.match(stroked, /<mask .*<path d="[^"]*" fill="none" stroke="#000" stroke-width="4"\/><\/mask>/)
  const both = renderBody(doc(A, rect('S', 5, { op: 'cut', stroke: '#ff00ff', strokeWidth: 4, cap: 'round', join: 'bevel' })))
  assert.match(both, /fill="#000" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="bevel"\/><\/mask>/)
  assert.ok(!both.includes('#ff00ff'))
})

test('two cuts nest, the later one outermost', () => {
  const body = renderBody(doc(A, B, rect('B2', 8, { op: 'cut' })))
  assert.equal(count(body, /<mask /g), 2)
  assert.match(body, /<g mask="url\(#mk1\)"><g mask="url\(#mk0\)"><path [^>]*#aa0000[^>]*\/><\/g><\/g>$/)
})

test('a cut only erases what lies beneath it', () => {
  const body = renderBody(doc(A, C, B))
  assert.match(body, /<g mask="url\(#mk0\)"><path [^>]*#aa0000[^>]*\/><path [^>]*#00aa00[^>]*\/><\/g>$/, 'the cut covers both adds below it')
  const above = renderBody(doc(A, B, C))
  assert.ok(above.indexOf('#00aa00') > above.indexOf('</g>'))
})

test('a leading cut is dropped, as is a cut after only hidden items', () => {
  const lead = renderBody(doc(B, A))
  assert.ok(!lead.includes('<mask'))
  assert.equal(lead, renderBody(doc(A)))
  assert.equal(count(renderBody(doc(B, B, A)), /<mask/g), 0)
  const hiddenFirst = renderBody(doc({ ...A, visible: false }, B))
  assert.equal(hiddenFirst, '')
  assert.equal(renderBody(doc()), '')
})

test('hidden items are skipped', () => {
  const body = renderBody(doc(A, { ...C, visible: false }))
  assert.ok(!body.includes('#00aa00'))
  const hiddenCut = renderBody(doc(A, { ...B, visible: false }))
  assert.ok(!hiddenCut.includes('<mask'))
  assert.equal(renderBody(doc(A, { ...B, visible: false }, C)), renderBody(doc(A, C)))
})

test('output is deterministic and mask ids restart for every call', () => {
  const d = doc(A, B, C, rect('B2', 2, { op: 'cut' }))
  assert.equal(renderBody(d), renderBody(d))
  assert.equal(renderSvg(d), renderSvg(d))
  assert.deepEqual(renderBody(d).match(/id="mk\d+"/g), ['id="mk0"', 'id="mk1"'])
  assert.equal(renderBody(exampleDoc()).replace(/data-id="[^"]*"/g, ''), renderBody(exampleDoc(), { ids: false }))
})

test('the mask region is the artboard when clipping, else a very large box', () => {
  const d = doc(A, B)
  assert.match(renderBody(d, { clip: true }), /<mask [^>]*x="0" y="0" width="100" height="80"><rect x="0" y="0" width="100" height="80" fill="#fff"\/>/)
  assert.match(renderBody(d), /<mask [^>]*x="-50000" y="-50000" width="100000" height="100000"><rect x="-50000" y="-50000" width="100000" height="100000"/)
})

test('a cut with neither fill nor stroke has nothing to erase with and adds no mask', () => {
  assert.equal(renderBody(doc(A, rect('N', 5, { op: 'cut', fill: null }))), renderBody(doc(A)))
})

test('path attributes: defaults omitted, the rest present', () => {
  const plain = renderBody(doc(rect('P', 0, { fill: '#112233', cap: 'butt', join: 'miter' })))
  assert.equal(plain, '<path d="M 0 0 L 10 0 L 10 10 L 0 10 Z" fill="#112233"/>')
  const full = renderBody(doc(rect('P', 0, {
    fill: '#112233', fillRule: 'evenodd', stroke: '#445566', strokeWidth: 3.456, cap: 'square', join: 'round', opacity: 0.5,
  })))
  assert.equal(full, '<path d="M 0 0 L 10 0 L 10 10 L 0 10 Z" fill="#112233" fill-rule="evenodd" stroke="#445566" stroke-width="3.46" stroke-linecap="square" stroke-linejoin="round" opacity="0.5"/>')
  const none = renderBody(doc(rect('P', 0, { fill: null, stroke: '#000000', strokeWidth: 1, cap: 'butt', join: 'miter' })))
  assert.equal(none, '<path d="M 0 0 L 10 0 L 10 10 L 0 10 Z" fill="none" stroke="#000000"/>')
  const line = renderBody(doc(makeItem(lineContours({ x: 0, y: 0 }, { x: 9, y: 9 }), { fill: '#abcdef' })))
  assert.match(line, /fill="none" stroke="#abcdef" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"\/>$/)
})

test('ids: true adds data-id to add paths only', () => {
  const body = renderBody(doc(A, B), { ids: true })
  assert.ok(body.includes(`data-id="${A.id}"`))
  assert.ok(!body.includes(B.id))
  assert.ok(!renderBody(doc(A)).includes('data-id'))
  const odd = renderBody(doc({ ...A, id: 'a"<b' }), { ids: true })
  assert.ok(odd.includes('data-id="a&quot;&lt;b"'))
})

test('precision rounds path data', () => {
  const d = doc(makeItem(lineContours({ x: 0.123456, y: 0 }, { x: 5.987654, y: 1 }), {}))
  assert.ok(renderBody(d).includes('M 0.12 0 L 5.99 1'))
  assert.ok(renderBody(d, { precision: 4 }).includes('M 0.1235 0 L 5.9877 1'))
  assert.ok(renderBody(d, { precision: 0 }).includes('M 0 0 L 6 1'))
})

test('renderSvg wraps the body with a viewBox, clips the mask to the artboard and can add a background', () => {
  const svg = renderSvg(doc(A, B), { pretty: false })
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">'))
  assert.ok(svg.endsWith('</svg>'))
  assert.match(svg, /<mask [^>]*x="0" y="0" width="100" height="80">/)
  assert.ok(!svg.includes('<rect width="100" height="80"'))
  const bg = renderSvg(doc(A), { pretty: false, background: '#ffffff' })
  assert.ok(bg.includes('viewBox="0 0 100 80"><rect width="100" height="80" fill="#ffffff"/><path'))
  assert.equal(renderSvg(makeDoc({ w: 24, h: 24 }), { pretty: false }), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"></svg>')
})

test('renderSvg pretty prints one element per line and means the same thing', () => {
  const d = doc(A, B, C)
  const pretty = renderSvg(d), compact = renderSvg(d, { pretty: false })
  assert.ok(pretty.split('\n').length > 6)
  assert.equal(pretty.replace(/\n\s*/g, ''), compact)
  assert.ok(pretty.split('\n').every((l) => !l.includes('><')))
  assert.match(pretty, /\n {2}<defs>\n {4}<mask /)
  assert.ok(pretty.endsWith('</svg>'))
})

test('the example drawing renders a ring, a slit and a core above both', () => {
  const svg = renderSvg(exampleDoc(), { pretty: false })
  assert.equal(count(svg, /<mask /g), 2)
  assert.ok(svg.indexOf('#384ecb') > svg.lastIndexOf('</g>'), 'the core paints above the masked disc')
  assert.ok(svg.includes('viewBox="0 0 512 512"'))
})

test('rendering does not mutate a frozen doc', () => {
  const d = deepFreeze(doc(A, B, C))
  assert.doesNotThrow(() => { renderBody(d, { ids: true }); renderSvg(d, { background: '#fff' }) })
})
