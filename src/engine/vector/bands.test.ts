import { describe, expect, it } from 'vitest'
import { cross, distance, sub, type Vec } from '../path/bezier.ts'
import { bandParts } from '../carve/band.ts'
import { carveOutline } from '../carve/outline.ts'
import { dragCarveHandle, scaleCarveAbout, translateCarve, wholeCarveDrag } from '../carve/edit.ts'
import { polygonSpec, roundCarveSpec, slabSpec, type BandSpec, type CarveSpec, type SlabSpec } from '../carve/spec.ts'
import { asCircle } from '../geometry/asCircle.ts'
import { isObjectCarveValid, segsToContour } from '../carve/sync.ts'
import { DEFAULT_PARAMS } from '../types.ts'
import { writeRecipe } from '../../store/objectEdits.ts'
import { bandBetween, bandRefitted, bandsOf, detachBand, followBands, isEmptyBand, isLinkedBand, type LinkedBand } from './bands.ts'
import { createEmptyVectorDocument, repairVectorDocument } from './document.ts'
import { follow, type DocumentLists } from './follow.ts'
import { constructionLines, makeGuide } from './guides.ts'
import { decodeLink, encodeLink } from './link.ts'
import { followsAnyOf, linksEndedBy } from './offsets.ts'
import { createSavedVariation, savedDocument } from './saved.ts'
import type { Guide, PathObject, VectorDocument, VectorObject } from './types.ts'

function recipe(id: string, carve: CarveSpec, operation: 'add' | 'subtract' = 'add'): PathObject {
  const rounded = roundCarveSpec(carve)
  return { id, name: id, parentId: null, type: 'path', visible: true, locked: false, operation, fillRule: 'evenodd', contours: [segsToContour(carveOutline(rounded).segs)], carve: rounded }
}

const circle = (id: string, x: number, y: number, r: number) => recipe(id, slabSpec('circle', { x, y }, r / 200))

/** A band as the tool adds it: its snapshots and contours left for the follow pass to make. */
function bandOf(id: string, a: string, b: string, fit: BandSpec['fit'], extra: Partial<BandSpec> = {}): LinkedBand {
  const carve: BandSpec = { v: 1, kind: 'band', a: { c: { x: 0, y: 0 }, r: 1 }, b: { c: { x: 0, y: 0 }, r: 1 }, fit, ...extra }
  return { id, name: `Band · ${fit}`, parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'evenodd', contours: [], carve, link: { kind: 'band', a, b } }
}

const circleGuide = (id: string, c: Vec, r: number): Guide => ({ ...makeGuide({ kind: 'circle', c, r }, 'solid'), id })

function made(objects: VectorObject[], guides: Guide[] = []): DocumentLists {
  return follow({ objects: [], guides: [], fillets: [] }, { objects, guides, fillets: [] })
}

function edit(before: DocumentLists, id: string, update: (object: PathObject) => PathObject | null): DocumentLists {
  const objects = before.objects.flatMap((object) => {
    if (object.id !== id || object.type !== 'path') return [object]
    const next = update(object)
    return next ? [next] : []
  })
  return follow(before, { ...before, objects })
}

const byId = (lists: DocumentLists, id: string) => lists.objects.find((object) => object.id === id) as PathObject
const bandIn = (lists: DocumentLists, id = 'band') => byId(lists, id) as LinkedBand
const moved = (object: PathObject, d: Vec) => writeRecipe(object, translateCarve(object.carve!, d))

/** How far a circle's centre lies from the strip edge that touches it, minus its radius: 0 when it touches. */
function stripGap(band: PathObject, end: 'a' | 'b'): number {
  const carve = band.carve as BandSpec
  const outline = carveOutline(carve)
  const { c, r } = carve[end]
  return Math.min(...outline.curves.map((curve) => Math.abs(Math.abs(cross(sub(curve[3], curve[0]), sub(c, curve[0]))) / distance(curve[0], curve[3]) - r)))
}

/** Ref 4: the big circle A, circle C below it, a strip at 60° between them. */
const ref4 = () => made([circle('A', 347, 512, 100), circle('C', 372, 723, 65), bandOf('band', 'A', 'C', 'strip', { angle: 60, side: 1 })])

