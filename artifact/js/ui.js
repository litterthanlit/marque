// Chrome: top bar, tool rail, inspector, layers, popovers, toasts and the Describe bar.
// Reads the store, renders in one rAF-batched pass, and changes state only through dispatch.
// It never touches #canvas-host. Small panels are patched in place so focused inputs keep their state.

import { ARTBOARDS, DEFAULT_STYLE, LIMITS, TOOLS } from './consts.js'
import { findItem } from './model.js'
import { boundsOf } from './geometry.js'

const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '')
const key = (k, shift = false) => (MAC ? `${shift ? '⇧' : ''}⌘${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`)
const THEMES = ['system', 'light', 'dark']
const THEME_NAME = { system: 'System', light: 'Light', dark: 'Dark' }
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const nv = (n) => Math.round(n * 100) / 100
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const hexOf = (v) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v).trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h)
}

// ---- Icons: 20 × 20 grid, 1.5 stroke, currentColor (stroke and fill come from .i in the stylesheet) ----
const FLIP = '<path d="M10 2.5v15" stroke-dasharray="1.5 2"/><path d="M8 6 3.5 14.5H8z"/><path d="m12 6 4.5 8.5H12z"/>'
const ICONS = {
  select: '<path d="M5 3v12.5l3.3-3.1L11 17l1.9-1-2.6-4.6 4.5-.2z"/>',
  node: '<circle cx="4" cy="14" r="1.5"/><circle cx="16" cy="6" r="1.5"/><path d="M5.2 13.3 8.4 11.6M11.6 8.4l3.2-1.7"/><rect x="8.4" y="8.4" width="3.2" height="3.2" rx=".6"/>',
  pen: '<path d="M10 17.5 4.5 12 7 6h6l2.5 6z"/><circle cx="10" cy="10.2" r="1.2"/><path d="M10 11.4v6.1M7.5 3h5"/>',
  pencil: '<path d="m4 16 .6-3.7L13.2 3.7a1.7 1.7 0 0 1 2.4 0l.7.7a1.7 1.7 0 0 1 0 2.4L7.7 15.4z"/><path d="m11.8 5.2 3 3"/>',
  rect: '<rect x="3.5" y="4.5" width="13" height="11" rx="1.5"/>',
  ellipse: '<circle cx="10" cy="10" r="6.5"/>',
  polygon: '<path d="M10 3 16 6.5v7L10 17l-6-3.5v-7z"/>',
  line: '<path d="M4.5 15.5 15.5 4.5"/>',
  undo: '<path d="M4.5 8H12a4 4 0 0 1 0 8H8"/><path d="M7.5 4.5 4 8l3.5 3.5"/>',
  redo: '<path d="M15.5 8H8a4 4 0 0 0 0 8h4"/><path d="M12.5 4.5 16 8l-3.5 3.5"/>',
  grid: '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M7.8 3.5v13M12.2 3.5v13M3.5 7.8h13M3.5 12.2h13"/>',
  snap: '<path d="M4.5 3v7a5.5 5.5 0 0 0 11 0V3M8 3v7a2 2 0 0 0 4 0V3M4.5 3H8M12 3h3.5M4.5 6.5H8M12 6.5h3.5"/>',
  sun: '<circle cx="10" cy="10" r="3"/><path d="M10 2.5V4M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1"/>',
  moon: '<path d="M16.5 11.5A6.5 6.5 0 1 1 8.5 3.5a5 5 0 0 0 8 8z"/>',
  system: '<rect x="3" y="4" width="14" height="9.5" rx="1.5"/><path d="M7.5 16.5h5M10 13.5v3"/>',
  eye: '<path d="M2.5 10C4.3 6.4 7 4.8 10 4.8s5.7 1.6 7.5 5.2c-1.8 3.6-4.5 5.2-7.5 5.2S4.3 13.6 2.5 10z"/><circle cx="10" cy="10" r="2.2"/>',
  eyeoff: '<path d="M2.5 10C4.3 6.4 7 4.8 10 4.8s5.7 1.6 7.5 5.2c-1.8 3.6-4.5 5.2-7.5 5.2S4.3 13.6 2.5 10z" opacity=".4"/><path d="m4 4 12 12"/>',
  lock: '<rect x="4.5" y="9" width="11" height="7.5" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  unlock: '<rect x="4.5" y="9" width="11" height="7.5" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>',
  union: '<path d="M3 3h10v4h4v10H7v-4H3z" fill="currentColor" fill-opacity=".2"/>',
  subtract: '<path d="M3 3h10v4H7v6H3z" fill="currentColor" fill-opacity=".2"/><path d="M7 7h10v10H7z" stroke-dasharray="2 2" opacity=".55"/>',
  intersect: '<path d="M3 3h10v10H3zM7 7h10v10H7z" opacity=".45"/><path d="M7 7h6v6H7z" fill="currentColor" fill-opacity=".3"/>',
  exclude: '<path d="M3 3h10v10H3zM7 7h10v10H7z" fill="currentColor" fill-opacity=".2" fill-rule="evenodd"/>',
  layers: '<path d="m10 3.5 6.5 3.5-6.5 3.5L3.5 7z"/><path d="m3.5 10.5 6.5 3.5 6.5-3.5M3.5 14l6.5 3.5 6.5-3.5"/>',
  flipx: FLIP,
  flipy: `<g transform="rotate(90 10 10)">${FLIP}</g>`,
  rotate: '<path d="M15.5 10A5.5 5.5 0 1 1 13.9 6.1"/><path d="M14 2.8v3.4h3.4"/>',
  front: '<path d="M4.5 3.5h11M10 17V7.5M6.5 11 10 7.5l3.5 3.5"/>',
  forward: '<path d="M10 16V5M6 9l4-4 4 4"/>',
  backward: '<path d="M10 4v11M6 11l4 4 4-4"/>',
  back: '<path d="M4.5 16.5h11M10 3v9.5M6.5 9l3.5 3.5L13.5 9"/>',
  dup: '<rect x="7" y="7" width="9.5" height="9.5" rx="1.5"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h2"/>',
  trash: '<path d="M4.5 6h11M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4M11.5 9v4"/>',
  import: '<path d="M10 3.5V12M6.5 8.5 10 12l3.5-3.5M4 13v3h12v-3"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  fit: '<path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13"/>',
  artboard: '<rect x="5" y="5" width="10" height="10" rx="1"/><path d="M2.5 7.5H5M2.5 12.5H5M15 7.5h2.5M15 12.5h2.5M7.5 2.5V5M12.5 2.5V5M7.5 15v2.5M12.5 15v2.5"/>',
  sliders: '<path d="M4 6h1.6M9.4 6H16M4 14h6.6M14.4 14H16"/><circle cx="7.5" cy="6" r="1.9"/><circle cx="12.5" cy="14" r="1.9"/>',
  more: '<circle cx="5" cy="10" r="1.1" fill="currentColor"/><circle cx="10" cy="10" r="1.1" fill="currentColor"/><circle cx="15" cy="10" r="1.1" fill="currentColor"/>',
  close: '<path d="m5.5 5.5 9 9m0-9-9 9"/>',
  spark: '<path d="M10 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z"/>',
  stop: '<rect x="5.5" y="5.5" width="9" height="9" rx="1.8" fill="currentColor"/>',
}
const ic = (n) => `<svg class="i" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICONS[n]}</svg>`
const glyph = (op) => `<svg class="gl" viewBox="0 0 16 16" aria-hidden="true">${op === 'cut'
  ? '<rect x="2.7" y="2.7" width="10.6" height="10.6" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.4 1.8"/>'
  : '<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="currentColor"/>'}</svg>`

