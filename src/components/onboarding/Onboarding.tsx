import { useCallback, useEffect, useState } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'

const STORAGE_KEY = 'dalat.onboarding-seen'

export function Onboarding() {
  const [visible, setVisible] = useState(false)
  const randomizeSeed = useLogoStore((s) => s.randomizeSeed)

  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY)
    if (!seen) setVisible(true)
  }, [])

  const dismiss = useCallback(() => {
    setVisible(false)
    window.localStorage.setItem(STORAGE_KEY, '1')
  }, [])

  const handleRandom = useCallback(() => {
    randomizeSeed()
    dismiss()
  }, [randomizeSeed, dismiss])

  useEffect(() => {
    if (!visible) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'r') {
        e.preventDefault()
        if (e.key === 'r') randomizeSeed()
        dismiss()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [visible, dismiss, randomizeSeed])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative w-full max-w-sm mx-4">
        <div className="bg-surface-raised border border-border rounded-2xl shadow-2xl shadow-black/50 p-6 text-center">
          <h2 className="text-lg font-semibold text-fg mb-2">dalat</h2>
          <p className="text-sm text-sidebar-text leading-relaxed mb-5">
            Press Random. Keep going until something clicks. Then tune, draw, or export.
          </p>
          <button
            onClick={handleRandom}
            className="w-full h-10 rounded-lg text-sm font-medium bg-white text-neutral-900 hover:bg-neutral-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Random
          </button>
          <button
            onClick={dismiss}
            className="mt-2 w-full h-8 text-xs text-sidebar-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
