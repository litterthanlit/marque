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

/* ─── Controls: the pill over the canvas, the Layers drawer, the top bar ─── */

const layersButton = (page: Page) => page.getByRole('button', { name: 'Layers', exact: true })
const layersDrawer = (page: Page) => page.getByRole('complementary', { name: 'Layers' })
const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' })

async function openLayers(page: Page): Promise<Locator> {
  const drawer = layersDrawer(page)
  if (!(await drawer.isVisible())) await layersButton(page).click()
  await expect(drawer).toBeVisible()
  return drawer
}

async function closeLayers(page: Page) {
  await layersDrawer(page).getByRole('button', { name: 'Close layers' }).click()
  await expect(layersDrawer(page)).toBeHidden()
}

/** Opens on the final look unless asked: the pixel checks read solid ink, which only that look draws. */
async function openVectorMaker(page: Page, look: 'construction' | 'final' = 'final') {
  await page.goto('/')
  await expect(page.locator('main canvas')).toBeVisible()
  await page.evaluate((wanted) => {
    const { ui, toggleLook } = window.__marque.store.getState()
    if (ui.look !== wanted) toggleLook()
  }, look)
}

async function startOver(page: Page) {
  const drawer = await openLayers(page)
  const button = drawer.getByRole('button', { name: 'Start over' })
  if (await button.isEnabled()) await button.click()
  await closeLayers(page)
  await expect.poll(() => layers(page).then((list) => list.length)).toBe(0)
}

const addSlab = (page: Page, name: 'Square' | 'Rounded' | 'Circle' | 'Tall') =>
  page.getByRole('button', { name: `Add ${name.toLowerCase()} slab` }).click()

const pickTool = (page: Page, name: 'Pen' | 'Punch' | 'Channel' | 'Slice') =>
  page.getByRole('group', { name: 'Tools' }).getByRole('button', { name, exact: true }).click()

/* ─── The spark tray under the canvas ─── */

const sparkTray = (page: Page) => page.getByRole('group', { name: 'Sparks' })
const sparkButton = (page: Page, n: number) => sparkTray(page).getByRole('button', { name: `Add spark ${n}`, exact: true })

/** Deal the set a seed names, so a test always drops the same sparks. */
async function dealSparks(page: Page, seed: number) {
  await page.evaluate((value) => window.__marque.store.getState().setSparkSeed(value), seed)
  await expect(sparkTray(page)).toHaveAttribute('aria-busy', 'false')
  await expect(sparkTray(page).getByRole('button')).toHaveCount(8)
}

/** What each thumbnail draws, in tray order. */
const thumbnails = (page: Page) =>
  sparkTray(page)
    .locator('button path')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))

const sparkSeed = (page: Page) => page.evaluate(() => window.__marque.store.getState().ui.sparkSeed)

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

