import paper from 'paper'
import type { GenerationResult } from '../types.ts'
import type { DissolutionParams, DissolutionResult, DissolutionCell } from './types.ts'
import type { EffectProcessor } from './registry.ts'
import { registerEffect } from './registry.ts'
import { SeededPRNG } from '../random.ts'

// Headless Paper.js scope for dissolution sampling
let dissolveScope: paper.PaperScope | null = null

function getScope(): paper.PaperScope {
  if (!dissolveScope) {
    dissolveScope = new paper.PaperScope()
    dissolveScope.setup(new paper.Size(1, 1))
  }
  dissolveScope.activate()
  return dissolveScope
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function expandViewBox(
  viewBox: { x: number; y: number; width: number; height: number },
  padding: number,
) {
  return {
    x: round3(viewBox.x - padding),
    y: round3(viewBox.y - padding),
    width: round3(viewBox.width + padding * 2),
    height: round3(viewBox.height + padding * 2),
  }
}

function createCellPath(cell: GridCell, cellSize: number): string {
  const half = round3(cellSize / 2)
  const x1 = round3(cell.cx - half)
  const y1 = round3(cell.cy - half)
  const x2 = round3(cell.cx + half)
  const y2 = round3(cell.cy + half)
  return `M${x1},${y1}L${x2},${y1}L${x2},${y2}L${x1},${y2}Z`
}

interface GridCell {
  col: number
  row: number
  cx: number
  cy: number
  filled: boolean
  density: number
  distance: number
  normalizedDist: number
}

const DissolutionProcessor: EffectProcessor<DissolutionParams, DissolutionResult> = {
  id: 'dissolution',

  process(result: GenerationResult, params: DissolutionParams): DissolutionResult | null {
    // Early exit conditions
    if (!params.enabled) return null
    if (params.threshold === 0) return null
    if (!result.mark.compoundPathData) return null

    const scope = getScope()
    scope.project.clear()

    const { cellSize, shape, scatter, sizeVariation, threshold } = params
    const viewBox = expandViewBox(
      result.mark.viewBox,
      scatter > 0 ? scatter * cellSize + cellSize : 0,
    )

    // Create mark path from compoundPathData (try CompoundPath first, fallback to Path)
    let markPath: paper.PathItem
    try {
      const cp = new scope.CompoundPath(result.mark.compoundPathData)
      if (cp.isEmpty()) {
        cp.remove()
        throw new Error('empty compound path')
      }
      markPath = cp
    } catch {
      try {
        const p = new scope.Path(result.mark.compoundPathData)
        if (p.isEmpty()) {
          p.remove()
          return null
        }
        markPath = p
      } catch {
        return null
      }
    }

    // Sample a grid over the mark's viewBox
    const cols = Math.ceil(viewBox.width / cellSize)
    const rows = Math.ceil(viewBox.height / cellSize)

    const grid: GridCell[][] = []
    for (let r = 0; r < rows; r++) {
      grid[r] = []
      for (let c = 0; c < cols; c++) {
        const cx = viewBox.x + (c + 0.5) * cellSize
        const cy = viewBox.y + (r + 0.5) * cellSize
        const centerPoint = new scope.Point(cx, cy)

        const centerHit = markPath.contains(centerPoint)

        // Sample 4 corner offsets to estimate fill density
        const halfCell = cellSize * 0.25
        const offsets = [
          new scope.Point(cx - halfCell, cy - halfCell),
          new scope.Point(cx + halfCell, cy - halfCell),
          new scope.Point(cx - halfCell, cy + halfCell),
          new scope.Point(cx + halfCell, cy + halfCell),
        ]
        let hits = centerHit ? 1 : 0
        for (const offset of offsets) {
          if (markPath.contains(offset)) hits++
        }
        const density = hits / 5

        grid[r][c] = {
          col: c,
          row: r,
          cx,
          cy,
          filled: centerHit,
          density,
          distance: -1,
          normalizedDist: 0,
        }
      }
    }

    // Clean up Paper.js objects
    markPath.remove()

    // Compute distance field via BFS
    // Find edge cells: filled cells adjacent to an empty cell
    const edgeCells: GridCell[] = []
    const directions = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[r][c].filled) continue
        let isEdge = false
        for (const [dr, dc] of directions) {
          const nr = r + dr
          const nc = c + dc
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !grid[nr][nc].filled) {
            isEdge = true
            break
          }
        }
        if (isEdge) {
          grid[r][c].distance = 0
          edgeCells.push(grid[r][c])
        }
      }
    }

    // BFS outward from edge cells
    const queue: GridCell[] = [...edgeCells]
    let maxDist = 0

    while (queue.length > 0) {
      const cell = queue.shift()!
      for (const [dr, dc] of directions) {
        const nr = cell.row + dr
        const nc = cell.col + dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        const neighbor = grid[nr][nc]
        if (!neighbor.filled) continue
        if (neighbor.distance >= 0) continue
        neighbor.distance = cell.distance + 1
        if (neighbor.distance > maxDist) maxDist = neighbor.distance
        queue.push(neighbor)
      }
    }

    // Normalize distances: 0 = edge, 1 = deepest interior
    if (maxDist > 0) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c].filled && grid[r][c].distance >= 0) {
            grid[r][c].normalizedDist = grid[r][c].distance / maxDist
          }
        }
      }
    }

    // Apply threshold and emit particles
    const rng = new SeededPRNG(42)
    const cells: DissolutionCell[] = []
    const particlePaths: string[] = []
    const corePaths: string[] = []

    // Collect dissolving cells and sort by distance for revealRank
    const dissolvingCells: GridCell[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c]
        if (!cell.filled) continue
        if (cell.normalizedDist < threshold) {
          dissolvingCells.push(cell)
        } else if (threshold < 1) {
          corePaths.push(createCellPath(cell, cellSize))
        }
      }
    }

    // Sort by distance (edge cells first = lower distance = revealed first)
    dissolvingCells.sort((a, b) => a.normalizedDist - b.normalizedDist)

    for (let i = 0; i < dissolvingCells.length; i++) {
      const cell = dissolvingCells[i]
      const sizeScale = 1 - sizeVariation * (1 - cell.density)
      const size = round3(cellSize * 0.85 * sizeScale)
      const half = round3(size / 2)

      let px = cell.cx
      let py = cell.cy

      // Apply scatter offset if scatter > 0
      if (scatter > 0) {
        const offsetX = (rng.next() - 0.5) * 2 * scatter * cellSize
        const offsetY = (rng.next() - 0.5) * 2 * scatter * cellSize
        px += offsetX
        py += offsetY
      }

      px = round3(px)
      py = round3(py)

      let pathD: string
      if (shape === 'circle') {
        // Circle: M/A/A/Z arc path
        const r = round3(half)
        pathD = `M${px - r},${py}A${r},${r},0,1,0,${px + r},${py}A${r},${r},0,1,0,${px - r},${py}Z`
      } else {
        // Square: M/L/Z rectangle path
        const x1 = round3(px - half)
        const y1 = round3(py - half)
        const x2 = round3(px + half)
        const y2 = round3(py + half)
        pathD = `M${x1},${y1}L${x2},${y1}L${x2},${y2}L${x1},${y2}Z`
      }

      particlePaths.push(pathD)

      cells.push({
        x: px,
        y: py,
        width: size,
        height: size,
        distance: round3(cell.normalizedDist),
        revealRank: i,
        shape,
      })
    }

    const solidCorePath = threshold < 1 && corePaths.length > 0
      ? corePaths.join('')
      : null

    return {
      particlePathData: particlePaths.join(''),
      solidCorePath,
      cells,
      viewBox,
    }
  },
}

// Auto-register at module level
registerEffect(DissolutionProcessor)

export { DissolutionProcessor }
