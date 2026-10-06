import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { contoursToPathData, contourToPathData, pathDataToContours } from './pathSerialization.ts'

describe('path serialization', () => {
  it('leaves nothing in the scope that was active, and leaves it active', () => {
    const canvas = new paper.PaperScope()
    canvas.setup(new paper.Size(1, 1))
    canvas.activate()

    const [contour] = pathDataToContours('M0,0L10,0L10,10Z')
    expect(contourToPathData(contour)).toBe('M0,0h10v10z')
    expect(canvas.project.activeLayer.children).toHaveLength(0)

    const next = new paper.Path()
    expect(next.project).toBe(canvas.project)
    canvas.project.clear()
  })

  it('splits compound path data into one contour per subpath', () => {
    const contours = pathDataToContours('M0,0h100v100h-100z M25,25h50v50h-50z')
    expect(contours.map((contour) => contour.segments.length)).toEqual([4, 4])
    expect(contours.every((contour) => contour.closed)).toBe(true)
  })

  it('writes several contours as one path data, each as it would be alone', () => {
    const contours = pathDataToContours('M0,0h100v100h-100z M25,25h50v50h-50z')
    expect(contoursToPathData(contours)).toBe(contours.map(contourToPathData).join(''))
    expect(pathDataToContours(contoursToPathData(contours))).toEqual(contours)
  })
})