/** How solid the canvas is at client points: 0 (empty) to 1 (fully inked), and whether it's dark or pale grey there. */
function pixels(page: Page, points: Point[]) {
  return page.evaluate((list) => {
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')!
    return list.map((p) => {
      const x = Math.floor(((p.x - rect.left) * canvas.width) / rect.width)
      const y = Math.floor(((p.y - rect.top) * canvas.height) / rect.height)
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      return { alpha: a / 255, dark: r + g + b < 120, paleGrey: r === g && g === b && r > 200 && r < 245 }
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

const selectedIds = (page: Page) => page.evaluate(() => window.__marque.store.getState().illustrator?.selectedLayerIds ?? [])

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The box around some paths in layer space, as the browser measures it: no code of the app's is asked. */
function boxAround(page: Page, pathData: string[]): Promise<Box> {
  return page.evaluate((list) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', list.join(' '))
    svg.append(path)
    document.body.append(svg)
    const { x, y, width, height } = path.getBBox()
    svg.remove()
    return { x, y, width, height }
  }, pathData)
}

const middle = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

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
  // The canvas nearly fills the page, so outside is the margin beside it.
  const outside = Math.min(f.box.x + f.box.width + 20, page.viewportSize()!.width - 2)
  expect(outside).toBeGreaterThan(f.box.x + f.box.width)
  const body = f.at(150, -120)
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.mouse.move(outside, body.y, { steps: 12 })
  await page.mouse.up()
  const released = (await carves(page)) as [SlabSpec, PunchSpec]
  await page.mouse.move(outside, body.y + 60, { steps: 4 })
  await page.mouse.move(body.x, body.y + 60, { steps: 4 })
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
  await expect(page.locator('main canvas')).toBeVisible()
  expect(await carves(page)).toEqual(before)

  f = await frame(page)
  const slab = before[0] as SlabSpec
  await click(page, f.at(slab.center.x + 100, slab.center.y + 100))
  const east = await handle(page, 'e')
  await drag(page, east, { x: east.x + 30 * f.unit, y: east.y })
  expect(Math.abs(((await carves(page))[0] as SlabSpec).width - (slab.width + 30))).toBeLessThanOrEqual(1)
})

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

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await dialog.getByRole('button', { name: 'Copy SVG' }).click()
  await expect(dialog.getByRole('button', { name: 'SVG copied to clipboard' })).toBeVisible()
  const svg = await page.evaluate(() => navigator.clipboard.readText())
  const copied = /\sd="([^"]+)"/.exec(svg)?.[1]
  expect(copied).toBeTruthy()
  expect(copied).toBe(await page.evaluate(() => window.__marque.mark()?.compoundPathData))

  // Sample the canvas on a grid and compare with the copied path, away from its edges.
  const mismatches = await page.evaluate((d) => {
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
  }, copied!)
  expect(mismatches.checked).toBeGreaterThan(500)
  expect(mismatches.bad).toBe(0)
})

test('the canvas opens on the construction look, and F shows the ink', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  await pickTool(page, 'Punch')
  await drag(page, f.at(60, 60), f.at(90, 60))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await pointerAway(page, f)

  const inSlab = f.at(-100, -100)
  const [fill] = await pixels(page, [inSlab])
  expect(fill).toEqual({ alpha: 1, dark: false, paleGrey: true })
  expect(await isEmpty(page, f.at(60, 60))).toBe(true)

  await page.keyboard.press('f')
  await expect.poll(() => isInk(page, inSlab)).toBe(true)
  expect(await isEmpty(page, f.at(60, 60))).toBe(true)
})

test('a link that cannot be read says so until the message is dismissed', async ({ page }) => {
  await page.goto('/#vd=garbage')
  const message = page.getByRole('alert')
  await expect(message).toContainText('link')

  // An edit does not clear it.
  await addSlab(page, 'Square')
  await expect(message).toBeVisible()

  await message.getByRole('button', { name: 'Dismiss' }).click()
  await expect(message).toHaveCount(0)
  expect(await layers(page)).toHaveLength(1)
})

test('the Layers drawer opens and closes, and a row moves the way its arrow points', async ({ page }) => {
  await openVectorMaker(page)
  const drawer = layersDrawer(page)
  await expect(drawer).toBeHidden()

  await layersButton(page).click()
  await expect(drawer).toBeVisible()
  await layersButton(page).click()
  await expect(drawer).toBeHidden()
  await page.keyboard.press('l')
  await expect(drawer).toBeVisible()
  await page.keyboard.press('l')
  await expect(drawer).toBeHidden()
  await layersButton(page).click()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await openLayers(page)
  await closeLayers(page)

  // A slab with a hole punched in it: the punch is the top layer, so it is the top row.
  await addSlab(page, 'Square')
  const f = await frame(page)
  const hole = f.at(60, 60)
  await pickTool(page, 'Punch')
  await drag(page, hole, f.at(90, 60))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  const [slab, punch] = await layers(page)
  expect(await isEmpty(page, hole)).toBe(true)

  await openLayers(page)
  const rows = drawer.getByRole('listitem')
  const slabRow = rows.filter({ hasText: 'Slab' })
  await expect(rows).toHaveText([/Punch/, /Slab/])
  await expect(rows.first().getByRole('button', { name: /^Move .* up$/ })).toBeDisabled()
  const before = (await slabRow.boundingBox())!.y

  // Up moves the row up the list and the layer up the stack: the slab now covers its hole.
  await slabRow.getByRole('button', { name: /^Move .* up$/ }).click()
  await expect(rows).toHaveText([/Slab/, /Punch/])
  expect((await slabRow.boundingBox())!.y).toBeLessThan(before)
  expect((await layers(page)).map((layer) => layer.id)).toEqual([punch.id, slab.id])
  await expect.poll(() => isInk(page, hole)).toBe(true)

  await slabRow.getByRole('button', { name: /^Move .* down$/ }).click()
  await expect(rows).toHaveText([/Punch/, /Slab/])
  expect((await layers(page)).map((layer) => layer.id)).toEqual([slab.id, punch.id])
  await expect.poll(() => isEmpty(page, hole)).toBe(true)
})

