import type { BrandInput, LogoParams, ModeParamMap, StyleFamily } from '../engine/types.ts'
import { DEFAULT_PARAMS } from '../engine/types.ts'

export interface LogoModeDefinition {
  id: string
  name: string
  generatorId: string
  description: string
  sharedControls: Array<
    | 'seed'
    | 'fillColor'
    | 'additiveRatio'
    | 'gridRings'
    | 'symmetryFolds'
    | 'baseRadius'
    | 'radiusVariation'
    | 'rotation'
    | 'animationSpeed'
    | 'styleFamily'
    | 'brandInput'
  >
}

export const STYLE_FAMILIES: Array<{
  id: StyleFamily
  label: string
  accent: string
  blurb: string
}> = [
  {
    id: 'minimal',
    label: 'Minimal',
    accent: 'from-stone-900 via-stone-700 to-stone-500',
    blurb: 'Quiet geometry and disciplined negative space.',
  },
  {
    id: 'heritage',
    label: 'Heritage',
    accent: 'from-amber-900 via-amber-700 to-orange-500',
    blurb: 'Badge-minded structure with engraved weight.',
  },
  {
    id: 'luxe',
    label: 'Luxe',
    accent: 'from-zinc-950 via-neutral-700 to-amber-200',
    blurb: 'High-contrast elegance with polished restraint.',
  },
  {
    id: 'playful',
    label: 'Playful',
    accent: 'from-cyan-500 via-fuchsia-500 to-amber-400',
    blurb: 'Elastic rhythm, buoyant forms, and bright confidence.',
  },
  {
    id: 'tech',
    label: 'Tech',
    accent: 'from-sky-900 via-blue-500 to-cyan-300',
    blurb: 'Sharper systems, modular spacing, and engineered motion.',
  },
]

export const LOGO_MODES: LogoModeDefinition[] = [
  {
    id: 'geometric-radial',
    name: 'Geometric Radial',
    generatorId: 'geometric-radial',
    description: 'Abstract symbol marks built from orbital symmetry and cuts.',
    sharedControls: [
      'seed',
      'styleFamily',
      'fillColor',
      'gridRings',
      'symmetryFolds',
      'additiveRatio',
      'baseRadius',
      'radiusVariation',
      'rotation',
      'animationSpeed',
    ],
  },
  {
    id: 'modular',
    name: 'Modular',
    generatorId: 'modular',
    description: 'Pattern-first logo concepts assembled from repeated modules.',
    sharedControls: [
      'seed',
      'styleFamily',
      'fillColor',
      'additiveRatio',
      'baseRadius',
      'radiusVariation',
      'rotation',
      'animationSpeed',
    ],
  },
  {
    id: 'grid-system',
    name: 'Grid System',
    generatorId: 'grid-system',
    description: 'Structured badges and icons built from cell grids and corridors.',
    sharedControls: ['seed', 'styleFamily', 'fillColor', 'additiveRatio', 'rotation'],
  },
  {
    id: 'monogram',
    name: 'Monogram',
    generatorId: 'monogram',
    description: 'Initials-based marks that interlock into one solid symbol.',
    sharedControls: ['styleFamily', 'fillColor', 'rotation', 'brandInput'],
  },
  {
    id: 'wave-arc',
    name: 'Wave Arc',
    generatorId: 'wave-arc',
    description: 'Concentric crescent marks with bilateral or radial symmetry.',
    sharedControls: ['seed', 'styleFamily', 'fillColor', 'rotation', 'animationSpeed'],
  },
]