// ---- Template helpers ----
const sec = (title, body) => `<section class="grp"><h3 class="sec">${title}</h3>${body}</section>`
const row = (label, body, forId) => `<div class="row">${forId ? `<label class="lbl" for="${forId}">${label}</label>` : `<span class="lbl">${label}</span>`}${body}</div>`
const seg = (k, label, opts, cur, action = 'seg') => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, t]) => `<button type="button" data-action="${action}" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`
const nf = (id, f, tag, label, v) => `<label class="nf"><span aria-hidden="true">${tag}</span><input id="in-${id}" data-f="${f}" type="number" step="any" value="${nv(v)}" aria-label="${label}"></label>`
const slider = (f, label, v, min, max, step = 1) => `<div class="slider"><input id="in-${f}" data-f="${f}" type="range" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${label}"><input id="in-${f}-n" class="mini" data-f="${f}" type="number" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${label} value"></div>`
const sw = (action, id, label, on, off = false) => `<button type="button" role="switch" class="sw" id="${id}" data-action="${action}" aria-checked="${on}" aria-label="${label}"${off ? ' disabled' : ''}></button>`
const iconBtn = (action, v, icon, label) => `<button type="button" class="btn icon" data-action="${action}" data-v="${v}" aria-label="${label}" title="${label}">${ic(icon)}</button>`
// v: a colour, null (none) or undefined (mixed across the selection)
const colourCtl = (k, label, v, memo) => `<div class="colour"><label class="swatch${v ? '' : v === null ? ' is-none' : ' is-mixed'}" style="--c:${v || 'transparent'}"><input type="color" id="in-${k}" data-f="${k}" value="${v || memo}" aria-label="${label} colour"></label><input type="text" id="in-${k}-hex" class="hex" data-f="${k}-hex" value="${v || ''}" placeholder="${v === undefined ? 'Mixed' : 'None'}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${label} hex"><button type="button" class="none" data-action="${k}-none" aria-pressed="${v === null}" aria-label="No ${label.toLowerCase()}">None</button></div>`

// ---- In-place patching: same-shaped markup updates attributes and text, so focus and carets survive ----
const fkey = (e) => e.id || e.dataset?.fk || [e.dataset?.action, e.dataset?.k, e.dataset?.v ?? e.dataset?.id].filter(Boolean).join(':')
function sync(o, n, keep) {
  for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value && !(o === keep && name === 'value')) o.setAttribute(name, value)
  for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name)
  if (o.tagName === 'INPUT' && o !== keep) {
    const v = n.getAttribute('value') ?? ''
    if (o.value !== v) o.value = v
  } else if (!o.children.length && o.textContent !== n.textContent) o.textContent = n.textContent
}
function patch(root, html, keep) {
  if (root._html === html) return
  root._html = html
  const t = document.createElement('template')
  t.innerHTML = html
  const a = $$('*', root)
  const b = $$('*', t.content)
  if (a.length === b.length && a.every((e, i) => e.tagName === b[i].tagName && e.children.length === b[i].children.length)) {
    a.forEach((o, i) => sync(o, b[i], keep))
    return
  }
  const active = root.contains(document.activeElement) ? document.activeElement : null
  const k = active && fkey(active)
  root.replaceChildren(t.content)
  if (k) $$('button,input,textarea', root).find((e) => fkey(e) === k)?.focus({ preventScroll: true })
}

