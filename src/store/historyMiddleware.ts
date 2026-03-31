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
  return JSON.stringify(pastState.params) === JSON.stringify(currentState.params)
}

export { temporal }
