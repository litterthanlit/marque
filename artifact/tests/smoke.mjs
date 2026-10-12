// Marque smoke test: boots the real page in Chromium and drives it with real input.
// Run from the repo root:  node artifact/tests/smoke.mjs   (exit 0 = pass, 1 = fail)
// Screenshots go to $MARQUE_SHOTS, or <tmpdir>/marque-shots.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers'
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAPER = path.resolve(ROOT, '..', 'node_modules/paper/dist/paper-core.min.js')
const SHOTS = process.env.MARQUE_SHOTS ?? path.join(os.tmpdir(), 'marque-shots')
fs.mkdirSync(SHOTS, { recursive: true })

// ---- Static server: GET / mimics the publish-time wrapper around index.html ----
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/') {
    const head = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(head + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '</body></html>')
  }
  const file = path.join(ROOT, path.normalize(url.pathname))
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(url.pathname === '/favicon.ico' ? 204 : 404)
    return res.end()
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}/`

// ---- Harness ----
const problems = []   // console errors, page errors, unhandled rejections, foreign requests
const results = []
const browser = await chromium.launch({ args: ['--no-sandbox'] })

async function open({ claude = null, ...opts } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts })
  const tag = claude ? 'claude' : opts.isMobile ? 'mobile' : 'desktop'
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue()
    if (u.href === 'https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js') return route.fulfill({ path: PAPER, contentType: 'text/javascript' })
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ body: '', contentType: 'text/css' })
    if (u.hostname !== 'fonts.gstatic.com') problems.push(`[${tag}] request to ${u.href}`)
    return route.abort()
  })
  await context.addInitScript(() => {
    addEventListener('unhandledrejection', (e) => {
      let why = e.reason?.stack ?? e.reason
      try { why = typeof why === 'string' ? why : JSON.stringify(why) } catch { /* keep as is */ }
      console.error('UNHANDLED REJECTION: ' + why)
    })
  })
  if (claude === 'fake') {
    await context.addInitScript(() => {
      const fakeSample = async () => ({})
      fakeSample.json = async () => ({ paths: [{ name: 'Sun', d: 'M 156 256 C 156 200 200 156 256 156 C 312 156 356 200 356 256 C 356 312 312 356 256 356 C 200 356 156 312 156 256 Z', op: 'add', fill: '#f5a524', stroke: null, strokeWidth: 0 }] })
      window.claude = {
        use: async (name) => (name === 'downloads' ? { save: async (r) => { window.__saved = r; return { status: 'saved' } } } : name === 'sample' ? fakeSample : null),
      }
    })
  }
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.location().url.includes('fonts.gstatic.com')) problems.push(`[${tag}] console: ${m.text()}`) })
  await page.goto(BASE)
  await page.waitForFunction(() => window.__marque && window.__marque.store.getState().viewport.fitted)
  await settle(page)
  return { context, page }
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))))
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__marque.store.getState())))
const items = async (page) => (await state(page)).doc.items
const dispatch = (page, type, payload) => page.evaluate(([t, p]) => window.__marque.store.dispatch(t, p), [type, payload])
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: expected ${b} ± ${tol}, got ${a}`)

// doc → client pixels, via the page's own view transform and the canvas host's box
const scr = (page, [x, y]) => page.evaluate(([x, y]) => {
  const s = window.__marque.view.toScreen(x, y), r = document.getElementById('canvas-host').getBoundingClientRect()
  return { x: r.left + s.x, y: r.top + s.y }
}, [x, y])
async function drag(page, pts, steps = 8) {
  const [first, ...rest] = await Promise.all(pts.map((p) => scr(page, p)))
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps })
  await page.mouse.up()
  await settle(page)
}
const click = async (page, p) => { const s = await scr(page, p); await page.mouse.click(s.x, s.y); await settle(page) }
const key = async (page, k) => { await page.keyboard.press(k); await settle(page) }
const bounds = (it) => {
  const xs = it.contours.flatMap((c) => c.nodes.map((n) => n.x)), ys = it.contours.flatMap((c) => c.nodes.map((n) => n.y))
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}
const luminance = (rgb) => rgb.match(/[\d.]+/g).slice(0, 3).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0) / 255
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const shot = async (page, name) => { await page.waitForTimeout(350); const f = path.join(SHOTS, name + '.png'); await page.screenshot({ path: f }); shots.push(f) }
const shots = []
const clean = async (page) => { await dispatch(page, 'newDoc'); await dispatch(page, 'setTool', { id: 'select' }); await settle(page) }
const draw = async (page, k, a, b) => { await key(page, k); await drag(page, [a, b]) }

