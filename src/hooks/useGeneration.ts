import { useEffect, useRef } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import { generate } from '../engine/pipeline/GenerationPipeline.ts'

export function useGeneration() {
  const params = useLogoStore((s) => s.params)
  const setResult = useLogoStore((s) => s.setResult)
  const setError = useLogoStore((s) => s.setError)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      try {
        const result = generate(params)
        setResult(result)
        setError(null)
      } catch (e) {
        console.error('Generation failed:', e)
        setResult(null)
        setError('Logo generation failed for the current parameters.')
      }
    }, 80)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [params, setError, setResult])
}
