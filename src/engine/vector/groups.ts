import { translateCarve } from '../carve/edit.ts'
import { carveOutline } from '../carve/outline.ts'
import { roundCarveSpec } from '../carve/spec.ts'
import { segsToContour } from '../carve/sync.ts'
import type { Vec } from '../path/bezier.ts'
import type { IllustratorDocument } from '../illustrator/types.ts'
import { moveGuideShape } from './guides.ts'
import { isOffsetCopy, nameDetached } from './offsets.ts'
import type { Contour, Fillet, GroupObject, Guide, PathObject, VectorObject } from './types.ts'

/**
 * Groups as the editor reads and writes them. A group is a run in the
 * stack: its header, then its members, which follow it directly, nested
 * groups with theirs. `parentId` is the only record of membership.
 *
 * What a click selects goes by the group the selection lies in, the one it
 * has entered: a click on a member of any other group selects that group's
 * outermost group, and a double-click selects the piece itself, entering its
 * group. The group the selection lies in is read from the selection, never
 * stored: undo and redo restore it with the selection.
 */

/** Anything placed in a group: an object, or a layer or group of the view. Missing is the root. */
export interface Placed {
  id: string
  parentId?: string | null
}

/** Each id's group, or null at the root. */
export function parentsOf(items: Iterable<Placed>): Map<string, string | null> {
  const parents = new Map<string, string | null>()
  for (const item of items) parents.set(item.id, item.parentId ?? null)
  return parents
}

/** The groups around an object, innermost first. It stops where a chain would loop. */
export function ancestorsOf(parents: ReadonlyMap<string, string | null>, id: string): string[] {
  const chain: string[] = []
  let parent = parents.get(id) ?? null
  while (parent !== null && parent !== id && !chain.includes(parent)) {
    chain.push(parent)
    parent = parents.get(parent) ?? null
  }
  return chain
}

/**
 * The group a selection lies in: the innermost group around every one of
 * its objects. Null for none, or at the root.
 */
export function enteredGroup(parents: ReadonlyMap<string, string | null>, ids: readonly string[]): string | null {
  if (!ids.length) return null
  const [first, ...rest] = ids.map((id) => ancestorsOf(parents, id))
  return first.find((group) => rest.every((chain) => chain.includes(group))) ?? null
}

/**
 * What a click on `id` selects, while the selection lies in `entered`: the
 * outermost group around it that the selection has not entered, or the
 * object itself when it lies directly in the entered group or at the root.
 */
export function selectionRoot(parents: ReadonlyMap<string, string | null>, id: string, entered: string | null): string {
  const open = new Set(entered === null ? [] : [entered, ...ancestorsOf(parents, entered)])
  const outermostFirst = ancestorsOf(parents, id).reverse()
  return outermostFirst.find((group) => !open.has(group)) ?? id
}

/** Is `id` inside `group`, at any depth? */
export function isInside(parents: ReadonlyMap<string, string | null>, id: string, group: string): boolean {
  return ancestorsOf(parents, id).includes(group)
}

/** Where the run of the object at `index` ends: past its members, and theirs, for a group. */
export function runEnd(objects: readonly VectorObject[], index: number): number {
  const object = objects[index]
  if (object.type !== 'group') return index + 1
  const inside = new Set([object.id])
  let end = index + 1
  while (end < objects.length) {
    const parentId = objects[end].parentId
    if (parentId === null || !inside.has(parentId)) break
    inside.add(objects[end].id)
    end++
  }
  return end
}

/** The paths an object stands for: itself, or every path inside a group, in stack order. */
export function leavesOf(objects: readonly VectorObject[], id: string): string[] {
  const index = objects.findIndex((object) => object.id === id)
  if (index < 0) return []
  return objects.slice(index, runEnd(objects, index)).flatMap((object) => (object.type === 'path' ? [object.id] : []))
}

/** The objects directly in a group, in stack order. */
export function membersOf(objects: readonly VectorObject[], groupId: string): VectorObject[] {
  return objects.filter((object) => object.parentId === groupId)
}

/* ─── Numbers ─── */

/**
 * Each path's and group's number as the drawer shows it. Numbers count
 * within each level, from 1 at the bottom: an item at the root is "01",
 * "02" and so on; a member is its group's number, a dot and its place in
 * the group, "03.1", "03.2", and deeper "03.2.1". So a number names one row
 * wherever it is written ("follows 02, 03.1"), and without groups every
 * layer's number is its place in the stack, as before. `paths` come in
 * stack order; a group's place is where its first path is, since a group
 * sits directly below its first member and is never empty.
 */
