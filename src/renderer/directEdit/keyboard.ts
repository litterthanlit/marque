/**
 * Keys the canvas editors want first. App's global shortcuts ask here before
 * acting, so Delete removes a selected point before it removes the layer and
 * Escape steps back one level at a time.
 */
type KeyHandler = (event: KeyboardEvent) => boolean

const handlers: KeyHandler[] = []
let interacting = false

export function registerEditorKeys(handler: KeyHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.indexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

/** Returns true when an editor handled the key. Newest handler first. */
export function dispatchEditorKey(event: KeyboardEvent): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](event)) return true
  }
  return false
}

const pendingFlushes: Array<() => void> = []

/** An editor's edits that wait on a timer, such as a burst of arrow-key nudges, and how to commit them now. */
export function registerPendingEdits(flush: () => void): () => void {
  pendingFlushes.push(flush)
  return () => {
    const index = pendingFlushes.indexOf(flush)
    if (index >= 0) pendingFlushes.splice(index, 1)
  }
}

/**
 * Commit every edit that is waiting on a timer. Undo and redo call this
 * first, so a late commit cannot land on top of the state they restore.
 */
export function flushPendingEdits(): void {
  for (const flush of [...pendingFlushes]) flush()
}

/** True while a drag is in progress: undo and redo must wait. */
export function isEditorInteracting(): boolean {
  return interacting
}

export function setEditorInteracting(value: boolean): void {
  interacting = value
}

/** A key pressed on its own: no modifier held, and not a repeat from holding it down. */
export function isBareKey(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.repeat
}

/** Arrow-key nudges belong to the canvas only when nothing else has focus. */
export function canvasOwnsArrowKeys(): boolean {
  const active = document.activeElement
  return !active || active === document.body || active.tagName === 'CANVAS'
}
