import type { Vec } from '../path/bezier.ts'
import { pieceEnd, type Piece, type Skeleton } from './stroke.ts'

/**
 * The capitals as centrelines, for the stroker to give weight. Each is drawn
 * on the same grid the cell letters used: seven units from the cap line
 * (y = 0) to the baseline (y = 7), most five units wide, with full rounds of
 * radius 2.5 (half the width) and bowls of 1.75 (half the height above or
 * below the middle, y = 3.5). x runs from the left of the letter.
 *
 * A pen moves through each stroke: `to` draws a line, `around` an arc about
 * a centre through a number of degrees (positive clockwise on screen, so
 * from the left of a circle +90 reaches its top). A stroke that starts or
 * ends inside another, where a bar meets a stem, says so with `tee`, and is
 * finished square there; every other end is free.
 */

export interface Glyph {
  /** From the leftmost centreline to the rightmost. */
  width: number
  strokes: Skeleton[]
}

export const CAP_HEIGHT = 7

class Pen {
  private readonly pieces: Piece[] = []
  private at: Vec
  private readonly origin: Vec
  private readonly teeStart: boolean

  constructor(x: number, y: number, tee: boolean) {
    this.at = { x, y }
    this.origin = this.at
    this.teeStart = tee
  }

  to(x: number, y: number): this {
    this.pieces.push({ kind: 'line', a: this.at, b: { x, y } })
    this.at = { x, y }
    return this
  }

  around(cx: number, cy: number, degrees: number): this {
    const c = { x: cx, y: cy }
    const piece: Piece = {
      kind: 'arc',
      c,
      r: Math.hypot(this.at.x - cx, this.at.y - cy),
      start: Math.atan2(this.at.y - cy, this.at.x - cx),
      sweep: (degrees * Math.PI) / 180,
    }
    this.pieces.push(piece)
    this.at = pieceEnd(piece)
    return this
  }

  end(): Skeleton {
    return { pieces: this.pieces, closed: false, tee: { start: this.teeStart, end: false } }
  }

  endTee(): Skeleton {
    return { pieces: this.pieces, closed: false, tee: { start: this.teeStart, end: true } }
  }

  close(): Skeleton {
    if (Math.hypot(this.at.x - this.origin.x, this.at.y - this.origin.y) > 1e-9) this.to(this.origin.x, this.origin.y)
    return { pieces: this.pieces, closed: true, tee: { start: false, end: false } }
  }
}

const from = (x: number, y: number) => new Pen(x, y, false)
const tee = (x: number, y: number) => new Pen(x, y, true)

/** Where A's bar, at y = 4.5, meets its left leg. */
const A_BAR = 2.5 * (2.5 / 7)

export const GLYPHS: Record<string, Glyph> = {
  A: { width: 5, strokes: [from(0, 7).to(2.5, 0).to(5, 7).end(), tee(A_BAR, 4.5).to(5 - A_BAR, 4.5).endTee()] },
  B: {
    width: 5,
    strokes: [tee(0, 3.5).to(3.25, 3.5).around(3.25, 5.25, 180).to(0, 7).to(0, 0).to(3, 0).around(3, 1.75, 180).endTee()],
  },
  C: { width: 5, strokes: [from(5, 0).to(2.5, 0).around(2.5, 2.5, -90).to(0, 4.5).around(2.5, 4.5, -90).to(5, 7).end()] },
  D: { width: 5, strokes: [from(0, 0).to(2.5, 0).around(2.5, 2.5, 90).to(5, 4.5).around(2.5, 4.5, 90).to(0, 7).close()] },
  E: { width: 4.5, strokes: [from(4.5, 0).to(0, 0).to(0, 7).to(4.5, 7).end(), tee(0, 3.5).to(4, 3.5).end()] },
  F: { width: 4.5, strokes: [from(4.5, 0).to(0, 0).to(0, 7).end(), tee(0, 3.5).to(4, 3.5).end()] },
  G: {
    width: 5,
    strokes: [from(5, 0).to(2.5, 0).around(2.5, 2.5, -90).to(0, 4.5).around(2.5, 4.5, -180).to(5, 3.5).to(3, 3.5).end()],
  },
  H: { width: 5, strokes: [from(0, 0).to(0, 7).end(), from(5, 0).to(5, 7).end(), tee(0, 3.5).to(5, 3.5).endTee()] },
  I: { width: 3, strokes: [from(0, 0).to(3, 0).end(), from(0, 7).to(3, 7).end(), tee(1.5, 0).to(1.5, 7).endTee()] },
  J: { width: 4.5, strokes: [from(4.5, 0).to(4.5, 4.75).around(2.25, 4.75, 180).end()] },
  K: {
    width: 4.75,
    strokes: [from(0, 0).to(0, 7).end(), tee(0, 4.5).to(4.75, 0).end(), tee(1.9, 2.7).to(4.75, 7).end()],
  },
  L: { width: 4.25, strokes: [from(0, 0).to(0, 7).to(4.25, 7).end()] },
  M: { width: 5.5, strokes: [from(0, 7).to(0, 0).to(2.75, 4.5).to(5.5, 0).to(5.5, 7).end()] },
  N: { width: 5, strokes: [from(0, 7).to(0, 0).to(5, 7).to(5, 0).end()] },
  O: { width: 5, strokes: [from(0, 2.5).around(2.5, 2.5, 180).to(5, 4.5).around(2.5, 4.5, 180).close()] },
  P: { width: 5, strokes: [from(0, 7).to(0, 0).to(3.25, 0).around(3.25, 1.75, 180).to(0, 3.5).endTee()] },
  Q: {
    width: 5,
    strokes: [
      from(0, 2.5).around(2.5, 2.5, 180).to(5, 4.5).around(2.5, 4.5, 180).close(),
      from(3.4, 5.1).to(5.3, 7).end(),
    ],
  },
  R: {
    width: 5,
    strokes: [from(0, 7).to(0, 0).to(3.25, 0).around(3.25, 1.75, 180).to(0, 3.5).endTee(), tee(3.25, 3.5).to(5, 7).end()],
  },
  S: {
    width: 5,
    strokes: [from(5, 0).to(1.75, 0).around(1.75, 1.75, -180).to(3.25, 3.5).around(3.25, 5.25, 180).to(0, 7).end()],
  },
  T: { width: 5, strokes: [from(0, 0).to(5, 0).end(), tee(2.5, 0).to(2.5, 7).end()] },
  U: { width: 5, strokes: [from(0, 0).to(0, 4.5).around(2.5, 4.5, -180).to(5, 0).end()] },
  V: { width: 5, strokes: [from(0, 0).to(2.5, 7).to(5, 0).end()] },
  W: { width: 6.5, strokes: [from(0, 0).to(1.625, 7).to(3.25, 0).to(4.875, 7).to(6.5, 0).end()] },
  X: { width: 5, strokes: [from(0, 0).to(5, 7).end(), from(5, 0).to(0, 7).end()] },
  Y: { width: 5, strokes: [from(0, 0).to(2.5, 3.75).to(2.5, 7).end(), from(5, 0).to(2.5, 3.75).endTee()] },
  Z: { width: 5, strokes: [from(0, 0).to(5, 0).to(0, 7).to(5, 7).end()] },
}

/** A capital's skeleton; anything else is drawn as M. */
export function getGlyph(letter: string): Glyph {
  return GLYPHS[letter.toUpperCase()] ?? GLYPHS.M
}
