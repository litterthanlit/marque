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

describe('recipes in the store', () => {
  it('slabs, cuts and duplicates carry recipes, never transforms', () => {
    const store = useLogoStore.getState()
    store.startFromSlab('rounded')
    let doc = useLogoStore.getState().illustrator!
    expect(doc.layers).toHaveLength(1)
    expect(doc.layers[0].carve?.kind).toBe('slab')

    useLogoStore.getState().addCarveCut({ kind: 'punch', shape: 'circle', center: { x: 20, y: 30 }, radius: 40 })
    doc = useLogoStore.getState().illustrator!
    const punch = doc.layers[1]
    expect(punch.operation).toBe('subtract')
    expect(punch.carve).toMatchObject({ kind: 'punch', center: { x: 20, y: 30 }, radius: 40 })

    useLogoStore.getState().duplicateIllustratorLayer(punch.id)
    doc = useLogoStore.getState().illustrator!
    const copy = doc.layers[2]
    expect(copy.transform).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 })
    expect(copy.carve).toMatchObject({ kind: 'punch', center: { x: 32, y: 42 } })
  })
})
