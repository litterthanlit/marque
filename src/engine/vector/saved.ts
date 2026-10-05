import type { IllustratorDocument } from '../illustrator/types.ts'
import type { LogoParams } from '../types.ts'
import { isVectorDocument } from './document.ts'
import { illustratorDocumentToVectorDocument } from './legacyIllustratorAdapter.ts'
import { documentFromGeneratorLink, isIllustratorDocument } from './link.ts'
import type { VectorDocument } from './types.ts'

/** One entry of the saved list, as localStorage holds it. */
export interface SavedVariation {
  id: string
  name: string
  savedAt: string
  /** `fillColor` is the ink. An entry saved on the old Generate screen may hold nothing else to rebuild from. */
  params: LogoParams
  vectorDocument?: VectorDocument | null
  /** A layer document from before the vector format. */
  illustrator?: IllustratorDocument | null
}

export function createSavedVariation(document: VectorDocument, params: LogoParams): SavedVariation {
  const savedAt = new Date()
  return {
    id: crypto.randomUUID(),
    name: savedAt.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    savedAt: savedAt.toISOString(),
    params: structuredClone(params),
    vectorDocument: structuredClone(document),
  }
}

/** What an entry opens: its own document, or its generated mark as layers. Null when it cannot be read. */
export function savedDocument(entry: SavedVariation): { document: VectorDocument; inkColor: string } | null {
  const inkColor = entry.params.fillColor
  if (entry.vectorDocument) {
    return isVectorDocument(entry.vectorDocument) ? { document: entry.vectorDocument, inkColor } : null
  }
  if (entry.illustrator) {
    return isIllustratorDocument(entry.illustrator)
      ? { document: illustratorDocumentToVectorDocument(entry.illustrator, null, inkColor), inkColor }
      : null
  }
  try {
    return { document: documentFromGeneratorLink(entry.params), inkColor }
  } catch {
    // Parameters a generator no longer accepts.
    return null
  }
}
