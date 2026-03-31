import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'

export function EffectControls() {
  const dissolution = useLogoStore((s) => s.effectParams.dissolution)
  const toggleDissolution = useLogoStore((s) => s.toggleDissolution)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={toggleDissolution}
        className={`rounded-[20px] border px-3 py-3 text-left transition ${
          dissolution.enabled
            ? 'border-neutral-900 bg-neutral-950 text-white'
            : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Pixel Dissolution</span>
          <span
            className={`h-5 w-9 rounded-full border ${
              dissolution.enabled
                ? 'border-white/25 bg-white/10'
                : 'border-neutral-300 bg-white'
            }`}
          >
            <span
              className={`mt-[1px] block h-4 w-4 rounded-full transition ${
                dissolution.enabled
                  ? 'translate-x-[18px] bg-white'
                  : 'translate-x-[1px] bg-neutral-400'
              }`}
            />
          </span>
        </div>
        <div
          className={`mt-2 text-xs leading-5 ${
            dissolution.enabled ? 'text-white/70' : 'text-neutral-500'
          }`}
        >
          Decompose the mark into a field of particles with controllable erosion depth.
        </div>
      </button>

      {dissolution.enabled && (
        <>
          <SliderControl
            label="Threshold"
            value={dissolution.threshold}
            min={0.01}
            max={1}
            step={0.01}
            onChange={(value) => setEffectParam('threshold', value)}
          />
          <SliderControl
            label="Cell Size"
            value={dissolution.cellSize}
            min={4}
            max={32}
            step={1}
            onChange={(value) => setEffectParam('cellSize', value)}
          />
          <div className="flex flex-col gap-2">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
              Particle Shape
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['square', 'circle'] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setEffectParam('shape', shape)}
                  className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    dissolution.shape === shape
                      ? 'border-neutral-900 bg-neutral-950 text-white'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300'
                  }`}
                >
                  {shape}
                </button>
              ))}
            </div>
          </div>
          <SliderControl
            label="Scatter"
            value={dissolution.scatter}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setEffectParam('scatter', value)}
          />
          <SliderControl
            label="Size Variation"
            value={dissolution.sizeVariation}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setEffectParam('sizeVariation', value)}
          />
        </>
      )}
    </div>
  )
}
