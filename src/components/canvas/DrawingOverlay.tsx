import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'

type Tool = 'select' | 'pencil' | 'pen' | 'graffiti'

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  {
    id: 'select',
    label: 'Select',
    icon: 'M4 4l7 17 2.5-6.5L20 12z',
  },
  {
    id: 'pencil',
    label: 'Pencil',
    icon: 'M3 21l1.5-4.5L17.7 3.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7.5 19.5z',
  },
  {
    id: 'pen',
    label: 'Pen',
    icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  },
  {
    id: 'graffiti',
    label: 'Spray',
    icon: 'M12 2v6m4-4l-2 2m-4-2l2 2M7 12a5 5 0 0 0 10 0M9 22h6m-3-5v5',
  },
]

export function DrawingOverlay() {
  const activeTool = useLogoStore((s) => s.ui.activeTool)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const clearDrawnPaths = useLogoStore((s) => s.clearDrawnPaths)
  const drawnPaths = useLogoStore((s) => s.ui.drawnPaths)

  return (
    <div
      className={cn(
        'absolute top-4 left-1/2 -translate-x-1/2 z-20',
        'flex items-center gap-1 p-1 rounded-xl',
        'bg-black/70 backdrop-blur-sm border border-white/10',
      )}
    >
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
          title={tool.label}
          className={cn(
            'size-8 flex items-center justify-center rounded-lg transition-colors',
            activeTool === tool.id
              ? 'bg-white text-neutral-900'
              : 'text-fg/50 hover:text-fg hover:bg-white/10',
          )}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={tool.id === 'select' ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <path d={tool.icon} />
          </svg>
        </button>
      ))}
      {drawnPaths.length > 0 && (
        <>
          <div className="w-px h-5 bg-white/10" />
          <button
            onClick={clearDrawnPaths}
            className="h-8 px-2 rounded-lg text-xs text-fg/50 hover:text-fg hover:bg-white/10 transition-colors"
            title="Clear all drawn paths"
          >
            Clear
          </button>
        </>
      )}
    </div>
  )
}
