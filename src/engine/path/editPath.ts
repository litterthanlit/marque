import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  splitCubic,
  straightCubic,
  sub,
  solveBend,
  type Cubic,
  type Vec,
} from './bezier.ts'
import type { Seg } from '../carve/outline.ts'

/**
 * A free shape as plain data: anchors with handles relative to them. All
 * operations are pure and return a new path, so a drag can always be
 * recomputed from its starting state.
 */
export interface EditablePath {
  segs: Seg[]
  closed: boolean
}

/**
 * A free shape whole: its contours, in the order its object keeps them. A
 * hole is a further contour. Moves and boxes take the whole shape; points
 * and edges are edited on one contour of it.
 */
export type EditableShape = readonly EditablePath[]

const fmt = (v: number): string => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}
const fmtVec = (p: Vec): string => `${fmt(p.x)},${fmt(p.y)}`

function isZero(v: Vec | null): boolean {
  return !v || (Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9)
}

export function curveCount(path: EditablePath): number {
  const n = path.segs.length
  if (n < 2) return 0
  return path.closed ? n : n - 1
}

/** Curve i runs from anchor i to anchor i+1 (wrapping on closed paths). */
export function curveOf(path: EditablePath, i: number): Cubic {
  const a = path.segs[i]
  const b = path.segs[(i + 1) % path.segs.length]
  return [a.p, add(a.p, a.hOut ?? { x: 0, y: 0 }), add(b.p, b.hIn ?? { x: 0, y: 0 }), b.p]
}

export function isCurveStraight(path: EditablePath, i: number): boolean {
  const a = path.segs[i]
  const b = path.segs[(i + 1) % path.segs.length]
  return isZero(a.hOut) && isZero(b.hIn)
}

export function editablePathToPathData(path: EditablePath): string {
  const { segs } = path
  if (!segs.length) return ''
  let d = `M${fmtVec(segs[0].p)}`
  const count = curveCount(path)
  for (let i = 0; i < count; i++) {
    const a = segs[i]
    const b = segs[(i + 1) % segs.length]
    if (isZero(a.hOut) && isZero(b.hIn)) {
      d += `L${fmtVec(b.p)}`
    } else {
      const c = curveOf(path, i)
      d += `C${fmtVec(c[1])} ${fmtVec(c[2])} ${fmtVec(c[3])}`
    }
  }
  if (path.closed) d += 'Z'
  return d
}

/** Every contour's path data in turn. */
export function shapePathData(shape: EditableShape): string {
  return shape.map(editablePathToPathData).join('')
}

export function translateShape(shape: EditableShape, d: Vec): EditableShape {
  return shape.map((path) => translatePath(path, d))
}

/** Every anchor of a shape, contour after contour. */
export function shapeAnchors(shape: EditableShape): Vec[] {
  return shape.flatMap((path) => path.segs.map((seg) => seg.p))
}

function cloneSegs(path: EditablePath): Seg[] {
  return path.segs.map((s) => ({ p: { ...s.p }, hIn: s.hIn ? { ...s.hIn } : null, hOut: s.hOut ? { ...s.hOut } : null }))
}

export function translatePath(path: EditablePath, d: Vec): EditablePath {
  return { closed: path.closed, segs: path.segs.map((s) => ({ ...s, p: add(s.p, d) })) }
}

/** Move an anchor; its handles travel with it. */
export function moveAnchor(start: EditablePath, index: number, to: Vec): EditablePath {
  const segs = cloneSegs(start)
  segs[index].p = { ...to }
  return { closed: start.closed, segs }
}

/** Smooth = both handles present and pointing in opposite directions. */
export function isSmoothAt(path: EditablePath, index: number, tolDeg = 3): boolean {
  const s = path.segs[index]
  if (isZero(s.hIn) || isZero(s.hOut)) return false
  const a = normalize(s.hOut!)
  const b = normalize(scale(s.hIn!, -1))
  const angle = Math.abs(Math.atan2(cross(a, b), dot(a, b))) * (180 / Math.PI)
  return angle < tolDeg
}

/**
 * Move one Bézier handle to an absolute position. On a smooth anchor the
 * opposite handle turns with it (keeping its length) unless `breakSmooth`.
 */
export function moveHandle(
  start: EditablePath,
  index: number,
  which: 'in' | 'out',
  to: Vec,
  opts: { breakSmooth?: boolean } = {},
): EditablePath {
  const wasSmooth = isSmoothAt(start, index)
  const segs = cloneSegs(start)
  const seg = segs[index]
  const rel = sub(to, seg.p)
  if (which === 'in') seg.hIn = rel
  else seg.hOut = rel
  if (wasSmooth && !opts.breakSmooth && length(rel) > 1e-9) {
    const other = which === 'in' ? seg.hOut : seg.hIn
    const len = other ? length(other) : 0
    const opposite = scale(normalize(rel), -len)
    if (which === 'in') seg.hOut = opposite
    else seg.hIn = opposite
  }
  return { closed: start.closed, segs }
}

