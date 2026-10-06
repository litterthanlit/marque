import paper from 'paper'
import type { Contour, Segment } from './types.ts'

let vectorPathScope: paper.PaperScope | null = null

/**
 * The scope that is active now. Paper keeps it private, but an item made
 * without a parent records the active scope's project, and a project its scope.
 */
function activeScope(): paper.PaperScope | null {
  try {
    const probe = new paper.Path({ insert: false })
    return (probe.project as unknown as { _scope?: paper.PaperScope } | null)?._scope ?? null
  } catch {
    // No scope has a project yet.
    return null
  }
}

/**
 * Run `work` in this module's own scope, then give the caller's scope back.
 * Items made here never land in the canvas, and the canvas stays active.
 */
function inOwnScope<T>(work: (scope: paper.PaperScope) => T): T {
  const previous = activeScope()
  if (!vectorPathScope) {
    vectorPathScope = new paper.PaperScope()
    vectorPathScope.setup(new paper.Size(1, 1))
  }
  const scope = vectorPathScope
  scope.activate()
  scope.project.clear()
  try {
    return work(scope)
  } finally {
    scope.project.clear()
    if (previous && previous !== scope) previous.activate()
  }
}

function toSegment(segment: paper.Segment): Segment {
  return {
    point: { x: segment.point.x, y: segment.point.y },
    handleIn:
      segment.handleIn.length === 0
        ? null
        : { x: segment.handleIn.x, y: segment.handleIn.y },
    handleOut:
      segment.handleOut.length === 0
        ? null
        : { x: segment.handleOut.x, y: segment.handleOut.y },
  }
}

/** Path data as contours, one per subpath, in order. Empty subpaths are left out. */
export function pathDataToContours(pathData: string): Contour[] {
  return inOwnScope((scope) => {
    const item = new scope.CompoundPath(pathData)
    const paths = item.getItems({ class: scope.Path })
    return paths
      .filter((path): path is paper.Path => path instanceof scope.Path)
      .map((path) => ({ closed: path.closed, segments: path.segments.map(toSegment) }))
      .filter((contour) => contour.segments.length > 0)
  })
}

function contourPath(scope: paper.PaperScope, contour: Contour): paper.Path {
  const path = new scope.Path()
  path.closed = contour.closed
  for (const segment of contour.segments) {
    path.add(
      new scope.Segment(
        new scope.Point(segment.point.x, segment.point.y),
        segment.handleIn ? new scope.Point(segment.handleIn.x, segment.handleIn.y) : undefined,
        segment.handleOut ? new scope.Point(segment.handleOut.x, segment.handleOut.y) : undefined,
      ),
    )
  }
  return path
}

export function contourToPathData(contour: Contour): string {
  return inOwnScope((scope) => contourPath(scope, contour).pathData)
}

/** Every contour's path data in turn: one contour reads exactly as `contourToPathData` writes it. */
export function contoursToPathData(contours: readonly Contour[]): string {
  return inOwnScope((scope) => contours.map((contour) => contourPath(scope, contour).pathData).join(''))
}
