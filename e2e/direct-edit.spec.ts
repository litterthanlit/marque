import { expect, test as base, type Locator, type Page } from '@playwright/test'
import LZString from 'lz-string'
import type { DevHook } from '../src/devHook.ts'
import type { CarveSpec, GrooveSpec, PolygonSpec, PunchSpec, SlabSpec } from '../src/engine/carve/spec.ts'
import { STAGE_1_LINK } from './fixtures/stage1Link.ts'

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
/** The bar's words for the selection: what it is, then its numbers. */
const selectionSummary = (page: Page) => selectionBar(page).locator('p').first()

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

const addSlab = (page: Page, name: 'Square' | 'Rounded' | 'Circle' | 'Tall' | 'Polygon') =>
  page.getByRole('button', { name: `Add ${name.toLowerCase()} slab` }).click()

const pickTool = (page: Page, name: 'Pen' | 'Punch' | 'Channel' | 'Slice' | 'Guide') =>
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

/**
 * The points of a grid over the canvas (layer space) that show ink where the
 * document's mark has none, or none where it has some. Points near an edge
 * of the mark or under a handle are left out. The mark is measured by the
 * browser, not by the app. `expected` stands in for the document's mark.
 */
function inkMismatches(page: Page, span = 280, step = 20, expected?: string) {
  return page.evaluate(
    ({ span, step, expected }) => {
      const mark = window.__marque.mark()
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', expected ?? mark.compoundPathData)
      path.setAttribute('fill-rule', mark.fillRule)
      svg.append(path)
      document.body.append(svg)
      const inside = (x: number, y: number) => path.isPointInFill(new DOMPoint(x, y))
      const canvas = document.querySelector('main canvas') as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      const unit = Math.min(rect.width, rect.height) / 600
      const ctx = canvas.getContext('2d')!
      const handles = window.__marque.handles()
      const bad: Array<{ x: number; y: number; ink: boolean }> = []
      for (let x = -span; x <= span; x += step) {
        for (let y = -span; y <= span; y += step) {
          const expected = inside(x, y)
          // Within 4 pixels of an edge, the selection's outline and smoothing decide the pixel.
          const m = Math.max(3, 4 / unit)
          const near = [
            [-m, 0],
            [m, 0],
            [0, -m],
            [0, m],
          ].some(([dx, dy]) => inside(x + dx, y + dy) !== expected)
          const cx = rect.width / 2 + x * unit
          const cy = rect.height / 2 + y * unit
          const covered = handles.some((h) => Math.hypot(h.x - rect.left - cx, h.y - rect.top - cy) < 12)
          if (near || covered || cx < 0 || cy < 0 || cx >= rect.width || cy >= rect.height) continue
          const [r, g, b, a] = ctx.getImageData(Math.floor((cx * canvas.width) / rect.width), Math.floor((cy * canvas.height) / rect.height), 1, 1).data
          const ink = a > 0.9 * 255 && r + g + b < 120
          if (ink !== expected) bad.push({ x, y, ink })
        }
      }
      svg.remove()
      return bad
    },
    { span, step, expected },
  )
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

/** How far each layer's box is turned: 0 when it is upright. */
const frameRotations = (page: Page) =>
  page.evaluate(() => window.__marque.store.getState().illustrator.layers.map((layer) => layer.frameRotation ?? 0))

/** Every anchor of each layer, in layer space, as the editor sees them. */
const anchors = (page: Page) =>
  page.evaluate(() =>
    window.__marque.store
      .getState()
      .illustrator.layers.map((layer) => window.__marque.bakedEditablePath(layer)?.segs.map((seg) => seg.p) ?? []),
  )

/** Every anchor of each layer, contour by contour: a hole is a further contour. */
const contourAnchors = (page: Page) =>
  page.evaluate(() =>
    window.__marque.store
      .getState()
      .illustrator.layers.map((layer) => window.__marque.bakedEditableShape(layer)?.map((path) => path.segs.map((seg) => seg.p)) ?? []),
  )

/** The selected point, if any: its layer, contour and index. */
const pointSelection = (page: Page) => page.evaluate(() => window.__marque.store.getState().illustrator.pointSelection)

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

const handleIds = async (page: Page) => (await page.evaluate(() => window.__marque.handles())).map((candidate) => candidate.id)

/** The middle of the selection's box, in layer space: halfway between two opposite corner handles. */
async function boxMiddle(page: Page, f: Frame): Promise<Point> {
  const nw = await handle(page, 'nw')
  const se = await handle(page, 'se')
  return { x: ((nw.x + se.x) / 2 - f.box.x - f.box.width / 2) / f.unit, y: ((nw.y + se.y) / 2 - f.box.y - f.box.height / 2) / f.unit }
}

/** Drag the rotate knob about a pivot (client space) by `degrees`, clockwise on screen. */
async function turnKnob(page: Page, pivot: Point, degrees: number, modifiers: string[] = []) {
  const knob = await handle(page, 'rotate')
  const reach = Math.hypot(knob.x - pivot.x, knob.y - pivot.y)
  const angle = Math.atan2(knob.y - pivot.y, knob.x - pivot.x) + (degrees * Math.PI) / 180
  await drag(page, knob, { x: pivot.x + Math.cos(angle) * reach, y: pivot.y + Math.sin(angle) * reach }, modifiers)
}

const rotateAbout = (p: Point, pivot: Point, degrees: number): Point => {
  const r = (degrees * Math.PI) / 180
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return { x: pivot.x + dx * Math.cos(r) - dy * Math.sin(r), y: pivot.y + dx * Math.sin(r) + dy * Math.cos(r) }
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

  // Without Shift it turns freely, to a whole degree: the angle the readout shows is the angle stored.
  // Long enough after the last press on the knob not to count as a double-click.
  await page.waitForTimeout(400)
  const free = Math.atan2(knob.y - pivot.y, knob.x - pivot.x) + (37.4 * Math.PI) / 180
  await drag(page, knob, { x: pivot.x + Math.cos(free) * reach, y: pivot.y + Math.sin(free) * reach })
  const freeTurn = ((await carves(page))[0] as SlabSpec).rotation
  expect(Number.isInteger(freeTurn)).toBe(true)
  expect(Math.abs(freeTurn - 37)).toBeLessThanOrEqual(1)
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

  // Grow it from a corner handle, then drag it to the middle: it snaps onto the slab's centre and says it is pinned there.
  const corner = await handle(page, 'se')
  await drag(page, corner, { x: corner.x + 10, y: corner.y + 10 })
  const grown = (await carves(page)).at(-1) as PunchSpec
  expect(grown.radius).toBeGreaterThan(punch.radius)
  const from = f.at(grown.center.x, grown.center.y)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const near = f.at(3, -2)
  await page.mouse.move(near.x, near.y, { steps: 12 })
  await expect(hudLabel(page, 'pinned')).toBeVisible()
  await page.mouse.up()
  expect(((await carves(page)).at(-1) as PunchSpec).center).toEqual({ x: 0, y: 0 })
  expect(await page.evaluate(() => window.__marque.store.getState().illustrator.layers.at(-1)?.pin)).toBe((await layers(page))[0].id)

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

test('an arrow nudge is written at once, and undo straight after a burst of them takes the whole burst back', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  const [slab] = (await carves(page)) as SlabSpec[]
  // A drag first, so there is an older step that the burst must not reach into.
  const body = f.at(slab.center.x - 100, slab.center.y - 100)
  await drag(page, body, { x: body.x + 40 * f.unit, y: body.y })
  const [moved] = (await carves(page)) as SlabSpec[]
  expect(moved.center.x).toBeGreaterThan(slab.center.x + 20)
  const depth = await undoDepth(page)

  // One nudge is in the document as soon as the key is down.
  await page.keyboard.press('ArrowRight')
  expect(((await carves(page))[0] as SlabSpec).center.x).toBeCloseTo(moved.center.x + 1, 6)
  expect(await undoDepth(page)).toBe(depth + 1)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await carves(page)).toEqual([moved])
  expect(await undoDepth(page)).toBe(depth)
  expect(await page.evaluate(() => window.__marque.store.getState().vectorRedoStack.length)).toBe(1)
  // Nothing lands later, and the canvas shows what undo restored, not the nudged slab.
  await page.waitForTimeout(700)
  expect(await carves(page)).toEqual([moved])
  await pointerAway(page, f)
  expect(await inkMismatches(page)).toEqual([])

  // A longer burst is one undo step, written key by key: undo takes all of it back.
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  expect(((await carves(page))[0] as SlabSpec).center.x).toBeCloseTo(moved.center.x + 30, 6)
  expect(await undoDepth(page)).toBe(depth + 1)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await carves(page)).toEqual([moved])
  expect(await undoDepth(page)).toBe(depth)
  expect(await inkMismatches(page)).toEqual([])

  // A pause of a second ends a burst: the next key is a step of its own.
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(1100)
  await page.keyboard.press('ArrowDown')
  expect(await undoDepth(page)).toBe(depth + 2)
})

test('a point deleted straight after a nudge stays deleted', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await page.evaluate(() => {
    window.__marque.store.getState().addPenShape('M-100,-50L100,-50L100,50L-100,50Z')
    const { illustrator, setSelection } = window.__marque.store.getState()
    const id = illustrator.layers[0].id
    setSelection([id], { layerId: id, segmentIndex: 0 })
  })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const depth = await undoDepth(page)

  // The shape moves whole, so its point stays selected; Delete then removes the point, not the shape.
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Delete')
  const [points] = await anchors(page)
  expect(points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
    { x: 110, y: -50 },
    { x: 110, y: 50 },
    { x: -90, y: 50 },
  ])
  expect(await undoDepth(page)).toBe(depth + 2)
  // Nothing written later brings it back.
  await page.waitForTimeout(700)
  expect((await anchors(page))[0]).toHaveLength(3)
  await page.keyboard.press('ControlOrMeta+z')
  expect((await anchors(page))[0]).toHaveLength(4)
})

test('a burst of keys picks the holes it carries once, as a drag does', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  /** Two pen squares and a punch, the punch on top; the first square is selected. Returns the punch's centre. */
  const setUp = (shapes: string[], cut: { x: number; y: number; radius: number }) =>
    page.evaluate(
      ([paths, punch]) => {
        const store = window.__marque.store
        store.getState().startOver()
        for (const path of paths) store.getState().addPenShape(path)
        store.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: punch.x, y: punch.y }, radius: punch.radius })
        const { illustrator, setSelection } = store.getState()
        setSelection([illustrator.layers[0].id])
        ;(document.activeElement as HTMLElement | null)?.blur()
      },
      [shapes, cut] as const,
    )
  const punch = async () => (await carves(page)).find((spec) => spec?.kind === 'punch') as PunchSpec
  const press = async (key: string, times: number) => {
    for (let i = 0; i < times; i++) await page.keyboard.press(key)
  }

  // A hole in the square goes the whole way, though halfway it touches the square next door.
  await setUp(['M-250,-50L-150,-50L-150,50L-250,50Z', 'M-120,-50L0,-50L0,50L-120,50Z'], { x: -160, y: 0, radius: 20 })
  let depth = await undoDepth(page)
  await press('Shift+ArrowRight', 5)
  expect(await undoDepth(page)).toBe(depth + 1)
  expect((await punch()).center.x).toBeCloseTo(-110, 6)
  await page.keyboard.press('ControlOrMeta+z')
  expect((await punch()).center.x).toBeCloseTo(-160, 6)

  // A stray hole the square reaches partway is not picked up: the square slides under it.
  await setUp(['M-200,-50L-100,-50L-100,50L-200,50Z'], { x: 0, y: 0, radius: 20 })
  depth = await undoDepth(page)
  await press('Shift+ArrowRight', 12)
  expect(await undoDepth(page)).toBe(depth + 1)
  expect((await punch()).center).toEqual({ x: 0, y: 0 })

  // Turned with Alt, a hole in a bar goes the whole quarter turn, past a square it touches on the way.
  await setUp(['M-100,-20L100,-20L100,20L-100,20Z', 'M-30,60L30,60L30,120L-30,120Z'], { x: 85, y: 0, radius: 12 })
  depth = await undoDepth(page)
  await press('Alt+Shift+ArrowRight', 6)
  expect(await undoDepth(page)).toBe(depth + 1)
  const turned = await punch()
  expect(turned.center.x).toBeCloseTo(0, 1)
  expect(turned.center.y).toBeCloseTo(85, 1)
})

