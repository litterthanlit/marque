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
import { useLocalStoragePref } from '../../hooks/useLocalStoragePref.ts'
import { isIllustratorSourceStale } from '../../engine/illustrator/compose.ts'
import { DEFAULT_ILLUSTRATOR_TRANSFORM } from '../../engine/illustrator/types.ts'

type Tab = 'generate' | 'illustrator'

const PERSPECTIVE_PRESETS = [
  { label: 'Flat', x: 0, y: 0 },
  { label: 'Iso L', x: 25, y: -30 },
  { label: 'Iso R', x: 25, y: 30 },
  { label: 'Top', x: 35, y: 0 },
  { label: 'Tilt', x: -15, y: 20 },
] as const

type Tool = 'select' | 'pencil' | 'pen' | 'graffiti' | 'shapebuilder'

const TOOLS: Array<{ id: Tool; label: string; icon: string; fill?: boolean }> = [
  {
    id: 'select',
    label: 'Select',
    icon: 'M4 4l7 17 2.5-6.5L20 12z',
    fill: true,
  },
  {
    id: 'shapebuilder',
    label: 'Shape Builder',
    icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01z',
  },
  {
    id: 'pencil',
    label: 'Pencil',
    icon: 'M3 21l1.5-4.5L17.7 3.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7.5 19.5z',
  },
  {
    id: 'pen',
    label: 'Pen',
    icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  },
  {
    id: 'graffiti',
    label: 'Spray',
    icon: 'M12 2v6m4-4l-2 2m-4-2l2 2M7 12a5 5 0 0 0 10 0M9 22h6m-3-5v5',
  },
]

