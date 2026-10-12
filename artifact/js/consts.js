// Shared constants. Pure: no DOM, no Paper.

export const TOOLS = [
  { id: 'select', key: 'v', label: 'Select' },
  { id: 'node', key: 'a', label: 'Edit points' },
  { id: 'pen', key: 'p', label: 'Pen' },
  { id: 'pencil', key: 'n', label: 'Pencil' },
  { id: 'rect', key: 'r', label: 'Rectangle' },
  { id: 'ellipse', key: 'e', label: 'Ellipse' },
  { id: 'polygon', key: 'y', label: 'Polygon' },
  { id: 'line', key: 'l', label: 'Line' },
]

export const ARTBOARDS = [
  { id: 'icon', label: 'Icon', w: 24, h: 24 },
  { id: 'square', label: 'Square', w: 512, h: 512 },
  { id: 'large', label: 'Large', w: 1024, h: 1024 },
  { id: 'wide', label: 'Wide', w: 1920, h: 1080 },
]

export const LIMITS = {
  zoomMin: 0.05, zoomMax: 64, artboardMin: 1, artboardMax: 8192,
  history: 200, maxItems: 500, assistPaths: 40, assistNodes: 2000,
}

export const DEFAULT_STYLE = {
  fill: '#16181d', stroke: null, strokeWidth: 2, cap: 'round', join: 'round',
  fillRule: 'nonzero', opacity: 1,
}

export const ACCENT = '#384ecb'

export const STORAGE = { doc: 'marque.doc.v1', prefs: 'marque.prefs.v1' }

// Grid step in doc units: a power of two giving roughly 64 cells across the larger side.
export function gridFor(w, h) {
  return 2 ** Math.round(Math.log2(Math.max(1, Math.max(w, h) / 64)))
}