function neighbours(path: EditablePath, index: number): { prev: Vec | null; next: Vec | null } {
  const n = path.segs.length
  const prevIndex = index - 1 >= 0 ? index - 1 : path.closed ? n - 1 : -1
  const nextIndex = index + 1 < n ? index + 1 : path.closed ? 0 : -1
  return {
    prev: prevIndex >= 0 && prevIndex !== index ? path.segs[prevIndex].p : null,
    next: nextIndex >= 0 && nextIndex !== index ? path.segs[nextIndex].p : null,
  }
}

/**
 * Sharp ↔ smooth. Smooth handles follow the line through the two neighbours
 * and reach a third of the way to each, which reads as a natural curve.
 */
export function toggleSmooth(path: EditablePath, index: number): EditablePath {
  const segs = cloneSegs(path)
  const seg = segs[index]
  if (isSmoothAt(path, index)) {
    seg.hIn = null
    seg.hOut = null
    return { closed: path.closed, segs }
  }
  const { prev, next } = neighbours(path, index)
  if (!prev && !next) return path
  const dir = normalize(sub(next ?? seg.p, prev ?? seg.p))
  seg.hOut = next ? scale(dir, length(sub(next, seg.p)) / 3) : null
  seg.hIn = prev ? scale(dir, -length(sub(seg.p, prev)) / 3) : null
  return { closed: path.closed, segs }
}

/** Remove an anchor. Refuses (returns null) if the shape would collapse. */
export function deleteAnchor(path: EditablePath, index: number): EditablePath | null {
  const min = path.closed ? 3 : 2
  if (path.segs.length - 1 < min) return null
  const segs = cloneSegs(path)
  segs.splice(index, 1)
  return { closed: path.closed, segs }
}

/** Bend curve i so the point at t passes through `target` (from the start state). */
export function bendCurve(start: EditablePath, curveIndex: number, t: number, target: Vec): EditablePath {
  const straight = isCurveStraight(start, curveIndex)
  const base = straight ? straightCubic(curveOf(start, curveIndex)[0], curveOf(start, curveIndex)[3]) : curveOf(start, curveIndex)
  const bent = solveBend(base, t, target)
  const segs = cloneSegs(start)
  const a = segs[curveIndex]
  const bIndex = (curveIndex + 1) % segs.length
  const b = segs[bIndex]
  const wasSmoothA = isSmoothAt(start, curveIndex)
  const wasSmoothB = isSmoothAt(start, bIndex)
  a.hOut = sub(bent[1], a.p)
  b.hIn = sub(bent[2], b.p)
  // Keep smooth anchors smooth: the handle on the far side turns to match.
  if (wasSmoothA && a.hIn && length(a.hOut) > 1e-9) a.hIn = scale(normalize(a.hOut), -length(a.hIn))
  if (wasSmoothB && b.hOut && length(b.hIn) > 1e-9) b.hOut = scale(normalize(b.hIn), -length(b.hOut))
  return { closed: start.closed, segs }
}

/** Make curve i a straight line again. */
export function straightenCurve(path: EditablePath, curveIndex: number): EditablePath {
  const segs = cloneSegs(path)
  segs[curveIndex].hOut = null
  segs[(curveIndex + 1) % segs.length].hIn = null
  return { closed: path.closed, segs }
}

/** Split curve i at t, adding an anchor there. Returns the new anchor's index. */
export function insertPoint(path: EditablePath, curveIndex: number, t: number): { path: EditablePath; index: number } {
  const straight = isCurveStraight(path, curveIndex)
  const segs = cloneSegs(path)
  const aIndex = curveIndex
  const bIndex = (curveIndex + 1) % segs.length
  if (straight) {
    const c = curveOf(path, curveIndex)
    const p = add(c[0], scale(sub(c[3], c[0]), t))
    segs.splice(aIndex + 1, 0, { p, hIn: null, hOut: null })
    return { path: { closed: path.closed, segs }, index: aIndex + 1 }
  }
  const [left, right] = splitCubic(curveOf(path, curveIndex), t)
  segs[aIndex].hOut = sub(left[1], left[0])
  segs[bIndex].hIn = sub(right[2], right[3])
  segs.splice(aIndex + 1, 0, { p: left[3], hIn: sub(left[2], left[3]), hOut: sub(right[1], right[0]) })
  return { path: { closed: path.closed, segs }, index: aIndex + 1 }
}
