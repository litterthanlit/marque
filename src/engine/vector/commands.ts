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

function cloneSelection(selection: VectorSelection): VectorSelection {
  return { targets: selection.targets.map((target) => ({ ...target })) }
}

function cloneObjects(objects: VectorObject[]): VectorObject[] {
  return structuredClone(objects) as VectorObject[]
}

function withoutObjectTargets(selection: VectorSelection, objectIds: Set<string>): VectorSelection {
  return {
    targets: selection.targets.filter((target) => !objectIds.has(target.objectId)),
  }
}

export function applyVectorCommand(document: VectorDocument, command: VectorCommand): VectorDocument {
  return touch(command.apply(document))
}

export function invertVectorCommand(document: VectorDocument, command: VectorCommand): VectorDocument {
  return touch(command.invert(document))
}

export function createSetSelectionCommand(selection: VectorSelection): VectorCommand {
  const nextSelection = cloneSelection(selection)
  let previous: VectorSelection | null = null
  return {
    id: crypto.randomUUID(),
    label: 'Set selection',
    timestamp: Date.now(),
    apply(document) {
      previous = cloneSelection(document.selection)
      return { ...document, selection: cloneSelection(nextSelection) }
    },
    invert(document) {
      return { ...document, selection: previous ? cloneSelection(previous) : { targets: [] } }
    },
  }
}

export function createReplaceVectorDocumentCommand(
  label: string,
  before: VectorDocument,
  after: VectorDocument,
): VectorCommand {
  const previousDocument = structuredClone(before) as VectorDocument
  const nextDocument = structuredClone(after) as VectorDocument
  return {
    id: crypto.randomUUID(),
    label,
    timestamp: Date.now(),
    apply() {
      return structuredClone(nextDocument) as VectorDocument
    },
    invert() {
      return structuredClone(previousDocument) as VectorDocument
    },
  }
}

export function createAddObjectsCommand(objects: VectorObject[]): VectorCommand {
  const objectsToAdd = cloneObjects(objects)
  const ids = new Set(objectsToAdd.map((object) => object.id))
  return {
    id: crypto.randomUUID(),
    label: 'Add objects',
    timestamp: Date.now(),
    apply(document) {
      return { ...document, objects: [...document.objects, ...cloneObjects(objectsToAdd)] }
    },
    invert(document) {
      return {
        ...document,
        objects: document.objects.filter((object) => !ids.has(object.id)),
        selection: withoutObjectTargets(document.selection, ids),
      }
    },
  }
}

export function createDeleteObjectsCommand(objectIds: string[]): VectorCommand {
  const ids = new Set([...objectIds])
  let deleted: Array<{ index: number; object: VectorObject }> | null = null
  return {
    id: crypto.randomUUID(),
    label: 'Delete objects',
    timestamp: Date.now(),
    apply(document) {
      deleted = document.objects
        .map((object, index) => ({ index, object }))
        .filter(({ object }) => ids.has(object.id))
        .map(({ index, object }) => ({ index, object: cloneObjects([object])[0] }))
      return {
        ...document,
        objects: document.objects.filter((object) => !ids.has(object.id)),
        selection: withoutObjectTargets(document.selection, ids),
      }
    },
    invert(document) {
      const restoredObjects = [...document.objects]
      for (const { index, object } of deleted ?? []) {
        restoredObjects.splice(index, 0, cloneObjects([object])[0])
      }
      return { ...document, objects: restoredObjects }
    },
  }
}
