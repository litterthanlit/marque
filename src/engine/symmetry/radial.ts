import type { ShapeNode } from '../types.ts'

/**
 * Applies N-fold radial symmetry to prototype shapes.
 * Takes shapes within a single wedge and replicates them around the center.
 */
export function applyRadialSymmetry(
  prototypes: ShapeNode[],
  symmetryFolds: number,
): ShapeNode[] {
  if (symmetryFolds <= 1) return prototypes

  const allShapes: ShapeNode[] = [...prototypes]
  const angleStep = (2 * Math.PI) / symmetryFolds

  for (let fold = 1; fold < symmetryFolds; fold++) {
    const angle = angleStep * fold
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    for (const proto of prototypes) {
      const x = proto.center.x * cos - proto.center.y * sin
      const y = proto.center.x * sin + proto.center.y * cos

      allShapes.push({
        ...proto,
        id: `${proto.id}_s${fold}`,
        role: 'symmetry-instance',
        center: {
          x: Math.round(x * 1000) / 1000,
          y: Math.round(y * 1000) / 1000,
        },
        rotation: proto.rotation + angle,
      })
    }
  }

  return allShapes
}
