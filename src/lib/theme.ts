import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

/** Where the viewer's choice is kept. index.html reads it before the first paint. */
export const THEME_KEY = 'marque.theme'

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const getTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** Sets the theme on <html> and remembers it. Storage can be missing or throw (blocked site data). */
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Kept for this visit only.
  }
}

/** The theme on <html>, kept in step with whatever changes it. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light')
}
