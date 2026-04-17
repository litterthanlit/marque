import type { GenerationResult, LogoParams } from '../types.ts'

export interface ConstructionCommentary {
  headline: string
  stats: Array<{ label: string; value: string }>
  prose: string
}

type ResultOrNull = GenerationResult | null

type Getter<T> = (params: LogoParams, result: ResultOrNull) => T

interface ModeHandler {
  headline: Getter<string>
  stats: Getter<Array<{ label: string; value: string }>>
  proseTemplates: Array<Getter<string>>
}

const FOLD_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
]

function foldWord(n: number): string {
  const idx = Math.round(n)
  return FOLD_WORDS[idx] ?? String(idx)
}

function fmtInt(n: number): string {
  return String(Math.round(n))
}

function fmtRatio(n: number): string {
  return n.toFixed(2)
}

function modeParamsOf(params: LogoParams, key: string): Record<string, number | string> {
  return params.modeParams[key] ?? {}
}

function pickTemplate<T>(seed: number, templates: T[]): T {
  const len = templates.length
  const idx = ((Math.trunc(seed) % len) + len) % len
  return templates[idx]
}

const geometricRadial: ModeHandler = {
  headline: (p, _r) => `${foldWord(p.symmetryFolds)}-fold radial`,
  stats: (p, r) => [
    { label: 'Seed', value: fmtInt(p.seed) },
    { label: 'Symmetry', value: `${fmtInt(p.symmetryFolds)} folds` },
    { label: 'Rings', value: fmtInt(p.gridRings) },
    { label: 'Shapes', value: fmtInt(r?.constructionData.stats.totalShapes ?? 0) },
    { label: 'Variation', value: fmtRatio(p.radiusVariation) },
  ],
  proseTemplates: [
    (p, _r) => `${fmtInt(p.symmetryFolds)} shapes orbit a central anchor, overlapping to produce crescents.`,
    (p, _r) => `A ${fmtInt(p.symmetryFolds)}-fold rotation stamps the base mark around its center.`,
    (p, _r) => `Concentric rings seed the composition; ${fmtInt(p.symmetryFolds)} copies fan outward.`,
  ],
}

function gridDims(p: LogoParams): { cols: number; rows: number } {
  const mp = modeParamsOf(p, 'grid-system')
  return { cols: Math.round(Number(mp.columns ?? 6)), rows: Math.round(Number(mp.rows ?? 6)) }
}

const gridSystem: ModeHandler = {
  headline: (p, _r) => {
    const { cols, rows } = gridDims(p)
    return `Grid system · ${cols}×${rows}`
  },
  stats: (p, r) => {
    const { cols, rows } = gridDims(p)
    const mp = modeParamsOf(p, 'grid-system')
    const density = Number(mp.density ?? 0.55)
    const mirrorX = Number(mp.mirrorX ?? 1) > 0.5
    const mirrorY = Number(mp.mirrorY ?? 0) > 0.5
    const mirror = mirrorX && mirrorY ? 'X · Y' : mirrorX ? 'X' : mirrorY ? 'Y' : 'none'
    return [
      { label: 'Seed', value: fmtInt(p.seed) },
      { label: 'Grid', value: `${cols}×${rows}` },
      { label: 'Density', value: fmtRatio(density) },
      { label: 'Shapes', value: fmtInt(r?.constructionData.stats.totalShapes ?? 0) },
      { label: 'Mirror', value: mirror },
    ]
  },
  proseTemplates: [
    (p, _r) => {
      const { cols, rows } = gridDims(p)
      return `A ${cols}×${rows} lattice of stroked modules, mirrored to balance the mark.`
    },
    (p, _r) => {
      const { cols, rows } = gridDims(p)
      return `Cells populate a ${cols}×${rows} grid; denser passes produce weighted forms.`
    },
    (p, _r) => {
      const { cols, rows } = gridDims(p)
      return `Subtractive cuts carve a ${cols}×${rows} modular mark from a solid field.`
    },
  ],
}

function modularDims(p: LogoParams): { cols: number; rows: number; clip: boolean } {
  const mp = modeParamsOf(p, 'modular')
  return {
    cols: Math.round(Number(mp.columns ?? 4)),
    rows: Math.round(Number(mp.rows ?? 4)),
    clip: Number(mp.circleClip ?? 1) > 0.5,
  }
}

const modular: ModeHandler = {
  headline: (p, _r) => {
    const { cols, rows } = modularDims(p)
    return `Modular · ${cols}×${rows}`
  },
  stats: (p, r) => {
    const { cols, rows, clip } = modularDims(p)
    return [
      { label: 'Seed', value: fmtInt(p.seed) },
      { label: 'Grid', value: `${cols}×${rows}` },
      { label: 'Shapes', value: fmtInt(r?.constructionData.stats.totalShapes ?? 0) },
      { label: 'Variation', value: fmtRatio(p.radiusVariation) },
      { label: 'Clip', value: clip ? 'circle' : 'none' },
    ]
  },
  proseTemplates: [
    (p, _r) => {
      const { cols, rows } = modularDims(p)
      return `${cols * rows} cells break across a modular grid, each with add or subtract intent.`
    },
    (p, _r) => {
      const { cols, rows } = modularDims(p)
      return `Primitives snap to a ${cols}×${rows} field; variation modulates their sizes.`
    },
    (p, _r) => {
      const { cols, rows } = modularDims(p)
      return `A ${cols}×${rows} modular grid distributes shapes evenly across the frame.`
    },
  ],
}

