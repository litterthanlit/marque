import { expect, test as base, type Locator, type Page } from '@playwright/test'
import type { DevHook } from '../src/devHook.ts'
import type { CarveSpec, PunchSpec, SlabSpec } from '../src/engine/carve/spec.ts'

declare global {
  interface Window {
    __marque: DevHook
  }
}

interface Point {
  x: number
  y: number
}

/** Every test fails on a console error or an uncaught exception. */
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})

/* ─── Panel: the sidebar on desktop, the Controls drawer on phones ─── */

async function withPanel(page: Page, run: (panel: Locator) => Promise<unknown>) {
  const open = page.getByRole('button', { name: 'Controls' })
  if (await open.isVisible()) {
    await open.click()
    const drawer = page.getByRole('dialog', { name: 'Controls' })
    await run(drawer)
    await drawer.getByRole('button', { name: 'Done' }).click()
    return
  }
  await run(page.locator('aside').first())
}

async function openVectorMaker(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 3_000 }).catch(() => {})
  await withPanel(page, (panel) => panel.getByRole('button', { name: 'Vector Maker', exact: true }).click())
  await expect.poll(() => page.evaluate(() => window.__marque.store.getState().activeSurface)).toBe('illustrator')
}

async function startOver(page: Page) {
  await withPanel(page, async (panel) => {
    const button = panel.getByRole('button', { name: 'Start over' })
    if (await button.isEnabled()) await button.click()
  })
  await expect.poll(() => layers(page).then((list) => list.length)).toBe(0)
}

const addSlab = (page: Page, name: 'Square' | 'Rounded' | 'Circle' | 'Tall') =>
  withPanel(page, (panel) => panel.getByRole('button', { name, exact: true }).click())

const pickTool = (page: Page, name: 'Pen' | 'Punch' | 'Channel' | 'Slice') =>
  withPanel(page, (panel) => panel.getByRole('button', { name, exact: true }).click())

/* ─── Canvas ─── */

interface Frame {
  box: { x: number; y: number; width: number; height: number }
  /** Client pixels per layer unit. */
  unit: number
  /** Client position of a layer-space point (the origin is the canvas centre). */
  at(x: number, y: number): Point
}

