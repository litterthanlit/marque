import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import { createEmptyVectorDocument, repairStructure } from './document.ts'
import { composeVectorMark } from './export.ts'
import {
  copyGroup,
  enteredGroup,
  gatherIntoGroup,
  groupRefusal,
  groupRefusalText,
  leavesOf,
  objectNumbers,
  parentsOf,
  selectionRoot,
  sparkGroupName,
  ungroupObjects,
  ungroupRefusal,
  ungroupRefusalText,
} from './groups.ts'
import type { Contour, Fillet, GroupObject, Guide, PathObject, VectorObject } from './types.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

/** Is a point inked by the mark, read the way it is drawn: even-odd. */
function inks(pathData: string, x: number, y: number): boolean {
  scope.activate()
  const item = scope.PathItem.create(pathData)
  item.fillRule = 'evenodd'
  const inside = item.contains(new scope.Point(x, y))
  scope.project.clear()
  return inside
}

const outline = (spec: CarveSpec): Contour => segsToContour(carveOutline(spec).segs)
const box = (x: number, y: number, w: number, h = w): Contour => outline({ ...slabSpec('square', { x, y }), width: w, height: h })
const disc = (x: number, y: number, r: number): Contour =>
  outline({ v: 1, kind: 'punch', shape: 'circle', center: { x, y }, radius: r, rotation: 0 })

function path(id: string, contours: Contour[], extra: Partial<PathObject> = {}): PathObject {
  return { id, name: id, parentId: null, visible: true, locked: false, type: 'path', operation: 'add', contours, fillRule: 'evenodd', ...extra }
}

function group(id: string, extra: Partial<GroupObject> = {}): GroupObject {
  return { id, name: id, parentId: null, visible: true, locked: false, type: 'group', isolated: false, operation: 'add', ...extra }
}

const header = (id: string, extra: Partial<GroupObject> = {}): Omit<GroupObject, 'parentId'> => {
  const { parentId: _parentId, ...rest } = group(id, extra)
  return rest
}

const ids = (objects: readonly VectorObject[]) => objects.map((object) => object.id)

describe('what a click selects', () => {
  // outer [ a, inner [ b, c ] ], d
  const objects: VectorObject[] = [
    group('outer'),
    path('a', [box(0, 0, 10)], { parentId: 'outer' }),
    group('inner', { parentId: 'outer' }),
    path('b', [box(0, 0, 10)], { parentId: 'inner' }),
    path('c', [box(0, 0, 10)], { parentId: 'inner' }),
    path('d', [box(0, 0, 10)]),
  ]
  const parents = parentsOf(objects)

  it('is the outermost group around a member, or a layer at the root itself', () => {
    expect(selectionRoot(parents, 'b', null)).toBe('outer')
    expect(selectionRoot(parents, 'a', null)).toBe('outer')
    expect(selectionRoot(parents, 'd', null)).toBe('d')
  })

  it('inside the group the selection has entered, is the piece, or the group within it', () => {
    expect(selectionRoot(parents, 'a', 'outer')).toBe('a')
    expect(selectionRoot(parents, 'b', 'outer')).toBe('inner')
    expect(selectionRoot(parents, 'b', 'inner')).toBe('b')
    // Outside every entered group, a click selects as if none were entered.
    expect(selectionRoot(parents, 'd', 'inner')).toBe('d')
  })

  it('in a group around the entered one, is the piece: the selection is inside that group too', () => {
    expect(selectionRoot(parents, 'a', 'inner')).toBe('a')
  })

  it('reads the entered group from the selection: the innermost group around all of it', () => {
    expect(enteredGroup(parents, [])).toBeNull()
    expect(enteredGroup(parents, ['outer'])).toBeNull()
    expect(enteredGroup(parents, ['b'])).toBe('inner')
    expect(enteredGroup(parents, ['b', 'a'])).toBe('outer')
    expect(enteredGroup(parents, ['inner'])).toBe('outer')
    expect(enteredGroup(parents, ['b', 'd'])).toBeNull()
  })

  it('stands a group in for every layer inside it', () => {
    expect(leavesOf(objects, 'outer')).toEqual(['a', 'b', 'c'])
    expect(leavesOf(objects, 'inner')).toEqual(['b', 'c'])
    expect(leavesOf(objects, 'd')).toEqual(['d'])
  })
})

