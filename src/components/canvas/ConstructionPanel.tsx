import { Fragment } from 'react'
import type { ConstructionCommentary } from '../../engine/commentary/constructionCommentary.ts'
import { cn } from '../../lib/utils.ts'

interface ConstructionPanelProps {
  commentary: ConstructionCommentary | null
  className?: string
}

export function ConstructionPanel({ commentary, className }: ConstructionPanelProps) {
  return (
    <section
      role="region"
      aria-label="Construction details"
      aria-live="polite"
      className={cn(
        'rounded-lg border border-paper-line bg-paper p-4',
        'flex flex-col gap-3',
        className,
      )}
    >
      <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
        Construction
      </h2>

      {commentary ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            {commentary.stats.map((stat) => (
              <Fragment key={stat.label}>
                <dt className="text-paper-muted">{stat.label}</dt>
                <dd className="font-mono-tabular text-paper-ink text-right">
                  {stat.value}
                </dd>
              </Fragment>
            ))}
          </dl>

          <div className="h-px bg-paper-line" aria-hidden="true" />

          <p className="text-[12px] leading-[1.55] italic text-paper-muted">
            {commentary.prose}
          </p>
        </>
      ) : (
        <div className="flex-1 min-h-[120px] rounded-md border border-dashed border-paper-line flex items-center justify-center">
          <span className="font-mono-tabular text-[10px] text-paper-muted">pending</span>
        </div>
      )}
    </section>
  )
}
