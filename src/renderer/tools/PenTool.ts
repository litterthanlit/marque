export class PenTool {
  private scope: paper.PaperScope
  private callbacks: { onPathComplete: (path: {
    tool: 'pencil' | 'pen' | 'graffiti' | 'shapebuilder'
    pathData: string
    fillColor: string | null
    strokeColor: string | null
    strokeWidth: number
    closed: boolean
  }) => void }
  private currentPath: paper.Path | null = null
  private strokeColor: string
  private strokeWidth: number
  private handleIn: paper.Point | null = null

  constructor(
    scope: paper.PaperScope,
    callbacks: PenTool['callbacks'],
    options?: { strokeColor?: string; strokeWidth?: number },
  ) {
    this.scope = scope
    this.callbacks = callbacks
    this.strokeColor = options?.strokeColor ?? '#000000'
    this.strokeWidth = options?.strokeWidth ?? 2
  }

  onMouseDown(point: paper.Point) {
    if (!this.currentPath) {
      this.currentPath = new this.scope.Path({
        strokeColor: new this.scope.Color(this.strokeColor),
        strokeWidth: this.strokeWidth,
        strokeCap: 'round',
        fillColor: null,
      })
    }

    const segment = this.currentPath.add(point) as paper.Segment
    if (this.handleIn) {
      segment.handleIn = this.handleIn
      this.handleIn = null
    }
    this.scope.view.update()
  }

  onMouseDrag(point: paper.Point) {
    if (!this.currentPath || this.currentPath.segments.length === 0) return
    const lastSeg = this.currentPath.lastSegment
    const handle = point.subtract(lastSeg.point)
    lastSeg.handleOut = handle
    this.handleIn = handle.multiply(-1)
    this.scope.view.update()
  }

  onMouseUp(_point: paper.Point) {
    // Path stays open until finalize() is called
  }

  /** Call on double-click or Enter to complete the path */
  finalize() {
    if (!this.currentPath || this.currentPath.segments.length < 2) {
      this.cancel()
      return
    }

    const pathData = this.currentPath.pathData
    if (pathData) {
      this.callbacks.onPathComplete({
        tool: 'pen',
        pathData,
        fillColor: null,
        strokeColor: this.strokeColor,
        strokeWidth: this.strokeWidth,
        closed: false,
      })
    }
    this.currentPath = null
    this.handleIn = null
  }

  cancel() {
    if (this.currentPath) {
      this.currentPath.remove()
      this.currentPath = null
    }
    this.handleIn = null
  }

  get isDrawing(): boolean {
    return this.currentPath !== null && this.currentPath.segments.length > 0
  }

  destroy() {
    this.cancel()
  }
}