test('the selection bar is there for a selection and gone without one', async ({ page }) => {
  await openVectorMaker(page)
  const bar = selectionBar(page)
  await expect(bar).toBeHidden()

  await addSlab(page, 'Square')
  await expect(bar).toContainText('Slab · 380 × 380 · corner 0')
  // A slab has handles on the canvas, so it gets no sliders.
  await expect(bar.getByRole('button', { name: 'Transform' })).toHaveCount(0)
  const f = await frame(page)

  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  await click(page, f.at(0, 0))
  await expect(bar).toBeVisible()

  await bar.getByRole('button', { name: 'Cut', exact: true }).click()
  expect((await layers(page))[0].operation).toBe('subtract')
  await bar.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(bar).toBeHidden()
  expect(await layers(page)).toHaveLength(0)

  // A pen shape has no handles: its sliders are a click away, and each change is one undo step.
  await pickTool(page, 'Pen')
  for (const [x, y] of [
    [-100, -80],
    [100, -80],
    [0, 90],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  await bar.getByRole('button', { name: 'Transform' }).click()
  const depth = await undoDepth(page)
  await page.getByRole('slider', { name: 'Move X' }).press('ArrowRight')
  expect(await page.evaluate(() => window.__marque.store.getState().illustrator?.layers[0].transform.dx)).toBe(1)
  expect(await undoDepth(page)).toBe(depth + 1)
})

test('an empty canvas says what to do first, until there is something on it', async ({ page }) => {
  await page.goto('/')
  const hint = page.locator('main').getByRole('note')
  await expect(hint).toContainText('slab')

  await pickTool(page, 'Pen')
  await expect(hint).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(hint).toBeVisible()

  await addSlab(page, 'Square')
  await expect(hint).toBeHidden()
})

test('V, P, X, C and S pick the tools, and one pressed mid-drawing does not throw the drawing away', async ({ page }) => {
  await openVectorMaker(page)
  const activeTool = () => page.evaluate(() => window.__marque.store.getState().ui.activeTool)
  for (const [key, tool] of [
    ['p', 'pen'],
    ['x', 'punch'],
    ['c', 'channel'],
    ['s', 'slice'],
    ['v', null],
  ] as const) {
    await page.keyboard.press(key)
    expect(await activeTool()).toBe(tool)
  }

  const f = await frame(page)
  await page.keyboard.press('p')
  for (const [x, y] of [
    [-100, -80],
    [100, -80],
    [0, 90],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('s')
  expect(await activeTool()).toBe('pen')
  await page.keyboard.press('Enter')
  expect(await layers(page)).toHaveLength(1)
})

test('Saved keeps a mark and brings it back', async ({ page }) => {
  await openVectorMaker(page)
  await addSlab(page, 'Rounded')
  const kept = await carves(page)
  const savedButton = page.getByRole('button', { name: 'Saved', exact: true })
  const menu = page.getByRole('group', { name: 'Saved marks' })

  await savedButton.click()
  await menu.getByRole('button', { name: 'Save current' }).click()
  const remove = menu.getByRole('button', { name: /^Delete / })
  await expect(remove).toHaveCount(1)
  const name = (await remove.getAttribute('aria-label'))!.replace(/^Delete /, '')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  await startOver(page)
  await savedButton.click()
  await menu.getByRole('button', { name, exact: true }).click()
  await expect(menu).toBeHidden()
  expect(await carves(page)).toEqual(kept)
})

test('a spark dropped on an empty canvas lands in the middle, all selected, as one undo step', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await dealSparks(page, 1)
  await pickTool(page, 'Pen')
  // Slot 3 of this set carries cuts.
  await sparkButton(page, 3).click()

  const dropped = await layers(page)
  expect(dropped.map((layer) => layer.operation)).toEqual(['add', 'add', 'add', 'add', 'subtract', 'subtract'])
  expect(dropped.every((layer) => layer.carve === null)).toBe(true)
  expect(await selectedIds(page)).toEqual(dropped.map((layer) => layer.id))
  expect(await page.evaluate(() => window.__marque.store.getState().ui.activeTool)).toBeNull()
  expect(await undoDepth(page)).toBe(1)
  const bar = selectionBar(page)
  await expect(bar).toContainText('6 layers')
  await expect(bar.getByRole('button', { name: 'Scale' })).toBeVisible()

  // The mark itself is 360 units on its longer side, about the middle of the canvas.
  const ink = (await page.evaluate(() => window.__marque.mark()))!
  expect(Math.max(ink.viewBox.width, ink.viewBox.height)).toBeCloseTo(360, 1)
  expect(middle(ink.viewBox).x).toBeCloseTo(0, 1)
  expect(middle(ink.viewBox).y).toBeCloseTo(0, 1)

  // It is drawn as a construction sheet: pale grey wherever the mark is solid.
  const f = await frame(page)
  await pointerAway(page, f)
  const solid = await page.evaluate((d) => {
    const probe = document.createElement('canvas').getContext('2d')!
    const path = new Path2D(d)
    const points: Array<{ x: number; y: number }> = []
    for (let y = -180; y <= 180; y += 4) {
      for (let x = -180; x <= 180; x += 4) {
        const settled = [-6, 0, 6].every((dx) => [-6, 0, 6].every((dy) => probe.isPointInPath(path, x + dx, y + dy, 'evenodd')))
        if (settled) points.push({ x, y })
      }
    }
    return points
  }, ink.compoundPathData)
  expect(solid.length).toBeGreaterThan(3)
  const drawn = await pixels(page, solid.map((p) => f.at(p.x, p.y)))
  expect(drawn.filter((pixel) => !pixel.paleGrey)).toEqual([])

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layers(page).then((list) => list.length)).toBe(0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => layers(page)).toEqual(dropped)
})

test('a spark goes beside a slab and under it, and leaves the slab as it was', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  await addSlab(page, 'Square')
  const [slab] = await layers(page)
  const depth = await undoDepth(page)

  // Slot 1 of this set has no cuts, so the box around its layers is the box around its ink.
  await sparkButton(page, 1).click()
  const all = await layers(page)
  const dropped = all.slice(0, -1)
  expect(dropped.length).toBeGreaterThan(1)
  expect(dropped.every((layer) => layer.operation === 'add')).toBe(true)
  expect(all.at(-1)).toEqual(slab)
  expect(await selectedIds(page)).toEqual(dropped.map((layer) => layer.id))
  expect(await undoDepth(page)).toBe(depth + 1)

  const spark = await boxAround(page, dropped.map((layer) => layer.pathData))
  const { center, width, height } = slab.carve as SlabSpec
  const clear =
    spark.x >= center.x + width / 2 ||
    spark.x + spark.width <= center.x - width / 2 ||
    spark.y >= center.y + height / 2 ||
    spark.y + spark.height <= center.y - height / 2
  expect(clear).toBe(true)
  // And on the canvas, not past its edge.
  const viewport = await page.evaluate(() => window.__marque.store.getState().ui.viewport)
  expect(Math.abs(middle(spark).x) + spark.width / 2).toBeLessThanOrEqual(viewport.width / 2)
  expect(Math.abs(middle(spark).y) + spark.height / 2).toBeLessThanOrEqual(viewport.height / 2)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layers(page)).toEqual([slab])
})

