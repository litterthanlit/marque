import { TOOLBAR_PANEL, ToolbarButton } from '../layout/ToolbarButton.tsx'
import { SavedVariationsRail } from '../controls/SavedVariationsRail.tsx'
import { Popover } from './Popover.tsx'

/** The saved list lives only while the menu is open, so there is never a second copy of it to go stale. */
export function SavedMenu() {
  return (
    <Popover
      label="Saved marks"
      className="sm:relative"
      panelClassName={TOOLBAR_PANEL}
      trigger={(props) => (
        <ToolbarButton {...props} aria-label="Saved" title="Saved marks">
          <BookmarkIcon />
          <span className="max-sm:hidden">Saved</span>
        </ToolbarButton>
      )}
    >
      {(close) => <SavedVariationsRail onOpened={close} />}
    </Popover>
  )
}

function BookmarkIcon() {
  return (
    <svg className="sm:hidden" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2.5h8v11l-4-3-4 3z" />
    </svg>
  )
}