const DEFAULT_MODE_PARAMS: ModeParamMap = {
  'geometric-radial': {},
  modular: {
    columns: 4,
    rows: 4,
    circleClip: 1,
  },
  'grid-system': {
    columns: 6,
    rows: 6,
    density: 0.55,
    cellInset: 0.12,
    strokeBias: 0.5,
    mirrorX: 1,
    mirrorY: 0,
    frameMode: 1,
  },
  monogram: {
    strokeWeight: 1.15,
    contrast: 0.45,
    cornerStyle: 0,
    interlockStrength: 0.45,
    symmetryBias: 0.4,
    frameMode: 0,
  },
  'wave-arc': {
    arcCount: 4,
    spreadAngle: 120,
    gapRatio: 0.3,
    taperAmount: 0.7,
    arcSymmetry: 'bilateral',
    symmetryFolds: 4,
  },
}

const MODE_PARAM_LIMITS: Record<string, Record<string, { min: number; max: number }>> = {
  modular: {
    columns: { min: 2, max: 8 },
    rows: { min: 2, max: 8 },
    circleClip: { min: 0, max: 1 },
  },
  'grid-system': {
    columns: { min: 3, max: 10 },
    rows: { min: 3, max: 10 },
    density: { min: 0.2, max: 0.9 },
    cellInset: { min: 0, max: 0.32 },
    strokeBias: { min: 0, max: 1 },
    mirrorX: { min: 0, max: 1 },
    mirrorY: { min: 0, max: 1 },
    frameMode: { min: 0, max: 2 },
  },
  monogram: {
    strokeWeight: { min: 0.8, max: 1.8 },
    contrast: { min: 0, max: 1 },
    cornerStyle: { min: 0, max: 2 },
    interlockStrength: { min: 0, max: 1 },
    symmetryBias: { min: 0, max: 1 },
    frameMode: { min: 0, max: 2 },
  },
  'wave-arc': {
    arcCount: { min: 2, max: 8 },
    spreadAngle: { min: 30, max: 180 },
    gapRatio: { min: 0.1, max: 0.8 },
    taperAmount: { min: 0.2, max: 1 },
    // arcSymmetry is an enum ('bilateral' | 'radial'), not clamped numerically
    symmetryFolds: { min: 2, max: 12 },
  },
}

const MODE_STYLE_OVERRIDES: Record<
  StyleFamily,
  Record<string, Partial<LogoParams> & { mode: Record<string, number | string> }>
