export interface ToolCallbacks {
  onPathComplete: (path: {
    tool: 'pencil' | 'pen' | 'graffiti'
    pathData: string
    fillColor: string | null
    strokeColor: string | null
    strokeWidth: number
    closed: boolean
  }) => void
}

export class PencilTool {
  private scope: paper.PaperScope
  private callbacks: ToolCallbacks
  private currentPath: paper.Path | null = null
  private strokeColor: string
  private strokeWidth: number

  constructor(
    scope: paper.PaperScope,
    callbacks: ToolCallbacks,
    options?: { strokeColor?: string; strokeWidth?: number },
  ) {
    this.scope = scope
    this.callbacks = callbacks
    this.strokeColor = options?.strokeColor ?? '#000000'
    this.strokeWidth = options?.strokeWidth ?? 2
  }

  onMouseDown(point: paper.Point) {
    this.currentPath = new this.scope.Path({
      strokeColor: new this.scope.Color(this.strokeColor),
      strokeWidth: this.strokeWidth,
      strokeCap: 'round',
      strokeJoin: 'round',
    })
    this.currentPath.add(point)
  }

  onMouseDrag(point: paper.Point) {
    if (!this.currentPath) return
    this.currentPath.add(point)
    this.scope.view.update()
  }

  onMouseUp(_point: paper.Point) {
    if (!this.currentPath) return
    // Smooth the path to reduce jaggedness
    this.currentPath.simplify(2.5)

    const pathData = this.currentPath.pathData
    if (pathData) {
      this.callbacks.onPathComplete({
        tool: 'pencil',
        pathData,
        fillColor: null,
        strokeColor: this.strokeColor,
        strokeWidth: this.strokeWidth,
        closed: false,
      })
    }
    this.currentPath = null
  }

  destroy() {
    if (this.currentPath) {
      this.currentPath.remove()
      this.currentPath = null
    }
  }
}
