import { useMemo, useState, type ReactNode } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { SeedInput } from './SeedInput.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { PresetSelector } from './PresetSelector.tsx'
import { SavedVariationsRail } from './SavedVariationsRail.tsx'
import { EffectControls } from './EffectControls.tsx'
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

  const STYLE_COLORS: Record<string, string> = {
    minimal: '#404040',
    heritage: '#92600a',
    luxe: '#1a1512',
    playful: '#0891b2',
    tech: '#1e3a5f',
  }

  return (
    <div className="flex flex-col text-neutral-300">
      {/* Mode tabs */}
      <div className="px-3 pt-3 pb-2 border-b border-neutral-800">
        <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-2">Mode</div>
        <div className="flex flex-wrap gap-1">
          {modes.map((mode) => {
            const active = mode.id === params.modeId
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setMode(mode.id)}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                  active
                    ? 'bg-white text-neutral-900 font-medium'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                }`}
              >
                {mode.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Style family */}
      <div className="px-3 py-2.5 border-b border-neutral-800">
        <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-2">Style</div>
        <div className="flex gap-2">
          {STYLE_FAMILIES.map((family) => {
            const active = family.id === params.styleFamily
            return (
              <button
                key={family.id}
                type="button"
                onClick={() => setStyleFamily(family.id)}
                className="group flex flex-col items-center gap-1"
                title={family.label}
              >
                <div
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    active ? 'border-white scale-110' : 'border-transparent hover:border-neutral-600'
                  }`}
                  style={{ backgroundColor: STYLE_COLORS[family.id] ?? '#333' }}
                />
                <span className={`text-[9px] uppercase tracking-wider ${active ? 'text-white' : 'text-neutral-500'}`}>
                  {family.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Seed + Color row */}
        <Section title="Generation" defaultOpen>
          <SeedInput />
          <ColorPicker />

          {activeMode.sharedControls.includes('brandInput') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-neutral-500 uppercase tracking-[0.15em]">Initials</span>
              <input
                value={params.brandInput.initials ?? ''}
                onChange={(event) => setBrandInput({ initials: event.target.value.toUpperCase() })}
                maxLength={3}
                placeholder="MM"
                className="rounded bg-neutral-800 border border-neutral-700 px-2.5 py-1.5 text-sm font-mono tracking-[0.15em] uppercase text-white outline-none focus:border-neutral-500 w-20"
              />
            </div>
          )}
        </Section>

        {/* Shared controls */}
        <Section title="Shape" defaultOpen>
          {activeMode.sharedControls.includes('gridRings') && (
            <SliderControl label="Rings" value={params.gridRings} min={1} max={8} step={1} onChange={(v) => setParam('gridRings', v)} />
          )}
          {activeMode.sharedControls.includes('symmetryFolds') && (
            <SliderControl label="Symmetry" value={params.symmetryFolds} min={1} max={12} step={1} onChange={(v) => setParam('symmetryFolds', v)} />
          )}
          {activeMode.sharedControls.includes('additiveRatio') && (
            <SliderControl label="Add/Sub" value={params.additiveRatio} min={0} max={1} step={0.05} onChange={(v) => setParam('additiveRatio', v)} />
          )}
          {activeMode.sharedControls.includes('baseRadius') && (
            <SliderControl label="Radius" value={params.baseRadius} min={0.1} max={1} step={0.05} onChange={(v) => setParam('baseRadius', v)} />
          )}
          {activeMode.sharedControls.includes('radiusVariation') && (
            <SliderControl label="Variation" value={params.radiusVariation} min={0} max={2} step={0.1} onChange={(v) => setParam('radiusVariation', v)} />
          )}
          {activeMode.sharedControls.includes('rotation') && (
            <SliderControl label="Rotation" value={params.rotation} min={0} max={360} step={1} onChange={(v) => setParam('rotation', v)} />
          )}
          {activeMode.sharedControls.includes('animationSpeed') && (
            <SliderControl label="Animation" value={params.animationSpeed} min={0} max={5} step={0.1} onChange={(v) => setParam('animationSpeed', v)} />
          )}
        </Section>

        {/* Mode-specific controls */}
        <Section title={`${activeMode.name}`} defaultOpen>
          {params.modeId === 'geometric-radial' && (
            <div className="text-[11px] text-neutral-500 leading-5">
              Driven by shape and symmetry controls above.
            </div>
          )}

          {params.modeId === 'modular' && (
            <>
              <SliderControl label="Columns" value={activeModeParams.columns ?? 4} min={2} max={8} step={1} onChange={(v) => setModeParam('columns', v)} />
              <SliderControl label="Rows" value={activeModeParams.rows ?? 4} min={2} max={8} step={1} onChange={(v) => setModeParam('rows', v)} />
              <Toggle label="Circle Clip" checked={(activeModeParams.circleClip ?? 1) > 0.5} onChange={(c) => setModeParam('circleClip', c ? 1 : 0)} />
            </>
          )}

          {params.modeId === 'grid-system' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <SliderControl label="Cols" value={activeModeParams.columns ?? 6} min={3} max={10} step={1} onChange={(v) => setModeParam('columns', v)} />
                <SliderControl label="Rows" value={activeModeParams.rows ?? 6} min={3} max={10} step={1} onChange={(v) => setModeParam('rows', v)} />
              </div>
              <SliderControl label="Density" value={activeModeParams.density ?? 0.55} min={0.2} max={0.9} step={0.01} onChange={(v) => setModeParam('density', v)} />
              <SliderControl label="Inset" value={activeModeParams.cellInset ?? 0.12} min={0} max={0.32} step={0.01} onChange={(v) => setModeParam('cellInset', v)} />
              <SliderControl label="Stroke" value={activeModeParams.strokeBias ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => setModeParam('strokeBias', v)} />
              <div className="flex gap-2">
                <Toggle label="Mirror X" checked={(activeModeParams.mirrorX ?? 1) > 0.5} onChange={(c) => setModeParam('mirrorX', c ? 1 : 0)} />
                <Toggle label="Mirror Y" checked={(activeModeParams.mirrorY ?? 0) > 0.5} onChange={(c) => setModeParam('mirrorY', c ? 1 : 0)} />
              </div>
              <Choices label="Frame" value={activeModeParams.frameMode ?? 1} options={[{ label: 'None', value: 0 }, { label: 'Frame', value: 1 }, { label: 'Badge', value: 2 }]} onChange={(v) => setModeParam('frameMode', v)} />
            </>
          )}

          {params.modeId === 'monogram' && (
            <>
              <SliderControl label="Weight" value={activeModeParams.strokeWeight ?? 1.15} min={0.8} max={1.8} step={0.01} onChange={(v) => setModeParam('strokeWeight', v)} />
              <SliderControl label="Contrast" value={activeModeParams.contrast ?? 0.45} min={0} max={1} step={0.01} onChange={(v) => setModeParam('contrast', v)} />
              <SliderControl label="Interlock" value={activeModeParams.interlockStrength ?? 0.45} min={0} max={1} step={0.01} onChange={(v) => setModeParam('interlockStrength', v)} />
              <SliderControl label="Symmetry" value={activeModeParams.symmetryBias ?? 0.4} min={0} max={1} step={0.01} onChange={(v) => setModeParam('symmetryBias', v)} />
              <Choices label="Corners" value={activeModeParams.cornerStyle ?? 0} options={[{ label: 'Sharp', value: 0 }, { label: 'Soft', value: 1 }, { label: 'Arc', value: 2 }]} onChange={(v) => setModeParam('cornerStyle', v)} />
              <Choices label="Frame" value={activeModeParams.frameMode ?? 0} options={[{ label: 'None', value: 0 }, { label: 'Inset', value: 1 }, { label: 'Badge', value: 2 }]} onChange={(v) => setModeParam('frameMode', v)} />
            </>
          )}

          {params.modeId === 'wave-arc' && (
            <>
              <SliderControl label="Arc Count" value={activeModeParams.arcCount ?? 4} min={2} max={8} step={1} onChange={(v) => setModeParam('arcCount', v)} />
              <SliderControl label="Spread" value={activeModeParams.spreadAngle ?? 120} min={30} max={180} step={1} onChange={(v) => setModeParam('spreadAngle', v)} />
              <SliderControl label="Gap" value={activeModeParams.gapRatio ?? 0.3} min={0.1} max={0.8} step={0.01} onChange={(v) => setModeParam('gapRatio', v)} />
              <SliderControl label="Taper" value={activeModeParams.taperAmount ?? 0.7} min={0.2} max={1} step={0.01} onChange={(v) => setModeParam('taperAmount', v)} />
              <Choices
                label="Symmetry"
                value={((params.modeParams[params.modeId] as Record<string, string | number> | undefined)?.arcSymmetry ?? 'bilateral') === 'radial' ? 1 : 0}
                options={[{ label: 'Bilateral', value: 0 }, { label: 'Radial', value: 1 }]}
                onChange={(v) => setModeParam('arcSymmetry', v === 1 ? 'radial' : 'bilateral')}
              />
              {((params.modeParams[params.modeId] as Record<string, string | number> | undefined)?.arcSymmetry ?? 'bilateral') === 'radial' && (
                <SliderControl label="Folds" value={activeModeParams.symmetryFolds ?? 4} min={2} max={12} step={1} onChange={(v) => setModeParam('symmetryFolds', v)} />
              )}
            </>
          )}
        </Section>

        {/* Effects */}
        <Section title="Effects">
          <EffectControls />
        </Section>

        {/* View */}
        <Section title="View">
          <div className="flex gap-2">
            <Toggle label="Grid" checked={ui.showGrid} onChange={toggleGrid} />
            <Toggle label="Construction" checked={ui.showConstruction} onChange={toggleConstruction} />
          </div>
        </Section>

        {/* Presets */}
        <Section title="Presets">
          <PresetSelector />
        </Section>

        <Section title="Saved">
          <SavedVariationsRail />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        {title}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex-1 px-2.5 py-1.5 rounded text-[11px] transition-colors ${
        checked ? 'bg-white text-neutral-900 font-medium' : 'bg-neutral-800 text-neutral-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

function Choices({ label, value, options, onChange }: { label: string; value: number; options: Array<{ label: string; value: number }>; onChange: (value: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500">{label}</div>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-1 rounded text-[11px] transition-colors ${
              value === opt.value ? 'bg-white text-neutral-900 font-medium' : 'bg-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