export function stackNumbers(paths: readonly Placed[], parents: ReadonlyMap<string, string | null>): Map<string, string> {
  const numbers = new Map<string, string>()
  const counts = new Map<string | null, number>()
  for (const path of paths) {
    for (const id of [...ancestorsOf(parents, path.id).reverse(), path.id]) {
      if (numbers.has(id)) continue
      const parent = parents.get(id) ?? null
      const n = (counts.get(parent) ?? 0) + 1
      counts.set(parent, n)
      numbers.set(id, parent === null ? String(n).padStart(2, '0') : `${numbers.get(parent) ?? '—'}.${n}`)
    }
  }
  return numbers
}

type Numbered = Pick<IllustratorDocument, 'layers' | 'groups'>

// The numbers are kept per layers array: the view makes a new one whenever the objects change.
const numbersCache = new WeakMap<Numbered['layers'], { groups: Numbered['groups']; numbers: Map<string, string> }>()

/** Every layer's and group's number in a view of the document: see `stackNumbers`. */
export function layerNumbers(doc: Numbered): Map<string, string> {
  const cached = numbersCache.get(doc.layers)
  if (cached && cached.groups === doc.groups) return cached.numbers
  const numbers = stackNumbers(doc.layers, parentsOf([...doc.layers, ...(doc.groups ?? [])]))
  numbersCache.set(doc.layers, { groups: doc.groups, numbers })
  return numbers
}

/** The numbers of a document's objects: see `stackNumbers`. */
export function objectNumbers(objects: readonly VectorObject[]): Map<string, string> {
  return stackNumbers(
    objects.filter((object) => object.type === 'path'),
    parentsOf(objects),
  )
}

/* ─── Grouping ─── */

