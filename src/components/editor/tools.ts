import type { EditorTool } from '../../store/logoStore.ts'
import { isBareKey } from '../../renderer/directEdit/keyboard.ts'

export interface ToolEntry {
  /** `null` is plain selecting: no tool, and the handles on the canvas are live. */
  id: EditorTool | null
  label: string
  shortcut: string
  hint: string
}

/** The pill's tools. Their keys and their titles both come from here. */
export const EDITOR_TOOLS: ToolEntry[] = [
  { id: null, label: 'Select', shortcut: 'V', hint: 'Drag a shape to move it, its handles to resize it, or an edge to bend it.' },
  { id: 'pen', label: 'Pen', shortcut: 'P', hint: 'Click to place points, drag an edge to bend it. Close by clicking the first point, pressing Enter or double-clicking.' },
  { id: 'punch', label: 'Punch', shortcut: 'X', hint: 'Stamp a hole. Click, or drag to size it.' },
  { id: 'channel', label: 'Channel', shortcut: 'C', hint: 'Drag to gouge a groove between two points. Hold Shift to lock the angle to 15° steps.' },
  { id: 'slice', label: 'Slice', shortcut: 'S', hint: 'Drag a line to cut clean through, edge to edge. Hold Shift to lock the angle to 15° steps.' },
]

export function toolForKey(event: KeyboardEvent): ToolEntry | undefined {
  if (!isBareKey(event)) return undefined
  const key = event.key.toUpperCase()
  return EDITOR_TOOLS.find((tool) => tool.shortcut === key)
}
