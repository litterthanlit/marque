import type { IllustratorLayer } from '../../engine/illustrator/types.ts'
import type { EditorTool } from '../../store/logoStore.ts'
import { isBareKey } from '../../renderer/directEdit/keyboard.ts'
import { offsetRoot } from '../../engine/vector/offsets.ts'

export interface ToolEntry {
  /** `null` is plain selecting: no tool, and the handles on the canvas are live. */
  id: EditorTool | null
  label: string
  shortcut: string
  hint: string
}

/** The pill's tools. Their keys and their titles both come from here. */
export const EDITOR_TOOLS: ToolEntry[] = [
  { id: null, label: 'Select', shortcut: 'V', hint: 'Drag a shape to move it, its handles to resize it, or an edge to bend it. A click takes a whole group; double-click one of its pieces to work on it alone, and Esc to come back.' },
  { id: 'pen', label: 'Pen', shortcut: 'P', hint: 'Click to place points, drag an edge to bend it. A shape closes by clicking the first point, pressing Enter or double-clicking; a guide (Draws: Guide) stays open on Enter or a double-click.' },
  { id: 'punch', label: 'Punch', shortcut: 'X', hint: 'Stamp a hole. Click, or drag to size it.' },
  { id: 'channel', label: 'Channel', shortcut: 'C', hint: 'Drag to gouge a groove between two points. Hold Shift to lock the angle to 15° steps.' },
  { id: 'slice', label: 'Slice', shortcut: 'S', hint: 'Drag a line to cut clean through, edge to edge. Hold Shift to lock the angle to 15° steps.' },
  {
    id: 'guide',
    label: 'Guide',
    shortcut: 'G',
    hint: 'Drag to draw a guide line, with Shift in 15° steps; Alt-drag draws a circle. Point at a shape to see its construction lines: click one to add it, Shift-click to add them all. Guides show in the construction look and never print.',
  },
  {
    id: 'band',
    label: 'Band',
    shortcut: 'B',
    hint: 'Click a circle, then another, to join them with a band that follows them. Fit sets how: Belt wraps both, Bar runs centre to centre, Strip runs at an angle touching each, Neck curves between them. Escape drops the first circle.',
  },
  {
    id: 'round',
    label: 'Round',
    shortcut: 'O',
    hint: 'Click a corner of the mark to round it at the Radius below, or drag from a corner to set the radius as you go; Alt-click reuses the last radius. Click a fillet’s circle to select it. Fillets follow their corners, and their circles show in the construction look.',
  },
]

export function toolForKey(event: KeyboardEvent): ToolEntry | undefined {
  if (!isBareKey(event)) return undefined
  const key = event.key.toUpperCase()
  return EDITOR_TOOLS.find((tool) => tool.shortcut === key)
}

/** Deals a new set of sparks into the tray. */
export const SHUFFLE_SHORTCUT = 'R'

export function isShuffleKey(event: KeyboardEvent): boolean {
  return isBareKey(event) && event.key.toUpperCase() === SHUFFLE_SHORTCUT
}

/** [ takes a side off the selected polygons and ] adds one: −1, 1, or 0 for any other key. */
export function sidesKeyStep(event: KeyboardEvent): -1 | 0 | 1 {
  if (!isBareKey(event)) return 0
  return event.key === ']' ? 1 : event.key === '[' ? -1 : 0
}

/**
 * The sides of the polygons that [ and ] change with `layers` selected,
 * read among `all`: each polygon that is visible, not locked and follows no
 * source, and for an offset copy the polygon it follows, once each.
 */
export function steppedPolygonSides(layers: readonly IllustratorLayer[], all: readonly IllustratorLayer[]): number[] {
  const byId = new Map(all.map((layer) => [layer.id, layer]))
  const roots = new Set<IllustratorLayer>()
  for (const layer of layers) {
    const root = byId.get(offsetRoot(all, layer.id)) ?? layer
    roots.add(root)
  }
  return [...roots].flatMap((layer) => (layer.visible && !layer.locked && !layer.link && layer.carve?.kind === 'polygon' ? [layer.carve.sides] : []))
}
