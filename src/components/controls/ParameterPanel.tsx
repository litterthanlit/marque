import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { SeedInput } from './SeedInput.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { PresetSelector } from './PresetSelector.tsx'
import { GeneratorSelector } from './GeneratorSelector.tsx'
import { getGenerator } from '../../engine/generators/registry.ts'

export function ParameterPanel() {
  const params = useLogoStore((s) => s.params)
  const setParam = useLogoStore((s) => s.setParam)
  const ui = useLogoStore((s) => s.ui)
  const toggleGrid = useLogoStore((s) => s.toggleGrid)
  const toggleConstruction = useLogoStore((s) => s.toggleConstruction)

  const currentGenerator = getGenerator(params.generatorId)
  const isModularGenerator = params.generatorId === 'modular'

  return (
    <div className="flex flex-col gap-5 p-5 overflow-y-auto">
      <SeedInput />

      <GeneratorSelector />

      {/* Dynamic extra params from generator */}
      {currentGenerator?.extraParams.map((paramDef) => (
        <SliderControl
          key={paramDef.key}
          label={paramDef.label}
          value={params.extra[paramDef.key] ?? paramDef.default}
          min={paramDef.min}
          max={paramDef.max}
          step={paramDef.step}
          onChange={(v) => {
            setParam('extra', { ...params.extra, [paramDef.key]: v })
          }}
        />
      ))}

      {!isModularGenerator && (
        <>
          <SliderControl
            label="Grid Rings"
            value={params.gridRings}
            min={1}
            max={8}
            step={1}
            onChange={(v) => setParam('gridRings', v)}
          />

          <SliderControl
            label="Symmetry Folds"
            value={params.symmetryFolds}
            min={1}
            max={12}
            step={1}
            onChange={(v) => setParam('symmetryFolds', v)}
          />
        </>
      )}

      <SliderControl
        label="Additive Ratio"
        value={params.additiveRatio}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setParam('additiveRatio', v)}
      />

      <SliderControl
        label="Base Radius"
        value={params.baseRadius}
        min={0.1}
        max={1}
        step={0.05}
        onChange={(v) => setParam('baseRadius', v)}
      />

      <SliderControl
        label="Radius Variation"
        value={params.radiusVariation}
        min={0}
        max={2}
        step={0.1}
        onChange={(v) => setParam('radiusVariation', v)}
      />

      <SliderControl
        label="Rotation"
        value={params.rotation}
        min={0}
        max={360}
        step={1}
        onChange={(v) => setParam('rotation', v)}
      />

      {!isModularGenerator && (
        <SliderControl
          label="Animation Speed"
          value={params.animationSpeed}
          min={0}
          max={5}
          step={0.1}
          onChange={(v) => setParam('animationSpeed', v)}
        />
      )}

      <ColorPicker />

      <div className="flex flex-col gap-3 pt-3 border-t border-neutral-200">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={ui.showGrid}
            onChange={toggleGrid}
            className="rounded"
          />
          <span className="text-neutral-600">Show Grid</span>
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={ui.showConstruction}
            onChange={toggleConstruction}
            className="rounded"
          />
          <span className="text-neutral-600">Show Construction</span>
        </label>
      </div>

      <PresetSelector />
    </div>
  )
}