async function run(name, fn) {
  try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, why: e.message.split('\n')[0] }) }
}

// ---- Desktop: cases 1 to 11 share one page and one localStorage ----
const { context, page } = await open()

await run('1  boots with the example drawing', async () => {
  const s = await state(page)
  eq(s.doc.items.map((i) => i.name), ['Disc', 'Window', 'Slit', 'Core'], 'item names')
  ok(s.ui.example === true, 'ui.example')
  ok((await page.innerHTML('#doc')).includes('<mask'), '#doc has a <mask')
  ok(/example/i.test(await page.textContent('#hint')), '#hint mentions the example')
  ok(await page.evaluate(() => window.__marque.bridge.available), 'bridge.available (Paper loaded)')
})

await run('2  New, undo, redo', async () => {
  await page.click('.topbar [data-action="new"]')
  await settle(page)
  eq((await items(page)).length, 0, 'items after New')
  await page.click('.topbar [data-action="undo"]')
  await settle(page)
  eq((await items(page)).length, 4, 'items after undo')
  await page.click('.topbar [data-action="redo"]')
  await settle(page)
  eq((await items(page)).length, 0, 'items after redo')
})

await run('3  rectangle tool and live corner radius', async () => {
  await clean(page)
  await draw(page, 'r', [120, 140], [320, 280])
  let s = await state(page)
  eq(s.doc.items.length, 1, 'items')
  eq(s.doc.items[0].contours[0].nodes.length, 4, 'rect nodes')
  eq(s.tool, 'select', 'tool after drawing')
  ok(s.live && s.live.id === s.doc.items[0].id, 'state.live set')
  await page.fill('#in-radius-n', '24')
  await settle(page)
  s = await state(page)
  eq(s.doc.items[0].contours[0].nodes.length, 8, 'rounded rect nodes')
  await key(page, 'Escape')                          // leave the field so shortcut keys reach the canvas again
})

await run('4  ellipse over the rect, X turns it into a cut', async () => {
  await draw(page, 'e', [250, 200], [420, 340])
  eq((await items(page)).length, 2, 'items')
  await key(page, 'x')
  const list = await items(page)
  eq(list[1].op, 'cut', 'top item op')
  ok((await page.innerHTML('#doc')).includes('<mask'), '#doc has a <mask')
})

await run('5  line keeps its colour as a stroke', async () => {
  await clean(page)
  await draw(page, 'l', [100, 100], [400, 300])
  const s = await state(page)
  const it = s.doc.items[0]
  eq(s.doc.items.length, 1, 'items')
  ok(it.contours.length === 1 && !it.contours[0].closed, 'open contour')
  eq(it.fill, null, 'fill')
  eq(it.stroke, s.style.fill, 'stroke equals the style fill')
})

await run('6  pen closes a triangle, pencil closes a circle', async () => {
  await clean(page)
  await key(page, 'p')
  for (const p of [[100, 400], [250, 100], [400, 400], [100, 400]]) await click(page, p)
  let list = await items(page)
  eq(list.length, 1, 'pen items')
  ok(list[0].contours[0].closed, 'pen contour closed')
  eq(list[0].contours[0].nodes.length, 3, 'pen nodes')
  await clean(page)
  await key(page, 'n')
  const ring = Array.from({ length: 61 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2, r = 120 + 6 * Math.sin(a * 7)
    return [256 + r * Math.cos(a), 256 + r * Math.sin(a)]
  })
  await drag(page, ring, 1)
  list = await items(page)
  eq(list.length, 1, 'pencil items')
  ok(list[0].contours[0].closed, 'pencil contour closed')
  ok(list[0].contours[0].nodes.length <= 24, `pencil nodes ≤ 24 (got ${list[0].contours[0].nodes.length})`)
})

await run('7  select, move, one-step undo, marquee, union', async () => {
  await clean(page)
  await draw(page, 'r', [60, 60], [200, 200])
  await draw(page, 'r', [150, 150], [300, 300])
  await key(page, 'Escape')
  const before = bounds((await items(page))[1])
  await click(page, [280, 280])                      // only the second rect is under here
  eq((await state(page)).selection.length, 1, 'click selects one')
  await drag(page, [[280, 280], [340, 320]], 10)
  const moved = bounds((await items(page))[1])
  ok(moved.x - before.x > 30 && moved.y - before.y > 20, `item moved (${before.x},${before.y}) to (${moved.x},${moved.y})`)
  await key(page, 'Control+z')
  eq(bounds((await items(page))[1]), before, 'one undo restores the position')
  await key(page, 'Escape')
  await drag(page, [[20, 20], [380, 380]])
  eq((await state(page)).selection.length, 2, 'marquee selects both')
  await page.click('[data-action="bool"][data-v="union"]')
  await settle(page)
  const s = await state(page)
  eq(s.doc.items.length, 1, 'items after union')
  eq(s.doc.items[0].name, 'Union', 'union name')
})

