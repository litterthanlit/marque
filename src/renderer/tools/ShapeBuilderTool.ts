export class ShapeBuilderTool {
  private scope: paper.PaperScope
  private callbacks: {
    onPathComplete: (path: {
      tool: 'shapebuilder'
      pathData: string
      fillColor: string | null
      strokeColor: string | null
      strokeWidth: number
      closed: boolean
    }) => void
  }
  private currentPath: paper.Path | null = null
  private previewLine: paper.Path | null = null
  private handleGroup: paper.Group | null = null
  private fillColor: string
  private handleIn: paper.Point | null = null

  constructor(
    scope: paper.PaperScope,
    callbacks: ShapeBuilderTool['callbacks'],
    options?: { fillColor?: string },
  ) {
    this.scope = scope
    this.callbacks = callbacks
    this.fillColor = options?.fillColor ?? '#000000'
    this.handleGroup = new scope.Group()
    this.handleGroup.name = 'shapebuilder-handles'
  }

  onMouseDown(point: paper.Point) {
    // Check if clicking near first point to close the shape
    if (this.currentPath && this.currentPath.segments.length >= 3) {
      const firstPoint = this.currentPath.firstSegment.point
      if (point.getDistance(firstPoint) < 12) {
        this.closePath()
        return
      }
    }

    if (!this.currentPath) {
      this.currentPath = new this.scope.Path({
        strokeColor: new this.scope.Color(this.fillColor),
        strokeWidth: 1.5,
        fillColor: new this.scope.Color(this.fillColor + '33'),
        strokeCap: 'round',
        strokeJoin: 'round',
      })
    }

    const segment = this.currentPath.add(point) as paper.Segment
    if (this.handleIn) {
      segment.handleIn = this.handleIn
      this.handleIn = null
    }

    this.drawHandles()
    this.scope.view.update()
  }

  onMouseDrag(point: paper.Point) {
    if (!this.currentPath || this.currentPath.segments.length === 0) return

    const lastSeg = this.currentPath.lastSegment
    const handle = point.subtract(lastSeg.point)
    lastSeg.handleOut = handle
    this.handleIn = handle.multiply(-1)

    this.drawHandles()
    this.updatePreviewLine(point)
    this.scope.view.update()
  }

  onMouseMove(point: paper.Point) {
    if (!this.currentPath || this.currentPath.segments.length === 0) return
    this.updatePreviewLine(point)

    // Highlight first point when close enough to close
    if (this.currentPath.segments.length >= 3) {
      const firstPoint = this.currentPath.firstSegment.point
      const isClose = point.getDistance(firstPoint) < 12
      this.drawHandles(isClose)
    }

    this.scope.view.update()
  }

  onMouseUp(_point: paper.Point) {
    // no-op
  }

  private updatePreviewLine(cursorPoint: paper.Point) {
    if (this.previewLine) {
      this.previewLine.remove()
      this.previewLine = null
    }
    if (!this.currentPath || this.currentPath.segments.length === 0) return

    const lastPoint = this.currentPath.lastSegment.point
    this.previewLine = new this.scope.Path({
      segments: [lastPoint, cursorPoint],
      strokeColor: new this.scope.Color(this.fillColor + '66'),
      strokeWidth: 1,
      dashArray: [4, 4],
    })
  }

  private drawHandles(highlightFirst = false) {
    if (!this.handleGroup) return
    this.handleGroup.removeChildren()
    if (!this.currentPath) return

    for (let i = 0; i < this.currentPath.segments.length; i++) {
      const seg = this.currentPath.segments[i]
      const isFirst = i === 0

      // Anchor point
      const dot = new this.scope.Path.Circle({
        center: seg.point,
        radius: isFirst && highlightFirst ? 6 : 4,
        fillColor: new this.scope.Color(isFirst ? '#4A90D9' : '#ffffff'),
        strokeColor: new this.scope.Color(isFirst ? '#2563eb' : this.fillColor),
        strokeWidth: 1.5,
      })
      this.handleGroup!.addChild(dot)

      // Handle lines & dots
      if (!seg.handleIn.isZero()) {
        const handlePoint = seg.point.add(seg.handleIn)
        const line = new this.scope.Path({
          segments: [seg.point, handlePoint],
          strokeColor: new this.scope.Color('#4A90D9'),
          strokeWidth: 1,
        })
        const handleDot = new this.scope.Path.Circle({
          center: handlePoint,
          radius: 3,
          fillColor: new this.scope.Color('#4A90D9'),
        })
        this.handleGroup!.addChild(line)
        this.handleGroup!.addChild(handleDot)
      }
      if (!seg.handleOut.isZero()) {
        const handlePoint = seg.point.add(seg.handleOut)
        const line = new this.scope.Path({
          segments: [seg.point, handlePoint],
          strokeColor: new this.scope.Color('#4A90D9'),
          strokeWidth: 1,
        })
        const handleDot = new this.scope.Path.Circle({
          center: handlePoint,
          radius: 3,
          fillColor: new this.scope.Color('#4A90D9'),
        })
        this.handleGroup!.addChild(line)
        this.handleGroup!.addChild(handleDot)
      }
    }
  }

  private closePath() {
    if (!this.currentPath || this.currentPath.segments.length < 3) return

    this.currentPath.closePath()

    const pathData = this.currentPath.pathData
    if (pathData) {
      this.callbacks.onPathComplete({
        tool: 'shapebuilder',
        pathData,
        fillColor: this.fillColor,
        strokeColor: null,
        strokeWidth: 0,
        closed: true,
      })
    }

    this.cleanup()
  }

  /** Double-click or Enter to close and finalize */
  finalize() {
    if (!this.currentPath || this.currentPath.segments.length < 3) {
      this.cancel()
      return
    }
    this.closePath()
  }

  cancel() {
    this.cleanup()
  }

  private cleanup() {
    if (this.currentPath) {
      this.currentPath.remove()
      this.currentPath = null
    }
    if (this.previewLine) {
      this.previewLine.remove()
      this.previewLine = null
    }
    if (this.handleGroup) {
      this.handleGroup.removeChildren()
    }
    this.handleIn = null
    this.scope.view.update()
  }

  get isDrawing(): boolean {
    return this.currentPath !== null && this.currentPath.segments.length > 0
  }

  destroy() {
    this.cleanup()
    if (this.handleGroup) {
      this.handleGroup.remove()
      this.handleGroup = null
    }
  }
}