test("a key's number stays only for a moment, and takes the place of a handle's number under the pointer", async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await page.evaluate(() => {
    window.__marque.store.getState().addPenShape('M-100,-50L100,-50L100,50L-100,50Z')
    ;(document.activeElement as HTMLElement | null)?.blur()
  })

  // A click that comes while the number shows, held past its moment, takes it away.
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await expect(hudLabel(page, '210 × 105')).toBeVisible()
  const body = f.at(-60, 0)
  await page.mouse.move(body.x, body.y)
  await page.mouse.down()
  await page.waitForTimeout(1300)
  await page.mouse.up()
  await expect(hudLabel(page, '210 × 105')).toHaveCount(0)
  await pointerAway(page, f)
  await expect(hudLabel(page, '210 × 105')).toHaveCount(0)

  // With the pointer resting on a side handle, a turn reads out its angle there, not the size,
  // and once its moment is over the handle's own number comes back.
  await page.keyboard.press('ControlOrMeta+z')
  const east = await handle(page, 'e')
  await page.mouse.move(east.x, east.y)
  await expect(hudLabel(page, '200 × 100')).toBeVisible()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(hudLabel(page, '1°')).toBeVisible()
  await expect(hudLabel(page, '200 × 100')).toHaveCount(0)
  await expect(hudLabel(page, '200 × 100')).toBeVisible({ timeout: 2000 })
  await expect(hudLabel(page, '1°')).toHaveCount(0)

  // On the knob of two shapes, whose box is measured upright again after each key, it reads how far the key turned them.
  await page.evaluate(() => {
    const store = window.__marque.store
    store.getState().startOver()
    store.getState().addPenShape('M-150,-30L-50,-30L-50,30L-150,30Z')
    store.getState().addPenShape('M50,-30L150,-30L150,30L50,30Z')
    const { illustrator, setSelection } = store.getState()
    setSelection(illustrator.layers.map((layer) => layer.id))
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  const knob = await handle(page, 'rotate')
  await page.mouse.move(knob.x, knob.y)
  await page.keyboard.press('Alt+ArrowRight')
  await expect(hudLabel(page, '1°')).toBeVisible()
  await expect(hudLabel(page, '0°')).toHaveCount(0)
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

  // A pen shape has handles too: its east side pulls it wider on that axis alone, as one undo step.
  await pickTool(page, 'Pen')
  for (const [x, y] of [
    [-100, -80],
    [100, -80],
    [0, 90],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Transform' })).toHaveCount(0)
  expect(await handleIds(page)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'])
  const [shape] = await layers(page)
  const was = await boxAround(page, [shape.pathData])
  const depth = await undoDepth(page)

  const east = await handle(page, 'e')
  await page.mouse.move(east.x, east.y)
  await page.mouse.down()
  await page.mouse.move(east.x + 50 * f.unit, east.y, { steps: 10 })
  await expect(page.locator('main').getByText(new RegExp(`^\\d+ × ${Math.round(was.height)}$`))).toBeVisible()
  await page.mouse.up()

  const [resized] = await layers(page)
  expect(resized).toMatchObject({ id: shape.id, carve: null })
  const now = await boxAround(page, [resized.pathData])
  expect(Math.abs(now.width - was.width - 50)).toBeLessThanOrEqual(1)
  expect(now.height).toBeCloseTo(was.height, 3)
  expect(now.x).toBeCloseTo(was.x, 3)
  expect(now.y).toBeCloseTo(was.y, 3)
  expect(await undoDepth(page)).toBe(depth + 1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layers(page)).toEqual([shape])
})

test('the selection bar reads out a new selection, even of the same kind, but not the keys that move it', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Square')
  await addSlab(page, 'Circle')
  const [square, circle] = (await layers(page)).map((layer) => layer.id)
  await page.evaluate((id) => window.__marque.store.getState().setSelection([id]), square)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const live = selectionBar(page).locator('[aria-live]')
  await expect(live).toHaveText('Slab')
  const changes = () => live.evaluate((node) => (node as HTMLElement & { changes?: number }).changes ?? 0)
  await live.evaluate((node) => {
    const counted = node as HTMLElement & { changes?: number }
    counted.changes = 0
    new MutationObserver((records) => (counted.changes! += records.length)).observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  })

  // A burst of keys changes the numbers, which are not read out.
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(selectionSummary(page)).toHaveText(/^Slab · 380 × 380/)
  expect(await changes()).toBe(0)

  // Another slab reads 'Slab' too, yet it is a new selection, so it is read out.
  await page.evaluate((id) => window.__marque.store.getState().setSelection([id]), circle)
  await expect(selectionSummary(page)).toHaveText(/^Slab · 200 × 200/)
  await expect(live).toHaveText('Slab')
  await expect.poll(changes).toBeGreaterThan(0)
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

test('V, P, X, C, S and G pick the tools, and one pressed mid-drawing does not throw the drawing away', async ({ page }) => {
  await openVectorMaker(page)
  const activeTool = () => page.evaluate(() => window.__marque.store.getState().ui.activeTool)
  for (const [key, tool] of [
    ['p', 'pen'],
    ['x', 'punch'],
    ['c', 'channel'],
    ['s', 'slice'],
    ['g', 'guide'],
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
  expect(dropped.map((layer) => layer.operation)).toEqual(['add', 'add', 'subtract'])
  expect(dropped.every((layer) => layer.carve === null)).toBe(true)
  expect(await selectedIds(page)).toEqual(dropped.map((layer) => layer.id))
  expect(await page.evaluate(() => window.__marque.store.getState().ui.activeTool)).toBeNull()
  expect(await undoDepth(page)).toBe(1)
  const bar = selectionBar(page)
  await expect(bar).toContainText('3 layers')
  // One box goes round them all, with every handle: there are no recipes among them.
  expect(await handleIds(page)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'])

  // The mark itself is 360 units on its longer side, about the middle of the canvas.
  const ink = (await page.evaluate(() => window.__marque.mark()))!
  expect(Math.max(ink.viewBox.width, ink.viewBox.height)).toBeCloseTo(360, 1)
  expect(middle(ink.viewBox).x).toBeCloseTo(0, 1)
  expect(middle(ink.viewBox).y).toBeCloseTo(0, 1)

  // It is drawn as a construction sheet: pale grey wherever the mark is solid.
  const f = await frame(page)
  await pointerAway(page, f)
  // The shapes overlap, so their own hairlines cross the ink: the probes keep clear of every outline.
  const solid = await page.evaluate(
    ({ d, outlines }) => {
      const probe = document.createElement('canvas').getContext('2d')!
      const path = new Path2D(d)
      const shapes = outlines.map((outline) => new Path2D(outline))
      const points: Array<{ x: number; y: number }> = []
      for (let y = -180; y <= 180; y += 4) {
        for (let x = -180; x <= 180; x += 4) {
          const around = [-6, 0, 6].flatMap((dx) => [-6, 0, 6].map((dy) => [x + dx, y + dy]))
          const settled = around.every(([px, py]) => probe.isPointInPath(path, px, py, 'evenodd'))
          const clear = shapes.every((shape) => new Set(around.map(([px, py]) => probe.isPointInPath(shape, px, py))).size === 1)
          if (settled && clear) points.push({ x, y })
        }
      }
      return points
    },
    { d: ink.compoundPathData, outlines: dropped.map((layer) => layer.pathData) },
  )
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

  // Slot 4 of this set has no cuts, so the box around its layers is the box around its ink.
  await sparkButton(page, 4).click()
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

test('several free shapes scale together from a corner of their box, and a slab among them keeps it uniform', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  await sparkButton(page, 4).click()
  const f = await frame(page)
  const before = await layers(page)
  const was = await boxAround(page, before.map((layer) => layer.pathData))
  const bar = selectionBar(page)
  await expect(bar.getByRole('button', { name: 'Scale' })).toHaveCount(0)
  const depth = await undoDepth(page)

  // Shift and Alt: the corner scales the whole box about its middle, which stays put.
  const corner = await handle(page, 'se')
  const middleOnScreen = f.at(middle(was).x, middle(was).y)
  const inward = 0.1
  await drag(
    page,
    corner,
    { x: corner.x + (middleOnScreen.x - corner.x) * inward, y: corner.y + (middleOnScreen.y - corner.y) * inward },
    ['Shift', 'Alt', 'ControlOrMeta'],
  )
  expect(await undoDepth(page)).toBe(depth + 1)
  const after = await layers(page)
  const now = await boxAround(page, after.map((layer) => layer.pathData))
  expect(after.map((layer) => layer.id)).toEqual(before.map((layer) => layer.id))
  expect(now.width).toBeLessThan(was.width - 10)
  expect(now.width / now.height).toBeCloseTo(was.width / was.height, 3)
  expect(middle(now).x).toBeCloseTo(middle(was).x, 1)
  expect(middle(now).y).toBeCloseTo(middle(was).y, 1)
  expect(await selectedIds(page)).toEqual(before.map((layer) => layer.id))

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layers(page)).toEqual(before)
  await page.keyboard.press('Escape')

  // With a slab in the selection only the corners show, and they scale every layer alike.
  await addSlab(page, 'Square')
  await page.evaluate(() => {
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection(illustrator.layers.map((layer) => layer.id))
  })
  await expect(bar).toContainText(`${before.length + 1} layers`)
  expect(await handleIds(page)).toEqual(['nw', 'ne', 'se', 'sw', 'rotate'])
  const all = await layers(page)
  const slab = all.at(-1)!.carve as SlabSpec
  const piecesWere = await boxAround(page, all.slice(0, -1).map((layer) => layer.pathData))
  const handles = await page.evaluate(() => window.__marque.handles())
  // A corner that is on screen, pulled a fifth of the way towards the opposite one.
  const inside = (p: Point) => p.x > f.box.x + 4 && p.x < f.box.x + f.box.width - 4 && p.y > f.box.y + 4 && p.y < f.box.y + f.box.height - 4
  const opposite: Record<string, string> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }
  const grabbed = handles.find((candidate) => candidate.id in opposite && inside(candidate))!
  expect(grabbed, 'a corner on screen').toBeTruthy()
  const far = handles.find((candidate) => candidate.id === opposite[grabbed.id])!
  const slabDepth = await undoDepth(page)
  await drag(page, grabbed, { x: grabbed.x + (far.x - grabbed.x) * 0.2, y: grabbed.y + (far.y - grabbed.y) * 0.2 }, ['ControlOrMeta'])
  expect(await undoDepth(page)).toBe(slabDepth + 1)

  const scaled = await layers(page)
  const resized = scaled.at(-1)!.carve as SlabSpec
  expect(resized).toMatchObject({ kind: 'slab', rotation: 0 })
  const factor = resized.width / slab.width
  expect(factor).toBeLessThan(0.95)
  expect(resized.height / slab.height).toBeCloseTo(factor, 2)
  expect(resized.radius).toBeCloseTo(slab.radius * factor, 1)
  const piecesNow = await boxAround(page, scaled.slice(0, -1).map((layer) => layer.pathData))
  expect(piecesNow.width / piecesWere.width).toBeCloseTo(factor, 2)
  expect(piecesNow.height / piecesWere.height).toBeCloseTo(factor, 2)
  // The slab is still a recipe: its own handles come back when it is selected alone.
  await page.evaluate((id) => window.__marque.store.getState().setSelection([id]), scaled.at(-1)!.id)
  expect(await handleIds(page)).toContain('radius')
})

test('a dropped spark turns as one piece in 15° steps with Shift, as one undo step', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  await sparkButton(page, 4).click()
  const f = await frame(page)
  const before = await anchors(page)
  const depth = await undoDepth(page)
  const pivot = await boxMiddle(page, f)

  const knob = await handle(page, 'rotate')
  const centre = f.at(pivot.x, pivot.y)
  const reach = Math.hypot(knob.x - centre.x, knob.y - centre.y)
  const angle = Math.atan2(knob.y - centre.y, knob.x - centre.x) + (31 * Math.PI) / 180
  await page.keyboard.down('Shift')
  await page.mouse.move(knob.x, knob.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + Math.cos(angle) * reach, centre.y + Math.sin(angle) * reach, { steps: 10 })
  await expect(hudLabel(page, '30°')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')

  expect(await undoDepth(page)).toBe(depth + 1)
  const after = await anchors(page)
  expect(after.map((points) => points.length)).toEqual(before.map((points) => points.length))
  for (const [i, points] of after.entries()) {
    for (const [j, p] of points.entries()) {
      const expected = rotateAbout(before[i][j], pivot, 30)
      expect(Math.abs(p.x - expected.x)).toBeLessThan(0.01)
      expect(Math.abs(p.y - expected.y)).toBeLessThan(0.01)
    }
  }
  // Every shape's own box turned with it; the box round them all is upright again.
  expect(await frameRotations(page)).toEqual(before.map(() => 30))
  const n = await handle(page, 'n')
  const s = await handle(page, 's')
  expect(Math.abs(n.x - s.x)).toBeLessThan(0.5)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => anchors(page)).toEqual(before)
  expect(await frameRotations(page)).toEqual(before.map(() => 0))
})

test("a pen shape's box turns with it and stays turned, and resizes along its own sides", async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Pen')
  for (const [x, y] of [
    [-120, -60],
    [120, -60],
    [120, 60],
    [-120, 60],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  const depth = await undoDepth(page)

  await turnKnob(page, f.at(0, 0), 31, ['Shift'])
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(await frameRotations(page)).toEqual([30])
  // The bar reads its size and angle at rest, as it does for a recipe.
  const label = selectionSummary(page)
  await expect(label).toHaveText(/ · 2\d\d × 1\d\d · 30°$/)
  // The box is turned: its east handle sits out along the shape's own turned axis.
  const east = await handle(page, 'e')
  const along = rotateAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 30)
  const out = { x: (east.x - f.at(0, 0).x) / f.unit, y: (east.y - f.at(0, 0).y) / f.unit }
  expect(Math.abs(out.x * along.y - out.y * along.x)).toBeLessThan(0.5)

  // Pull the east side out 40 units along that axis: the shape grows along it alone, and stays turned.
  await drag(page, east, { x: east.x + along.x * 40 * f.unit, y: east.y + along.y * 40 * f.unit }, ['ControlOrMeta'])
  expect(await undoDepth(page)).toBe(depth + 2)
  expect(await frameRotations(page)).toEqual([30])
  const [points] = await anchors(page)
  const local = points.map((p) => rotateAbout(p, { x: 0, y: 0 }, -30))
  const xs = local.map((p) => p.x)
  const ys = local.map((p) => p.y)
  expect(Math.abs(Math.max(...xs) - Math.min(...xs) - 280)).toBeLessThanOrEqual(1)
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(120, 2)
  expect(Math.min(...xs)).toBeCloseTo(-120, 2)

  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => frameRotations(page)).toEqual([0])

  // Turned freely, the knob lands on a whole degree: the angle read out is the angle stored.
  await turnKnob(page, f.at(0, 0), 37)
  const [free] = await frameRotations(page)
  expect(Number.isInteger(free)).toBe(true)
  expect(Math.abs(free - 37)).toBeLessThanOrEqual(1)
  await expect(label).toHaveText(new RegExp(` · ${free}°$`))

  // Resized freely with snapping on, the side lands on a whole unit: the size read out is the size stored.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => frameRotations(page)).toEqual([0])
  const side = await handle(page, 'e')
  await drag(page, side, { x: side.x + 37.3 * f.unit, y: side.y + 3 })
  const [resized] = await anchors(page)
  const width = Math.max(...resized.map((p) => p.x)) - Math.min(...resized.map((p) => p.x))
  expect(width).toBeGreaterThan(260)
  expect(Math.abs(width - Math.round(width))).toBeLessThan(1e-6)
  await expect(label).toHaveText(new RegExp(` · ${Math.round(width)} × 120$`))
})

test('a carve tool started beside a selected shape cuts it, rather than taking the box handle there', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Pen')
  for (const [x, y] of [
    [-120, -60],
    [120, -60],
    [120, 60],
    [-120, 60],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  const [shape] = await layers(page)
  expect(await selectedIds(page)).toEqual([shape.id])

  // The side handle sits just outside the shape's west side, right where a cut across it starts.
  const west = await handle(page, 'w')
  await pickTool(page, 'Slice')
  await drag(page, west, f.at(200, 0))
  const after = await layers(page)
  expect(after).toHaveLength(2)
  expect(after[0].pathData).toBe(shape.pathData)
  expect(after[1].carve?.kind).toBe('slice')
  await page.keyboard.press('Escape')

  // A dropped spark is all selected: a cut beside it goes through it too.
  await startOver(page)
  await dealSparks(page, 1)
  await sparkButton(page, 4).click()
  const pieces = await layers(page)
  const side = await handle(page, 'w')
  await pickTool(page, 'Slice')
  await drag(page, side, f.at(280, (side.y - f.at(0, 0).y) / f.unit))
  const cut = await layers(page)
  expect(cut).toHaveLength(pieces.length + 1)
  expect(cut.slice(0, -1).map((layer) => layer.pathData)).toEqual(pieces.map((layer) => layer.pathData))
  expect(cut.at(-1)!.carve?.kind).toBe('slice')
})

test('a spark with cuts sticking far out keeps its box on the ink, and every handle on the canvas', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  await sparkButton(page, 1).click()
  const f = await frame(page)
  const pieces = await layers(page)
  expect(pieces.some((layer) => layer.operation === 'subtract')).toBe(true)
  const handles = await page.evaluate(() => window.__marque.handles())
  expect(handles.map((candidate) => candidate.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'])
  const reachable = await page.evaluate(() => {
    const canvas = document.querySelector('main canvas')
    return window.__marque.handles().map((candidate) => document.elementFromPoint(candidate.x, candidate.y) === canvas)
  })
  expect(reachable).toEqual(handles.map(() => true))

  const depth = await undoDepth(page)
  const pivot = await boxMiddle(page, f)
  await turnKnob(page, f.at(pivot.x, pivot.y), 31, ['Shift'])
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(await frameRotations(page)).toEqual(pieces.map(() => 30))
})

test('Alt with the arrow keys turns and scales the selection, written at once, one undo step for each burst', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Pen')
  for (const [x, y] of [
    [-100, -50],
    [100, -50],
    [100, 50],
    [-100, 50],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection([illustrator.layers[0].id])
  })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const depth = await undoDepth(page)

  // Two turns of 15° and one of 1°: a single step of 31°, about the shape's middle, in the document key by key.
  // The angle shows by the box while the keys are pressed, and each key reads out the angle it reached.
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await page.keyboard.press('Alt+Shift+ArrowRight')
  expect(await frameRotations(page)).toEqual([30])
  await expect(hudLabel(page, '30°')).toBeVisible()
  await expect(page.locator('main').getByRole('status')).toHaveText('Turned to 30°')
  await page.keyboard.press('Alt+ArrowRight')
  expect(await undoDepth(page)).toBe(depth + 1)
  await expect(page.locator('main').getByRole('status')).toHaveText('Turned to 31°')
  // The angle goes from by the box a moment after the last key.
  await expect(hudLabel(page, '31°')).toBeVisible()
  await expect(hudLabel(page, '31°')).toBeHidden()
  expect(await frameRotations(page)).toEqual([31])
  const [turned] = await anchors(page)
  expect(Math.abs(turned[0].x - rotateAbout({ x: -100, y: -50 }, { x: 0, y: 0 }, 31).x)).toBeLessThan(0.01)
  expect(Math.abs(turned[0].y - rotateAbout({ x: -100, y: -50 }, { x: 0, y: 0 }, 31).y)).toBeLessThan(0.01)

  // The longer side up by 10 and down by 1: 200 × 100 becomes 209 × 104.5, about the same middle, still turned.
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await page.keyboard.press('Alt+ArrowDown')
  await expect(page.locator('main').getByRole('status')).toHaveText(/^Size 209 × 10[45]$/)
  expect(await undoDepth(page)).toBe(depth + 2)
  expect(await frameRotations(page)).toEqual([31])
  const [scaled] = await anchors(page)
  expect(Math.hypot(scaled[0].x, scaled[0].y) / Math.hypot(turned[0].x, turned[0].y)).toBeCloseTo(209 / 200, 4)

  // Undo straight after a burst takes it back, and the canvas shows the shape as it was.
  const shapeBefore = await layers(page)
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await page.keyboard.press('ControlOrMeta+z')
  await page.waitForTimeout(700)
  expect(await layers(page)).toEqual(shapeBefore)
  await pointerAway(page, f)
  expect(await inkMismatches(page)).toEqual([])

  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => frameRotations(page)).toEqual([0])

  // A lone round punch half over a slab turns and scales about its own centre, to a whole diameter.
  await startOver(page)
  await addSlab(page, 'Square')
  await page.evaluate(() => window.__marque.store.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 190, y: 0 }, radius: 60 }))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const punchDepth = await undoDepth(page)
  await page.keyboard.press('Alt+Shift+ArrowLeft')
  await page.keyboard.press('Alt+Shift+ArrowLeft')
  expect(await undoDepth(page)).toBe(punchDepth + 1)
  await page.keyboard.press('Alt+Shift+ArrowUp')
  expect(await undoDepth(page)).toBe(punchDepth + 2)
  const punch = (await carves(page))[1] as PunchSpec
  expect(punch.center.x).toBeCloseTo(190, 6)
  expect(punch.center.y).toBeCloseTo(0, 6)
  expect(punch.radius).toBe(65)
  expect(punch.rotation).toBe(-30)

  // The slab alone turns and grows as its own knob and handles would: the punch in it stays where it is.
  const [slab] = await layers(page)
  await page.evaluate((id) => window.__marque.store.getState().setSelection([id]), slab.id)
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await page.keyboard.press('Alt+ArrowUp')
  const [turnedSlab, still] = (await carves(page)) as [SlabSpec, PunchSpec]
  expect(turnedSlab.rotation).toBe(15)
  expect(turnedSlab.width).toBe(381)
  expect(still).toEqual(punch)

  // With the punch hidden, the slab is the only one of the two that takes part, so the bar reads it as the slab.
  const ids = (await layers(page)).map((layer) => layer.id)
  await page.evaluate(([slabId, punchId]) => {
    window.__marque.store.getState().toggleIllustratorLayerVisibility(punchId)
    window.__marque.store.getState().setSelection([slabId, punchId])
  }, ids)
  await expect(selectionSummary(page)).toHaveText('Slab · 381 × 381 · corner 0 · 15°')
  await expect(selectionBar(page).locator('[aria-live]')).toHaveText('Slab')
})

test('inside the box of several shapes, a drag moves them all and a click keeps them selected', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  for (const x of [-160, 100]) {
    await pickTool(page, 'Pen')
    for (const [dx, dy] of [
      [0, -30],
      [60, -30],
      [60, 30],
      [0, 30],
    ]) {
      await click(page, f.at(x + dx, dy))
    }
    await page.keyboard.press('Enter')
  }
  await page.keyboard.press('Escape')
  const before = await layers(page)
  await page.evaluate(() => {
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection(illustrator.layers.map((layer) => layer.id))
  })
  const ids = before.map((layer) => layer.id)

  // Between the two shapes: nothing is there but the box.
  await click(page, f.at(0, -20))
  expect(await selectedIds(page)).toEqual(ids)
  const depth = await undoDepth(page)
  await drag(page, f.at(0, 10), f.at(0, 50), ['ControlOrMeta'])
  expect(await undoDepth(page)).toBe(depth + 1)
  const [a, b] = await anchors(page)
  expect(a[0].y).toBeCloseTo(-30 + 40, 0)
  expect(b[0].y).toBeCloseTo(-30 + 40, 0)
  expect(await selectedIds(page)).toEqual(ids)
  // The bar reads the size of their box at rest.
  await expect(selectionSummary(page)).toHaveText('2 layers · 320 × 60')
  // Only what is selected is read out as it changes, so a burst of keys is not read out twice.
  await expect(selectionBar(page).locator('[aria-live]')).toHaveText('2 layers')
})

/** Drag with one finger: the canvas sees touch pointers, as on a phone. */
async function touchDrag(page: Page, from: Point, to: Point, steps = 10) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

test('on touch, a corner keeps the proportions of free shapes, and a side stretches them one way', async ({ page }) => {
  await openVectorMaker(page)
  await dealSparks(page, 1)
  await sparkButton(page, 4).click()
  const was = await boxAround(page, (await layers(page)).map((layer) => layer.pathData))
  const depth = await undoDepth(page)

  // Pulled out and down, but not along the box's diagonal: no Shift is needed to keep its shape.
  const corner = await handle(page, 'se')
  await touchDrag(page, corner, { x: corner.x + 40, y: corner.y + 25 })
  expect(await undoDepth(page)).toBe(depth + 1)
  const now = await boxAround(page, (await layers(page)).map((layer) => layer.pathData))
  expect(now.width).toBeGreaterThan(was.width + 10)
  expect(Math.abs(now.width / now.height / (was.width / was.height) - 1)).toBeLessThan(0.001)

  const east = await handle(page, 'e')
  await touchDrag(page, east, { x: east.x + 30, y: east.y })
  expect(await undoDepth(page)).toBe(depth + 2)
  const stretched = await boxAround(page, (await layers(page)).map((layer) => layer.pathData))
  expect(stretched.width).toBeGreaterThan(now.width + 10)
  expect(stretched.height).toBeCloseTo(now.height, 1)
})

test('a shape at the top of the canvas turns from just outside a corner, where its knob cannot be reached', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  // 200 units square, its top 20 units below the canvas's top edge.
  const top = Math.round(-f.box.height / 2 / f.unit + 20)
  await page.evaluate((y) => window.__marque.store.getState().addPenShape(`M-100,${y}L100,${y}L100,${y + 200}L-100,${y + 200}Z`), top)
  const [shape] = await layers(page)
  expect(await selectedIds(page)).toEqual([shape.id])
  const knob = await handle(page, 'rotate')
  const knobOnCanvas = await page.evaluate((p) => {
    const canvas = document.querySelector('main canvas')!
    return p.y > canvas.getBoundingClientRect().top && document.elementFromPoint(p.x, p.y) === canvas
  }, knob)
  expect(knobOnCanvas).toBe(false)
  const depth = await undoDepth(page)

  // 10 pixels out past the south-east corner square, then round the middle by 31° with Shift.
  const pivot = f.at(0, top + 100)
  const se = await handle(page, 'se')
  const reach = Math.hypot(se.x - pivot.x, se.y - pivot.y) + 10
  const angle = Math.atan2(se.y - pivot.y, se.x - pivot.x)
  const from = { x: pivot.x + Math.cos(angle) * reach, y: pivot.y + Math.sin(angle) * reach }
  await page.mouse.move(from.x, from.y)
  expect(await page.evaluate(() => window.__marque.cursor())).toBe('rotate')
  const to = { x: pivot.x + Math.cos(angle + (31 * Math.PI) / 180) * reach, y: pivot.y + Math.sin(angle + (31 * Math.PI) / 180) * reach }
  await drag(page, from, to, ['Shift'])
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(await frameRotations(page)).toEqual([30])

  // A click out there, without a drag, is a click on the empty canvas.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => frameRotations(page)).toEqual([0])
  // Long enough after the drag's press not to count as a double-click.
  await page.waitForTimeout(400)
  await click(page, from)
  expect(await selectedIds(page)).toEqual([])
  expect(await undoDepth(page)).toBe(depth)
})

