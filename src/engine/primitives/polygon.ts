/**
 * Returns SVG path data for a regular polygon centered at (cx, cy) with circumradius r.
 * sides: number of sides (3-8)
 */
export function polygonPath(
  cx: number,
  cy: number,
  r: number,
  rotation: number,
  sides: number,
): string {
  const n = Math.max(3, Math.min(8, Math.round(sides)))
  const points: [number, number][] = []
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const x = r * Math.cos(angle)
    const y = r * Math.sin(angle)
    points.push([
      Math.round((cx + x * cos - y * sin) * 1000) / 1000,
      Math.round((cy + x * sin + y * cos) * 1000) / 1000,
    ])
  }

  const segments = points.map((p, i) =>
    i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`,
  )
  segments.push('Z')
  return segments.join(' ')
}
