// Getting drawings in and out: SVG export, PNG raster, saving, clipboard, import, autosave, prefs.
// Everything that can throw (storage, clipboard, capabilities) is wrapped; the page works without any of it.

import { DEFAULT_STYLE, STORAGE } from './consts.js'
import { makeItem, parseDoc, serializeDoc } from './model.js'
import { renderSvg } from './render.js'

let downloadsPromise = null

// The downloads capability, or null. Memoised, and never waits longer than 10.5 s.
export function getDownloads() {
  downloadsPromise ??= (async () => {
    const claude = globalThis.window?.claude
    if (typeof claude?.use !== 'function') return null
    try {
      const wait = new Promise((resolve) => setTimeout(resolve, 10500, null))
      return (await Promise.race([claude.use('downloads'), wait])) ?? null
    } catch {
      return null
    }
  })()
  return downloadsPromise
}

// Flatten collapses the visible stack into one path in the fill of the top-most add.
export function exportSvgString(doc, { flatten = false, background = null, bridge = null } = {}) {
  if (flatten && bridge?.available) {
    try {
      const { contours } = bridge.flatten(doc.items)
      const top = [...doc.items].reverse().find((it) => it.visible && it.op === 'add')
      const fill = top?.fill ?? top?.stroke ?? DEFAULT_STYLE.fill
      const items = contours.length ? [makeItem(contours, { fill, stroke: null, fillRule: 'evenodd' }, 'Flattened')] : []
      return renderSvg({ ...doc, items }, { background })
    } catch { /* fall through to the layered export */ }
  }
  return renderSvg(doc, { background })
}

export async function rasterize(doc, scale = 1, { background = null } = {}) {
  const longest = Math.max(doc.w, doc.h)
  const k = Math.min(scale, 8192 / longest)
  const w = Math.max(1, Math.round(doc.w * k))
  const h = Math.max(1, Math.round(doc.h * k))
  // Size the SVG itself to the target, so the browser draws vectors at full resolution.
  const svg = renderSvg(doc, { background, pretty: false }).replace(/ width="[^"]*" height="[^"]*"/, ` width="${w}" height="${h}"`)
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject({ code: 'raster_failed' })
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject({ code: 'raster_failed' })), 'image/png'))
}

const COPY_INSTEAD = new Set(['unavailable', 'not_granted', 'capability_disabled', 'capability_removed', 'extension_not_enabled'])

export async function saveFile({ filename, data }) {
  const cap = await getDownloads()
  if (!cap) return { ok: false, code: 'unavailable', fallback: 'copy' }
  try {
    await cap.save({ filename, data })
    return { ok: true }
  } catch (err) {
    const code = err?.code ?? 'unavailable'
    if (code === 'declined') return { ok: false, code }
    return COPY_INSTEAD.has(code) ? { ok: false, code, fallback: 'copy' } : { ok: false, code }
  }
}

// Call this synchronously inside the click handler: the clipboard needs the user gesture.
export function copyText(text) {
  const legacy = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
      document.body.append(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
  try {
    return navigator.clipboard.writeText(text).then(() => true, () => legacy())
  } catch {
    return Promise.resolve(legacy())
  }
}

export function importSvgText(text, store, bridge) {
  const say = (t) => store.dispatch('toast', { text: t })
  try {
    const { items, skipped } = bridge.importSvg(text)
    if (!items.length) {
      say('Nothing to import. That SVG has no paths Marque can read.')
      return { count: 0, warnings: ['No paths found.'] }
    }
    store.dispatch('addItems', { items, select: true, fit: true })
    const warnings = skipped ? [`${skipped} unsupported ${skipped === 1 ? 'element' : 'elements'} skipped.`] : []
    say(`Imported ${items.length} ${items.length === 1 ? 'path' : 'paths'}${skipped ? `, skipped ${skipped}` : ''}`)
    return { count: items.length, warnings }
  } catch (err) {
    say(err?.code === 'unavailable' ? 'Importing SVG needs Paper.js, which did not load.' : "Couldn't read that SVG. Check the file and try again.")
    return { count: 0, warnings: ['Import failed.'] }
  }
}

const inField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
const looksLikeSvg = (t) => /<svg[\s>]/i.test(t ?? '')

export function bindGlobalIO({ store, bridge }) {
  const bring = (text) => importSvgText(text, store, bridge)
  const readFile = (file) => file.text().then(bring, () => store.dispatch('toast', { text: "Couldn't read that file." }))
  const isSvgFile = (f) => /svg/i.test(f.type) || /\.svg$/i.test(f.name)
  const host = document.getElementById('canvas-host')
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')

  document.addEventListener('paste', (e) => {
    if (inField(e.target)) return
    const text = e.clipboardData?.getData('text/plain')
    if (looksLikeSvg(text)) {
      e.preventDefault()
      bring(text)
    }
  })

  // A file dropped anywhere else would navigate the page away, so swallow it.
  window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault())
  window.addEventListener('drop', (e) => hasFiles(e) && e.preventDefault())
  const mark = (on) => { document.documentElement.toggleAttribute('data-drop', on) }
  host?.addEventListener('dragover', (e) => { e.preventDefault(); mark(true) })
  host?.addEventListener('dragleave', () => mark(false))
  host?.addEventListener('drop', (e) => {
    e.preventDefault()
    mark(false)
    const file = [...(e.dataTransfer?.files ?? [])].find(isSvgFile)
    if (file) return readFile(file)
    const text = e.dataTransfer?.getData('text/plain')
    if (looksLikeSvg(text)) return bring(text)
    store.dispatch('toast', { text: 'Drop an SVG file to import it.' })
  })

  const input = document.getElementById('file-input')
  input?.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) readFile(file)
    input.value = ''
  })

  const flush = () => autosave.flush()
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

let saveTimer = 0
let pendingDoc = null
const write = () => {
  clearTimeout(saveTimer)
  saveTimer = 0
  if (!pendingDoc) return
  const doc = pendingDoc
  pendingDoc = null
  try { localStorage.setItem(STORAGE.doc, serializeDoc(doc)) } catch { /* storage blocked or full */ }
}

export const autosave = {
  load() {
    try {
      const text = localStorage.getItem(STORAGE.doc)
      return text ? parseDoc(text) : null
    } catch {
      return null
    }
  },
  // Debounced by 400 ms; the last pending doc is also written when the page is hidden.
  save(doc) {
    pendingDoc = doc
    clearTimeout(saveTimer)
    saveTimer = setTimeout(write, 400)
  },
  flush: write,
  clear() {
    clearTimeout(saveTimer)
    pendingDoc = null
    try { localStorage.removeItem(STORAGE.doc) } catch { /* ignore */ }
  },
}

const THEMES = ['system', 'light', 'dark']

export const prefs = {
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE.prefs))
      const out = {}
      if (typeof raw?.grid === 'boolean') out.grid = raw.grid
      if (typeof raw?.snap === 'boolean') out.snap = raw.snap
      if (THEMES.includes(raw?.theme)) out.theme = raw.theme
      return out
    } catch {
      return {}
    }
  },
  save(patch) {
    try { localStorage.setItem(STORAGE.prefs, JSON.stringify({ ...prefs.load(), ...patch })) } catch { /* ignore */ }
  },
}