test('a thin bar stretches along its length from the short sides of its frame', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await page.evaluate(() => window.__marque.store.getState().addPenShape('M-120,-1L120,-1L120,1L-120,1Z'))
  const f = await frame(page)
  // The side is too short on screen for its own square.
  expect(await handleIds(page)).not.toContain('e')
  const ne = await handle(page, 'ne')
  const se = await handle(page, 'se')
  const side = { x: (ne.x + se.x) / 2, y: (ne.y + se.y) / 2 }
  const depth = await undoDepth(page)

  await drag(page, side, { x: side.x + 40 * f.unit, y: side.y }, ['ControlOrMeta'])
  expect(await undoDepth(page)).toBe(depth + 1)
  const extent = async () => {
    const [points] = await anchors(page)
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return { left: Math.min(...xs), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  const stretched = await extent()
  expect(Math.abs(stretched.width - 280)).toBeLessThanOrEqual(1)
  expect(stretched.height).toBeCloseTo(2, 6)
  expect(stretched.left).toBeCloseTo(-120, 6)

  // With a finger too: the press goes to the side, not to the point at the bar's end.
  const ne2 = await handle(page, 'ne')
  const se2 = await handle(page, 'se')
  const side2 = { x: (ne2.x + se2.x) / 2, y: (ne2.y + se2.y) / 2 }
  await touchDrag(page, side2, { x: side2.x + 20 * f.unit, y: side2.y })
  expect(await undoDepth(page)).toBe(depth + 2)
  const again = await extent()
  expect(Math.abs(again.width - 300)).toBeLessThanOrEqual(2)
  expect(again.height).toBeCloseTo(2, 6)
  expect(again.left).toBeCloseTo(-120, 6)
})

test('a press straight after a burst of keys meets the shapes where they are drawn', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  const extent = async () => {
    const [points] = await anchors(page)
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return { minX: Math.round(Math.min(...xs)), minY: Math.round(Math.min(...ys)), maxX: Math.round(Math.max(...xs)), maxY: Math.round(Math.max(...ys)) }
  }
  await page.evaluate(() => window.__marque.store.getState().addPenShape('M-100,-50L100,-50L100,50L-100,50Z'))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const depth = await undoDepth(page)

  // The pointer rests on the shape, so the cursor offers to move it; once the keys take the shape away, it no longer does.
  const resting = f.at(-80, 0)
  await page.mouse.move(resting.x, resting.y)
  await expect.poll(() => page.evaluate(() => window.__marque.cursor())).toBe('move')
  // Nudge 50 right, and straight after, drag from where the shape was: that is empty canvas now.
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => page.evaluate(() => window.__marque.cursor())).toBe('default')
  await drag(page, f.at(-80, 0), f.at(-80, 60), ['ControlOrMeta'])
  expect(await extent()).toEqual({ minX: -50, minY: -50, maxX: 150, maxY: 50 })
  expect(await undoDepth(page)).toBe(depth + 1)
  // Nudge again, and drag from where only its new place covers: the shape goes along, as a step of its own.
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  const nudged = await undoDepth(page)
  await drag(page, f.at(170, 0), f.at(170, 60), ['ControlOrMeta'])
  expect(await extent()).toEqual({ minX: 0, minY: 10, maxX: 200, maxY: 110 })
  expect(await undoDepth(page)).toBe(nudged + 1)
  // Hover is found again where the drag let go, which is on the shape it moved.
  await expect.poll(() => page.evaluate(() => window.__marque.cursor())).toBe('move')

  // The same after a turn with Alt and the arrow keys.
  await startOver(page)
  await page.evaluate(() => window.__marque.store.getState().addPenShape('M-150,-10L150,-10L150,10L-150,10Z'))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 0; i < 6; i++) await page.keyboard.press('Alt+Shift+ArrowRight')
  await drag(page, f.at(120, 0), f.at(120, 60), ['ControlOrMeta'])
  expect(await extent()).toEqual({ minX: -10, minY: -150, maxX: 10, maxY: 150 })
  for (let i = 0; i < 6; i++) await page.keyboard.press('Alt+Shift+ArrowRight')
  await drag(page, f.at(120, 0), f.at(120, 60), ['ControlOrMeta'])
  expect(await extent()).toEqual({ minX: -150, minY: 50, maxX: 150, maxY: 70 })
  await pointerAway(page, f)
  expect(await inkMismatches(page)).toEqual([])

  // Two shapes turned with Alt and the arrow keys: their box is measured upright around them again, and a
  // press on its knob straight after turns them further, about its middle.
  await startOver(page)
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    state.addPenShape('M-160,-30L-100,-30L-100,30L-160,30Z')
    window.__marque.store.getState().addPenShape('M100,-30L160,-30L160,30L100,30Z')
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection(illustrator.layers.map((layer) => layer.id))
  })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 0; i < 2; i++) await page.keyboard.press('Alt+Shift+ArrowRight')
  expect(await frameRotations(page)).toEqual([30, 30])
  const turnedDepth = await undoDepth(page)
  const pivot = await boxMiddle(page, f)
  await turnKnob(page, f.at(pivot.x, pivot.y), 31, ['Shift'])
  expect(await undoDepth(page)).toBe(turnedDepth + 1)
  expect(await frameRotations(page)).toEqual([60, 60])
})

/**
 * Press keys in the page itself, then sample the canvas two frames later
 * (after the render the edits bring), all well inside one burst of keys.
 * Returns whether each point is solid ink, and the undo depth then.
 */
function keysThenInk(page: Page, keys: Array<{ key: string; shift?: boolean; alt?: boolean }>, points: Point[]) {
  return page.evaluate(
    async ({ keys, points }) => {
      for (const { key, shift, alt } of keys) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, altKey: alt, bubbles: true, cancelable: true }))
      }
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      const canvas = document.querySelector('main canvas') as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      const ctx = canvas.getContext('2d')!
      const ink = points.map((p) => {
        const [r, g, b, a] = ctx.getImageData(
          Math.floor(((p.x - rect.left) * canvas.width) / rect.width),
          Math.floor(((p.y - rect.top) * canvas.height) / rect.height),
          1,
          1,
        ).data
        return a > 0.9 * 255 && r + g + b < 120
      })
      return { ink, depth: window.__marque.store.getState().vectorUndoStack.length }
    },
    { keys, points },
  )
}

test('a nudge and a turn with Alt in one burst of keys are both written, and show together in the ink', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await page.evaluate(() => window.__marque.store.getState().addPenShape('M-150,-10L150,-10L150,10L-150,10Z'))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await pointerAway(page, f)
  const depth = await undoDepth(page)
  const quarterTurn = Array.from({ length: 6 }, () => ({ key: 'ArrowRight', shift: true, alt: true }))

  // Up 10, then a quarter turn about the moved bar's middle: a step for each kind of key, and the ink shows the bar turned upright.
  const turned = await keysThenInk(page, [{ key: 'ArrowUp', shift: true }, ...quarterTurn], [f.at(0, 100), f.at(120, -10)])
  expect(turned.depth).toBe(depth + 2)
  expect(turned.ink).toEqual([true, false])

  // A second later, a quarter turn back, then down 50: the ink shows the bar lying down again, moved.
  await page.waitForTimeout(1100)
  const moved = await keysThenInk(
    page,
    [...quarterTurn, ...Array.from({ length: 5 }, () => ({ key: 'ArrowDown', shift: true }))],
    [f.at(120, 40), f.at(0, 100), f.at(120, -10)],
  )
  expect(moved.depth).toBe(depth + 4)
  expect(moved.ink).toEqual([true, false, false])
  const [points] = await anchors(page)
  const ys = points.map((p) => Math.round(p.y))
  expect([Math.min(...ys), Math.max(...ys)]).toEqual([30, 50])
  expect(await inkMismatches(page)).toEqual([])
})

test('Alt with the arrow keys reads out the size and angle it reaches, every time', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await page.evaluate(() => window.__marque.store.getState().addPenShape('M-100,-50L100,-50L100,50L-100,50Z'))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const status = page.locator('main').getByRole('status')

  // Two separate presses, each read out with the size it reached: the longer side 10 units longer each time.
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await expect(status).toHaveText('Size 210 × 105')
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await expect(status).toHaveText('Size 220 × 110')

  // The same turn twice, with an undo between, is read out twice; the undo leaves nothing stale.
  const announced: string[] = []
  await page.exposeFunction('noteStatus', (text: string) => announced.push(text))
  await status.evaluate((node) => {
    new MutationObserver(() => (window as unknown as { noteStatus(text: string): void }).noteStatus(node.textContent ?? '')).observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  })
  await page.keyboard.press('Alt+ArrowRight')
  await expect(status).toHaveText('Turned to 1°')
  await expect(hudLabel(page, '1°')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(status).toHaveText('')
  // Nor does the number by the box, which no longer holds.
  await expect(hudLabel(page, '1°')).toHaveCount(0)
  await page.keyboard.press('Alt+ArrowRight')
  await expect(status).toHaveText('Turned to 1°')
  await expect.poll(() => announced.filter((text) => text === 'Turned to 1°').length).toBe(2)
})

test('a shape turned or resized by its box takes the holes punched in it along', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    state.addPenShape('M-150,-100L150,-100L150,100L-150,100Z')
    window.__marque.store.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 80, y: 30 }, radius: 30 })
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection([illustrator.layers[0].id])
  })
  const depth = await undoDepth(page)
  const punch = async () => (await carves(page))[1] as PunchSpec

  // A quarter turn: the hole goes round with the shape, one undo step for both.
  await turnKnob(page, f.at(0, 0), 91, ['Shift'])
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(await frameRotations(page)).toEqual([90, 0])
  const turned = await punch()
  expect(turned.center.x).toBeCloseTo(-30, 6)
  expect(turned.center.y).toBeCloseTo(80, 6)
  await pointerAway(page, f)
  expect(await inkMismatches(page)).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => frameRotations(page)).toEqual([0, 0])

  // Stretched one way from its west side, the shape keeps the hole at its place along it, still round,
  // grown by the square root of the stretch.
  const west = await handle(page, 'w')
  await drag(page, west, { x: west.x - 60 * f.unit, y: west.y }, ['ControlOrMeta'])
  expect(await undoDepth(page)).toBe(depth + 1)
  const stretched = await punch()
  expect(Math.abs(stretched.center.x - (150 + (80 - 150) * 1.2))).toBeLessThanOrEqual(0.5)
  expect(stretched.center.y).toBeCloseTo(30, 6)
  const [points] = await anchors(page)
  const stretch = (Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))) / 300
  expect(Math.abs(stretch - 1.2)).toBeLessThan(0.01)
  expect(stretched.shape).toBe('circle')
  // Stored recipes keep two decimals.
  expect(Math.abs(stretched.radius - 30 * Math.sqrt(stretch))).toBeLessThanOrEqual(0.005)

  // About the middle with Alt, the hole goes along all the same: on a box, Alt never leaves it behind.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await punch()).center.x).toBe(80)
  const east = await handle(page, 'e')
  await drag(page, east, { x: east.x + 30 * f.unit, y: east.y }, ['Alt', 'ControlOrMeta'])
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(Math.abs((await punch()).center.x - 80 * 1.2)).toBeLessThanOrEqual(0.5)

  // A slab turned by its own knob turns alone: the hole in it stays where it was.
  await startOver(page)
  await addSlab(page, 'Square')
  await page.evaluate(() => {
    window.__marque.store.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 80, y: 30 }, radius: 30 })
    const { illustrator, setSelection } = window.__marque.store.getState()
    setSelection([illustrator.layers[0].id])
  })
  const slabDepth = await undoDepth(page)
  await turnKnob(page, f.at(0, 0), 91, ['Shift'])
  expect(await undoDepth(page)).toBe(slabDepth + 1)
  const [slab, hole] = await carves(page)
  expect((slab as SlabSpec).rotation).toBe(90)
  expect((hole as PunchSpec).center).toEqual({ x: 80, y: 30 })
})

test('a slab at the top of the canvas turns from just outside a corner, as a free shape does', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  // 200 units square, its top 20 units below the canvas's top edge.
  const top = Math.round(-f.box.height / 2 / f.unit + 20)
  await addSlab(page, 'Square')
  await page.evaluate((y) => {
    const { illustrator, commitLayerEdits } = window.__marque.store.getState()
    const slab = illustrator.layers[0]
    commitLayerEdits({ label: 'Place', edits: [{ layerId: slab.id, carve: { ...slab.carve!, center: { x: 0, y: y + 100 }, width: 200, height: 200 } as SlabSpec }] })
  }, top)
  const depth = await undoDepth(page)

  const pivot = f.at(0, top + 100)
  const se = await handle(page, 'se')
  const reach = Math.hypot(se.x - pivot.x, se.y - pivot.y) + 10
  const angle = Math.atan2(se.y - pivot.y, se.x - pivot.x)
  const from = { x: pivot.x + Math.cos(angle) * reach, y: pivot.y + Math.sin(angle) * reach }
  await page.mouse.move(from.x, from.y)
  expect(await page.evaluate(() => window.__marque.cursor())).toBe('rotate')
  const to = { x: pivot.x + Math.cos(angle + (31 * Math.PI) / 180) * reach, y: pivot.y + Math.sin(angle + (31 * Math.PI) / 180) * reach }
  await drag(page, from, to, ['Shift'])
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(((await carves(page))[0] as SlabSpec).rotation).toBe(30)
})

test('Subtract on two circles leaves one ring, and its inner contour takes point edits', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Circle')
  await page.evaluate(() => {
    const store = window.__marque.store.getState()
    store.setCarveSettings({ snapping: false })
    store.addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 0, y: 0 }, radius: 100 })
  })
  const f = await frame(page)
  const [slab, punch] = await layers(page)
  expect(slab.carve).toMatchObject({ kind: 'slab', width: 400 })

  // The ring picks the slab, the hole picks the punch.
  await click(page, f.at(150, 0))
  await page.keyboard.down('Shift')
  await click(page, f.at(0, 0))
  await page.keyboard.up('Shift')
  expect(await selectedIds(page)).toEqual([slab.id, punch.id])
  const depth = await undoDepth(page)
  await selectionBar(page).getByRole('button', { name: 'Subtract', exact: true }).click()

  const [ring] = await layers(page)
  expect(await layers(page)).toHaveLength(1)
  expect(await selectedIds(page)).toEqual([ring.id])
  expect(await undoDepth(page)).toBe(depth + 1)
  let shape = (await contourAnchors(page))[0]
  expect(shape).toHaveLength(2)
  await pointerAway(page, f)
  expect(await isEmpty(page, f.at(0, 0))).toBe(true)
  expect(await isEmpty(page, f.at(60, 40))).toBe(true)
  expect(await isInk(page, f.at(150, 0))).toBe(true)
  expect(await isInk(page, f.at(0, -150))).toBe(true)
  expect(await inkMismatches(page)).toEqual([])

  // The inner contour's rightmost point: select it, then drag it 40 units out.
  const inner = shape[1]
  const index = inner.reduce((best, p, i) => (p.x > inner[best].x ? i : best), 0)
  const point = inner[index]
  const outer = shape[0]
  await click(page, f.at(point.x, point.y))
  expect(await pointSelection(page)).toMatchObject({ layerId: ring.id, contourIndex: 1, segmentIndex: index })
  // Not so soon that the press makes a double-click.
  await page.waitForTimeout(400)
  await drag(page, f.at(point.x, point.y), f.at(point.x + 40, point.y))

  shape = (await contourAnchors(page))[0]
  // Only the inner contour was written.
  expect(shape[0]).toEqual(outer)
  expect(Math.abs(shape[1][index].x - (point.x + 40))).toBeLessThan(1)
  expect(await pointSelection(page)).toMatchObject({ contourIndex: 1, segmentIndex: index })
  expect(await undoDepth(page)).toBe(depth + 2)
  // Escape lets go of the point, so its handles no longer cover the ink.
  await page.keyboard.press('Escape')
  expect(await pointSelection(page)).toBeNull()
  await pointerAway(page, f)
  // The hole now reaches where the ring was.
  expect(await isEmpty(page, f.at(point.x + 25, point.y))).toBe(true)
  expect(await isInk(page, f.at(-150, 0))).toBe(true)
  expect(await inkMismatches(page)).toEqual([])

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await contourAnchors(page))[0][1][index].x).toBeCloseTo(point.x, 3)
})