await run('8  export: SVG string, PNG pixels, popover', async () => {
  const r = await page.evaluate(async () => {
    const { exampleDoc } = await import('/js/model.js')
    const doc = exampleDoc(), io = window.__marque.io
    const svg = io.exportSvgString(doc)
    const blob = await io.rasterize(doc, 1)
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0)
    return {
      svg, bad: new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror') !== null,
      size: [bmp.width, bmp.height], hole: g.getImageData(256, 156, 1, 1).data[3], ring: g.getImageData(256, 86, 1, 1).data[3],
    }
  })
  ok(r.svg.startsWith('<svg'), 'svg starts with <svg')
  ok(r.svg.includes('viewBox="0 0 512 512"'), 'viewBox')
  ok(!r.bad, 'SVG parses')
  eq(r.size, [512, 512], 'PNG size')
  eq(r.hole, 0, 'alpha inside the ring hole')
  eq(r.ring, 255, 'alpha on the ring')
  await page.click('.topbar [data-action="export"]')
  await settle(page)
  ok(await page.isVisible('#pop-export'), 'export popover visible')
  ok((await page.textContent('#pop-export')).includes('Save SVG'), 'popover offers Save SVG')
  await page.keyboard.press('Escape')
  await settle(page)
  ok(!(await page.isVisible('#pop-export')), 'Escape closes the popover')
})

await run('9  import SVG text', async () => {
  await clean(page)
  const r = await page.evaluate(() => {
    const { io, store, bridge } = window.__marque
    return io.importSvgText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="#ff0000"/></svg>', store, bridge)
  })
  eq(r.count, 1, 'import count')
  const list = await items(page)
  eq(list.length, 1, 'items')
  eq(list[0].fill, '#ff0000', 'fill')
})

await run('10 autosave survives a reload', async () => {
  const n = (await items(page)).length
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem('marque.doc.v1') ?? '{}').items?.length === n, n)
  await page.reload()
  await page.waitForFunction(() => window.__marque && window.__marque.store.getState().viewport.fitted)
  const s = await state(page)
  eq(s.doc.items.length, n, 'items after reload')
  ok(s.ui.example === false, 'not the example')
  ok(!/example/i.test(await page.textContent('#hint')), 'hint is not the example hint')
})

await run('11 theme follows the system and the control', async () => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await settle(page)
  ok(luminance(await bodyBg(page)) < 0.2, `dark body background (${await bodyBg(page)})`)
  await page.emulateMedia({ colorScheme: 'light' })
  await settle(page)
  ok(luminance(await bodyBg(page)) > 0.8, `light body background (${await bodyBg(page)})`)
  const seen = []
  for (let i = 0; i < 3; i++) {
    await page.click('.topbar [data-action="theme"]')
    await settle(page)
    seen.push(await page.evaluate(() => document.documentElement.dataset.theme ?? null))
  }
  eq(seen, ['light', 'dark', null], 'html[data-theme] cycle')
  await page.click('.topbar [data-action="theme"]')
  await settle(page)
  ok(luminance(await bodyBg(page)) > 0.8, 'forced light after cycling')
})

await run('11b Space pans after a toolbar click; arrows in Layers do not nudge', async () => {
  await clean(page)
  await draw(page, 'r', [100, 100], [200, 200])
  await page.click('[data-tool="rect"]')             // leaves a button focused by the mouse
  const v0 = (await state(page)).viewport, from = await scr(page, [300, 300])
  await page.keyboard.down('Space')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await settle(page)
  const s = await state(page)
  near(s.viewport.panX - v0.panX, 60, 1, 'pan x'); near(s.viewport.panY - v0.panY, 40, 1, 'pan y')
  eq(s.doc.items.length, 1, 'panning did not draw')
  await page.click('[data-tool="select"]')
  await page.click('.layer-main')
  const before = bounds((await items(page))[0])
  await key(page, 'ArrowDown')
  eq(bounds((await items(page))[0]), before, 'ArrowDown in the Layers list leaves the item alone')
})
await context.close()