describe('drawer numbers', () => {
  it('count within each level, from 01 at the bottom, a member after its group and a dot', () => {
    const objects: VectorObject[] = [
      path('a', [box(0, 0, 10)]),
      group('g'),
      path('b', [box(0, 0, 10)], { parentId: 'g' }),
      group('h', { parentId: 'g' }),
      path('c', [box(0, 0, 10)], { parentId: 'h' }),
      path('d', [box(0, 0, 10)]),
    ]
    expect(Object.fromEntries(objectNumbers(objects))).toEqual({ a: '01', g: '02', b: '02.1', h: '02.2', c: '02.2.1', d: '03' })
  })

  it('are places in the stack without groups', () => {
    const objects = ['a', 'b', 'c'].map((id) => path(id, [box(0, 0, 10)]))
    expect([...objectNumbers(objects).values()]).toEqual(['01', '02', '03'])
  })
})

describe('Cmd+G gathering', () => {
  const left = path('left', [box(-100, 0, 100)])
  const right = path('right', [box(100, 0, 100)])

  it('gathers the selection where its topmost member was, the lower ones moved up, in their order', () => {
    const objects = [left, path('x', [box(0, 300, 40)]), right, path('top', [box(0, -300, 40)])]
    const gathered = gatherIntoGroup(objects, ['right', 'left'], header('g'))!
    expect(ids(gathered)).toEqual(['x', 'g', 'left', 'right', 'top'])
    expect(gathered.map((object) => object.parentId)).toEqual([null, null, 'g', 'g', null])
    expect(repairStructure(gathered)).toBe(gathered)
  })

  it('is refused when a cut that overlaps a moved shape lies between them, and names it', () => {
    const cut = path('cut', [disc(-100, 0, 30)], { operation: 'subtract' })
    const objects = [left, cut, right]
    const refusal = groupRefusal(objects, ['left', 'right'])
    expect(refusal).toEqual({ kind: 'between', id: 'cut', operation: 'subtract', group: false })
    expect(groupRefusalText(refusal!, objectNumbers(objects))).toBe('Cut 02 lies between them')
    expect(gatherIntoGroup(objects, ['left', 'right'], header('g'))).toBeNull()
  })

  it('is refused when a moved cut would pass over a shape it overlaps', () => {
    const cut = path('cut', [disc(0, 0, 30)], { operation: 'subtract' })
    const shape = path('shape', [box(0, 0, 40)])
    expect(groupRefusalText(groupRefusal([cut, shape, right], ['cut', 'right'])!, objectNumbers([cut, shape, right]))).toBe('Shape 02 lies between them')
  })

  it('is allowed past what does not overlap, past the same operation, and when nothing lies between', () => {
    const far = path('far', [disc(0, 400, 30)], { operation: 'subtract' })
    expect(groupRefusal([left, far, right], ['left', 'right'])).toBeNull()
    expect(groupRefusal([left, path('mid', [box(0, 0, 300)]), right], ['left', 'right'])).toBeNull()
    expect(groupRefusal([left, right, far], ['left', 'right'])).toBeNull()
    // A cut above the topmost member is not crossed.
    expect(groupRefusal([left, right, path('over', [box(0, 0, 300)], { operation: 'subtract' })], ['left', 'right'])).toBeNull()
  })

  it('counts an isolated group between them as one input with its operation', () => {
    const inside = [group('iso', { isolated: true }), path('a', [box(-100, 0, 60)], { parentId: 'iso' }), path('hole', [disc(-100, 0, 20)], { operation: 'subtract', parentId: 'iso' })]
    expect(groupRefusal([left, ...inside, right], ['left', 'right'])).toBeNull()
    // Shared, its cut stands in the stack on its own, and is in the way.
    const shared = [group('iso'), ...inside.slice(1)]
    expect(groupRefusal([left, ...shared, right], ['left', 'right'])).toMatchObject({ kind: 'between', id: 'hole' })
  })

  it('needs two or more, in the same group', () => {
    expect(groupRefusal([left, right], ['left'])).toEqual({ kind: 'too-few' })
    const objects = [left, group('g'), { ...right, parentId: 'g' }, path('other', [box(0, 0, 10)], { parentId: 'g' })]
    expect(groupRefusal(objects, ['left', 'right'])).toEqual({ kind: 'levels' })
    expect(groupRefusal(objects, ['right', 'other'])).toBeNull()
    // Inside a group, the new group stays in it.
    const gathered = gatherIntoGroup(objects, ['right', 'other'], header('inner'))!
    expect(gathered.find((object) => object.id === 'inner')?.parentId).toBe('g')
    expect(repairStructure(gathered)).toBe(gathered)
  })
})