async function frame(page: Page): Promise<Frame> {
  const canvas = page.locator('main canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const unit = Math.min(box.width, box.height) / 600
  return { box, unit, at: (x, y) => ({ x: box.x + box.width / 2 + x * unit, y: box.y + box.height / 2 + y * unit }) }
}

async function drag(page: Page, from: Point, to: Point, modifiers: string[] = []) {
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  for (const key of modifiers) await page.keyboard.up(key)
}

async function click(page: Page, p: Point) {
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.up()
}

/** Move the pointer off the canvas, so no hover marks cover what's being measured. */
async function pointerAway(page: Page, f: Frame) {
  await page.mouse.move(f.box.x + f.box.width / 2, Math.max(1, f.box.y - 30))
}

/** How solid the canvas is at client points: 0 (empty) to 1 (fully inked), and whether it's dark there. */
function pixels(page: Page, points: Point[]) {
  return page.evaluate((list) => {
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')!
    return list.map((p) => {
      const x = Math.floor(((p.x - rect.left) * canvas.width) / rect.width)
      const y = Math.floor(((p.y - rect.top) * canvas.height) / rect.height)
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      return { alpha: a / 255, dark: r + g + b < 120 }
    })
  }, points)
}

async function isInk(page: Page, p: Point) {
  const [pixel] = await pixels(page, [p])
  return pixel.alpha > 0.9 && pixel.dark
}

async function isEmpty(page: Page, p: Point) {
  const [pixel] = await pixels(page, [p])
  return pixel.alpha < 0.1
}

/* ─── State, through the development hook ─── */

function layers(page: Page) {
  return page.evaluate(
    () =>
      window.__marque.store
        .getState()
        .illustrator?.layers.map((layer) => ({
          id: layer.id,
          operation: layer.operation,
          pathData: layer.pathData,
          carve: layer.carve ?? null,
        })) ?? [],
  )
}

async function carves(page: Page): Promise<CarveSpec[]> {
  return (await layers(page)).map((layer) => layer.carve!)
}

const undoDepth = (page: Page) => page.evaluate(() => window.__marque.store.getState().vectorUndoStack.length)

async function handle(page: Page, id: string): Promise<Point> {
  const found = (await page.evaluate(() => window.__marque.handles())).find((candidate) => candidate.id === id)
  expect(found, `handle ${id}`).toBeTruthy()
  return found!
}

function hudLabel(page: Page, text: string) {
  return page.locator('main').getByText(text, { exact: true })
}

/* ─── Scenarios ─── */

test('a slab resizes, rounds, turns, bends and straightens right on the canvas', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  let slab = (await carves(page))[0] as SlabSpec
  expect(slab).toMatchObject({ kind: 'slab', width: 380, height: 380, rotation: 0 })
  const depth = await undoDepth(page)

  // Pull the east handle 60 units: the west edge stays put, and it's one undo step.
  const east = await handle(page, 'e')
  await drag(page, east, { x: east.x + 60 * f.unit, y: east.y })
  slab = (await carves(page))[0] as SlabSpec
  expect(Math.abs(slab.width - 440)).toBeLessThanOrEqual(1)
  expect(Math.abs(slab.center.x - slab.width / 2 + 190)).toBeLessThanOrEqual(0.5)
  expect(await undoDepth(page)).toBe(depth + 1)

  // The dot inside the corner rounds all four.
  const dot = await handle(page, 'radius')
  await drag(page, dot, { x: dot.x + 20, y: dot.y + 20 })
  expect(((await carves(page))[0] as SlabSpec).radius).toBeGreaterThan(0)

  // Shift turns it in 15° steps.
  slab = (await carves(page))[0] as SlabSpec
  const pivot = f.at(slab.center.x, slab.center.y)
  const knob = await handle(page, 'rotate')
  const reach = Math.hypot(knob.x - pivot.x, knob.y - pivot.y)
  const angle = Math.atan2(knob.y - pivot.y, knob.x - pivot.x) + (31 * Math.PI) / 180
  await drag(page, knob, { x: pivot.x + Math.cos(angle) * reach, y: pivot.y + Math.sin(angle) * reach }, ['Shift'])
  expect(((await carves(page))[0] as SlabSpec).rotation).toBe(30)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => ((await carves(page))[0] as SlabSpec).rotation).toBe(0)

  // Drag the top edge up, 30% along: the ink follows the pointer.
  slab = (await carves(page))[0] as SlabSpec
  const left = slab.center.x - slab.width / 2
  const top = slab.center.y - slab.height / 2
  const grabbed = f.at(left + slab.width * 0.3, top)
  const lift = 40
  await page.mouse.move(grabbed.x, grabbed.y - 3)
  await page.mouse.down()
  await page.mouse.move(grabbed.x, grabbed.y - 3 - lift, { steps: 10 })
  expect(await isInk(page, { x: grabbed.x, y: grabbed.y - lift + 5 })).toBe(true)
  expect(await isEmpty(page, { x: grabbed.x, y: grabbed.y - lift - 6 })).toBe(true)
  await page.mouse.up()
  expect(((await carves(page))[0] as SlabSpec).sides?.top).toBeTruthy()

  // Resizing keeps the bend.
  const south = await handle(page, 's')
  await drag(page, south, { x: south.x, y: south.y + 20 })
  expect(((await carves(page))[0] as SlabSpec).sides?.top).toBeTruthy()

  // Double-click the bent edge: straight again.
  await page.mouse.dblclick(grabbed.x, grabbed.y - lift - 2)
  await expect.poll(async () => ((await carves(page))[0] as SlabSpec).sides ?? null).toBeNull()
})

test('cuts snap into place, and a bent channel keeps its width', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)

  await pickTool(page, 'Punch')
  await drag(page, f.at(100, -100), f.at(130, -100))
  await page.keyboard.press('Escape')
  const punch = (await carves(page)).at(-1) as PunchSpec
  expect(punch.kind).toBe('punch')

  // Grow it from a corner handle, then drag it to the middle: it snaps there and says so.
  const corner = await handle(page, 'se')
  await drag(page, corner, { x: corner.x + 10, y: corner.y + 10 })
  const grown = (await carves(page)).at(-1) as PunchSpec
  expect(grown.radius).toBeGreaterThan(punch.radius)
  const from = f.at(grown.center.x, grown.center.y)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const near = f.at(3, -2)
  await page.mouse.move(near.x, near.y, { steps: 12 })
  await expect(hudLabel(page, 'centre')).toBeVisible()
  await page.mouse.up()
  expect(((await carves(page)).at(-1) as PunchSpec).center).toEqual({ x: 0, y: 0 })

  // A channel, then bend it by a rail: the groove stays the same width along its length.
  await pickTool(page, 'Channel')
  await drag(page, f.at(-140, 105), f.at(140, 105))
  await page.keyboard.press('Escape')
  const channel = (await layers(page)).at(-1)!
  expect(channel.carve?.kind).toBe('channel')
  const width = (channel.carve as { width: number }).width
  const press = f.at(-60, 105 + width / 2 - 2 / f.unit)
  await drag(page, press, { x: press.x, y: press.y + 25 })
  expect((await carves(page)).at(-1)).toHaveProperty('bend')

  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  for (const t of [0.3, 0.7]) {
    const probe = (await page.evaluate(([id, at]) => window.__marque.grooveProbe(id, at), [channel.id, t] as const))!
    // Walk across the groove along its normal in half-pixel steps.
    const steps = Array.from({ length: 161 }, (_, i) => (i - 80) * 0.5)
    const samples = await pixels(page, steps.map((s) => ({ x: probe.x + probe.nx * s, y: probe.y + probe.ny * s })))
    let lo = 80
    let hi = 80
    while (lo > 0 && samples[lo - 1].alpha < 0.5) lo--
    while (hi < samples.length - 1 && samples[hi + 1].alpha < 0.5) hi++
    expect(lo, 'ink on one side').toBeGreaterThan(0)
    expect(hi, 'ink on the other side').toBeLessThan(samples.length - 1)
    const measured = ((hi - lo + 1) * 0.5) / probe.unit
    expect(Math.abs(measured - width), `width at t=${t}`).toBeLessThan(2 / probe.unit + 1)
  }
})

