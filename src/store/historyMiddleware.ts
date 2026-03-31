import { temporal } from 'zundo'
import type { LogoParams } from '../engine/types.ts'

/**
 * Equality check: only snapshot when params change, not UI state.
 * Compares serialized params to avoid unnecessary history entries.
 */
export function paramsEqual(
  pastState: { params: LogoParams },
  currentState: { params: LogoParams },
): boolean {
  return stableParamsString(pastState.params) === stableParamsString(currentState.params)
}

export { temporal }

function stableParamsString(params: LogoParams): string {
  return JSON.stringify({
    ...params,
    extra: Object.fromEntries(
      Object.entries(params.extra).sort(([a], [b]) => a.localeCompare(b)),
    ),
  })
}