describe('ungrouping', () => {
  it('takes one level away: members stay where they are, groups inside stay groups', () => {
    const objects: VectorObject[] = [
      path('a', [box(0, 0, 10)]),
      group('g'),
      path('b', [box(0, 0, 10)], { parentId: 'g' }),
      group('h', { parentId: 'g' }),
      path('c', [box(0, 0, 10)], { parentId: 'h' }),
    ]
    const { objects: next, released } = ungroupObjects(objects, ['g'])!
    expect(ids(next)).toEqual(['a', 'b', 'h', 'c'])
    expect(next.map((object) => object.parentId)).toEqual([null, null, null, 'h'])
    expect(released).toEqual(['b', 'h'])
    expect(ungroupObjects(objects, ['a'])).toBeNull()
  })
})

describe('ungrouping, held to the mark', () => {
  const ungroupKeeps = (objects: VectorObject[], id: string) =>
    composeVectorMark({ ...createEmptyVectorDocument(), objects: ungroupObjects(objects, [id])!.objects }).compoundPathData ===
    composeVectorMark({ ...createEmptyVectorDocument(), objects }).compoundPathData

  it('lets a shared group go always: its members already stand in the stack', () => {
    const objects = [path('below', [box(0, 0, 200)]), group('g'), path('a', [box(0, 0, 100)], { parentId: 'g' }), path('cut', [box(0, 0, 50)], { parentId: 'g', operation: 'subtract' })]
    expect(ungroupRefusal(objects, ['g'])).toBeNull()
    expect(ungroupKeeps(objects, 'g')).toBe(true)
  })

  it('refuses an isolated group whose cut would reach a shape below it, and names that shape', () => {
    const objects = [path('below', [box(0, 0, 200)]), group('g', { isolated: true }), path('a', [box(0, 0, 100)], { parentId: 'g' }), path('cut', [box(0, 0, 50)], { parentId: 'g', operation: 'subtract' })]
    expect(ungroupKeeps(objects, 'g')).toBe(false)
    const refusal = ungroupRefusal(objects, ['g'])
    expect(refusal).toEqual({ kind: 'would-cut', group: 'g', id: 'below', isGroup: false })
    expect(ungroupRefusalText(refusal!, objectNumbers(objects))).toBe('Its cuts would reach Shape 01')
  })

  it('lets an isolated group go when its cuts overlap nothing below it', () => {
    const objects = [path('below', [box(400, 0, 100)]), group('g', { isolated: true }), path('a', [box(0, 0, 100)], { parentId: 'g' }), path('cut', [box(0, 0, 50)], { parentId: 'g', operation: 'subtract' })]
    expect(ungroupRefusal(objects, ['g'])).toBeNull()
    expect(ungroupKeeps(objects, 'g')).toBe(true)
  })

  it('refuses an isolated group that cuts as one: its shapes would turn to ink', () => {
    const objects = [path('below', [box(0, 0, 200)]), group('g', { isolated: true, operation: 'subtract' }), path('a', [box(0, 0, 100)], { parentId: 'g' })]
    expect(ungroupKeeps(objects, 'g')).toBe(false)
    expect(ungroupRefusal(objects, ['g'])).toEqual({ kind: 'cuts-as-one', group: 'g' })
  })

  it('keeps a hidden group\'s pieces hidden when it goes, shared or isolated, so the mark stays as it was', () => {
    for (const isolated of [false, true]) {
      const objects = [
        path('below', [box(0, 0, 200)]),
        group('g', { isolated, visible: false }),
        path('a', [box(400, 0, 100)], { parentId: 'g' }),
        path('cut', [box(0, 0, 50)], { parentId: 'g', operation: 'subtract' }),
      ]
      expect(ungroupRefusal(objects, ['g'])).toBeNull()
      const next = ungroupObjects(objects, ['g'])!.objects
      expect(next.map((object) => [object.id, object.visible])).toEqual([['below', true], ['a', false], ['cut', false]])
      expect(ungroupKeeps(objects, 'g')).toBe(true)
    }
  })

  it('hides the pieces of a group inside a hidden group when both go', () => {
    const objects = [group('outer', { visible: false }), group('inner', { parentId: 'outer' }), path('a', [box(0, 0, 100)], { parentId: 'inner' })]
    expect(ungroupObjects(objects, ['outer', 'inner'])!.objects.map((object) => [object.id, object.visible])).toEqual([['a', false]])
    expect(ungroupObjects(objects, ['outer'])!.objects.map((object) => [object.id, object.visible])).toEqual([['inner', false], ['a', true]])
  })

  it('refuses a locked group, whose lock is the only one its pieces have, and says to unlock it', () => {
    const objects = [group('g', { locked: true }), path('a', [box(0, 0, 100)], { parentId: 'g' }), path('b', [box(200, 0, 100)], { parentId: 'g' })]
    const refusal = ungroupRefusal(objects, ['g'])
    expect(refusal).toEqual({ kind: 'locked', group: 'g' })
    expect(ungroupRefusalText(refusal!, objectNumbers(objects))).toBe('Group 01 is locked: unlock it first')
  })

  it('reads what lies below in the stack it composes with: inside an isolated group, only that group', () => {
    // outer keeps its cuts: what lies under outer is out of reach of inner's cut either way.
    const objects = [
      path('below', [box(0, 0, 200)]),
      group('outer', { isolated: true }),
      path('far', [box(400, 0, 100)], { parentId: 'outer' }),
      group('inner', { parentId: 'outer', isolated: true }),
      path('a', [box(0, 0, 100)], { parentId: 'inner' }),
      path('cut', [box(0, 0, 50)], { parentId: 'inner', operation: 'subtract' }),
    ]
    expect(ungroupRefusal(objects, ['inner'])).toBeNull()
    expect(ungroupKeeps(objects, 'inner')).toBe(true)
    // With outer going too, inner's cut would reach the shape below both.
    expect(ungroupRefusal(objects, ['outer', 'inner'])).toMatchObject({ kind: 'would-cut', id: 'below' })
    expect(ungroupRefusal(objects, ['below'])).toEqual({ kind: 'none' })
  })
})

