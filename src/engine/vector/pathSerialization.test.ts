import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { pathDataToVectorPaths, vectorPathToPathData } from './pathSerialization.ts'

describe('path serialization', () => {
  it('leaves nothing in the scope that was active, and leaves it active', () => {
    const canvas = new paper.PaperScope()
    canvas.setup(new paper.Size(1, 1))
    canvas.activate()

    const [path] = pathDataToVectorPaths('M0,0L10,0L10,10Z')
    expect(vectorPathToPathData(path)).toBe('M0,0h10v10z')
    expect(canvas.project.activeLayer.children).toHaveLength(0)

    const next = new paper.Path()
    expect(next.project).toBe(canvas.project)
    canvas.project.clear()
  })

  it('splits compound path data into one path per subpath', () => {
    const paths = pathDataToVectorPaths('M0,0h100v100h-100z M25,25h50v50h-50z')
    expect(paths.map((path) => path.segments.length)).toEqual([4, 4])
    expect(paths.every((path) => path.closed)).toBe(true)
  })
})
