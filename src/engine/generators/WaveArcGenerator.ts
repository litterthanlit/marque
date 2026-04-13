import type {
  LogoGenerator,
  LogoParams,
  SeededRandom,
  GenerationResult,
  ShapeNode,
} from '../types.ts'
import { composeBooleanResult } from '../boolean/operations.ts'
import { generateWaveArcKeyframes } from '../animation/keyframes.ts'

const CANVAS_SIZE = 500
const MAX_CRESCENTS = 96

// ---------------------------------------------------------------------------
// Helper: negate all X coordinates in an SVG path string
// ---------------------------------------------------------------------------
function mirrorPathX(pathData: string): string {
  const tokens = pathData.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return pathData

  const output: string[] = []
  let i = 0

  while (i < tokens.length) {
    const cmd = tokens[i]
    if (!/^[A-Za-z]$/.test(cmd)) {
      output.push(tokens[i])
      i++
      continue
    }

    output.push(cmd)
    i++

    const upper = cmd.toUpperCase()

    if (upper === 'Z') {
      continue
    }

    if (upper === 'H') {
      // Single x value
      while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
        output.push(String(-parseFloat(tokens[i])))
        i++
      }
      continue
    }

    if (upper === 'V') {
      // Single y value — no change
      while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
        output.push(tokens[i])
        i++
      }
      continue
    }

    if (upper === 'A') {
      // A rx ry x-rotation large-arc sweep x y
      while (i + 6 < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
        output.push(tokens[i])     // rx
        output.push(tokens[i + 1]) // ry
        output.push(tokens[i + 2]) // x-rotation
        output.push(tokens[i + 3]) // large-arc
        // Flip sweep flag
        output.push(tokens[i + 4] === '0' ? '1' : '0')
        // Negate x
        output.push(String(-parseFloat(tokens[i + 5])))
        // y unchanged
        output.push(tokens[i + 6])
        i += 7
      }
      continue
    }

    // Determine pair count per implicit repetition
    let pairCount = 1 // default for M, L, T
    if (upper === 'C') pairCount = 3
    else if (upper === 'S' || upper === 'Q') pairCount = 2

    // Process coordinate pairs: negate x, keep y
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
      for (let p = 0; p < pairCount && i + 1 < tokens.length; p++) {
        output.push(String(-parseFloat(tokens[i])))   // x → -x
        output.push(tokens[i + 1])                     // y unchanged
        i += 2
      }
    }
  }

  return output.join(' ')
}

