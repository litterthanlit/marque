import paper from 'paper'
import { carveOutline } from '../carve/outline.ts'
import { roundCarveSpec, slabSpec, type BandSpec, type CarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { follow, type DocumentLists } from '../vector/follow.ts'
import type { Contour, Fillet, PathObject, VectorObject } from '../vector/types.ts'
import type { Vec } from '../path/bezier.ts'

/** Shapes and measures the fillet tests share. Only tests import this. */

export function recipe(id: string, carve: CarveSpec, operation: 'add' | 'subtract' = 'add'): PathObject {
  const rounded = roundCarveSpec(carve)
  return { id, name: id, parentId: null, type: 'path', visible: true, locked: false, operation, fillRule: 'evenodd', contours: [segsToContour(carveOutline(rounded).segs)], carve: rounded }
}

export const circle = (id: string, x: number, y: number, r: number, operation: 'add' | 'subtract' = 'add') =>
  recipe(id, slabSpec('circle', { x, y }, r / 200), operation)

/** A slab with sharp corners, `w` by `h`, turned `rotation` degrees about its centre. */
export function block(id: string, c: Vec, w: number, h: number, rotation = 0, operation: 'add' | 'subtract' = 'add'): PathObject {
  return recipe(id, { ...slabSpec('square', c), width: w, height: h, radius: 0, rotation }, operation)
}

/** A bar band as the Band tool adds it: the follow pass makes its outline from its circles. */
export function bar(id: string, a: string, b: string, width: number): PathObject {
  const carve: BandSpec = { v: 1, kind: 'band', a: { c: { x: 0, y: 0 }, r: 1 }, b: { c: { x: 0, y: 0 }, r: 1 }, fit: 'bar', width }
  return { id, name: 'Band · bar', parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'evenodd', contours: [], carve, link: { kind: 'band', a, b } }
}

/** A free closed path through some points, straight between them. */
export function polyline(id: string, points: Vec[]): PathObject {
  const contour: Contour = { closed: true, segments: points.map((point) => ({ point, handleIn: null, handleOut: null })) }
  return { id, name: id, parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'evenodd', contours: [contour] }
}

/** Objects as an edit leaves them: what follows them made. */
export function made(objects: VectorObject[], fillets: Fillet[] = []): DocumentLists {
  return follow({ objects: [], guides: [], fillets: [] }, { objects, guides: [], fillets })
}

export function fillet(id: string, at: Vec, between: [string, string], radius: number): Fillet {
  return { id, visible: true, radius, at, between }
}

let scope: paper.PaperScope | null = null

/** The area some ink covers by the even-odd rule, and how many separate pieces of ink it has. */
export function measure(pathData: string): { area: number; pieces: number } {
  if (!scope) {
    scope = new paper.PaperScope()
    scope.setup(new paper.Size(1, 1))
  }
  scope.activate()
  scope.project.clear()
  if (!pathData) return { area: 0, pieces: 0 }
  const item = scope.PathItem.create(pathData)
  item.fillRule = 'evenodd'
  const paths = item.children ? (item.children as paper.Path[]) : [item as paper.Path]
  // A piece is a contour whose area counts positive under even-odd: one not inside an odd number of others.
  let pieces = 0
  for (const path of paths) {
    const inside = paths.filter((other) => other !== path && other.contains(path.firstSegment.point)).length
    if (inside % 2 === 0) pieces++
  }
  const area = paths.reduce((sum, path) => {
    const inside = paths.filter((other) => other !== path && other.contains(path.firstSegment.point)).length
    return sum + (inside % 2 === 0 ? 1 : -1) * Math.abs(path.area)
  }, 0)
  scope.project.clear()
  return { area, pieces }
}

/** A seeded stream of numbers in [0, 1), so a failure can be run again. */
export function numbers(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}