test('the pen places points, bends an edge mid-drawing and closes a filled shape', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Pen')
  for (const [x, y] of [
    [-150, -100],
    [150, -100],
    [150, 120],
    [-150, 120],
  ]) {
    await click(page, f.at(x, y))
  }
  const middle = f.at(0, -100)
  await drag(page, middle, { x: middle.x, y: middle.y - 40 })
  await page.keyboard.press('Enter')

  const list = await layers(page)
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ operation: 'add', carve: null })
  expect(list[0].pathData).toMatch(/[cC]/)
  expect(await page.evaluate(() => window.__marque.store.getState().ui.activeTool)).toBeNull()

  await pointerAway(page, f)
  expect(await isInk(page, f.at(0, 0))).toBe(true)
  // The bend is part of the shape: ink above where the edge used to be.
  expect(await isInk(page, { x: middle.x, y: middle.y - 20 })).toBe(true)
})

test('a new slab goes on top without covering the first, and clicking around adds no undo steps', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  const corner = await handle(page, 'se')
  await drag(page, corner, { x: corner.x - 150 * f.unit, y: corner.y - 150 * f.unit })
  await addSlab(page, 'Circle')

  const [square, circle] = (await carves(page)) as SlabSpec[]
  expect(circle.preset).toBe('circle')
  const apart =
    square.center.x + square.width / 2 <= circle.center.x - circle.width / 2 ||
    circle.center.x + circle.width / 2 <= square.center.x - square.width / 2 ||
    square.center.y + square.height / 2 <= circle.center.y - circle.height / 2 ||
    circle.center.y + circle.height / 2 <= square.center.y - square.height / 2
  expect(apart).toBe(true)

  const depth = await undoDepth(page)
  for (let i = 0; i < 5; i++) {
    const target = i % 2 ? circle.center : square.center
    await click(page, f.at(target.x, target.y))
  }
  expect(await undoDepth(page)).toBe(depth)
})

test('a drag lands once wherever it is released; holes travel with their slab unless Alt is held', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const start = await undoDepth(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  await pickTool(page, 'Punch')
  await drag(page, f.at(60, 60), f.at(90, 60))
  await page.keyboard.press('Escape')
  const [slab, punch] = (await carves(page)) as [SlabSpec, PunchSpec]

  // Release outside the canvas: the move lands, and nothing sticks to the pointer afterwards.
  const body = f.at(150, -120)
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.mouse.move(f.box.x + f.box.width + 20, body.y, { steps: 12 })
  await page.mouse.up()
  const released = (await carves(page)) as [SlabSpec, PunchSpec]
  await page.mouse.move(f.box.x + f.box.width + 120, body.y + 60, { steps: 4 })
  expect(await carves(page)).toEqual(released)
  const dx = released[0].center.x - slab.center.x
  expect(dx).toBeGreaterThan(50)
  // The hole came along.
  expect(released[1].center.x - punch.center.x).toBeCloseTo(dx, 1)

  // Bring it back (the hole follows again), then Alt-drag: the hole stays.
  const moved = f.at(released[0].center.x - 100, released[0].center.y - 100)
  await drag(page, moved, { x: moved.x - dx * f.unit, y: moved.y })
  const back = (await carves(page)) as [SlabSpec, PunchSpec]
  expect(back[1].center.x).toBeCloseTo(punch.center.x, 0)
  const alone = f.at(back[0].center.x - 100, back[0].center.y - 100)
  await drag(page, alone, { x: alone.x, y: alone.y - 40 }, ['Alt'])
  const altMoved = (await carves(page)) as [SlabSpec, PunchSpec]
  expect(altMoved[0].center.y).toBeLessThan(back[0].center.y - 20)
  expect(altMoved[1].center).toEqual(back[1].center)

  // One undo per gesture takes it all back.
  const gestures = (await undoDepth(page)) - start
  expect(gestures).toBe(5)
  for (let i = 0; i < gestures; i++) await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layers(page).then((list) => list.length)).toBe(0)
})

