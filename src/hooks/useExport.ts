import { useLogoStore } from '../store/logoStore.ts'
import { getGenerator } from '../engine/generators/registry.ts'
import { DissolutionProcessor } from '../engine/effects/dissolution.ts'
import type { DissolutionResult } from '../engine/effects/types.ts'

export type ArtboardMode = 'tight' | 'square'
export type PaddingMode = 'none' | 'compact' | 'presentation'

interface ExportOptions {
  artboardMode?: ArtboardMode
  paddingMode?: PaddingMode
}

function generateSVGString(
  compoundPathData: string,
  fillRule: 'nonzero' | 'evenodd',
  viewBox: { x: number; y: number; width: number; height: number },
  fillColor: string,
  options: ExportOptions = {},
): string {
  const normalizedViewBox = normalizeViewBox(
    viewBox,
    options.artboardMode ?? 'tight',
    options.paddingMode ?? 'compact',
  )
  const vb = `${normalizedViewBox.x} ${normalizedViewBox.y} ${normalizedViewBox.width} ${normalizedViewBox.height}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">`,
    `  <path d="${compoundPathData}" fill="${fillColor}" fill-rule="${fillRule}" />`,
    `</svg>`,
  ].join('\n')
}

function getPngCanvasSize(
  viewBox: { width: number; height: number },
  scale: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(viewBox.width * scale))
  const height = Math.max(1, Math.round(viewBox.height * scale))
  return { width, height }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function useExport(dissolution?: DissolutionResult | null) {
  const result = useLogoStore((s) => s.result)
  const params = useLogoStore((s) => s.params)
  const effectParams = useLogoStore((s) => s.effectParams)
  const generator = getGenerator(params.generatorId)
  const filenameBase = `logo-${params.seed}-${params.modeId}-${generator?.version ?? 'v0'}`

  // Compute dissolution from the store if not explicitly provided
  const activeDissolution: DissolutionResult | null | undefined =
    dissolution !== undefined
      ? dissolution
      : result && effectParams.dissolution.enabled
        ? DissolutionProcessor.process(result, effectParams.dissolution)
        : null

  function getExportPaths(): { pathData: string; fillRule: 'nonzero' | 'evenodd' } | null {
    if (!result || !result.mark.compoundPathData) return null

    if (activeDissolution) {
      const parts: string[] = []
      if (activeDissolution.solidCorePath) parts.push(activeDissolution.solidCorePath)
      if (activeDissolution.particlePathData) parts.push(activeDissolution.particlePathData)
      if (parts.length === 0) return null
      return { pathData: parts.join(' '), fillRule: 'evenodd' }
    }

    return {
      pathData: result.mark.compoundPathData,
      fillRule: result.mark.fillRule,
    }
  }

  function getExportViewBox() {
    return activeDissolution?.viewBox ?? result!.mark.viewBox
  }

  function exportSVG(options: ExportOptions = {}) {
    const paths = getExportPaths()
    if (!paths) return
    const svg = generateSVGString(
      paths.pathData,
      paths.fillRule,
      getExportViewBox(),
      params.fillColor,
      options,
    )
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    downloadBlob(blob, `${filenameBase}.svg`)
  }

  function exportPNG(scale = 2, options: ExportOptions = {}) {
    const paths = getExportPaths()
    if (!paths) return
    const normalizedViewBox = normalizeViewBox(
      getExportViewBox(),
      options.artboardMode ?? 'tight',
      options.paddingMode ?? 'compact',
    )
    const svg = generateSVGString(
      paths.pathData,
      paths.fillRule,
      getExportViewBox(),
      params.fillColor,
      options,
    )

    const img = new Image()
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const { width, height } = getPngCanvasSize(normalizedViewBox, scale)
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)

      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${filenameBase}.png`)
      }, 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      console.error('PNG export failed: could not render SVG to image')
    }

    img.src = url
  }

  return { exportSVG, exportPNG, canExport: !!getExportPaths(), hasDissolution: !!activeDissolution }
}

function normalizeViewBox(
  viewBox: { x: number; y: number; width: number; height: number },
  artboardMode: ArtboardMode,
  paddingMode: PaddingMode,
) {
  const padding = getPadding(paddingMode)
  let normalized = {
    x: viewBox.x - padding,
    y: viewBox.y - padding,
    width: viewBox.width + padding * 2,
    height: viewBox.height + padding * 2,
  }

  if (artboardMode === 'square') {
    const size = Math.max(normalized.width, normalized.height)
    normalized = {
      x: normalized.x - (size - normalized.width) / 2,
      y: normalized.y - (size - normalized.height) / 2,
      width: size,
      height: size,
    }
  }

  return normalized
}

function getPadding(paddingMode: PaddingMode): number {
  switch (paddingMode) {
    case 'none':
      return 0
    case 'presentation':
      return 56
    case 'compact':
    default:
      return 20
  }
}
