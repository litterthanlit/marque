import { describe, expect, it } from 'vitest'
import { rotateCarveAbout, translateCarve } from '../carve/edit.ts'
import { carveOutline } from '../carve/outline.ts'
import type { BandSpec, CarveSpec } from '../carve/spec.ts'
import { asCircle } from '../geometry/asCircle.ts'
import { createComposeSession } from '../illustrator/composeSession.ts'
import { bandBetween } from '../vector/bands.ts'
import { composeBaseMark, composeVectorMarkCached } from '../vector/export.ts'
import { createEmptyVectorDocument } from '../vector/document.ts'
import { vectorDocumentToIllustratorDocument } from '../vector/view.ts'
import { distance } from '../path/bezier.ts'
import { writeRecipe } from '../../store/objectEdits.ts'
import { follow } from '../vector/follow.ts'
import type { PathObject, VectorDocument } from '../vector/types.ts'
import { attributedCorners, markGeometry } from './corners.ts'
import { applyFillets, cornerSources } from './apply.ts'
import { bar, block, circle, fillet, made, measure } from './testShapes.ts'

/** Ref 2: three circles of different sizes joined by bars, rounded where three of the bars' ends meet their circles. */
function ref2(): VectorDocument {
  const { objects } = made([
    circle('a', -170, -130, 73),
    circle('b', 135, -110, 91),
    circle('c', 0, 110, 110),
    bar('ab', 'a', 'b', 40),
    bar('ac', 'a', 'c', 36),
    bar('bc', 'b', 'c', 44),
  ])
  const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
  // Both sides of three bar ends: six fillets.
  const ends = corners.filter((corner) => corner.between.includes('a') || (corner.between.includes('bc') && corner.between.includes('c')))
  expect(ends).toHaveLength(6)
  return { ...createEmptyVectorDocument(), objects, fillets: ends.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 25)) }
}

