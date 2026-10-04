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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-sidebar-text">{label}</span>
        <span className="text-[10px] text-sidebar-muted font-mono tabular-nums">
          {Number.isInteger(step) ? draftValue : draftValue.toFixed(2)}
        </span>
      </div>
      <Slider.Root
        className="relative flex items-center h-5 select-none touch-none group"
        value={[draftValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => setDraftValue(v)}
        onValueCommit={([v]) => onChange(v)}
      >
        <Slider.Track className="relative grow h-[3px] bg-interactive-active rounded-full">
          <Slider.Range className="absolute h-full bg-interactive rounded-full group-hover:bg-interactive-hover transition-colors" />
        </Slider.Track>
        <Slider.Thumb className="block size-3 bg-white rounded-full outline-none shadow-sm shadow-black/30 hover:scale-110 focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised transition-transform" />
      </Slider.Root>
    </div>
  )
}
