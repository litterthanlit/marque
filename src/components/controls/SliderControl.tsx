import { useEffect, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

export function SliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: SliderControlProps) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-500 uppercase tracking-wider">
          {label}
        </span>
        <span className="text-neutral-400 tabular-nums font-mono">
          {Number.isInteger(step) ? draftValue : draftValue.toFixed(2)}
        </span>
      </div>
      <Slider.Root
        className="relative flex items-center h-4 select-none touch-none"
        value={[draftValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => setDraftValue(v)}
        onValueCommit={([v]) => onChange(v)}
      >
        <Slider.Track className="relative grow h-[3px] bg-neutral-200 rounded-full">
          <Slider.Range className="absolute h-full bg-neutral-900 rounded-full" />
        </Slider.Track>
        <Slider.Thumb className="block w-3 h-3 bg-neutral-900 rounded-full outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-400 transition-colors" />
      </Slider.Root>
    </div>
  )
}
