export class GraffitiTool {
  private scope: paper.PaperScope
  private callbacks: { onPathComplete: (path: {
    tool: 'pencil' | 'pen' | 'graffiti' | 'shapebuilder'
    pathData: string
    fillColor: string | null
    strokeColor: string | null
    strokeWidth: number
    closed: boolean
  }) => void }
  private particles: paper.Path[] = []
  private fillColor: string
  private sprayRadius: number
  private density: number
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastPoint: paper.Point | null = null

  constructor(
    scope: paper.PaperScope,
    callbacks: GraffitiTool['callbacks'],
    options?: { fillColor?: string; sprayRadius?: number; density?: number },
  ) {
    this.scope = scope
    this.callbacks = callbacks
    this.fillColor = options?.fillColor ?? '#000000'
    this.sprayRadius = options?.sprayRadius ?? 30
    this.density = options?.density ?? 8
  }

  onMouseDown(point: paper.Point) {
    this.lastPoint = point
    this.spray(point)
    // Keep spraying while mouse is held
    this.intervalId = setInterval(() => {
      if (this.lastPoint) this.spray(this.lastPoint)
    }, 50)
  }

  onMouseDrag(point: paper.Point) {
    this.lastPoint = point
    this.spray(point)
  }

  onMouseUp(_point: paper.Point) {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.lastPoint = null

    if (this.particles.length === 0) return

    // Merge all particles into one compound path for storage
    const compound = new this.scope.CompoundPath({
      children: this.particles.map((p) => p.clone()),
      fillColor: new this.scope.Color(this.fillColor),
    })

    const pathData = compound.pathData
    compound.remove()

    // Clean up individual particles
    for (const p of this.particles) p.remove()
    this.particles = []

    if (pathData) {
      this.callbacks.onPathComplete({
        tool: 'graffiti',
        pathData,
        fillColor: this.fillColor,
        strokeColor: null,
        strokeWidth: 0,
        closed: true,
      })
    }

    this.scope.view.update()
  }

  private spray(center: paper.Point) {
    for (let i = 0; i < this.density; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * this.sprayRadius
      const x = center.x + Math.cos(angle) * radius
      const y = center.y + Math.sin(angle) * radius
      const size = 1 + Math.random() * 3

      const dot = new this.scope.Path.Circle(
        new this.scope.Point(x, y),
        size,
      )
      dot.fillColor = new this.scope.Color(this.fillColor)
      this.particles.push(dot)
    }
    this.scope.view.update()
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const p of this.particles) p.remove()
    this.particles = []
  }
}
