/** Clear of the pointer by this much, in CSS pixels. */
const OFFSET = 14
/** How far above a finger the row sits, so the hand does not cover it. */
const FINGER_OFFSET = 44
/** The least room kept between the row and the canvas's edge. */
export const HUD_EDGE = 8

/** Where the HUD's row goes, its top-left corner in CSS pixels from the canvas's. */
export interface HudPlace {
  left: number
  top: number
}

/**
 * Where the HUD's row of `row` size goes beside the point (`x`, `y`) on a
 * canvas of `frame` size. It goes right of the point, or left of it where
 * the right has no room, or, where neither side has room, as near the
 * point as the canvas allows: it never reaches past an edge. Under a
 * finger (`above`) it goes above the touch point, below only near the top
 * edge; else below the pointer, above it near the bottom edge.
 */
export function hudPlace(
  point: { x: number; y: number; above: boolean },
  row: { width: number; height: number },
  frame: { width: number; height: number },
): HudPlace {
  const right = point.x + OFFSET
  const left = point.x - OFFSET - row.width
  const across =
    right + row.width <= frame.width - HUD_EDGE ? right : left >= HUD_EDGE ? left : clamp(right, HUD_EDGE, frame.width - row.width - HUD_EDGE)
  const [first, second] = point.above
    ? [point.y - FINGER_OFFSET - row.height, point.y + FINGER_OFFSET]
    : [point.y + OFFSET, point.y - OFFSET - row.height]
  const fits = (top: number) => top >= 0 && top + row.height <= frame.height
  const down = fits(first) ? first : fits(second) ? second : clamp(first, 0, frame.height - row.height)
  return { left: across, top: down }
}

/** `value` within [`min`, `max`], or at `min` when there is no such room. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
