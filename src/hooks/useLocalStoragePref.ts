import { useEffect, useState } from 'react'

export function useLocalStoragePref<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? defaultValue : (JSON.parse(raw) as T)
    } catch {
      return defaultValue
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch { /* quota / private mode — non-fatal */ }
  }, [key, value])
  return [value, setValue]
}
