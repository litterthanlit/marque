import { useMemo } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import { composeIllustratorMark } from '../engine/illustrator/compose.ts'
import type { MarkData } from '../engine/illustrator/types.ts'
import { composeVectorMarkCached } from '../engine/vector/export.ts'
import { applyImperfection } from '../engine/effects/imperfection.ts'

export function useActiveMark(): MarkData | null {
  const result = useLogoStore((s) => s.result)
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const illustrator = useLogoStore((s) => s.illustrator)
  const vectorDocument = useLogoStore((s) => s.vectorDocument)

  return useMemo(() => {
    if (activeSurface === 'illustrator' && vectorDocument) {
      return composeVectorMarkCached(vectorDocument)
    }

    if (activeSurface === 'illustrator' && illustrator) {
      return composeIllustratorMark(illustrator)
    }

    return result?.mark ?? null
  }, [activeSurface, illustrator, result, vectorDocument])
}

/**
 * The active mark as it is shown and exported: with imperfection applied
 * when it's on. Editing keeps working on the clean geometry from useActiveMark.
 */
export function useFinishedMark(): MarkData | null {
  const mark = useActiveMark()
  const imperfection = useLogoStore((s) => s.effectParams.imperfection)
  return useMemo(() => applyImperfection(mark, imperfection), [mark, imperfection])
}
