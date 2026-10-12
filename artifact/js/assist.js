// Describe: ask Claude for a drawing and turn the reply into editable items.
// Everything here is DOM-free except getSample, which only touches window when it is called.

import { DEFAULT_STYLE, LIMITS } from './consts.js'
import { makeItem } from './model.js'

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i
let samplePromise = null

// Resolves the sample function, or null. Memoised, and never waits longer than 10.5 s.
export function getSample() {
  samplePromise ??= (async () => {
    const claude = globalThis.window?.claude
    if (typeof claude?.use !== 'function') return null
    try {
      const wait = new Promise((resolve) => setTimeout(resolve, 10500, null))
      return (await Promise.race([claude.use('sample'), wait])) ?? null
    } catch {
      return null
    }
  })()
  return samplePromise
}

export function buildPrompt(description, { w, h }) {
  const what = String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500).replace(/"/g, "'")
  return [
    `You are a vector illustrator. Draw: "${what}"`,
    `Artboard: ${w} × ${h} units, origin top-left, y down. Keep the drawing inside it, centred, with an 8% margin.`,
    'Reply with JSON only, exactly this shape:',
    '{"paths":[{"name":string,"d":string,"op":"add"|"cut","fill":"#rrggbb"|null,"stroke":"#rrggbb"|null,"strokeWidth":number}]}',
    'Rules:',
    '- "d" uses absolute M L C Q Z commands only; close filled shapes with Z.',
    '- Paths stack bottom to top. "add" paints. "cut" erases only what lies beneath it; a later "add" can paint over the hole.',
    '- Prefer few, bold, well-built shapes: at most 12 paths and 60 segments each. Flat colours, 1 to 4 of them, no gradients.',
  ].join('\n')
}

const colour = (v) => {
  if (typeof v !== 'string' || !HEX.test(v)) return null
  const h = v.slice(1).toLowerCase()
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h)
}

const coords = (n) => [n.x, n.y, n.hi?.x, n.hi?.y, n.ho?.x, n.ho?.y].filter((v) => v !== undefined && v !== null)

// Validates what Claude sent. Bad paths are skipped and reported; nothing here throws.
export function parseAssistResult(json, { w, h, bridge }) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.paths) ? json.paths : []
  const reach = 10 * Math.max(w, h)
  const items = []
  const warnings = []
  let nodes = 0
  list.slice(0, LIMITS.assistPaths).forEach((p, i) => {
    const skip = (why) => warnings.push(`Path ${i + 1} skipped: ${why}.`)
    if (nodes >= LIMITS.assistNodes) return
    if (!p || typeof p.d !== 'string' || !p.d.trim()) return skip('no path data')
    if (p.d.length > 20000) return skip('path data too long')
    let contours
    try {
      contours = bridge.parsePathData(p.d)
    } catch {
      return skip('unreadable path data')
    }
    if (!contours?.length) return skip('no shape')
    const all = contours.flatMap((c) => c.nodes.flatMap(coords))
    if (all.some((v) => !Number.isFinite(v) || Math.abs(v) > reach)) return skip('numbers out of range')
    const count = contours.reduce((a, c) => a + c.nodes.length, 0)
    if (nodes + count > LIMITS.assistNodes) return skip('too many points')
    nodes += count
    let fill = colour(p.fill)
    const stroke = colour(p.stroke)
    if (fill === null && stroke === null) fill = DEFAULT_STYLE.fill
    const sw = Number.isFinite(p.strokeWidth) ? Math.min(Math.max(p.strokeWidth, 0), Math.max(w, h) / 4) : DEFAULT_STYLE.strokeWidth
    const name = String(p.name ?? '').slice(0, 40).trim() || 'Path'
    items.push(makeItem(contours, {
      fill, stroke, strokeWidth: sw, op: p.op === 'cut' ? 'cut' : 'add',
      fillRule: contours.length > 1 ? 'evenodd' : 'nonzero',
    }, name))
  })
  if (list.length > LIMITS.assistPaths) warnings.push(`${list.length - LIMITS.assistPaths} extra paths ignored.`)
  return { items, warnings }
}

export async function describe({ description, w, h, signal, onText, sample, bridge }) {
  const ask = sample ?? (await getSample())
  if (!ask) throw { code: 'not_granted', message: 'Claude is not available here.' }
  const json = await ask.json(buildPrompt(description, { w, h }), { signal, onText, modelTier: 'default', cache: false })
  return parseAssistResult(json, { w, h, bridge })
}

const HIDE = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'])
const COPY = {
  rate_limited: 'Claude is busy for you right now. Try again in a minute.',
  session_expired: 'Sign in to Claude again, then retry.',
  refused: "Claude won't draw that one. Try describing it differently.",
  invalid_json: 'That drawing came back unreadable. Try again, or ask for fewer shapes.',
  empty_completion: 'That drawing came back unreadable. Try again, or ask for fewer shapes.',
}

export function errorInfo(err) {
  const code = err?.code ?? (err?.name === 'AbortError' ? 'cancelled' : '')
  if (code === 'cancelled') return { message: '', hide: false, silent: true }
  if (HIDE.has(code)) return { message: '', hide: true, silent: true }
  return { message: COPY[code] ?? 'Something went wrong reaching Claude. Try again.', hide: false, silent: false }
}
