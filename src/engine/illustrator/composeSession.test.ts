import paper from 'paper'
import { describe, expect, it, vi } from 'vitest'
import * as operations from '../boolean/operations.ts'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec } from '../carve/spec.ts'
import { composeIllustratorMark, layerInput } from './compose.ts'
import { createComposeSession } from './composeSession.ts'
import type { IllustratorDocument, IllustratorLayer } from './types.ts'

// Counted, so a test can tell what a frame composes afresh.
vi.mock('../boolean/operations.ts', async (original) => {
  const actual = await original<typeof operations>()
  return { ...actual, composeOrderedPaths: vi.fn(actual.composeOrderedPaths) }
})

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function differenceArea(a: string, b: string): number {
  scope.activate()
  const x = scope.PathItem.create(a)
  const y = scope.PathItem.create(b)
  const area = (item: paper.PathItem) => Math.abs((item as unknown as { area: number }).area)
  return area(x.subtract(y, { insert: false })) + area(y.subtract(x, { insert: false }))
}

function layer(id: string, spec: CarveSpec, operation: 'add' | 'subtract', visible = true, parentId?: string): IllustratorLayer {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    name: id,
    operation,
    visible,
    locked: false,
    pathData: carveOutline(spec).pathData,
    fillRule: 'evenodd',
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    carve: spec,
  }
}

const doc: IllustratorDocument = {
  id: 'doc',
  source: { seed: 0, modeId: 'slab', generatorId: 'slab', generatorVersion: 'v1' },
  layers: [
    layer('slab', slabSpec('rounded'), 'add'),
    layer('punch', { v: 1, kind: 'punch', shape: 'circle', center: { x: -60, y: -60 }, radius: 40, rotation: 0 }, 'subtract'),
    layer('hidden', { v: 1, kind: 'punch', shape: 'square', center: { x: 80, y: 80 }, radius: 40, rotation: 0 }, 'subtract', false),
    layer('channel', { v: 1, kind: 'channel', from: { x: -100, y: 90 }, to: { x: 100, y: 60 }, width: 30 }, 'subtract'),
    layer('top', { ...slabSpec('circle', { x: 120, y: -120 }, 0.3) }, 'add'),
  ],
  selectedLayerIds: [],
  pointSelection: null,
  mode: 'object',
}

describe('compose session', () => {
  for (const edited of ['slab', 'punch', 'top']) {
    it(`equals a full composition when editing "${edited}"`, () => {
      const moved: CarveSpec =
        edited === 'punch'
          ? { v: 1, kind: 'punch', shape: 'circle', center: { x: 10, y: 20 }, radius: 50, rotation: 0 }
          : edited === 'top'
            ? slabSpec('circle', { x: -120, y: 120 }, 0.3)
            : { ...slabSpec('rounded'), width: 300 }
      const session = createComposeSession(doc, [edited])
      const live = session.compose(new Map([[edited, carveOutline(moved).pathData]]))
      const full = composeIllustratorMark({
        ...doc,
        layers: doc.layers.map((l) => (l.id === edited ? layer(edited, moved, l.operation) : l)),
      })!.compoundPathData
      expect(differenceArea(live, full)).toBeLessThan(0.5)
    })
  }

  it('composes a group inside an edited group once, when the edit never reaches it', () => {
    const circle = (id: string, x: number, y: number, radius: number, operation: 'add' | 'subtract', parentId: string) =>
      layer(id, { v: 1, kind: 'punch', shape: 'circle', center: { x, y }, radius, rotation: 0 }, operation, true, parentId)
    const group = (id: string, parentId?: string) => ({ id, name: id, ...(parentId ? { parentId } : {}), visible: true, locked: false, isolated: true, operation: 'add' as const })
    const nested: IllustratorDocument = {
      ...doc,
      groups: [group('outer'), group('inner', 'outer')],
      layers: [
        circle('ring', 0, 0, 120, 'add', 'outer'),
        circle('innerShape', 150, 0, 60, 'add', 'inner'),
        circle('innerHole', 150, 0, 20, 'subtract', 'inner'),
        circle('hole', -40, 0, 30, 'subtract', 'outer'),
      ],
    }
    const innerShape = layerInput(nested.layers[1])!.pathData
    const compose = vi.mocked(operations.composeOrderedPaths)
    const session = createComposeSession(nested, ['hole'])
    const frame = (x: number) => {
      const spec: CarveSpec = { v: 1, kind: 'punch', shape: 'circle', center: { x, y: 0 }, radius: 30, rotation: 0 }
      return { live: session.compose(new Map([['hole', carveOutline(spec).pathData]])), spec }
    }
    frame(-30)
    compose.mockClear()
    for (const x of [-20, -10]) {
      const { live, spec } = frame(x)
      const full = composeIllustratorMark({ ...nested, layers: nested.layers.map((l) => (l.id === 'hole' ? { ...l, pathData: carveOutline(spec).pathData } : l)) })
      expect(differenceArea(live, full.compoundPathData)).toBeLessThan(0.5)
    }
    // The outer group composes again with each frame; the inner group's own shapes never do.
    const innerComposed = compose.mock.calls.filter(([inputs]) => inputs.some((input) => input.pathData === innerShape))
    expect(innerComposed).toEqual([])
  })
})
