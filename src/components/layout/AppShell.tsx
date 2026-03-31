import { Toolbar } from './Toolbar.tsx'
import { LogoCanvas } from '../canvas/LogoCanvas.tsx'
import { ParameterPanel } from '../controls/ParameterPanel.tsx'
import { FinalPreview } from '../preview/FinalPreview.tsx'
import { ConstructionData } from '../preview/ConstructionData.tsx'

export function AppShell() {
  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <Toolbar />
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Main canvas area */}
        <div className="flex-1 flex flex-col p-4 gap-4 min-h-0">
          <LogoCanvas />
          <div className="flex gap-4 flex-shrink-0">
            <ConstructionData />
            <FinalPreview />
          </div>
        </div>

        {/* Parameter panel — collapsible on mobile */}
        <aside className="w-full md:w-64 border-t md:border-t-0 md:border-l border-neutral-200 bg-neutral-50 overflow-y-auto max-h-[40vh] md:max-h-none">
          <ParameterPanel />
        </aside>
      </div>
    </div>
  )
}
