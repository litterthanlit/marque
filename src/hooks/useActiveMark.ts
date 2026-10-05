import { useMemo } from 'react'
import { useLogoStore } from '../store/logoStore.ts'
import type { MarkData } from '../engine/illustrator/types.ts'
import { composeVectorMarkCached } from '../engine/vector/export.ts'

export function useActiveMark(): MarkData {
  const vectorDocument = useLogoStore((s) => s.vectorDocument)
  return useMemo(() => composeVectorMarkCached(vectorDocument), [vectorDocument])
}