test('a link whose ids are all digits opens and draws, as stage 1 drew it', async ({ page }) => {
  const square = (x: number, y: number) => `M${x},${y}H${x + 200}V${y + 200}H${x}Z`
  const layer = { name: 'A', operation: 'add', visible: true, locked: false, fillRule: 'nonzero', transform: { dx: 0, dy: 0, scale: 1, rotation: 0 } }
  const legacy = {
    id: 'doc',
    source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
    layers: [
      { ...layer, id: 1, pathData: square(-200, -200) },
      { ...layer, id: 'b', pathData: square(0, 0) },
    ],
    selectedLayerIds: [],
    pointSelection: null,
    mode: 'object',
  }
  const now = new Date(0).toISOString()
  const contour = (x: number, y: number) => ({
    closed: true,
    segments: [
      [x, y],
      [x + 200, y],
      [x + 200, y + 200],
      [x, y + 200],
    ].map(([px, py]) => ({ point: { x: px, y: py }, handleIn: null, handleOut: null })),
  })
  const current = {
    schemaVersion: 2,
    id: 'doc',
    kind: 'brand-vector',
    activeMode: 'logo',
    name: 'Digits',
    artboards: [{ id: 'board', name: 'Artboard 1', rect: { x: -512, y: -512, width: 1024, height: 1024 }, background: null }],
    objects: [{ id: '7', name: 'Seven', parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours: [contour(-200, -200)], fillRule: 'nonzero' }],
    guides: [],
    fillets: [],
    source: null,
    createdAt: now,
    updatedAt: now,
  }
  const links = [
    `#v=1.0&fillColor=%23222222&i=${LZString.compressToEncodedURIComponent(JSON.stringify(legacy))}`,
    `#fillColor=%23222222&vd=${LZString.compressToEncodedURIComponent(JSON.stringify(current))}`,
  ]
  for (const [index, hash] of links.entries()) {
    await page.goto('about:blank')
    await page.goto(`/${hash}`)
    await expect(page.locator('main canvas')).toBeVisible()
    await page.evaluate(() => {
      const { ui, toggleLook } = window.__marque.store.getState()
      if (ui.look !== 'final') toggleLook()
    })
    const ids = await page.evaluate(() => window.__marque.store.getState().vectorDocument.objects.map((object) => object.id))
    expect(ids).toEqual(index === 0 ? ['1', 'b'] : ['7'])
    const f = await frame(page)
    await pointerAway(page, f)
    expect(await isInk(page, f.at(-100, -100))).toBe(true)
    if (index === 0) expect(await isInk(page, f.at(100, 100))).toBe(true)
    expect(await isEmpty(page, f.at(100, -100))).toBe(true)
  }
})

test('a link stage 1 wrote opens, and draws the mark stage 1 drew', async ({ page }) => {
  await page.goto(`/${STAGE_1_LINK.hash}`)
  await expect(page.locator('main canvas')).toBeVisible()
  await page.evaluate(() => {
    const { ui, toggleLook } = window.__marque.store.getState()
    if (ui.look !== 'final') toggleLook()
  })
  const state = await page.evaluate(() => {
    const { vectorDocument, vectorUndoStack, params } = window.__marque.store.getState()
    return { version: vectorDocument.schemaVersion, objects: vectorDocument.objects.length, undo: vectorUndoStack.length, ink: params.fillColor }
  })
  expect(state).toEqual({ version: 2, objects: 3, undo: 0, ink: STAGE_1_LINK.inkColor })
  expect(await page.evaluate(() => window.__marque.mark().viewBox)).toEqual(STAGE_1_LINK.mark.viewBox)
  const f = await frame(page)
  await pointerAway(page, f)
  // Ink where stage 1 drew ink, and none where it cut, on a fine grid.
  expect(await inkMismatches(page, 280, 10, STAGE_1_LINK.mark.compoundPathData)).toEqual([])
  // Opening is no edit: the link stays as it came.
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.location.hash)).toBe(STAGE_1_LINK.hash)
})

/* ─── Guides ─── */

const guides = (page: Page) => page.evaluate(() => window.__marque.guides())

/**
 * Whether a guide shows across a client point: the most opaque pixel in a
 * short run across it, and whether that pixel is a neutral grey (red, green
 * and blue equal), as guides draw.
 */
function guideAt(page: Page, p: Point, across: 'x' | 'y') {
  return page.evaluate(
    ({ p, across }) => {
      const canvas = document.querySelector('main canvas') as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      const ctx = canvas.getContext('2d')!
      let best = { alpha: 0, neutral: true }
      for (let o = -2; o <= 2; o += 0.5) {
        const cx = p.x + (across === 'x' ? o : 0)
        const cy = p.y + (across === 'y' ? o : 0)
        const x = Math.floor(((cx - rect.left) * canvas.width) / rect.width)
        const y = Math.floor(((cy - rect.top) * canvas.height) / rect.height)
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
        if (a / 255 > best.alpha) best = { alpha: a / 255, neutral: r === g && g === b }
      }
      return best
    },
    { p, across },
  )
}

test("ref 4's frame and 60° guides drawn with the Guide tool show only in the construction look, and only while shown", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  const depth = await undoDepth(page)

  // The frame: two flat lines and two upright ones, Shift holding them to 15° steps.
  await drag(page, f.at(-150, -120), f.at(-20, -116), ['Shift'])
  await drag(page, f.at(-150, 160), f.at(-20, 163), ['Shift'])
  await drag(page, f.at(-200, 0), f.at(-196, 120), ['Shift'])
  await drag(page, f.at(200, 0), f.at(203, 120), ['Shift'])
  // Two parallel lines falling to the right at 60°, as the bands of ref 4 run; the HUD reads the angle as a turned slab does.
  await page.mouse.move(f.at(-60, -40).x, f.at(-60, -40).y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(f.at(-60 + 58, -40 + 104).x, f.at(-60 + 58, -40 + 104).y, { steps: 8 })
  await expect(hudLabel(page, '60°')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await drag(page, f.at(40, -40), f.at(40 + 62, -40 + 100), ['Shift'])

  const drawn = await guides(page)
  expect(drawn.map((guide) => guide.shape)).toEqual([
    { kind: 'line', p: { x: -150, y: -120 }, angle: 0 },
    { kind: 'line', p: { x: -150, y: 160 }, angle: 0 },
    { kind: 'line', p: { x: -200, y: 0 }, angle: 90 },
    { kind: 'line', p: { x: 200, y: 0 }, angle: 90 },
    { kind: 'line', p: { x: -60, y: -40 }, angle: 60 },
    { kind: 'line', p: { x: 40, y: -40 }, angle: 60 },
  ])
  expect(await undoDepth(page)).toBe(depth + 6)
  // The tool stays on, and the mark has no ink.
  expect(await page.evaluate(() => window.__marque.store.getState().ui.activeTool)).toBe('guide')
  expect(await page.evaluate(() => window.__marque.mark().compoundPathData)).toBe('')

  // Back to selecting, nothing selected, the pointer away: what remains on the canvas is the guides.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  const flat = f.at(-260, -120)
  const upright = f.at(200, 220)
  await expect.poll(() => guideAt(page, flat, 'y')).toMatchObject({ neutral: true })
  expect((await guideAt(page, flat, 'y')).alpha).toBeGreaterThan(0.2)
  expect((await guideAt(page, upright, 'x')).alpha).toBeGreaterThan(0.2)

  // The final look draws the ink alone.
  await page.keyboard.press('f')
  await expect.poll(async () => (await guideAt(page, flat, 'y')).alpha).toBeLessThan(0.05)
  await page.keyboard.press('f')
  await expect.poll(async () => (await guideAt(page, flat, 'y')).alpha).toBeGreaterThan(0.2)

  // Cmd+; hides them and shows them again: a view setting, so no undo step.
  await page.keyboard.press('ControlOrMeta+;')
  await expect.poll(async () => (await guideAt(page, flat, 'y')).alpha).toBeLessThan(0.05)
  expect((await guideAt(page, upright, 'x')).alpha).toBeLessThan(0.05)
  await expect(page.getByRole('button', { name: 'Show guides' })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('ControlOrMeta+;')
  await expect.poll(async () => (await guideAt(page, flat, 'y')).alpha).toBeGreaterThan(0.2)
  await expect(page.getByRole('button', { name: 'Show guides' })).toHaveAttribute('aria-pressed', 'true')
  expect(await undoDepth(page)).toBe(depth + 6)
  expect(await guides(page)).toEqual(drawn)

  // A selected guide leaves the selection as guides leave the canvas: nothing acts on a guide unseen.
  await click(page, flat)
  await expect(selectionBar(page)).toBeVisible()
  await page.keyboard.press('ControlOrMeta+;')
  await expect(selectionBar(page)).toBeHidden()
  await page.keyboard.press('Delete')
  expect(await guides(page)).toEqual(drawn)

  // The drawer's switch is the same one: while hidden its rows pick nothing, and turning it on shows them on the canvas.
  const drawer = await openLayers(page)
  const show = drawer.getByRole('switch', { name: 'Show' })
  await expect(drawer.getByRole('heading', { name: 'Guides · 6' })).toBeVisible()
  await expect(show).toHaveAttribute('aria-checked', 'false')
  const row = drawer.getByRole('listitem').filter({ hasText: /^OnLine/ }).first().getByRole('button', { name: /^Line/ })
  await expect(row).toBeDisabled()
  await show.click()
  await expect(page.getByRole('button', { name: 'Show guides' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await guideAt(page, flat, 'y')).alpha).toBeGreaterThan(0.2)
  await expect(row).toBeEnabled()
  await show.click()
  await expect(page.getByRole('button', { name: 'Show guides' })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await guideAt(page, flat, 'y')).alpha).toBeLessThan(0.05)
  expect(await guides(page)).toEqual(drawn)
  expect(await undoDepth(page)).toBe(depth + 6)
})

test('mark() and Copy SVG are the same with guides as without them', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Rounded')
  const f = await frame(page)
  await pickTool(page, 'Punch')
  await drag(page, f.at(0, -90), f.at(40, -90))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await pointerAway(page, f)

  const copySvg = async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export' })
    await dialog.getByRole('button', { name: 'Copy SVG' }).click()
    await expect(dialog.getByRole('button', { name: 'SVG copied to clipboard' })).toBeVisible()
    const svg = await page.evaluate(() => navigator.clipboard.readText())
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    return svg
  }
  const mark = () => page.evaluate(() => window.__marque.mark())
  const before = { svg: await copySvg(), mark: await mark() }

  // Every construction line of the slab, and a circle and a line of the Guide tool's.
  await click(page, f.at(-120, 100))
  await selectionBar(page).getByRole('button', { name: 'Guides ▸' }).click()
  await page.getByRole('group', { name: 'Guides' }).getByRole('button', { name: 'Construction' }).click()
  await pickTool(page, 'Guide')
  await drag(page, f.at(-100, 230), f.at(-60, 230), ['Alt'])
  await drag(page, f.at(-250, -230), f.at(250, -100))
  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  expect((await guides(page)).length).toBeGreaterThan(8)

  expect(await mark()).toEqual(before.mark)
  expect(await copySvg()).toBe(before.svg)
})

test("a circle slab's construction guides follow a resize of the slab, and undo puts them back", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Circle')
  await selectionBar(page).getByRole('button', { name: 'Guides ▸' }).click()
  await page.getByRole('group', { name: 'Guides' }).getByRole('button', { name: 'Construction' }).click()
  const added = await guides(page)
  expect(added.map((guide) => guide.link?.role)).toEqual(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle'])
  const rim = () => guides(page).then((list) => list.find((guide) => guide.link?.role === 'circumcircle')!.shape)
  expect(await rim()).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 200 })
  await expect(selectionBar(page)).toContainText('7 guides')

  // Select the slab again and pull a corner out with Shift: the slab grows evenly, still a circle, and its guides with it.
  const f = await frame(page)
  await click(page, f.at(0, 60))
  const depth = await undoDepth(page)
  const corner = await handle(page, 'se')
  await drag(page, corner, { x: corner.x + 40 * f.unit, y: corner.y + 40 * f.unit }, ['Shift'])
  const slab = (await carves(page))[0] as SlabSpec
  const radius = slab.width / 2
  expect(slab.radius).toBeCloseTo(radius, 6)
  expect(radius).toBeGreaterThan(210)
  expect(await rim()).toEqual({ kind: 'circle', c: slab.center, r: radius })
  const right = (await guides(page)).find((guide) => guide.link?.role === 'right')!.shape
  expect(right).toEqual({ kind: 'line', p: { x: slab.center.x + radius, y: slab.center.y }, angle: 90 })
  expect(await undoDepth(page)).toBe(depth + 1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(rim).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 200 })
  expect(await guides(page)).toEqual(added)
})

test('arrow keys nudge a selected guide, a burst one undo step, and a construction guide detaches as the HUD says', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Circle')
  await selectionBar(page).getByRole('button', { name: 'Guides ▸' }).click()
  await page.getByRole('group', { name: 'Guides' }).getByRole('button', { name: 'Construction' }).click()
  const added = await guides(page)
  const top = added.find((guide) => guide.link?.role === 'top')!
  expect(top.shape).toEqual({ kind: 'line', p: { x: 0, y: -200 }, angle: 0 })

  // Pick the top line alone, away from the circle, and nudge it: 3 down, then 10 right with Shift.
  const f = await frame(page)
  await click(page, f.at(150, -200))
  await expect(selectionBar(page)).toContainText('Top')
  const depth = await undoDepth(page)
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
  await expect(hudLabel(page, 'detached')).toBeVisible()
  await page.keyboard.press('Shift+ArrowRight')
  const moved = (await guides(page)).find((guide) => guide.id === top.id)!
  expect(moved.shape).toEqual({ kind: 'line', p: { x: 10, y: -197 }, angle: 0 })
  expect(moved.link).toBeUndefined()
  expect(await undoDepth(page)).toBe(depth + 1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => guides(page)).toEqual(added)
})

test('the pen in Guide mode keeps an open path as a guide, and in Shape mode still closes a shape', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Pen')
  await page.getByRole('group', { name: 'Pen draws' }).getByRole('button', { name: 'Guide' }).click()
  for (const [x, y] of [
    [-150, -100],
    [0, 60],
    [150, -100],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  const [guide] = await guides(page)
  expect(guide.shape.kind).toBe('path')
  if (guide.shape.kind === 'path') {
    expect(guide.shape.contour.closed).toBe(false)
    expect(guide.shape.contour.segments.map((segment) => segment.point)).toEqual([
      { x: -150, y: -100 },
      { x: 0, y: 60 },
      { x: 150, y: -100 },
    ])
  }
  expect(await layers(page)).toHaveLength(0)
  expect(await page.evaluate(() => window.__marque.store.getState().ui.activeTool)).toBeNull()
  await expect(selectionBar(page)).toContainText('Guide · path')

  // Back in Shape mode, the pen closes a filled shape as before.
  await page.keyboard.press('Escape')
  await pickTool(page, 'Pen')
  await page.getByRole('group', { name: 'Pen draws' }).getByRole('button', { name: 'Shape' }).click()
  for (const [x, y] of [
    [-150, 100],
    [150, 100],
    [0, 200],
  ]) {
    await click(page, f.at(x, y))
  }
  await page.keyboard.press('Enter')
  expect(await layers(page)).toHaveLength(1)
  expect(await guides(page)).toHaveLength(1)
})

test('a guide along a slab edge does not take the edge bend under Select, and the Guide tool reaches it first', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  // Snapped onto the slab's corner, then flat with Shift: the guide runs along the top edge.
  await pickTool(page, 'Guide')
  await drag(page, f.at(-187, -188), f.at(-60, -186), ['Shift'])
  const [guide] = await guides(page)
  expect(guide.shape).toEqual({ kind: 'line', p: { x: -190, y: -190 }, angle: 0 })

  await page.keyboard.press('v')
  await page.keyboard.press('Escape')
  const depth = await undoDepth(page)
  const grabbed = f.at(-190 + 380 * 0.3, -190)
  await drag(page, { x: grabbed.x, y: grabbed.y - 3 }, { x: grabbed.x, y: grabbed.y - 43 })
  expect(((await carves(page))[0] as SlabSpec).sides?.top).toBeTruthy()
  expect(await guides(page)).toEqual([guide])
  expect(await undoDepth(page)).toBe(depth + 1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => ((await carves(page))[0] as SlabSpec).sides ?? null).toBeNull()

  // Under the Guide tool the same press takes the guide: a click selects it, and then a drag moves it down.
  await pickTool(page, 'Guide')
  await click(page, { x: grabbed.x, y: grabbed.y - 2 })
  expect(await page.evaluate(() => window.__marque.store.getState().illustrator.selectedGuideIds)).toEqual([guide.id])
  expect(((await carves(page))[0] as SlabSpec).sides ?? null).toBeNull()
  await drag(page, { x: grabbed.x, y: grabbed.y - 2 }, { x: grabbed.x, y: grabbed.y + 50 * f.unit }, ['ControlOrMeta'])
  const [moved] = await guides(page)
  expect(moved.shape.kind).toBe('line')
  if (moved.shape.kind === 'line') expect(Math.abs(moved.shape.p.y - (-140 + 2 / f.unit))).toBeLessThan(1)
  expect(((await carves(page))[0] as SlabSpec).sides ?? null).toBeNull()
})

