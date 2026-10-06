import type { MarkData } from '../illustrator/types.ts'
import { composeIllustratorMark } from '../illustrator/compose.ts'
import { vectorDocumentToIllustratorDocument } from './legacyIllustratorAdapter.ts'
import type { VectorDocument, VectorObject } from './types.ts'

export function composeVectorMark(document: VectorDocument): MarkData {
  return composeIllustratorMark(vectorDocumentToIllustratorDocument(document))
}

/**
 * What composition reads, per visible path in stack order: the path itself
 * (by identity), whether it adds or cuts, its legacy transform and its fill
 * rule. Names, locks, selection and appearance are not in it.
 */
type InkKey = unknown[]

function inkKey(objects: VectorObject[]): InkKey {
  const key: unknown[] = []
  for (const object of objects) {
    if (object.type !== 'path' || !object.visible) continue
    const { a, b, c, d, e, f } = object.transform
    key.push(object.path, object.source?.compatOperation ?? 'add', a, b, c, d, e, f, object.fillRule)
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
 * selection change and an undo cost nothing. A new array whose visible paths,
 * operations and transforms are unchanged (a rename, a lock) reuses the mark
 * too. The canvas, previews and export all read this one result.
 */
export function composeVectorMarkCached(document: VectorDocument): MarkData {
  const hit = markCache.get(document.objects)
  if (hit) return hit
  const key = inkKey(document.objects)
  const index = recentMarks.findIndex((entry) => sameKey(entry.key, key))
  const entry = index >= 0 ? recentMarks.splice(index, 1)[0] : { key, mark: composeVectorMark(document) }
  recentMarks.unshift(entry)
  recentMarks.length = Math.min(recentMarks.length, RECENT_MARKS)
  markCache.set(document.objects, entry.mark)
  return entry.mark
}
