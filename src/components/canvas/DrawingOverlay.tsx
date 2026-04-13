import { useCallback, useRef } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'

type DrawableShape = 'circle' | 'rectangle' | 'triangle' | 'polygon'

const SHAPE_OPTIONS: Array<{ type: DrawableShape; label: string; icon: string }> = [
  { type: 'circle', label: 'Circle', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z' },
  { type: 'rectangle', label: 'Rectangle', icon: 'M3 5h18v14H3z' },
  { type: 'triangle', label: 'Triangle', icon: 'M12 3L22 21H2z' },
  { type: 'polygon', label: 'Polygon', icon: 'M12 2l7.5 5.5-3 9h-9l-3-9z' },
]

export function DrawingOverlay() {
  const drawingMode = useLogoStore((s) => s.ui.drawingMode)
  const activeDrawShape = useLogoStore((s) => s.ui.activeDrawShape)
  const setDrawingMode = useLogoStore((s) => s.setDrawingMode)
  const setActiveDrawShape = useLogoStore((s) => s.setActiveDrawShape)
  const addDrawnShape = useLogoStore((s) => s.addDrawnShape)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawingMode || !activeDrawShape) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Convert click position to engine coordinates (0,0 centered, 500x500 space)
    const canvasX = ((e.clientX - rect.left) / rect.width) * 500
    const canvasY = ((e.clientY - rect.top) / rect.height) * 500
    // Convert to engine space (centered at 0,0)
    const engineX = canvasX - 250
    const engineY = canvasY - 250

    addDrawnShape({
      type: activeDrawShape,
      x: Math.round(engineX),
      y: Math.round(engineY),
      radius: 30,
      operation: 'add',
    })
  }, [drawingMode, activeDrawShape, addDrawnShape])

  return (
    <>
      {/* Drawing mode click target — covers canvas */}
      {drawingMode && (
        <div
          ref={overlayRef}
          onClick={handleCanvasClick}
          className="absolute inset-0 z-10 cursor-crosshair rounded-2xl"
        />
      )}

      {/* Floating toolbar */}
      <div className={cn(
        'absolute top-4 left-1/2 -translate-x-1/2 z-20',
        'flex items-center gap-1 p-1 rounded-xl',
        'bg-black/70 backdrop-blur-sm border border-white/10',
      )}>
        {/* Draw mode toggle */}
        <button
          onClick={() => setDrawingMode(!drawingMode)}
          className={cn(
            'h-8 px-3 rounded-lg text-xs font-medium transition-colors',
            drawingMode
              ? 'bg-white text-neutral-900'
              : 'text-white/70 hover:text-white hover:bg-white/10',
          )}
        >
          {drawingMode ? 'Drawing' : 'Draw'}
        </button>

        {drawingMode && (
          <>
            <div className="w-px h-5 bg-white/10" />
            {SHAPE_OPTIONS.map((shape) => (
              <button
                key={shape.type}
                onClick={() => setActiveDrawShape(shape.type)}
                title={shape.label}
                className={cn(
                  'size-8 flex items-center justify-center rounded-lg transition-colors',
                  activeDrawShape === shape.type
                    ? 'bg-white/20 text-white'
                    : 'text-white/50 hover:text-white hover:bg-white/10',
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                  <path d={shape.icon} />
                </svg>
              </button>
            ))}
            <div className="w-px h-5 bg-white/10" />
            <button
              onClick={() => {
                useLogoStore.getState().clearDrawnShapes()
              }}
              className="h-8 px-2 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear all drawn shapes"
            >
              Clear
            </button>
          </>
        )}
      </div>
    </>
  )
}