test('Shuffle and R deal new sparks, and R waits for a drawing, a drag or a dialog to finish', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  const first = await thumbnails(page)
  expect(new Set(first).size).toBe(8)

  await page.getByRole('button', { name: 'Shuffle', exact: true }).click()
  await expect.poll(() => thumbnails(page)).not.toEqual(first)
  await expect(sparkTray(page)).toHaveAttribute('aria-busy', 'false')
  const second = await thumbnails(page)

  await page.keyboard.press('r')
  await expect.poll(() => thumbnails(page)).not.toEqual(second)
  await expect(sparkTray(page)).toHaveAttribute('aria-busy', 'false')
  const third = await thumbnails(page)
  expect(third).not.toEqual(first)
  expect(first.filter((d) => second.includes(d) || third.includes(d))).toEqual([])

  // The same seed deals the same set again.
  await dealSparks(page, 1)
  expect(await thumbnails(page)).toEqual(first)
  const seed = await sparkSeed(page)

  // A held modifier is another shortcut, not this one.
  await page.keyboard.press('Shift+r')
  expect(await sparkSeed(page)).toBe(seed)

  // Mid-drawing with the pen.
  const f = await frame(page)
  await page.keyboard.press('p')
  await click(page, f.at(-100, -80))
  await click(page, f.at(100, -80))
  await page.keyboard.press('r')
  expect(await sparkSeed(page)).toBe(seed)
  await click(page, f.at(0, 90))
  await page.keyboard.press('Enter')
  expect(await layers(page)).toHaveLength(1)

  // Mid-drag.
  const body = f.at(0, -40)
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.mouse.move(body.x + 30, body.y, { steps: 5 })
  await page.keyboard.press('r')
  expect(await sparkSeed(page)).toBe(seed)
  await page.mouse.up()

  // Behind a dialog.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
  await page.keyboard.press('r')
  expect(await sparkSeed(page)).toBe(seed)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeHidden()

  expect(await thumbnails(page)).toEqual(first)
  await page.keyboard.press('r')
  await expect.poll(() => sparkSeed(page)).not.toBe(seed)
})

