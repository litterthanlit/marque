import type { IllustratorDocument } from '../illustrator/types.ts'
import type { LogoParams } from '../types.ts'
import { documentFromGeneratorLink, isIllustratorDocument } from './link.ts'
import { readLegacyLayers, readVectorDocument } from './migrate.ts'
import type { VectorDocument } from './types.ts'

/** One entry of the saved list, as localStorage holds it. */
export interface SavedVariation {
  id: string
  name: string
  savedAt: string
  /** `fillColor` is the ink. An entry saved on the old Generate screen may hold nothing else to rebuild from. */
  params: LogoParams
  /** Either schema version: an entry is upgraded when it is opened, never in storage. */
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

/**
 * What an entry opens: its own document (a version 1 document upgraded), or
 * its generated mark as layers. Null when it cannot be read. An entry that
 * holds a document it cannot read does not fall back to its parameters:
 * they rebuild the mark it started from, not the one that was saved.
 */
export function savedDocument(entry: SavedVariation): { document: VectorDocument; inkColor: string } | null {
  const inkColor = entry.params.fillColor
  if (entry.vectorDocument) {
    const document = readVectorDocument(entry.vectorDocument)
    return document ? { document, inkColor } : null
  }
  if (entry.illustrator) {
    const document = isIllustratorDocument(entry.illustrator) ? readLegacyLayers(entry.illustrator, inkColor) : null
    return document ? { document, inkColor } : null
  }
  try {
    return { document: documentFromGeneratorLink(entry.params), inkColor }
  } catch {
    // Parameters a generator no longer accepts.
    return null
  }
}
