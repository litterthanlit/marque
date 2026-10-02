import type { ShapeOverride } from '../store/logoStore.ts'

interface InteractionCallbacks {
  onSelect: (shapeId: string | null) => void
  onMove: (shapeId: string, dx: number, dy: number) => void
  /** Called on every drag step with the offset so far (not committed). */
  onDragPreview?: (shapeId: string, dx: number, dy: number) => void
  /** Called when the shape under the pointer changes (null = nothing). */
  onHover?: (shapeId: string | null) => void
}

const SELECTION_COLOR = '#3b82f6'

/**
 * Manages hit-testing and drag interactions on Paper.js items.
 * Call setup() after each render to bind to the current item map.
 */
export class InteractionLayer {
  private scope: paper.PaperScope
  private itemMap: Map<string, paper.Item> = new Map()
  private callbacks: InteractionCallbacks
  private selectedId: string | null = null
  private selectionRect: paper.Item | null = null
  private hoverOutline: paper.Item | null = null
  private hoverId: string | null = null
  private dragStart: paper.Point | null = null
  private dragOrigPos: paper.Point | null = null

  constructor(scope: paper.PaperScope, callbacks: InteractionCallbacks) {
    this.scope = scope
    this.callbacks = callbacks
  }

  setup(itemMap: Map<string, paper.Item>) {
    this.itemMap = itemMap
    this.clearSelection()
    this.clearHover()
    this.hoverId = null
  }

  /** Apply stored overrides (position, scale, rotation, visibility) to rendered items */
  applyOverrides(overrides: Record<string, ShapeOverride>) {
    for (const [id, override] of Object.entries(overrides)) {
      const item = this.itemMap.get(id)
      if (!item) continue

      if (override.hidden) {
        item.visible = false
        continue
      }

      if (override.dx !== 0 || override.dy !== 0) {
        item.translate(new this.scope.Point(override.dx, override.dy))
      }
      if (override.scale !== 1) {
        item.scale(override.scale)
      }
      if (override.rotation !== 0) {
        item.rotate(override.rotation)
      }
    }
  }

  /** Show selection highlight around a shape */
  showSelection(shapeId: string | null) {
    this.clearSelection()
    this.selectedId = shapeId
    if (!shapeId) return

    const item = this.itemMap.get(shapeId)
    if (!item || !item.visible) return

    this.selectionRect = this.outline(item, false)
    this.scope.view.update()
  }

  /** Trace the item's real shape. Holes have no ink, so a box would point at nothing. */
  private outline(item: paper.Item, dashed: boolean): paper.Item {
    const copy = item.clone({ insert: true, deep: true })
    copy.name = ''
    copy.data = {}
    copy.opacity = 1
    copy.fillColor = null
    copy.strokeColor = new this.scope.Color(SELECTION_COLOR)
    copy.strokeWidth = dashed ? 1 : 1.5
    copy.dashArray = dashed ? [4, 4] : []
    copy.locked = true
    copy.bringToFront()
    return copy
  }

  private clearHover() {
    if (this.hoverOutline) {
      this.hoverOutline.remove()
      this.hoverOutline = null
    }
  }

  private shapeAt(point: paper.Point): string | null {
    const hit = this.scope.project.hitTest(point, {
      fill: true,
      tolerance: 5,
      match: (result: paper.HitResult) => Boolean(result.item?.name && this.itemMap.has(result.item.name)),
    })
    return hit?.item?.name ?? null
  }

  /** Pointer moved with no button down: outline whatever is under it. */
  hover(point: paper.Point) {
    const id = this.shapeAt(point)
    if (id === this.hoverId) return
    this.hoverId = id
    this.clearHover()
    const item = id && id !== this.selectedId ? this.itemMap.get(id) : null
    if (item?.visible) this.hoverOutline = this.outline(item, true)
    this.callbacks.onHover?.(id)
    this.scope.view.update()
  }

  private clearSelection() {
    if (this.selectionRect) {
      this.selectionRect.remove()
      this.selectionRect = null
    }
  }

  /** Handle mouse down — hit test and start drag */
  onMouseDown(point: paper.Point): boolean {
    const shapeId = this.shapeAt(point)
    if (!shapeId) {
      this.callbacks.onSelect(null)
      return false
    }

    this.clearHover()
    this.callbacks.onSelect(shapeId)
    this.selectedId = shapeId
    this.dragStart = point
    this.dragOrigPos = this.itemMap.get(shapeId)!.position.clone()
    return true
  }

  /** Handle mouse drag — move selected shape */
  onMouseDrag(point: paper.Point) {
    if (!this.dragStart || !this.selectedId || !this.dragOrigPos) {
      this.hover(point)
      return
    }

    const item = this.itemMap.get(this.selectedId)
    if (!item) return

    const delta = point.subtract(this.dragStart)
    item.position = this.dragOrigPos.add(delta)
    this.showSelection(this.selectedId)
    this.callbacks.onDragPreview?.(this.selectedId, delta.x, delta.y)
    this.scope.view.update()
  }

  /** Handle mouse up — commit the drag as an override */
  onMouseUp(point: paper.Point) {
    if (!this.dragStart || !this.selectedId || !this.dragOrigPos) {
      this.dragStart = null
      return
    }

    const delta = point.subtract(this.dragStart)
    if (delta.length > 2) {
      this.callbacks.onMove(this.selectedId, delta.x, delta.y)
    }

    this.dragStart = null
    this.dragOrigPos = null
  }

  destroy() {
    this.clearSelection()
    this.clearHover()
    this.itemMap.clear()
  }
}
