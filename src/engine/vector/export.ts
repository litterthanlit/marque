import type { MarkData } from '../illustrator/types.ts'
import { composeIllustratorMark } from '../illustrator/compose.ts'
import { applyFillets, cornerSources } from '../fillet/apply.ts'
import { stackOf, vectorDocumentToIllustratorDocument } from './view.ts'
import type { Fillet, GroupObject, VectorDocument, VectorObject } from './types.ts'

/** The mark of a document, composed afresh, with its fillets on. */
export function composeVectorMark(document: VectorDocument): MarkData {
  const base = composeIllustratorMark(vectorDocumentToIllustratorDocument(document))
  return document.fillets.length ? applyFillets(base, document.fillets, cornerSources(document.objects)) : base
}

/**
 * What composition reads, in stack order: for each path that shows (it and
 * every group above it visible), its contours (by identity), whether it adds
 * or cuts, its fill rule and the isolated group it composes in; for each
 * isolated group that shows, its id, operation and the isolated group it
 * sits in. A shared group changes nothing it composes, so putting paths into
 * one or taking them out keeps the key, as names, locks, frames, links,
 * guides and the selection do.
 */
type InkKey = unknown[]

function inkKey(objects: VectorObject[]): InkKey {
  const groups = new Map<string, GroupObject>()
  for (const object of objects) if (object.type === 'group') groups.set(object.id, object)
  // Walks up the groups above an object; repairStructure keeps every chain short and free of loops.
  const placeOf = (parentId: string | null): { shows: boolean; isolatedIn: string | null } => {
    let shows = true
    let isolatedIn: string | null = null
    for (let group = parentId === null ? undefined : groups.get(parentId); group; group = group.parentId === null ? undefined : groups.get(group.parentId)) {
      if (!group.visible) shows = false
      if (group.isolated && isolatedIn === null) isolatedIn = group.id
    }
    return { shows, isolatedIn }
  }
  const key: unknown[] = []
  for (const object of objects) {
    if (!object.visible) continue
    const { shows, isolatedIn } = placeOf(object.parentId)
    if (!shows) continue
    if (object.type === 'group') {
      if (object.isolated) key.push('isolated', object.id, object.operation, isolatedIn)
    } else {
      key.push(object.contours, object.operation, object.fillRule, isolatedIn)
    }
  }
  return key
}

function sameKey(a: InkKey, b: InkKey): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

const markCache = new WeakMap<VectorObject[], MarkData>()

/** The last few base marks by what they were composed from, newest first. */
const recentMarks: Array<{ key: InkKey; mark: MarkData }> = []
const RECENT_MARKS = 4

/**
 * The composed mark of some objects, before any fillet. It is kept per
 * objects array, so a selection change and an undo cost nothing. A new array
 * whose paths, operations and groups are unchanged (a rename, a lock) reuses
 * the mark too. A mark composed with failed boolean steps says so once, as a
 * warning.
 */
export function composeBaseMark(objects: VectorObject[]): MarkData {
  const hit = markCache.get(objects)
  if (hit) return hit
  const key = inkKey(objects)
  const index = recentMarks.findIndex((entry) => sameKey(entry.key, key))
  const entry = index >= 0 ? recentMarks.splice(index, 1)[0] : { key, mark: composeIllustratorMark(stackOf(objects)) }
  if (index < 0) warnOnce(entry.mark.warnings, 'shape(s) out of the mark')
  recentMarks.unshift(entry)
  recentMarks.length = Math.min(recentMarks.length, RECENT_MARKS)
  markCache.set(objects, entry.mark)
  return entry.mark
}

function warnOnce(warnings: string[] | undefined, what: string) {
  // A warning, never an error: the end-to-end fixture fails on any console error.
  if (warnings?.length) console.warn(`Vector Maker left ${warnings.length} ${what}:`, warnings)
}

/** Each base mark's last few filleted marks, by the fillets and the paths that show, newest first. */
const filletedMarks = new WeakMap<MarkData, Array<{ fillets: Fillet[]; ids: string; mark: MarkData }>>()
const RECENT_FILLETED = 4

/** The ids of the paths, in stack order: which object a corner belongs to reads them. */
function idsKey(objects: VectorObject[]): string {
  return objects.map((object) => object.id).join(' ')
}

/**
 * The composed mark for a document, with its fillets on: what the canvas,
 * previews, survival and export all read. The base mark and the fillet pass
 * are kept apart, so a fillet edit never composes the base again, and an
 * edit that leaves the ink and the fillets alone costs nothing. A mark with
 * failed boolean steps says so once, as a warning: the construction look
 * shows a notice for as long as it is drawn.
 */
export function composeVectorMarkCached(document: VectorDocument): MarkData {
  const base = composeBaseMark(document.objects)
  if (!document.fillets.length) return base
  let entries = filletedMarks.get(base)
  if (!entries) filletedMarks.set(base, (entries = []))
  const ids = idsKey(document.objects)
  const index = entries.findIndex((entry) => entry.fillets === document.fillets && entry.ids === ids)
  const entry = index >= 0 ? entries.splice(index, 1)[0] : { fillets: document.fillets, ids, mark: applyFillets(base, document.fillets, cornerSources(document.objects)) }
  if (index < 0 && entry.mark !== base) {
    const added = (entry.mark.warnings?.length ?? 0) - (base.warnings?.length ?? 0)
    if (added > 0) warnOnce(entry.mark.warnings!.slice(-added), 'fillet(s) off the mark')
  }
  entries.unshift(entry)
  entries.length = Math.min(entries.length, RECENT_FILLETED)
  return entry.mark
}
