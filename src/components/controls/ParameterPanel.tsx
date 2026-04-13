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

const PERSPECTIVE_PRESETS = [
  { label: 'Flat', x: 0, y: 0 },
  { label: 'Iso L', x: 25, y: -30 },
  { label: 'Iso R', x: 25, y: 30 },
  { label: 'Top', x: 35, y: 0 },
  { label: 'Tilt', x: -15, y: 20 },
] as const

export function ParameterPanel() {
  const params = useLogoStore((s) => s.params)
  const ui = useLogoStore((s) => s.ui)
  const setMode = useLogoStore((s) => s.setMode)
  const setStyleFamily = useLogoStore((s) => s.setStyleFamily)
  const setParam = useLogoStore((s) => s.setParam)
  const setModeParam = useLogoStore((s) => s.setModeParam)
  const setBrandInput = useLogoStore((s) => s.setBrandInput)
  const toggleShape = useLogoStore((s) => s.toggleShape)
  const toggleGrid = useLogoStore((s) => s.toggleGrid)
  const toggleConstruction = useLogoStore((s) => s.toggleConstruction)
  const setPerspective = useLogoStore((s) => s.setPerspective)
  const resetPerspective = useLogoStore((s) => s.resetPerspective)

  const modes = useMemo(() => listModes(), [])
  const activeMode = getModeDefinition(params.modeId) ?? modes[0]
  const activeModeParams = (params.modeParams[params.modeId] ?? {}) as Record<string, number>

  return (
    <div className="flex flex-col text-sm">
      {/* Mode selector */}
      <div className="p-3 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Mode</div>
        <div className="grid grid-cols-3 gap-1">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setMode(mode.id)}
              className={cn(
                'h-8 px-2 rounded-lg text-xs transition-colors',
                mode.id === params.modeId
                  ? 'bg-white/10 text-white font-medium ring-1 ring-white/10'
                  : 'text-sidebar-muted hover:text-white hover:bg-white/5',
              )}
            >
              {mode.name}
            </button>
          ))}
        </div>
      </div>

      {/* Style family */}
      <div className="p-3 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Style</div>
        <div className="flex items-center gap-1">
          {STYLE_FAMILIES.map((family) => (
            <button
              key={family.id}
              type="button"
              onClick={() => setStyleFamily(family.id)}
              title={family.label}
              className={cn(
                'flex-1 h-8 rounded-lg text-xs transition-all',
                family.id === params.styleFamily
                  ? 'bg-white/10 text-white font-medium ring-1 ring-white/10'
                  : 'text-sidebar-muted hover:text-white hover:bg-white/5',
              )}
            >
              {family.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Seed + Color — always visible, no collapsible */}
        <div className="p-3 border-b border-border flex flex-col gap-3">
          <SeedInput />
          <ColorPicker />
          {activeMode.sharedControls.includes('brandInput') && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-widest text-sidebar-muted shrink-0">Initials</label>
              <input
                value={params.brandInput.initials ?? ''}
                onChange={(e) => setBrandInput({ initials: e.target.value.toUpperCase() })}
                maxLength={3}
                placeholder="MM"
                className="flex-1 h-8 px-2.5 text-xs font-mono bg-white/5 border border-border rounded-lg text-white outline-none focus:border-sidebar-muted transition-colors"
              />
            </div>
          )}
        </div>

        <Section title="Shape" defaultOpen>
          {(params.modeId === 'geometric-radial' || params.modeId === 'modular') && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-sidebar-muted">Primitives</span>
              <div className="flex gap-1">
                {(['circle', 'rectangle', 'triangle', 'polygon', 'blob'] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => toggleShape(shape)}
                    className={cn(
                      'flex-1 h-7 rounded-md text-[10px] capitalize transition-all',
                      params.enabledShapes.includes(shape)
                        ? 'bg-white/10 text-white font-medium ring-1 ring-white/10'
                        : 'bg-white/[0.03] text-sidebar-muted hover:text-white hover:bg-white/5',
                    )}
                  >
                    {shape === 'rectangle' ? 'Rect' : shape}
                  </button>
                ))}
              </div>
            </div>
          )}
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
            <p className="text-xs text-sidebar-muted">Controlled by shape parameters above.</p>
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
              <div className="flex gap-1">
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

        <Section title="Perspective">
          <div className="flex gap-1 mb-2">
            {PERSPECTIVE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setPerspective('perspectiveX', preset.x)
                  setPerspective('perspectiveY', preset.y)
                }}
                className={cn(
                  'flex-1 h-7 rounded-md text-[10px] transition-all',
                  ui.perspectiveX === preset.x && ui.perspectiveY === preset.y
                    ? 'bg-white/10 text-white font-medium ring-1 ring-white/10'
                    : 'bg-white/[0.03] text-sidebar-muted hover:text-white hover:bg-white/5',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <SliderControl label="Tilt X" value={ui.perspectiveX} min={-45} max={45} step={1} onChange={(v) => setPerspective('perspectiveX', v)} />
          <SliderControl label="Tilt Y" value={ui.perspectiveY} min={-45} max={45} step={1} onChange={(v) => setPerspective('perspectiveY', v)} />
          {(ui.perspectiveX !== 0 || ui.perspectiveY !== 0) && (
            <button
              type="button"
              onClick={resetPerspective}
              className="h-7 text-xs text-sidebar-muted hover:text-white transition-colors"
            >
              Reset
            </button>
          )}
        </Section>

        <Section title="Overlays">
          <div className="flex gap-1">
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
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-3 py-2.5 text-[10px] uppercase tracking-widest text-sidebar-muted hover:text-white transition-colors"
      >
        <span>{title}</span>
        <svg className={cn('size-3 transition-transform', open && 'rotate-180')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex-1 h-8 px-2.5 rounded-lg text-xs transition-all',
        checked
          ? 'bg-white/10 text-white font-medium ring-1 ring-white/10'
          : 'bg-white/[0.03] text-sidebar-muted hover:text-white hover:bg-white/5',
      )}
    >
      {label}
    </button>
  )
}

function SegmentRow({ value, options, onChange }: { value: number; options: Array<{ l: string; v: number }>; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 p-0.5 bg-white/[0.03] rounded-lg">
      {options.map((opt) => (
        <button
          key={opt.v}
          type="button"
          onClick={() => onChange(opt.v)}
          className={cn(
            'flex-1 h-7 rounded-md text-xs transition-all',
            value === opt.v
              ? 'bg-white/10 text-white font-medium shadow-sm'
              : 'text-sidebar-muted hover:text-white',
          )}
        >
          {opt.l}
        </button>
      ))}
    </div>
  )
}
