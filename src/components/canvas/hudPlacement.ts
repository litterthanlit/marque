/** Clear of the pointer by this much, in CSS pixels. */
const OFFSET = 14
/** How far above a finger the row sits, so the hand does not cover it. */
const FINGER_OFFSET = 44
/** The least room kept between the row and the canvas's edge, on every side. */
export const HUD_EDGE = 12

/** Where the HUD's row goes, its top-left corner in CSS pixels from the canvas's. */
export interface HudPlace {
  left: number
  top: number
}

/**
 * Where the HUD's row of `row` size goes beside the point (`x`, `y`) on a
 * canvas of `frame` size. It goes right of the point, or left of it where
 * the right has no room, or, where neither side has room, as near the
 * point as the canvas allows: it keeps `HUD_EDGE` clear of every edge,
 * the point inside the canvas or not, or, on a canvas too small for that,
 * at least never reaches past one.
 * Under a finger (`above`) it goes above the touch point, below only near
 * the top edge; else below the pointer, above it near the bottom edge.
 */
export function hudPlace(
  point: { x: number; y: number; above: boolean },
  row: { width: number; height: number },
  frame: { width: number; height: number },
): HudPlace {
  const right = point.x + OFFSET
  const left = point.x - OFFSET - row.width
  // The side chosen still goes through `inside`: a point past an edge, as a box's corner off the canvas can be, would take the row with it.
  const across = inside(
    right + row.width <= frame.width - HUD_EDGE ? right : left >= HUD_EDGE ? left : right,
    row.width,
    frame.width,
  )
  const [first, second] = point.above
    ? [point.y - FINGER_OFFSET - row.height, point.y + FINGER_OFFSET]
    : [point.y + OFFSET, point.y - OFFSET - row.height]
  const fits = (top: number) => top >= HUD_EDGE && top + row.height <= frame.height - HUD_EDGE
  const down = fits(first) ? first : fits(second) ? second : inside(first, row.height, frame.height)
  return { left: across, top: down }
}

/**
 * Where a row of `size` that would start at `start` goes on a side of
 * `length`: as near there as `HUD_EDGE` clear of both ends allows, or, with
 * no room for that, as near as both ends themselves allow.
 */
function inside(start: number, size: number, length: number): number {
  if (length - size >= 2 * HUD_EDGE) return clamp(start, HUD_EDGE, length - size - HUD_EDGE)
  return clamp(start, 0, length - size)
}

/** `value` within [`min`, `max`], or at `min` when there is no such room. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