export function mountUI({ store, bridge, io, assist }) {
  const { dispatch, getState } = store
  const ui = () => getState().ui
  const app = $('#app')
  const el = {
    inspector: $('#inspector'), inspectorBody: $('#inspector-body'), layers: $('#layers'), layersBody: $('#layers-body'), count: $('#layers-count'),
    artboard: $('#pop-artboard'), export: $('#pop-export'), more: $('#pop-more'),
    toast: $('#toast'), form: $('#describe'), input: $('#describe-input'), go: $('#describe-go'), status: $('#describe-status'), shadow: $('#paper-shadow'),
  }
  const pops = { artboard: el.artboard, export: el.export }
  const L = {
    dirty: true, more: false, renaming: null, refocus: null, noClick: false,
    memo: { fill: DEFAULT_STYLE.fill, stroke: DEFAULT_STYLE.fill },
    exp: { fmt: 'svg', scale: 2, flatten: false, bg: 'transparent', busy: false, fallback: null, shownFor: null },
    msg: '', msgKind: '', drawing: false, abort: null,
  }
  let shown = null
  let raf = 0
  let typing = null
  let toastTimer = 0
  const off = []
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)) }
  const schedule = (dirty = false) => { L.dirty ||= dirty; raf ||= requestAnimationFrame(render) }
  const say = (text) => dispatch('toast', { text })
  const binds = {}
  $$('[data-bind]').forEach((e) => (binds[e.dataset.bind] ??= []).push(e))
  const bind = (name, text) => (binds[name] ?? []).forEach((e) => e.textContent !== text && (e.textContent = text))

  // Static labels and icons
  $$('[data-i]').forEach((e) => (e.innerHTML = ic(e.dataset.i)))
  for (const t of TOOLS) {
    const b = $(`[data-tool="${t.id}"]`)
    const label = `${t.label} (${t.key.toUpperCase()})`
    b?.setAttribute('aria-label', label)
    if (b) b.title = label
  }
  for (const [a, label] of [['undo', `Undo (${key('Z')})`], ['redo', `Redo (${key('Z', true)})`], ['grid', 'Grid (G)'], ['snap', 'Snap (S)']]) {
    $$(`.btn.icon[data-action="${a}"]`).forEach((b) => { b.setAttribute('aria-label', label); b.title = label })
  }
  $$('[data-action="export"]').forEach((b) => (b.title = `Export (${key('E')})`))
  $$('[data-action="zoomfit"]').forEach((b) => (b.title = `Fit to screen (${key('0')})`))

  // ---- Small DOM state ----
  function applyTheme(t) {
    const root = document.documentElement
    if (t === 'light' || t === 'dark') root.dataset.theme = t
    else delete root.dataset.theme
    const next = THEMES[(THEMES.indexOf(t) + 1) % 3]
    $$('.btn[data-action="theme"]').forEach((b) => {
      b.innerHTML = ic(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'system')
      b.setAttribute('aria-label', `Theme: ${THEME_NAME[t]}. Switch to ${THEME_NAME[next].toLowerCase()}.`)
      b.title = `Theme: ${THEME_NAME[t]}`
    })
    bind('theme', THEME_NAME[t])
  }
  function setMore(open) {
    L.more = open
    el.more.hidden = !open
    $$('[data-action="more"]').forEach((b) => b.setAttribute('aria-expanded', open))
  }
  function showToast(t) {
    clearTimeout(toastTimer)
    if (!t) return el.toast.classList.remove('show')
    el.toast.textContent = t.text
    el.toast.classList.add('show')
    toastTimer = setTimeout(() => dispatch('setUI', { toast: null }), 2400)
  }
  function place(pop, anchor) {
    const r = anchor.getBoundingClientRect()
    pop.style.setProperty('--pl', clamp(r.left, 16, innerWidth - pop.offsetWidth - 16) + 'px')
  }
  const togglePanel = (name) => {
    setMore(false)
    dispatch('setUI', { panel: ui().panel === name ? null : name, sheet: null })
  }
  const bg = () => (L.exp.bg === 'white' ? '#ffffff' : null)
  const exportOpts = () => ({ flatten: L.exp.fmt === 'svg' && L.exp.flatten && bridge.available, background: bg(), bridge })
  const filename = (d) => (L.exp.fmt === 'png' ? `marque-${Math.round(d.w)}x${Math.round(d.h)}@${L.exp.scale}x.png` : `marque-${Math.round(d.w)}x${Math.round(d.h)}.svg`)

  async function save() {
    const x = L.exp
    const { doc } = getState()
    if (x.busy) return
    Object.assign(x, { busy: true, fallback: null, shownFor: null })
    schedule(true)
    try {
      const data = x.fmt === 'png' ? await io.rasterize(doc, x.scale, { background: bg() }) : io.exportSvgString(doc, exportOpts())
      const r = await io.saveFile({ filename: filename(doc), data })
      if (r.ok) {
        say('Saved')
        dispatch('setUI', { panel: null })
      } else if (r.fallback === 'copy') x.fallback = x.fmt === 'png' ? 'png' : data
      else if (r.code !== 'declined') say(r.code === 'too_large' ? 'That file is too large to save. Try a smaller scale.' : "Couldn't save the file. Try again.")
    } catch {
      say("Couldn't export the drawing. Try again.")
    }
    x.busy = false
    schedule(true)
  }

  // ---- Describe ----
  async function describe() {
    if (L.abort) return L.abort.abort()
    const description = el.input.value.trim()
    if (!description) return el.input.focus()
    const { doc } = getState()
    const ctl = (L.abort = new AbortController())
    Object.assign(L, { msg: '', drawing: false })
    dispatch('setUI', { busy: 'describe' })
    try {
      const sample = await assist.getSample()
      const { items, warnings } = await assist.describe({
        description, w: doc.w, h: doc.h, signal: ctl.signal, sample, bridge,
        onText: () => { if (!L.drawing) { L.drawing = true; schedule(true) } },
      })
      if (ctl.signal.aborted) return
      if (!items.length) Object.assign(L, { msg: 'Claude sent no usable shapes. Try again, or describe it differently.', msgKind: 'error' })
      else {
        dispatch('addItems', { items, select: true, fit: true })
        say(`Added ${items.length} ${items.length === 1 ? 'path' : 'paths'}`)
        Object.assign(L, { msg: warnings.length ? `Left out ${warnings.length} unreadable ${warnings.length === 1 ? 'path' : 'paths'}.` : '', msgKind: '' })
        el.input.value = ''
      }
    } catch (err) {
      const info = assist.errorInfo(err)
      if (info.hide) dispatch('setUI', { assist: 'hidden' })
      else if (!info.silent && !ctl.signal.aborted) Object.assign(L, { msg: info.message, msgKind: 'error' })
    } finally {
      L.abort = null
      dispatch('setUI', { busy: null })
      schedule(true)
    }
  }

  // ---- Fields ----
  const setStyle = (patch, coalesce) => {
    dispatch('setStyle', { patch })
    if (getState().selection.length) dispatch('updateItems', { patch, coalesce })
  }
  const LIVE_FIELDS = new Set(['fill', 'stroke', 'sw', 'opacity', 'radius', 'sides', 'inner', 't-radius', 't-sides', 't-inner'])
  function apply(f, t) {
    const s = getState()
    const n = parseFloat(t.value)
    const bad = () => { t.value = t.defaultValue }
    switch (f) {
      case 'x': case 'y': case 'w': case 'h':
        if (!Number.isFinite(n) || ((f === 'w' || f === 'h') && n <= 0)) return bad()
        return dispatch('setBounds', { [f]: n })
      case 'fill': case 'stroke': return setStyle({ [f]: t.value }, f)
      case 'fill-hex': case 'stroke-hex': {
        const c = hexOf(t.value)
        return c ? setStyle({ [f.slice(0, -4)]: c }, f.slice(0, -4)) : bad()
      }
      case 'sw': return n >= 0 ? setStyle({ strokeWidth: n }, 'sw') : undefined
      case 'opacity': return Number.isFinite(n) ? setStyle({ opacity: clamp(n, 0, 100) / 100 }, 'opacity') : undefined
      case 'radius': case 'sides': case 'inner':
        if (s.live && Number.isFinite(n)) dispatch('setLive', { params: { ...s.live.params, [f]: f === 'sides' ? clamp(Math.round(n), 3, 24) : Math.max(0, n) } })
        return
      case 't-radius': case 't-sides': case 't-inner':
        if (Number.isFinite(n)) dispatch('setToolOpt', { key: f.slice(2), value: f === 't-sides' ? clamp(Math.round(n), 3, 24) : Math.max(0, n) })
        return
      case 'aw': case 'ah': {
        const w = parseFloat($('#in-aw').value), h = parseFloat($('#in-ah').value)
        if (!(w >= 1 && h >= 1)) return bad()
        return dispatch('setArtboard', { w: clamp(Math.round(w), LIMITS.artboardMin, LIMITS.artboardMax), h: clamp(Math.round(h), LIMITS.artboardMin, LIMITS.artboardMax) })
      }
    }
  }

  // ---- Actions ----
  const noneToggle = (k) => (t) => setStyle({ [k]: t.getAttribute('aria-pressed') === 'true' ? L.memo[k] : null }, k)
  const act = {
    new: () => dispatch('newDoc'),
    import: () => $('#file-input').click(),
    undo: () => dispatch('undo'),
    redo: () => dispatch('redo'),
    zoomfit: () => dispatch('zoomFit'),
    grid: () => dispatch('setUI', { grid: !ui().grid }),
    snap: () => dispatch('setUI', { snap: !ui().snap }),
    theme: () => dispatch('setUI', { theme: THEMES[(THEMES.indexOf(ui().theme ?? 'system') + 1) % 3] }),
    artboard: () => togglePanel('artboard'),
    export: () => togglePanel('export'),
    more: () => { if (!L.more) dispatch('setUI', { panel: null }); setMore(!L.more) },
    sheet: (t) => { setMore(false); dispatch('setUI', { sheet: ui().sheet === t.dataset.sheet ? null : t.dataset.sheet, panel: null }) },
    'sheet-close': () => dispatch('setUI', { sheet: null }),
    preset: (t) => { dispatch('setArtboard', { w: +t.dataset.w, h: +t.dataset.h }); dispatch('setUI', { panel: null }) },
    'exp-fmt': (t) => { Object.assign(L.exp, { fmt: t.dataset.v, fallback: null, shownFor: null }); schedule(true) },
    'exp-scale': (t) => { L.exp.scale = +t.dataset.v; schedule(true) },
    'exp-bg': (t) => { L.exp.bg = t.dataset.v; L.exp.fallback = null; L.exp.shownFor = null; schedule(true) },
    'exp-flatten': () => { L.exp.flatten = !L.exp.flatten; L.exp.fallback = null; L.exp.shownFor = null; schedule(true) },
    'exp-save': save,
    // The clipboard needs the click's user gesture, so the SVG is built and copied before anything async.
    'exp-copy': () => {
      const svg = io.exportSvgString(getState().doc, exportOpts())
      io.copyText(svg).then((ok) => {
        if (ok) return say('Copied')
        Object.assign(L.exp, { fallback: svg, shownFor: null })
        schedule(true)
      })
    },
    seg: (t) => {
      const { k, v } = t.dataset
      if (k === 'op') dispatch('updateItems', { patch: { op: v } })
      else setStyle({ [k]: v }, k)
    },
    'fill-none': noneToggle('fill'),
    'stroke-none': noneToggle('stroke'),
    'live-star': () => { const lv = getState().live; if (lv) dispatch('setLive', { params: { ...lv.params, star: !lv.params.star } }) },
    'tool-star': () => dispatch('setToolOpt', { key: 'star', value: !getState().toolOpts.star }),
    rot: () => dispatch('rotate', { deg: 90 }),
    flip: (t) => dispatch('flip', { axis: t.dataset.v }),
    arrange: (t) => dispatch('reorder', { to: t.dataset.v }),
    dup: () => dispatch('duplicateItems'),
    del: () => dispatch('deleteItems'),
    bool: (t) => dispatch('booleanOp', { kind: t.dataset.v }),
    flatten: () => dispatch('flatten', {}),
    layer: (t, e) => {
      const it = findItem(getState().doc, t.dataset.id)
      if (it && (it.locked || !it.visible)) return say(it.locked ? 'This layer is locked. Unlock it to select it.' : 'This layer is hidden. Show it to select it.')
      dispatch('select', { ids: [t.dataset.id], mode: e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'set' })
    },
    eye: (t) => { const it = findItem(getState().doc, t.dataset.id); if (it) dispatch('updateItems', { ids: [it.id], patch: { visible: !it.visible } }) },
    lock: (t) => { const it = findItem(getState().doc, t.dataset.id); if (it) dispatch('updateItems', { ids: [it.id], patch: { locked: !it.locked } }) },
  }

  on(app, 'click', (e) => {
    if (L.noClick && e.target.closest('.layer-main')) return void (L.noClick = false)
    const tool = e.target.closest('[data-tool]')
    if (tool) return dispatch('setTool', { id: tool.dataset.tool })
    const t = e.target.closest('[data-action]')
    if (!t || t.disabled) return
    act[t.dataset.action]?.(t, e)
    if (L.more && t.closest('#pop-more')) setMore(false)
  })
  on(app, 'input', (e) => {
    const f = e.target.dataset?.f
    if (!f) return
    typing = e.target
    if (LIVE_FIELDS.has(f)) apply(f, e.target)
  })
  on(app, 'change', (e) => {
    const f = e.target.dataset?.f
    if (!f) return
    if (!LIVE_FIELDS.has(f)) apply(f, e.target)
    if (typing === e.target) typing = null
    schedule(true)
  })
  on(app, 'focusin', (e) => { if (e.target.matches?.('.nf input, .hex, .mini, .ab-in')) e.target.select() })
  on(app, 'focusout', (e) => {
    if (typing === e.target) typing = null
    if (e.target.classList?.contains('rename')) endRename(true, e.target)
  })
  on(el.form, 'submit', (e) => { e.preventDefault(); describe() })
  on(el.input, 'input', () => { if (L.msg) { L.msg = ''; schedule(true) } })
  on(app, 'submit', (e) => {
    if (e.target.id !== 'artboard-form') return
    e.preventDefault()
    const w = parseFloat($('#ab-w').value), h = parseFloat($('#ab-h').value)
    if (!(w >= 1 && h >= 1)) return
    dispatch('setArtboard', { w: clamp(Math.round(w), LIMITS.artboardMin, LIMITS.artboardMax), h: clamp(Math.round(h), LIMITS.artboardMin, LIMITS.artboardMax) })
    dispatch('setUI', { panel: null })
  })

  // Outside click and Escape close popovers.
  on(document, 'pointerdown', (e) => {
    if (L.more && !e.target.closest('#pop-more, [data-action="more"]')) setMore(false)
    if (ui().panel && !e.target.closest('.pop, [data-action="export"], [data-action="artboard"]')) dispatch('setUI', { panel: null })
  }, true)
  on(document, 'keydown', (e) => {
    if (e.key !== 'Escape') return
    const stop = () => { e.stopPropagation(); e.preventDefault() }
    if (L.more) { setMore(false); $('.btn[data-action="more"]')?.focus(); return stop() }
    if (ui().panel && e.target.closest?.('.pop')) { dispatch('setUI', { panel: null }); return stop() }
  })

  // ---- Layers: rename, keyboard, drag to reorder ----
  function endRename(commit, input, refocus) {
    const id = L.renaming
    if (!id) return
    L.renaming = null
    if (refocus) L.refocus = 'm-' + id
    const name = input.value.trim().slice(0, 80)
    const it = findItem(getState().doc, id)
    if (commit && name && it && name !== it.name) dispatch('updateItems', { ids: [id], patch: { name } })
    schedule(true)
  }
  on(el.layersBody, 'dblclick', (e) => {
    const b = e.target.closest('.layer-main')
    if (b) { L.renaming = b.dataset.id; schedule(true) }
  })
  on(el.layersBody, 'keydown', (e) => {
    if (e.target.classList.contains('rename')) {
      e.stopPropagation()
      if (e.key === 'Enter') endRename(true, e.target, true)
      else if (e.key === 'Escape') endRename(false, e.target, true)
      return
    }
    const b = e.target.closest('.layer-main')
    if (!b) return
    if (e.key === 'F2') { e.preventDefault(); L.renaming = b.dataset.id; schedule(true) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()   // app.js would otherwise nudge the selection with the same key
      const all = $$('.layer-main', el.layersBody)
      all[all.indexOf(b) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
    }
  })
  let drag = null
  const rows = () => $$('.layer', el.layersBody)
  const clearMarks = () => rows().forEach((r) => r.classList.remove('drop-before', 'drop-after', 'is-drag'))
  on(el.layersBody, 'pointerdown', (e) => {
    const b = e.target.closest('.layer-main')
    if (b && e.button === 0 && e.pointerType !== 'touch') drag = { id: b.dataset.id, y: e.clientY, on: false, row: b.closest('.layer'), gap: -1 }
  })
  on(window, 'pointermove', (e) => {
    if (!drag) return
    if (!drag.on && Math.abs(e.clientY - drag.y) < 5) return
    drag.on = true
    const list = rows()
    clearMarks()
    drag.row.classList.add('is-drag')
    const g = list.findIndex((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2 })
    drag.gap = g < 0 ? list.length : g
    if (drag.gap < list.length) list[drag.gap].classList.add('drop-before')
    else list[list.length - 1].classList.add('drop-after')
  })
  const endDrag = (e) => {
    if (!drag) return
    const d = drag
    drag = null
    if (!d.on) return
    clearMarks()
    L.noClick = true
    setTimeout(() => (L.noClick = false), 0)
    if (e.type === 'pointercancel') return
    const list = rows()
    const from = list.indexOf(d.row)
    const to = d.gap > from ? d.gap - 1 : d.gap
    if (to !== from) dispatch('reorderTo', { id: d.id, index: list.length - 1 - to })
  }
  on(window, 'pointerup', endDrag)
  on(window, 'pointercancel', endDrag)

  // ---- Markup for the panels ----
  function inspectorHtml(s) {
    const { doc, selection, tool, live, toolOpts, style } = s
    const sel = selection.map((id) => findItem(doc, id)).filter(Boolean)
    const one = sel.length === 1 ? sel[0] : null
    const same = (k) => (sel.every((it) => it[k] === sel[0][k]) ? sel[0][k] : undefined)
    const v = sel.length ? { fill: same('fill'), stroke: same('stroke'), strokeWidth: same('strokeWidth'), cap: same('cap'), join: same('join'), fillRule: same('fillRule'), opacity: sel[0].opacity, op: same('op') } : style
    if (v.fill) L.memo.fill = v.fill
    if (v.stroke) L.memo.stroke = v.stroke
    const look = row('Fill', colourCtl('fill', 'Fill', v.fill, L.memo.fill), 'in-fill-hex') + row('Stroke', colourCtl('stroke', 'Stroke', v.stroke, L.memo.stroke), 'in-stroke-hex') +
      (v.stroke !== null ? row('Width', slider('sw', 'Stroke width', nv(v.strokeWidth ?? 0), 0, 64, 0.5), 'in-sw') : '')
    if (!sel.length) {
      const opts = tool === 'rect'
        ? sec('Rectangle', row('Corner radius', slider('t-radius', 'Corner radius', toolOpts.radius, 0, 128), 'in-t-radius'))
        : tool === 'polygon'
          ? sec('Polygon', row('Sides', slider('t-sides', 'Sides', toolOpts.sides, 3, 24), 'in-t-sides') + row('Star', sw('tool-star', 'in-t-star', 'Star', !!toolOpts.star)) +
            row('Inner', slider('t-inner', 'Inner radius', toolOpts.inner, 0.1, 0.9, 0.05), 'in-t-inner'))
          : ''
      return '<p class="note">Nothing selected. These settings apply to new shapes.</p>' + sec('New shapes', look) +
        sec('Artboard', `<div class="grid2">${nf('aw', 'aw', 'W', 'Artboard width', doc.w)}${nf('ah', 'ah', 'H', 'Artboard height', doc.h)}</div>`) + opts
    }
    const b = boundsOf(sel)
    const lv = live && one && live.id === one.id ? live : null
    const shape = !lv ? '' : lv.kind === 'rect'
      ? sec('Rectangle', row('Corner radius', slider('radius', 'Corner radius', lv.params.radius, 0, Math.max(1, Math.floor(Math.min(lv.box.w, lv.box.h) / 2))), 'in-radius'))
      : lv.kind === 'polygon'
        ? sec('Polygon', row('Sides', slider('sides', 'Sides', lv.params.sides, 3, 24), 'in-sides') + row('Star', sw('live-star', 'in-star', 'Star', !!lv.params.star)) +
          row('Inner', slider('inner', 'Inner radius', lv.params.inner, 0.1, 0.9, 0.05), 'in-inner'))
        : ''
    const combine = sel.length < 2 ? '' : sec('Combine', `<div class="combine" role="group" aria-label="Combine shapes">${['union', 'subtract', 'intersect', 'exclude'].map((k) =>
      `<button type="button" class="cmb" data-action="bool" data-v="${k}"${bridge.available ? '' : ' disabled title="Needs Paper.js, which did not load."'}>${ic(k)}<span>${k[0].toUpperCase() + k.slice(1)}</span></button>`).join('')}</div>` +
      `<button type="button" class="btn line wide" data-action="flatten"${bridge.available ? '' : ' disabled'}>${ic('layers')}Flatten to one path</button>`)
    return `<div class="sum"><span class="sum-name">${one ? esc(one.name) : 'Selection'}</span><span class="sum-meta">${one ? `${nv(b.w)} × ${nv(b.h)}` : `${sel.length} selected`}</span></div>` + combine +
      sec('Stack', row('Mode', seg('op', 'Add or cut', [['add', 'Add'], ['cut', 'Cut']], v.op)) + '<p class="note">Cut erases only what lies beneath it.</p>') +
      sec('Transform', `<div class="grid2">${nf('x', 'x', 'X', 'X position', b.x)}${nf('y', 'y', 'Y', 'Y position', b.y)}${nf('w', 'w', 'W', 'Width', b.w)}${nf('h', 'h', 'H', 'Height', b.h)}</div>` +
        `<div class="ibar">${iconBtn('rot', '', 'rotate', 'Rotate 90°')}${iconBtn('flip', 'x', 'flipx', 'Flip horizontally')}${iconBtn('flip', 'y', 'flipy', 'Flip vertically')}</div>`) +
      shape +
      sec('Appearance', look + (v.stroke !== null ? row('Cap', seg('cap', 'Line cap', [['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']], v.cap)) + row('Join', seg('join', 'Line join', [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']], v.join)) : '') +
        row('Opacity', slider('opacity', 'Opacity', Math.round(v.opacity * 100), 0, 100), 'in-opacity') +
        row('Fill rule', seg('fillRule', 'Fill rule', [['nonzero', 'Non-zero'], ['evenodd', 'Even-odd']], v.fillRule))) +
      sec('Arrange', `<div class="ibar">${iconBtn('arrange', 'front', 'front', `Bring to front (${key(']')})`)}${iconBtn('arrange', 'forward', 'forward', 'Bring forward (])')}${iconBtn('arrange', 'backward', 'backward', 'Send backward ([)')}${iconBtn('arrange', 'back', 'back', `Send to back (${key('[')})`)}</div>` +
        `<div class="acts"><button type="button" class="btn line" data-action="dup">${ic('dup')}Duplicate</button><button type="button" class="btn line danger" data-action="del">${ic('trash')}Delete</button></div>`)
  }

  const rowCache = new Map()
  function layersHtml({ doc, selection }) {
    if (!doc.items.length) return '<p class="empty">Nothing here yet. Pick a tool and draw on the artboard.</p>'
    const chosen = new Set(selection)
    if (rowCache.size > doc.items.length * 2 + 20) rowCache.clear()
    let out = '<ul class="layers" aria-label="Layers">'
    for (let i = doc.items.length - 1; i >= 0; i--) {
      const it = doc.items[i]
      const isSel = chosen.has(it.id)
      const renaming = L.renaming === it.id
      const sig = `${it.name}|${it.op}|${it.visible}|${it.locked}|${isSel}|${renaming}`
      let html = rowCache.get(it.id)
      if (html?.sig !== sig) {
        const name = esc(it.name)
        const main = renaming
          ? `<div class="layer-main">${glyph(it.op)}<input class="rename" data-fk="rename" value="${name}" maxlength="80" spellcheck="false" aria-label="Layer name"></div>`
          : `<button type="button" class="layer-main" data-action="layer" data-id="${esc(it.id)}" data-fk="m-${esc(it.id)}" aria-pressed="${isSel}" aria-label="${name}, ${it.op} layer">${glyph(it.op)}<span class="layer-name">${name}</span></button>`
        html = {
          sig,
          s: `<li class="layer${isSel ? ' is-sel' : ''}${it.visible ? '' : ' is-off'}">${main}` +
            `<button type="button" class="layer-btn${it.visible ? '' : ' is-on'}" data-action="eye" data-id="${esc(it.id)}" data-fk="e-${esc(it.id)}" aria-label="${it.visible ? 'Hide' : 'Show'} ${name}">${ic(it.visible ? 'eye' : 'eyeoff')}</button>` +
            `<button type="button" class="layer-btn${it.locked ? ' is-on' : ''}" data-action="lock" data-id="${esc(it.id)}" data-fk="l-${esc(it.id)}" aria-label="${it.locked ? 'Unlock' : 'Lock'} ${name}">${ic(it.locked ? 'lock' : 'unlock')}</button></li>`,
        }
        rowCache.set(it.id, html)
      }
      out += html.s
    }
    return out + '</ul>'
  }

  function artboardHtml({ doc }) {
    return `<h2 class="pop-h">Artboard</h2><div class="presets">${ARTBOARDS.map((a) =>
      `<button type="button" class="preset" data-action="preset" data-w="${a.w}" data-h="${a.h}" aria-pressed="${a.w === doc.w && a.h === doc.h}"><i class="ratio" style="--ar:${a.w / a.h}"></i><span class="p-name">${a.label}</span><span class="p-size mono">${a.w} × ${a.h}</span></button>`).join('')}</div>` +
      `<form id="artboard-form" class="custom" novalidate><span class="sec">Custom</span><label class="nf"><span aria-hidden="true">W</span><input id="ab-w" class="ab-in" type="number" min="${LIMITS.artboardMin}" max="${LIMITS.artboardMax}" step="1" value="${nv(doc.w)}" aria-label="Artboard width"></label>` +
      `<span class="x" aria-hidden="true">×</span><label class="nf"><span aria-hidden="true">H</span><input id="ab-h" class="ab-in" type="number" min="${LIMITS.artboardMin}" max="${LIMITS.artboardMax}" step="1" value="${nv(doc.h)}" aria-label="Artboard height"></label>` +
      `<button type="submit" class="btn primary">Apply</button></form>`
  }

  function exportHtml({ doc }) {
    const x = L.exp
    const png = x.fmt === 'png'
    const k = Math.min(x.scale, 8192 / Math.max(doc.w, doc.h))
    const FMT = png ? 'PNG' : 'SVG'
    return '<h2 class="pop-h">Export</h2><div class="stack">' +
      row('Format', seg('fmt', 'Format', [['svg', 'SVG'], ['png', 'PNG']], x.fmt, 'exp-fmt')) +
      (png ? row('Scale', seg('scale', 'Scale', [[1, '1×'], [2, '2×'], [4, '4×']], x.scale, 'exp-scale')) : row('Flatten', `<div class="flat">${sw('exp-flatten', 'exp-flatten', 'Flatten to one path', x.flatten && bridge.available, !bridge.available)}<span>${bridge.available ? 'Flatten to one path' : 'Needs Paper.js'}</span></div>`)) +
      row('Background', seg('bg', 'Background', [['transparent', 'Transparent'], ['white', 'White']], x.bg, 'exp-bg')) +
      `<p class="meta mono"><span>${esc(filename(doc))}</span>${png ? `<span>${Math.round(doc.w * k)} × ${Math.round(doc.h * k)} px</span>` : ''}</p>` +
      `<div class="acts"><button type="button" class="btn primary" data-action="exp-save"${x.busy ? ' disabled' : ''}>${x.busy ? 'Saving…' : `Save ${FMT}`}</button><button type="button" class="btn line" data-action="exp-copy">Copy SVG</button></div>` +
      (x.fallback ? `<div class="fallback"><p class="note">${png ? "Saving files isn't available here. Switch to SVG and copy it instead." : "Saving files isn't available here. Copy the SVG instead."}</p>${png ? '' : '<textarea id="exp-text" readonly rows="6" spellcheck="false" aria-label="SVG source"></textarea>'}</div>` : '') +
      '</div>'
  }

  // ---- The render pass ----
  const tools = $$('[data-tool]')
  const byAction = (name) => $$(`[data-action="${name}"]`)
  const [undoBtns, redoBtns, gridBtns, snapBtns, sheetBtns] = ['undo', 'redo', 'grid', 'snap', 'sheet'].map(byAction)
  function render() {
    raf = 0
    const s = getState()
    const p = shown
    shown = s
    const u = s.ui
    const pu = p?.ui ?? {}
    const first = !p
    const dirty = L.dirty || first
    const diff = (f) => first || f(s) !== f(p)
    L.dirty = false

    if (diff((x) => x.ui.theme)) applyTheme(u.theme ?? 'system')
    if (diff((x) => x.tool)) tools.forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === s.tool))
    if (diff((x) => x.history.canUndo)) undoBtns.forEach((b) => (b.disabled = !s.history.canUndo))
    if (diff((x) => x.history.canRedo)) redoBtns.forEach((b) => (b.disabled = !s.history.canRedo))
    if (diff((x) => x.viewport.zoom)) bind('zoom', Math.round(s.viewport.zoom * 100) + '%')
    if (diff((x) => x.doc.w + 'x' + x.doc.h)) bind('artboard', `${nv(s.doc.w)} × ${nv(s.doc.h)}`)
    if (diff((x) => x.ui.grid)) gridBtns.forEach((b) => b.setAttribute('aria-pressed', !!u.grid))
    if (diff((x) => x.ui.snap)) snapBtns.forEach((b) => b.setAttribute('aria-pressed', !!u.snap))
    if (diff((x) => x.ui.example)) app.dataset.example = u.example ? '1' : ''
    if (diff((x) => x.ui.sheet)) {
      app.dataset.sheet = u.sheet ?? ''
      el.inspector.classList.toggle('is-open', u.sheet === 'inspector')
      el.layers.classList.toggle('is-open', u.sheet === 'layers')
      sheetBtns.forEach((b) => b.setAttribute('aria-expanded', u.sheet === b.dataset.sheet))
    }
    if (diff((x) => x.ui.toast)) showToast(u.toast)

    // The paper's shadow is a plain box behind the canvas, so it stays crisp at every zoom.
    const v = s.viewport
    const pw = s.doc.w * v.zoom
    const ph = s.doc.h * v.zoom
    el.shadow.hidden = !(v.w > 0) || pw > 16000 || ph > 16000
    if (!el.shadow.hidden) Object.assign(el.shadow.style, { width: pw + 'px', height: ph + 'px', transform: `translate(${v.panX}px,${v.panY}px)` })

    const content = dirty || ['doc', 'selection', 'live', 'tool', 'toolOpts', 'style'].some((k) => s[k] !== p[k])
    if (content) {
      patch(el.inspectorBody, inspectorHtml(s), typing)
      patch(el.layersBody, layersHtml(s), typing)
      el.count.textContent = s.doc.items.length
      if (s.selection !== p?.selection) $('.layer.is-sel .layer-main', el.layersBody)?.scrollIntoView({ block: 'nearest' })
    }

    for (const [name, pop] of Object.entries(pops)) {
      const open = u.panel === name
      if (open) {
        const opening = pop.hidden
        if (opening && name === 'export') Object.assign(L.exp, { fallback: null, shownFor: null })
        if (opening || content) patch(pop, name === 'export' ? exportHtml(s) : artboardHtml(s), typing)
        pop.hidden = false
        if (opening) {
          if (name === 'artboard') place(pop, $('.btn.chip[data-action="artboard"]'))
          pop.querySelector('button,input')?.focus({ preventScroll: true })
        }
      } else if (!pop.hidden) {
        const had = pop.contains(document.activeElement)
        pop.hidden = true
        if (had) $(`.btn[data-action="${name}"]`)?.focus()
      }
      if (diff((x) => x.ui.panel)) byAction(name).forEach((b) => b.setAttribute('aria-expanded', open))
    }
    const ta = $('#exp-text')
    if (ta && L.exp.fallback && L.exp.shownFor !== L.exp.fallback) {
      L.exp.shownFor = L.exp.fallback
      ta.value = L.exp.fallback
      ta.focus()
      ta.select()
    }

    // Describe bar
    const busy = u.busy === 'describe'
    el.form.hidden = u.assist !== 'available'
    el.form.classList.toggle('is-busy', busy)
    el.input.readOnly = busy
    const label = busy ? 'Stop' : 'Draw'
    if (el.go.dataset.label !== label) {
      el.go.dataset.label = label
      el.go.innerHTML = busy ? `${ic('stop')}<span>Stop</span>` : '<span>Draw</span>'
    }
    el.status.textContent = busy ? (L.drawing ? 'Drawing…' : 'Thinking…') : L.msg
    el.status.dataset.kind = busy ? '' : L.msgKind

    if (L.renaming) {
      const input = $('.rename', el.layersBody)
      if (input && document.activeElement !== input) { input.focus(); input.select() }
    } else if (L.refocus) {
      $(`[data-fk="${L.refocus}"]`, el.layersBody)?.focus({ preventScroll: true })
      L.refocus = null
    }
  }

  const unsub = store.subscribe(() => schedule())
  schedule(true)
  assist.getSample().then((sample) => dispatch('setUI', { assist: sample ? 'available' : 'hidden' }), () => dispatch('setUI', { assist: 'hidden' }))

  return {
    destroy() {
      unsub()
      cancelAnimationFrame(raf)
      clearTimeout(toastTimer)
      L.abort?.abort()
      off.forEach((fn) => fn())
    },
  }
}