describe('copying a group', () => {
  const circle = (id: string, x: number, extra: Partial<PathObject> = {}) => {
    const carve: CarveSpec = slabSpec('circle', { x, y: 0 }, 0.25)
    return path(id, [outline(carve)], { carve, ...extra })
  }

  it('copies everything in it, moved, and keeps links inside it between the copies', () => {
    const objects: VectorObject[] = [
      path('outside', [box(0, 200, 40)]),
      group('g', { isolated: true, name: 'Group 1' }),
      circle('a', -100, { parentId: 'g' }),
      circle('b', 100, { parentId: 'g' }),
      path('band', [box(0, 0, 10)], { parentId: 'g', link: { kind: 'band', a: 'a', b: 'b' } }),
      path('ring', [box(0, 0, 10)], { parentId: 'g', operation: 'subtract', link: { kind: 'offset', of: 'a', distance: -10 } }),
      path('far', [box(0, 0, 10)], { parentId: 'g', link: { kind: 'offset', of: 'outside', distance: 5 }, name: 'Outset 5' }),
      circle('pinned', 30, { parentId: 'g', pin: { centreOf: 'a' } }),
      circle('held', 60, { parentId: 'g', pin: { centreOf: 'outside' } }),
    ]
    const guides: Guide[] = [
      { id: 'guide', name: 'Top', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: -50 }, angle: 0 }, link: { kind: 'construction', of: 'a', role: 'top' } },
      { id: 'free', name: 'Line', visible: true, locked: false, style: 'solid', shape: { kind: 'line', p: { x: 0, y: 0 }, angle: 90 } },
    ]
    const fillets: Fillet[] = [{ id: 'f', visible: true, radius: 5, at: { x: 0, y: 0 }, between: ['a', 'b'] }]
    const copied = copyGroup({ objects, guides, fillets }, 'g', { x: 12, y: 12 }, () => 'Shape 9')!
    expect(copied.objects.slice(0, objects.length)).toEqual(objects)
    const copies = copied.objects.slice(objects.length)
    expect(copies).toHaveLength(objects.length - 1)
    const [g, a, b, band, ring, far, pinned, held] = copies as [GroupObject, ...PathObject[]]
    expect(g).toMatchObject({ type: 'group', name: 'Group 1 copy', isolated: true, parentId: null })
    expect(g.id).toBe(copied.copyId)
    expect([a, b, band, ring, far, pinned, held].every((object) => object.parentId === g.id)).toBe(true)
    expect(a.carve).toMatchObject({ center: { x: -88, y: 12 } })
    expect(band.link).toEqual({ kind: 'band', a: a.id, b: b.id })
    expect(ring.link).toEqual({ kind: 'offset', of: a.id, distance: -10 })
    expect(pinned.pin).toEqual({ centreOf: a.id })
    // What it followed outside the group is let go: the copy keeps its shape and takes a name of its own.
    expect(far.link).toBeUndefined()
    expect(far.name).toBe('Shape 9')
    expect(held.pin).toBeUndefined()
    expect(copied.guides).toHaveLength(3)
    expect(copied.guides[2]).toMatchObject({ name: 'Top', shape: { kind: 'line', p: { x: 12, y: -38 } }, link: { of: a.id, role: 'top' } })
    expect(copied.fillets[1]).toMatchObject({ at: { x: 12, y: 12 }, between: [a.id, b.id] })
    expect(repairStructure(copied.objects)).toBe(copied.objects)
  })

  it('keeps a band on the construction circles of shapes inside it, between the copied guides', () => {
    const objects: VectorObject[] = [
      group('g'),
      path('p1', [box(-100, 0, 60)], { parentId: 'g' }),
      path('p2', [box(100, 0, 60)], { parentId: 'g' }),
      path('band', [box(0, 0, 10)], { parentId: 'g', link: { kind: 'band', a: 'c1', b: 'c2' } }),
      path('held', [box(0, 50, 10)], { parentId: 'g', pin: { centreOf: 'c1' } }),
    ]
    const ring = (id: string, of: string, x: number): Guide => ({
      id,
      name: id,
      visible: true,
      locked: false,
      style: 'dashed',
      shape: { kind: 'circle', c: { x, y: 0 }, r: 42 },
      link: { kind: 'construction', of, role: 'circumcircle' },
    })
    const copied = copyGroup({ objects, guides: [ring('c1', 'p1', -100), ring('c2', 'p2', 100)], fillets: [] }, 'g', { x: 12, y: 12 }, () => 'Shape')!
    const [, p1, p2, band, held] = copied.objects.slice(objects.length) as [GroupObject, ...PathObject[]]
    const [c1, c2] = copied.guides.slice(2)
    expect(c1).toMatchObject({ shape: { kind: 'circle', c: { x: -88, y: 12 } }, link: { of: p1.id } })
    expect(c2.link).toMatchObject({ of: p2.id })
    expect(band.link).toEqual({ kind: 'band', a: c1.id, b: c2.id })
    expect(held.pin).toEqual({ centreOf: c1.id })
  })

  it('leaves out a copy that waits, empty, on something outside the group', () => {
    const objects: VectorObject[] = [path('src', [box(0, 0, 10)]), group('g'), path('a', [box(0, 0, 10)], { parentId: 'g' }), path('empty', [], { parentId: 'g', link: { kind: 'offset', of: 'src', distance: -50 } })]
    const copied = copyGroup({ objects, guides: [], fillets: [] }, 'g', { x: 12, y: 12 }, () => 'Shape')!
    expect(copied.objects).toHaveLength(objects.length + 2)
  })
})

