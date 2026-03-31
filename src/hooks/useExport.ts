import { useLogoStore } from '../store/logoStore.ts'
import { getGenerator } from '../engine/generators/registry.ts'

function generateSVGString(
  compoundPathData: string,
  fillRule: 'nonzero' | 'evenodd',
  viewBox: { x: number; y: number; width: number; height: number },
  fillColor: string,
): string {
  const padding = 20
  const vb = `${viewBox.x - padding} ${viewBox.y - padding} ${viewBox.width + padding * 2} ${viewBox.height + padding * 2}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">`,
    `  <path d="${compoundPathData}" fill="${fillColor}" fill-rule="${fillRule}" />`,
    `</svg>`,
  ].join('\n')
}

function getPngCanvasSize(
  viewBox: { x: number; y: number; width: number; height: number },
  scale: number,
): { width: number; height: number } {
  const padding = 20
  const width = Math.max(1, Math.round((viewBox.width + padding * 2) * scale))
  const height = Math.max(1, Math.round((viewBox.height + padding * 2) * scale))
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

export function useExport() {
  const result = useLogoStore((s) => s.result)
  const params = useLogoStore((s) => s.params)
  const generator = getGenerator(params.generatorId)
  const filenameBase = `logo-${params.seed}-${params.generatorId}-${generator?.version ?? 'v0'}`

  function exportSVG() {
    if (!result || !result.mark.compoundPathData) return
    const svg = generateSVGString(
      result.mark.compoundPathData,
      result.mark.fillRule,
      result.mark.viewBox,
      params.fillColor,
    )
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    downloadBlob(blob, `${filenameBase}.svg`)
  }

  function exportPNG(scale = 2) {
    if (!result || !result.mark.compoundPathData) return
    const svg = generateSVGString(
      result.mark.compoundPathData,
      result.mark.fillRule,
      result.mark.viewBox,
      params.fillColor,
    )

    const img = new Image()
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const { width, height } = getPngCanvasSize(result.mark.viewBox, scale)
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

  return { exportSVG, exportPNG, canExport: !!result?.mark.compoundPathData }
}
