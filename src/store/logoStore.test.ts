import { describe, expect, it } from 'vitest'
import { useLogoStore } from './logoStore.ts'

describe('logo store', () => {
  it('loads outside the browser with Vector Maker empty', () => {
    const state = useLogoStore.getState()
    expect(state.activeSurface).toBe('generated')
    expect(state.vectorDocument).toBeNull()
    expect(state.vectorUndoStack).toHaveLength(0)
    expect(state.ui.theme).toBe('dark')
  })
})
