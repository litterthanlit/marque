/**
 * Returns SVG path data for a circle centered at (cx, cy) with radius r.
 * Approximated with 4 cubic Bezier arcs (standard SVG circle approximation).
 */
export function circlePath(cx: number, cy: number, r: number): string {
  // Using two arc commands for a perfect circle
  return [
    `M ${cx - r} ${cy}`,
    `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
    `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
    'Z',
  ].join(' ')
}
