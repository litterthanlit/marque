import type { VectorDocument, VectorObject, VectorSelection } from './types.ts'

export interface VectorCommand {
  id: string
  label: string
  timestamp: number
  apply(document: VectorDocument): VectorDocument
  invert(document: VectorDocument): VectorDocument
  mergeWith?(next: VectorCommand): VectorCommand | null
}

function touch(document: VectorDocument): VectorDocument {
  return { ...document, updatedAt: new Date().toISOString() }
}

export function applyVectorCommand(document: VectorDocument, command: VectorCommand): VectorDocument {
  return touch(command.apply(document))
}

export function createSetSelectionCommand(selection: VectorSelection): VectorCommand {
  let previous: VectorSelection | null = null
  return {
    id: crypto.randomUUID(),
    label: 'Set selection',
    timestamp: Date.now(),
    apply(document) {
      previous = document.selection
      return { ...document, selection }
    },
    invert(document) {
      return { ...document, selection: previous ?? { targets: [] } }
    },
  }
}

export function createAddObjectsCommand(objects: VectorObject[]): VectorCommand {
  return {
    id: crypto.randomUUID(),
    label: 'Add objects',
    timestamp: Date.now(),
    apply(document) {
      return { ...document, objects: [...document.objects, ...objects] }
    },
    invert(document) {
      const ids = new Set(objects.map((object) => object.id))
      return {
        ...document,
        objects: document.objects.filter((object) => !ids.has(object.id)),
        selection: {
          targets: document.selection.targets.filter(
            (target) => target.type !== 'object' || !ids.has(target.objectId),
          ),
        },
      }
    },
  }
}

export function createDeleteObjectsCommand(objectIds: string[]): VectorCommand {
  let deleted: VectorObject[] = []
  const ids = new Set(objectIds)
  return {
    id: crypto.randomUUID(),
    label: 'Delete objects',
    timestamp: Date.now(),
    apply(document) {
      deleted = document.objects.filter((object) => ids.has(object.id))
      return {
        ...document,
        objects: document.objects.filter((object) => !ids.has(object.id)),
        selection: { targets: [] },
      }
    },
    invert(document) {
      return { ...document, objects: [...document.objects, ...deleted] }
    },
  }
}
