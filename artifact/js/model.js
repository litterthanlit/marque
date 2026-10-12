// Document model: constructors, validation and immutable edits. Pure: no DOM, no Paper.
// Every function returns new objects and shares whatever did not change.

import { DEFAULT_STYLE, LIMITS } from './consts.js'
import { ellipseContours, mat, transformContours } from './geometry.js'

const CAPS = ['butt', 'round', 'square']
const JOINS = ['miter', 'round', 'bevel']
const RULES = ['nonzero', 'evenodd']
const OPS = ['add', 'cut']

export const uid = () => 'i' + Math.floor(Math.random() * 36 ** 7).toString(36).padStart(7, '0')

export const makeNode = (x, y, hi = null, ho = null) => ({ x, y, hi, ho })

// Open paths with no stroke would be invisible, so they become strokes in what was the fill colour.
export function makeItem(contours, style = {}, name = 'Path') {
  const set = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined))
  const s = { ...DEFAULT_STYLE, ...set }
  if (contours.length && contours.every((c) => !c.closed) && s.stroke === null) {
    s.stroke = style.fill ?? DEFAULT_STYLE.fill
    s.fill = null
    s.strokeWidth = Math.max(2, style.strokeWidth ?? 2)
  }
  return {
    id: uid(), name, contours,
    fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, cap: s.cap, join: s.join, fillRule: s.fillRule,
    op: s.op ?? 'add', opacity: s.opacity, visible: s.visible ?? true, locked: s.locked ?? false,
  }
}

export const makeDoc = ({ w = 512, h = 512, items = [] } = {}) => ({ v: 1, w, h, items })

// A ring cut by a diagonal slit, with a core that sits above both cuts and paints back over them.
export function exampleDoc() {
  const slit = [{ closed: true, nodes: [[59.5, 427.1], [84.9, 452.5], [452.5, 84.9], [427.1, 59.5]].map(([x, y]) => makeNode(x, y)) }]
  return makeDoc({ items: [
    makeItem(ellipseContours(256, 256, 208, 208), {}, 'Disc'),
    makeItem(ellipseContours(256, 256, 136, 136), { op: 'cut' }, 'Window'),
    makeItem(slit, { op: 'cut' }, 'Slit'),
    makeItem(ellipseContours(256, 256, 72, 72), { fill: '#384ecb' }, 'Core'),
  ] })
}

// ---- Validation (for anything read from outside: storage, files, assist) ----

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const safe = (fn) => (raw) => { try { return fn(raw) } catch { return null } }

function sanitizeColor(v, fallback) {
  if (v === null) return null
  const m = typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return fallback
  return '#' + (m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]).toLowerCase()
}

// undefined means "unusable": the node is dropped
const sanitizeHandle = (h) => (h == null ? null : num(h?.x) && num(h?.y) ? { x: h.x, y: h.y } : undefined)

function sanitizeContour(c) {
  const nodes = []
  for (const n of Array.isArray(c?.nodes) ? c.nodes : []) {
    const hi = sanitizeHandle(n?.hi), ho = sanitizeHandle(n?.ho)
    if (num(n?.x) && num(n?.y) && hi !== undefined && ho !== undefined) nodes.push({ x: n.x, y: n.y, hi, ho })
  }
  return nodes.length >= 2 ? { closed: c.closed === true, nodes } : null
}

export const sanitizeItem = safe((raw) => {
  const contours = (Array.isArray(raw?.contours) ? raw.contours : []).map(sanitizeContour).filter(Boolean)
  if (!contours.length) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 80) : 'Path',
    contours,
    fill: sanitizeColor(raw.fill === undefined ? DEFAULT_STYLE.fill : raw.fill, DEFAULT_STYLE.fill),
    stroke: sanitizeColor(raw.stroke ?? null, null),
    strokeWidth: num(raw.strokeWidth) ? Math.max(0, raw.strokeWidth) : DEFAULT_STYLE.strokeWidth,
    cap: pick(raw.cap, CAPS, DEFAULT_STYLE.cap),
    join: pick(raw.join, JOINS, DEFAULT_STYLE.join),
    fillRule: pick(raw.fillRule, RULES, DEFAULT_STYLE.fillRule),
    op: pick(raw.op, OPS, 'add'),
    opacity: num(raw.opacity) ? clamp(raw.opacity, 0, 1) : 1,
    visible: raw.visible !== false,
    locked: raw.locked === true,
  }
})

export const sanitizeDoc = safe((raw) => {
  if (!Array.isArray(raw?.items)) return null
  const size = (v) => (num(v) ? clamp(Math.round(v), LIMITS.artboardMin, LIMITS.artboardMax) : 512)
  const seen = new Set()
  const items = raw.items.map(sanitizeItem).filter(Boolean).slice(0, LIMITS.maxItems).map((it) => {
    if (seen.has(it.id)) it = { ...it, id: uid() } // duplicate ids would break selection
    seen.add(it.id)
    return it
  })
  return makeDoc({ w: size(raw.w), h: size(raw.h), items })
})

