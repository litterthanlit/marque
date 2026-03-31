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

export function SliderControl({ label, value, min, max, step, onChange }: SliderControlProps) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-neutral-500 uppercase tracking-[0.15em]">{label}</span>
        <span className="text-neutral-600 tabular-nums font-mono">{Number.isInteger(step) ? draftValue : draftValue.toFixed(2)}</span>
      </div>
      <Slider.Root
        className="relative flex items-center h-3 select-none touch-none"
        value={[draftValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => setDraftValue(v)}
        onValueCommit={([v]) => onChange(v)}
      >
        <Slider.Track className="relative grow h-[2px] bg-neutral-700 rounded-full">
          <Slider.Range className="absolute h-full bg-neutral-400 rounded-full" />
        </Slider.Track>
        <Slider.Thumb className="block w-2.5 h-2.5 bg-white rounded-full outline-none hover:bg-neutral-200 focus-visible:ring-1 focus-visible:ring-neutral-400 transition-colors" />
      </Slider.Root>
    </div>
  )
}