test('under the Guide tool a new line starts on a frame corner, where a drag from a guide not selected draws', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  // A frame line, and an upright through its left end.
  await drag(page, f.at(-200, 150), f.at(-100, 152), ['Shift'])
  await drag(page, f.at(-150, 200), f.at(-148, 100), ['Shift'])
  const frameLines = await guides(page)
  // What the tool draws is not selected, so no knob sits in the way of the next line.
  expect(await page.evaluate(() => window.__marque.store.getState().illustrator.selectedGuideIds ?? [])).toEqual([])

  // From just beside the corner, up and to the right (120°, as the editor reads a line): the line starts where the two cross.
  const corner = f.at(-149, 151)
  await drag(page, corner, { x: corner.x + 50 * f.unit, y: corner.y - 87 * f.unit }, ['Shift'])
  const drawn = await guides(page)
  expect(drawn.slice(0, 2)).toEqual(frameLines)
  expect(drawn[2].shape).toEqual({ kind: 'line', p: { x: -150, y: 150 }, angle: 120 })

  // A click on a guide selects it; a drag from it, now selected, moves it.
  await click(page, f.at(-60, 150))
  expect(await page.evaluate(() => window.__marque.store.getState().illustrator.selectedGuideIds)).toEqual([frameLines[0].id])
  await drag(page, f.at(-60, 150), f.at(-60, 190), ['ControlOrMeta'])
  const after = await guides(page)
  expect(after).toHaveLength(3)
  expect(after[0].shape.kind === 'line' && after[0].shape.p.y).toBeCloseTo(190, 0)
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test("under the Guide tool, a tap on a shape pins its ghosts, a second tap on one adds it, even off the shape, and the options row adds them all", async ({ page }) => {
    await openVectorMaker(page, 'construction')
    await startOver(page)
    await addSlab(page, 'Square')
    const f = await frame(page)
    await pickTool(page, 'Guide')
    const addAll = page.getByRole('button', { name: /^Add all/ })
    const tap = (p: Point) => page.touchscreen.tap(p.x, p.y)
    const style = page.getByRole('group', { name: 'Guide style' })
    const styleAt = await style.boundingBox()

    // The first tap, inside the square: nothing is added, but its ghosts stay once the finger lifts.
    await tap(f.at(60, 40))
    expect(await guides(page)).toEqual([])
    await expect(addAll).toBeVisible()
    // On a phone the button's place was kept for it: the Style control beside it has not moved.
    if (page.viewportSize()!.width < 768) expect(await style.boundingBox()).toEqual(styleAt)
    const count = Number((await addAll.textContent())!.replace(/\D/g, ''))
    expect(count).toBeGreaterThan(6)

    // A tap on the circumcircle, off the square: that one is added, and the rest stay pinned.
    const r = Math.hypot(190, 190)
    await tap(f.at(r * Math.cos((25 * Math.PI) / 180), r * Math.sin((25 * Math.PI) / 180)))
    const [circumcircle] = await guides(page)
    expect(circumcircle.link?.role).toBe('circumcircle')
    await expect(addAll).toHaveText(`Add all ${count - 1}`)

    // The options row adds the rest, all following the square.
    await addAll.click()
    const slabId = (await layers(page))[0].id
    const all = await guides(page)
    expect(all).toHaveLength(count)
    expect(all.every((guide) => guide.link?.of === slabId)).toBe(true)
    await expect(addAll).toBeHidden()
  })

  test('under the Guide tool, a tap off every shape and ghost lets pinned ghosts go, and adds nothing', async ({ page }) => {
    await openVectorMaker(page, 'construction')
    await startOver(page)
    await addSlab(page, 'Square')
    const f = await frame(page)
    await pickTool(page, 'Guide')
    const addAll = page.getByRole('button', { name: /^Add all/ })
    await page.touchscreen.tap(f.at(60, 40).x, f.at(60, 40).y)
    await expect(addAll).toBeVisible()
    await page.touchscreen.tap(f.at(-280, 280).x, f.at(-280, 280).y)
    await expect(addAll).toBeHidden()
    expect(await guides(page)).toEqual([])
  })

  test("a finger on the middle of a small polygon punch moves it: its rounding dot keeps clear of the middle", async ({ page }) => {
    await openVectorMaker(page)
    await startOver(page)
    await addSlab(page, 'Square')
    const f = await frame(page)
    await pickTool(page, 'Punch')
    await page.getByRole('group', { name: 'Punch shape' }).getByRole('button', { name: 'Polygon' }).click()
    // A tap stamps the punch at its smallest.
    await page.touchscreen.tap(f.at(60, 40).x, f.at(60, 40).y)
    const stamped = await polygonOf(page, 1)
    expect(stamped).toMatchObject({ center: { x: 60, y: 40 }, cornerRadius: 0 })
    await page.keyboard.press('Escape')
    await expect.poll(() => selectedIds(page)).toEqual([(await layers(page))[1].id])
    // Laid out for a finger, its dot keeps 32 CSS pixels from the middle, or is not there and the bar rounds it.
    const middle = f.at(60, 40)
    const dot = (await page.evaluate(() => window.__marque.handles())).find((candidate) => candidate.id === 'radius')
    if (dot) expect(Math.hypot(dot.x - middle.x, dot.y - middle.y)).toBeGreaterThanOrEqual(32 - 0.5)
    else await expect(selectionBar(page).getByRole('slider', { name: 'Corner' })).toBeVisible()
    const depth = await undoDepth(page)
    await touchDrag(page, f.at(60, 40), f.at(100, 80))
    expect(await undoDepth(page)).toBe(depth + 1)
    const moved = await polygonOf(page, 1)
    expect(moved).toMatchObject({ cornerRadius: 0, radius: stamped.radius })
    expect(Math.hypot(moved.center.x - 100, moved.center.y - 80)).toBeLessThanOrEqual(1.5)
  })
})

test('a guide deleted in the middle of its drag stays deleted when the drag ends', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  await drag(page, f.at(-200, 100), f.at(-100, 102), ['Shift'])
  await page.keyboard.press('v')
  await click(page, f.at(-50, 100))
  const depth = await undoDepth(page)
  // Past a double-click's reach in time, so the next press starts a drag.
  await page.waitForTimeout(400)

  await page.mouse.move(f.at(-50, 100).x, f.at(-50, 100).y)
  await page.mouse.down()
  await page.mouse.move(f.at(-50, 130).x, f.at(-50, 130).y, { steps: 5 })
  // The drag is live: its offset shows by the pointer.
  await expect(hudLabel(page, '0, 30')).toBeVisible()
  await page.keyboard.press('Delete')
  await page.mouse.move(f.at(-50, 160).x, f.at(-50, 160).y, { steps: 5 })
  await page.mouse.up()

  expect(await guides(page)).toEqual([])
  expect(await undoDepth(page)).toBe(depth + 1)
})

test('a guide drag ends without a move when guides leave the canvas in its middle, and nothing unseen stays selected', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  await drag(page, f.at(-200, 100), f.at(-100, 102), ['Shift'])
  await page.keyboard.press('v')
  const before = await guides(page)
  const depth = await undoDepth(page)
  const selected = () => page.evaluate(() => window.__marque.store.getState().illustrator.selectedGuideIds ?? [])

  for (const key of ['f', 'ControlOrMeta+;']) {
    // Past a double-click's reach in time, so the press only picks the guide.
    await page.waitForTimeout(400)
    await click(page, f.at(-50, 100))
    expect(await selected(), key).toEqual([before[0].id])
    // Past a double-click's reach in time, so the next press starts a drag.
    await page.waitForTimeout(400)
    await page.mouse.move(f.at(-50, 100).x, f.at(-50, 100).y)
    await page.mouse.down()
    await page.mouse.move(f.at(-50, 130).x, f.at(-50, 130).y, { steps: 5 })
    await expect(hudLabel(page, '0, 30')).toBeVisible()
    await page.keyboard.press(key)
    await page.mouse.move(f.at(-50, 140).x, f.at(-50, 140).y, { steps: 3 })
    await page.mouse.up()

    // The guide stays where it was, unselected, and the bar offers nothing for it.
    expect(await guides(page)).toEqual(before)
    expect(await undoDepth(page)).toBe(depth)
    expect(await selected()).toEqual([])
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await page.keyboard.press(key)
  }
})

test('another guide restyled in the middle of a drag keeps its style, and the dragged guide lands', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  await drag(page, f.at(-200, 100), f.at(-100, 102), ['Shift'])
  await drag(page, f.at(-200, -100), f.at(-100, -98), ['Shift'])
  const [dragged, other] = await guides(page)
  await page.keyboard.press('v')
  await click(page, f.at(-50, 100))
  await page.waitForTimeout(400)

  await page.mouse.move(f.at(-50, 100).x, f.at(-50, 100).y)
  await page.mouse.down()
  await page.mouse.move(f.at(-50, 130).x, f.at(-50, 130).y, { steps: 5 })
  await expect(hudLabel(page, '0, 30')).toBeVisible()
  await page.evaluate((id) => window.__marque.store.getState().setGuidesStyle([id], 'dotted'), other.id)
  await page.mouse.move(f.at(-50, 140).x, f.at(-50, 140).y, { steps: 5 })
  await page.mouse.up()

  const after = await guides(page)
  expect(after.find((guide) => guide.id === other.id)).toEqual({ ...other, style: 'dotted' })
  const moved = after.find((guide) => guide.id === dragged.id)!
  expect(moved.shape.kind === 'line' && moved.shape.p.y).toBeCloseTo(140, 0)
  expect(await page.evaluate(() => window.__marque.store.getState().vectorUndoStack.slice(-2).map((step) => step.label))).toEqual(['Guide style', 'Move guide'])
})

test('a canvas with only guides keeps them in the link, can start over, and shows no empty hint', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  await drag(page, f.at(-200, 100), f.at(-100, 102), ['Shift'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('note').filter({ hasText: 'Add a slab' })).toBeHidden()
  const drawn = await guides(page)
  await expect.poll(() => page.evaluate(() => window.location.hash.length)).toBeGreaterThan(0)

  await page.reload()
  await expect(page.locator('main canvas')).toBeVisible()
  await expect.poll(() => guides(page)).toEqual(drawn)

  const drawer = await openLayers(page)
  await expect(drawer.getByRole('button', { name: 'Start over' })).toBeEnabled()
  await drawer.getByRole('button', { name: 'Start over' }).click()
  expect(await guides(page)).toEqual([])
})

test('the Guide tool draws circles from a switch as well as with Alt, to whole units, and shows what it draws in the final look', async ({ page }) => {
  // Opens on the final look: picking the tool puts guides on the canvas.
  await openVectorMaker(page)
  await startOver(page)
  const f = await frame(page)
  await pickTool(page, 'Guide')
  expect(await page.evaluate(() => window.__marque.store.getState().ui.look)).toBe('construction')

  await page.getByRole('group', { name: 'Guide draws' }).getByRole('button', { name: 'Circle' }).click()
  await drag(page, f.at(100, 100), f.at(150.4, 100))
  // Alt draws the other: a line.
  await drag(page, f.at(-200, -100), f.at(-100, -98), ['Alt', 'Shift'])
  const [circle, line] = await guides(page)
  expect(circle.shape.kind).toBe('circle')
  if (circle.shape.kind === 'circle') {
    expect(circle.shape.c).toEqual({ x: 100, y: 100 })
    expect(Number.isInteger(circle.shape.r)).toBe(true)
    expect(Math.abs(circle.shape.r - 50)).toBeLessThanOrEqual(1)
  }
  expect(line.shape).toEqual({ kind: 'line', p: { x: -200, y: -100 }, angle: 0 })
})

test("under the Guide tool, a shape's ghosts can be followed off it and picked there, and Shift-click on it adds them all", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  await pickTool(page, 'Guide')

  // Into the square, out through its corner and round its circumcircle, off the square.
  const r = Math.hypot(190, 190)
  const path: Point[] = [f.at(60, 40), f.at(150, 150), f.at(185, 185)]
  for (let deg = 45; deg >= 25; deg -= 2) path.push(f.at(r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)))
  for (const p of path) await page.mouse.move(p.x, p.y, { steps: 3 })
  const last = path.at(-1)!
  await click(page, last)
  const [circumcircle] = await guides(page)
  expect(circumcircle.link?.role).toBe('circumcircle')

  // Shift-click inside the square, away from every ghost: the rest are added, all following the square.
  const slabId = (await layers(page))[0].id
  await page.mouse.move(f.at(60, 40).x, f.at(60, 40).y)
  await page.keyboard.down('Shift')
  await click(page, f.at(60, 40))
  await page.keyboard.up('Shift')
  const all = await guides(page)
  expect(all.length).toBeGreaterThan(6)
  expect(all.every((guide) => guide.link?.of === slabId)).toBe(true)
  expect(new Set(all.map((guide) => guide.link?.role)).size).toBe(all.length)
})

test("under the Guide tool, a line ghost being followed stays past its shape's circumcircle", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  await pickTool(page, 'Guide')

  // Along the square's flat centre line, out across its circumcircle (r about 269), which wins the tie where they cross.
  for (let x = 100; x <= 290; x += 5) await page.mouse.move(f.at(x, 0.3).x, f.at(x, 0.3).y, { steps: 2 })
  await expect(page.locator('main').getByText(/^Centre ↔ · click adds/)).toBeVisible()
  await click(page, f.at(290, 0.3))
  const [added] = await guides(page)
  expect(added.link).toEqual({ kind: 'construction', of: (await layers(page))[0].id, role: 'centre-y' })
})

test("under the Guide tool, the ghost being followed stays across another shape, and the HUD names it", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  // A round punch beside the square's middle, the square's flat centre line running through it.
  await pickTool(page, 'Punch')
  await drag(page, f.at(100, 30), f.at(150, 30))
  await page.keyboard.press('Escape')
  const punch = (await carves(page)).at(-1) as PunchSpec
  expect(punch.kind).toBe('punch')
  await pickTool(page, 'Guide')

  // On the square's flat centre line, the HUD names it and says what a click does.
  await page.mouse.move(f.at(-150, 0).x, f.at(-150, 0).y, { steps: 3 })
  await expect(page.locator('main').getByText(/^Centre ↔ · click adds · Shift-click adds all \d+$/)).toBeVisible()

  // Along it, over the punch: the square's line is still the one under the pointer.
  const over = { x: punch.center.x - 20, y: 0 }
  for (let x = -140; x <= over.x; x += 10) await page.mouse.move(f.at(x, 0).x, f.at(x, 0).y, { steps: 2 })
  await expect(page.locator('main').getByText(/^Centre ↔ · click adds/)).toBeVisible()
  await click(page, f.at(over.x, over.y))
  const [added] = await guides(page)
  expect(added.link).toEqual({ kind: 'construction', of: (await layers(page))[0].id, role: 'centre-y' })

  // Off the line, the punch under the pointer shows its own: its upright centre line.
  const upright = f.at(punch.center.x, punch.center.y + 20)
  await page.mouse.move(upright.x, upright.y, { steps: 4 })
  await expect(page.locator('main').getByText(/^Centre ↕ · click adds/)).toBeVisible()
  await click(page, upright)
  expect((await guides(page)).at(-1)?.link).toEqual({ kind: 'construction', of: (await layers(page)).at(-1)!.id, role: 'centre-x' })
})

/* ─── Snapping to every shape, and pins ─── */

/** Circle slabs where a test wants them, set through the store: `[x, y, r]` each. Returns their ids, bottom first. */
async function circleSlabs(page: Page, circles: Array<[number, number, number]>): Promise<string[]> {
  for (let i = 0; i < circles.length; i++) await addSlab(page, 'Circle')
  return page.evaluate((list) => {
    const store = window.__marque.store
    const ids = store.getState().illustrator.layers.map((layer) => layer.id)
    store.getState().commitLayerEdits({
      label: 'Place circles',
      edits: list.map(([x, y, r], i) => ({
        layerId: ids[i],
        carve: { v: 1, kind: 'slab', preset: 'circle', center: { x, y }, width: 2 * r, height: 2 * r, radius: r, rotation: 0 },
      })),
      select: [],
    })
    return ids
  }, circles)
}

const slabOf = async (page: Page, id: string) => (await layers(page)).find((layer) => layer.id === id)!.carve as SlabSpec
const pinOf = (page: Page, id: string) => page.evaluate((layerId) => window.__marque.store.getState().illustrator.layers.find((layer) => layer.id === layerId)?.pin ?? null, id)

test("ref 2: a circle dragged near a line of the circles' tangent frame snaps to touch it", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  // Two circles above, a larger one below: the frame's left line touches the upper left one.
  const [left, right, lower] = await circleSlabs(page, [
    [-150, -80, 90],
    [150, -60, 100],
    [0, 140, 110],
  ])
  await page.evaluate((ids) => window.__marque.store.getState().setSelection(ids), [left, right, lower])
  await selectionBar(page).getByRole('button', { name: 'Guides ▸' }).click()
  await page.getByRole('group', { name: 'Guides' }).getByRole('button', { name: 'Tangent frame' }).click()
  const frameLeft = (await guides(page)).find((guide) => guide.link?.role === 'left')!
  expect(frameLeft.shape).toEqual({ kind: 'line', p: { x: -240, y: -80 }, angle: 90 })
  await page.keyboard.press('Escape')

  // Drag the lower circle left until its rim is 2 units off the line: it snaps to touch it.
  const f = await frame(page)
  const depth = await undoDepth(page)
  const from = f.at(0, 180)
  const to = f.at(-128, 180)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await expect(hudLabel(page, 'tangent')).toBeVisible()
  await page.mouse.up()
  const moved = await slabOf(page, lower)
  expect(Math.abs(moved.center.x - -240 - moved.width / 2)).toBeLessThan(0.01)
  expect(moved.center.y).toBeCloseTo(140, 6)
  expect(await undoDepth(page)).toBe(depth + 1)
})

test('ref 4: circle C snaps into a corner of the frame, touching both lines, and circle B snaps to C’s size', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [c, b] = await circleSlabs(page, [
    [0, 40, 70],
    [140, -120, 60],
  ])
  // The frame's left and bottom lines.
  await page.evaluate(() =>
    window.__marque.store.getState().addGuides([
      { kind: 'line', p: { x: -200, y: 0 }, angle: 90 },
      { kind: 'line', p: { x: 0, y: 200 }, angle: 0 },
    ]),
  )
  await page.keyboard.press('Escape')
  const f = await frame(page)

  // C into the corner, 2 units shy of each line: it touches both.
  let depth = await undoDepth(page)
  const grab = f.at(0, 40)
  const into = f.at(-128, 128)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(into.x, into.y, { steps: 12 })
  await expect(hudLabel(page, 'tangent')).toBeVisible()
  await page.mouse.up()
  const cornered = await slabOf(page, c)
  expect(Math.abs(cornered.center.x - cornered.width / 2 - -200)).toBeLessThan(0.01)
  expect(Math.abs(cornered.center.y + cornered.width / 2 - 200)).toBeLessThan(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)

  // B pulled out evenly by a corner to within 2 units of C's radius: it takes C's size.
  await click(page, f.at(140, -120))
  depth = await undoDepth(page)
  const corner = await handle(page, 'se')
  await page.keyboard.down('Shift')
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 18 * f.unit, corner.y + 18 * f.unit, { steps: 10 })
  await expect(hudLabel(page, 'same size')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const grown = await slabOf(page, b)
  expect(grown.width / 2).toBeCloseTo(70, 6)
  expect(grown.radius).toBeCloseTo(70, 6)
  expect(await undoDepth(page)).toBe(depth + 1)
})