function monogramInitials(p: LogoParams): string {
  const raw = (p.brandInput.initials ?? 'MM').slice(0, 3)
  return raw.length > 0 ? raw : 'MM'
}

const monogram: ModeHandler = {
  headline: (p, _r) => `Monogram · ${monogramInitials(p)}`,
  stats: (p, _r) => {
    const mp = modeParamsOf(p, 'monogram')
    const stroke = Number(mp.strokeWeight ?? 1.15)
    const contrast = Number(mp.contrast ?? 0.45)
    const interlock = Number(mp.interlockStrength ?? 0.45)
    return [
      { label: 'Seed', value: fmtInt(p.seed) },
      { label: 'Initials', value: monogramInitials(p) },
      { label: 'Stroke', value: fmtRatio(stroke) },
      { label: 'Contrast', value: fmtRatio(contrast) },
      { label: 'Interlock', value: fmtRatio(interlock) },
    ]
  },
  proseTemplates: [
    (p, _r) => `Letterforms interlock across a shared grid, weaving ${monogramInitials(p)} into one mark.`,
    (p, _r) => `The ${monogramInitials(p)} monogram resolves on a uniform module, tuned by stroke weight.`,
    (_p, _r) => `Letters share columns to build a compact, interlocking signature.`,
  ],
}

interface WaveArcDims {
  arcs: number
  spread: number
  gap: number
  sym: 'bilateral' | 'radial'
}

function waveArcDims(p: LogoParams): WaveArcDims {
  const mp = modeParamsOf(p, 'wave-arc')
  const arcs = Math.max(1, Math.min(Number(mp.arcCount) || 3, 20))
  const spread = Number(mp.spreadAngle) || 120
  const gap = Number(mp.gapRatio) || 0.5
  const sym: 'bilateral' | 'radial' = mp.arcSymmetry === 'radial' ? 'radial' : 'bilateral'
  return { arcs, spread, gap, sym }
}

const waveArc: ModeHandler = {
  headline: (p, _r) => {
    const { arcs } = waveArcDims(p)
    return `Wave arc · ${fmtInt(arcs)}`
  },
  stats: (p, _r) => {
    const { arcs, spread, gap, sym } = waveArcDims(p)
    return [
      { label: 'Seed', value: fmtInt(p.seed) },
      { label: 'Arcs', value: fmtInt(arcs) },
      { label: 'Spread', value: `${fmtInt(spread)}°` },
      { label: 'Gap', value: fmtRatio(gap) },
      { label: 'Symmetry', value: sym },
    ]
  },
  proseTemplates: [
    (p, _r) => {
      const { arcs, spread } = waveArcDims(p)
      return `${fmtInt(arcs)} concentric crescents fan across a ${fmtInt(spread)}° spread.`
    },
    (_p, _r) => `Nested arcs describe a rising wave; gap ratio controls their separation.`,
    (p, _r) => {
      const { arcs } = waveArcDims(p)
      return `${fmtInt(arcs)} arcs stack outward from a shared anchor, tapering toward their tips.`
    },
  ],
}

const HANDLERS: Record<string, ModeHandler> = {
  'geometric-radial': geometricRadial,
  'grid-system': gridSystem,
  'modular': modular,
  'monogram': monogram,
  'wave-arc': waveArc,
}

const FALLBACK: ModeHandler = {
  headline: (p, _r) => p.modeId || 'Generative mark',
  stats: (p, r) => [
    { label: 'Seed', value: fmtInt(p.seed) },
    { label: 'Mode', value: p.modeId || 'unknown' },
    { label: 'Add / Sub', value: fmtRatio(p.additiveRatio) },
    { label: 'Radius', value: fmtRatio(p.baseRadius) },
    { label: 'Shapes', value: fmtInt(r?.constructionData.stats.totalShapes ?? 0) },
  ],
  proseTemplates: [
    (_p, _r) => 'A generative mark tuned by the active parameters.',
  ],
}

export function generateConstructionCommentary(
  params: LogoParams,
  result: GenerationResult | null,
): ConstructionCommentary {
  const handler = HANDLERS[params.modeId] ?? FALLBACK
  const template = pickTemplate(params.seed, handler.proseTemplates)
  return {
    headline: handler.headline(params, result),
    stats: handler.stats(params, result).slice(0, 5),
    prose: template(params, result),
  }
}
