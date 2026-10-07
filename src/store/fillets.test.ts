import { beforeEach, describe, expect, it } from 'vitest'
import { roundAllCount, roundAllOf, useLogoStore } from './logoStore.ts'
import { polygonSpec, type PolygonSpec, type SlabSpec } from '../engine/carve/spec.ts'
import { composeBaseMark, composeVectorMarkCached } from '../engine/vector/export.ts'
import { attributedCorners, cornerKind, inkGeometry, markGeometry } from '../engine/fillet/corners.ts'
import { applyFillets, cornerSources, freeCorners } from '../engine/fillet/apply.ts'
import { rollSparks } from '../engine/sparks/sparks.ts'

function reset() {
  const initial = useLogoStore.getInitialState()
  useLogoStore.setState({ ...initial, ui: { ...initial.ui, viewport: { width: 600, height: 600 } } })
}

const state = () => useLogoStore.getState()
const undoDepth = () => state().vectorUndoStack.length

/** A slab with sharp corners, 200 by 100, about the middle; returns its id. */
function block(): string {
  state().addSlab('square')
  const layer = state().illustrator.layers.at(-1)!
  state().commitLayerEdits({ label: 'Place', edits: [{ layerId: layer.id, carve: { ...(layer.carve as SlabSpec), center: { x: 0, y: 0 }, width: 200, height: 100, radius: 0 } }], select: [] })
  return layer.id
}

/** Ref 1: a hexagon ring and a triangle across it; the corners where the triangle meets the ring's hole. */
function ref1() {
  state().setCarveSettings({ polygonSides: 6 })
  state().addSlab('polygon')
  const hexagon = state().illustrator.layers.at(-1)!
  state().commitLayerEdits({ label: 'x', edits: [{ layerId: hexagon.id, carve: { ...(hexagon.carve as PolygonSpec), center: { x: 0, y: 0 }, radius: 250, cornerRadius: 60 } }], select: [] })
  state().addOffset(hexagon.id, -55, true)
  state().addSlab('polygon')
  const triangle = state().illustrator.layers.at(-1)!
  state().commitLayerEdits({ label: 'x', edits: [{ layerId: triangle.id, carve: { ...polygonSpec({ x: 0, y: 0 }, 250, 3), rotation: 180 } }], select: [] })
  const { objects } = state().vectorDocument
  return attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => cornerKind(corner) === 'cut polygon · polygon')
}

