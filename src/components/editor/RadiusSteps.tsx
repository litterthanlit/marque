import { MAX_FILLET_RADIUS, MIN_FILLET_RADIUS } from '../../store/logoStore.ts'
import { StepButtons } from './controls.tsx'

/** A unit smaller or larger from a fillet radius, or 5 with Shift or a long press, from 2 to 200. */
export function RadiusSteps({ value, onStep }: { value: number; onStep: (next: number) => void }) {
  return (
    <StepButtons
      value={value}
      label="Radius steps"
      land={(from, by, five) => Math.max(MIN_FILLET_RADIUS, Math.min(MAX_FILLET_RADIUS, from + (five ? 5 : 1) * by))}
      onStep={onStep}
      less={{ label: 'Radius 1 less', title: 'Radius 1 less (Shift or hold: 5)', disabled: value <= MIN_FILLET_RADIUS }}
      more={{ label: 'Radius 1 more', title: 'Radius 1 more (Shift or hold: 5)', disabled: value >= MAX_FILLET_RADIUS }}
    />
  )
}
