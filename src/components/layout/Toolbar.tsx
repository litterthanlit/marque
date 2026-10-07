import { useEffect, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { useExport } from '../../hooks/useExport.ts'
import { ExportDialog } from '../export/ExportDialog.tsx'
import { SavedMenu } from '../editor/SavedMenu.tsx'
import { SurvivalPopover } from '../editor/SurvivalPopover.tsx'
import { ToolbarButton } from './ToolbarButton.tsx'
import { cn } from '../../lib/utils.ts'
import { hud } from '../../renderer/directEdit/hud.ts'
import { play } from '../../lib/sound.ts'
import { setTheme, useTheme } from '../../lib/theme.ts'

type ShareState = 'idle' | 'copied' | 'failed'

export function Toolbar() {
  const undoVectorCommand = useLogoStore((s) => s.undoVectorCommand)
  const redoVectorCommand = useLogoStore((s) => s.redoVectorCommand)
  // What a keyboard edit read out last no longer holds after an undo or redo.
  const undo = () => {
    hud.silence()
    undoVectorCommand()
  }
  const redo = () => {
    hud.silence()
    redoVectorCommand()
  }
  const canUndo = useLogoStore((s) => s.vectorUndoStack.length > 0)
  const canRedo = useLogoStore((s) => s.vectorRedoStack.length > 0)
  const look = useLogoStore((s) => s.ui.look)
  const toggleLook = useLogoStore((s) => s.toggleLook)
  const showGuides = useLogoStore((s) => s.ui.showGuides)
  const toggleShowGuides = useLogoStore((s) => s.toggleShowGuides)
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
      <header className="flex h-12 items-center justify-between gap-2 bg-canvas px-3 sm:px-5">
        <span className="text-[15px] font-semibold leading-none tracking-[-0.035em] text-ink max-[379px]:hidden">marque</span>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1 max-[379px]:flex-1 max-[379px]:justify-between">
          <ToolbarButton onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Cmd+Z)">
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Cmd+Shift+Z)">
            <RedoIcon />
          </ToolbarButton>
          <div className="mx-1 h-3.5 w-px bg-line max-sm:hidden" />
          <InkSwatch />
          <ToolbarButton
            onClick={toggleLook}
            aria-label="Show construction lines"
            aria-pressed={look === 'construction'}
            title="Show construction lines (F)"
          >
            <ConstructionIcon />
          </ToolbarButton>
          {/* Guides draw only in the construction look: in the final look the switch is dimmed and says so. */}
          <ToolbarButton
            onClick={toggleShowGuides}
            aria-label="Show guides"
            aria-pressed={showGuides}
            title={look === 'construction' ? 'Show guides (Cmd+;)' : 'Show guides (Cmd+;). Guides show in the construction look (F)'}
            className={cn(look !== 'construction' && 'opacity-50')}
          >
            <GuidesIcon />
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
          <ThemeToggle />
          {/* The one key the page is for: it sinks onto its base, its lettering cut into the face. */}
          <button
            type="button"
            data-sound="key"
            onClick={() => setExportOpen(true)}
            disabled={!canExport}
            className={cn(
              'ml-1 h-7 shrink-0 rounded-key px-2.5 text-xs font-medium sm:px-3',
              'text-(--key-primary-ink) [background:var(--key-primary-face)] [text-shadow:var(--key-primary-engrave)] shadow-(--key-primary-shadow)',
              'transition-[transform,box-shadow,filter,opacity] duration-(--duration-exit) ease-out',
              'enabled:hover:brightness-[1.12] dark:enabled:hover:brightness-[1.04] enabled:active:translate-y-[2px] enabled:active:shadow-(--key-primary-shadow-pressed) enabled:active:duration-75',
              'disabled:cursor-default disabled:opacity-30',
              'outline-offset-2',
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

/** Light or dark, remembered on this device. The sun and the moon trade places as it flips. */
function ThemeToggle() {
  const theme = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <ToolbarButton
      data-sound="off"
      onClick={() => {
        setTheme(next)
        play('toggle')
      }}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      // A phone's bar has no room for it: there the theme follows the system's.
      className="relative w-7 px-0 max-sm:hidden sm:w-7 sm:px-0"
    >
      <svg {...ICON} className="absolute transition-[transform,opacity] duration-(--duration-move) ease-out" style={{ opacity: theme === 'light' ? 1 : 0, transform: theme === 'light' ? 'none' : 'rotate(-90deg) scale(0.5)' }}>
        <circle cx="8" cy="8" r="2.75" />
        <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
      </svg>
      <svg {...ICON} className="absolute transition-[transform,opacity] duration-(--duration-move) ease-out" style={{ opacity: theme === 'dark' ? 1 : 0, transform: theme === 'dark' ? 'none' : 'rotate(90deg) scale(0.5)' }}>
        <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />
      </svg>
    </ToolbarButton>
  )
}

function InkSwatch() {
  const fillColor = useLogoStore((s) => s.params.fillColor)
  const setParam = useLogoStore((s) => s.setParam)

  // The ink in a black bezel, as a colour chip set into the body.
  return (
    <span
      title={`Ink colour ${fillColor.toLowerCase()}`}
      className={cn(
        'relative mx-1 size-5 shrink-0 rounded-[5px] bg-(--device-rim) p-[2px] shadow-(--device-rim-edge)',
        'outline-offset-2 outline-(--focus) has-[:focus-visible]:outline-2',
      )}
    >
      <span aria-hidden="true" className="block size-full rounded-[3px] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.18)]" style={{ backgroundColor: fillColor }} />
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

function GuidesIcon() {
  return (
    <svg {...ICON}>
      <path d="M1.5 5h13M5 1.5v13" strokeDasharray="2 1.6" />
      <circle cx="10" cy="10" r="3.5" />
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
