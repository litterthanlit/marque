import paper from 'paper'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type LogoParams } from '../types.ts'
import { generate } from '../pipeline/GenerationPipeline.ts'
import {
  getAllModeParamDefaults,
  getModeGeneratorId,
  getStyleFamilyDefaults,
  listModes,
  STYLE_FAMILIES,
} from '../../store/modes.ts'
import { composeVectorMark } from './export.ts'
import { createVectorDocumentFromGeneration } from './fromGeneration.ts'

const SEEDS = [1, 42, 977]

const CASES = listModes().flatMap((mode) =>
  STYLE_FAMILIES.map((style) => ({ modeId: mode.id, styleFamily: style.id })),
)

function paramsFor({ modeId, styleFamily }: (typeof CASES)[number], seed: number): LogoParams {
  const style = getStyleFamilyDefaults(modeId, styleFamily)
  return {
    ...DEFAULT_PARAMS,
    ...style.shared,
    seed,
    modeId,
    generatorId: getModeGeneratorId(modeId),
    styleFamily,
    brandInput: modeId === 'monogram' ? { initials: 'MM' } : {},
    modeParams: { ...getAllModeParamDefaults(), [modeId]: style.modeParams },
  }
}

const scope = new paper.PaperScope()
scope.setup(new paper.Size(1, 1))

function measure(pathData: string) {
  scope.activate()
  const item = new scope.CompoundPath(pathData)
  const { left, top, right, bottom } = item.bounds
  const area = Math.abs(item.area)
  item.remove()
  return { area, left, top, right, bottom }
}

describe('converting a generated mark into layers', () => {
  it.each(CASES)('$modeId in the $styleFamily style composes to the generated mark', (mode) => {
    for (const seed of SEEDS) {
      const params = paramsFor(mode, seed)
      const result = generate(params)
      const generated = measure(result.mark.compoundPathData)
      const converted = measure(
        composeVectorMark(createVectorDocumentFromGeneration(result, params))!.compoundPathData,
      )

      expect(generated.area, `seed ${seed}: the generated mark has ink`).toBeGreaterThan(0)
      expect(Math.abs(converted.area - generated.area) / generated.area, `seed ${seed}: area`).toBeLessThan(0.001)
      for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
        expect(Math.abs(converted[edge] - generated[edge]), `seed ${seed}: ${edge} edge`).toBeLessThan(0.05)
      }
    }
  }, 20_000)
})
