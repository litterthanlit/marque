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

/** True while a drag is in progress: undo and redo must wait. */
export function isEditorInteracting(): boolean {
  return interacting
}

export function setEditorInteracting(value: boolean): void {
  interacting = value
}

/** Arrow-key nudges belong to the canvas only when nothing else has focus. */
export function canvasOwnsArrowKeys(): boolean {
  const active = document.activeElement
  return !active || active === document.body || active.tagName === 'CANVAS'
}
