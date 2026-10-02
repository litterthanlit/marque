import paper from 'paper'

export type SlabKind = 'square' | 'rounded' | 'circle' | 'tall'
export type PunchShape = 'circle' | 'square' | 'triangle'
export type CarveTool = 'punch' | 'channel' | 'slice'

export interface Vec {
  x: number
  y: number
}

export type CutSpec =
  | { kind: 'punch'; shape: PunchShape; center: Vec; radius: number }
  | { kind: 'channel'; from: Vec; to: Vec; width: number }
  | { kind: 'slice'; from: Vec; to: Vec; width: number }

export const SLAB_KINDS: Array<{ id: SlabKind; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'circle', label: 'Circle' },
  { id: 'tall', label: 'Tall' },
]

export const PUNCH_SHAPES: Array<{ id: PunchShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
]

// Far enough past any artboard that a slice always cuts edge to edge.
const SLICE_REACH = 4000

let carveScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!carveScope) {
    carveScope = new paper.PaperScope()
    carveScope.setup(new paper.Size(1, 1))
  }
  carveScope.activate()
  return carveScope
}

/**
 * Run geometry in the headless scope and hand back plain path data.
 * This activates the headless scope: a caller that draws afterwards must
 * re-activate its own scope first (the canvas renderers already do).
 */
function withScope(build: (scope: paper.PaperScope) => paper.PathItem | null): string {
  const scope = getScope()
  scope.project.clear()
  const pathData = build(scope)?.pathData ?? ''
  scope.project.clear()
  return pathData
}

/** Slab outlines in layer space (centred on 0,0), sized to sit well inside the canvas. */
export function slabPathData(kind: SlabKind): string {
  return withScope((scope) => {
    switch (kind) {
      case 'square':
        return new scope.Path.Rectangle({ point: [-190, -190], size: [380, 380] })
      case 'circle':
        return new scope.Path.Circle({ center: [0, 0], radius: 200 })
      case 'tall':
        return new scope.Path.Rectangle({ point: [-125, -215], size: [250, 430], radius: 125 })
      case 'rounded':
      default:
        return new scope.Path.Rectangle({ point: [-190, -190], size: [380, 380], radius: 90 })
    }
  })
}

function bar(scope: paper.PaperScope, from: Vec, to: Vec, width: number, roundEnds: boolean): paper.PathItem {
  const a = new scope.Point(from.x, from.y)
  const b = new scope.Point(to.x, to.y)
  const r = width / 2
  if (a.getDistance(b) < 0.5) return new scope.Path.Circle({ center: a, radius: r })

  const normal = b.subtract(a).normalize(r).rotate(90, new scope.Point(0, 0))
  const body = new scope.Path({
    segments: [a.add(normal), b.add(normal), b.subtract(normal), a.subtract(normal)],
    closed: true,
  })
  if (!roundEnds) return body

  const withStart = body.unite(new scope.Path.Circle({ center: a, radius: r }))
  return withStart.unite(new scope.Path.Circle({ center: b, radius: r }))
}

export function cutPathData(spec: CutSpec): string {
  return withScope((scope) => {
    if (spec.kind === 'punch') {
      const { center, radius, shape } = spec
      if (shape === 'square') {
        return new scope.Path.Rectangle({
          point: [center.x - radius, center.y - radius],
          size: [radius * 2, radius * 2],
        })
      }
      if (shape === 'triangle') {
        // Circumradius scaled so the triangle reads at the same visual weight as a circle.
        return new scope.Path.RegularPolygon({ center: [center.x, center.y], sides: 3, radius: radius * 1.25 })
      }
      return new scope.Path.Circle({ center: [center.x, center.y], radius })
    }

    if (spec.kind === 'channel') return bar(scope, spec.from, spec.to, spec.width, true)

    const a = new scope.Point(spec.from.x, spec.from.y)
    const b = new scope.Point(spec.to.x, spec.to.y)
    const dir = b.subtract(a).length > 0.5 ? b.subtract(a).normalize(SLICE_REACH) : new scope.Point(SLICE_REACH, 0)
    const start = a.subtract(dir)
    const end = b.add(dir)
    return bar(scope, { x: start.x, y: start.y }, { x: end.x, y: end.y }, spec.width, false)
  })
}

export function cutLayerName(spec: CutSpec): string {
  if (spec.kind === 'punch') return `Punch · ${spec.shape}`
  return spec.kind === 'channel' ? 'Channel' : 'Slice'
}

/** Is a drag big enough to count as a cut? (A click on punch stamps a default size.) */
export function isMeaningfulCut(spec: CutSpec): boolean {
  if (spec.kind === 'punch') return spec.radius >= 4
  return Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y) >= 6
}
