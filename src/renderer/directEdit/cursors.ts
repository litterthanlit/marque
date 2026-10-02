const svgCursor = (svg: string, x: number, y: number, fallback: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`

// White halo under a dark stroke so the cursors read on ink and on paper.
const BEND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M4 17 Q12 3 20 17" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>
<path d="M4 17 Q12 3 20 17" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="12" cy="10" r="2.8" fill="white" stroke="#111" stroke-width="1.3"/></svg>`

const BEND_ADD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M2 17 Q10 3 18 17" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>
<path d="M2 17 Q10 3 18 17" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="10" cy="10" r="2.8" fill="white" stroke="#111" stroke-width="1.3"/>
<path d="M19 3v6M16 6h6" stroke="white" stroke-width="3.4" stroke-linecap="round"/>
<path d="M19 3v6M16 6h6" stroke="#111" stroke-width="1.4" stroke-linecap="round"/></svg>`

const ROTATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M18.5 9A7 7 0 1 0 19 14" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>
<path d="M18.5 9A7 7 0 1 0 19 14" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
<path d="M19.5 4.5v5h-5" fill="none" stroke="white" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M19.5 4.5v5h-5" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export const CURSORS = {
  default: 'default',
  move: 'move',
  point: 'pointer',
  crosshair: 'crosshair',
  bend: svgCursor(BEND_SVG, 12, 10, 'crosshair'),
  bendOrAdd: svgCursor(BEND_ADD_SVG, 10, 10, 'crosshair'),
  rotate: svgCursor(ROTATE_SVG, 12, 12, 'grab'),
} as const

/** The resize cursor closest to an axis direction (degrees, screen space). */
export function resizeCursor(axisDeg: number): string {
  const a = ((Math.round(axisDeg / 45) * 45) % 180 + 180) % 180
  if (a === 0) return 'ew-resize'
  if (a === 45) return 'nwse-resize'
  if (a === 90) return 'ns-resize'
  return 'nesw-resize'
}