export function ParameterPanel() {
  const activeSurface = useLogoStore((s) => s.activeSurface)
  const setActiveSurface = useLogoStore((s) => s.setActiveSurface)
  const ensureIllustratorDocument = useLogoStore((s) => s.ensureIllustratorDocument)
  const tab: Tab = activeSurface === 'illustrator' ? 'illustrator' : 'generate'

  function selectTab(nextTab: Tab) {
    if (nextTab === 'generate') {
      setActiveSurface('generated')
      return
    }
    ensureIllustratorDocument()
  }

  return (
    <div className="flex flex-col text-sm h-full">
      {/* Segmented control */}
      <div className="p-3 shrink-0 border-b border-border">
        <div className="flex gap-1 p-0.5 bg-interactive-active rounded-lg">
          {(['generate', 'illustrator'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectTab(t)}
              className={cn(
                'flex-1 h-8 rounded-md text-xs capitalize transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                tab === t
                  ? 'bg-interactive text-fg font-medium shadow-sm'
                  : 'text-sidebar-muted hover:text-fg',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'generate' && <GenerateTab />}
        {tab === 'illustrator' && <IllustratorTab />}
      </div>
    </div>
  )
}

/* ─── Generate Tab ─── */

function GenerateTab() {
  const params = useLogoStore((s) => s.params)
  const setMode = useLogoStore((s) => s.setMode)
  const setStyleFamily = useLogoStore((s) => s.setStyleFamily)
  const setBrandInput = useLogoStore((s) => s.setBrandInput)
  const randomizeSeed = useLogoStore((s) => s.randomizeSeed)
  const setParam = useLogoStore((s) => s.setParam)
  const setModeParam = useLogoStore((s) => s.setModeParam)
  const toggleShape = useLogoStore((s) => s.toggleShape)
  const toggleGrid = useLogoStore((s) => s.toggleGrid)
  const toggleConstruction = useLogoStore((s) => s.toggleConstruction)
  const setPerspective = useLogoStore((s) => s.setPerspective)
  const resetPerspective = useLogoStore((s) => s.resetPerspective)
  const ui = useLogoStore((s) => s.ui)

  const modes = useMemo(() => listModes(), [])
  const activeMode = getModeDefinition(params.modeId) ?? modes[0]
  const activeModeParams = (params.modeParams[params.modeId] ?? {}) as Record<string, number>

  const [advancedOpen, setAdvancedOpen] = useLocalStoragePref('dalat.advancedParamsOpen', false)

  const PRIMARY_SLIDERS: Array<{
    label: string
    param: 'symmetryFolds' | 'baseRadius' | 'additiveRatio' | 'radiusVariation'
    min: number
    max: number
    step: number
    value: number
  }> = [
    { label: 'Symmetry', param: 'symmetryFolds', min: 1, max: 12, step: 1, value: params.symmetryFolds },
    { label: 'Radius', param: 'baseRadius', min: 0.1, max: 1, step: 0.05, value: params.baseRadius },
    { label: 'Add / Sub', param: 'additiveRatio', min: 0, max: 1, step: 0.05, value: params.additiveRatio },
    { label: 'Variation', param: 'radiusVariation', min: 0, max: 2, step: 0.1, value: params.radiusVariation },
  ]

  return (
    <>
      {/* Hero Random button */}
      <div className="p-3 border-b border-border">
        <button
          type="button"
          onClick={randomizeSeed}
          className="w-full h-10 rounded-lg text-sm font-medium bg-fg text-surface hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          Random
        </button>
        <p className="text-[10px] text-sidebar-muted text-center mt-1.5">
          Press <kbd className="font-mono bg-interactive-active px-1 py-0.5 rounded">R</kbd> anytime
        </p>
      </div>

      {/* Mode */}
      <div className="p-3 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Mode</div>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-1">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setMode(mode.id)}
              className={cn(
                'h-8 min-w-0 px-2 rounded-lg text-xs transition-colors truncate',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                mode.id === params.modeId
                  ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                  : 'text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
              )}
            >
              {mode.name}
            </button>
          ))}
        </div>
      </div>

      {/* Style */}
      <div className="p-3 border-b border-border">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Style</div>
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-1">
          {STYLE_FAMILIES.map((family) => (
            <button
              key={family.id}
              type="button"
              onClick={() => setStyleFamily(family.id)}
              title={family.label}
              className={cn(
                'h-8 min-w-0 rounded-lg px-1.5 text-xs transition-all truncate',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                family.id === params.styleFamily
                  ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                  : 'text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
              )}
            >
              {family.label}
            </button>
          ))}
        </div>
      </div>

      {/* Seed + Color + Initials */}
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
              className="flex-1 h-8 px-2.5 text-xs font-mono bg-interactive border border-border rounded-lg text-fg outline-none focus:border-sidebar-muted transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            />
          </div>
        )}
      </div>

      {/* Primary sliders — always visible */}
      <div className="border-b border-border">
        <div className="px-3 pt-2.5 pb-0">
          <span className="text-[10px] uppercase tracking-widest text-sidebar-muted">Primary</span>
        </div>
        <div className="px-3 pb-3 pt-2 flex flex-col gap-2.5">
          {PRIMARY_SLIDERS.map(({ label, param, min, max, step, value }) => {
            const enabled = activeMode.sharedControls.includes(param)
            return enabled ? (
              <SliderControl
                key={param}
                label={label}
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(v) => setParam(param, v)}
              />
            ) : (
              <div
                key={param}
                className="opacity-40 pointer-events-none"
                title="Not available in this mode"
              >
                <SliderControl
                  label={label}
                  value={value}
                  min={min}
                  max={max}
                  step={step}
                  onChange={() => { /* disabled */ }}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Advanced collapsible */}
      <div className="border-b border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center justify-between w-full px-3 py-2.5 text-[10px] uppercase tracking-widest text-sidebar-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          <span>{advancedOpen ? 'Hide advanced' : 'Show advanced'}</span>
          <svg
            className={cn('size-3 transition-transform', advancedOpen && 'rotate-180')}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>

        {advancedOpen && (
          <div className="flex flex-col">
            {/* Primitives — geometric-radial and modular only */}
            {(params.modeId === 'geometric-radial' || params.modeId === 'modular') && (
              <div className="px-3 pb-3 pt-0 border-t border-border flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-sidebar-muted pt-2">Primitives</span>
                <div className="flex gap-1">
                  {(['circle', 'rectangle', 'triangle', 'polygon', 'blob'] as const).map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      onClick={() => toggleShape(shape)}
                      className={cn(
                        'flex-1 h-7 rounded-md text-[10px] capitalize transition-all',
                        params.enabledShapes.includes(shape)
                          ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                          : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                      )}
                    >
                      {shape === 'rectangle' ? 'Rect' : shape}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Rotation slider */}
            {activeMode?.sharedControls.includes('rotation') && (
              <div className="border-t border-border">
                <div className="px-3 pb-3 pt-2.5 flex flex-col gap-2.5">
                  <SliderControl label="Rotation" value={params.rotation} min={0} max={360} step={1} onChange={(v) => setParam('rotation', v)} />
                </div>
              </div>
            )}

            {/* Animation slider */}
            {activeMode?.sharedControls.includes('animationSpeed') && (
              <div className="border-t border-border">
                <div className="px-3 pb-3 pt-2.5 flex flex-col gap-2.5">
                  <SliderControl label="Animation" value={params.animationSpeed} min={0} max={5} step={0.1} onChange={(v) => setParam('animationSpeed', v)} />
                </div>
              </div>
            )}

            {/* Mode-specific params */}
            <Section title={activeMode?.name ?? 'Mode'} defaultOpen>
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

            {/* Effects */}
            <Section title="Effects" defaultOpen>
              <EffectControls />
            </Section>

            {/* Perspective */}
            <Section title="Perspective" defaultOpen>
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
                        ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                        : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <SliderControl label="Tilt X" value={ui.perspectiveX} min={-45} max={45} step={1} onChange={(v) => setPerspective('perspectiveX', v)} />
              <SliderControl label="Tilt Y" value={ui.perspectiveY} min={-45} max={45} step={1} onChange={(v) => setPerspective('perspectiveY', v)} />
              {(ui.perspectiveX !== 0 || ui.perspectiveY !== 0) && (
                <button type="button" onClick={resetPerspective} className="h-7 text-xs text-sidebar-muted hover:text-fg transition-colors">
                  Reset
                </button>
              )}
            </Section>

            {/* Overlays */}
            <Section title="Overlays" defaultOpen>
              <div className="flex gap-1">
                <ToggleRow label="Grid" checked={ui.showGrid} onChange={toggleGrid} />
                <ToggleRow label="Construction" checked={ui.showConstruction} onChange={toggleConstruction} />
              </div>
            </Section>
          </div>
        )}
      </div>

      {/* Presets */}
      <Section title="Presets" defaultOpen>
        <PresetSelector />
      </Section>

      {/* Saved */}
      <Section title="Saved">
        <SavedVariationsRail />
      </Section>
    </>
  )
}

/* ─── Illustrator Tab ─── */

function IllustratorTab() {
  const params = useLogoStore((s) => s.params)
  const result = useLogoStore((s) => s.result)
  const illustrator = useLogoStore((s) => s.illustrator)
  const activeTool = useLogoStore((s) => s.ui.activeTool)
  const setActiveTool = useLogoStore((s) => s.setActiveTool)
  const convertCurrentMark = useLogoStore((s) => s.convertCurrentMark)
  const resetIllustrator = useLogoStore((s) => s.resetIllustrator)
  const setIllustratorMode = useLogoStore((s) => s.setIllustratorMode)
  const selectIllustratorLayer = useLogoStore((s) => s.selectIllustratorLayer)
  const updateIllustratorLayer = useLogoStore((s) => s.updateIllustratorLayer)
  const updateIllustratorLayerTransform = useLogoStore((s) => s.updateIllustratorLayerTransform)
  const duplicateIllustratorLayer = useLogoStore((s) => s.duplicateIllustratorLayer)
  const deleteIllustratorLayers = useLogoStore((s) => s.deleteIllustratorLayers)
  const toggleIllustratorLayerVisibility = useLogoStore((s) => s.toggleIllustratorLayerVisibility)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const booleanIllustratorLayers = useLogoStore((s) => s.booleanIllustratorLayers)
  const toggleSelectedPointCurve = useLogoStore((s) => s.toggleSelectedPointCurve)

  const stale = useMemo(
    () => isIllustratorSourceStale(illustrator, params),
    [illustrator, params],
  )
  const selectedLayers = useMemo(() => {
    if (!illustrator) return []
    return illustrator.selectedLayerIds
      .map((id) => illustrator.layers.find((layer) => layer.id === id))
      .filter((layer) => layer != null)
  }, [illustrator])
  const selectedLayer = selectedLayers.length === 1 ? selectedLayers[0] : null
  const hasLayerSelection = selectedLayers.length > 0
  const hasBooleanSelection = selectedLayers.length >= 2

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={convertCurrentMark}
          disabled={!result}
          className={cn(
            'flex-1 h-8 rounded-lg text-xs font-medium transition-all',
            'bg-interactive text-fg hover:bg-interactive-hover',
            'disabled:opacity-40 disabled:cursor-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
          )}
        >
          Convert Current Mark
        </button>
        <button
          type="button"
          onClick={resetIllustrator}
          disabled={!illustrator}
          className={cn(
            'h-8 px-3 rounded-lg text-xs transition-all',
            'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
            'disabled:opacity-40 disabled:cursor-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
          )}
        >
          Reset
        </button>
      </div>

      {!illustrator && (
        <p className="text-xs text-sidebar-muted">
          Convert the generated mark to start editing paths and layers.
        </p>
      )}

      {illustrator && stale && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          This editable copy was made from an older generated mark.
        </div>
      )}

      {illustrator && (
        <>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Mode</div>
            <div className="flex gap-1 p-0.5 bg-interactive-active rounded-lg">
              {(['object', 'points'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setIllustratorMode(mode)}
                  className={cn(
                    'flex-1 h-7 rounded-md px-1 text-xs capitalize transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                    illustrator.mode === mode
                      ? 'bg-interactive text-fg font-medium shadow-sm'
                      : 'text-sidebar-muted hover:text-fg',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Tool</div>
            <div className="flex gap-1">
              {TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    setIllustratorMode('object')
                    setActiveTool(activeTool === tool.id ? null : tool.id)
                  }}
                  title={tool.label}
                  className={cn(
                    'flex-1 h-9 flex items-center justify-center rounded-lg transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                    activeTool === tool.id
                      ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                      : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                  )}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill={tool.fill ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  >
                    <path d={tool.icon} />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Layers</div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-interactive-active/40">
              {illustrator.layers.length === 0 ? (
                <div className="px-3 py-2 text-xs text-sidebar-muted">No layers yet.</div>
              ) : (
                illustrator.layers.map((layer) => {
                  const selected = illustrator.selectedLayerIds.includes(layer.id)
                  return (
                    <div
                      key={layer.id}
                      className={cn(
                        'flex items-center gap-1 border-b border-border/60 px-1.5 py-1 last:border-b-0',
                        selected && 'bg-interactive',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleIllustratorLayerVisibility(layer.id)}
                        className={cn(
                          'h-7 w-7 shrink-0 rounded-md text-[10px] transition-colors',
                          layer.visible
                            ? 'text-fg hover:bg-interactive-hover'
                            : 'text-sidebar-muted/60 hover:text-sidebar-muted hover:bg-interactive-hover',
                        )}
                        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      >
                        {layer.visible ? 'On' : 'Off'}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => selectIllustratorLayer(
                          layer.id,
                          event.shiftKey || event.metaKey,
                        )}
                        className="min-w-0 flex-1 h-7 rounded-md px-2 text-left text-xs text-sidebar-text hover:text-fg hover:bg-interactive-hover truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                      >
                        {layer.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIllustratorLayerOperation(
                          layer.id,
                          layer.operation === 'add' ? 'subtract' : 'add',
                        )}
                        className={cn(
                          'h-7 w-7 shrink-0 rounded-md text-[10px] transition-colors',
                          layer.operation === 'add'
                            ? 'text-emerald-300 hover:bg-interactive-hover'
                            : 'text-rose-300 hover:bg-interactive-hover',
                        )}
                        aria-label={`Toggle ${layer.name} operation`}
                      >
                        {layer.operation === 'add' ? '+' : '-'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {hasBooleanSelection && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-sidebar-muted mb-2">Boolean</div>
              <div className="grid grid-cols-3 gap-1">
                {(['unite', 'subtract', 'intersect'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => booleanIllustratorLayers(op)}
                    className="h-8 rounded-lg text-xs capitalize bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  >
                    {op === 'unite' ? 'Union' : op}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedLayer && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[10px] uppercase tracking-widest text-sidebar-muted">Selected</div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setIllustratorLayerOperation(selectedLayer.id, 'add')}
                  className={cn(
                    'flex-1 h-8 rounded-lg text-xs transition-all',
                    selectedLayer.operation === 'add'
                      ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                      : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                  )}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setIllustratorLayerOperation(selectedLayer.id, 'subtract')}
                  className={cn(
                    'flex-1 h-8 rounded-lg text-xs transition-all',
                    selectedLayer.operation === 'subtract'
                      ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
                      : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                  )}
                >
                  Subtract
                </button>
              </div>
              <SliderControl
                label="Move X"
                value={selectedLayer.transform.dx}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { dx: v })}
              />
              <SliderControl
                label="Move Y"
                value={selectedLayer.transform.dy}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { dy: v })}
              />
              <SliderControl
                label="Scale"
                value={selectedLayer.transform.scale}
                min={0.25}
                max={3}
                step={0.01}
                onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { scale: v })}
              />
              <SliderControl
                label="Rotate"
                value={selectedLayer.transform.rotation}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => updateIllustratorLayerTransform(selectedLayer.id, { rotation: v })}
              />
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => updateIllustratorLayer(selectedLayer.id, {
                    transform: { ...DEFAULT_ILLUSTRATOR_TRANSFORM },
                  })}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => duplicateIllustratorLayer(selectedLayer.id)}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => deleteIllustratorLayers([selectedLayer.id])}
                  className="h-8 rounded-lg text-xs bg-interactive-active text-red-400 hover:bg-interactive-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {illustrator.mode === 'points' && (
            <div className="rounded-lg border border-border bg-interactive-active/40 p-2.5">
              <button
                type="button"
                onClick={toggleSelectedPointCurve}
                disabled={!illustrator.pointSelection}
                className={cn(
                  'w-full h-8 rounded-lg text-xs transition-all',
                  'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
                  'disabled:opacity-40 disabled:cursor-default',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                )}
              >
                Corner / Smooth
              </button>
              <p className="mt-2 text-xs text-sidebar-muted">
                Select one layer, then drag anchors or handles on the canvas.
              </p>
            </div>
          )}

          {!hasLayerSelection && (
            <p className="text-xs text-sidebar-muted">
              Select a layer on the canvas or in the list to edit it.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/* ─── Shared Components ─── */

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-3 py-2.5 text-[10px] uppercase tracking-widest text-sidebar-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
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
        'flex-1 min-w-0 h-8 px-2 rounded-lg text-xs transition-all truncate',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
        checked
          ? 'bg-interactive text-fg font-medium ring-1 ring-interactive-ring'
          : 'bg-interactive-active text-sidebar-muted hover:text-fg hover:bg-interactive-hover',
      )}
    >
      {label}
    </button>
  )
}

function SegmentRow({ value, options, onChange }: { value: number; options: Array<{ l: string; v: number }>; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 p-0.5 bg-interactive-active rounded-lg">
      {options.map((opt) => (
        <button
          key={opt.v}
          type="button"
          onClick={() => onChange(opt.v)}
          className={cn(
            'flex-1 min-w-0 h-7 rounded-md px-1 text-xs transition-all truncate',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-selection)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
            value === opt.v
              ? 'bg-interactive text-fg font-medium shadow-sm'
              : 'text-sidebar-muted hover:text-fg',
          )}
        >
          {opt.l}
        </button>
      ))}
    </div>
  )
}
