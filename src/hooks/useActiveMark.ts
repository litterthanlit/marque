import { useMemo } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import { composeIllustratorMark } from '../engine/illustrator/compose.ts'
import type { MarkData } from '../engine/illustrator/types.ts'
import { composeVectorMark } from '../engine/vector/export.ts'

export function useActiveMark(): MarkData | null {
  const result = useLogoStore((s) => s.result)
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const illustrator = useLogoStore((s) => s.illustrator)
  const vectorDocument = useLogoStore((s) => s.vectorDocument)

  return useMemo(() => {
    if (activeSurface === 'illustrator' && illustrator) {
      return composeIllustratorMark(illustrator)
    }

    if (activeSurface === 'illustrator' && vectorDocument) {
      return composeVectorMark(vectorDocument)
    }

    return result?.mark ?? null
  }, [activeSurface, illustrator, result, vectorDocument])
}
