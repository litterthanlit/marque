import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { carveOutline } from '../carve/outline.ts'
import { slabSpec, type CarveSpec } from '../carve/spec.ts'
import { composeIllustratorMark } from './compose.ts'
import { createComposeSession } from './composeSession.ts'
import type { IllustratorDocument, IllustratorLayer } from './types.ts'

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function differenceArea(a: string, b: string): number {
  scope.activate()
  const x = scope.PathItem.create(a)
  const y = scope.PathItem.create(b)
  const area = (item: paper.PathItem) => Math.abs((item as unknown as { area: number }).area)
  return area(x.subtract(y, { insert: false })) + area(y.subtract(x, { insert: false }))
}

function layer(id: string, spec: CarveSpec, operation: 'add' | 'subtract', visible = true): IllustratorLayer {
  return {
    id,
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
})