test('a punch dropped on a circle’s centre is pinned there: it stays centred as the circle resizes and moves, and dragging it away unpins it', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [slab] = await circleSlabs(page, [[0, 0, 150]])
  const f = await frame(page)

  // The punch starts a unit off the circle's centre: it snaps there, and the HUD says it will be pinned.
  await pickTool(page, 'Punch')
  const start = f.at(1, 1)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(hudLabel(page, 'pinned')).toBeVisible()
  await page.mouse.move(f.at(41, 1).x, start.y, { steps: 6 })
  await page.mouse.up()
  const punchId = (await layers(page)).at(-1)!.id
  expect(await pinOf(page, punchId)).toBe(slab)
  const centred = async () => {
    const [circle, punch] = (await carves(page)) as [SlabSpec, PunchSpec]
    return Math.hypot(circle.center.x - punch.center.x, circle.center.y - punch.center.y)
  }
  expect(await centred()).toBe(0)
  await expect(selectionBar(page).getByText('Pinned to 01')).toBeVisible()
  await expect(selectionBar(page).getByRole('button', { name: 'Unpin' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Resize the circle from a corner, evenly: its centre moves, and the punch with it, in one undo step.
  await click(page, f.at(0, 110))
  let depth = await undoDepth(page)
  const corner = await handle(page, 'se')
  await drag(page, corner, { x: corner.x + 30 * f.unit, y: corner.y + 30 * f.unit }, ['Shift'])
  const resized = await slabOf(page, slab)
  expect(resized.width).toBeGreaterThan(320)
  expect(resized.center.x).toBeGreaterThan(10)
  expect(await centred()).toBeLessThan(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)

  // Move the circle alone, with Alt, which leaves cuts behind: the pinned punch goes with it, in one undo step.
  depth = await undoDepth(page)
  await drag(page, f.at(resized.center.x, resized.center.y + 110), f.at(resized.center.x - 60, resized.center.y + 130), ['Alt'])
  expect((await slabOf(page, slab)).center.x).toBeCloseTo(resized.center.x - 60, 0)
  expect(await centred()).toBeLessThan(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)

  // Drag the punch itself away: it lets go of its pin, in one undo step.
  const moved = await slabOf(page, slab)
  await click(page, f.at(moved.center.x, moved.center.y))
  expect(await selectedIds(page)).toEqual([punchId])
  depth = await undoDepth(page)
  // Pressed off the spot just clicked, so the press is not a double-click.
  const from = f.at(moved.center.x + 15, moved.center.y)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 70 * f.unit, from.y + 23 * f.unit, { steps: 10 })
  await expect(hudLabel(page, 'unpinned')).toBeVisible()
  await page.mouse.up()
  expect(await pinOf(page, punchId)).toBeNull()
  expect(await centred()).toBeGreaterThan(50)
  expect(await undoDepth(page)).toBe(depth + 1)
  await expect(selectionBar(page).getByText(/Pinned to/)).toBeHidden()

  // Dragged back onto the circle's centre, it is pinned there again, in one undo step.
  const away = (await carves(page))[1] as PunchSpec
  depth = await undoDepth(page)
  const back = f.at(away.center.x + 15, away.center.y)
  await page.mouse.move(back.x, back.y)
  await page.mouse.down()
  await page.mouse.move(f.at(moved.center.x + 16, moved.center.y + 1).x, f.at(moved.center.x + 16, moved.center.y + 1).y, { steps: 10 })
  await expect(hudLabel(page, 'pinned')).toBeVisible()
  await page.mouse.up()
  expect(await pinOf(page, punchId)).toBe(slab)
  expect(await centred()).toBeLessThan(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)

  // Unpinned where it is, then dragged off and dropped back on the same centre: the HUD says pinned, and so it is, in one undo step.
  await selectionBar(page).getByRole('button', { name: 'Unpin' }).click()
  expect(await pinOf(page, punchId)).toBeNull()
  depth = await undoDepth(page)
  const grip = f.at(moved.center.x + 15, moved.center.y)
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x + 60 * f.unit, grip.y + 20 * f.unit, { steps: 6 })
  await page.mouse.move(grip.x + f.unit, grip.y - f.unit, { steps: 6 })
  await expect(hudLabel(page, 'pinned')).toBeVisible()
  await page.mouse.up()
  expect(await pinOf(page, punchId)).toBe(slab)
  expect(await centred()).toBeLessThan(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)

  // The circle's bar says it holds the punch, and lets it go.
  await page.keyboard.press('Escape')
  await click(page, f.at(moved.center.x, moved.center.y + 110))
  await expect(selectionBar(page).getByText('Holds 02')).toBeVisible()
  depth = await undoDepth(page)
  await selectionBar(page).getByRole('button', { name: 'Release' }).click()
  expect(await pinOf(page, punchId)).toBeNull()
  expect(await undoDepth(page)).toBe(depth + 1)
  await expect(selectionBar(page).getByText(/Holds/)).toBeHidden()
  await expect(page.locator('main').getByRole('status')).toHaveText(/^Released 02/)
})

test('a pin is never let go of without a word: a nudge says so, and a pinned slab resized by its own handle stays pinned', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [circle] = await circleSlabs(page, [[0, 0, 150]])
  await addSlab(page, 'Square')
  // The square, 80 across, pinned on the circle's centre.
  const square = await page.evaluate((target) => {
    const store = window.__marque.store
    const id = store.getState().illustrator.layers.at(-1)!.id
    store.getState().commitLayerEdits({
      label: 'Place square',
      edits: [{ layerId: id, carve: { v: 1, kind: 'slab', preset: 'square', center: { x: 0, y: 0 }, width: 80, height: 80, radius: 0, rotation: 0 }, pin: target }],
      select: [id],
    })
    return id
  }, circle)
  expect(await pinOf(page, square)).toBe(circle)
  const f = await frame(page)

  // Its own corner handle resizes it about its centre, so the pin holds.
  let depth = await undoDepth(page)
  const corner = await handle(page, 'se')
  await drag(page, corner, { x: corner.x + 20 * f.unit, y: corner.y + 20 * f.unit })
  const resized = await slabOf(page, square)
  expect(resized.width).toBeGreaterThan(100)
  expect(resized.center).toEqual({ x: 0, y: 0 })
  expect(await pinOf(page, square)).toBe(circle)
  expect(await undoDepth(page)).toBe(depth + 1)

  // An arrow key moves it off the centre: the pin goes, and the HUD and the status line say so.
  depth = await undoDepth(page)
  await page.keyboard.press('ArrowRight')
  expect(await pinOf(page, square)).toBeNull()
  await expect(hudLabel(page, 'unpinned')).toBeVisible()
  await expect(page.locator('main').getByRole('status')).toHaveText(/^Unpinned/)
  expect(await undoDepth(page)).toBe(depth + 1)
  // It shows for a moment only.
  await expect(hudLabel(page, 'unpinned')).toBeHidden({ timeout: 3000 })

  // Dragged back onto the circle's centre, it is pinned again.
  // Pressed at `y`, off the last press, so it is not a double-click.
  const dragBack = async (y: number) => {
    const grip = f.at(21, y)
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    await page.mouse.move(grip.x + 30 * f.unit, grip.y + 10 * f.unit, { steps: 4 })
    await page.mouse.move(f.at(20.2, y + 0.3).x, f.at(20.2, y + 0.3).y, { steps: 4 })
    // Well inside the moment "unpinned" would otherwise be held for.
    await expect(hudLabel(page, 'pinned')).toBeVisible({ timeout: 300 })
    await expect(hudLabel(page, 'unpinned')).toBeHidden({ timeout: 300 })
    await page.mouse.up()
    expect(await pinOf(page, square)).toBe(circle)
  }
  await dragBack(0)
  // Nudged off and dragged straight back: the drag shows "pinned", not the "unpinned" the nudge left, and pins it.
  await page.keyboard.press('ArrowRight')
  await expect(hudLabel(page, 'unpinned')).toBeVisible()
  await dragBack(-20)
  await page.keyboard.press('ArrowRight')
  await expect(hudLabel(page, 'unpinned')).toBeVisible()
  // A punch pressed on the circle's centre straight after is shown pinned, not "unpinned", and is stored so.
  await pickTool(page, 'Punch')
  const start = f.at(-1, 1)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(hudLabel(page, 'pinned')).toBeVisible({ timeout: 300 })
  await expect(hudLabel(page, 'unpinned')).toBeHidden({ timeout: 300 })
  await page.mouse.move(f.at(30, 1).x, start.y, { steps: 4 })
  await page.mouse.up()
  expect(await pinOf(page, (await layers(page)).at(-1)!.id)).toBe(circle)
})

test('a punch a little off a centre, dropped back on it, is pinned and centred; a pin whose target goes is let go of with a word', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [circle, other] = await circleSlabs(page, [[0, 0, 150], [260, 0, 60]])
  const f = await frame(page)
  await pickTool(page, 'Punch')
  await drag(page, f.at(60, 60), f.at(90, 60))
  await page.keyboard.press('Escape')
  // The punch sits 0.3 off the circle's centre, not pinned: as a mark from before pins were.
  const punch = await page.evaluate(() => {
    const store = window.__marque.store
    const id = store.getState().illustrator.layers.at(-1)!.id
    store.getState().commitLayerEdits({
      label: 'Place punch',
      edits: [{ layerId: id, carve: { v: 1, kind: 'punch', shape: 'circle', center: { x: 0.3, y: 0 }, radius: 30, rotation: 0 } }],
      select: [id],
    })
    return id
  })
  expect(await pinOf(page, punch)).toBeNull()
  const centreOf = async () => ((await layers(page)).find((layer) => layer.id === punch)!.carve as PunchSpec).center

  // Dragged off and dropped back about where it was: the HUD says pinned, and so it is, its centre on the circle's, in one undo step.
  let depth = await undoDepth(page)
  const grip = f.at(15, 0)
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x + 60 * f.unit, grip.y + 20 * f.unit, { steps: 6 })
  await page.mouse.move(grip.x + 0.2 * f.unit, grip.y, { steps: 6 })
  await expect(hudLabel(page, 'pinned')).toBeVisible()
  await page.mouse.up()
  expect(await pinOf(page, punch)).toBe(circle)
  const centre = await centreOf()
  expect(Math.hypot(centre.x, centre.y)).toBeLessThan(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)

  // The circle deleted: the punch lets go, and the HUD and the status line say so. Undo brings the pin back.
  const status = page.locator('main').getByRole('status')
  await page.evaluate((id) => window.__marque.store.getState().setSelection([id]), circle)
  await page.keyboard.press('Delete')
  expect(await pinOf(page, punch)).toBeNull()
  await expect(hudLabel(page, 'unpinned')).toBeVisible()
  await expect(status).toHaveText(/^Unpinned \d\d: the shape it was pinned to is gone/)
  await page.evaluate(() => window.__marque.store.getState().undoVectorCommand())
  expect(await pinOf(page, punch)).toBe(circle)

  // Made a guide, or merged with another circle by Union: the same.
  for (const act of [
    async () => {
      await page.evaluate((id) => window.__marque.store.getState().setSelection([id]), circle)
      await selectionBar(page).getByRole('button', { name: 'Make guide' }).click()
    },
    async () => {
      await page.evaluate((ids) => window.__marque.store.getState().setSelection(ids), [circle, other])
      await selectionBar(page).getByRole('button', { name: 'Union' }).click()
    },
  ]) {
    // The last "unpinned" has had its moment.
    await expect(hudLabel(page, 'unpinned')).toBeHidden({ timeout: 3000 })
    await act()
    expect(await pinOf(page, punch)).toBeNull()
    await expect(hudLabel(page, 'unpinned')).toBeVisible()
    await expect(status).toHaveText(/^Unpinned \d\d: the shape it was pinned to is gone/)
    await page.evaluate(() => window.__marque.store.getState().undoVectorCommand())
    expect(await pinOf(page, punch)).toBe(circle)
  }
})

test("a pinned channel's end turns it about its middle: Shift keeps 15° steps, and a 15° ray lands where its label says", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [circle] = await circleSlabs(page, [[0, 0, 150]])
  const f = await frame(page)
  for (const shift of [true, false]) {
    const channel = await page.evaluate((target) => {
      const state = () => window.__marque.store.getState()
      state().addCarveCut({ kind: 'channel', from: { x: -60, y: 0 }, to: { x: 60, y: 0 }, width: 16 }, target)
      const id = state().illustrator.layers.at(-1)!.id
      state().setSelection([id])
      return id
    }, circle)
    expect(await pinOf(page, channel)).toBe(circle)
    const to = await handle(page, 'to')
    await page.mouse.move(to.x, to.y)
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.move(f.at(54, 50).x, f.at(54, 50).y, { steps: 10 })
    const label = (await page.locator('main span.bg-pink-500').allTextContents()).join(' ')
    await page.mouse.up()
    if (shift) await page.keyboard.up('Shift')
    const groove = (await layers(page)).find((layer) => layer.id === channel)!.carve as GrooveSpec
    const angle = (Math.atan2(groove.to.y - groove.from.y, groove.to.x - groove.from.x) * 180) / Math.PI
    // Its middle stays on the circle's centre, and it is still pinned there.
    expect(Math.hypot(groove.from.x + groove.to.x, groove.from.y + groove.to.y)).toBeLessThan(0.02)
    expect(await pinOf(page, channel)).toBe(circle)
    expect(Math.abs(angle / 15 - Math.round(angle / 15))).toBeLessThan(1e-6)
    // A ray's label reads as a protractor does: what it says is the line the channel lies on.
    if (!shift) expect(label).toContain(`${((-Math.round(angle) % 180) + 180) % 180}°`)
    await page.evaluate((id) => window.__marque.store.getState().deleteIllustratorLayers([id]), channel)
  }
})

test('ref 4: B sitting on the bottom line grows from its top corner without snapping to that line, and touches the right line exactly', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [b] = await circleSlabs(page, [[0, 140, 60]])
  await page.evaluate(() =>
    window.__marque.store.getState().addGuides([
      { kind: 'line', p: { x: 0, y: 200 }, angle: 0 },
      { kind: 'line', p: { x: 200, y: 0 }, angle: 90 },
    ]),
  )
  await page.keyboard.press('Escape')
  const f = await frame(page)
  await click(page, f.at(0, 140))
  expect(await selectedIds(page)).toEqual([b])

  // Grown from its top right corner, about the bottom left one on the line: frame by frame, nothing says tangent.
  const corner = await handle(page, 'ne')
  await page.keyboard.down('Shift')
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  const labels: string[] = []
  for (let i = 1; i <= 16; i++) {
    // Out along its diagonal, to a radius of about 60 + 2.5 i.
    await page.mouse.move(corner.x + 5 * i * f.unit, corner.y - 5 * i * f.unit)
    labels.push((await page.locator('main span.bg-pink-500').allTextContents()).join(' '))
  }
  expect(labels.filter((label) => label.includes('tangent'))).toEqual([])
  await page.mouse.up()
  const grown = await slabOf(page, b)
  expect(grown.width / 2).toBeGreaterThan(90)
  expect(grown.width / 2).toBeLessThan(110)
  expect(grown.center.y + grown.width / 2).toBeCloseTo(200, 6)

  // Grown on to 2 short of the right line: it touches it, at radius 130 whatever the frame. The corner moves twice as far as the radius grows.
  const far = await handle(page, 'ne')
  const reach = 2 * (128 - grown.width / 2) * f.unit
  const towards = { x: far.x + reach, y: far.y - reach }
  await page.mouse.move(far.x, far.y)
  await page.mouse.down()
  await page.mouse.move(towards.x, towards.y, { steps: 10 })
  await expect(hudLabel(page, 'tangent')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const touching = await slabOf(page, b)
  expect(touching.width / 2).toBeCloseTo(130, 6)
  expect(touching.center.x + touching.width / 2).toBeCloseTo(200, 6)
  expect(touching.center.y + touching.width / 2).toBeCloseTo(200, 6)
})

test('on touch, a circle slab pulled by a corner stays a circle and takes another circle’s size', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  const [, b] = await circleSlabs(page, [
    [0, 40, 70],
    [140, -120, 60],
  ])
  const f = await frame(page)
  await click(page, f.at(140, -120))
  const depth = await undoDepth(page)
  // Out and down, not along its diagonal, to a size of about 72.
  const corner = await handle(page, 'se')
  await touchDrag(page, corner, { x: corner.x + 14 * f.unit, y: corner.y + 10 * f.unit })
  expect(await undoDepth(page)).toBe(depth + 1)
  const grown = await slabOf(page, b)
  expect(grown.width).toBe(grown.height)
  expect(grown.width / 2).toBeCloseTo(70, 6)
  expect(grown.radius).toBeCloseTo(70, 6)
})

test('the lines two selected circles share are offered once: never on top of a guide already there', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  // Equal circles side by side, with the lines along their tops and bottoms already guides.
  const [b] = await circleSlabs(page, [
    [-50, 125, 65],
    [100, 125, 65],
  ])
  await page.evaluate(() => {
    const store = window.__marque.store
    store.getState().addGuides([
      { kind: 'line', p: { x: -150, y: 60 }, angle: 0 },
      { kind: 'line', p: { x: 0, y: 190 }, angle: 0 },
    ])
    store.getState().setSelection(store.getState().illustrator.layers.map((layer) => layer.id))
  })
  const f = await frame(page)
  await pickTool(page, 'Guide')
  const on = f.at(-50, 100)
  await page.mouse.move(on.x, on.y)
  await page.keyboard.down('Shift')
  await click(page, on)
  await page.keyboard.up('Shift')
  const all = await guides(page)
  const tangents = all.filter((guide) => /tangent/.test(guide.name))
  // The two outer tangents are the guides already there; the two inner ones are new.
  expect(tangents.map((guide) => guide.name)).toEqual(['Inner tangent', 'Inner tangent'])
  const line = (guide: (typeof all)[number]) => (guide.shape.kind === 'line' ? guide.shape : null)
  for (const tangent of tangents) {
    const t = line(tangent)!
    for (const other of all) {
      const o = line(other)
      if (other === tangent || !o) continue
      const turn = Math.abs((((t.angle - o.angle) % 180) + 180) % 180)
      const parallel = Math.min(turn, 180 - turn) < 0.01
      const across = Math.abs((o.p.x - t.p.x) * Math.sin((t.angle * Math.PI) / 180) - (o.p.y - t.p.y) * Math.cos((t.angle * Math.PI) / 180))
      expect(parallel && across < 0.01).toBe(false)
    }
  }
  expect(b).toBeTruthy()
})

test('under the Guide tool, a Shift line started on a centre stays through it; started free, it moves across to touch a circle', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await circleSlabs(page, [
    [-120, 0, 50],
    [120, 54, 50],
  ])
  const f = await frame(page)
  await pickTool(page, 'Guide')

  // Pressed by the first circle's centre, which it snaps to, and drawn flat with Shift past the second, 4 units off touching it.
  await page.mouse.move(f.at(-119.5, 0.5).x, f.at(-119.5, 0.5).y)
  await page.mouse.down()
  await expect(hudLabel(page, 'centre')).toBeVisible()
  await page.keyboard.down('Shift')
  await page.mouse.move(f.at(120, 2).x, f.at(120, 2).y, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const [through] = await guides(page)
  expect(through.shape).toEqual({ kind: 'line', p: { x: -120, y: 0 }, angle: 0 })

  // Pressed where nothing snaps, on a 45° line 3 units off touching the second circle: it moves across to touch it.
  // (A flat line would not do: its start would align with the circle's top, which is where it touches.)
  const along = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
  const free = { x: 120 - 53 * Math.SQRT1_2 - 150 * along.x, y: 54 + 53 * Math.SQRT1_2 - 150 * along.y }
  await page.mouse.move(f.at(free.x, free.y).x, f.at(free.x, free.y).y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(f.at(free.x + 100 * along.x, free.y + 100 * along.y).x, f.at(free.x + 100 * along.x, free.y + 100 * along.y).y, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const touching = (await guides(page))[1]
  expect(touching.shape.kind).toBe('line')
  if (touching.shape.kind === 'line') {
    const { p, angle } = touching.shape
    const d = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) }
    expect(Math.abs(Math.abs(d.x * (54 - p.y) - d.y * (120 - p.x)) - 50)).toBeLessThan(1e-6)
  }
})

