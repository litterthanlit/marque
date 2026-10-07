import type {
  ConstructionCircle,
  ConstructionLine,
  GenerationResult,
  LogoGenerator,
  LogoParams,
  ShapeNode,
} from '../types.ts'
import { composeBooleanResult } from '../boolean/operations.ts'
import type { Bounds, Vec } from '../path/bezier.ts'
import { CAP_HEIGHT, getGlyph, type Glyph } from '../monogram/glyphs.ts'
import {
  mapOutline,
  outlineBounds,
  outlinePathData,
  pieceLength,
  piecePoint,
  pieceTangent,
  strokeSkeleton,
  widthAlong,
  type CornerStyle,
  type Outline,
  type Piece,
  type Skeleton,
  type StrokeStyle,
} from '../monogram/stroke.ts'

/** Layer units in one unit of the letters' grid, whose cap height is seven. */
const UNIT = 34
/** The longest side a mark is drawn to: three letters, or a badge, are drawn smaller to fit. */
const MAX_SPAN = 420
const CORNERS: CornerStyle[] = ['miter', 'bevel', 'round']
/** How far a frame's centreline stands off the letters' ink, in grid units. */
const FRAME_CLEARANCE = 1.25

/**
 * Initials drawn as strokes: each capital is a centreline of lines and arcs
 * (see glyphs.ts), stroked to the weight, contrast and corners asked for,
 * set side by side and drawn closer the stronger the interlock. A frame is
 * a stroke too, round the letters, so it never cuts into them.
 *
 * - strokeWeight: the width of a vertical stroke, from 0.8 grid units at
 *   0.8 to 1.5 at 1.8.
 * - contrast: how much thinner horizontals are, down to half at 1.
 * - cornerStyle: 0 mitered, 1 beveled, 2 round (round ends too).
 * - interlockStrength: from 1.2 units of space between letters at 0 to 1.8
 *   units of overlap at 1.
 * - symmetryBias: from 0.5, the letters step up and down a unit in turn.
 * - frameMode: 0 none, 1 a rectangle, 2 a circle.
 */
export const MonogramGenerator: LogoGenerator = {
  id: 'monogram',
  modeId: 'monogram',
  name: 'Monogram',
  description: 'Interlocked initials drawn as strokes along letter skeletons.',
  version: '2.0',
  extraParams: [],
  generate(params: LogoParams): GenerationResult {
    const initials = (params.brandInput.initials ?? 'MM').slice(0, 3) || 'MM'
    const modeParams = (params.modeParams.monogram ?? {}) as Record<string, number>
    const strokeWeight = modeParams.strokeWeight ?? 1.15
    const contrast = modeParams.contrast ?? 0.45
    const cornerStyle = Math.round(modeParams.cornerStyle ?? 0)
    const interlockStrength = modeParams.interlockStrength ?? 0.45
    const symmetryBias = modeParams.symmetryBias ?? 0.4
    const frameMode = Math.round(modeParams.frameMode ?? 0)

    const vertical = 0.8 + 0.7 * (strokeWeight - 0.8)
    const horizontal = vertical * (1 - 0.5 * contrast)
    const corners = CORNERS[Math.min(2, Math.max(0, cornerStyle))]

    const letters = layout(initials, vertical, interlockStrength, symmetryBias)
    const strokes: Stroked[] = letters.flatMap((letter, index) => {
      const style: StrokeStyle = { vertical, horizontal, corners, lines: { top: letter.y, bottom: letter.y + CAP_HEIGHT } }
      return letter.glyph.strokes.flatMap((skeleton, s) =>
        stroked(moved(skeleton, letter.x, letter.y), style, `mono_${index}_${s}`, index === 0 ? 'prototype' : 'symmetry-instance'),
      )
    })

    const ink = strokes.map((stroke) => outlineBounds(stroke.outline)).reduce(unionBounds)
    const frame = frameMode === 1 || frameMode === 2 ? frameStrokes(frameMode, ink, vertical * 0.6, corners) : []
    const all = [...strokes, ...frame]
    const extent = all.map((stroke) => outlineBounds(stroke.outline)).reduce(unionBounds)
    const unit = Math.min(UNIT, MAX_SPAN / Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY))
    const centre = { x: (ink.minX + ink.maxX) / 2, y: (ink.minY + ink.maxY) / 2 }
    const turn = (params.rotation * Math.PI) / 180
    const place = (p: Vec): Vec => {
      const x = (p.x - centre.x) * unit
      const y = (p.y - centre.y) * unit
      return {
        x: Math.round((x * Math.cos(turn) - y * Math.sin(turn)) * 1000) / 1000,
        y: Math.round((x * Math.sin(turn) + y * Math.cos(turn)) * 1000) / 1000,
      }
    }

    const shapes: ShapeNode[] = all.map((stroke) => {
      const tangent = pieceTangent(stroke.piece, 0.5)
      return {
        id: stroke.id,
        type: 'stroke',
        role: stroke.role,
        operation: 'add',
        center: place(piecePoint(stroke.piece, 0.5)),
        radius: (stroke.piece.kind === 'line' ? pieceLength(stroke.piece) / 2 : stroke.piece.r) * unit,
        rotation: Math.atan2(tangent.y, tangent.x) + turn,
        params: { width: widthAlong(stroke.style, tangent) * unit },
        pathData: outlinePathData(mapOutline(stroke.outline, place)),
      }
    })

    const boolResult = composeBooleanResult(shapes.map((shape) => ({ pathData: shape.pathData!, operation: shape.operation })))
    const { guideLines, gridCircles } = construction(letters, ink, place, unit)

    return {
      shapes,
      mark: {
        layers: boolResult.layers,
        compoundPathData: boolResult.compoundPathData,
        fillRule: boolResult.fillRule,
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridCircles,
        guideLines,
        stats: {
          totalShapes: shapes.length,
          additiveCount: shapes.length,
          subtractiveCount: 0,
          symmetryFolds: 1,
        },
      },
      warnings: boolResult.warnings,
    }
  },
}

