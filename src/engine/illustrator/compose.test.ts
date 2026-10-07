import paper from 'paper'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogoStore } from '../../store/logoStore.ts'
import { composeOrderedPaths } from '../boolean/operations.ts'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { createEmptyVectorDocument } from '../vector/document.ts'
import { composeVectorMark, composeVectorMarkCached } from '../vector/export.ts'
import type { Contour, GroupObject, PathObject, VectorDocument, VectorObject } from '../vector/types.ts'
import { vectorDocumentToIllustratorDocument } from '../vector/view.ts'
import { createComposeSession } from './composeSession.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function areaOf(pathData: string): number {
  scope.activate()
  const item = scope.PathItem.create(pathData)
  const area = Math.abs((item as unknown as { area: number }).area)
  scope.project.clear()
  return area
}

/** Is a point inked by the mark, read the way it is drawn: even-odd. */
function inks(pathData: string, x: number, y: number): boolean {
  scope.activate()
  const item = scope.PathItem.create(pathData)
  item.fillRule = 'evenodd'
  const inside = item.contains(new scope.Point(x, y))
  scope.project.clear()
  return inside
}

/**
 * The area two marks do not share, each read even-odd as it is drawn. The
 * two differences are measured apart: summed in one shape they would turn
 * opposite ways and cancel.
 */
function symmetricDifference(a: string, b: string): number {
  scope.activate()
  const x = scope.PathItem.create(a)
  const y = scope.PathItem.create(b)
  x.fillRule = 'evenodd'
  y.fillRule = 'evenodd'
  const inkOf = (item: paper.PathItem) => Math.abs((item as unknown as { area: number }).area)
  const area = inkOf(x.subtract(y)) + inkOf(y.subtract(x))
  scope.project.clear()
  return area
}

const outline = (spec: CarveSpec): Contour => segsToContour(carveOutline(spec).segs)
const circle = (x: number, y: number, r: number): Contour => outline(slabSpec('circle', { x, y }, r / 200))
const box = (x: number, y: number, half: number): Contour => outline({ ...slabSpec('square', { x, y }), width: 2 * half, height: 2 * half })

function path(id: string, contours: Contour[], extra: Partial<PathObject> = {}): PathObject {
  return { id, name: id, parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours, fillRule: 'evenodd', ...extra }
}

function group(id: string, extra: Partial<GroupObject> = {}): GroupObject {
  return { id, name: id, parentId: null, visible: true, locked: false, type: 'group', isolated: true, operation: 'add', ...extra }
}

function doc(objects: VectorObject[]): VectorDocument {
  return { ...createEmptyVectorDocument(), objects }
}

const RING_AREA = Math.PI * (200 ** 2 - 100 ** 2)

