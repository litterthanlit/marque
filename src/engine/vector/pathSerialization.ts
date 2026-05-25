import paper from 'paper'
import type { VectorPath, VectorPathSegment } from './types.ts'

let vectorPathScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!vectorPathScope) {
    vectorPathScope = new paper.PaperScope()
    vectorPathScope.setup(new paper.Size(1, 1))
  }
  vectorPathScope.activate()
  return vectorPathScope
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
  const scope = getScope()
  scope.project.clear()

  const item = new scope.CompoundPath(pathData)
  const paths = item.getItems({ class: scope.Path })
  const result = paths
    .filter((path): path is paper.Path => path instanceof scope.Path)
    .map((path) => ({
      id: crypto.randomUUID(),
      closed: path.closed,
      segments: path.segments.map(toSegment),
    }))
    .filter((path) => path.segments.length > 0)

  scope.project.clear()
  return result
}

export function vectorPathToPathData(path: VectorPath): string {
  const scope = getScope()
  scope.project.clear()

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

  const pathData = paperPath.pathData
  scope.project.clear()
  return pathData
}