describe('ref 3, the upper half', () => {
  // In layer units, the sheet's upper half about its middle: two slab halves meeting on the centre line, each
  // cut by its own large circle. The counter is (the left circle ∩ the left half) ∪ (the right circle ∩ the right half).
  const leftHalf = path('left', [box(-86.5, 0, 173, 160)])
  const rightHalf = path('right', [box(87, 0, 174, 160)])
  const leftCut = path('left cut', [disc(20, 115, 173)], { operation: 'subtract' })
  const rightCut = path('right cut', [disc(-19, -94, 174)], { operation: 'subtract' })
  /** The sheet's points (300, 470) and (560, 580), and a point in each counter. */
  const sheet = [
    { x: -124, y: -39 },
    { x: 136, y: 71 },
  ]
  const counter = [
    { x: -44, y: 31 },
    { x: 46, y: -39 },
  ]
  const mark = (objects: VectorObject[]) => composeVectorMark({ ...createEmptyVectorDocument(), objects }).compoundPathData

  it('cannot be drawn in one shared stack: every order cuts one of the sheet points', () => {
    const pieces = [leftHalf, rightHalf, leftCut, rightCut]
    const orders = (rest: VectorObject[]): VectorObject[][] =>
      rest.length <= 1 ? [rest] : rest.flatMap((first, i) => orders(rest.filter((_, j) => j !== i)).map((order) => [first, ...order]))
    expect(orders(pieces)).toHaveLength(24)
    for (const order of orders(pieces)) {
      const drawn = mark(order)
      expect(sheet.every((p) => inks(drawn, p.x, p.y)) && counter.every((p) => !inks(drawn, p.x, p.y))).toBe(false)
    }
  })

  it('keeps both sheet points ink and the counter clear as two isolated groups', () => {
    const drawn = mark([
      group('one', { isolated: true }),
      { ...leftHalf, parentId: 'one' },
      { ...leftCut, parentId: 'one' },
      group('two', { isolated: true }),
      { ...rightHalf, parentId: 'two' },
      { ...rightCut, parentId: 'two' },
    ])
    for (const p of sheet) expect(inks(drawn, p.x, p.y)).toBe(true)
    for (const p of counter) expect(inks(drawn, p.x, p.y)).toBe(false)
  })
})

describe('spark group names', () => {
  it('name the kind of mark a spark was rolled from', () => {
    expect(sparkGroupName('geometric-radial')).toBe('Spark · radial')
    expect(sparkGroupName('wave-arc')).toBe('Spark · wave')
  })
})