// ---------------------------------------------------------------------------
// Helper: rotate all coordinate pairs around the origin by angle (radians)
// ---------------------------------------------------------------------------
function rotatePathData(pathData: string, angle: number): string {
  if (angle === 0) return pathData
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const tokens = pathData.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return pathData

  const output: string[] = []
  let i = 0

  while (i < tokens.length) {
    const cmd = tokens[i]
    if (!/^[A-Za-z]$/.test(cmd)) {
      output.push(tokens[i])
      i++
      continue
    }

    output.push(cmd)
    i++

    const upper = cmd.toUpperCase()

    if (upper === 'Z') {
      continue
    }

    if (upper === 'H' || upper === 'V') {
      // H and V can't be simply rotated — but our ellipse paths use only
      // M, C, Z so this is a safety fallback; pass through unchanged
      while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
        output.push(tokens[i])
        i++
      }
      continue
    }

    if (upper === 'A') {
      while (i + 6 < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
        output.push(tokens[i])     // rx
        output.push(tokens[i + 1]) // ry
        // Rotate the x-rotation
        const xRot = parseFloat(tokens[i + 2]) + (angle * 180) / Math.PI
        output.push(String(Math.round(xRot * 1000) / 1000))
        output.push(tokens[i + 3]) // large-arc
        output.push(tokens[i + 4]) // sweep
        // Rotate endpoint
        const ax = parseFloat(tokens[i + 5])
        const ay = parseFloat(tokens[i + 6])
        output.push(String(Math.round((ax * cos - ay * sin) * 1000) / 1000))
        output.push(String(Math.round((ax * sin + ay * cos) * 1000) / 1000))
        i += 7
      }
      continue
    }

    // Coordinate pairs: M, L, C, S, Q, T
    let pairCount = 1
    if (upper === 'C') pairCount = 3
    else if (upper === 'S' || upper === 'Q') pairCount = 2

    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
      for (let p = 0; p < pairCount && i + 1 < tokens.length; p++) {
        const x = parseFloat(tokens[i])
        const y = parseFloat(tokens[i + 1])
        const rx = x * cos - y * sin
        const ry = x * sin + y * cos
        output.push(String(Math.round(rx * 1000) / 1000))
        output.push(String(Math.round(ry * 1000) / 1000))
        i += 2
      }
    }
  }

  return output.join(' ')
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------
export const WaveArcGenerator: LogoGenerator = {
  id: 'wave-arc',
  modeId: 'wave-arc',
  name: 'Wave Arc',
  description:
    'Concentric crescent marks via boolean-subtracted offset ellipses',
  version: '1.0',
  extraParams: [],
  getAnimationKeyframes: generateWaveArcKeyframes,

  generate(params: LogoParams, _rng: SeededRandom): GenerationResult {
    const mp = (params.modeParams['wave-arc'] ?? {}) as Record<string, number | string>

    const arcCount = Math.max(1, Math.min(Number(mp.arcCount) || 3, 20))
    const spreadAngleDeg = Number(mp.spreadAngle) || 120
    const spreadAngle = (spreadAngleDeg * Math.PI) / 180
    const gapRatio = Number(mp.gapRatio) || 0.5
    const taperAmount = Number(mp.taperAmount) || 0.3
    const arcSymmetry: 'bilateral' | 'radial' =
      mp.arcSymmetry === 'radial' ? 'radial' : 'bilateral'
    const symmetryFolds = Math.max(2, Math.min(Number(mp.symmetryFolds) || params.symmetryFolds, 12))

    const globalRotation = (params.rotation * Math.PI) / 180
    const maxRadius = CANVAS_SIZE * 0.4

    const warnings: string[] = []
    const shapes: ShapeNode[] = []
    const crescentPaths: string[] = []

    // Build crescents as arc-based shapes (not ellipse subtraction).
    // Each crescent is a closed path: outer arc → tip → inner arc → tip.
    // This produces clean separated crescents like the reference.
    const ringSlot = maxRadius / arcCount
    const halfAngle = spreadAngle / 2

    for (let i = 0; i < arcCount; i++) {
      const centerR = ringSlot * (i + 0.5)
      const thickness = ringSlot * (1 - gapRatio)
      const outerR = centerR + thickness / 2
      const innerR = centerR - thickness / 2

      // Taper: reduce thickness at tips. taperAmount=1 means fully pointed tips.
      // We interpolate innerR toward outerR at the tip angles.
      const tipR = innerR + (outerR - innerR) * taperAmount

      // Crescents open to the RIGHT (+X direction).
      // Bilateral mirror will create the left-side copy.
      // halfAngle measured from the +X axis.
      const tipStartX = tipR * Math.cos(halfAngle)
      const tipStartY = tipR * Math.sin(halfAngle)
      const tipEndX = tipR * Math.cos(-halfAngle)
      const tipEndY = tipR * Math.sin(-halfAngle)

      const outerStartX = outerR * Math.cos(halfAngle)
      const outerStartY = outerR * Math.sin(halfAngle)
      const outerEndX = outerR * Math.cos(-halfAngle)
      const outerEndY = outerR * Math.sin(-halfAngle)

      const innerStartX = innerR * Math.cos(halfAngle)
      const innerStartY = innerR * Math.sin(halfAngle)
      const innerEndX = innerR * Math.cos(-halfAngle)
      const innerEndY = innerR * Math.sin(-halfAngle)

      // Large arc flag: use large arc if spread > 180°
      const largeArc = spreadAngle > Math.PI ? 1 : 0

      // Build the crescent path:
      // Start at outer-start, arc to outer-end (outer radius)
      // Line to inner-end (or tip-end if tapered)
      // Arc back to inner-start (inner radius, reverse sweep)
      // Close to start
      const r = (n: number) => Math.round(n * 100) / 100

      let pathData: string
      if (taperAmount > 0.95) {
        // Fully tapered: tips are points where both arcs meet
        pathData = [
          `M${r(tipStartX)} ${r(tipStartY)}`,
          `A${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${r(tipEndX)} ${r(tipEndY)}`,
          `A${r(innerR)} ${r(innerR)} 0 ${largeArc} 0 ${r(tipStartX)} ${r(tipStartY)}`,
          'Z',
        ].join(' ')
      } else {
        // Partial taper: outer arc is wider than inner arc
        pathData = [
          `M${r(outerStartX)} ${r(outerStartY)}`,
          `A${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${r(outerEndX)} ${r(outerEndY)}`,
          `L${r(innerEndX)} ${r(innerEndY)}`,
          `A${r(innerR)} ${r(innerR)} 0 ${largeArc} 0 ${r(innerStartX)} ${r(innerStartY)}`,
          'Z',
        ].join(' ')
      }

      crescentPaths.push(pathData)

      shapes.push({
        id: `crescent_${i}`,
        type: 'ellipse',
        role: 'prototype',
        operation: 'add',
        center: { x: 0, y: 0 },
        radius: outerR,
        rotation: 0,
        params: { outerR, innerR },
        pathData,
      })
    }

    // Apply symmetry to all crescent paths
    let allPaths: string[] = []

    if (arcSymmetry === 'bilateral') {
      for (const pathData of crescentPaths) {
        allPaths.push(pathData)
        allPaths.push(mirrorPathX(pathData))
      }
    } else {
      for (const pathData of crescentPaths) {
        for (let f = 0; f < symmetryFolds; f++) {
          const angle = (2 * Math.PI * f) / symmetryFolds
          allPaths.push(rotatePathData(pathData, angle))
        }
      }
    }

    if (allPaths.length > MAX_CRESCENTS) {
      warnings.push(
        `Crescent count (${allPaths.length}) capped at ${MAX_CRESCENTS} to keep generation responsive`,
      )
      allPaths = allPaths.slice(0, MAX_CRESCENTS)
    }

    // Apply global rotation
    if (globalRotation !== 0) {
      allPaths = allPaths.map((p) => rotatePathData(p, globalRotation))

      const cos = Math.cos(globalRotation)
      const sin = Math.sin(globalRotation)
      for (const shape of shapes) {
        const x = shape.center.x * cos - shape.center.y * sin
        const y = shape.center.x * sin + shape.center.y * cos
        shape.center = {
          x: Math.round(x * 1000) / 1000,
          y: Math.round(y * 1000) / 1000,
        }
        shape.rotation += globalRotation
      }
    }

    // Union all crescent paths via boolean operations.
    // Since arc-based crescents don't overlap, this preserves
    // each crescent's shape while computing the viewBox.
    const booleanInputs = allPaths.map((pathData) => ({
      pathData,
      operation: 'add' as const,
    }))
    const boolResult = composeBooleanResult(booleanInputs)

    // Construction data: grid circles for each ring
    const gridCircles = Array.from({ length: arcCount }, (_, i) => {
      const ringFraction = (i + 1) / (arcCount + 1)
      const r = maxRadius * ringFraction
      return { cx: 0, cy: 0, r: Math.round(r * 100) / 100 }
    })

    // Guide lines
    const guideLines =
      arcSymmetry === 'bilateral'
        ? [
            {
              x1: 0,
              y1: -maxRadius,
              x2: 0,
              y2: maxRadius,
              kind: 'mirror' as const,
            },
          ]
        : Array.from({ length: symmetryFolds }, (_, i) => {
            const angle = (2 * Math.PI * i) / symmetryFolds
            return {
              x1: 0,
              y1: 0,
              x2: Math.round(Math.cos(angle) * maxRadius * 100) / 100,
              y2: Math.round(Math.sin(angle) * maxRadius * 100) / 100,
              kind: 'radial' as const,
            }
          })

    const addCount = shapes.filter((s) => s.operation === 'add').length
    const subCount = shapes.filter((s) => s.operation === 'subtract').length

    return {
      shapes,
      mark: {
        layers: boolResult.layers,
        compoundPathData: boolResult.compoundPathData,
        fillRule: 'evenodd' as const,
        viewBox: boolResult.viewBox,
      },
      constructionData: {
        gridCircles,
        guideLines,
        stats: {
          totalShapes: shapes.length,
          additiveCount: addCount,
          subtractiveCount: subCount,
          symmetryFolds: arcSymmetry === 'radial' ? symmetryFolds : 2,
        },
      },
      warnings: [...warnings, ...boolResult.warnings],
    }
  },
}
