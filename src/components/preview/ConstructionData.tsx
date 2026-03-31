import { useLogoStore } from '../../store/logoStore.ts'

export function ConstructionData() {
  const result = useLogoStore((s) => s.result)
  const params = useLogoStore((s) => s.params)

  if (!result) return null

  const { stats } = result.constructionData
  const prototypeCount = result.shapes.filter((shape) => shape.role === 'prototype').length
  const symmetryInstanceCount = result.shapes.filter(
    (shape) => shape.role === 'symmetry-instance',
  ).length
  const layerCount = result.mark.layers.length

  return (
    <div className="rounded-[24px] border border-neutral-200 bg-white/90 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
      <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-neutral-400">
        Construction Data
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
        <span className="text-neutral-500">Seed</span>
        <span className="text-neutral-800">{params.seed}</span>
        <span className="text-neutral-500">Symmetry</span>
        <span className="text-neutral-800">{stats.symmetryFolds}-fold</span>
        <span className="text-neutral-500">Rings</span>
        <span className="text-neutral-800">{params.gridRings}</span>
        <span className="text-neutral-500">Prototypes</span>
        <span className="text-neutral-800">{prototypeCount}</span>
        <span className="text-neutral-500">Instances</span>
        <span className="text-neutral-800">{symmetryInstanceCount}</span>
        <span className="text-neutral-500">Layers</span>
        <span className="text-neutral-800">{layerCount}</span>
        <span className="text-neutral-500">Additive</span>
        <span className="text-neutral-800">{stats.additiveCount}</span>
        <span className="text-neutral-500">Subtractive</span>
        <span className="text-neutral-800">{stats.subtractiveCount}</span>
        <span className="text-neutral-500">Total</span>
        <span className="text-neutral-800">{stats.totalShapes}</span>
      </div>
      {result.warnings.length > 0 && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {result.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </div>
  )
}
