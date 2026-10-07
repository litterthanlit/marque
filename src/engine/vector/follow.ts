import { constructionLine, sameGuideShape } from './guides.ts'
import { followOffsets, isEmptyCopy } from './offsets.ts'
import { followPins } from './pins.ts'
import type { Fillet, Guide, PathObject, VectorObject } from './types.ts'

/**
 * The follow pass. Some things are made from objects and remember it: a
 * construction guide is a line of its shape. After an edit, the pass rebuilds
 * each of them whose source changed, so it follows the source. One whose
 * source is gone, or no longer has what it was made from, is detached in the
 * same edit: it keeps its last geometry and becomes a plain one, and an undo
 * restores both. A recipe pinned to an object's centre moves with it, and an
 * offset copy is made again from its source. Later steps add their own
 * followers here (bands, fillets); each reads the lists the earlier ones left.
 *
 * It is pure, and hands back the very same arrays, and the very same items in
 * them, wherever nothing changed.
 */

/** The lists of a document that edits write and history keeps, by reference. */
export interface DocumentLists {
  objects: VectorObject[]
  guides: Guide[]
  fillets: Fillet[]
}

/** What one follower sees: the lists so far, the objects by id, and what changed. */
interface FollowContext {
  lists: DocumentLists
  byId: Map<string, VectorObject>
  /** Ids whose object is new, replaced or gone; null when every object counts as changed. */
  changed: Set<string> | null
  /**
   * Guides that are new or replaced in this edit, whatever their source did:
   * one added from a stale reading of its source, or linked to a source
   * already gone, is set right in the same edit. Null with `changed`.
   */
  freshGuides: Set<Guide> | null
  /** True while pins and copies take turns: a pin is not let go before its target has settled. */
  settling: boolean
  /** The objects as they were before the edit, by id; null as a document opens. */
  was: ReadonlyMap<string, VectorObject> | null
}

type Follower = (context: FollowContext) => DocumentLists

/**
 * Pins and offset copies move objects that other pins and copies may follow
 * in turn: a recipe pinned to a copy's centre, an offset of that recipe. So
 * they take turns, pins first, until a round moves nothing; each round
 * settles at least one more link of any chain, so there are no more rounds
 * than objects. Each sees only what the edit changed and what the other
 * moved since its last turn: it settles its own chains, so nothing is made
 * twice in one pass. Whether a recipe moved off its target lets go is
 * decided once all has settled, against where the target landed. Guides
 * follow whatever moved, last.
 */
const SETTLING: Follower[] = [followPinned, followOffsetCopies]
const FOLLOWERS: Follower[] = [followConstructionGuides]

/**
 * Bring everything that follows an object up to date after an edit from
 * `before` to `after`. With no `before` (opening a document), every object
 * counts as changed.
 */
export function follow(before: DocumentLists | null, after: DocumentLists): DocumentLists {
  const changed = before ? changedIds(before.objects, after.objects) : null
  const freshGuides = before ? freshLinkedGuides(before.guides, after.guides) : null
  if (changed && changed.size === 0 && freshGuides?.size === 0) return after
  let lists = after
  let moved = changed
  /** What each settling follower has yet to see: null when everything counts as changed. */
  const unseen = SETTLING.map(() => (changed ? new Set(changed) : null))
  const was = before ? new Map(before.objects.map((object) => [object.id, object])) : null
  /** Run one follower on what it is to see; the ids it moved, null when none. */
  const run = (follower: Follower, due: Set<string> | null, settling: boolean): Set<string> | null => {
    const next = follower({ lists, byId: new Map(lists.objects.map((object) => [object.id, object])), changed: due, freshGuides, settling, was })
    if (next.objects === lists.objects) {
      lists = next
      return null
    }
    const ids = changedIds(lists.objects, next.objects)
    // An object a follower moved counts as changed for the ones after it.
    if (moved) moved = new Set([...moved, ...ids])
    lists = next
    return ids
  }
  for (let round = 0; round <= after.objects.length; round++) {
    let touched = false
    SETTLING.forEach((follower, k) => {
      const due = unseen[k]
      if (due?.size === 0) return
      if (due) unseen[k] = new Set()
      const ids = run(follower, due, true)
      if (!ids) return
      touched = true
      unseen.forEach((other, j) => {
        if (j !== k && other) for (const id of ids) other.add(id)
      })
    })
    if (!touched) break
  }
  if (moved) run(followPinned, moved, false)
  for (const follower of FOLLOWERS) run(follower, moved, false)
  return lists
}

/** The linked guides of `after` that `before` does not hold: added or replaced in this edit. */
function freshLinkedGuides(before: readonly Guide[], after: readonly Guide[]): Set<Guide> {
  if (before === after) return new Set()
  const known = new Set(before)
  return new Set(after.filter((guide) => guide.link && !known.has(guide)))
}

/** Ids whose object was added, replaced or removed. */
export function changedIds(before: readonly VectorObject[], after: readonly VectorObject[]): Set<string> {
  if (before === after) return new Set()
  const known = new Set(before)
  const changed = new Set<string>()
  const present = new Set<string>()
  for (const object of after) {
    present.add(object.id)
    if (!known.has(object)) changed.add(object.id)
  }
  for (const object of before) if (!present.has(object.id)) changed.add(object.id)
  return changed
}

/* ─── Pins ─── */

function followPinned({ lists, changed, settling, was }: FollowContext): DocumentLists {
  const { objects } = followPins(lists.objects, changed, !settling, was)
  return objects === lists.objects ? lists : { ...lists, objects }
}

/* ─── Offset copies ─── */

function followOffsetCopies({ lists, changed }: FollowContext): DocumentLists {
  const objects = followOffsets(lists.objects, changed)
  return objects === lists.objects ? lists : { ...lists, objects }
}

/* ─── Construction guides ─── */

function followConstructionGuides({ lists, byId, changed, freshGuides }: FollowContext): DocumentLists {
  const due = (guide: Guide) => !changed || !freshGuides || freshGuides.has(guide) || (guide.link !== undefined && changed.has(guide.link.of))
  let touched = false
  const guides = lists.guides.map((guide) => {
    const next = due(guide) ? followGuide(guide, byId) : guide
    if (next !== guide) touched = true
    return next
  })
  return touched ? { ...lists, guides } : lists
}

/**
 * One guide read again from its source: rebuilt where its line moved, and
 * named for where it now lies; detached; or the same guide, as it is while
 * its source is an offset copy left empty. A spoke keeps its
 * name, which counts it among its shape's spokes, not by where it lies.
 */
function followGuide(guide: Guide, byId: Map<string, VectorObject>): Guide {
  const link = guide.link
  if (!link) return guide
  const source = byId.get(link.of)
  // An offset copy left empty by its source comes back when the source grows: its guides keep their link and their last line.
  if (isEmptyCopy(source)) return guide
  const line = source?.type === 'path' ? constructionLine(source as PathObject, link.role) : null
  if (!line) return detachGuide(guide)
  if (sameGuideShape(line.shape, guide.shape)) return guide
  return { ...guide, shape: line.shape, name: link.role.startsWith('axis-') ? guide.name : line.name }
}

/** A guide that no longer follows anything: the same line, a plain guide. */
export function detachGuide(guide: Guide): Guide {
  if (!guide.link) return guide
  const { link: _link, ...rest } = guide
  return rest
}