describe('fillets in the store', () => {
  beforeEach(() => reset())

  it('adds a fillet as one undo step, selected, and the mark rounds its corner without composing the base again', () => {
    const slab = block()
    const base = composeBaseMark(state().vectorDocument.objects)
    const depth = undoDepth()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20.4)
    expect(undoDepth()).toBe(depth + 1)
    const [fillet] = state().vectorDocument.fillets
    expect(fillet).toMatchObject({ radius: 20, between: [slab, slab], visible: true })
    expect(state().illustrator.selectedFilletIds).toEqual([fillet.id])
    expect(state().illustrator.selectedLayerIds).toEqual([])
    expect(state().ui.round.last).toBe(20)
    expect(composeBaseMark(state().vectorDocument.objects)).toBe(base)
    expect(composeVectorMarkCached(state().vectorDocument).fillets).toEqual([expect.objectContaining({ id: fillet.id, lost: false, used: 20 })])
    state().undoVectorCommand()
    expect(state().vectorDocument.fillets).toEqual([])
    expect(state().illustrator.selectedFilletIds).toEqual([])
  })

  it('clamps a fillet added beside another on one short edge to stop where the other touches it, saying a neighbour cut it down', () => {
    // A slab 30 high: each end's two corners share the 30 of the end between them.
    state().addSlab('square')
    const layer = state().illustrator.layers.at(-1)!
    state().commitLayerEdits({ label: 'Place', edits: [{ layerId: layer.id, carve: { ...(layer.carve as SlabSpec), center: { x: 0, y: 0 }, width: 200, height: 30, radius: 0 } }], select: [] })
    state().addFillet({ x: 100, y: -15 }, [layer.id, layer.id], 20)
    state().addFillet({ x: 100, y: 15 }, [layer.id, layer.id], 20)
    const [first, second] = composeVectorMarkCached(state().vectorDocument).fillets!.flatMap((each) => (each.lost ? [] : [each]))
    expect(first).toMatchObject({ used: 20 })
    expect(first).not.toHaveProperty('byNeighbour')
    expect(second).toMatchObject({ byNeighbour: true })
    expect(Math.abs(second.used - 10)).toBeLessThan(0.01)
    // With its neighbour gone, it takes the radius asked.
    state().deleteFillets([state().vectorDocument.fillets[0].id])
    expect(composeVectorMarkCached(state().vectorDocument).fillets).toEqual([expect.objectContaining({ lost: false, used: 20 })])
  })

  it('loses a fillet while another shape covers its corner, never moving it to another corner, and rounds its own corner again once uncovered', () => {
    // A small badge beside a large plate: once a corner's search reached across the badge.
    const slab = (x: number, y: number, w: number, h: number) => {
      state().addSlab('square')
      const layer = state().illustrator.layers.at(-1)!
      state().commitLayerEdits({ label: 'Place', edits: [{ layerId: layer.id, carve: { ...(layer.carve as SlabSpec), center: { x, y }, width: w, height: h, radius: 0, rotation: 0 } }], select: [] })
      return layer.id
    }
    slab(-300, 0, 400, 300)
    const badge = slab(300, 0, 60, 60)
    const cover = slab(600, 0, 40, 40)
    state().addFillet({ x: 330, y: -30 }, [badge, badge], 10)
    const move = (dx: number, dy: number) => {
      const layer = state().illustrator.layers.find((each) => each.id === cover)!
      const c = layer.carve as SlabSpec
      state().commitLayerEdits({ label: 'Move', edits: [{ layerId: cover, carve: { ...c, center: { x: c.center.x + dx, y: c.center.y + dy } } }], select: [cover] })
    }
    const now = () => composeVectorMarkCached(state().vectorDocument).fillets![0]
    move(-270, -30)
    expect(state().vectorDocument.fillets[0].at).toEqual({ x: 330, y: -30 })
    expect(now()).toMatchObject({ lost: true })
    move(270, 30)
    expect(state().vectorDocument.fillets[0].at).toEqual({ x: 330, y: -30 })
    expect(now()).toMatchObject({ lost: false, corner: { x: 330, y: -30 } })
  })

  it('sets a radius in whole units from 2 to 200, a burst of slider keys one undo step', () => {
    const slab = block()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    const id = state().vectorDocument.fillets[0].id
    const depth = undoDepth()
    state().setFilletRadius(id, 21, 'fillet-radius')
    state().setFilletRadius(id, 22, 'fillet-radius')
    expect(undoDepth()).toBe(depth + 1)
    state().setFilletRadius(id, 500)
    expect(state().vectorDocument.fillets[0].radius).toBe(200)
    state().setFilletRadius(id, 0.4)
    expect(state().vectorDocument.fillets[0].radius).toBe(2)
  })

  it('sets one radius for several fillets in one undo step, a burst of slider keys one step', () => {
    const holes = ref1()
    state().addFillet(holes[0].p, holes[0].between, 5)
    state().roundAllLike(state().vectorDocument.fillets[0].id)
    const ids = state().illustrator.selectedFilletIds ?? []
    expect(ids).toHaveLength(6)
    const depth = undoDepth()
    state().setFilletsRadius(ids, 7, 'fillet-radius')
    state().setFilletsRadius(ids, 8, 'fillet-radius')
    expect(undoDepth()).toBe(depth + 1)
    expect(state().vectorDocument.fillets.map((fillet) => fillet.radius)).toEqual([8, 8, 8, 8, 8, 8])
    state().undoVectorCommand()
    expect(state().vectorDocument.fillets.map((fillet) => fillet.radius)).toEqual([5, 5, 5, 5, 5, 5])
  })

  it('copies the fillets on a layer\'s own corners with the layer, in the same undo step, rounding the copy when it moves clear', () => {
    const slab = block()
    const corners = attributedCorners(markGeometry(composeBaseMark(state().vectorDocument.objects)), cornerSources(state().vectorDocument.objects))
    for (const corner of corners) state().addFillet(corner.p, corner.between, 20)
    const depth = undoDepth()
    state().duplicateIllustratorLayer(slab)
    expect(undoDepth()).toBe(depth + 1)
    const copy = state().illustrator.selectedLayerIds[0]
    expect(copy).not.toBe(slab)
    const fillets = state().vectorDocument.fillets
    expect(fillets).toHaveLength(8)
    const copied = fillets.filter((fillet) => fillet.between[0] === copy && fillet.between[1] === copy)
    expect(copied).toHaveLength(4)
    expect(copied.every((fillet) => fillet.radius === 20)).toBe(true)
    // Moved clear of the original, the copy has all four corners rounded.
    const layer = state().illustrator.layers.find((each) => each.id === copy)!
    state().commitLayerEdits({ label: 'Move', edits: [{ layerId: copy, carve: { ...(layer.carve as SlabSpec), center: { x: 400, y: 0 } } }], select: [] })
    const mark = composeVectorMarkCached(state().vectorDocument)
    expect(mark.fillets!.filter((each) => !each.lost)).toHaveLength(8)
    state().undoVectorCommand()
    state().undoVectorCommand()
    expect(state().vectorDocument.fillets).toHaveLength(4)
  })

  it('keeps a copy\'s fillet lost under the original with the copy as it is nudged clear in steps, so all eight corners round', () => {
    const slab = block()
    const corners = attributedCorners(markGeometry(composeBaseMark(state().vectorDocument.objects)), cornerSources(state().vectorDocument.objects))
    for (const corner of corners) state().addFillet(corner.p, corner.between, 15)
    state().duplicateIllustratorLayer(slab)
    const copy = state().illustrator.selectedLayerIds[0]
    // The copy lies over the original: one of its corners is inside it, and one of the original's inside the copy.
    expect(composeVectorMarkCached(state().vectorDocument).fillets!.filter((each) => each.lost).length).toBeGreaterThan(0)
    for (let step = 0; step < 22; step++) {
      const layer = state().illustrator.layers.find((each) => each.id === copy)!
      const carve = layer.carve as SlabSpec
      state().commitLayerEdits({ label: 'Nudge', edits: [{ layerId: copy, carve: { ...carve, center: { x: carve.center.x + 10, y: carve.center.y } } }], select: [copy] })
    }
    const mark = composeVectorMarkCached(state().vectorDocument)
    expect(mark.fillets).toHaveLength(8)
    expect(mark.fillets!.every((each) => !each.lost)).toBe(true)
  })

  it('removes a fillet with an object it sits between, in the same undo step, and undo brings both', () => {
    const slab = block()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    const depth = undoDepth()
    state().deleteIllustratorLayers([slab])
    expect(undoDepth()).toBe(depth + 1)
    expect(state().vectorDocument.fillets).toEqual([])
    state().undoVectorCommand()
    expect(state().vectorDocument.fillets).toHaveLength(1)
    expect(state().vectorDocument.objects).toHaveLength(1)
  })

  it('deletes the selected fillets, and hides one, each one undo step', () => {
    const slab = block()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    state().addFillet({ x: -100, y: 50 }, [slab, slab], 10)
    const [first, second] = state().vectorDocument.fillets
    state().toggleFilletVisibility(first.id)
    expect(composeVectorMarkCached(state().vectorDocument).fillets?.map((fillet) => fillet.id)).toEqual([second.id])
    state().selectFillets([first.id, second.id])
    const depth = undoDepth()
    state().deleteFillets()
    expect(undoDepth()).toBe(depth + 1)
    expect(state().vectorDocument.fillets).toEqual([])
  })

  it('lets go of the selected fillets in the final look, which draws none', () => {
    const slab = block()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    state().toggleLook()
    expect(state().illustrator.selectedFilletIds).toEqual([])
  })

  it('selects no fillet back in the final look when an undo brings it', () => {
    const slab = block()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    state().deleteFillets()
    state().toggleLook()
    state().undoVectorCommand()
    expect(state().vectorDocument.fillets).toHaveLength(1)
    expect(state().illustrator.selectedFilletIds).toEqual([])
    expect(state().selection.targets).toEqual([])
  })

  it('puts the Round tool down in the final look, and selects no fillet added there', () => {
    const slab = block()
    state().setActiveTool('round')
    state().toggleLook()
    expect(state().ui.look).toBe('final')
    expect(state().ui.activeTool).toBeNull()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    expect(state().vectorDocument.fillets).toHaveLength(1)
    expect(state().illustrator.selectedFilletIds).toEqual([])
  })

  it('rounds all the corners like one in one undo step, and counts them first', () => {
    const holes = ref1()
    expect(holes).toHaveLength(6)
    state().addFillet(holes[0].p, holes[0].between, 5)
    const id = state().vectorDocument.fillets[0].id
    expect(roundAllCount(state(), id)).toBe(5)
    const depth = undoDepth()
    state().roundAllLike(id)
    expect(undoDepth()).toBe(depth + 1)
    expect(state().vectorDocument.fillets.map((fillet) => fillet.radius)).toEqual([5, 5, 5, 5, 5, 5])
    expect(state().illustrator.selectedFilletIds).toHaveLength(6)
    expect(roundAllCount(state(), id)).toBe(0)
    expect(composeVectorMarkCached(state().vectorDocument).fillets?.every((fillet) => !fillet.lost)).toBe(true)
  })

  it('rounds the joins of ref 2\'s bars and circles like one of them, though they turn a few degrees apart, skipping one whose fillet would overlap a neighbour\'s', () => {
    const circle = (x: number, y: number, r: number) => {
      state().addSlab('circle')
      const layer = state().illustrator.layers.at(-1)!
      state().commitLayerEdits({ label: 'Place', edits: [{ layerId: layer.id, carve: { ...(layer.carve as SlabSpec), center: { x, y }, width: 2 * r, height: 2 * r, radius: r } }], select: [] })
      return layer.id
    }
    const a = circle(-170, -130, 73)
    const b = circle(135, -110, 91)
    const c = circle(0, 110, 110)
    state().setBandSettings({ fit: 'bar', width: 40 })
    state().addBand(a, b)
    state().setBandSettings({ width: 36 })
    state().addBand(a, c)
    state().setBandSettings({ fit: 'neck', radius: 38 })
    state().addBand(b, c)
    const { objects } = state().vectorDocument
    const joins = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => cornerKind(corner) === 'band · circle')
    expect(joins).toHaveLength(8)
    const turns = joins.map((corner) => (corner.turn * 180) / Math.PI)
    expect(Math.max(...turns) - Math.min(...turns)).toBeGreaterThan(5)
    state().addFillet(joins[0].p, joins[0].between, 25)
    const [first] = state().vectorDocument.fillets
    // Two joins face each other across circle a's short stretch between the bars: at r 25 their fillets would overlap, so one is skipped.
    expect(roundAllOf(state(), first.id)).toEqual({ count: 6, skipped: 1 })
    expect(roundAllCount(state(), first.id)).toBe(6)
    const depth = undoDepth()
    state().roundAllLike(first.id)
    expect(undoDepth()).toBe(depth + 1)
    expect(state().vectorDocument.fillets).toHaveLength(7)
    expect(roundAllCount(state(), first.id)).toBe(0)
    const mark = composeVectorMarkCached(state().vectorDocument)
    expect(mark.fillets!.every((each) => !each.lost && !each.byNeighbour && each.used === 25)).toBe(true)
    expect(mark.warnings).toBeUndefined()
    // No two fillets cross: no corner where two of their arcs meet.
    const circles = mark.fillets!.flatMap((each) => (each.lost ? [] : [each]))
    const onTwo = inkGeometry(mark.compoundPathData).corners.filter(
      (corner) => circles.filter((each) => Math.abs(Math.hypot(corner.p.x - each.centre.x, corner.p.y - each.centre.y) - each.used) < 0.5).length >= 2,
    )
    expect(onTwo).toEqual([])
  })

  it('rounds any one corner of the sparks of seeds 1 to 14 at r 4 or r 12 without a new contour or a warning', () => {
    let trials = 0
    const failures: string[] = []
    for (let seed = 1; seed <= 14; seed++) {
      const sparks = rollSparks(8, seed)
      sparks.forEach((spark, k) => {
        reset()
        state().dropSpark(spark)
        const { objects } = state().vectorDocument
        const base = composeBaseMark(objects)
        const contours = (pathData: string) => (pathData.match(/M/gi) ?? []).length
        const sources = cornerSources(objects)
        for (const radius of [4, 12]) {
          for (const corner of freeCorners(base, [], sources)) {
            const mark = applyFillets(base, [{ id: 'f', visible: true, radius, at: corner.p, between: corner.between }], sources)
            trials++
            if (contours(mark.compoundPathData) !== contours(base.compoundPathData) || (mark.warnings?.length ?? 0) > (base.warnings?.length ?? 0)) {
              failures.push(`seed ${seed} spark ${k} r ${radius} at ${corner.p.x.toFixed(2)}, ${corner.p.y.toFixed(2)}`)
            }
          }
        }
      })
    }
    expect(trials).toBeGreaterThan(2000)
    expect(failures).toEqual([])
  }, 30_000)

  it('leaves a corner with a hidden fillet on it to that fillet when rounding all like another', () => {
    const slab = block()
    state().addFillet({ x: 100, y: -50 }, [slab, slab], 20)
    state().addFillet({ x: -100, y: -50 }, [slab, slab], 20)
    const [first, hidden] = state().vectorDocument.fillets
    state().toggleFilletVisibility(hidden.id)
    expect(roundAllCount(state(), first.id)).toBe(2)
    state().roundAllLike(first.id)
    const places = state().vectorDocument.fillets.map((fillet) => `${fillet.at.x},${fillet.at.y}`)
    expect(places.filter((place) => place === '-100,-50')).toHaveLength(1)
    state().toggleFilletVisibility(hidden.id)
    expect(composeVectorMarkCached(state().vectorDocument).fillets?.every((fillet) => !fillet.lost)).toBe(true)
  })

  it('makes the Round tool show the sheet, where fillets draw', () => {
    state().toggleLook()
    expect(state().ui.look).toBe('final')
    state().setActiveTool('round')
    expect(state().ui.look).toBe('construction')
  })
})