test('a reload from the link keeps recipes, and their handles still work', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Rounded')
  let f = await frame(page)
  await pickTool(page, 'Punch')
  await drag(page, f.at(-60, -60), f.at(-25, -60))
  await page.keyboard.press('Escape')
  const before = await carves(page)
  await page.waitForTimeout(600) // the link is written once edits settle

  await page.reload()
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 3_000 }).catch(() => {})
  await expect.poll(() => page.evaluate(() => window.__marque.store.getState().activeSurface)).toBe('illustrator')
  expect(await carves(page)).toEqual(before)

  f = await frame(page)
  const slab = before[0] as SlabSpec
  await click(page, f.at(slab.center.x + 100, slab.center.y + 100))
  const east = await handle(page, 'e')
  await drag(page, east, { x: east.x + 30 * f.unit, y: east.y })
  expect(Math.abs(((await carves(page))[0] as SlabSpec).width - (slab.width + 30))).toBeLessThanOrEqual(1)
})

async function copySvgPath(page: Page): Promise<string | undefined> {
  await page.getByRole('button', { name: 'Copy SVG' }).click()
  const svg = await page.evaluate(() => navigator.clipboard.readText())
  return /\sd="([^"]+)"/.exec(svg)?.[1]
}

/** Sample the canvas on a grid and compare with a path, away from its edges. */
function canvasMismatches(page: Page, d: string) {
  return page.evaluate((d) => {
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const path = new Path2D(d)
    const probe = document.createElement('canvas').getContext('2d')!
    const unit = Math.min(canvas.width, canvas.height) / 600
    let bad = 0
    let checked = 0
    for (let y = -280; y <= 280; y += 14) {
      for (let x = -280; x <= 280; x += 14) {
        const inside = probe.isPointInPath(path, x, y, 'evenodd')
        const settled = [-3, 3].every(
          (o) => probe.isPointInPath(path, x + o, y, 'evenodd') === inside && probe.isPointInPath(path, x, y + o, 'evenodd') === inside,
        )
        if (!settled) continue
        const px = Math.floor(canvas.width / 2 + x * unit)
        const py = Math.floor(canvas.height / 2 + y * unit)
        const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data
        const ink = a > 230 && r + g + b < 120
        const empty = a < 25
        if (!ink && !empty) continue
        checked++
        if (ink !== inside) bad++
      }
    }
    return { bad, checked }
  }, d)
}

test('Copy SVG and the canvas show the same mark', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Rounded')
  const f = await frame(page)
  await pickTool(page, 'Channel')
  await drag(page, f.at(-150, 40), f.at(150, 40))
  await pickTool(page, 'Punch')
  await drag(page, f.at(0, -90), f.at(40, -90))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await pointerAway(page, f)

  const copied = await copySvgPath(page)
  expect(copied).toBeTruthy()
  expect(copied).toBe(await page.evaluate(() => window.__marque.mark()?.compoundPathData))

  const mismatches = await canvasMismatches(page, copied!)
  expect(mismatches.checked).toBeGreaterThan(500)
  expect(mismatches.bad).toBe(0)
})

test('imperfection redraws the mark by hand, and the export is what the canvas shows', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Rounded')
  const f = await frame(page)
  await pickTool(page, 'Punch')
  await drag(page, f.at(0, -60), f.at(50, -60))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  const clean = await page.evaluate(() => window.__marque.mark()?.compoundPathData)

  const toggle = (panel: Locator) => panel.getByRole('button', { name: 'Imperfection', exact: true }).click()
  await withPanel(page, toggle)
  const handmade = await copySvgPath(page)
  expect(handmade).toBeTruthy()
  expect(handmade).not.toBe(clean)
  const mismatches = await canvasMismatches(page, handmade!)
  expect(mismatches.checked).toBeGreaterThan(500)
  expect(mismatches.bad).toBe(0)
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('e.hand=1')

  await withPanel(page, toggle)
  expect(await copySvgPath(page)).toBe(clean)
})