describe('a band', () => {
  it("is made from its circles as it is added: ref 4's strip touches both", () => {
    const band = bandIn(ref4())
    expect(band.carve).toMatchObject({ a: { c: { x: 347, y: 512 }, r: 100 }, b: { c: { x: 372, y: 723 }, r: 65 } })
    expect(band.contours).toHaveLength(1)
    expect(stripGap(band, 'a')).toBeLessThan(0.01)
    expect(stripGap(band, 'b')).toBeLessThan(0.01)
    expect(isObjectCarveValid(band.carve, band.contours)).toBe(true)
  })

  it('follows a circle that moves or resizes, still touching it, and leaves the other objects as they were', () => {
    const lists = ref4()
    const after = edit(lists, 'C', (object) => moved(object, { x: 18.37, y: -6.11 }))
    const band = bandIn(after)
    expect((band.carve as BandSpec).b.c).toEqual({ x: 390.37, y: 716.89 })
    expect(stripGap(band, 'b')).toBeLessThan(0.01)
    expect(byId(after, 'A')).toBe(byId(lists, 'A'))
    const grown = edit(after, 'A', (object) => writeRecipe(object, scaleCarveAbout(object.carve!, { x: 347, y: 512 }, 1.06)))
    expect((bandIn(grown).carve as BandSpec).a.r).toBe(106)
    expect(stripGap(bandIn(grown), 'a')).toBeLessThan(0.01)
  })

  it('keeps following circle slabs scaled by any factor: storage rounding never leaves one no circle', () => {
    let state = 20261007
    const next = () => (state = (state * 16807) % 2147483647) / 2147483647
    let lists = made([circle('A', -150, 0, 70), circle('C', 150, 20, 60), bandOf('band', 'A', 'C', 'bar', { width: 40 })])
    for (let i = 0; i < 300; i++) {
      const id = next() < 0.5 ? 'A' : 'C'
      const pivot = { x: next() * 600 - 300, y: next() * 600 - 300 }
      const factor = 0.85 + next() * 0.3
      lists = edit(lists, id, (object) => writeRecipe(object, scaleCarveAbout(object.carve!, pivot, factor)))
      const slab = byId(lists, id).carve as SlabSpec
      expect(slab.radius, JSON.stringify(slab)).toBeGreaterThanOrEqual(Math.min(slab.width, slab.height) / 2)
      expect(asCircle(byId(lists, id)), JSON.stringify(slab)).not.toBeNull()
      expect(bandIn(lists).contours, JSON.stringify(slab)).toHaveLength(1)
    }
    // As an older build stored one: its radius rounded half a hundredth short of half its width.
    const stored = { ...(byId(lists, 'A').carve as SlabSpec), width: 130.35, height: 130.35, radius: 65.17 }
    expect(asCircle({ carve: stored, contours: [] })).toMatchObject({ r: 65.175 })
    expect(asCircle({ carve: { ...stored, height: 130.38 }, contours: [] })).toBeNull()
    expect(asCircle({ carve: { ...stored, radius: 65.1 }, contours: [] })).toBeNull()
  })

  it('keeps following circle slabs resized by any handle with Shift: a side keeps a circle one, as a corner does', () => {
    let state = 20261008
    const next = () => (state = (state * 16807) % 2147483647) / 2147483647
    let lists = made([circle('A', -150, 0, 70), circle('C', 150, 20, 60), bandOf('band', 'A', 'C', 'belt')])
    const handles = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const
    for (let i = 0; i < 400; i++) {
      const id = next() < 0.5 ? 'A' : 'C'
      const handle = handles[Math.floor(next() * handles.length)]
      const mods = { shift: true, alt: next() < 0.3 }
      const whole = next() < 0.5
      const pull = { x: next() * 40 - 20, y: next() * 40 - 20 }
      lists = edit(lists, id, (object) => {
        const start = object.carve!
        const at = (start as SlabSpec).center
        const raw = dragCarveHandle(start, handle, at, { x: at.x + pull.x, y: at.y + pull.y }, mods)
        return writeRecipe(object, whole ? wholeCarveDrag(start, raw, handle, mods) : raw)
      })
      const slab = byId(lists, id).carve as SlabSpec
      expect(asCircle(byId(lists, id)), `${handle} ${JSON.stringify(slab)}`).not.toBeNull()
      expect(bandIn(lists).contours, JSON.stringify(slab)).toHaveLength(1)
    }
  })

  it('draws in a live frame what the commit writes', () => {
    const lists = ref4()
    const after = edit(lists, 'C', (object) => moved(object, { x: 12.5, y: 3.25 }))
    const live = bandBetween(bandIn(lists).carve, { c: { x: 384.5, y: 726.25 }, r: 65 }, { c: { x: 347, y: 512 }, r: 100 })
    expect(bandBetween(bandIn(lists).carve, { c: { x: 347, y: 512 }, r: 100 }, { c: { x: 384.5, y: 726.25 }, r: 65 })).toEqual(bandIn(after).carve)
    expect(live).not.toEqual(bandIn(after).carve)
  })

  it('keeps its link and recipe but empties while its circles allow no fit, and comes back when they do', () => {
    const lists = ref4()
    // C pushed far to the right: A's edge no longer crosses it.
    const away = edit(lists, 'C', (object) => moved(object, { x: 400, y: 0 }))
    const empty = bandIn(away)
    expect(isEmptyBand(empty)).toBe(true)
    expect(empty.link).toEqual({ kind: 'band', a: 'A', b: 'C' })
    expect(isObjectCarveValid(empty.carve, empty.contours)).toBe(true)
    const back = edit(away, 'C', (object) => moved(object, { x: -400, y: 0 }))
    expect(bandIn(back).contours).toEqual(bandIn(lists).contours)
  })

  it('empties while an end is no circle, and comes back when it is one again', () => {
    const lists = ref4()
    const square = edit(lists, 'C', (object) => writeRecipe(object, { ...object.carve!, radius: 0 } as CarveSpec))
    expect(isEmptyBand(bandIn(square))).toBe(true)
    const round = edit(square, 'C', (object) => writeRecipe(object, { ...object.carve!, radius: 65 } as CarveSpec))
    expect(bandIn(round).contours).toEqual(bandIn(lists).contours)
  })

  it('is detached when a circle goes, keeping its geometry and recipe; an empty one goes with it', () => {
    const lists = ref4()
    const gone = edit(lists, 'C', () => null)
    const band = byId(gone, 'band')
    expect(band.link).toBeUndefined()
    expect(band.carve).toEqual(bandIn(lists).carve)
    expect(band.contours).toBe(bandIn(lists).contours)
    expect(linksEndedBy(lists.objects, gone.objects)).toEqual({ gone: ['band'], edited: [] })
    const away = edit(lists, 'C', (object) => moved(object, { x: 400, y: 0 }))
    expect(edit(away, 'A', () => null).objects.map((object) => object.id)).toEqual(['C'])
  })

  it('given a recipe of its own, by a box or a key, no longer follows, and says so', () => {
    const lists = ref4()
    const after = edit(lists, 'band', (object) => writeRecipe(object, translateCarve(object.carve!, { x: 5, y: 0 })))
    expect(byId(after, 'band').link).toBeUndefined()
    expect(linksEndedBy(lists.objects, after.objects)).toEqual({ gone: [], edited: ['band'] })
  })

  it('follows a circle guide, which moves on its own, and one that follows a shape', () => {
    const guide = circleGuide('ring', { x: 0, y: 0 }, 80)
    const lists = made([circle('A', 300, 40, 60), bandOf('band', 'ring', 'A', 'belt')], [guide])
    expect(bandIn(lists).carve.a).toEqual({ c: { x: 0, y: 0 }, r: 80 })
    // A guide edit alone: the objects are as they were but the band.
    const nudged: Guide = { ...guide, shape: { kind: 'circle', c: { x: 10, y: 0 }, r: 80 } }
    const after = follow(lists, { ...lists, guides: [nudged] })
    expect(bandIn(after).carve.a.c).toEqual({ x: 10, y: 0 })
    expect(byId(after, 'A')).toBe(byId(lists, 'A'))
    // A polygon's circumcircle guide follows it, and the band follows the guide.
    const hexagon = recipe('hex', polygonSpec({ x: 0, y: 0 }, 100))
    const line = constructionLines(hexagon).find((each) => each.role === 'circumcircle')!
    const circum: Guide = { ...makeGuide(line.shape, 'solid', { kind: 'construction', of: 'hex', role: 'circumcircle' }), id: 'circum' }
    const built = made([hexagon, circle('A', 300, 40, 60), bandOf('band', 'circum', 'A', 'belt')], [circum])
    const grown = edit(built, 'hex', (object) => writeRecipe(object, scaleCarveAbout(object.carve!, { x: 0, y: 0 }, 1.5)))
    expect(bandIn(grown).carve.a.r).toBe(150)
  })

  it('is detached when its circle guide is deleted', () => {
    const guide = circleGuide('ring', { x: 0, y: 0 }, 80)
    const lists = made([circle('A', 300, 40, 60), bandOf('band', 'ring', 'A', 'belt')], [guide])
    const after = follow(lists, { ...lists, guides: [] })
    expect(byId(after, 'band').link).toBeUndefined()
    expect(linksEndedBy(lists.objects, after.objects, after.guides).gone).toEqual(['band'])
    expect(linksEndedBy(lists.objects, after.objects, [guide]).gone).toEqual([])
  })

  it('carries an offset copy of it along, and its construction guides, which wait while it is empty', () => {
    const lists = ref4()
    const edges = constructionLines(bandIn(lists)).map((line) => ({ ...makeGuide(line.shape, 'solid', { kind: 'construction', of: 'band', role: line.role }), id: line.role }))
    expect(edges.map((guide) => guide.id)).toEqual(['centre-line', 'edge-1', 'edge-2'])
    const copy: PathObject = { id: 'copy', name: 'Outset 10', parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'evenodd', contours: [], link: { kind: 'offset', of: 'band', distance: 10 } }
    const withCopy = follow(lists, { ...lists, objects: [...lists.objects, copy], guides: edges })
    expect(byId(withCopy, 'copy').carve).toMatchObject({ kind: 'band', a: { r: 110 }, b: { r: 75 } })
    const after = edit(withCopy, 'C', (object) => moved(object, { x: 10, y: 0 }))
    expect((byId(after, 'copy').carve as BandSpec).b.c).toEqual({ x: 382, y: 723 })
    expect(after.guides.find((guide) => guide.id === 'edge-2')).not.toBe(withCopy.guides.find((guide) => guide.id === 'edge-2'))
    const away = edit(after, 'C', (object) => moved(object, { x: 400, y: 0 }))
    expect(away.guides.every((guide) => guide.link)).toBe(true)
    expect(away.guides).toEqual(after.guides)
  })

  it('empties its offset copies with it, though they would fit, and they come back and go with it', () => {
    const lists = ref4()
    const copy: PathObject = { id: 'copy', name: 'Outset 10', parentId: null, type: 'path', visible: true, locked: false, operation: 'add', fillRule: 'evenodd', contours: [], link: { kind: 'offset', of: 'band', distance: 10 } }
    const withCopy = follow(lists, { ...lists, objects: [...lists.objects, copy] })
    expect(byId(withCopy, 'copy').contours).toHaveLength(1)
    // C moved along the strip's normal until its edges miss by 10: the band has no fit there, an outset of 10 would.
    const n = { x: -Math.sin(Math.PI / 3), y: Math.cos(Math.PI / 3) }
    const along = 175 - (n.x * 25 + n.y * 211)
    const missed = edit(withCopy, 'C', (object) => moved(object, { x: n.x * along, y: n.y * along }))
    expect(bandIn(missed).contours).toEqual([])
    expect(bandParts({ ...(bandIn(missed).carve as BandSpec), a: { ...bandIn(missed).carve.a, r: 110 }, b: { ...bandIn(missed).carve.b, r: 75 } })).not.toBeNull()
    expect(byId(missed, 'copy').contours).toEqual([])
    expect(byId(missed, 'copy').link).toEqual(copy.link)
    // C made square: no circle, so no band, and no copy.
    const square = edit(withCopy, 'C', (object) => writeRecipe(object, { ...object.carve!, radius: 0 } as CarveSpec))
    expect(bandIn(square).contours).toEqual([])
    expect(byId(square, 'copy').contours).toEqual([])
    // Round again, both come back.
    const round = edit(square, 'C', (object) => writeRecipe(object, { ...object.carve!, radius: 65 } as CarveSpec))
    expect(bandIn(round).contours).toHaveLength(1)
    expect(byId(round, 'copy').contours).toEqual(byId(withCopy, 'copy').contours)
    // A deleted while the band waits empty: the band goes, and its empty copy with it.
    expect(edit(square, 'A', () => null).objects.map((object) => object.id)).toEqual(['C'])
  })

  it("offers a neck's arc circles as construction guides named Arc 1 and Arc 2", () => {
    const lists = made([circle('R', 0, 0, 91), circle('L', 0, 241.9, 110), bandOf('neck', 'R', 'L', 'neck', { radius: 38 })])
    expect(constructionLines(bandIn(lists, 'neck')).map((line) => [line.name, line.shape.kind])).toEqual([
      ['Centre line', 'line'],
      ['Arc 1', 'circle'],
      ['Arc 2', 'circle'],
    ])
  })

  it('is followed by what an edit of its circles takes in, and names the bands of a circle', () => {
    const lists = ref4()
    expect(followsAnyOf(lists.objects, 'band', new Set(['C']))).toBe(true)
    expect(followsAnyOf(lists.objects, 'band', new Set(['other']))).toBe(false)
    // On a construction circle, it follows through the guide the shape the guide follows.
    const around: Guide = { ...circleGuide('around', { x: 0, y: 0 }, 80), link: { kind: 'construction', of: 'hex', role: 'circumcircle' } }
    const onGuide = [...lists.objects, bandOf('guided', 'around', 'C', 'bar')]
    expect(followsAnyOf(onGuide, 'guided', new Set(['hex']), [around])).toBe(true)
    expect(followsAnyOf(onGuide, 'guided', new Set(['hex']))).toBe(false)
    expect(bandsOf(lists.objects, 'A')).toEqual(['band'])
    expect(isLinkedBand(detachBand(bandIn(lists)))).toBe(false)
  })

  it('takes the side of a strip that fits, whichever circle was picked first', () => {
    const a = { c: { x: 347, y: 512 }, r: 100 }
    const c = { c: { x: 372, y: 723 }, r: 65 }
    const spec: BandSpec = { v: 1, kind: 'band', a, b: c, fit: 'strip', angle: 60, side: 1 }
    expect(bandBetween(spec, a, c).side).toBe(1)
    expect(bandBetween(spec, c, a).side).toBe(-1)
    expect(bandParts(bandBetween(spec, c, a))).not.toBeNull()
    // Where neither side fits, it keeps the side it was given.
    expect(bandBetween({ ...spec, angle: 0 }, a, c).side).toBe(1)
  })

  it('is read as stored as a document opens', () => {
    const lists = ref4()
    expect(followBands(lists.objects, [], null, null)).toBe(lists.objects)
  })

  it('changes fit to the setting it had there, or the nearest whole one in the sliders\' reach its circles allow', () => {
    const spec = (a: [number, number, number], b: [number, number, number], fit: BandSpec['fit'], extra: Partial<BandSpec> = {}): BandSpec => ({
      v: 1,
      kind: 'band',
      a: { c: { x: a[0], y: a[1] }, r: a[2] },
      b: { c: { x: b[0], y: b[1] }, r: b[2] },
      fit,
      ...extra,
    })
    const bar = spec([-150, 0, 70], [150, 0, 60], 'bar')
    // A neck of 30 cannot reach across 300 and keep a waist: the smallest whole radius that can, the nearest.
    const neck = bandRefitted(bar, 'neck')!
    expect(neck).toMatchObject({ fit: 'neck', radius: 141 })
    expect(bandParts(neck)).not.toBeNull()
    expect(bandParts({ ...neck, radius: 140 })).toBeNull()
    // A strip at 60° touches neither: the nearest whole angle that touches both, on whichever side fits.
    const strip = bandRefitted(bar, 'strip')!
    expect(bandParts(strip)).not.toBeNull()
    const off = Math.abs(strip.angle! - 60)
    expect(Number.isInteger(strip.angle)).toBe(true)
    for (let angle = 60 - off + 1; angle < 60 + off; angle++) expect(bandRefitted({ ...bar, fit: 'strip', angle }, 'strip')?.angle).not.toBe(angle)
    // A setting that fits is kept, and a fit with no setting fits or not.
    expect(bandRefitted({ ...bar, radius: 150 }, 'neck')).toMatchObject({ radius: 150 })
    expect(bandRefitted(bar, 'belt')).toMatchObject({ fit: 'belt' })
    // One circle inside the other leaves no room for a belt, or for a neck of any radius.
    const inside = spec([0, 0, 100], [20, 0, 30], 'bar')
    expect(bandRefitted(inside, 'belt')).toBeNull()
    expect(bandRefitted(inside, 'neck')).toBeNull()
  })
})

