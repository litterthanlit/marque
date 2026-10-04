// TODO(phase-c): extract to src/renderer/ once a shared SVG serializer
// lives there. Phase B is forbidden from touching src/renderer/**, so we
// inline a minimal serializer here. Mirrors useExport.ts's generateSVGString
// at tight/no-padding defaults.
export function serializeMarkToSVG(
  compoundPathData: string,
  fillRule: 'nonzero' | 'evenodd',
  viewBox: { x: number; y: number; width: number; height: number },
  fillColor: string,
): string {
  const vb = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">`,
    `  <path d="${compoundPathData}" fill="${fillColor}" fill-rule="${fillRule}" />`,
    `</svg>`,
  ].join('\n')
}
