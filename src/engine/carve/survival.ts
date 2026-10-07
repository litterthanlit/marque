import type { MarkData } from '../illustrator/types.ts'

export type SurvivalSize = 16 | 32 | 64

export const SURVIVAL_SIZES: SurvivalSize[] = [16, 32, 64]

export interface SurvivalResult {
  /** Overlay image: weak areas painted, everything else transparent. */
  overlay: HTMLCanvasElement
  /** Where the overlay sits, in the same space as the mark's path data. */
  bounds: { x: number; y: number; width: number; height: number }
  /** Share of the ink that would disappear at this size (0–1). */
  weakRatio: number
  size: SurvivalSize
}

const RES = 360
const PAD = 0.06
const WEAK_RGB: [number, number, number] = [217, 48, 54]

/**
 * Chamfer (3-4) distance transform: for every pixel, the approximate distance
 * in pixels to the nearest pixel where `isFeature` is set.
 */
function distanceTo(isFeature: (i: number) => boolean, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = isFeature(i) ? 0 : INF

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      }
      d[i] = v
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3
  return d
}

/**
 * Pixels of `ink` that a disc of `radius` pixels cannot reach while staying
 * inside the ink — i.e. walls thinner than 2 × radius. Morphological opening,
 * done with two distance transforms so the probe is round, not square.
 */
export function findThinWalls(ink: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const toEdge = distanceTo((i) => ink[i] === 0, w, h)
  const toCore = distanceTo((i) => toEdge[i] >= radius, w, h)
  const thin = new Uint8Array(ink.length)
  for (let i = 0; i < ink.length; i++) thin[i] = ink[i] && toCore[i] > radius ? 1 : 0

  // Every sharp corner loses a speck under any round probe. Drop specks smaller
  // than a fraction of the probe so only real slivers and bridges are reported.
  // A right-angle corner measures about 0.33 to 0.4 r² here, so the cut-off sits above it.
  const minArea = Math.max(4, radius * radius * 0.5)
  const seen = new Uint8Array(ink.length)
  const stack: number[] = []
  const region: number[] = []
  for (let start = 0; start < thin.length; start++) {
    if (!thin[start] || seen[start]) continue
    region.length = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      region.push(i)
      const x = i % w
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]
      for (const n of neighbours) {
        if (n < 0 || n >= thin.length || seen[n] || !thin[n]) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    if (region.length < minArea) for (const i of region) thin[i] = 0
  }
  return thin
}

let cacheKey = ''
let cacheValue: SurvivalResult | null = null

/**
 * Would this mark survive being printed at `size` pixels across?
 * A wall survives if it is at least one device pixel wide at that size.
 */
export function checkSurvival(mark: MarkData | null, size: SurvivalSize): SurvivalResult | null {
  if (!mark?.compoundPathData || typeof document === 'undefined') return null
  const key = `${size}|${mark.compoundPathData}`
  if (key === cacheKey) return cacheValue

  const { x, y, width, height } = mark.viewBox
  const longest = Math.max(width, height)
  if (longest <= 0) return null

  const side = longest * (1 + PAD * 2)
  const bounds = {
    x: x + width / 2 - side / 2,
    y: y + height / 2 - side / 2,
    width: side,
    height: side,
  }
  const unitsPerPixel = side / RES
  // One device pixel at `size` px, expressed in mask pixels; the probe is half of that.
  const radius = Math.max(1, longest / size / unitsPerPixel / 2)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = maskCanvas.height = RES
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) return null
  maskCtx.scale(1 / unitsPerPixel, 1 / unitsPerPixel)
  maskCtx.translate(-bounds.x, -bounds.y)
  maskCtx.fill(new Path2D(mark.compoundPathData), mark.fillRule)
  const pixels = maskCtx.getImageData(0, 0, RES, RES).data

  const ink = new Uint8Array(RES * RES)
  let inkCount = 0
  for (let i = 0; i < ink.length; i++) {
    ink[i] = pixels[i * 4 + 3] > 127 ? 1 : 0
    inkCount += ink[i]
  }

  const thin = findThinWalls(ink, RES, RES, radius)
  const overlay = document.createElement('canvas')
  overlay.width = overlay.height = RES
  const overlayCtx = overlay.getContext('2d')
  if (!overlayCtx) return null
  const image = overlayCtx.createImageData(RES, RES)
  let weakCount = 0
  for (let i = 0; i < thin.length; i++) {
    if (!thin[i]) continue
    weakCount++
    image.data[i * 4] = WEAK_RGB[0]
    image.data[i * 4 + 1] = WEAK_RGB[1]
    image.data[i * 4 + 2] = WEAK_RGB[2]
    image.data[i * 4 + 3] = 230
  }
  overlayCtx.putImageData(image, 0, 0)

  cacheKey = key
  cacheValue = {
    overlay,
    bounds,
    weakRatio: inkCount ? weakCount / inkCount : 0,
    size,
  }
  return cacheValue
}