test('under the Guide tool, a short drag adds no line, and a far circle never draws a line off its drag', async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await circleSlabs(page, [
    [-120, 0, 80],
    [120, 40, 50],
  ])
  const f = await frame(page)
  await pickTool(page, 'Guide')
  const from = f.at(200, -200)
  const towards = (px: number) => ({ x: from.x + px * Math.cos((14 * Math.PI) / 180), y: from.y - px * Math.sin((14 * Math.PI) / 180) })

  // 4 pixels: too short to give the line an angle.
  await drag(page, from, towards(4))
  expect(await guides(page)).toEqual([])

  // 40 pixels: a line along the drag, not turned to touch either circle.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const labels: string[] = []
  for (let px = 2; px <= 40; px += 2) {
    const at = towards(px)
    await page.mouse.move(at.x, at.y)
    labels.push((await page.locator('main span.bg-pink-500').allTextContents()).join(' '))
  }
  await page.mouse.up()
  expect(labels.filter((label) => label.includes('tangent'))).toEqual([])
  const [line] = await guides(page)
  // Along the drag, to the whole degree it lands on: the pointer sits on whole pixels.
  expect(line.shape.kind).toBe('line')
  if (line.shape.kind === 'line') {
    const turn = (((line.shape.angle + 14) % 180) + 180) % 180
    expect(Math.min(turn, 180 - turn)).toBeLessThanOrEqual(2)
  }
})

/* ─── Polygons ─── */

/**
 * Whether a construction circle shows inside the ink: over a stretch of its
 * inner side, facing `towards`, any pixel of a neutral grey darker than the
 * sheet's fill. A dashed circle shows somewhere along any stretch that long.
 */
function circleShows(page: Page, circle: { x: number; y: number; r: number }, towards: Point) {
  return page.evaluate(
    ({ circle, towards }) => {
      const canvas = document.querySelector('main canvas') as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      const ctx = canvas.getContext('2d')!
      const facing = Math.atan2(towards.y - circle.y, towards.x - circle.x)
      for (let i = -30; i <= 30; i++) {
        const angle = facing + (i * Math.PI) / 90
        const x = Math.floor(((circle.x + Math.cos(angle) * circle.r - rect.left) * canvas.width) / rect.width)
        const y = Math.floor(((circle.y + Math.sin(angle) * circle.r - rect.top) * canvas.height) / rect.height)
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
        if (a > 250 && r === g && g === b && r < 0xd8 && r > 0x60) return true
      }
      return false
    },
    { circle, towards },
  )
}

const polygonOf = async (page: Page, index = 0) => (await carves(page))[index] as PolygonSpec

test("ref 1: a Polygon slab rounds by its dot to 60, shows six corner circles only in the construction look, and ] and [ change its sides, one undo step each", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Polygon')
  const f = await frame(page)
  expect(await polygonOf(page)).toEqual({ v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius: 200, rotation: 0, cornerRadius: 0 })
  expect(await handleIds(page)).toEqual(['nw', 'ne', 'se', 'sw', 'radius', 'rotate'])
  // The Sides stepper beside it reads the sides: the summary does not say them twice.
  await expect(selectionSummary(page)).toHaveText('Polygon · r 200 · corner 0')
  const depth = await undoDepth(page)

  // The dot, pulled towards the middle with Shift, rounds every corner in steps of 5: 60 is 34.6 units in.
  const dot = await handle(page, 'radius')
  await page.mouse.move(dot.x, dot.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(dot.x, dot.y + 34.6 * f.unit, { steps: 10 })
  await expect(hudLabel(page, 'corner 60')).toBeVisible()
  // Before the dot is let go, the circles it sets show where the corners now are.
  const live = [0, 1, 2, 3, 4, 5].map((k) => {
    const angle = ((-90 + 60 * k) * Math.PI) / 180
    const reach = 200 - 60 / Math.cos(Math.PI / 6)
    return { ...f.at(reach * Math.cos(angle), reach * Math.sin(angle)), r: 60 * f.unit }
  })
  for (const circle of live) await expect.poll(() => circleShows(page, circle, f.at(0, 0))).toBe(true)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect((await polygonOf(page)).cornerRadius).toBe(60)
  expect(await undoDepth(page)).toBe(depth + 1)

  // Nothing selected, the pointer away: six grey circles inside the ink, each about 130.7 from the middle.
  const id = (await layers(page))[0].id
  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  const circles = await page.evaluate((layerId) => window.__marque.cornerCircles(layerId), id)
  expect(circles).toHaveLength(6)
  const middle = f.at(0, 0)
  for (const circle of circles) {
    expect(Math.hypot(circle.x - middle.x, circle.y - middle.y) / f.unit).toBeCloseTo(200 - 60 / Math.cos(Math.PI / 6), 1)
    expect(circle.r / f.unit).toBeCloseTo(60, 6)
  }
  for (const circle of circles) await expect.poll(() => circleShows(page, circle, middle)).toBe(true)

  // The final look draws the ink alone, and the mark has none of them.
  await page.keyboard.press('f')
  for (const circle of circles) await expect.poll(() => circleShows(page, circle, middle)).toBe(false)
  expect(await isInk(page, { x: circles[0].x, y: circles[0].y + circles[0].r })).toBe(true)
  await page.keyboard.press('f')
  for (const circle of circles) await expect.poll(() => circleShows(page, circle, middle)).toBe(true)

  // ] adds a side and [ takes it off, each one undo step; the corners keep their radius.
  await page.evaluate((layerId) => window.__marque.store.getState().setSelection([layerId]), id)
  await page.keyboard.press(']')
  expect(await polygonOf(page)).toMatchObject({ sides: 7, cornerRadius: 60 })
  await expect(selectionSummary(page)).toHaveText('Polygon · r 200 · corner 60')
  expect(await undoDepth(page)).toBe(depth + 2)
  expect(await page.evaluate((layerId) => window.__marque.cornerCircles(layerId).length, id)).toBe(7)
  await page.keyboard.press('[')
  expect((await polygonOf(page)).sides).toBe(6)
  expect(await undoDepth(page)).toBe(depth + 3)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await polygonOf(page)).sides).toBe(7)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await polygonOf(page)).sides).toBe(6)
  expect((await polygonOf(page)).cornerRadius).toBe(60)

  // The bar's Sides stepper does the same by touch: one undo step a press.
  const sides = page.getByRole('toolbar', { name: 'Selection' }).getByRole('group', { name: 'Sides' })
  await expect(sides.locator('output')).toHaveText('6')
  const before = await undoDepth(page)
  await sides.getByRole('button', { name: 'Take a side off ([)' }).click()
  await expect(sides.locator('output')).toHaveText('5')
  expect(await polygonOf(page)).toMatchObject({ sides: 5, cornerRadius: 60 })
  expect(await undoDepth(page)).toBe(before + 1)
})

test('the punch cuts a hexagon into a slab, and its knob turns it in 15° steps with Shift', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Square')
  const f = await frame(page)
  await pickTool(page, 'Punch')
  await page.getByRole('group', { name: 'Punch shape' }).getByRole('button', { name: 'Polygon' }).click()
  // With no polygon selected, ] and [ step the sides of the next one, as the punch's stepper shows, and no undo step.
  const sides = page.getByRole('group', { name: 'Sides of the next punch' })
  await expect(sides.locator('output')).toHaveText('6')
  const depth = await undoDepth(page)
  await page.keyboard.press(']')
  await expect(sides.locator('output')).toHaveText('7')
  // Nothing on the canvas shows it, so the HUD says it, and it is read out.
  await expect(page.locator('main div[aria-hidden="true"]').getByText('Next polygon: 7 sides', { exact: true })).toBeVisible()
  await expect(page.locator('main p[role="status"]')).toHaveText('Next polygon: 7 sides')
  await sides.getByRole('button', { name: 'One side fewer' }).click()
  await expect(sides.locator('output')).toHaveText('6')
  expect(await undoDepth(page)).toBe(depth)
  const pill = page.getByRole('group', { name: 'Punch shape' })
  const pillAt = await pill.boundingBox()

  // From the slab's centre to 80 units straight up: a hexagon with a corner there, pinned to the centre.
  await drag(page, f.at(0, 0), f.at(0, -80))
  const [slab, cut] = await layers(page)
  expect(cut.operation).toBe('subtract')
  const hexagon = cut.carve as PolygonSpec
  expect(hexagon).toMatchObject({ kind: 'polygon', sides: 6, center: { x: 0, y: 0 }, rotation: 0, cornerRadius: 0 })
  expect(Math.abs(hexagon.radius - 80)).toBeLessThanOrEqual(1.5)
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(await pinOf(page, cut.id)).toBe(slab.id)
  // The new cut is selected, but the punch's stepper stays where it was, for the next punch.
  expect(await pill.boundingBox()).toEqual(pillAt)
  await sides.getByRole('button', { name: 'One side more' }).click()
  await expect(sides.locator('output')).toHaveText('7')
  expect((await polygonOf(page, 1)).sides).toBe(6)
  expect(await undoDepth(page)).toBe(depth + 1)
  await sides.getByRole('button', { name: 'One side fewer' }).click()
  // The bar's Sides is the cut's: it changes the hexagon just punched, one undo step, and the next punch starts from the sides last chosen.
  const cutSides = selectionBar(page).getByRole('group', { name: 'Sides of the selected polygons' })
  await expect(cutSides.locator('output')).toHaveText('6')
  await cutSides.getByRole('button', { name: 'Add a side (])' }).click()
  expect((await polygonOf(page, 1)).sides).toBe(7)
  await expect(cutSides.locator('output')).toHaveText('7')
  await expect(sides.locator('output')).toHaveText('7')
  expect(await undoDepth(page)).toBe(depth + 2)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await polygonOf(page, 1)).sides).toBe(6)
  await pointerAway(page, f)
  // A hole inside the corner at the bottom (the rounding dot sits in the top one) and inside a flat side; ink just past the slanted top side.
  await expect.poll(() => isEmpty(page, f.at(0, 60))).toBe(true)
  expect(await isEmpty(page, f.at(64, 0))).toBe(true)
  expect(await isInk(page, f.at(60, -64))).toBe(true)
  expect(await isInk(page, f.at(100, 0))).toBe(true)

  // Escape leaves the punch with the hexagon selected; its knob turns it to 45° with Shift.
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([cut.id])
  await turnKnob(page, f.at(0, 0), 40, ['Shift'])
  expect((await polygonOf(page, 1)).rotation).toBe(45)
  expect(await undoDepth(page)).toBe(depth + 2)
  await pointerAway(page, f)
  // Turned 45°, the top corner moves off: the top of the old corner is ink again.
  await expect.poll(() => isInk(page, f.at(0, -76))).toBe(true)
})

test("the bar's Sides changes a selected polygon while the pen is part-way through a path, and the path goes on", async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Polygon')
  const f = await frame(page)
  await page.keyboard.press('p')
  for (const [x, y] of [
    [-100, -80],
    [100, -80],
    [0, 90],
  ]) {
    await click(page, f.at(x, y))
  }
  // The hexagon stays selected under the pen, with its Sides in the bar.
  await selectionBar(page).getByRole('group', { name: 'Sides of the selected polygons' }).getByRole('button', { name: 'Add a side (])' }).click()
  expect((await polygonOf(page)).sides).toBe(7)
  // Its first point closes the triangle drawn before the step.
  await click(page, f.at(-100, -80))
  await expect.poll(() => layers(page).then((list) => list.length)).toBe(2)
})

test("a polygon's dot takes another shape's corner radius only where the polygon can draw it", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Polygon')
  await addSlab(page, 'Rounded')
  // A hexagon of radius 100, its apothem 86.6, beside a slab rounded to 88: too round for the hexagon to take.
  const id = await page.evaluate(() => {
    const store = window.__marque.store
    const [hexagon, slab] = store.getState().illustrator.layers
    store.getState().commitLayerEdits({
      label: 'Place',
      edits: [
        { layerId: hexagon.id, carve: { v: 1, kind: 'polygon', center: { x: -150, y: 0 }, sides: 6, radius: 100, rotation: 0, cornerRadius: 0 } },
        { layerId: slab.id, carve: { v: 1, kind: 'slab', preset: 'rounded', center: { x: 150, y: 0 }, width: 200, height: 200, radius: 88, rotation: 0 } },
      ],
      select: [hexagon.id],
    })
    return hexagon.id
  })
  const f = await frame(page)
  const dot = await handle(page, 'radius')
  await page.mouse.move(dot.x, dot.y)
  await page.mouse.down()
  // As far in as it goes: the corners meet in the middle of each side, fully round, not a whole number short.
  await page.mouse.move(dot.x, dot.y + 80 * f.unit, { steps: 12 })
  await expect(hudLabel(page, 'same size')).toHaveCount(0)
  await expect(hudLabel(page, 'fully round')).toBeVisible()
  await page.mouse.up()
  const hexagon = (await layers(page)).find((layer) => layer.id === id)!.carve as PolygonSpec
  // The apothem, 86.6025…, as storage keeps it.
  expect(hexagon.cornerRadius).toBe(86.6)
  await expect(selectionSummary(page)).toHaveText('Polygon · r 100 · corner 87')
  // Round all the way, its corners' circles would lie on its outline: none are drawn.
  expect(await page.evaluate((layerId) => window.__marque.cornerCircles(layerId).length, id)).toBe(0)

  // A corner pulled with Shift scales the rounding along, and the chip reads both.
  await page.evaluate((layerId) => {
    const store = window.__marque.store
    store.getState().commitLayerEdits({
      label: 'Place',
      edits: [{ layerId, carve: { v: 1, kind: 'polygon', center: { x: -150, y: 0 }, sides: 6, radius: 100, rotation: 0, cornerRadius: 30 } }],
      select: [layerId],
    })
  }, id)
  const corner = await handle(page, 'ne')
  await page.mouse.move(corner.x, corner.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(corner.x + 30 * f.unit, corner.y - 30 * f.unit, { steps: 8 })
  await expect(page.locator('main').getByText(/^r \d+ · corner \d+$/)).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const scaled = (await layers(page)).find((layer) => layer.id === id)!.carve as PolygonSpec
  expect(scaled.cornerRadius / scaled.radius).toBeCloseTo(0.3, 2)
})

test("a polygon too small for its rounding dot to keep clear of its middle has none: a press there moves it, and the bar rounds it", async ({ page }) => {
  await openVectorMaker(page, 'construction')
  await startOver(page)
  await addSlab(page, 'Polygon')
  const f = await frame(page)
  // 25 CSS pixels from the middle to a corner: too near for the dot, which starts 14 in and keeps 16 clear (32 by finger).
  const radius = 25 / f.unit
  const id = await page.evaluate((radius) => {
    const store = window.__marque.store
    const [hexagon] = store.getState().illustrator.layers
    store.getState().commitLayerEdits({
      label: 'Place',
      edits: [{ layerId: hexagon.id, carve: { v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius, rotation: 0, cornerRadius: 0 } }],
      select: [hexagon.id],
    })
    return hexagon.id
  }, radius)
  await expect.poll(() => handleIds(page)).toEqual(['nw', 'ne', 'se', 'sw', 'rotate'])
  const depth = await undoDepth(page)

  // Its Corner, in whole units, from sharp to as round as it goes, one undo step a change.
  const corner = selectionBar(page).getByRole('slider', { name: 'Corner' })
  await expect(corner).toBeVisible()
  await corner.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await polygonOf(page)).cornerRadius).toBe(1)
  expect(await undoDepth(page)).toBe(depth + 1)
  await page.keyboard.press('End')
  const apothem = radius * Math.cos(Math.PI / 6)
  await expect.poll(async () => (await polygonOf(page)).cornerRadius).toBeCloseTo(apothem, 1)
  expect(await page.evaluate((layerId) => window.__marque.cornerCircles(layerId).length, id)).toBe(0)

  // A press on the middle moves it (snapping off, so it lands where it is let go).
  const before = await undoDepth(page)
  await drag(page, f.at(0, 0), f.at(40, 30), ['ControlOrMeta'])
  expect(await undoDepth(page)).toBe(before + 1)
  const moved = await polygonOf(page)
  expect(Math.hypot(moved.center.x - 40, moved.center.y - 30)).toBeLessThanOrEqual(1.5)

  // Larger, it has its dot again, and the bar's Corner goes.
  await page.evaluate((layerId) => {
    const store = window.__marque.store
    store.getState().commitLayerEdits({
      label: 'Place',
      edits: [{ layerId, carve: { v: 1, kind: 'polygon', center: { x: 0, y: 0 }, sides: 6, radius: 200, rotation: 0, cornerRadius: 0 } }],
      select: [layerId],
    })
  }, id)
  await expect.poll(() => handleIds(page)).toContain('radius')
  await expect(corner).toHaveCount(0)
})

/* ─── Offsets ─── */

const offsetPanel = (page: Page) => page.getByRole('group', { name: 'Offset' })

/** The Distance slider of the Offset popover, moved by keys from where it starts to `distance`. */
async function setOffsetDistance(page: Page, distance: number) {
  const slider = offsetPanel(page).getByRole('slider', { name: 'Distance' })
  await slider.focus()
  await page.keyboard.press('Home')
  // The slider steps over 0, which offsets nothing.
  const presses = distance + 120 - (distance > 0 ? 1 : 0)
  for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowRight')
  await expect(offsetPanel(page).getByText(distance < 0 ? `Inset −${-distance}` : `Outset ${distance}`, { exact: true })).toBeVisible()
}

/** The source and its offset copy, read from the store: the copy's link, and how far apart their apothems are. */
function ringOf(page: Page) {
  return page.evaluate(() => {
    const [source, copy] = window.__marque.store.getState().vectorDocument.objects as Array<{ carve?: PolygonSpec; link?: { kind: string; of: string; distance: number } }>
    const apothem = (spec: PolygonSpec) => spec.radius * Math.cos(Math.PI / spec.sides)
    return {
      source: source.carve!,
      copy: copy.carve ?? null,
      link: copy.link ?? null,
      thickness: copy.carve ? apothem(source.carve!) - apothem(copy.carve) : null,
    }
  })
}

