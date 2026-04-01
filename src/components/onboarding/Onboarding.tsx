import { useCallback, useEffect, useState } from 'react'
import { cn } from '../../lib/utils.ts'

const STORAGE_KEY = 'dalat.onboarding-seen'

interface Step {
  title: string
  description: string
  shortcut?: string
}

const STEPS: Step[] = [
  {
    title: 'Pick a mode',
    description:
      'Choose how your logo is built. Geometric Radial uses concentric rings with symmetry. Grid System places shapes on a structured grid. Monogram turns initials into lettermarks. Wave Arc creates crescent-based signal marks.',
  },
  {
    title: 'Randomize',
    description:
      'Every logo is driven by a seed number. Hit Random or press R to generate a completely different design. Same seed always produces the same logo — this is how sharing works.',
    shortcut: 'R',
  },
  {
    title: 'Refine with sliders',
    description:
      'Adjust symmetry, radius, shape count, and more. The logo updates in real-time as you drag. Each mode has its own set of controls below the shared ones.',
  },
  {
    title: 'Choose your shapes',
    description:
      'In Geometric and Modular modes, toggle which primitive shapes the generator can use — circles, rectangles, triangles, polygons, or organic blobs.',
  },
  {
    title: 'Apply effects',
    description:
      'Open the Effects section to enable Dissolution — it breaks your logo into particles. Control the depth, cell size, and scatter for anything from subtle edge erosion to full pixel art.',
  },
  {
    title: 'Export and share',
    description:
      'Export as SVG or PNG at up to 4x resolution. Copy a share link to send your exact logo — seed, settings, and effects are all encoded in the URL.',
    shortcut: 'Cmd+E',
  },
]

export function Onboarding() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY)
    if (!seen) setVisible(true)
  }, [])

  const dismiss = useCallback(() => {
    setVisible(false)
    window.localStorage.setItem(STORAGE_KEY, '1')
  }, [])

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      dismiss()
    }
  }, [step, dismiss])

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1))
  }, [])

  useEffect(() => {
    if (!visible) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss()
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [visible, dismiss, next, prev])

  if (!visible) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative w-full max-w-md mx-4">
        <div className="bg-surface-raised border border-border rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
          {/* Progress bar */}
          <div className="h-0.5 bg-white/5">
            <div
              className="h-full bg-white/30 transition-all duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          <div className="p-6">
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] uppercase tracking-widest text-sidebar-muted">
                {step + 1} of {STEPS.length}
              </span>
              {current.shortcut && (
                <kbd className="ml-auto text-[10px] font-mono text-sidebar-muted bg-white/5 border border-border rounded px-1.5 py-0.5">
                  {current.shortcut}
                </kbd>
              )}
            </div>

            {/* Content */}
            <h2 className="text-lg font-semibold text-white mb-2">{current.title}</h2>
            <p className="text-sm text-sidebar-text leading-relaxed">{current.description}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <button
              onClick={dismiss}
              className="text-xs text-sidebar-muted hover:text-white transition-colors"
            >
              Skip tutorial
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  onClick={prev}
                  className="h-8 px-3 text-xs text-sidebar-muted hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={next}
                className={cn(
                  'h-8 px-4 text-xs font-medium rounded-lg transition-colors',
                  'bg-white text-neutral-900 hover:bg-neutral-200',
                )}
              >
                {isLast ? 'Get started' : 'Next'}
              </button>
            </div>
          </div>
        </div>

        {/* Dot indicators */}
        <div className="flex items-center justify-center gap-1.5 mt-4">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={cn(
                'size-1.5 rounded-full transition-all',
                i === step ? 'bg-white scale-125' : 'bg-white/20 hover:bg-white/40',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
