import type { IllustratorDocument } from '../../engine/illustrator/types.ts'

function overlaps(a: paper.PathItem, b: paper.PathItem): boolean {
  if (!a.bounds.intersects(b.bounds)) return false
  if (a.intersects(b)) return true
  return b.contains(a.interiorPoint) || a.contains(b.interiorPoint)
}

/**
 * Cuts that belong to the shapes being moved: cuts above them that touch
 * them and no other material below. They travel (and turn) with their slab,
 * so a carved piece moves as one. Cuts shared with another shape stay put.
 * Cuts in `moving` move anyway, so they are not looked at.
 */
export function carriedCuts(
  doc: IllustratorDocument,
  movedIds: Iterable<string>,
  items: Map<string, paper.PathItem>,
  moving: Iterable<string> = [],
): string[] {
  const moved = new Set(movedIds)
  const skip = new Set(moving)
  const carried: string[] = []
  doc.layers.forEach((cut, cutIndex) => {
    if (cut.operation !== 'subtract' || !cut.visible || cut.locked || moved.has(cut.id) || skip.has(cut.id)) return
    const cutItem = items.get(cut.id)
    if (!cutItem) return
    let touchesMoved = false
    for (let i = 0; i < cutIndex; i++) {
      const below = doc.layers[i]
      if (below.operation !== 'add' || !below.visible) continue
      const belowItem = items.get(below.id)
      if (!belowItem || !overlaps(cutItem, belowItem)) continue
      if (!moved.has(below.id)) return
      touchesMoved = true
    }
    if (touchesMoved) carried.push(cut.id)
  })
  return carried
}