test("ref 1: Offset… −55 as a cut makes the hexagon a ring that stays 55 thick, its inner corners 5, as the hexagon is resized; undo, redo and Detach", async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Polygon')
  // Rounded to 60, as the polygon's dot does it (step 6).
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    const [hexagon] = state.illustrator.layers
    state.commitLayerEdits({ label: 'Round corners', edits: [{ layerId: hexagon.id, carve: { ...(hexagon.carve as PolygonSpec), cornerRadius: 60 } }], select: [hexagon.id] })
  })
  const f = await frame(page)
  const depth = await undoDepth(page)

  // The popover previews the ring as the slider moves: ink in the ring, none in the middle.
  await selectionBar(page).getByRole('button', { name: 'Offset…' }).click()
  await expect(offsetPanel(page).getByRole('switch', { name: 'As cut' })).toHaveAttribute('aria-checked', 'true')
  await setOffsetDistance(page, -55)
  const inRing = f.at(-145.7 * Math.sin(Math.PI / 3), -145.7 * Math.cos(Math.PI / 3))
  await expect.poll(() => isEmpty(page, f.at(0, 0))).toBe(true)
  expect(await isInk(page, inRing)).toBe(true)
  // Added rather than cut, the inset lies inside the hexagon and changes nothing: the popover says what As cut does.
  const inside = offsetPanel(page).getByText('Lies inside its source \u2014 As cut makes a ring', { exact: true })
  await expect(inside).toBeHidden()
  await offsetPanel(page).getByRole('switch', { name: 'As cut' }).click()
  await expect(inside).toBeVisible()
  await offsetPanel(page).getByRole('switch', { name: 'As cut' }).click()
  await expect(inside).toBeHidden()
  expect(await undoDepth(page)).toBe(depth)

  // Its button, named for what it makes, makes it, one undo step, and selects the copy, named for what it follows.
  await offsetPanel(page).getByRole('button', { name: 'Cut inset −55' }).click()
  expect(await undoDepth(page)).toBe(depth + 1)
  await expect(selectionSummary(page)).toContainText('Inset −55 of 01')
  // The keyboard goes on to the copy's own Distance, as the popover and its Offset… go.
  await expect(selectionBar(page).getByRole('group', { name: 'Offset' }).getByRole('slider', { name: 'Distance' })).toBeFocused()
  const ring = await ringOf(page)
  expect(ring.link).toMatchObject({ kind: 'offset', distance: -55 })
  expect(ring.copy).toMatchObject({ kind: 'polygon', cornerRadius: 5 })
  expect(Math.abs(ring.thickness! - 55)).toBeLessThanOrEqual(0.01)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await pointerAway(page, f)
  expect(await isEmpty(page, f.at(0, 0))).toBe(true)
  expect(await isInk(page, inRing)).toBe(true)
  expect(await isEmpty(page, f.at(0, -215))).toBe(true)

  // The drawer names the copy by its distance and the layer it follows.
  const drawer = await openLayers(page)
  await expect(drawer.getByRole('button', { name: '02 Inset \u221255 · 01', exact: true })).toBeVisible()
  // The hexagon's row says which copies follow it: their numbers after a glyph, in full in its title.
  const source = drawer.getByRole('button', { name: '01 Polygon · 6, copies 02', exact: true })
  await expect(source.getByTitle('Copies 02 follow this shape')).toHaveText('02')
  await closeLayers(page)

  // Resizing the hexagon by a corner keeps the ring 55 thick, its inner corners 5, as one undo step.
  await click(page, inRing)
  await expect(selectionSummary(page)).toContainText('Polygon')
  await expect(selectionBar(page).getByText('Copies 02', { exact: true })).toBeVisible()
  const se = await handle(page, 'se')
  await drag(page, se, { x: se.x + 40 * f.unit, y: se.y + 40 * f.unit })
  expect(await undoDepth(page)).toBe(depth + 2)
  const resized = await ringOf(page)
  expect(resized.source.radius).toBeGreaterThan(220)
  expect(Math.abs(resized.thickness! - 55)).toBeLessThanOrEqual(0.01)
  expect(resized.copy).toMatchObject({ cornerRadius: 5, center: resized.source.center })

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await ringOf(page)).source.radius).toBe(200)
  expect((await ringOf(page)).copy).toEqual(ring.copy)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => (await ringOf(page)).source.radius).toBe(resized.source.radius)
  expect((await ringOf(page)).copy).toEqual(resized.copy)

  // Detach keeps the ring as it is, and the hexagon no longer moves it.
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    state.setSelection([state.illustrator.layers[1].id])
  })
  // The bar's Distance moves the copy, one undo step a change.
  const before = await undoDepth(page)
  await selectionBar(page).getByRole('group', { name: 'Offset' }).getByRole('slider', { name: 'Distance' }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(selectionSummary(page)).toContainText('Inset \u221256 of 01')
  expect(await undoDepth(page)).toBe(before + 1)
  expect(Math.abs((await ringOf(page)).thickness! - 56)).toBeLessThanOrEqual(0.01)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(selectionSummary(page)).toContainText('Inset \u221255 of 01')
  // Taken past 0, the cut copy cuts the whole hexagon away, and the bar says so, as the popover does.
  const cutsAll = selectionBar(page).getByText('Cuts the whole shape away.')
  await expect(cutsAll).toBeHidden()
  await page.keyboard.press('End')
  await expect(selectionSummary(page)).toContainText('Outset 120 of 01')
  await expect(cutsAll).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(selectionSummary(page)).toContainText('Inset \u221255 of 01')
  await expect(cutsAll).toBeHidden()
  // Scaling the copy by itself with Alt+Up is an edit of its own: it lets go, and the HUD says so. Undo links it again.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.locator('main').getByText('detached', { exact: true })).toBeVisible()
  expect((await ringOf(page)).link).toBeNull()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await ringOf(page)).link).toMatchObject({ kind: 'offset', distance: -55 })
  await selectionBar(page).getByRole('button', { name: 'Detach' }).click()
  expect((await ringOf(page)).link).toBeNull()
  expect((await ringOf(page)).copy).toEqual(resized.copy)
  await expect(selectionSummary(page)).not.toContainText('Inset')
})

test("ref 1's ring: the copy's Out 1 sets an exact distance, ] on the copy steps the hexagon's sides, and with the hexagon locked the copy says why it stays", async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Polygon')
  const ids = await page.evaluate(() => {
    const state = window.__marque.store.getState()
    const [hexagon] = state.illustrator.layers
    state.commitLayerEdits({ label: 'Round corners', edits: [{ layerId: hexagon.id, carve: { ...(hexagon.carve as PolygonSpec), cornerRadius: 60 } }], select: [hexagon.id] })
    state.addOffset(hexagon.id, -55, true)
    return { hexagon: hexagon.id, copy: window.__marque.store.getState().illustrator.selectedLayerIds[0] }
  })
  await expect(selectionSummary(page)).toContainText('Inset \u221255 of 01')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const f = await frame(page)

  // A step out, as a finger sets an exact distance: one undo step, the ring 54 thick.
  const depth = await undoDepth(page)
  const offset = selectionBar(page).getByRole('group', { name: 'Offset' })
  await offset.getByRole('button', { name: 'Out 1' }).click()
  await expect(selectionSummary(page)).toContainText('Inset \u221254 of 01')
  expect(await undoDepth(page)).toBe(depth + 1)
  expect(Math.abs((await ringOf(page)).thickness! - 54)).toBeLessThanOrEqual(0.01)
  // On a phone the Distance has a row of its own, so its track is long enough to aim at.
  const track = await offset.getByRole('slider', { name: 'Distance' }).evaluate((thumb) => thumb.closest('.touch-none')!.getBoundingClientRect().width)
  expect(track).toBeGreaterThanOrEqual(f.box.width < 640 ? 160 : 120)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(selectionSummary(page)).toContainText('Inset \u221255 of 01')
  // With Shift a step is 5, and the readout says the distance plainly, its sign and all.
  await offset.getByRole('button', { name: 'In 1' }).click({ modifiers: ['Shift'] })
  await expect(selectionSummary(page)).toContainText('Inset \u221260 of 01')
  await expect(offset.getByText('Inset \u221260', { exact: true })).toHaveCSS('font-size', '12px')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(selectionSummary(page)).toContainText('Inset \u221255 of 01')
  // Past 0 the note that it cuts the whole shape away takes a line of its own on a phone: the track keeps its length, the readout one line.
  await page.evaluate((copy) => window.__marque.store.getState().setOffsetDistance(copy, 12), ids.copy)
  await expect(offset.getByText('Cuts the whole shape away.')).toBeVisible()
  const past = await offset.getByRole('slider', { name: 'Distance' }).evaluate((thumb) => thumb.closest('.touch-none')!.getBoundingClientRect().width)
  expect(past).toBeGreaterThanOrEqual(f.box.width < 640 ? 160 : 120)
  const readout = offset.getByText('Outset 12', { exact: true })
  expect(await readout.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(24)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(selectionSummary(page)).toContainText('Inset \u221255 of 01')
  // The copy draws no corner circles of its own: its corners share the hexagon's centres.
  expect(await page.evaluate((id) => window.__marque.cornerCircles(id).length, ids.copy)).toBe(0)
  expect(await page.evaluate((id) => window.__marque.cornerCircles(id).length, ids.hexagon)).toBe(6)

  // ] on the copy steps the hexagon it follows, and the copy follows: one undo step, and the HUD says which moved.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(']')
  await expect.poll(async () => [(await ringOf(page)).source.sides, (await ringOf(page)).copy?.sides]).toEqual([7, 7])
  await expect(page.locator('main div[aria-hidden="true"]').getByText('steps the source', { exact: true })).toBeVisible()
  await expect(page.locator('main p[role="status"]')).toHaveText('steps the source · 7 sides')
  expect(Math.abs((await ringOf(page)).thickness! - 55)).toBeLessThanOrEqual(0.01)
  expect(await undoDepth(page)).toBe(depth + 1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await ringOf(page)).source.sides).toBe(6)

  // With the hexagon locked, an arrow on its copy moves nothing and says why.
  await page.evaluate(({ hexagon, copy }) => {
    const state = window.__marque.store.getState()
    state.updateIllustratorLayer(hexagon, { locked: true })
    state.setSelection([copy])
  }, ids)
  const locked = await undoDepth(page)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('main div[aria-hidden="true"]').getByText('source is locked', { exact: true })).toBeVisible()
  await expect(page.locator('main p[role="status"]')).toHaveText('source is locked: unlock 01 to move it')
  expect(await undoDepth(page)).toBe(locked)
  expect((await ringOf(page)).source.center).toEqual({ x: 0, y: 0 })
  // A drag from inside the copy says the same while it lasts.
  await pointerAway(page, f)
  const [from, to] = [f.at(0, 0), f.at(50, 0)]
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await expect(page.locator('main div[aria-hidden="true"]').getByText('source is locked', { exact: true })).toBeVisible()
  await page.mouse.up()
  expect(await undoDepth(page)).toBe(locked)
  expect((await ringOf(page)).source.center).toEqual({ x: 0, y: 0 })
})

test('the drawer names an offset copy whole, a long distance and an empty one alike', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Polygon')
  // A hexagon 100 round: an inset of 120 leaves nothing of it.
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    const [hexagon] = state.illustrator.layers
    state.commitLayerEdits({ label: 'Resize', edits: [{ layerId: hexagon.id, carve: { ...(hexagon.carve as PolygonSpec), radius: 100 } }] })
    state.addOffset(hexagon.id, 100, false)
    state.addOffset(hexagon.id, -120, true)
  })
  const drawer = await openLayers(page)
  const rows = [drawer.getByRole('button', { name: '02 Inset \u2212120 · 01, empty', exact: true }), drawer.getByRole('button', { name: '03 Outset 100 · 01', exact: true })]
  for (const row of rows) {
    await expect(row).toBeVisible()
    const name = row.locator('span.truncate')
    expect(await name.evaluate((span) => span.scrollWidth - span.clientWidth)).toBeLessThanOrEqual(0)
  }
  await closeLayers(page)
})

test('the drawer keeps a source row\'s number and name whole when three copies follow it', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  await addSlab(page, 'Polygon')
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    const [hexagon] = state.illustrator.layers
    for (const d of [-55, 12, 20]) state.addOffset(hexagon.id, d, d < 0)
    state.setSelection([hexagon.id])
  })
  const drawer = await openLayers(page)
  const row = drawer.getByRole('button', { name: /^01 .*, copies 02, 03, 04$/ })
  await expect(row).toBeVisible()
  const [name, copies] = await row.locator(':scope > span').all()
  // The name is drawn whole; the copies after it give way, and stay inside the row.
  expect(await name.evaluate((span) => span.scrollWidth - span.clientWidth)).toBeLessThanOrEqual(0)
  const rowBox = (await row.boundingBox())!
  const copiesBox = (await copies.boundingBox())!
  expect(copiesBox.x + copiesBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5)
  expect(await drawer.locator('ul').first().evaluate((list) => list.scrollWidth - list.clientWidth)).toBeLessThanOrEqual(0)
  await closeLayers(page)
})

test('an offset of a pen shape is made by the general method, follows a drag of its shape at the commit, and a drag of the copy moves the shape', async ({ page }) => {
  await openVectorMaker(page)
  await startOver(page)
  // An L, drawn with the pen.
  await page.evaluate(() => window.__marque.store.getState().addPenShape('M-120,-120L40,-120L40,-20L-20,-20L-20,120L-120,120Z'))
  const f = await frame(page)
  const depth = await undoDepth(page)
  await selectionBar(page).getByRole('button', { name: 'Offset…' }).click()
  // As cut follows the side of 0 until it is set: on for an inset, off for an outset.
  await expect(offsetPanel(page).getByRole('switch', { name: 'As cut' })).toHaveAttribute('aria-checked', 'true')
  await setOffsetDistance(page, 12)
  await expect(offsetPanel(page).getByRole('switch', { name: 'As cut' })).toHaveAttribute('aria-checked', 'false')
  await offsetPanel(page).getByRole('button', { name: 'Add outset 12' }).click()
  expect(await undoDepth(page)).toBe(depth + 1)
  await expect(selectionSummary(page)).toContainText('Outset 12 of 01')

  /** How far the copy's points stray from lying 12 from the L, the worst of them. */
  const stray = () =>
    page.evaluate(() => {
      const [shape, copy] = window.__marque.store.getState().vectorDocument.objects as Array<{ contours: Array<{ segments: Array<{ point: Point }> }>; carve?: unknown }>
      const outline = shape.contours[0].segments.map((segment) => segment.point)
      const away = (p: Point) =>
        Math.min(
          ...outline.map((a, i) => {
            const b = outline[(i + 1) % outline.length]
            const dx = b.x - a.x
            const dy = b.y - a.y
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
            return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
          }),
        )
      return { free: copy.carve === undefined, worst: Math.max(...copy.contours[0].segments.map((segment) => Math.abs(away(segment.point) - 12))) }
    })
  expect(await stray()).toEqual({ free: true, worst: expect.any(Number) })
  expect((await stray()).worst).toBeLessThan(0.5)

  // Dragging the copy moves the L, and the HUD says so; the commit makes the copy again around it.
  const grip = f.at(-70, 60)
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x + 30 * f.unit, grip.y + 20 * f.unit, { steps: 10 })
  await expect(page.locator('main').getByText(/^moves the source/)).toBeVisible()
  await page.mouse.up()
  expect(await undoDepth(page)).toBe(depth + 2)
  const outline = await page.evaluate(() => (window.__marque.store.getState().vectorDocument.objects[0] as { contours: Array<{ segments: Array<{ point: Point }> }> }).contours[0].segments[0].point)
  expect(Math.abs(outline.x - -120)).toBeGreaterThan(10)
  expect((await stray()).worst).toBeLessThan(0.5)
  await expect(selectionSummary(page)).toContainText('Outset 12 of 01')

  // A nudge of the copy nudges the L too, and the HUD says so.
  await pointerAway(page, f)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('main').getByText('moves the source', { exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window.__marque.store.getState().vectorDocument.objects[0] as { contours: Array<{ segments: Array<{ point: Point }> }> }).contours[0].segments[0].point.x))
    .toBeCloseTo(outline.x + 1, 6)
  expect((await stray()).worst).toBeLessThan(0.5)
  await expect(selectionSummary(page)).toContainText('Outset 12 of 01')

  // ] on the copy steps nothing: a copy of a free shape keeps its source's shape, and says so.
  const sides = await page.evaluate(() => window.__marque.store.getState().ui.carve.polygonSides)
  const before = await undoDepth(page)
  await page.keyboard.press(']')
  await expect(page.locator('main div[aria-hidden="true"]').getByText("Offset copies keep their source's shape", { exact: true })).toBeVisible()
  await expect(page.locator('main p[role="status"]')).toHaveText("Offset copies keep their source's shape")
  expect(await undoDepth(page)).toBe(before)
  expect(await page.evaluate(() => window.__marque.store.getState().ui.carve.polygonSides)).toBe(sides)

  // A double-click on one of the copy's points edits it by itself: it lets go, and the HUD and the status line say so.
  const status = page.locator('main').getByRole('status')
  const linkOf = () => page.evaluate(() => (window.__marque.store.getState().vectorDocument.objects[1] as { link?: unknown }).link ?? null)
  const corner = await page.evaluate(() => (window.__marque.store.getState().vectorDocument.objects[1] as { contours: Array<{ segments: Array<{ point: Point }> }> }).contours[0].segments[0].point)
  const linked = await undoDepth(page)
  const point = f.at(corner.x, corner.y)
  await page.mouse.dblclick(point.x, point.y)
  await expect.poll(linkOf).toBeNull()
  await expect(hudLabel(page, 'detached')).toBeVisible()
  await expect(status).toHaveText(/^Detached 02: it no longer follows its shape/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => undoDepth(page)).toBe(linked)
  expect(await linkOf()).toMatchObject({ kind: 'offset', distance: 12 })

  // The L deleted: the copy keeps its outline and lets go in the same undo step, and says so.
  await page.evaluate(() => {
    const state = window.__marque.store.getState()
    state.setSelection([state.illustrator.layers[0].id])
  })
  await page.keyboard.press('Delete')
  await expect(status).toHaveText(/^Detached 01: the shape it followed is gone/)
  await expect(hudLabel(page, 'detached')).toBeVisible()
  expect(await undoDepth(page)).toBe(linked + 1)
  const left = await page.evaluate(() => window.__marque.store.getState().vectorDocument.objects as Array<{ name: string; link?: unknown }>)
  expect(left).toHaveLength(1)
  expect(left[0].link).toBeUndefined()
  expect(left[0].name).toMatch(/^Shape \d+$/)
})