describe('a live drag with fillets', () => {
  it('rounds every frame as the commit will, keeping the mark one piece, fast enough to follow the pointer', () => {
    const document = ref2()
    const view = vectorDocumentToIllustratorDocument(document)
    const session = createComposeSession(view, ['a', 'ab', 'ac'])
    const a = document.objects.find((object) => object.id === 'a') as PathObject
    const bandOf = (id: string) => document.objects.find((object) => object.id === id) as PathObject
    const frames: number[] = []
    let last = ''
    for (let i = 1; i <= 30; i++) {
      const d = { x: -i, y: i * 1.5 }
      const moved = translateCarve(a.carve!, d)
      const circleA = asCircle({ carve: moved, contours: [] })!
      const circleB = asCircle(document.objects.find((object) => object.id === 'b') as PathObject)!
      const circleC = asCircle(document.objects.find((object) => object.id === 'c') as PathObject)!
      const ab = bandBetween(bandOf('ab').carve as BandSpec, circleA, circleB)
      const ac = bandBetween(bandOf('ac').carve as BandSpec, circleA, circleC)
      const carves = new Map<string, CarveSpec>([['a', moved], ['ab', ab], ['ac', ac]])
      const replacements = new Map([...carves].map(([id, spec]) => [id, carveOutline(spec).pathData] as const))
      const start = performance.now()
      last = session.compose(replacements, carves)
      frames.push(performance.now() - start)
      expect(session.fillets?.every((each) => !each.lost)).toBe(true)
      expect(measure(last).pieces).toBe(1)
    }
    const sorted = [...frames].slice(5).sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.info(`ref 2 drag with 6 fillets: median ${median.toFixed(1)} ms a frame, slowest ${sorted.at(-1)!.toFixed(1)} ms`)
    expect(median).toBeLessThan(40)
    // The commit makes the same mark the last frame showed.
    const objects = document.objects.map((object) => (object.id === 'a' ? writeRecipe(object as PathObject, translateCarve(a.carve!, { x: -30, y: 45 })) : object))
    const committed = follow({ objects: document.objects, guides: [], fillets: document.fillets }, { objects, guides: [], fillets: document.fillets })
    const mark = composeVectorMarkCached({ ...document, ...committed })
    expect(mark.warnings).toBeUndefined()
    expect(Math.abs(measure(mark.compoundPathData).area - measure(last).area)).toBeLessThan(2)
  })

  it('keeps a fillet whose objects the drag leaves alone on its own corner: lost while another shape passes over it, back once it has passed', () => {
    const objects = made([block('plate', { x: -300, y: 0 }, 400, 300), block('s', { x: 300, y: 0 }, 60, 60), block('cover', { x: 600, y: 0 }, 40, 40)]).objects
    const at = { x: 330, y: -30 }
    const document = { ...createEmptyVectorDocument(), objects, fillets: [fillet('f', at, ['s', 's'], 10)] }
    const session = createComposeSession(vectorDocumentToIllustratorDocument(document), ['cover'])
    const cover = objects.find((object) => object.id === 'cover') as PathObject
    const seen: string[] = []
    for (let k = 0; k <= 12; k++) {
      // From where it is onto the rounded corner, then off it upwards.
      const to = k <= 6 ? { x: 600 - (270 * k) / 6, y: (-30 * k) / 6 } : { x: 330, y: -30 - ((k - 6) * 100) / 6 }
      const spec = translateCarve(cover.carve!, { x: to.x - 600, y: to.y })
      session.compose(new Map([['cover', carveOutline(spec).pathData]]), new Map([['cover', spec]]))
      const fillet = session.fillets![0]
      seen.push(fillet.lost ? 'lost' : distance(fillet.corner, at) < 1e-6 ? 'own' : 'other')
    }
    expect(seen).not.toContain('other')
    expect(seen.slice(6, 8)).toEqual(['lost', 'lost'])
    expect(seen.at(-1)).toBe('own')
  })

  it('keeps each fillet on its own corner through a live turn of a slab, as the commit does', () => {
    const { objects } = made([block('s', { x: 0, y: 0 }, 200, 100)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    const fillets = corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 10 + 10 * i))
    const document = { ...createEmptyVectorDocument(), objects, fillets }
    const session = createComposeSession(vectorDocumentToIllustratorDocument(document), ['s'])
    const slab = objects[0] as PathObject
    const turned = (degrees: number) => rotateCarveAbout(slab.carve!, { x: 0, y: 0 }, degrees)
    /** Where a fillet's corner should be after a turn. */
    const carried = (at: { x: number; y: number }, degrees: number) => {
      const t = (degrees * Math.PI) / 180
      return { x: at.x * Math.cos(t) - at.y * Math.sin(t), y: at.x * Math.sin(t) + at.y * Math.cos(t) }
    }
    for (let degrees = 3; degrees <= 180; degrees += 3) {
      session.compose(new Map([['s', carveOutline(turned(degrees)).pathData]]), new Map([['s', turned(degrees)]]))
      session.fillets!.forEach((each, i) => {
        if (each.lost) throw new Error(`${each.id} lost at ${degrees}°`)
        expect(distance(each.corner, carried(fillets[i].at, degrees))).toBeLessThan(0.01)
      })
    }
    const committed = follow({ objects, guides: [], fillets }, { objects: [writeRecipe(slab, turned(180))], guides: [], fillets })
    const now = applyFillets(composeBaseMark(committed.objects), committed.fillets, cornerSources(committed.objects)).fillets!
    now.forEach((each, i) => {
      if (each.lost) throw new Error(`${each.id} lost on commit`)
      expect(distance(each.corner, carried(fillets[i].at, 180))).toBeLessThan(0.01)
    })
  })

  it('keeps each fillet on its own corner through a live turn in steps of 15° or 45°, as Shift turns, however large the slab', () => {
    for (const [size, step] of [[300, 15], [300, 45], [1000, 15], [200, 30]] as const) {
      const { objects } = made([block('s', { x: 0, y: 0 }, size, size * 0.8)])
      const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
      const fillets = corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 10 + 6 * i))
      const session = createComposeSession(vectorDocumentToIllustratorDocument({ ...createEmptyVectorDocument(), objects, fillets }), ['s'])
      const slab = objects[0] as PathObject
      for (let degrees = step; degrees <= 180; degrees += step) {
        const turned = rotateCarveAbout(slab.carve!, { x: 0, y: 0 }, degrees)
        session.compose(new Map([['s', carveOutline(turned).pathData]]), new Map([['s', turned]]))
        const t = (degrees * Math.PI) / 180
        session.fillets!.forEach((each, i) => {
          if (each.lost) throw new Error(`${each.id} lost at ${degrees}° on a ${size} slab`)
          const at = fillets[i].at
          expect(distance(each.corner, { x: at.x * Math.cos(t) - at.y * Math.sin(t), y: at.x * Math.sin(t) + at.y * Math.cos(t) })).toBeLessThan(0.01)
        })
      }
    }
  })

  it('keeps fillets on a dragged slab through one fast frame, and on the slow frames after it', () => {
    const { objects } = made([block('s', { x: 0, y: 0 }, 120, 80)])
    const corners = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects))
    const fillets = corners.map((corner, i) => fillet(`f${i}`, corner.p, corner.between, 8))
    const session = createComposeSession(vectorDocumentToIllustratorDocument({ ...createEmptyVectorDocument(), objects, fillets }), ['s'])
    const slab = objects[0] as PathObject
    for (const x of [2, 4, 6, 36, 38, 40, 42, 44, 46]) {
      const moved = translateCarve(slab.carve!, { x, y: 0 })
      session.compose(new Map([['s', carveOutline(moved).pathData]]), new Map([['s', moved]]))
      session.fillets!.forEach((each, i) => {
        if (each.lost) throw new Error(`${each.id} lost at x ${x}`)
        expect(distance(each.corner, { x: fillets[i].at.x + x, y: fillets[i].at.y })).toBeLessThan(0.01)
      })
    }
  })

  it('keeps two fillets of different sizes on their own sides of a bar end as the bar swings live', () => {
    const { objects } = made([circle('a', 0, 0, 100), circle('b', 400, 0, 70), bar('ab', 'a', 'b', 40)])
    const ends = attributedCorners(markGeometry(composeBaseMark(objects)), cornerSources(objects)).filter((corner) => corner.p.x < 200)
    const fillets = ends.map((corner) => fillet(corner.p.y < 0 ? 'top' : 'bottom', corner.p, corner.between, corner.p.y < 0 ? 10 : 40))
    const document = { ...createEmptyVectorDocument(), objects, fillets }
    const session = createComposeSession(vectorDocumentToIllustratorDocument(document), ['b', 'ab'])
    const b = objects.find((object) => object.id === 'b') as PathObject
    const a = asCircle(objects.find((object) => object.id === 'a') as PathObject)!
    const ab = objects.find((object) => object.id === 'ab') as PathObject
    for (let degrees = 2; degrees <= 120; degrees += 2) {
      const turn = (degrees * Math.PI) / 180
      const moved = translateCarve(b.carve!, { x: 400 * Math.cos(turn) - 400, y: 400 * Math.sin(turn) })
      const band = bandBetween(ab.carve as BandSpec, a, asCircle({ carve: moved, contours: [] })!)
      const carves = new Map<string, CarveSpec>([['b', moved], ['ab', band]])
      session.compose(new Map([...carves].map(([id, spec]) => [id, carveOutline(spec).pathData] as const)), carves)
      for (const each of session.fillets!) {
        if (each.lost) throw new Error(`${each.id} lost at ${degrees}°`)
        const side = Math.cos(turn) * each.corner.y - Math.sin(turn) * each.corner.x
        expect(side < 0 ? 'top' : 'bottom').toBe(each.id)
      }
    }
  })
})
