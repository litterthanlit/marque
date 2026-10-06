import type { MarkData } from '../illustrator/types.ts'
import { composeIllustratorMark } from '../illustrator/compose.ts'
import { vectorDocumentToIllustratorDocument } from './view.ts'
import type { GroupObject, VectorDocument, VectorObject } from './types.ts'

export function composeVectorMark(document: VectorDocument): MarkData {
  return composeIllustratorMark(vectorDocumentToIllustratorDocument(document))
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

/** The last few marks by what they were composed from, newest first. */
const recentMarks: Array<{ key: InkKey; mark: MarkData }> = []
const RECENT_MARKS = 4

/**
 * The composed mark for a document. It is kept per objects array, so a
 * selection change and an undo cost nothing. A new array whose paths,
 * operations and groups are unchanged (a rename, a lock) reuses the mark
 * too. The canvas, previews and export all read this one result. A mark
 * composed with failed boolean steps says so once, as a warning: the
 * construction look shows a notice for as long as it is drawn.
 */
export function composeVectorMarkCached(document: VectorDocument): MarkData {
  const hit = markCache.get(document.objects)
  if (hit) return hit
  const key = inkKey(document.objects)
  const index = recentMarks.findIndex((entry) => sameKey(entry.key, key))
  const entry = index >= 0 ? recentMarks.splice(index, 1)[0] : { key, mark: composeVectorMark(document) }
  if (index < 0 && entry.mark.warnings) {
    // A warning, never an error: the end-to-end fixture fails on any console error.
    console.warn(`Vector Maker left ${entry.mark.warnings.length} shape(s) out of the mark:`, entry.mark.warnings)
  }
  recentMarks.unshift(entry)
  recentMarks.length = Math.min(recentMarks.length, RECENT_MARKS)
  markCache.set(document.objects, entry.mark)
  return entry.mark
}
