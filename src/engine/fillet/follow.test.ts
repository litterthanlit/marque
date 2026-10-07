import { describe, expect, it } from 'vitest'
import { rotateCarveAbout, translateCarve } from '../carve/edit.ts'
import { slabSpec, type SlabSpec } from '../carve/spec.ts'
import { writeRecipe } from '../../store/objectEdits.ts'
import { composeBaseMark } from '../vector/export.ts'
import { follow, type DocumentLists } from '../vector/follow.ts'
import { decodeLink, encodeLink } from '../vector/link.ts'
import { createSavedVariation, savedDocument } from '../vector/saved.ts'
import { DEFAULT_PARAMS } from '../types.ts'
import { createEmptyVectorDocument } from '../vector/document.ts'
import { distance, type Vec } from '../path/bezier.ts'
import type { Guide, PathObject, VectorObject } from '../vector/types.ts'
import { constructionShape } from '../vector/guides.ts'
import { attributedCorners, markGeometry } from './corners.ts'
import { applyFillets, cornerSources } from './apply.ts'
import { bar, block, circle, fillet, made, recipe } from './testShapes.ts'

/** The lists after moving one object by `d`, with what follows it brought along. */
function moved(before: DocumentLists, id: string, d: Vec): DocumentLists {
  const objects = before.objects.map((object) => (object.id === id && object.type === 'path' ? writeRecipe(object, translateCarve(object.carve!, d)) : object))
  return follow(before, { ...before, objects })
}

/** Ref 2 in small: two circles joined by a bar, and a fillet on each corner where the bar meets the left circle. */
function barAndCircles(): DocumentLists {
  const { objects } = made([circle('a', 0, 0, 100), circle('b', 400, 0, 70), bar('bar', 'a', 'b', 40)])
  const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => corner.p.x < 200)
  return { objects, guides: [], fillets: corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 25)) }
}

/** The lists after an edit of one object's recipe, with what follows it brought along. */
function edited(before: DocumentLists, id: string, edit: (object: PathObject) => PathObject): DocumentLists {
  const objects = before.objects.map((object: VectorObject) => (object.id === id && object.type === 'path' ? edit(object) : object))
  return follow(before, { ...before, objects })
}

/** A slab with sharp corners, 200 by 100, about the middle, with a fillet on each corner: radii 10, 20, 30 and 40. */
function roundedSlab(): DocumentLists {
  const { objects } = made([block('s', { x: 0, y: 0 }, 200, 100)])
  const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
  return { objects, guides: [], fillets: corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 10 + 10 * i)) }
}

const resolved = (lists: DocumentLists) => applyFillets(composeBaseMark(lists.objects), lists.fillets, cornerSources(lists.objects)).fillets!

