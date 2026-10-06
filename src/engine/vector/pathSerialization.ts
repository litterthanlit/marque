import paper from 'paper'
import type { VectorPath, VectorPathSegment } from './types.ts'

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

function toSegment(segment: paper.Segment): VectorPathSegment {
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
    pointType: segment.handleIn.length > 0 || segment.handleOut.length > 0 ? 'smooth' : 'corner',
  }
}

export function pathDataToVectorPaths(pathData: string): VectorPath[] {
  return inOwnScope((scope) => {
    const item = new scope.CompoundPath(pathData)
    const paths = item.getItems({ class: scope.Path })
    return paths
      .filter((path): path is paper.Path => path instanceof scope.Path)
      .map((path) => ({
        id: crypto.randomUUID(),
        closed: path.closed,
        segments: path.segments.map(toSegment),
      }))
      .filter((path) => path.segments.length > 0)
  })
}

export function vectorPathToPathData(path: VectorPath): string {
  return inOwnScope((scope) => {
    const paperPath = new scope.Path()
    paperPath.closed = path.closed
    for (const segment of path.segments) {
      paperPath.add(
        new scope.Segment(
          new scope.Point(segment.point.x, segment.point.y),
          segment.handleIn ? new scope.Point(segment.handleIn.x, segment.handleIn.y) : undefined,
          segment.handleOut ? new scope.Point(segment.handleOut.x, segment.handleOut.y) : undefined,
        ),
      )
    }

    return paperPath.pathData
  })
}