/** The box a path covers, from its points and handles: never smaller than its outline. Null for an empty one. */
export function pathBounds(object: PathObject): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const contour of object.contours) {
    for (const { point, handleIn, handleOut } of contour.segments) {
      include(point.x, point.y)
      if (handleIn) include(point.x + handleIn.x, point.y + handleIn.y)
      if (handleOut) include(point.x + handleOut.x, point.y + handleOut.y)
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

type Box = NonNullable<ReturnType<typeof pathBounds>>

const overlap = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

/**
 * What a run puts in the stack around it: a path, or an isolated group as
 * one input with its operation. A shared group's members stand in the
 * stack one by one, so they count one by one, as do the members of a
 * group in `opened`, one that is going. Empty paths put in nothing.
 * `start` is where the input's run starts.
 */
interface StackInput {
  id: string
  operation: 'add' | 'subtract'
  bounds: Box
  group: boolean
  start: number
}

function runInputs(objects: readonly VectorObject[], start: number, opened: ReadonlySet<string> = new Set()): StackInput[] {
  const object = objects[start]
  const end = runEnd(objects, start)
  if (object.type === 'path') {
    const bounds = pathBounds(object)
    return bounds ? [{ id: object.id, operation: object.operation, bounds, group: false, start }] : []
  }
  if (object.isolated && !opened.has(object.id)) {
    let bounds: Box | null = null
    for (const member of objects.slice(start + 1, end)) {
      const box = member.type === 'path' ? pathBounds(member) : null
      if (!box) continue
      bounds = bounds
        ? { minX: Math.min(bounds.minX, box.minX), minY: Math.min(bounds.minY, box.minY), maxX: Math.max(bounds.maxX, box.maxX), maxY: Math.max(bounds.maxY, box.maxY) }
        : box
    }
    return bounds ? [{ id: object.id, operation: object.operation, bounds, group: true, start }] : []
  }
  const inputs: StackInput[] = []
  for (let i = start + 1; i < end; i = runEnd(objects, i)) inputs.push(...runInputs(objects, i, opened))
  return inputs
}

/** The runs directly in a group, or at the root with null: where each starts and ends. */
function siblingRuns(objects: readonly VectorObject[], parentId: string | null): Array<{ id: string; start: number; end: number }> {
  const runs: Array<{ id: string; start: number; end: number }> = []
  for (let i = 0; i < objects.length; ) {
    const end = runEnd(objects, i)
    if (objects[i].parentId === parentId) runs.push({ id: objects[i].id, start: i, end })
    // A run at this level is stepped over whole; a run of another level is entered, to find this level inside it.
    i = objects[i].parentId === parentId ? end : i + 1
  }
  return runs
}

/** Why some objects cannot be grouped, or null when they can. */
export type GroupRefusal =
  | { kind: 'too-few' }
  | { kind: 'levels' }
  | { kind: 'between'; id: string; operation: 'add' | 'subtract'; group: boolean }

/**
 * Can these objects be gathered into a group? They must be two or more, all
 * in the same group or all at the root. Gathering moves each lower one up
 * to the topmost, past what lies between. That changes the mark only where
 * a moved input crosses an input of the other operation that overlaps it:
 * a shape that moves above a cut no longer loses to it, and a cut that
 * moves above a shape starts to cut it. So that is refused, naming the
 * input in the way. Overlap is tested on boxes, so a refusal may be
 * cautious, never wrong the other way.
 */
export function groupRefusal(objects: readonly VectorObject[], ids: readonly string[]): GroupRefusal | null {
  const chosen = [...new Set(ids)].filter((id) => objects.some((object) => object.id === id))
  if (chosen.length < 2) return { kind: 'too-few' }
  const parents = new Set(chosen.map((id) => objects.find((object) => object.id === id)!.parentId))
  if (parents.size !== 1) return { kind: 'levels' }
  const runs = siblingRuns(objects, [...parents][0])
  const picked = new Set(chosen)
  const top = runs.reduce((highest, run, index) => (picked.has(run.id) ? index : highest), -1)
  for (let i = 0; i < top; i++) {
    if (!picked.has(runs[i].id)) continue
    const moved = runInputs(objects, runs[i].start)
    for (let j = i + 1; j < top; j++) {
      if (picked.has(runs[j].id)) continue
      for (const crossed of runInputs(objects, runs[j].start)) {
        if (moved.some((input) => input.operation !== crossed.operation && overlap(input.bounds, crossed.bounds))) {
          return { kind: 'between', id: crossed.id, operation: crossed.operation, group: crossed.group }
        }
      }
    }
  }
  return null
}

/** A refusal in words, with the drawer's numbers: "Cut 04 lies between them". */
export function groupRefusalText(refusal: GroupRefusal, numbers: ReadonlyMap<string, string>): string {
  switch (refusal.kind) {
    case 'too-few':
      return 'Select two or more to group'
    case 'levels':
      return 'Only layers in the same group can be grouped'
    case 'between': {
      const what = refusal.group ? 'Group' : refusal.operation === 'subtract' ? 'Cut' : 'Shape'
      return `${what} ${numbers.get(refusal.id) ?? ''} lies between them`.replace('  ', ' ')
    }
    default:
      return refusal satisfies never
  }
}

/**
 * The objects gathered into a new group whose header is `group`: in the
 * same group they shared, where the topmost of them was, each keeping its
 * place among the others. Null when `groupRefusal` refuses.
 */
export function gatherIntoGroup(
  objects: readonly VectorObject[],
  ids: readonly string[],
  group: Omit<GroupObject, 'parentId'>,
): VectorObject[] | null {
  if (groupRefusal(objects, ids)) return null
  const picked = new Set(ids)
  const parentId = objects.find((object) => picked.has(object.id))!.parentId
  const runs = siblingRuns(objects, parentId).filter((run) => picked.has(run.id))
  const last = runs.at(-1)!
  const inRun = new Set<number>()
  for (const run of runs) for (let i = run.start; i < run.end; i++) inRun.add(i)
  const header: GroupObject = { ...group, parentId }
  const gathered = runs.flatMap((run) =>
    objects.slice(run.start, run.end).map((object, offset) => (offset === 0 ? { ...object, parentId: header.id } : object)),
  )
  const before = objects.slice(0, last.end).filter((_, index) => !inRun.has(index))
  return [...before, header, ...gathered, ...objects.slice(last.end)]
}

/**
 * The groups ungrouped one level: each header goes, and its members move
 * to the group it sat in, keeping their places in the stack. Groups inside
 * stay groups. The objects that were directly in them come back with it.
 * A member of a hidden group comes back hidden, so the mark stays as it was.
 */
export function ungroupObjects(objects: readonly VectorObject[], ids: readonly string[]): { objects: VectorObject[]; released: string[] } | null {
  const headers = new Map(
    objects.flatMap((object) => (object.type === 'group' && ids.includes(object.id) ? [[object.id, object] as const] : [])),
  )
  if (!headers.size) return null
  // A group inside another that also goes moves to where that one sat, and is seen only where every one that goes was.
  const landing = (parentId: string | null): { parentId: string | null; visible: boolean } => {
    let parent = parentId
    let visible = true
    while (parent !== null && headers.has(parent)) {
      const header = headers.get(parent)!
      visible &&= header.visible
      parent = header.parentId
    }
    return { parentId: parent, visible }
  }
  const released: string[] = []
  const next: VectorObject[] = []
  for (const object of objects) {
    if (headers.has(object.id)) continue
    if (object.parentId === null || !headers.has(object.parentId)) {
      next.push(object)
      continue
    }
    released.push(object.id)
    const landed = landing(object.parentId)
    next.push({ ...object, parentId: landed.parentId, visible: object.visible && landed.visible })
  }
  return { objects: next, released }
}

/** Why some groups cannot be ungrouped, or null when they can. */
export type UngroupRefusal =
  | { kind: 'none' }
  | { kind: 'locked'; group: string }
  | { kind: 'cuts-as-one'; group: string }
  | { kind: 'would-cut'; group: string; id: string; isGroup: boolean }

/**
 * Can these groups be ungrouped without changing the mark? A locked group
 * cannot: its lock is the only one its members have, so it is unlocked
 * first. A shared group always can: its members already stand in the
 * stack one by one, and a hidden one's come back hidden. An
 * isolated group composes alone, so ungrouping it lets its members into
 * the stack around it. A group that cuts as one would turn its shapes to
 * ink, so that is refused; and a group that adds is refused when one of
 * its cuts overlaps a shape below it that composes with it, which the cut
 * would start to reach, naming that shape. Overlap is tested on boxes, so
 * a refusal may be cautious, never wrong the other way.
 */
export function ungroupRefusal(objects: readonly VectorObject[], ids: readonly string[]): UngroupRefusal | null {
  const going = new Set(ids.filter((id) => objects.some((object) => object.id === id && object.type === 'group')))
  if (!going.size) return { kind: 'none' }
  // Its lock is the only lock its members have in the drawer: it is not let go unsaid.
  const locked = objects.find((object) => going.has(object.id) && object.locked)
  if (locked) return { kind: 'locked', group: locked.id }
  const parents = parentsOf(objects)
  const byId = new Map(objects.map((object) => [object.id, object]))
  for (let index = 0; index < objects.length; index++) {
    const group = objects[index]
    // A hidden group's members come back hidden: they change nothing.
    if (group.type !== 'group' || !going.has(group.id) || !group.isolated || !group.visible) continue
    const inputs = siblingRuns(objects, group.id).flatMap((run) => runInputs(objects, run.start, going))
    if (group.operation === 'subtract' && inputs.length) return { kind: 'cuts-as-one', group: group.id }
    const cuts = inputs.filter((input) => input.operation === 'subtract')
    if (group.operation === 'subtract' || !cuts.length) continue
    // What it composes with: the stack of the nearest isolated group around it that stays, or the root's.
    const context = ancestorsOf(parents, group.id).find((id) => {
      const around = byId.get(id)
      return around?.type === 'group' && around.isolated && !going.has(id)
    })
    const below = siblingRuns(objects, context ?? null)
      .flatMap((run) => runInputs(objects, run.start, going))
      .filter((input) => input.start < index && input.operation === 'add')
    for (const shape of below) {
      if (cuts.some((cut) => overlap(cut.bounds, shape.bounds))) {
        return { kind: 'would-cut', group: group.id, id: shape.id, isGroup: shape.group }
      }
    }
  }
  return null
}

/** An ungroup refused, in words, with the drawer's numbers: "Its cuts would reach Shape 02". */
export function ungroupRefusalText(refusal: UngroupRefusal, numbers: ReadonlyMap<string, string>): string {
  switch (refusal.kind) {
    case 'none':
      return 'No group selected'
    case 'locked':
      return `Group ${numbers.get(refusal.group) ?? ''} is locked: unlock it first`.replace('  ', ' ')
    case 'cuts-as-one':
      return `Group ${numbers.get(refusal.group) ?? ''} cuts as one: set it to Add first`.replace('  ', ' ')
    case 'would-cut':
      return `Its cuts would reach ${refusal.isGroup ? 'Group' : 'Shape'} ${numbers.get(refusal.id) ?? ''}`.trimEnd()
    default:
      return refusal satisfies never
  }
}

/* ─── Copying a group ─── */

function translateContours(contours: Contour[], d: Vec): Contour[] {
  return contours.map((contour) => ({
    closed: contour.closed,
    segments: contour.segments.map((segment) => ({ ...segment, point: { x: segment.point.x + d.x, y: segment.point.y + d.y } })),
  }))
}

/**
 * A copy of a group with everything in it, moved by `d`, directly above
 * the group in the stack. Links inside the group are kept between the
 * copies: a band between two of its circles, an offset copy of one of its
 * shapes, a pin from one to another, the construction guides of its
 * shapes and the fillets between them. A link to anything outside it is
 * let go, as a copy of one layer lets go of what it follows, and a copy or
 * band that waits, empty, for something outside is left out. Null when
 * there is no such group.
 */
export function copyGroup(
  lists: { objects: readonly VectorObject[]; guides: readonly Guide[]; fillets: readonly Fillet[] },
  groupId: string,
  d: Vec,
  freeName: () => string,
): { objects: VectorObject[]; guides: Guide[]; fillets: Fillet[]; copyId: string } | null {
  const { objects } = lists
  const start = objects.findIndex((object) => object.id === groupId)
  if (start < 0 || objects[start].type !== 'group') return null
  const end = runEnd(objects, start)
  const run = objects.slice(start, end)
  const ids = new Map(run.map((object) => [object.id, crypto.randomUUID()]))
  // The construction guides of shapes inside are copied too, so a band or pin on one stays inside.
  const ownGuides = lists.guides.filter((guide) => guide.link && ids.has(guide.link.of))
  for (const guide of ownGuides) ids.set(guide.id, crypto.randomUUID())
  const inside = (id: string) => ids.has(id)
  const copies: VectorObject[] = []
  for (const object of run) {
    const id = ids.get(object.id)!
    const parentId = object.id === groupId ? object.parentId : ids.get(object.parentId!)!
    if (object.type === 'group') {
      copies.push({ ...object, id, parentId, ...(object.id === groupId ? { name: `${object.name} copy`, locked: false } : {}) })
      continue
    }
    const link = object.link
    const linked = link && (link.kind === 'band' ? inside(link.a) && inside(link.b) : inside(link.of))
    // Empty, waiting on something outside: nothing to copy.
    if (link && !linked && !object.contours.length) continue
    const copy: PathObject = { ...object, id, parentId }
    delete copy.sourceShapeId
    if (object.carve) {
      const carve = roundCarveSpec(translateCarve(object.carve, d))
      copy.carve = carve
      copy.contours = [segsToContour(carveOutline(carve).segs)]
    } else copy.contours = translateContours(object.contours, d)
    if (link && linked) {
      copy.link = link.kind === 'band' ? { kind: 'band', a: ids.get(link.a)!, b: ids.get(link.b)! } : { ...link, of: ids.get(link.of)! }
    } else if (link) {
      delete copy.link
      if (isOffsetCopy(object)) copy.name = nameDetached(object, object.link.distance, freeName)
    }
    if (object.pin) {
      if (inside(object.pin.centreOf)) copy.pin = { centreOf: ids.get(object.pin.centreOf)! }
      else delete copy.pin
    }
    copies.push(copy)
  }
  const guides = ownGuides.map((guide) => ({
    ...guide,
    id: ids.get(guide.id)!,
    shape: moveGuideShape(guide.shape, d),
    link: { ...guide.link!, of: ids.get(guide.link!.of)! },
  }))
  const fillets = lists.fillets.flatMap((fillet) =>
    inside(fillet.between[0]) && inside(fillet.between[1])
      ? [{ ...fillet, id: crypto.randomUUID(), at: { x: fillet.at.x + d.x, y: fillet.at.y + d.y }, between: [ids.get(fillet.between[0])!, ids.get(fillet.between[1])!] as [string, string] }]
      : [],
  )
  return {
    objects: [...objects.slice(0, end), ...copies, ...objects.slice(end)],
    guides: [...lists.guides, ...guides],
    fillets: [...lists.fillets, ...fillets],
    copyId: ids.get(groupId)!,
  }
}

/* ─── Names ─── */

/** The name a dropped spark's group takes from the kind of mark it was rolled from. */
export const SPARK_GROUP_PREFIX = 'Spark · '

const SPARK_KINDS: Record<string, string> = {
  'geometric-radial': 'radial',
  'grid-system': 'grid',
  modular: 'modular',
  'wave-arc': 'wave',
}

export function sparkGroupName(modeId: string): string {
  return `${SPARK_GROUP_PREFIX}${SPARK_KINDS[modeId] ?? modeId}`
}

/** Is this group a dropped spark, by the name it was given? */
export function isSparkGroup(group: { name: string }): boolean {
  return group.name.startsWith(SPARK_GROUP_PREFIX)
}

/** "Group N", the first N no group has taken. */
export function nextGroupName(objects: readonly VectorObject[]): string {
  const taken = new Set(objects.flatMap((object) => (object.type === 'group' ? [object.name] : [])))
  let n = 1
  while (taken.has(`Group ${n}`)) n++
  return `Group ${n}`
}