describe('bands read from outside the editor', () => {
  const lists = made([circle('A', 0, 0, 100), circle('B', 300, 40, 60), bandOf('band', 'A', 'B', 'bar', { width: 40 })], [circleGuide('ring', { x: 0, y: 300 }, 50)])
  const document: VectorDocument = JSON.parse(JSON.stringify({ ...createEmptyVectorDocument('Bands'), objects: lists.objects, guides: lists.guides }))

  it('keep a band and its link through the repairing read, a link and a saved mark', () => {
    expect(repairVectorDocument(document)).toBe(document)
    const decoded = decodeLink(encodeLink(document, '#123456'))
    expect(decoded.kind === 'vector' && decoded.document.objects).toEqual(lists.objects)
    const entry = JSON.parse(JSON.stringify(createSavedVariation(document, { ...DEFAULT_PARAMS, fillColor: '#123456' })))
    expect(savedDocument(entry)?.document.objects).toEqual(lists.objects)
  })

  it('keep a band on a circle guide, and an empty band waiting for its circles, as stored', () => {
    const [a, b, band] = document.objects as PathObject[]
    const onGuide = { ...band, link: { kind: 'band', a: 'ring', b: 'B' } }
    const empty = { ...band, contours: [] }
    const read = repairVectorDocument({ ...document, objects: [a, b, onGuide] })!
    expect((read.objects[2] as PathObject).link).toEqual({ kind: 'band', a: 'ring', b: 'B' })
    // Read as stored: the follow pass waits for the first edit.
    expect((read.objects[2] as PathObject).carve).toEqual(band.carve)
    const waiting = repairVectorDocument({ ...document, objects: [a, b, empty] })!.objects[2] as PathObject
    expect(waiting.carve).toEqual(band.carve)
    expect(waiting.link).toEqual(band.link)
  })

  it('drop a fit they do not know, keeping the geometry, and lose links that cannot hold', () => {
    const [a, b, band] = document.objects as PathObject[]
    const unknown = repairVectorDocument({ ...document, objects: [a, b, { ...band, carve: { ...band.carve, fit: 'spline' } }] })!.objects[2] as PathObject
    expect(unknown.carve).toBeUndefined()
    expect(unknown.link).toBeUndefined()
    expect(unknown.contours).toEqual(band.contours)
    const group = { id: 'g', type: 'group', name: 'Group', parentId: null, visible: true, locked: false, isolated: false, operation: 'add' }
    const cases = [
      { ...band, id: 'missing', link: { kind: 'band', a: 'A', b: 'nobody' } },
      { ...band, id: 'twice', link: { kind: 'band', a: 'A', b: 'A' } },
      { ...band, id: 'self', link: { kind: 'band', a: 'self', b: 'A' } },
      { ...band, id: 'of-band', link: { kind: 'band', a: 'band', b: 'A' } },
      { ...band, id: 'plain', carve: undefined, contours: band.contours },
      { ...b, id: 'not-a-band', link: { kind: 'band', a: 'A', b: 'B' } },
    ]
    const read = repairVectorDocument({ ...document, objects: [group, { ...a, parentId: 'g' }, b, band, ...cases] })!
    for (const id of ['missing', 'twice', 'self', 'of-band', 'not-a-band']) {
      const object = read.objects.find((each) => each.id === id) as PathObject
      expect(object.link).toBeUndefined()
      expect(object.contours.length).toBeGreaterThan(0)
    }
    expect((read.objects.find((each) => each.id === 'band') as PathObject).link).toEqual(band.link)
    // A band to a group is no band of circles.
    const toGroup = repairVectorDocument({ ...document, objects: [group, { ...a, parentId: 'g' }, b, { ...band, link: { kind: 'band', a: 'g', b: 'B' } }] })!
    expect((toGroup.objects.at(-1) as PathObject).link).toBeUndefined()
  })

  it('keep their snapshots exact: a stored band is the outline of its rounded recipe', () => {
    const band = (document.objects as PathObject[])[2]
    expect(bandParts(band.carve as BandSpec)).not.toBeNull()
    expect(isObjectCarveValid(band.carve, band.contours)).toBe(true)
  })
})