describe('holes', () => {
  beforeEach(() => useLogoStore.setState(useLogoStore.getInitialState()))

  it('Subtract on two circles gives one ring of area 94,248, selected', () => {
    const store = useLogoStore.getState()
    store.addSlab('circle')
    store.addSlab('circle')
    const [outer, inner] = useLogoStore.getState().illustrator.layers
    useLogoStore.getState().commitLayerEdits({
      label: 'Resize',
      edits: [
        { layerId: outer.id, carve: slabSpec('circle', { x: 0, y: 0 }) },
        { layerId: inner.id, carve: slabSpec('circle', { x: 0, y: 0 }, 0.5) },
      ],
    })
    useLogoStore.getState().setSelection([outer.id, inner.id])
    useLogoStore.getState().booleanIllustratorLayers('subtract')

    const state = useLogoStore.getState()
    expect(state.vectorDocument.objects).toHaveLength(1)
    const ring = state.vectorDocument.objects[0] as PathObject
    expect(ring.contours).toHaveLength(2)
    expect(state.illustrator.selectedLayerIds).toEqual([ring.id])
    expect(state.illustrator.layers.map((layer) => layer.id)).toEqual([ring.id])

    const mark = composeVectorMarkCached(state.vectorDocument).compoundPathData
    expect(Math.abs(areaOf(mark) - RING_AREA) / RING_AREA).toBeLessThan(0.001)
    expect(inks(mark, 0, 0)).toBe(false)
    expect(inks(mark, 150, 0)).toBe(true)
  })

  it('read the fill rule of a path of several contours, and one contour the same either way', () => {
    // Both contours turn the same way: even-odd leaves a hole, non-zero fills it.
    const ring = [circle(0, 0, 200), circle(0, 0, 100)]
    const evenOdd = composeVectorMark(doc([path('ring', ring)])).compoundPathData
    const nonZero = composeVectorMark(doc([path('ring', ring, { fillRule: 'nonzero' })])).compoundPathData
    expect(Math.abs(areaOf(evenOdd) - RING_AREA) / RING_AREA).toBeLessThan(0.001)
    expect(inks(evenOdd, 0, 0)).toBe(false)
    expect(inks(nonZero, 0, 0)).toBe(true)
    expect(areaOf(nonZero)).toBeCloseTo(areaOf(composeVectorMark(doc([path('disk', [circle(0, 0, 200)])])).compoundPathData), 3)

    // On top of other ink, the hole still holds what is under it, and a later cut still cuts it.
    const stacked = composeVectorMark(doc([path('ring', ring), path('cut', [box(200, 0, 30)], { operation: 'subtract' })])).compoundPathData
    expect(inks(stacked, 0, 0)).toBe(false)
    expect(inks(stacked, 190, 0)).toBe(false)
    expect(inks(stacked, 0, 150)).toBe(true)

    const one = [box(0, 0, 50)]
    expect(composeVectorMark(doc([path('a', one, { fillRule: 'nonzero' })])).compoundPathData).toBe(
      composeVectorMark(doc([path('a', one, { fillRule: 'evenodd' })])).compoundPathData,
    )
  })

  it('leave out pieces smaller than 0.01 square units', () => {
    const square = (x: number, side: number) => `M${x},0h${side}v${side}h${-side}z`
    const result = composeOrderedPaths([
      { pathData: square(0, 100), operation: 'add' },
      { pathData: square(200, 0.05), operation: 'add' },
      { pathData: square(300, 0.2), operation: 'add' },
    ])
    scope.activate()
    const item = scope.PathItem.create(result.compoundPathData)
    expect(item.children).toHaveLength(2)
    scope.project.clear()
  })
})

describe('a self-crossing shape', () => {
  // The two lobes of an hourglass turn opposite ways, so its net signed area is zero.
  const corner = (x: number, y: number) => ({ point: { x, y }, handleIn: null, handleOut: null })
  const hourglass: Contour = { closed: true, segments: [corner(-100, -100), corner(100, -100), corner(-100, 100), corner(100, 100)] }
  /** What 197a104 composed a pen hourglass to. */
  const STAGE_1_MARK = 'M-100,-100h200l-200,200h200z'

  it('composes on its own as stage 1 drew it, not to nothing', () => {
    expect(composeVectorMark(doc([path('hourglass', [hourglass])])).compoundPathData).toBe(STAGE_1_MARK)
  })

  it('composes alone inside an isolated group as stage 1 drew it', () => {
    const mark = composeVectorMark(doc([group('g'), { ...path('hourglass', [hourglass]), parentId: 'g' }])).compoundPathData
    expect(mark).toBe(STAGE_1_MARK)
  })
})

describe('a failed boolean step', () => {
  afterEach(() => vi.restoreAllMocks())

  /** Paper fails the next cut, as it now and then does on awkward curves. */
  const failNextCut = () =>
    vi.spyOn(paper.PathItem.prototype, 'subtract').mockImplementationOnce(() => {
      throw new Error('no intersection found')
    })

  it('leaves the cut out and says so in the mark, in a group too', () => {
    failNextCut()
    const mark = composeVectorMark(doc([path('slab', [box(0, 0, 100)]), path('cut', [box(0, 0, 50)], { operation: 'subtract' })]))
    expect(inks(mark.compoundPathData, 0, 0)).toBe(true)
    expect(mark.warnings).toHaveLength(1)

    failNextCut()
    const grouped = composeVectorMark(
      doc([group('g'), { ...path('slab', [box(0, 0, 100)]), parentId: 'g' }, { ...path('cut', [box(0, 0, 50)], { operation: 'subtract' }), parentId: 'g' }]),
    )
    expect(grouped.warnings).toHaveLength(1)
    expect(composeVectorMark(doc([path('slab', [box(0, 0, 100)])])).warnings).toBeUndefined()
  })

  it('warns on the console once for each mark composed, never as an error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error')
    failNextCut()
    const document = doc([path('slab', [box(0, 0, 100)]), path('cut', [box(0, 0, 50)], { operation: 'subtract' })])
    composeVectorMarkCached(document)
    composeVectorMarkCached(document)
    composeVectorMarkCached({ ...document, objects: [...document.objects] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })
})

