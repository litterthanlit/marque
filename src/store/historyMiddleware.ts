import { temporal } from 'zundo'
import type { LogoParams } from '../engine/types.ts'

export function paramsEqual(
  pastState: { params: LogoParams; effectParams?: Record<string, unknown> },
  currentState: { params: LogoParams; effectParams?: Record<string, unknown> },
): boolean {
  return (
    stableParamsString(pastState.params) === stableParamsString(currentState.params) &&
    JSON.stringify(pastState.effectParams) === JSON.stringify(currentState.effectParams)
  )
}

export { temporal }

function stableParamsString(params: LogoParams): string {
  return JSON.stringify({
    ...params,
    brandInput: Object.fromEntries(
      Object.entries(params.brandInput ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
    modeParams: Object.fromEntries(
      Object.entries(params.modeParams)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([modeId, values]) => [
          modeId,
          Object.fromEntries(
            Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ]),
    ),
  })
}
