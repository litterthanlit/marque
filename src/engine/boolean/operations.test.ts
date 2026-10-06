import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import { getAllModeParamDefaults } from '../../store/modes.ts'
import { vectorDocumentToIllustratorDocument } from '../vector/view.ts'
import { documentFromGeneratorLink } from '../vector/link.ts'
import { composeOrderedPaths } from './operations.ts'

type Input = { pathData: string; operation: 'add' | 'subtract' }

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

const area = (item: paper.PathItem) => Math.abs((item as unknown as { area: number }).area)

function differenceArea(a: string, b: string): number {
  scope.activate()
  const x = scope.PathItem.create(a)
  const y = scope.PathItem.create(b)
  const difference = area(x.subtract(y, { insert: false })) + area(y.subtract(x, { insert: false }))
  scope.project.clear()
  return difference
}

function areaOf(pathData: string): number {
  scope.activate()
  const value = area(scope.PathItem.create(pathData))
  scope.project.clear()
  return value
}

/** The composition before runs were balanced: one input at a time. */
function sequentialFold(inputs: Input[]): string {
  scope.activate()
  let result: paper.PathItem | null = null
  for (const input of inputs) {
    const path = scope.PathItem.create(input.pathData)
    if (!result) {
      if (input.operation === 'add') result = path
      continue
    }
    result = input.operation === 'add' ? result.unite(path) : result.subtract(path)
  }
  const pathData = result?.pathData ?? ''
  scope.project.clear()
  return pathData
}

const square = (x: number, y: number, size: number) => `M${x},${y}h${size}v${size}h${-size}z`

describe('composing paths in order', () => {
  it('matches the one-at-a-time fold on a heavy converted mark', () => {
    // The mark with the most shapes among the radial generator's options: 360 of them.
    const params = {
      ...DEFAULT_PARAMS,
      modeParams: getAllModeParamDefaults(),
      modeId: 'geometric-radial',
      generatorId: 'geometric-radial',
      styleFamily: 'tech',
      gridRings: 8,
      symmetryFolds: 12,
    } as LogoParams
    const layers = vectorDocumentToIllustratorDocument(documentFromGeneratorLink(params)).layers
    const inputs = layers.map(({ pathData, operation }) => ({ pathData, operation }))
    expect(new Set(inputs.map((input) => input.operation)).size).toBe(2)

    const balanced = composeOrderedPaths(inputs)
    expect(balanced.warnings).toEqual([])
    expect(differenceArea(balanced.compoundPathData, sequentialFold(inputs))).toBeLessThan(0.5)
  })

  it('drops cuts below all material, and a later add fills a cut back in', () => {
    const inputs: Input[] = [
      { pathData: square(0, 0, 10), operation: 'subtract' },
      { pathData: square(0, 0, 100), operation: 'add' },
      { pathData: square(20, 20, 20), operation: 'subtract' },
      { pathData: square(60, 60, 20), operation: 'subtract' },
      { pathData: square(60, 60, 20), operation: 'add' },
    ]
    const { compoundPathData } = composeOrderedPaths(inputs)
    expect(areaOf(compoundPathData)).toBeCloseTo(100 * 100 - 20 * 20, 3)
    expect(differenceArea(compoundPathData, sequentialFold(inputs))).toBeLessThan(0.01)
  })

  it('unites a run of adds that overlap and a run that does not', () => {
    const inputs: Input[] = [
      { pathData: square(0, 0, 50), operation: 'add' },
      { pathData: square(25, 0, 50), operation: 'add' },
      { pathData: square(200, 0, 50), operation: 'add' },
    ]
    expect(areaOf(composeOrderedPaths(inputs).compoundPathData)).toBeCloseTo(75 * 50 + 50 * 50, 3)
  })

  it('falls back to one input at a time when paper gets a pair in a run wrong', () => {
    // Crescents from a spark: a duplicated crescent, a copy with a point
    // deleted, the bottom crescent switched to Cut and a slab. Paper unites
    // the duplicate and the edited copy into less than the duplicate alone,
    // without an error.
    const inputs: Input[] = [
      { pathData: 'M426.17216,96.03421c-38.85337,-9.32874 -66.24579,-44.07662 -66.24579,-84.03421c0,-39.9576 27.39242,-74.70547 66.24579,-84.03421l-17.31016,72.10264c-5.52198,1.31877 -9.4176,6.25431 -9.4176,11.93158c0,5.67727 3.89563,10.61281 9.4176,11.93158z', operation: 'subtract' },
      { pathData: 'M449.21619,192c-83.2287,-19.97627 -141.90914,-94.40755 -141.90914,-180c0,-85.59245 58.68044,-160.02373 141.90914,-180l-17.31016,72.11251c-49.87738,11.98163 -85.03981,56.59117 -85.03981,107.88749c0,51.29632 35.16243,95.90586 85.03981,107.88749z', operation: 'add' },
      { pathData: 'M226,55.21619c19.97627,-83.2287 94.40755,-141.90914 180,-141.90914c85.59245,0 160.02373,58.68044 180,141.90914l-72.11251,-17.31016c-11.98163,-49.87738 -56.59117,-85.03981 -107.88749,-85.03981c-51.29632,0 -95.90586,35.16243 -107.88749,85.03981z', operation: 'add' },
      { pathData: 'M238,67.21619c19.97627,-83.2287 94.40755,-141.90914 180,-141.90914c85.59245,0 160.02373,58.68044 180,141.90914l-72.11251,-17.31016c-11.98163,-49.87738 -56.59117,-85.03981 -107.88749,-85.03981c-51.29632,0 -95.90586,35.16243 -107.88749,85.03981z', operation: 'add' },
      { pathData: 'M238,67.216c19.976,-83.229 340.024,-83.229 360,0l-72.113,-17.31c-11.981,-49.877 -56.591,-85.04 -107.887,-85.04c-51.296,0 -95.906,35.163 -107.887,85.04z', operation: 'add' },
      { pathData: 'M-88,-178h200c49.70563,0 90,40.29437 90,90v200c0,49.70563 -40.29437,90 -90,90h-200c-49.70563,0 -90,-40.29437 -90,-90v-200c0,-49.70563 40.29437,-90 90,-90z', operation: 'add' },
    ]
    const balanced = composeOrderedPaths(inputs)
    expect(balanced.warnings).toEqual([])
    expect(balanced.viewBox.x + balanced.viewBox.width).toBeCloseTo(598, 0)
    expect(differenceArea(balanced.compoundPathData, sequentialFold(inputs))).toBeLessThan(0.5)
  })
})
