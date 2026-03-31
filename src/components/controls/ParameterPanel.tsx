import { useMemo, type ReactNode } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { SeedInput } from './SeedInput.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { PresetSelector } from './PresetSelector.tsx'
import { SavedVariationsRail } from './SavedVariationsRail.tsx'
import {
  getModeDefinition,
  listModes,
  STYLE_FAMILIES,
} from '../../store/modes.ts'

export function ParameterPanel() {
  const params = useLogoStore((s) => s.params)
  const ui = useLogoStore((s) => s.ui)
  const setMode = useLogoStore((s) => s.setMode)
  const setStyleFamily = useLogoStore((s) => s.setStyleFamily)
  const setParam = useLogoStore((s) => s.setParam)
  const setModeParam = useLogoStore((s) => s.setModeParam)
  const setBrandInput = useLogoStore((s) => s.setBrandInput)
  const toggleGrid = useLogoStore((s) => s.toggleGrid)
  const toggleConstruction = useLogoStore((s) => s.toggleConstruction)

  const modes = useMemo(() => listModes(), [])
  const activeMode = getModeDefinition(params.modeId) ?? modes[0]
  const activeModeParams = (params.modeParams[params.modeId] ?? {}) as Record<string, number>

  return (
    <div className="flex flex-col gap-5 p-4 md:p-5 overflow-y-auto bg-[linear-gradient(180deg,rgba(250,250,250,0.96),rgba(245,245,245,0.96))]">
      <section className="rounded-[32px] border border-neutral-200 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),rgba(244,244,245,0.9)_58%,rgba(237,237,239,0.92)_100%)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.07)]">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.32em] text-neutral-400">
            Logo System
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
            Guided modes for different logo directions
          </h2>
          <p className="text-sm leading-6 text-neutral-500">
            Pick a mode, set the tone, and then push the structure until the mark feels right.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          {modes.map((mode) => {
            const active = mode.id === params.modeId
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setMode(mode.id)}
                className={`rounded-[24px] border px-4 py-3 text-left transition ${
                  active
                    ? 'border-neutral-900 bg-neutral-950 text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)]'
                    : 'border-neutral-200 bg-white/80 text-neutral-900 hover:border-neutral-400'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{mode.name}</div>
                    <p
                      className={`mt-1 text-xs leading-5 ${
                        active ? 'text-white/72' : 'text-neutral-500'
                      }`}
                    >
                      {mode.description}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.24em] ${
                      active
                        ? 'bg-white/10 text-white/80'
                        : 'bg-neutral-100 text-neutral-400'
                    }`}
                  >
                    {mode.id.replace('-', ' ')}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <PanelSection
        eyebrow="Shared controls"
        title={`${activeMode.name} setup`}
        description="These controls shape the overall direction before you fine-tune the mode."
      >
        <SeedInput />

        <div className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
            Style family
          </div>
          <div className="grid grid-cols-1 gap-2">
            {STYLE_FAMILIES.map((family) => {
              const active = family.id === params.styleFamily
              return (
                <button
                  key={family.id}
                  type="button"
                  onClick={() => setStyleFamily(family.id)}
                  className={`rounded-[20px] border p-3 text-left transition ${
                    active
                      ? 'border-neutral-900 bg-neutral-950 text-white'
                      : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-9 w-9 rounded-full bg-gradient-to-br ${family.accent}`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{family.label}</div>
                      <div
                        className={`text-xs leading-5 ${
                          active ? 'text-white/70' : 'text-neutral-500'
                        }`}
                      >
                        {family.blurb}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <ColorPicker />

        {activeMode.sharedControls.includes('brandInput') && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-neutral-500 uppercase tracking-[0.24em]">
              Initials
            </span>
            <input
              value={params.brandInput.initials ?? ''}
              onChange={(event) =>
                setBrandInput({ initials: event.target.value.toUpperCase() })
              }
              maxLength={3}
              placeholder="MM"
              className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium tracking-[0.18em] uppercase text-neutral-900 outline-none transition focus:border-neutral-900"
            />
            <span className="text-[11px] leading-5 text-neutral-500">
              1 to 3 letters. We normalize to uppercase for a cleaner monogram skeleton.
            </span>
          </div>
        )}

        {activeMode.sharedControls.includes('gridRings') && (
          <SliderControl
            label="Grid Rings"
            value={params.gridRings}
            min={1}
            max={8}
            step={1}
            onChange={(value) => setParam('gridRings', value)}
          />
        )}

        {activeMode.sharedControls.includes('symmetryFolds') && (
          <SliderControl
            label="Symmetry Folds"
            value={params.symmetryFolds}
            min={1}
            max={12}
            step={1}
            onChange={(value) => setParam('symmetryFolds', value)}
          />
        )}

        {activeMode.sharedControls.includes('additiveRatio') && (
          <SliderControl
            label="Additive Ratio"
            value={params.additiveRatio}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => setParam('additiveRatio', value)}
          />
        )}

        {activeMode.sharedControls.includes('baseRadius') && (
          <SliderControl
            label="Base Radius"
            value={params.baseRadius}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(value) => setParam('baseRadius', value)}
          />
        )}

        {activeMode.sharedControls.includes('radiusVariation') && (
          <SliderControl
            label="Radius Variation"
            value={params.radiusVariation}
            min={0}
            max={2}
            step={0.1}
            onChange={(value) => setParam('radiusVariation', value)}
          />
        )}

        {activeMode.sharedControls.includes('rotation') && (
          <SliderControl
            label="Rotation"
            value={params.rotation}
            min={0}
            max={360}
            step={1}
            onChange={(value) => setParam('rotation', value)}
          />
        )}

        {activeMode.sharedControls.includes('animationSpeed') && (
          <SliderControl
            label="Animation Speed"
            value={params.animationSpeed}
            min={0}
            max={5}
            step={0.1}
            onChange={(value) => setParam('animationSpeed', value)}
          />
        )}
      </PanelSection>

      <PanelSection
        eyebrow="Mode tuning"
        title={`${activeMode.name} controls`}
        description="The controls below only affect the active mode, so you can push each workflow without clutter."
      >
        {params.modeId === 'geometric-radial' && (
          <div className="rounded-[20px] border border-dashed border-neutral-200 bg-neutral-50 px-4 py-4 text-sm leading-6 text-neutral-500">
            This mode is driven mostly by shared symmetry and radius controls. Use style families and presets to swing it from quiet seal to expressive symbol.
          </div>
        )}

        {params.modeId === 'modular' && (
          <>
            <SliderControl
              label="Columns"
              value={activeModeParams.columns ?? 4}
              min={2}
              max={8}
              step={1}
              onChange={(value) => setModeParam('columns', value)}
            />
            <SliderControl
              label="Rows"
              value={activeModeParams.rows ?? 4}
              min={2}
              max={8}
              step={1}
              onChange={(value) => setModeParam('rows', value)}
            />
            <TogglePill
              label="Circle Clip"
              description="Mask the modular composition into a tighter circular badge."
              checked={(activeModeParams.circleClip ?? 1) > 0.5}
              onChange={(checked) => setModeParam('circleClip', checked ? 1 : 0)}
            />
          </>
        )}

        {params.modeId === 'grid-system' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <SliderControl
                label="Columns"
                value={activeModeParams.columns ?? 6}
                min={3}
                max={10}
                step={1}
                onChange={(value) => setModeParam('columns', value)}
              />
              <SliderControl
                label="Rows"
                value={activeModeParams.rows ?? 6}
                min={3}
                max={10}
                step={1}
                onChange={(value) => setModeParam('rows', value)}
              />
            </div>
            <SliderControl
              label="Density"
              value={activeModeParams.density ?? 0.55}
              min={0.2}
              max={0.9}
              step={0.01}
              onChange={(value) => setModeParam('density', value)}
            />
            <SliderControl
              label="Cell Inset"
              value={activeModeParams.cellInset ?? 0.12}
              min={0}
              max={0.32}
              step={0.01}
              onChange={(value) => setModeParam('cellInset', value)}
            />
            <SliderControl
              label="Stroke Bias"
              value={activeModeParams.strokeBias ?? 0.5}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setModeParam('strokeBias', value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <TogglePill
                label="Mirror X"
                description="Reflect occupied cells across the vertical axis."
                checked={(activeModeParams.mirrorX ?? 1) > 0.5}
                onChange={(checked) => setModeParam('mirrorX', checked ? 1 : 0)}
              />
              <TogglePill
                label="Mirror Y"
                description="Reflect occupied cells across the horizontal axis."
                checked={(activeModeParams.mirrorY ?? 0) > 0.5}
                onChange={(checked) => setModeParam('mirrorY', checked ? 1 : 0)}
              />
            </div>
            <SegmentedChoices
              label="Frame"
              value={activeModeParams.frameMode ?? 1}
              options={[
                { label: 'None', value: 0 },
                { label: 'Frame', value: 1 },
                { label: 'Badge', value: 2 },
              ]}
              onChange={(value) => setModeParam('frameMode', value)}
            />
          </>
        )}

        {params.modeId === 'monogram' && (
          <>
            <SliderControl
              label="Stroke Weight"
              value={activeModeParams.strokeWeight ?? 1.15}
              min={0.8}
              max={1.8}
              step={0.01}
              onChange={(value) => setModeParam('strokeWeight', value)}
            />
            <SliderControl
              label="Contrast"
              value={activeModeParams.contrast ?? 0.45}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setModeParam('contrast', value)}
            />
            <SliderControl
              label="Interlock Strength"
              value={activeModeParams.interlockStrength ?? 0.45}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setModeParam('interlockStrength', value)}
            />
            <SliderControl
              label="Symmetry Bias"
              value={activeModeParams.symmetryBias ?? 0.4}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setModeParam('symmetryBias', value)}
            />
            <SegmentedChoices
              label="Corner Style"
              value={activeModeParams.cornerStyle ?? 0}
              options={[
                { label: 'Sharp', value: 0 },
                { label: 'Soft', value: 1 },
                { label: 'Arc', value: 2 },
              ]}
              onChange={(value) => setModeParam('cornerStyle', value)}
            />
            <SegmentedChoices
              label="Frame"
              value={activeModeParams.frameMode ?? 0}
              options={[
                { label: 'None', value: 0 },
                { label: 'Inset', value: 1 },
                { label: 'Badge', value: 2 },
              ]}
              onChange={(value) => setModeParam('frameMode', value)}
            />
          </>
        )}

        {params.modeId === 'wave-arc' && (
          <>
            <SliderControl
              label="Arc Count"
              value={activeModeParams.arcCount ?? 4}
              min={2}
              max={8}
              step={1}
              onChange={(value) => setModeParam('arcCount', value)}
            />
            <SliderControl
              label="Spread Angle"
              value={activeModeParams.spreadAngle ?? 120}
              min={30}
              max={180}
              step={1}
              onChange={(value) => setModeParam('spreadAngle', value)}
            />
            <SliderControl
              label="Gap Ratio"
              value={activeModeParams.gapRatio ?? 0.3}
              min={0.1}
              max={0.8}
              step={0.01}
              onChange={(value) => setModeParam('gapRatio', value)}
            />
            <SliderControl
              label="Taper Amount"
              value={activeModeParams.taperAmount ?? 0.7}
              min={0.2}
              max={1}
              step={0.01}
              onChange={(value) => setModeParam('taperAmount', value)}
            />
            <div className="flex flex-col gap-2">
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
                Symmetry
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['bilateral', 'radial'] as const).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setModeParam('arcSymmetry', sym)}
                    className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                      ((params.modeParams[params.modeId] as Record<string, string | number> | undefined)?.arcSymmetry ?? 'bilateral') === sym
                        ? 'border-neutral-900 bg-neutral-950 text-white'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
            {((params.modeParams[params.modeId] as Record<string, string | number> | undefined)?.arcSymmetry ?? 'bilateral') === 'radial' && (
              <SliderControl
                label="Symmetry Folds"
                value={activeModeParams.symmetryFolds ?? 4}
                min={2}
                max={12}
                step={1}
                onChange={(value) => setModeParam('symmetryFolds', value)}
              />
            )}
          </>
        )}
      </PanelSection>

      <PanelSection
        eyebrow="Construction"
        title="Guides and overlays"
        description="Switch between the clean mark and the scaffolding underneath it."
      >
        <div className="grid grid-cols-2 gap-3">
          <TogglePill
            label="Show grid"
            description="Surface circles, grid lines, and mirror axes."
            checked={ui.showGrid}
            onChange={toggleGrid}
          />
          <TogglePill
            label="Show construction"
            description="Keep prototype and subtractive shapes visible beneath the final mark."
            checked={ui.showConstruction}
            onChange={toggleConstruction}
          />
        </div>
      </PanelSection>

      <PresetSelector />
      <SavedVariationsRail />
    </div>
  )
}

function PanelSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-[28px] border border-neutral-200 bg-white/90 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
      <div>
        <div className="text-[11px] uppercase tracking-[0.28em] text-neutral-400">
          {eyebrow}
        </div>
        <h3 className="mt-1 text-sm font-medium text-neutral-950">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p>
      </div>
      {children}
    </section>
  )
}

function TogglePill({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-[20px] border px-3 py-3 text-left transition ${
        checked
          ? 'border-neutral-900 bg-neutral-950 text-white'
          : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span
          className={`h-5 w-9 rounded-full border ${
            checked ? 'border-white/25 bg-white/10' : 'border-neutral-300 bg-white'
          }`}
        >
          <span
            className={`mt-[1px] block h-4 w-4 rounded-full transition ${
              checked
                ? 'translate-x-[18px] bg-white'
                : 'translate-x-[1px] bg-neutral-400'
            }`}
          />
        </span>
      </div>
      <div className={`mt-2 text-xs leading-5 ${checked ? 'text-white/70' : 'text-neutral-500'}`}>
        {description}
      </div>
    </button>
  )
}

function SegmentedChoices({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: Array<{ label: string; value: number }>
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
        {label}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
              value === option.value
                ? 'border-neutral-900 bg-neutral-950 text-white'
                : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