> = {
  minimal: {
    'geometric-radial': {
      gridRings: 3,
      symmetryFolds: 6,
      additiveRatio: 0.72,
      baseRadius: 0.42,
      radiusVariation: 0.3,
      rotation: 0,
      fillColor: '#161616',
      animationSpeed: 0.8,
      mode: {},
    },
    modular: {
      additiveRatio: 0.76,
      baseRadius: 0.38,
      radiusVariation: 0.2,
      rotation: 0,
      fillColor: '#171717',
      animationSpeed: 0.6,
      mode: { columns: 5, rows: 4, circleClip: 1 },
    },
    'grid-system': {
      additiveRatio: 0.78,
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#161616',
      mode: {
        columns: 6,
        rows: 6,
        density: 0.46,
        cellInset: 0.18,
        strokeBias: 0.35,
        mirrorX: 1,
        mirrorY: 0,
        frameMode: 0,
      },
    },
    monogram: {
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#181818',
      mode: {
        strokeWeight: 1,
        contrast: 0.25,
        cornerStyle: 0,
        interlockStrength: 0.35,
        symmetryBias: 0.25,
        frameMode: 0,
      },
    },
    'wave-arc': {
      fillColor: '#161616',
      rotation: 0,
      animationSpeed: 0.6,
      mode: { arcCount: 4, spreadAngle: 120, gapRatio: 0.3, taperAmount: 0.7, arcSymmetry: 'bilateral', symmetryFolds: 4 },
    },
  },
  heritage: {
    'geometric-radial': {
      gridRings: 4,
      symmetryFolds: 8,
      additiveRatio: 0.6,
      baseRadius: 0.5,
      radiusVariation: 0.45,
      rotation: 8,
      fillColor: '#6d4323',
      animationSpeed: 0.6,
      mode: {},
    },
    modular: {
      additiveRatio: 0.58,
      baseRadius: 0.5,
      radiusVariation: 0.16,
      rotation: 0,
      fillColor: '#74472c',
      animationSpeed: 0.4,
      mode: { columns: 4, rows: 4, circleClip: 1 },
    },
    'grid-system': {
      additiveRatio: 0.64,
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#6f4627',
      mode: {
        columns: 7,
        rows: 7,
        density: 0.58,
        cellInset: 0.08,
        strokeBias: 0.72,
        mirrorX: 1,
        mirrorY: 1,
        frameMode: 1,
      },
    },
    monogram: {
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#623a22',
      mode: {
        strokeWeight: 1.35,
        contrast: 0.58,
        cornerStyle: 1,
        interlockStrength: 0.42,
        symmetryBias: 0.4,
        frameMode: 1,
      },
    },
    'wave-arc': {
      fillColor: '#6f4627',
      rotation: 0,
      animationSpeed: 0.4,
      mode: { arcCount: 5, spreadAngle: 140, gapRatio: 0.22, taperAmount: 0.85, arcSymmetry: 'bilateral', symmetryFolds: 4 },
    },
  },
  luxe: {
    'geometric-radial': {
      gridRings: 3,
      symmetryFolds: 5,
      additiveRatio: 0.82,
      baseRadius: 0.34,
      radiusVariation: 0.2,
      rotation: 18,
      fillColor: '#14110f',
      animationSpeed: 0.4,
      mode: {},
    },
    modular: {
      additiveRatio: 0.74,
      baseRadius: 0.3,
      radiusVariation: 0.14,
      rotation: 0,
      fillColor: '#17110f',
      animationSpeed: 0.3,
      mode: { columns: 6, rows: 4, circleClip: 0 },
    },
    'grid-system': {
      additiveRatio: 0.72,
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#171311',
      mode: {
        columns: 6,
        rows: 8,
        density: 0.5,
        cellInset: 0.16,
        strokeBias: 0.6,
        mirrorX: 1,
        mirrorY: 0,
        frameMode: 1,
      },
    },
    monogram: {
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#171311',
      mode: {
        strokeWeight: 1.12,
        contrast: 0.7,
        cornerStyle: 0,
        interlockStrength: 0.5,
        symmetryBias: 0.62,
        frameMode: 1,
      },
    },
    'wave-arc': {
      fillColor: '#171311',
      rotation: 15,
      animationSpeed: 0.3,
      mode: { arcCount: 3, spreadAngle: 100, gapRatio: 0.35, taperAmount: 0.6, arcSymmetry: 'bilateral', symmetryFolds: 5 },
    },
  },
  playful: {
    'geometric-radial': {
      gridRings: 4,
      symmetryFolds: 7,
      additiveRatio: 0.7,
      baseRadius: 0.58,
      radiusVariation: 0.9,
      rotation: 0,
      fillColor: '#0f4cc9',
      animationSpeed: 1.4,
      mode: {},
    },
    modular: {
      additiveRatio: 0.72,
      baseRadius: 0.46,
      radiusVariation: 0.44,
      rotation: 15,
      fillColor: '#0d87b8',
      animationSpeed: 1.1,
      mode: { columns: 5, rows: 5, circleClip: 0 },
    },
    'grid-system': {
      additiveRatio: 0.68,
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#0d8e8f',
      mode: {
        columns: 5,
        rows: 5,
        density: 0.65,
        cellInset: 0.09,
        strokeBias: 0.5,
        mirrorX: 0,
        mirrorY: 0,
        frameMode: 2,
      },
    },
    monogram: {
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#0f5cc5',
      mode: {
        strokeWeight: 1.45,
        contrast: 0.35,
        cornerStyle: 2,
        interlockStrength: 0.62,
        symmetryBias: 0.28,
        frameMode: 2,
      },
    },
    'wave-arc': {
      fillColor: '#0d87b8',
      rotation: 0,
      animationSpeed: 1.2,
      mode: { arcCount: 5, spreadAngle: 150, gapRatio: 0.2, taperAmount: 0.9, arcSymmetry: 'radial', symmetryFolds: 6 },
    },
  },
  tech: {
    'geometric-radial': {
      gridRings: 5,
      symmetryFolds: 8,
      additiveRatio: 0.66,
      baseRadius: 0.32,
      radiusVariation: 0.38,
      rotation: 0,
      fillColor: '#0f172a',
      animationSpeed: 1.1,
      mode: {},
    },
    modular: {
      additiveRatio: 0.82,
      baseRadius: 0.34,
      radiusVariation: 0.08,
      rotation: 0,
      fillColor: '#0f172a',
      animationSpeed: 0.9,
      mode: { columns: 6, rows: 6, circleClip: 1 },
    },
    'grid-system': {
      additiveRatio: 0.82,
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#111827',
      mode: {
        columns: 8,
        rows: 8,
        density: 0.52,
        cellInset: 0.11,
        strokeBias: 0.78,
        mirrorX: 1,
        mirrorY: 1,
        frameMode: 0,
      },
    },
    monogram: {
      animationSpeed: 0,
      rotation: 0,
      fillColor: '#0f172a',
      mode: {
        strokeWeight: 1.08,
        contrast: 0.62,
        cornerStyle: 1,
        interlockStrength: 0.56,
        symmetryBias: 0.74,
        frameMode: 0,
      },
    },
    'wave-arc': {
      fillColor: '#0f172a',
      rotation: 0,
      animationSpeed: 0.8,
      mode: { arcCount: 6, spreadAngle: 90, gapRatio: 0.15, taperAmount: 0.5, arcSymmetry: 'radial', symmetryFolds: 8 },
    },
  },
}