test('several free shapes scale together about their middle, and a slab among them takes the control away', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  await sparkButton(page, 1).click()
  const before = await layers(page)
  const was = await boxAround(page, before.map((layer) => layer.pathData))

  const bar = selectionBar(page)
  await expect(bar.getByRole('button', { name: 'Transform' })).toHaveCount(0)
  await bar.getByRole('button', { name: 'Scale' }).click()
  const size = page.getByRole('slider', { name: 'Size' })
  await expect(size).toHaveAttribute('aria-valuenow', '360')
  const depth = await undoDepth(page)

  // Page Down takes ten units off the longer side.
  await size.press('PageDown')
  await expect(size).toHaveAttribute('aria-valuenow', '350')
  expect(await undoDepth(page)).toBe(depth + 1)
  const after = await layers(page)
  const now = await boxAround(page, after.map((layer) => layer.pathData))
  expect(after.map((layer) => layer.id)).toEqual(before.map((layer) => layer.id))
  expect(Math.max(now.width, now.height)).toBeCloseTo(350, 1)
  expect(now.width / now.height).toBeCloseTo(was.width / was.height, 3)
  expect(middle(now).x).toBeCloseTo(middle(was).x, 1)
  expect(middle(now).y).toBeCloseTo(middle(was).y, 1)
  expect(await selectedIds(page)).toEqual(before.map((layer) => layer.id))

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layers(page)).toEqual(before)
  await expect(size).toHaveAttribute('aria-valuenow', '360')
  await page.keyboard.press('Escape')

  // A slab has its own handles: with one in the selection there is nothing to scale together.
  await addSlab(page, 'Square')
  await page.evaluate(() => {
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection(illustrator!.layers.map((layer) => layer.id))
  })
  await expect(bar).toContainText(`${before.length + 1} layers`)
  await expect(bar.getByRole('button', { name: 'Scale' })).toHaveCount(0)
})
