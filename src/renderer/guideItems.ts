import type { Bounds, Vec } from '../engine/path/bezier.ts'
import { clipLine, type GuideShape, type GuideStyle } from '../engine/vector/guides.ts'
import { canvasPixelRatio } from './viewFit.ts'

/**
 * How guides draw: hairlines in a neutral grey, whose red, green and blue stay
 * equal, lighter than the layers' own lines (#808080) so a guide across a
 * shape never reads as one of its edges. A broken line shows less of itself,
 * so it is a little darker. Dots are round, and wider than a hairline, so they
 * still read on a screen of one pixel to the point. Widths and dashes are CSS pixels.
 */
export const GUIDE_LINE: Record<GuideStyle, { color: string; width: number; dash: number[]; cap: 'butt' | 'round' }> = {
  solid: { color: '#b0b0b0', width: 0.75, dash: [], cap: 'butt' },
  dashed: { color: '#9a9a9a', width: 0.75, dash: [6, 4], cap: 'butt' },
  dotted: { color: '#8c8c8c', width: 1.5, dash: [0.01, 3], cap: 'round' },
}

/** The part of the canvas in view, in layer space, a little larger so a line's ends never show. */
export function visibleLayerRect(scope: paper.PaperScope): Bounds {
  const { left, top, right, bottom } = scope.view.bounds
  const center = scope.view.center
  const margin = Math.max(right - left, bottom - top) * 0.05
  return { minX: left - center.x - margin, minY: top - center.y - margin, maxX: right - center.x + margin, maxY: bottom - center.y + margin }
}

/**
 * A guide's shape as a paper path in project space, not yet in any layer and
 * not yet styled: a line clipped to `rect` (layer space), a circle, or a path.
 * Null when a line misses the view or a shape draws nothing.
 */
export function guidePathItem(scope: paper.PaperScope, shape: GuideShape, center: Vec, rect: Bounds): paper.Path | null {
  const at = (v: Vec) => new scope.Point(v.x + center.x, v.y + center.y)
  switch (shape.kind) {
    case 'line': {
      const ends = clipLine(shape.p, shape.angle, rect)
      return ends ? new scope.Path.Line({ from: at(ends[0]), to: at(ends[1]), insert: false }) : null
    }
    case 'circle':
      return shape.r > 0 ? new scope.Path.Circle({ center: at(shape.c), radius: shape.r, insert: false }) : null
    case 'path': {
      const { segments, closed } = shape.contour
      if (segments.length === 0) return null
      const path = new scope.Path({ insert: false })
      for (const segment of segments) {
        path.add(
          new scope.Segment(
            at(segment.point),
            segment.handleIn ? new scope.Point(segment.handleIn.x, segment.handleIn.y) : undefined,
            segment.handleOut ? new scope.Point(segment.handleOut.x, segment.handleOut.y) : undefined,
          ),
        )
      }
      path.closed = closed
      return path
    }
    default:
      return shape satisfies never
  }
}

/**
 * How wide a guide draws, in CSS pixels: never under one device pixel, so on
 * a screen of one pixel to the point a hairline is not smeared thin across two.
 */
export function guideWidth(style: GuideStyle, pixelRatio = canvasPixelRatio()): number {
  return Math.max(GUIDE_LINE[style].width, 1 / pixelRatio)
}

/**
 * A guide's dashes at another width, as the editor draws a selected guide
 * over it: the pattern grows with the width, so it still reads as the same style.
 */
export function guideDashAt(style: GuideStyle, width: number): { dash: number[]; round: boolean } {
  const line = GUIDE_LINE[style]
  const grow = Math.max(1, width / line.width)
  return { dash: line.dash.map((length) => length * grow), round: line.cap === 'round' }
}

/** Stroke a guide item as guides draw, at `u` layer units per CSS pixel. */
export function styleGuideItem(scope: paper.PaperScope, item: paper.Item, style: GuideStyle, u: number): void {
  const line = GUIDE_LINE[style]
  const width = guideWidth(style)
  item.fillColor = null
  item.strokeColor = new scope.Color(line.color)
  item.strokeWidth = width * u
  item.strokeCap = line.cap
  item.dashArray = line.dash.map((length) => (length * width) / line.width * u)
}