interface Placed {
  glyph: Glyph
  /** Where the letter's grid starts, in grid units. */
  x: number
  y: number
}

interface Stroked {
  id: string
  role: ShapeNode['role']
  piece: Piece
  style: StrokeStyle
  outline: Outline
}

/** The letters side by side, each its own width apart plus the space the interlock leaves between their ink. */
function layout(initials: string, vertical: number, interlockStrength: number, symmetryBias: number): Placed[] {
  const space = 1.2 - 3 * interlockStrength
  let x = 0
  return initials.split('').map((letter, index) => {
    const glyph = getGlyph(letter)
    const placed = { glyph, x, y: Math.round((index % 2 === 0 ? -1 : 1) * symmetryBias) }
    x += glyph.width + vertical + space
    return placed
  })
}

function stroked(skeleton: Skeleton, style: StrokeStyle, id: string, role: ShapeNode['role']): Stroked[] {
  return strokeSkeleton(skeleton, style).map((outline, k) => ({ id: `${id}_${k}`, role, piece: skeleton.pieces[k], style, outline }))
}

function moved(skeleton: Skeleton, dx: number, dy: number): Skeleton {
  const at = (p: Vec): Vec => ({ x: p.x + dx, y: p.y + dy })
  return {
    ...skeleton,
    pieces: skeleton.pieces.map((piece): Piece =>
      piece.kind === 'line' ? { ...piece, a: at(piece.a), b: at(piece.b) } : { ...piece, c: at(piece.c) },
    ),
  }
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/** A rectangle or circle round the letters' ink, its centreline clear of it by FRAME_CLEARANCE plus half its width. */
function frameStrokes(frameMode: 1 | 2, ink: Bounds, width: number, corners: CornerStyle): Stroked[] {
  const style: StrokeStyle = { vertical: width, horizontal: width, corners }
  const off = FRAME_CLEARANCE + width / 2
  const c = { x: (ink.minX + ink.maxX) / 2, y: (ink.minY + ink.maxY) / 2 }

  if (frameMode === 2) {
    const r = Math.hypot(ink.maxX - c.x, ink.maxY - c.y) + off
    const circle: Skeleton = {
      pieces: [
        { kind: 'arc', c, r, start: Math.PI, sweep: Math.PI },
        { kind: 'arc', c, r, start: 0, sweep: Math.PI },
      ],
      closed: true,
      tee: { start: false, end: false },
    }
    return stroked(circle, style, 'monogram_badge', 'prototype')
  }

  const box = [
    { x: ink.minX - off, y: ink.minY - off },
    { x: ink.maxX + off, y: ink.minY - off },
    { x: ink.maxX + off, y: ink.maxY + off },
    { x: ink.minX - off, y: ink.maxY + off },
  ]
  const rectangle: Skeleton = {
    pieces: box.map((a, i): Piece => ({ kind: 'line', a, b: box[(i + 1) % box.length] })),
    closed: true,
    tee: { start: false, end: false },
  }
  return stroked(rectangle, style, 'monogram_frame', 'prototype')
}

/** Each letter's cap line, middle and baseline, the circles its rounds are drawn on, and the axis of the whole. */
function construction(letters: Placed[], ink: Bounds, place: (p: Vec) => Vec, unit: number) {
  const guideLines: ConstructionLine[] = []
  const gridCircles: ConstructionCircle[] = []
  const seen = new Set<string>()
  const line = (a: Vec, b: Vec, kind: ConstructionLine['kind']) => {
    const p = place(a)
    const q = place(b)
    guideLines.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, kind })
  }

  for (const letter of letters) {
    for (const y of [0, CAP_HEIGHT / 2, CAP_HEIGHT]) {
      line({ x: letter.x, y: letter.y + y }, { x: letter.x + letter.glyph.width, y: letter.y + y }, 'grid')
    }
    for (const skeleton of letter.glyph.strokes) {
      for (const piece of skeleton.pieces) {
        if (piece.kind !== 'arc') continue
        const c = place({ x: piece.c.x + letter.x, y: piece.c.y + letter.y })
        const key = `${c.x}:${c.y}:${piece.r}`
        if (seen.has(key)) continue
        seen.add(key)
        gridCircles.push({ cx: c.x, cy: c.y, r: piece.r * unit })
      }
    }
  }

  const middle = (ink.minX + ink.maxX) / 2
  line({ x: middle, y: ink.minY - 1 }, { x: middle, y: ink.maxY + 1 }, 'mirror')
  return { guideLines, gridCircles }
}