describe('isolated groups', () => {
  // Two slabs side by side; a cut wide enough to reach both sits inside a group with the right one.
  const left = path('left', [box(-150, 0, 100)])
  const right = path('right', [box(150, 0, 100)])
  const cut = path('cut', [box(0, 0, 120)], { operation: 'subtract' })

  it('keep their cuts inside the group, and a shared group does not', () => {
    const isolated = composeVectorMark(
      doc([left, group('g'), { ...right, parentId: 'g' }, { ...cut, parentId: 'g' }]),
    ).compoundPathData
    // The cut reaches the member below it, but not the slab outside the group.
    expect(inks(isolated, -150, 0)).toBe(true)
    expect(inks(isolated, 100, 0)).toBe(false)
    expect(inks(isolated, 230, 0)).toBe(true)

    const shared = composeVectorMark(
      doc([left, group('g', { isolated: false }), { ...right, parentId: 'g' }, { ...cut, parentId: 'g' }]),
    ).compoundPathData
    expect(inks(shared, -100, 0)).toBe(false)
    expect(inks(shared, 100, 0)).toBe(false)
  })

  it('enter the stack as one input, with the group operation', () => {
    const big = path('big', [box(0, 0, 250)])
    // The group's own add and cut make a frame; the group then cuts that frame out of what is below.
    const document = doc([
      big,
      group('g', { operation: 'subtract' }),
      { ...path('outer', [box(0, 0, 200)]), parentId: 'g' },
      { ...path('inner', [box(0, 0, 100)], { operation: 'subtract' }), parentId: 'g' },
    ])
    const mark = composeVectorMark(document).compoundPathData
    expect(inks(mark, 0, 0)).toBe(true)
    expect(inks(mark, 150, 0)).toBe(false)
    expect(inks(mark, 230, 0)).toBe(true)
    expect(areaOf(mark)).toBeCloseTo(500 ** 2 - 400 ** 2 + 200 ** 2, 0)
  })

  it("nest: an inner isolated group is one input among its parent group's members", () => {
    const document = doc([
      group('outer'),
      { ...path('base', [box(0, 0, 200)]), parentId: 'outer' },
      { ...group('inner'), parentId: 'outer' },
      { ...path('dot', [box(0, 0, 50)]), parentId: 'inner' },
      { ...path('hole', [box(0, 0, 150)], { operation: 'subtract' }), parentId: 'inner' },
    ])
    // The inner group's cut reaches only its own dot, not the base below the group.
    const mark = composeVectorMark(document).compoundPathData
    expect(inks(mark, 100, 0)).toBe(true)
    expect(inks(mark, 0, 0)).toBe(true)
  })

  it('hide with their group', () => {
    const mark = composeVectorMark(doc([left, group('g', { visible: false }), { ...right, parentId: 'g' }])).compoundPathData
    expect(inks(mark, 150, 0)).toBe(false)
    expect(inks(mark, -150, 0)).toBe(true)
  })

  it('compose live as they would in full when a member is dragged', () => {
    const document = doc([left, group('g'), { ...right, parentId: 'g' }, { ...cut, parentId: 'g' }, path('top', [circle(0, 150, 40)])])
    const view = vectorDocumentToIllustratorDocument(document)
    const moved = path('cut', [box(60, 0, 120)], { operation: 'subtract', parentId: 'g' })
    const session = createComposeSession(view, ['cut'])
    const live = session.compose(new Map([['cut', vectorDocumentToIllustratorDocument(doc([moved])).layers[0].pathData]]))
    const full = composeVectorMark({ ...document, objects: document.objects.map((object) => (object.id === 'cut' ? moved : object)) })
    expect(symmetricDifference(live, full.compoundPathData)).toBeLessThan(0.5)
  })
})
