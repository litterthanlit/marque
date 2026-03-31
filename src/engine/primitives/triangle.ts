/**
 * Returns SVG path data for an equilateral triangle centered at (cx, cy) with circumradius r.
 */
export function trianglePath(
  cx: number,
  cy: number,
  r: number,
  rotation: number,
): string {
  const points: [number, number][] = []
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  for (let i = 0; i < 3; i++) {
    const angle = (2 * Math.PI * i) / 3 - Math.PI / 2
    const x = r * Math.cos(angle)
    const y = r * Math.sin(angle)
    points.push([
      Math.round((cx + x * cos - y * sin) * 1000) / 1000,
      Math.round((cy + x * sin + y * cos) * 1000) / 1000,
    ])
  }

  return [
    `M ${points[0][0]} ${points[0][1]}`,
    `L ${points[1][0]} ${points[1][1]}`,
    `L ${points[2][0]} ${points[2][1]}`,
    'Z',
  ].join(' ')
}
