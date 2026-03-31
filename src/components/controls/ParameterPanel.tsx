import { useMemo, useState, type ReactNode } from 'react'
import { useLogoStore } from '../../store/logoStore.ts'
import { SliderControl } from './SliderControl.tsx'
import { SeedInput } from './SeedInput.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { PresetSelector } from './PresetSelector.tsx'
import { SavedVariationsRail } from './SavedVariationsRail.tsx'
import { EffectControls } from './EffectControls.tsx'
import { getModeDefinition, listModes, STYLE_FAMILIES } from '../../store/modes.ts'
import { cn } from '../../lib/utils.ts'

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

  const STYLE_DOTS: Record<string, string> = {
    minimal: 'bg-neutral-600',
    heritage: 'bg-amber-700',
    luxe: 'bg-neutral-900',
    playful: 'bg-cyan-500',
    tech: 'bg-blue-600',
  }

  return (
    <div className="flex flex-col text-sm">
      {/* Mode selector */}
      <div className="p-3 border-b border-sidebar-border">
        <div className="flex flex-wrap gap-0.5">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setMode(mode.id)}
              className={cn(
                'h-7 px-2.5 rounded-md text-xs',
                mode.id === params.modeId
                  ? 'bg-white text-neutral-900 font-medium'
                  : 'text-sidebar-muted hover:text-white hover:bg-white/5',
              )}
            >
              {mode.name}
            </button>
          ))}
        </div>
      </div>

      {/* Style family */}
      <div className="flex items-center gap-3 p-3 border-b border-sidebar-border">
        <span className="text-xs text-sidebar-muted shrink-0">Style</span>
        <div className="flex items-center gap-1.5">
          {STYLE_FAMILIES.map((family) => (
            <button
              key={family.id}
              type="button"
              onClick={() => setStyleFamily(family.id)}
              title={family.label}
              className="group flex flex-col items-center gap-0.5"
            >
              <div className={cn(
                'size-5 rounded-full border',
                STYLE_DOTS[family.id] ?? 'bg-neutral-500',
                family.id === params.styleFamily ? 'border-white ring-1 ring-white/20' : 'border-transparent',
              )} />
              <span className={cn('text-[9px]', family.id === params.styleFamily ? 'text-white' : 'text-sidebar-muted')}>
                {family.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Generation" defaultOpen>
          <SeedInput />
          <ColorPicker />
          {activeMode.sharedControls.includes('brandInput') && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-sidebar-text shrink-0">Initials</label>
              <input
                value={params.brandInput.initials ?? ''}
                onChange={(e) => setBrandInput({ initials: e.target.value.toUpperCase() })}
                maxLength={3}
                placeholder="MM"
                className="h-7 w-16 px-2 text-xs font-mono bg-transparent border border-sidebar-border rounded-md text-white outline-none focus:border-neutral-500"
              />
            </div>
          )}
        </Section>

        <Section title="Shape" defaultOpen>
          {activeMode.sharedControls.includes('gridRings') && (
            <SliderControl label="Rings" value={params.gridRings} min={1} max={8} step={1} onChange={(v) => setParam('gridRings', v)} />
          )}
          {activeMode.sharedControls.includes('symmetryFolds') && (
            <SliderControl label="Symmetry" value={params.symmetryFolds} min={1} max={12} step={1} onChange={(v) => setParam('symmetryFolds', v)} />
          )}
          {activeMode.sharedControls.includes('additiveRatio') && (
            <SliderControl label="Add / Sub" value={params.additiveRatio} min={0} max={1} step={0.05} onChange={(v) => setParam('additiveRatio', v)} />
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

        <Section title={activeMode.name} defaultOpen>
          {params.modeId === 'geometric-radial' && (
            <p className="text-xs text-sidebar-muted text-pretty">Controlled by shape parameters above.</p>
          )}
          {params.modeId === 'modular' && (
            <>
              <SliderControl label="Columns" value={activeModeParams.columns ?? 4} min={2} max={8} step={1} onChange={(v) => setModeParam('columns', v)} />
              <SliderControl label="Rows" value={activeModeParams.rows ?? 4} min={2} max={8} step={1} onChange={(v) => setModeParam('rows', v)} />
              <ToggleRow label="Circle Clip" checked={(activeModeParams.circleClip ?? 1) > 0.5} onChange={(c) => setModeParam('circleClip', c ? 1 : 0)} />
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
              <div className="flex gap-1.5">
                <ToggleRow label="Mirror X" checked={(activeModeParams.mirrorX ?? 1) > 0.5} onChange={(c) => setModeParam('mirrorX', c ? 1 : 0)} />
                <ToggleRow label="Mirror Y" checked={(activeModeParams.mirrorY ?? 0) > 0.5} onChange={(c) => setModeParam('mirrorY', c ? 1 : 0)} />
              </div>
              <SegmentRow value={activeModeParams.frameMode ?? 1} options={[{ l: 'None', v: 0 }, { l: 'Frame', v: 1 }, { l: 'Badge', v: 2 }]} onChange={(v) => setModeParam('frameMode', v)} />
            </>
          )}
          {params.modeId === 'monogram' && (
            <>
              <SliderControl label="Weight" value={activeModeParams.strokeWeight ?? 1.15} min={0.8} max={1.8} step={0.01} onChange={(v) => setModeParam('strokeWeight', v)} />
              <SliderControl label="Contrast" value={activeModeParams.contrast ?? 0.45} min={0} max={1} step={0.01} onChange={(v) => setModeParam('contrast', v)} />
              <SliderControl label="Interlock" value={activeModeParams.interlockStrength ?? 0.45} min={0} max={1} step={0.01} onChange={(v) => setModeParam('interlockStrength', v)} />
              <SliderControl label="Symmetry" value={activeModeParams.symmetryBias ?? 0.4} min={0} max={1} step={0.01} onChange={(v) => setModeParam('symmetryBias', v)} />
              <SegmentRow value={activeModeParams.cornerStyle ?? 0} options={[{ l: 'Sharp', v: 0 }, { l: 'Soft', v: 1 }, { l: 'Arc', v: 2 }]} onChange={(v) => setModeParam('cornerStyle', v)} />
              <SegmentRow value={activeModeParams.frameMode ?? 0} options={[{ l: 'None', v: 0 }, { l: 'Inset', v: 1 }, { l: 'Badge', v: 2 }]} onChange={(v) => setModeParam('frameMode', v)} />
            </>
          )}
          {params.modeId === 'wave-arc' && (
            <>
              <SliderControl label="Arcs" value={activeModeParams.arcCount ?? 4} min={2} max={8} step={1} onChange={(v) => setModeParam('arcCount', v)} />
              <SliderControl label="Spread" value={activeModeParams.spreadAngle ?? 120} min={30} max={180} step={1} onChange={(v) => setModeParam('spreadAngle', v)} />
              <SliderControl label="Gap" value={activeModeParams.gapRatio ?? 0.3} min={0.1} max={0.8} step={0.01} onChange={(v) => setModeParam('gapRatio', v)} />
              <SliderControl label="Taper" value={activeModeParams.taperAmount ?? 0.7} min={0.2} max={1} step={0.01} onChange={(v) => setModeParam('taperAmount', v)} />
              <SegmentRow
                value={((params.modeParams[params.modeId] as Record<string, string | number> | undefined)?.arcSymmetry ?? 'bilateral') === 'radial' ? 1 : 0}
                options={[{ l: 'Bilateral', v: 0 }, { l: 'Radial', v: 1 }]}
                onChange={(v) => setModeParam('arcSymmetry', v === 1 ? 'radial' : 'bilateral')}
              />
              {((params.modeParams[params.modeId] as Record<string, string | number> | undefined)?.arcSymmetry ?? 'bilateral') === 'radial' && (
                <SliderControl label="Folds" value={activeModeParams.symmetryFolds ?? 4} min={2} max={12} step={1} onChange={(v) => setModeParam('symmetryFolds', v)} />
              )}
            </>
          )}
        </Section>

        <Section title="Effects">
          <EffectControls />
        </Section>

        <Section title="View">
          <div className="flex gap-1.5">
            <ToggleRow label="Grid" checked={ui.showGrid} onChange={toggleGrid} />
            <ToggleRow label="Construction" checked={ui.showConstruction} onChange={toggleConstruction} />
          </div>
        </Section>

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
    <div className="border-b border-sidebar-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-3 py-2.5 text-xs text-sidebar-muted hover:text-white"
      >
        <span>{title}</span>
        <svg className={cn('size-3', open && 'rotate-180')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2">{children}</div>}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex-1 h-7 px-2.5 rounded-md text-xs',
        checked ? 'bg-white text-neutral-900 font-medium' : 'bg-white/5 text-sidebar-muted hover:text-white',
      )}
    >
      {label}
    </button>
  )
}

function SegmentRow({ value, options, onChange }: { value: number; options: Array<{ l: string; v: number }>; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.v}
          type="button"
          onClick={() => onChange(opt.v)}
          className={cn(
            'flex-1 h-7 rounded-md text-xs',
            value === opt.v ? 'bg-white text-neutral-900 font-medium' : 'bg-white/5 text-sidebar-muted hover:text-white',
          )}
        >
          {opt.l}
        </button>
      ))}
    </div>
  )
}
