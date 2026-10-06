import { constructionLine, sameGuideShape } from './guides.ts'
import type { Fillet, Guide, PathObject, VectorObject } from './types.ts'

/**
 * The follow pass. Some things are made from objects and remember it: a
 * construction guide is a line of its shape. After an edit, the pass rebuilds
 * each of them whose source changed, so it follows the source. One whose
 * source is gone, or no longer has what it was made from, is detached in the
 * same edit: it keeps its last geometry and becomes a plain one, and an undo
 * restores both. Later steps add their own followers here (bands, offsets,
 * pins, fillets); each reads the lists the earlier ones left.
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
}

type Follower = (context: FollowContext) => DocumentLists

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
  for (const follower of FOLLOWERS) {
    lists = follower({ lists, byId: new Map(lists.objects.map((object) => [object.id, object])), changed, freshGuides })
  }
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

/** One guide read again from its source: rebuilt where its line moved, and named for where it now lies; detached; or the same guide. */
function followGuide(guide: Guide, byId: Map<string, VectorObject>): Guide {
  const link = guide.link
  if (!link) return guide
  const source = byId.get(link.of)
  const line = source?.type === 'path' ? constructionLine(source as PathObject, link.role) : null
  if (!line) return detachGuide(guide)
  return sameGuideShape(line.shape, guide.shape) ? guide : { ...guide, shape: line.shape, name: line.name }
}

/** A guide that no longer follows anything: the same line, a plain guide. */
export function detachGuide(guide: Guide): Guide {
  if (!guide.link) return guide
  const { link: _link, ...rest } = guide
  return rest
}