describe('fillets following their corners', () => {
  it('move with a dragged circle to where the bar now meets it, in the same edit', () => {
    const before = barAndCircles()
    const after = moved(before, 'a', { x: -60, y: 90 })
    expect(after.fillets).not.toBe(before.fillets)
    const now = resolved(after)
    expect(now.every((each) => !each.lost)).toBe(true)
    after.fillets.forEach((each, i) => {
      const corner = now[i]
      if (corner.lost) throw new Error('lost')
      expect(distance(each.at, corner.corner)).toBeLessThan(0.01)
      expect(distance(each.at, before.fillets[i].at)).toBeGreaterThan(50)
    })
  })

  it('stay put, the very same list, when an edit leaves their corners where they were', () => {
    const before = barAndCircles()
    const after = moved(before, 'b', { x: 0, y: 0.001 })
    expect(after.fillets).toBe(before.fillets)
  })

  it('keep their place on their first object while their corner is gone, lost, and take it again when the corner comes back', () => {
    // A bar laid into a circle, rounded where its top edge meets the circle; then pulled clear of the circle and back.
    const { objects } = made([circle('c', 0, 0, 100), block('bar', { x: 150, y: 0 }, 200, 40)])
    const corner = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).find((each) => each.p.y < 0 && !each.convex)!
    const at = { x: Math.round(corner.p.x * 100) / 100, y: Math.round(corner.p.y * 100) / 100 }
    for (const between of [['c', 'bar'], ['bar', 'c']] as const) {
      const lists: DocumentLists = { objects, guides: [], fillets: [fillet('f', at, [...between], 20)] }
      const gone = moved(lists, 'bar', { x: 300, y: 0 })
      // It waits on its first object's outline: where it sat on the circle, or carried along with the bar.
      const waits = between[0] === 'c' ? at : { x: at.x + 300, y: at.y }
      expect(distance(gone.fillets[0].at, waits)).toBeLessThan(0.05)
      expect(resolved(gone)).toEqual([expect.objectContaining({ id: 'f', lost: true, radius: 20 })])
      const back = moved(gone, 'bar', { x: -300, y: 0 })
      expect(distance(back.fillets[0].at, at)).toBeLessThan(0.05)
      expect(resolved(back)[0]).toMatchObject({ lost: false })
      expect(distance((resolved(back)[0] as { corner: Vec }).corner, corner.p)).toBeLessThan(1e-6)
    }
  })

  it('are lost while another shape covers their corner, and round their own corner again, from the same place, once it is uncovered', () => {
    // A small badge beside a large plate, so the mark is wide and a corner's search reaches far; the cover is dragged over a rounded corner and off again.
    for (const over of [block('cover', { x: 600, y: 0 }, 40, 40), circle('cover', 600, 0, 15, 'subtract')]) {
      const { objects } = made([block('plate', { x: -300, y: 0 }, 400, 300), block('s', { x: 300, y: 0 }, 60, 60), over])
      const at = { x: 330, y: -30 }
      const lists: DocumentLists = { objects, guides: [], fillets: [fillet('f', at, ['s', 's'], 10)] }
      const covered = moved(lists, 'cover', { x: -270, y: -30 })
      expect(covered.fillets).toBe(lists.fillets)
      expect(resolved(covered)).toEqual([expect.objectContaining({ id: 'f', lost: true, radius: 10, at })])
      const uncovered = moved(covered, 'cover', { x: 270, y: 30 })
      expect(uncovered.fillets).toBe(lists.fillets)
      expect(resolved(uncovered)[0]).toMatchObject({ lost: false, corner: at })
    }
  })

  it('take their join from a slab\'s straight side onto its rounded corner as a bar slides along it, in steps or in one edit, either object first', () => {
    // A slab 300 by 200 with corners of radius 60, its straight top running from -90 to 90; a bar 30 wide standing on it.
    const objects = made([recipe('slab', { ...slabSpec('square', { x: 0, y: 0 }), width: 300, height: 200, radius: 60 }), block('bar', { x: 40, y: -100 }, 30, 120)]).objects
    const joins = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => corner.between.includes('bar') && Math.abs(corner.p.y + 100) < 1e-6)
    expect(joins.map((corner) => Math.round(corner.p.x))).toEqual(expect.arrayContaining([25, 55]))
    for (const between of [['slab', 'bar'], ['bar', 'slab']] as const) {
      for (const [pick, dir] of [[55, 1], [25, -1]] as const) {
        // Far enough that the join is on the rounded corner: 135 on the right, -95 on the left.
        const far = dir > 0 ? 80 : 120
        for (const step of [5, 20, far]) {
          let lists: DocumentLists = { objects, guides: [], fillets: [fillet('f', { x: pick, y: -100 }, [...between], 10)] }
          for (let gone = 0; gone < far; gone += step) lists = moved(lists, 'bar', { x: step * dir, y: 0 })
          // The fillet rounds the join there: the bar's same edge.
          const now = resolved(lists)[0]
          if (now.lost) throw new Error(`lost, ${between.join(' then ')}, steps of ${step}`)
          expect(now.corner.x).toBeCloseTo(pick + far * dir, 6)
          expect(now.corner.y).toBeGreaterThan(-100)
        }
      }
    }
  })

  it('never hop to another corner of the same two objects while lost, only waiting on their first object', () => {
    // A bar slid along a rounded slab, its left join rounded, until the join falls off the slab's corner and is lost; then on.
    const objects = made([recipe('slab', { ...slabSpec('square', { x: 0, y: 0 }), width: 300, height: 200, radius: 60 }), block('bar', { x: 40, y: -100 }, 30, 120)]).objects
    let lists: DocumentLists = { objects, guides: [], fillets: [fillet('f', { x: 25, y: -100 }, ['slab', 'bar'], 10)] }
    const lefts: number[] = []
    for (let step = 0; step < 19; step++) {
      lists = moved(lists, 'bar', { x: -10, y: 0 })
      const now = resolved(lists)[0]
      // The bar's left edge is at 25 less ten a step; a fillet that rounds a join rounds that one, never the right.
      const left = 25 - 10 * (step + 1)
      if (!now.lost) expect(now.corner.x).toBeCloseTo(left, 6)
      else lefts.push(left)
    }
    // Lost once the left edge is past the slab, and so to the end: the right join, still on the slab, is not taken.
    expect(lefts).toEqual([-155, -165])
  })

  it('keep each to its own join of a plate and a bar when either is slid along its own side, turned or stretched in one edit', () => {
    // A plate 300 by 100 crossed by a bar 30 wide, each of the four joins rounded.
    const { objects } = made([block('s', { x: 0, y: 0 }, 300, 100), block('b', { x: 0, y: 0 }, 30, 300)])
    const joins = [{ x: -15, y: -50 }, { x: 15, y: -50 }, { x: -15, y: 50 }, { x: 15, y: 50 }]
    const edits: Array<[string, string, (object: PathObject) => PathObject]> = [
      ['plate slid 20', 's', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 20, y: 0 }))],
      ['plate slid 120', 's', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 120, y: 0 }))],
      ['bar slid 80', 'b', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 0, y: 80 }))],
      ['plate turned 20°', 's', (object) => writeRecipe(object, rotateCarveAbout(object.carve!, { x: 0, y: 0 }, 20))],
      ['plate widened 100 to the right', 's', (object) => writeRecipe(object, { ...(object.carve as SlabSpec), center: { x: 50, y: 0 }, width: 400 })],
    ]
    for (const between of [['s', 'b'], ['b', 's']] as const) {
      const before: DocumentLists = { objects, guides: [], fillets: joins.map((p, i) => fillet(`f${i}`, p, [...between], 8)) }
      for (const [name, id, edit] of edits) {
        const after = edited(before, id, edit)
        const now = resolved(after)
        // Every join rounded, each by its own fillet: on the same side of the bar and of the plate as before.
        expect(now.every((each) => !each.lost), name).toBe(true)
        const corners = now.map((each) => (each.lost ? null : each.corner))
        expect(new Set(corners.map((p) => `${Math.round(p!.x)},${Math.round(p!.y)}`)).size, name).toBe(4)
        corners.forEach((p, i) => {
          expect(Math.sign(p!.x), name).toBe(Math.sign(joins[i].x))
          expect(Math.sign(p!.y), name).toBe(Math.sign(joins[i].y))
        })
      }
      // Slid 120, the bar's top end leaves the plate: the top joins are gone, and their fillets wait rather than take the bottom joins.
      const off = resolved(edited(before, 'b', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 0, y: 120 }))))
      expect(off.map((each) => each.lost)).toEqual([true, true, false, false])
      off.slice(2).forEach((each, i) => expect(distance((each as { corner: Vec }).corner, joins[2 + i])).toBeLessThan(1e-6))
    }
  })

  it('carry a lost fillet along with its object, so it rounds its corner when the corner shows again', () => {
    // A slab rounded at each corner, one corner hidden under a second slab; the first is moved clear in steps.
    const { objects } = made([block('s', { x: 0, y: 0 }, 200, 100), block('over', { x: 100, y: -50 }, 120, 120)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => corner.between[0] === 's' && corner.between[1] === 's')
    expect(corners).toHaveLength(3)
    const hidden = fillet('hidden', { x: 100, y: -50 }, ['s', 's'], 15)
    let lists: DocumentLists = { objects, guides: [], fillets: [...corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 15)), hidden] }
    expect(resolved(lists).find((each) => each.id === 'hidden')).toMatchObject({ lost: true })
    for (let step = 0; step < 12; step++) lists = moved(lists, 's', { x: -10, y: 0 })
    expect(resolved(lists).every((each) => !each.lost)).toBe(true)
    expect(lists.fillets.find((each) => each.id === 'hidden')!.at).toEqual({ x: -20, y: -50 })
  })

  it('stay on their own corners when a slab is turned 30°, 90° or 180° in one edit, each with its own radius', () => {
    const before = roundedSlab()
    for (const degrees of [30, 90, 180]) {
      const after = edited(before, 's', (object) => writeRecipe(object, rotateCarveAbout(object.carve!, { x: 0, y: 0 }, degrees)))
      const now = resolved(after)
      expect(now.every((each) => !each.lost)).toBe(true)
      const turn = (degrees * Math.PI) / 180
      before.fillets.forEach((each, i) => {
        const want = { x: each.at.x * Math.cos(turn) - each.at.y * Math.sin(turn), y: each.at.x * Math.sin(turn) + each.at.y * Math.cos(turn) }
        expect(distance(after.fillets[i].at, want)).toBeLessThan(0.02)
        expect(after.fillets[i].radius).toBe(each.radius)
      })
    }
  })

  it('are carried once by an edit that also moves a guide a band sits on, which sets the pass going again', () => {
    const slab = roundedSlab()
    const c = circle('c', 400, 0, 50)
    const guide: Guide = { id: 'g', name: 'g', visible: true, locked: false, style: 'dashed', shape: constructionShape(c, 'circumcircle')!, link: { kind: 'construction', of: 'c', role: 'circumcircle' } }
    const band = bar('band', 'g', 'd', 20)
    const start = follow(null, { objects: [...slab.objects, c, circle('d', 600, 0, 40), band], guides: [guide], fillets: [] })
    const before = { ...start, fillets: slab.fillets }
    // One edit turns the slab a quarter and moves the circle, whose guide, and the band on it, follow.
    const objects = before.objects.map((object) => {
      if (object.id === 's') return writeRecipe(object as PathObject, rotateCarveAbout((object as PathObject).carve!, { x: 0, y: 0 }, 90))
      if (object.id === 'c') return writeRecipe(object as PathObject, translateCarve((object as PathObject).carve!, { x: 0, y: 30 }))
      return object
    })
    const after = follow(before, { ...before, objects })
    expect(after.guides[0]).not.toBe(before.guides[0])
    before.fillets.forEach((each, i) => {
      expect(distance(after.fillets[i].at, { x: -each.at.y, y: each.at.x })).toBeLessThan(0.02)
      expect(after.fillets[i].radius).toBe(each.radius)
    })
  })

  it('stay on their own corners when a slab is resized from one corner', () => {
    const before = roundedSlab()
    for (const k of [1.5, 3]) {
      // Held at the top-left corner (−100, −50).
      const after = edited(before, 's', (object) =>
        writeRecipe(object, { ...(object.carve as SlabSpec), center: { x: -100 + 100 * k, y: -50 + 50 * k }, width: 200 * k, height: 100 * k }),
      )
      expect(resolved(after).every((each) => !each.lost)).toBe(true)
      before.fillets.forEach((each, i) => {
        expect(distance(after.fillets[i].at, { x: -100 + (each.at.x + 100) * k, y: -50 + (each.at.y + 50) * k })).toBeLessThan(0.02)
      })
    }
  })

  it('keep each to its own side of a bar end as the bar swings round, however far in one edit', () => {
    const { objects } = made([circle('a', 0, 0, 100), circle('b', 400, 0, 70), bar('bar', 'a', 'b', 40)])
    const ends = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => corner.p.x < 200)
    const before: DocumentLists = { objects, guides: [], fillets: ends.map((corner) => fillet(corner.p.y < 0 ? 'top' : 'bottom', corner.p, corner.between, corner.p.y < 0 ? 10 : 40)) }
    for (const degrees of [22, 30, 90, 150]) {
      const turn = (degrees * Math.PI) / 180
      const after = moved(before, 'b', { x: 400 * Math.cos(turn) - 400, y: 400 * Math.sin(turn) })
      expect(resolved(after).every((each) => !each.lost)).toBe(true)
      // Which side of the bar each is on: the cross product with the bar's way.
      for (const each of after.fillets) {
        const side = Math.cos(turn) * each.at.y - Math.sin(turn) * each.at.x
        expect(side < 0 ? 'top' : 'bottom').toBe(each.id)
      }
    }
  })

  it('leave the very same list when an edit elsewhere, or a rename, leaves their corners where they are stored', () => {
    const { objects } = made([circle('a', 0, 0, 100.37), circle('b', 400, 13.3, 70.71), bar('bar', 'a', 'b', 40), block('far', { x: 0, y: 500 }, 50, 50)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => corner.between.includes('bar'))
    // Stored to a hundredth, as the store and the follow pass keep them.
    const before: DocumentLists = {
      objects,
      guides: [],
      fillets: corners.map((corner, i) => fillet(`f${i}`, { x: Math.round(corner.p.x * 100) / 100, y: Math.round(corner.p.y * 100) / 100 }, corner.between, 20)),
    }
    let lists = before
    for (let i = 0; i < 5; i++) lists = moved(lists, 'far', { x: 1, y: 0 })
    expect(lists.fillets).toBe(before.fillets)
    const renamed = follow(before, { ...before, objects: before.objects.map((object) => (object.id === 'a' ? { ...object, name: 'Hub' } : object)) })
    expect(renamed.fillets).toBe(before.fillets)
  })

  it('go with an object they sit between, in the same edit', () => {
    const before = barAndCircles()
    const after = follow(before, { ...before, objects: before.objects.filter((object) => object.id !== 'bar') })
    expect(after.fillets).toEqual([])
  })

  it('come back from a saved mark as they were kept', () => {
    const lists = barAndCircles()
    const document = { ...createEmptyVectorDocument(), objects: lists.objects, fillets: lists.fillets }
    const opened = savedDocument(createSavedVariation(document, DEFAULT_PARAMS))
    expect(opened?.document.fillets).toEqual(lists.fillets)
  })

  it('open as stored, and come through a link unchanged', () => {
    const lists = barAndCircles()
    const document = { ...createEmptyVectorDocument(), objects: lists.objects, fillets: lists.fillets }
    const opened = decodeLink(encodeLink(document, '#000000'))
    expect(opened.kind).toBe('vector')
    if (opened.kind !== 'vector') return
    expect(opened.document.fillets).toEqual(lists.fillets)
    const objects = opened.document.objects as PathObject[]
    expect(resolved({ objects, guides: [], fillets: opened.document.fillets }).every((each) => !each.lost)).toBe(true)
  })
})
