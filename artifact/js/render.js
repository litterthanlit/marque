// SVG output, the single source for both the canvas and the export. Pure: returns strings.
//
// The stack is folded bottom to top into one accumulator. An `add` appends a <path>. A `cut` wraps
// everything accumulated so far in <g mask>, so it erases only what lies beneath it and a later
// `add` paints back over the hole. Several cuts nest.

import { contoursToD, formatNumber } from './geometry.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Attributes equal to the SVG defaults are left out.
function pathEl(it, precision, id = null) {
  const num = (n) => formatNumber(n, precision)
  const a = [`d="${contoursToD(it.contours, precision)}"`, `fill="${it.fill ?? 'none'}"`]
  if (it.fill !== null && it.fillRule === 'evenodd') a.push('fill-rule="evenodd"')
  if (it.stroke !== null) {
    a.push(`stroke="${it.stroke}"`)
    if (it.strokeWidth !== 1) a.push(`stroke-width="${num(it.strokeWidth)}"`)
    if (it.cap !== 'butt') a.push(`stroke-linecap="${it.cap}"`)
    if (it.join !== 'miter') a.push(`stroke-linejoin="${it.join}"`)
  }
  if (it.opacity < 1) a.push(`opacity="${num(it.opacity)}"`)
  if (id !== null) a.push(`data-id="${esc(id)}"`)
  return `<path ${a.join(' ')}/>`
}

// Defs (one mask per cut that has something beneath it) followed by the stack. No <svg> wrapper.
export function renderBody(doc, { clip = false, precision = 2, ids = false } = {}) {
  const [x, y, w, h] = clip ? [0, 0, doc.w, doc.h] : [-50000, -50000, 100000, 100000] // clip = the artboard
  const region = `x="${x}" y="${y}" width="${w}" height="${h}"`
  let acc = '', defs = '', n = 0
  for (const it of doc.items) {
    if (!it.visible) continue
    if (it.op !== 'cut') {
      acc += pathEl(it, precision, ids ? it.id : null)
      continue
    }
    if (!acc || (it.fill === null && it.stroke === null)) continue // nothing beneath, or nothing to erase with
    const black = { ...it, fill: it.fill && '#000', stroke: it.stroke && '#000', opacity: 1 } // colours and opacity are ignored
    const id = `mk${n++}`
    defs += `<mask id="${id}" maskUnits="userSpaceOnUse" ${region}><rect ${region} fill="#fff"/>${pathEl(black, precision)}</mask>`
    acc = `<g mask="url(#${id})">${acc}</g>`
  }
  return (defs ? `<defs>${defs}</defs>` : '') + acc
}

// One element per line, indented. Safe because our markup has no text nodes.
function prettify(svg) {
  let depth = 0
  return svg.replace(/></g, '>\n<').split('\n').map((line) => {
    const closing = line.startsWith('</')
    if (closing) depth--
    const out = '  '.repeat(depth) + line
    if (!closing && !line.endsWith('/>')) depth++
    return out
  }).join('\n')
}

export function renderSvg(doc, { background = null, precision = 2, pretty = true } = {}) {
  const w = formatNumber(doc.w, precision), h = formatNumber(doc.h, precision)
  const bg = background ? `<rect width="${w}" height="${h}" fill="${esc(background)}"/>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + bg + renderBody(doc, { clip: true, precision }) + '</svg>'
  return pretty ? prettify(svg) : svg
}