// ---- 12: mobile ----
await run('12 mobile 400 × 800: no h-scroll, tool bar, tap to draw, inspector sheet', async () => {
  const m = await open({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true })
  const [sw, iw] = await m.page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
  ok(sw <= iw, `no horizontal scroll (scrollWidth ${sw} > innerWidth ${iw})`)
  const bar = await m.page.locator('#tools').boundingBox()
  ok(await m.page.isVisible('#tools') && bar.y > 600 && bar.y + bar.height <= 801 && bar.width >= 399, `tool bar sits at the bottom (${JSON.stringify(bar)})`)
  for (const t of await m.page.locator('#tools .tool').all()) ok(((await t.boundingBox())?.height ?? 0) >= 44, 'tool targets are 44 px tall')
  const before = (await items(m.page)).length
  await m.page.tap('[data-tool="rect"]')
  const at = await scr(m.page, [256, 256])
  await m.page.touchscreen.tap(at.x, at.y)
  await settle(m.page)
  const list = await items(m.page)
  eq(list.length, before + 1, 'tap adds a rect')
  const b = bounds(list.at(-1))
  near(b.w, 128, 1, 'default rect width'); near(b.h, 128, 1, 'default rect height')
  await m.page.tap('.topbar [data-action="sheet"][data-sheet="inspector"]')
  await settle(m.page)
  ok(await m.page.isVisible('#inspector'), 'inspector sheet opens')
  const box = await m.page.locator('#inspector').boundingBox()
  ok(box.x >= 0 && box.x + box.width <= 400 && box.y + box.height <= 800, 'inspector sheet is on screen')
  await m.page.tap('#inspector [data-action="sheet-close"]')
  await settle(m.page)
  ok(!(await m.page.isVisible('#inspector')), 'inspector sheet closes')
  await m.context.close()
})

// ---- 13: with capabilities ----
await run('13 capabilities: Describe draws, Save SVG calls downloads', async () => {
  const c = await open({ claude: 'fake' })
  await c.page.waitForSelector('#describe', { state: 'visible', timeout: 5000 })
  const before = (await items(c.page)).length
  await c.page.fill('#describe-input', 'a sun')
  await c.page.click('#describe-go')
  await c.page.waitForFunction((n) => window.__marque.store.getState().doc.items.length === n + 1, before)
  const s = await state(c.page), sun = s.doc.items.at(-1)
  eq(sun.name, 'Sun', 'new item name')
  eq(s.selection, [sun.id], 'new item is selected')
  await c.page.click('.topbar [data-action="export"]')
  await c.page.click('[data-action="exp-save"]')
  await c.page.waitForFunction(() => window.__saved)
  const saved = await c.page.evaluate(() => window.__saved)
  ok(/\.svg$/.test(saved.filename), `filename ends .svg (${saved.filename})`)
  ok(typeof saved.data === 'string' && saved.data.includes('<svg'), 'data contains <svg')
  await c.context.close()
})

// ---- 14: no capabilities ----
await run('14 no capabilities: Describe hidden, Save falls back to copy', async () => {
  const c = await open()
  await c.page.waitForFunction(() => window.__marque.store.getState().ui.assist === 'hidden')
  await settle(c.page)
  ok(!(await c.page.isVisible('#describe')), 'Describe bar hidden')
  await c.page.click('.topbar [data-action="export"]')
  await c.page.click('[data-action="exp-save"]')
  await c.page.waitForSelector('#exp-text', { state: 'visible', timeout: 3000 })
  ok((await c.page.inputValue('#exp-text')).startsWith('<svg'), 'textarea holds the SVG')
  await c.context.close()
})

// ---- Screenshots (fresh page each, example drawing with the Disc selected so the Inspector shows) ----
await run('   screenshots: desktop, mobile, light and dark, export popover', async () => {
  for (const scheme of ['light', 'dark']) {
    const d = await open({ colorScheme: scheme })
    await click(d.page, [256, 60])
    await shot(d.page, `desktop-${scheme}`)
    if (scheme === 'light') {
      await d.page.click('.topbar [data-action="export"]')
      await shot(d.page, 'desktop-export-popover')
    }
    await d.context.close()
    const m = await open({ colorScheme: scheme, viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true })
    await shot(m.page, `mobile-${scheme}`)
    await m.page.tap('.topbar [data-action="sheet"][data-sheet="inspector"]')
    await shot(m.page, `mobile-${scheme}-inspector`)
    await m.context.close()
  }
})

// ---- Report ----
results.push({ name: 'no console errors, page errors, rejections or foreign requests', pass: problems.length === 0, why: problems.slice(0, 5).join(' | ') })
await browser.close()
server.close()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '\n        ' + r.why}`)
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`)
if (shots.length) console.log('screenshots:\n  ' + shots.join('\n  '))
process.exit(results.every((r) => r.pass) ? 0 : 1)
