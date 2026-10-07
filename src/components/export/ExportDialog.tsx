import { useEffect, useId, useRef, useState } from 'react'
import { useExport } from '../../hooks/useExport.ts'
import { play } from '../../lib/sound.ts'
import { EditorButton, FOCUS_RING, Segmented } from '../editor/controls.tsx'
import { cn } from '../../lib/utils.ts'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

type ArtboardMode = 'tight' | 'square'
type PaddingMode = 'none' | 'compact' | 'presentation'

const ARTBOARD_OPTIONS: ReadonlyArray<{ value: ArtboardMode; label: string; title: string }> = [
  { value: 'tight', label: 'Tight', title: 'The artboard hugs the mark' },
  { value: 'square', label: 'Square', title: 'A square artboard, the mark in its middle' },
]

const PADDING_OPTIONS: ReadonlyArray<{ value: PaddingMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'compact', label: 'Compact' },
  { value: 'presentation', label: 'Presentation' },
]

const SCALE_OPTIONS: ReadonlyArray<{ value: number; label: string; title: string }> = [
  { value: 1, label: '1×', title: 'At its size on the artboard' },
  { value: 2, label: '2×', title: 'Twice its size, for high-density screens' },
  { value: 4, label: '4×', title: 'Four times its size' },
]

/**
 * Export, as a panel of the instrument over a dimmed page: the artboard and
 * its padding on interlocked keys, then the three ways out. It opens with
 * a sweep of air and closes with the sweep going down.
 */
export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { exportSVG, exportPNG, svgString, canExport } = useExport()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [pngScale, setPngScale] = useState(2)
  const [artboardMode, setArtboardMode] = useState<ArtboardMode>('tight')
  const [paddingMode, setPaddingMode] = useState<PaddingMode>('compact')
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Closed by the viewer, not by a download: the panel lets go with its own sound.
  function dismiss() {
    play('close')
    onClose()
  }

  useEffect(() => {
    if (open) play('open')
  }, [open])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        play('close')
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  // The same document Download SVG saves, with the artboard and padding chosen above.
  async function handleCopySVG() {
    const svg = svgString({ artboardMode, paddingMode })
    if (!svg) return
    try {
      await navigator.clipboard.writeText(svg)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade bg-black/35 backdrop-blur-[2px] dark:bg-black/60" onClick={dismiss} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="plate plate-raised relative flex w-[22rem] max-w-full animate-enter flex-col gap-4 rounded-[18px] p-4"
      >
        <h2 id={titleId} className="px-0.5 text-body font-semibold leading-none tracking-[-0.012em] text-ink">
          Export
        </h2>

        <div className="flex flex-col gap-3">
          <Field label="Artboard">
            <Segmented label="Artboard" options={ARTBOARD_OPTIONS} value={artboardMode} onChange={setArtboardMode} />
          </Field>
          <Field label="Padding">
            <Segmented label="Padding" options={PADDING_OPTIONS} value={paddingMode} onChange={setPaddingMode} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <EditorButton
            primary
            onClick={() => {
              exportSVG({ artboardMode, paddingMode })
              onClose()
            }}
            disabled={!canExport}
            className="h-9 w-full"
          >
            Download SVG
          </EditorButton>
          <EditorButton
            onClick={handleCopySVG}
            disabled={!canExport}
            aria-label={copyState === 'copied' ? 'SVG copied to clipboard' : 'Copy SVG'}
            className="h-9 w-full"
          >
            <span aria-live="polite">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy SVG'}</span>
          </EditorButton>
          <div className="flex items-center gap-2">
            <EditorButton
              onClick={() => {
                exportPNG(pngScale, { artboardMode, paddingMode })
                onClose()
              }}
              disabled={!canExport}
              className="h-9 flex-1"
            >
              Download PNG
            </EditorButton>
            <Segmented label="PNG scale" options={SCALE_OPTIONS} value={pngScale} onChange={setPngScale} className="font-mono-tabular" />
          </div>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          data-sound="off"
          onClick={dismiss}
          className={cn('flat-key -mt-1 h-8 w-full rounded-[8px] text-xs font-medium', FOCUS_RING)}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** An engraved caption over its control, as printed on the body above a row of keys. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden="true" className="engraved px-0.5">
        {label}
      </span>
      {children}
    </div>
  )
}