export const serializeDoc = (doc) => JSON.stringify(doc)
export const parseDoc = safe((text) => sanitizeDoc(JSON.parse(text)))

// ---- Queries ----

export const findItem = (doc, id) => doc.items.find((it) => it.id === id)
export const itemIndex = (doc, id) => doc.items.findIndex((it) => it.id === id)

// ---- Edits ----

// 'Rectangle' → 'Rectangle 2'; 'Rectangle 2' → 'Rectangle 3'
function uniqueName(name, taken) {
  if (!taken.has(name)) return name
  const m = /^(.*) (\d+)$/.exec(name)
  const base = m ? m[1] : name
  let n = m ? +m[2] + 1 : 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function addItems(doc, items, index = doc.items.length) {
  if (!items.length) return doc
  const taken = new Set(doc.items.map((it) => it.name))
  const added = items.map((it) => {
    const name = uniqueName(it.name, taken)
    taken.add(name)
    return name === it.name ? it : { ...it, name }
  })
  const at = clamp(index, 0, doc.items.length)
  return { ...doc, items: [...doc.items.slice(0, at), ...added, ...doc.items.slice(at)] }
}

// Applies `fn` to the listed items and keeps the doc (and each item) as is when nothing really changed.
function mapItems(doc, ids, fn) {
  const set = new Set(ids)
  let changed = false
  const items = doc.items.map((it) => {
    if (!set.has(it.id)) return it
    const next = fn(it)
    if (next !== it) changed = true
    return next
  })
  return changed ? { ...doc, items } : doc
}

export function updateItems(doc, ids, patchOrFn) {
  const fn = typeof patchOrFn === 'function'
    ? patchOrFn
    : (it) => (Object.keys(patchOrFn).every((k) => it[k] === patchOrFn[k]) ? it : { ...it, ...patchOrFn })
  return mapItems(doc, ids, fn)
}

export function replaceItems(doc, items) {
  const byId = new Map(items.map((it) => [it.id, it]))
  return mapItems(doc, byId.keys(), (it) => byId.get(it.id))
}

export function removeItems(doc, ids) {
  const set = new Set(ids)
  const items = doc.items.filter((it) => !set.has(it.id))
  return items.length === doc.items.length ? doc : { ...doc, items }
}

const sameOrder = (a, b) => a.length === b.length && a.every((it, i) => it === b[i])

export function reorder(doc, ids, to) {
  const set = new Set(ids), items = doc.items.slice()
  if (to === 'front' || to === 'back') {
    const moved = items.filter((it) => set.has(it.id)), rest = items.filter((it) => !set.has(it.id))
    items.splice(0, items.length, ...(to === 'front' ? [...rest, ...moved] : [...moved, ...rest]))
  } else if (to === 'forward') { // each selected item swaps with the unselected one above it
    for (let i = items.length - 2; i >= 0; i--) {
      if (set.has(items[i].id) && !set.has(items[i + 1].id)) [items[i], items[i + 1]] = [items[i + 1], items[i]]
    }
  } else if (to === 'backward') {
    for (let i = 1; i < items.length; i++) {
      if (set.has(items[i].id) && !set.has(items[i - 1].id)) [items[i], items[i - 1]] = [items[i - 1], items[i]]
    }
  }
  return sameOrder(items, doc.items) ? doc : { ...doc, items }
}

// Moves one item so that it ends up at `index` in the resulting stack.
export function reorderTo(doc, id, index) {
  const from = itemIndex(doc, id)
  if (from < 0) return doc
  const items = doc.items.slice()
  const [it] = items.splice(from, 1)
  items.splice(clamp(index, 0, items.length), 0, it)
  return sameOrder(items, doc.items) ? doc : { ...doc, items }
}

export function duplicateItems(doc, ids, offset = 16) {
  const set = new Set(ids)
  const sources = doc.items.filter((it) => set.has(it.id))
  if (!sources.length) return { doc, ids: [] }
  const move = mat.translate(offset, offset)
  const copies = sources.map((it) => ({
    ...it, id: uid(), name: it.name.replace(/ copy( \d+)?$/, '') + ' copy', contours: transformContours(it.contours, move),
  }))
  const top = Math.max(...sources.map((it) => itemIndex(doc, it.id)))
  return { doc: addItems(doc, copies, top + 1), ids: copies.map((it) => it.id) }
}

export function setArtboard(doc, w, h) {
  const size = (v, cur) => (num(v) ? clamp(Math.round(v), LIMITS.artboardMin, LIMITS.artboardMax) : cur)
  const nw = size(w, doc.w), nh = size(h, doc.h)
  return nw === doc.w && nh === doc.h ? doc : { ...doc, w: nw, h: nh }
}
