/**
 * SVG path for an axis-aligned ellipse centered at (cx, cy).
 * radiusX and radiusY are the horizontal and vertical radii.
 * Rotation is in radians and rotates the entire ellipse around its center.
 */
export function ellipsePath(
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
): string {
  const k = 0.5522847498 // Kappa constant for circle-to-bezier
  const ox = radiusX * k
  const oy = radiusY * k

  const points: Array<[number, number]> = [
    [0, -radiusY],
    [radiusX, 0],
    [0, radiusY],
    [-radiusX, 0],
  ]

  const controls: Array<[[number, number], [number, number]]> = [
    [[ox, -radiusY], [radiusX, -oy]],
    [[radiusX, oy], [ox, radiusY]],
    [[-ox, radiusY], [-radiusX, oy]],
    [[-radiusX, -oy], [-ox, -radiusY]],
  ]

  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const r = (x: number, y: number): [number, number] => [
    Math.round((cx + x * cos - y * sin) * 1000) / 1000,
    Math.round((cy + x * sin + y * cos) * 1000) / 1000,
  ]

  const p = points.map(([x, y]) => r(x, y))
  const c = controls.map(([c1, c2]) => [r(c1[0], c1[1]), r(c2[0], c2[1])] as const)

  return [
    `M ${p[0][0]} ${p[0][1]}`,
    `C ${c[0][0][0]} ${c[0][0][1]} ${c[0][1][0]} ${c[0][1][1]} ${p[1][0]} ${p[1][1]}`,
    `C ${c[1][0][0]} ${c[1][0][1]} ${c[1][1][0]} ${c[1][1][1]} ${p[2][0]} ${p[2][1]}`,
    `C ${c[2][0][0]} ${c[2][0][1]} ${c[2][1][0]} ${c[2][1][1]} ${p[3][0]} ${p[3][1]}`,
    `C ${c[3][0][0]} ${c[3][0][1]} ${c[3][1][0]} ${c[3][1][1]} ${p[0][0]} ${p[0][1]}`,
    'Z',
  ].join(' ')
}
