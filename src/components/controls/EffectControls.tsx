import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'

export function EffectControls() {
  const dissolution = useLogoStore((s) => s.effectParams.dissolution)
  const toggleDissolution = useLogoStore((s) => s.toggleDissolution)
  const setEffectParam = useLogoStore((s) => s.setEffectParam)

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={toggleDissolution}
        className={`flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] transition-colors ${
          dissolution.enabled ? 'bg-white text-neutral-900 font-medium' : 'bg-neutral-800 text-neutral-400 hover:text-white'
        }`}
      >
        Dissolution
        <span className={`w-1.5 h-1.5 rounded-full ${dissolution.enabled ? 'bg-green-500' : 'bg-neutral-600'}`} />
      </button>

      {dissolution.enabled && (
        <>
          <SliderControl label="Threshold" value={dissolution.threshold} min={0.01} max={1} step={0.01} onChange={(v) => setEffectParam('threshold', v)} />
          <SliderControl label="Cell Size" value={dissolution.cellSize} min={4} max={32} step={1} onChange={(v) => setEffectParam('cellSize', v)} />
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500">Shape</div>
            <div className="flex gap-1">
              {(['square', 'circle'] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setEffectParam('shape', shape)}
                  className={`flex-1 px-2 py-1 rounded text-[11px] transition-colors ${
                    dissolution.shape === shape ? 'bg-white text-neutral-900 font-medium' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  {shape}
                </button>
              ))}
            </div>
          </div>
          <SliderControl label="Scatter" value={dissolution.scatter} min={0} max={1} step={0.01} onChange={(v) => setEffectParam('scatter', v)} />
          <SliderControl label="Size Var" value={dissolution.sizeVariation} min={0} max={1} step={0.01} onChange={(v) => setEffectParam('sizeVariation', v)} />
        </>
      )}
    </div>
  )
}
