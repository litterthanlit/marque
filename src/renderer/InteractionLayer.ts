import type { ShapeOverride } from '../store/logoStore.ts'

interface InteractionCallbacks {
  onSelect: (shapeId: string | null) => void
  onMove: (shapeId: string, dx: number, dy: number) => void
}

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
  private dragStart: paper.Point | null = null
  private dragOrigPos: paper.Point | null = null

  constructor(scope: paper.PaperScope, callbacks: InteractionCallbacks) {
    this.scope = scope
    this.callbacks = callbacks
  }

  setup(itemMap: Map<string, paper.Item>) {
    this.itemMap = itemMap
    this.clearSelection()
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

    const bounds = item.bounds.expand(6)
    this.selectionRect = new this.scope.Path.Rectangle({
      rectangle: bounds,
      strokeColor: new this.scope.Color('#3b82f6'),
      strokeWidth: 1.5,
      dashArray: [4, 4],
      fillColor: null,
    })
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
    const hitResult = this.scope.project.hitTest(point, {
      fill: true,
      tolerance: 5,
    })

    if (!hitResult || !hitResult.item?.name) {
      this.callbacks.onSelect(null)
      return false
    }

    const shapeId = hitResult.item.name
    if (!this.itemMap.has(shapeId)) {
      this.callbacks.onSelect(null)
      return false
    }

    this.callbacks.onSelect(shapeId)
    this.dragStart = point
    this.dragOrigPos = hitResult.item.position.clone()
    return true
  }

  /** Handle mouse drag — move selected shape */
  onMouseDrag(point: paper.Point) {
    if (!this.dragStart || !this.selectedId || !this.dragOrigPos) return

    const item = this.itemMap.get(this.selectedId)
    if (!item) return

    const delta = point.subtract(this.dragStart)
    item.position = this.dragOrigPos.add(delta)
    this.showSelection(this.selectedId)
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
    this.itemMap.clear()
  }
}
