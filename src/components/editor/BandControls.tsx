import { useRef } from 'react'
import { BAND_SETTING_RANGE, type BandFit } from '../../engine/carve/spec.ts'
import { SliderControl } from '../controls/SliderControl.tsx'
import { Segmented } from './controls.tsx'
import { useShiftHeld } from './useShiftHeld.ts'

export const BAND_FIT_OPTIONS: ReadonlyArray<{ value: BandFit; label: string; title: string }> = [
  { value: 'belt', label: 'Belt', title: 'Wraps both circles, along their outer tangents' },
  { value: 'bar', label: 'Bar', title: 'Runs centre to centre at a set width' },
  { value: 'strip', label: 'Strip', title: 'Runs at a set angle, each edge touching one circle' },
  { value: 'neck', label: 'Neck', title: 'Joins the circles with concave arcs of a set radius' },
]

/** A band's settings: a bar's width, a strip's angle, a neck's radius. */
export interface BandValues {
  width: number
  angle: number
  radius: number
}

/**
 * What a setting control changes, and whether a key moved it: a burst of
 * keys is one undo step. `false` says the change was refused, and the
 * slider goes back to the band's value.
 */
export type BandChange = (update: Partial<BandValues>, byKey: boolean) => void | boolean

/** The widest bar and the largest neck the sliders reach; a strip turned half round is the same strip, so its angle stops short of 180°. */
const [MIN_WIDTH, MAX_WIDTH] = BAND_SETTING_RANGE.width
const [MIN_ANGLE, MAX_ANGLE] = BAND_SETTING_RANGE.angle
const [MIN_RADIUS, MAX_RADIUS] = BAND_SETTING_RANGE.radius

/**
 * The fit, as a row of four. A fit in `refused` is disabled, its title
 * saying why: the circles leave it no room.
 */
export function BandFitControl({ fit, onChange, refused = {} }: { fit: BandFit; onChange: (fit: BandFit) => void; refused?: Partial<Record<BandFit, string>> }) {
  const options = BAND_FIT_OPTIONS.map((option) => {
    const why = refused[option.value]
    return why && option.value !== fit ? { ...option, title: why, disabled: true } : option
  })
  return <Segmented label="Band fit" options={options} value={fit} onChange={onChange} />
}

/** A strip's angle as the slider lands it: whole degrees, or 15° steps with Shift, short of 180°. */
function landAngle(value: number, shift: boolean): number {
  if (!shift) return Math.round(value)
  const stepped = Math.round(value / 15) * 15
  return stepped > MAX_ANGLE ? stepped - 15 : stepped
}

/**
 * The setting of a fit: Width for a bar, Angle for a strip, Radius for a
 * neck; a belt has none. Each is written when the slider is let go;
 * `onInput` hears every value it passes on the way, to show it. A strip's
 * angle runs from 0° to 179°, whole degrees or 15° steps with Shift:
 * turned half round it is the same strip, and which side of each circle it
 * touches is up to where they lie.
 */
export function BandSettingControl({
  fit,
  values,
  onChange,
  onInput,
  className,
}: {
  fit: BandFit
  values: BandValues
  onChange: BandChange
  onInput?: (update: Partial<BandValues>) => void
  className?: string
}) {
  // Whether the slider was last moved by a key, whose every press it lets go on.
  const byKey = useRef(false)
  const shift = useShiftHeld()
  const keys = {
    onKeyDownCapture: () => (byKey.current = true),
    onPointerDownCapture: () => (byKey.current = false),
  }
  switch (fit) {
    case 'belt':
      return null
    case 'bar':
      return (
        <div className={className} title="How wide the bar is" {...keys}>
          <SliderControl
            label="Width"
            value={Math.min(values.width, MAX_WIDTH)}
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            step={1}
            emphasis
            onInput={onInput && ((width) => onInput({ width }))}
            onChange={(width) => onChange({ width }, byKey.current)}
          />
        </div>
      )
    case 'strip':
      return (
        <div className={className} title="The angle of its edges, clockwise from flat: 15° steps with Shift" {...keys}>
          <SliderControl
            label="Angle"
            value={Math.round(values.angle)}
            min={MIN_ANGLE}
            max={MAX_ANGLE}
            step={1}
            format={(angle) => `${angle}°`}
            emphasis
            adjust={(angle) => landAngle(angle, shift.current)}
            onInput={onInput && ((angle) => onInput({ angle }))}
            onChange={(angle) => onChange({ angle }, byKey.current)}
          />
        </div>
      )
    case 'neck':
      return (
        <div className={className} title="The radius of the arcs that join the circles" {...keys}>
          <SliderControl
            label="Radius"
            value={Math.min(values.radius, MAX_RADIUS)}
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            step={1}
            emphasis
            onInput={onInput && ((radius) => onInput({ radius }))}
            onChange={(radius) => onChange({ radius }, byKey.current)}
          />
        </div>
      )
    default:
      return fit satisfies never
  }
}