export function listModes(): LogoModeDefinition[] {
  return LOGO_MODES
}

export function getModeDefinition(modeId: string): LogoModeDefinition | undefined {
  return LOGO_MODES.find((mode) => mode.id === modeId)
}

export function getModeGeneratorId(modeId: string): string {
  return getModeDefinition(modeId)?.generatorId ?? DEFAULT_PARAMS.generatorId
}

export function getModeParamDefaults(modeId: string): Record<string, number | string> {
  return { ...(DEFAULT_MODE_PARAMS[modeId] ?? {}) }
}

export function getModeParamLimits(
  modeId: string,
): Record<string, { min: number; max: number }> {
  return { ...(MODE_PARAM_LIMITS[modeId] ?? {}) }
}

export function getAllModeParamDefaults(): ModeParamMap {
  return Object.fromEntries(
    Object.entries(DEFAULT_MODE_PARAMS).map(([modeId, params]) => [
      modeId,
      { ...params },
    ]),
  )
}

export function getStyleFamilyDefaults(
  modeId: string,
  styleFamily: StyleFamily,
): { shared: Partial<LogoParams>; modeParams: Record<string, number | string> } {
  const styleEntry = MODE_STYLE_OVERRIDES[styleFamily]?.[modeId]
  if (!styleEntry) {
    return { shared: {}, modeParams: getModeParamDefaults(modeId) }
  }

  const { mode, ...shared } = styleEntry
  return {
    shared,
    modeParams: { ...getModeParamDefaults(modeId), ...mode },
  }
}

export function normalizeInitials(value: string | undefined): string | undefined {
  if (!value) return undefined

  const normalized = value
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3)

  return normalized || undefined
}

export function sanitizeBrandInput(
  brandInput: BrandInput | undefined,
  modeId: string,
): BrandInput {
  if (modeId !== 'monogram') return {}
  return { initials: normalizeInitials(brandInput?.initials) }
}

export function buildModeParamsForPersistence(
  modeId: string,
  modeParams: ModeParamMap,
): ModeParamMap {
  return {
    [modeId]: {
      ...getModeParamDefaults(modeId),
      ...(modeParams[modeId] ?? {}),
    },
  }
}
