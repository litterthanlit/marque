import { useEffect, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { useExport } from '../../hooks/useExport.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { SavedMenu } from '../editor/SavedMenu.tsx'
import { SurvivalPopover } from '../editor/SurvivalPopover.tsx'
import { ToolbarButton } from './ToolbarButton.tsx'
import { cn } from '../../lib/utils.ts'

type ShareState = 'idle' | 'copied' | 'failed'

export function Toolbar() {
  const undo = useLogoStore((s) => s.undoVectorCommand)
  const redo = useLogoStore((s) => s.redoVectorCommand)
  const canUndo = useLogoStore((s) => s.vectorUndoStack.length > 0)
  const canRedo = useLogoStore((s) => s.vectorRedoStack.length > 0)
  const look = useLogoStore((s) => s.ui.look)
  const toggleLook = useLogoStore((s) => s.toggleLook)
  const layersOpen = useLogoStore((s) => s.ui.layersOpen)
  const setLayersOpen = useLogoStore((s) => s.setLayersOpen)
  const { canExport } = useExport()
  const [exportOpen, setExportOpen] = useState(false)
  const [shareState, setShareState] = useState<ShareState>('idle')

  useEffect(() => {
    function handleOpenExport() { setExportOpen(true) }
    window.addEventListener('open-export', handleOpenExport)
    return () => window.removeEventListener('open-export', handleOpenExport)
  }, [])

  useEffect(() => {
    if (shareState === 'idle') return
    const timer = window.setTimeout(() => setShareState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [shareState])

  async function handleCopyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareState('copied')
    } catch {
      setShareState('failed')
    }
  }

  // On a phone every control stays in the one row: labels give way to icons, and the wordmark goes last.
  return (
    <>
      <header className="flex items-center justify-between h-12 gap-2 px-3 sm:px-5 border-b border-border bg-surface-raised">
        <span className="font-display text-[18px] leading-none font-medium tracking-tight text-fg max-[379px]:hidden">marque</span>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1 max-[379px]:flex-1 max-[379px]:justify-between">
          <ToolbarButton onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Cmd+Z)">
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Cmd+Shift+Z)">
            <RedoIcon />
          </ToolbarButton>
          <div className="max-sm:hidden w-px h-3.5 bg-border mx-1" />
          <InkSwatch />
          <ToolbarButton
            onClick={toggleLook}
            aria-label="Show construction lines"
            aria-pressed={look === 'construction'}
            title="Show construction lines (F)"
            className="aria-pressed:bg-interactive-hover aria-pressed:text-fg"
          >
            <ConstructionIcon />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setLayersOpen(!layersOpen)}
            aria-label="Layers"
            aria-expanded={layersOpen}
            title="Layers (L)"
          >
            <LayersIcon />
            <span className="max-sm:hidden">Layers</span>
          </ToolbarButton>
          <SavedMenu />
          <ToolbarButton onClick={handleCopyShareLink} aria-label={SHARE[shareState].name} title="Copy a link to this mark">
            {SHARE[shareState].icon}
            <span className="max-sm:hidden" aria-live="polite">{SHARE[shareState].label}</span>
          </ToolbarButton>
          <SurvivalPopover />
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={!canExport}
            className={cn(
              'ml-1 h-7 px-2 sm:px-3 text-xs font-medium rounded-md transition-colors',
              'bg-fg text-surface hover:opacity-80',
              'disabled:opacity-30 disabled:cursor-default',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
            )}
          >
            Export
          </button>
        </div>
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  )
}

function InkSwatch() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  return (
    <span
      title={`Ink colour ${fillColor.toLowerCase()}`}
      className={cn(
        'relative mx-1 size-5 shrink-0 rounded-md border border-sidebar-muted',
        'focus-within:ring-2 focus-within:ring-[color:var(--color-selection)]',
        'focus-within:ring-offset-2 focus-within:ring-offset-surface-raised',
      )}
      style={{ backgroundColor: fillColor }}
    >
      <input
        type="color"
        value={fillColor}
        onChange={(e) => setParam('fillColor', e.target.value)}
        aria-label="Ink colour"
        className="absolute inset-0 size-full opacity-0 cursor-pointer"
      />
    </span>
  )
}

const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function UndoIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 7h7a4 4 0 0 1 0 8H7" />
      <path d="M6 4L3 7l3 3" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg {...ICON}>
      <path d="M13 7H6a4 4 0 0 0 0 8h3" />
      <path d="M10 4l3 3-3 3" />
    </svg>
  )
}

function ConstructionIcon() {
  return (
    <svg {...ICON}>
      <rect x="2" y="6" width="8" height="8" rx="1" />
      <circle cx="10" cy="6" r="4" strokeDasharray="0.1 2.4" />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg {...ICON} className="sm:hidden">
      <path d="M8 2.5L2.5 5.5 8 8.5l5.5-3z" />
      <path d="M2.5 9.5L8 12.5l5.5-3" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg {...ICON} className="sm:hidden">
      <path d="M6.5 9.5l3-3" />
      <path d="M7.5 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1" />
      <path d="M8.5 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...ICON} className="sm:hidden">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg {...ICON} className="sm:hidden">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

const SHARE: Record<ShareState, { label: string; name: string; icon: React.ReactNode }> = {
  idle: { label: 'Share', name: 'Share', icon: <LinkIcon /> },
  copied: { label: 'Copied', name: 'Link copied', icon: <CheckIcon /> },
  failed: { label: 'Failed', name: 'The link could not be copied', icon: <CrossIcon /> },
}
