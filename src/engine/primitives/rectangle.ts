/**
 * Returns SVG path data for a rectangle centered at (cx, cy).
 * Width and height derived from radius. Rotation in radians.
 */
export function rectanglePath(
  cx: number,
  cy: number,
  r: number,
  rotation: number,
): string {
  const hw = r
  const hh = r * 0.7

  // Corner points before rotation
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]

  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  const rotated = corners.map(([x, y]) => [
    Math.round((cx + x * cos - y * sin) * 1000) / 1000,
    Math.round((cy + x * sin + y * cos) * 1000) / 1000,
  ])

  return [
    `M ${rotated[0][0]} ${rotated[0][1]}`,
    `L ${rotated[1][0]} ${rotated[1][1]}`,
    `L ${rotated[2][0]} ${rotated[2][1]}`,
    `L ${rotated[3][0]} ${rotated[3][1]}`,
    'Z',
  ].join(' ')
}
