import { useEffect, useId, useRef, useState } from 'react'
import { groupRefusalOf, ungroupRefusalOf, useLogoStore } from '../../store/logoStore.ts'
import { cn } from '../../lib/utils.ts'
import { EditorButton, FOCUS_RING, SwitchButton } from './controls.tsx'
import { GroupButton, UngroupButton } from './SelectionBar.tsx'
import { isBlankDocument } from '../../engine/vector/document.ts'
import { guideRows } from '../../engine/vector/guides.ts'
import { bandEnds, layerNumber, nearNumber } from './layerNumber.ts'
import { offsetName } from '../../engine/vector/offsets.ts'
import type { IllustratorDocument, IllustratorLayer } from '../../engine/illustrator/types.ts'
import type { GroupObject, VectorObject } from '../../engine/vector/types.ts'
import { ancestorsOf, isSparkGroup, parentsOf, SPARK_GROUP_PREFIX } from '../../engine/vector/groups.ts'
import { bandsOf } from '../../engine/vector/bands.ts'

/**
 * How a row names a layer. An offset copy is named for what it follows, by
 * that layer's number, "Inset −55 · 03", and says so when nothing is left of
 * it at its distance; a band by its fit and its circles, "Band · belt · 02,
 * 05", and says so while they allow it no fit; anything else by its own
 * name. A band's row shows its fit alone, "Belt", after the link glyph,
 * and its circles are `ends`, drawn in a column of their own that gives
 * way before the fit, never the other way: inside a group, two circles
 * both in the band's own group are written by their places there alone,
 * ".1, .2", and otherwise both whole. `shown` is the name as the row draws it, the dot
 * between thin spaces so that a long distance and the number it follows
 * fit the desktop drawer whole. `copies` numbers the copies that follow the
 * layer, as the bar's "Copies 03" does, and `bands` the bands; the row
 * draws them short, after a glyph, and they give way to the name. What the
 * row draws writes a layer in the same group by its place there alone,
 * ".1" (see `nearNumber`), so a row inside a group has room for it; the
 * spoken name and title keep every number whole.
 */
function rowName(
  doc: IllustratorDocument,
  layer: IllustratorLayer,
): {
  name: string
  shown: string
  follows: string | null
  ends: string | null
  endsShown: string | null
  empty: boolean
  copies: string[]
  bands: string[]
  copiesShown: string[]
  bandsShown: string[]
} {
  const layers = doc.layers
  const copyIds = layers.flatMap((each) => (each.link?.kind === 'offset' && each.link.of === layer.id ? [each.id] : []))
  const bandIds = bandsOf(layers, layer.id)
  const copies = copyIds.map((id) => layerNumber(doc, id)!)
  const bands = bandIds.map((id) => layerNumber(doc, id)!)
  const near = (id: string) => nearNumber(doc, id, layer.id) ?? '—'
  const lists = { copies, bands, copiesShown: copyIds.map(near), bandsShown: bandIds.map(near) }
  if (layer.link?.kind === 'band' && layer.carve?.kind === 'band') {
    // The circles' numbers take a column of their own, after the fit, which gives way first.
    const ends = bandEnds(doc, layer.link).join(', ')
    const what = `Band · ${layer.carve.fit}`
    // Short on the row, where the link glyph says it follows: "Strip", the circles after it, a guide as "g11".
    const fit = layer.carve.fit
    const placed = bandEnds(doc, layer.link, true, layer.id)
    const endsShown = (placed.every((end) => end.startsWith('.')) ? placed : bandEnds(doc, layer.link, true)).join(', ')
    return { name: `${what} · ${ends}`, shown: fit[0].toUpperCase() + fit.slice(1), follows: ends, ends, endsShown, empty: !layer.pathData, ...lists }
  }
  const link = layer.link?.kind === 'offset' ? layer.link : null
  if (!link) return { name: layer.name, shown: layer.name, follows: null, ends: null, endsShown: null, empty: false, ...lists }
  const number = layerNumber(doc, link.of) ?? '—'
  const what = offsetName(link.distance)
  return { name: `${what} · ${number}`, shown: `${what}\u2009·\u2009${near(link.of)}`, follows: number, ends: null, endsShown: null, empty: !layer.pathData, ...lists }
}

/** A chain link: the row follows another layer. Broken, it follows one but nothing is left of it. */
function LinkGlyph({ broken }: { broken: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" className="mr-0.5 inline-block align-[-1px]">
      {broken ? (
        <>
          <path d="M6.8 2.9l.5-.5a2 2 0 0 1 2.8 2.8l-.5.5" />
          <path d="M5.2 9.1l-.5.5a2 2 0 0 1-2.8-2.8l.5-.5" />
          <path d="M4 1.5v1.3M1.5 4h1.3M8 10.5V9.2M10.5 8H9.2" />
        </>
      ) : (
        <>
          <path d="M5 7l2-2" />
          <path d="M6.3 3.4l1-1a2 2 0 0 1 2.8 2.8l-1 1" />
          <path d="M5.7 8.6l-1 1a2 2 0 0 1-2.8-2.8l1-1" />
        </>
      )}
    </svg>
  )
}

/** A band its circles allow no fit: a circle struck through. */
function NoFitGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" className="inline-block align-[-1px]">
      <circle cx="6" cy="6" r="4.3" />
      <path d="M3 9l6-6" />
    </svg>
  )
}

/** Bands follow the row: two circles joined. */
function BandsGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" className="mr-0.5 inline-block align-[-1px]">
      <circle cx="3" cy="6" r="2.2" />
      <circle cx="9" cy="6" r="2.2" />
      <path d="M3 3.8h6M3 8.2h6" />
    </svg>
  )
}

/** Copies follow the row: an outline within an outline, as an inset lies in its shape. */
function CopiesGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" className="mr-0.5 inline-block align-[-1px]">
      <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
      <rect x="4" y="4" width="4" height="4" rx="0.8" strokeDasharray="1.6 1.2" />
    </svg>
  )
}

const ROW_BUTTON = cn('h-7 shrink-0 rounded-md text-[10px] transition-colors hover:bg-interactive-hover', FOCUS_RING)
/*
 * A row's columns after its name, ↑ and ↓, a lock, Add or Cut: narrower for
 * a mouse, which needs no finger's room, to leave the names theirs.
 */
const MOVE_BUTTON = cn(ROW_BUTTON, 'w-6 text-sidebar-text hover:text-fg disabled:cursor-default disabled:opacity-30 pointer-fine:w-5')
const LOCK_WIDTH = 'w-5 pointer-fine:w-4'
const OPERATION_WIDTH = 'w-8 pointer-fine:w-7'

/** A list gives up its rows to the other only down to three of them, or all it has when fewer. */
function leastRows(count: number): React.CSSProperties {
  return { '--least': `calc(${Math.min(count, 3) * 2.3125}rem + 2px)` } as React.CSSProperties
}

/** Lies over the canvas area and never resizes the canvas: a drawer on the right, or a sheet from the bottom when narrow. */
export function LayersDrawer() {
  const open = useLogoStore((s) => s.ui.layersOpen)
  const setLayersOpen = useLogoStore((s) => s.setLayersOpen)
  const illustrator = useLogoStore((s) => s.illustrator)
  const objects = useLogoStore((s) => s.vectorDocument.objects)
  // Which groups show their members: a spark's start folded, a group of the user's open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const startOver = useLogoStore((s) => s.startOver)
  const blank = useLogoStore((s) => isBlankDocument(s.vectorDocument))
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // A group opens when the selection moves inside it; after that its toggle is the user's, even while it holds the selection.
  const holding = holdingGroups(illustrator, objects)
  useEffect(() => {
    if (!holding) return
    setExpanded((was) => {
      const opening = holding.split(' ').filter((id) => was[id] !== true)
      return opening.length ? { ...was, ...Object.fromEntries(opening.map((id) => [id, true])) } : was
    })
  }, [holding])

  // Focus goes in on opening, so Escape closes the drawer and not the selection, and back out on closing.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    closeRef.current?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || panel?.contains(active)) previous?.focus()
    }
  }, [open])

  if (!open) return null
  const layers = illustrator.layers
  const rows = treeRows(illustrator, objects, expanded)

  return (
    <aside
      ref={panelRef}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        setLayersOpen(false)
      }}
      className={cn(
        'absolute z-30 flex flex-col border-border bg-sidebar shadow-2xl shadow-black/30',
        'max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[55%] max-lg:rounded-t-2xl max-lg:border-t',
        'lg:inset-y-0 lg:right-0 lg:w-80 lg:border-l',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-3">
        <h2 id={titleId} className="text-[10px] uppercase tracking-widest text-sidebar-muted">
          Layers
        </h2>
        <span className="flex-1 text-[10px] text-sidebar-muted">{layers.length} total</span>
        <button
          ref={closeRef}
          type="button"
          onClick={() => setLayersOpen(false)}
          aria-label="Close layers"
          title="Close layers (Esc)"
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-interactive-hover hover:text-fg',
            FOCUS_RING,
          )}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>

      {/* On a phone the sheet is short: its body scrolls as one, rather than each list in a sliver. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 max-lg:overflow-y-auto">
        <p className="text-[11px] leading-snug text-sidebar-muted">
          Applied in order from 01. A cut removes only what is below it, and in a group that keeps its cuts to itself (
          <IsolatedGlyph />) only what is below it in that group. Point at a hole on the canvas to find its cut.
        </p>
        {layers.length === 0 ? (
          <p className="rounded-lg border border-border bg-interactive-active/40 px-3 py-2 text-xs text-sidebar-muted">
            No layers yet.
          </p>
        ) : (
          // Each list takes the space it needs. When the drawer is full the layers give up space first, down to
          // three rows, so the guides keep theirs; only then do the guides give some up too. Both scroll.
          <ul
            className="shrink-0 rounded-lg border border-border bg-interactive-active/40 lg:min-h-(--least) lg:shrink-[1000] lg:overflow-y-auto"
            style={leastRows(rows.length)}
          >
            {rows.map((row) =>
              row.kind === 'group' ? (
                <GroupRow
                  key={row.group.id}
                  group={row.group}
                  pieces={row.pieces}
                  expanded={row.expanded}
                  onToggle={() => setExpanded((was) => ({ ...was, [row.group.id]: !row.expanded }))}
                  place={row.place}
                />
              ) : (
                <LayerRow key={row.layer.id} layer={row.layer} visible={row.visible} place={row.place} />
              ),
            )}
          </ul>
        )}
        <GuidesSection />
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        <SheetGroup />
        <EditorButton
          onClick={startOver}
          disabled={blank}
          title="Clear the mark and its guides. Undo brings them back."
          className="w-full"
        >
          Start over
        </EditorButton>
      </div>
    </aside>
  )
}

/**
 * On the sheet, which covers the selection bar, the rows picked with the
 * squares group where they were picked, in its footer: Group while two or
 * more are, Ungroup while a group is, each as the bar's, dimmed and saying
 * why when it would change the mark. The side drawer leaves the bar in
 * sight, and needs none.
 */
function SheetGroup() {
  const roots = useLogoStore((s) => s.illustrator.selectedRootIds ?? s.illustrator.selectedLayerIds)
  const groupIds = useLogoStore((s) => s.illustrator.groups)
  const groupRefusal = useLogoStore((s) => groupRefusalOf(s)?.words ?? null)
  const ungroupRefusal = useLogoStore((s) => ungroupRefusalOf(s)?.words ?? null)
  const canGroup = roots.length >= 2
  const holdsGroup = roots.some((id) => groupIds?.some((group) => group.id === id))
  if (!canGroup && !holdsGroup) return null
  const refusal = canGroup && groupRefusal ? groupRefusal : holdsGroup ? ungroupRefusal : null
  return (
    <div role="group" aria-label="Picked rows" className="flex items-center gap-2 lg:hidden">
      <span className="shrink-0 text-[11px] text-sidebar-text">{roots.length} selected</span>
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-rose-300">{refusal}</span>
      {canGroup && <GroupButton />}
      {holdsGroup && <UngroupButton />}
    </div>
  )
}

/** Where a row sits in the tree: how deep, what number, and whether ↑ and ↓ have a sibling to pass. */
interface RowPlace {
  level: number
  number: string
  canUp: boolean
  canDown: boolean
  /** Selected as it is: the row itself is in the selection. */
  selected: boolean
  /** Inside a group that is selected. */
  within: boolean
  /** The number of the nearest group around it that is hidden, which hides it too, or null. */
  hiddenWith: string | null
  /** The number of the nearest group around it that is locked, which locks it too, or null. */
  lockedWith: string | null
}

/** How far a group's label sits in from its row's toggle: the toggle and the gap after it. */
const TOGGLE_REM = 1.125
/** How much further in each level's rows start than their group's label. */
const LEVEL_REM = 0.5

/**
 * Where a row's label starts, in from its On / Off: a layer at the root at
 * its name's own padding, a member a step in from its group's label, past
 * that group's toggle, so the tree reads at a glance. A group's lock sits
 * after its name, never before it, so no member's indent pays for it.
 */
function labelInset(level: number): number {
  return level > 1 ? TOGGLE_REM + (level - 1) * LEVEL_REM : 0.375
}

/** A layer row's name, its label where its level puts it. */
function indent(level: number): React.CSSProperties | undefined {
  return level > 1 ? { paddingLeft: `${labelInset(level)}rem` } : undefined
}

/** A group row's toggle, so that its label lines up with the rows beside it at its level. */
function groupIndent(level: number): React.CSSProperties | undefined {
  return level > 1 ? { paddingLeft: `${labelInset(level) - TOGGLE_REM}rem` } : undefined
}

/**
 * On touch, which has no Shift, a square before each row adds it to the
 * selection or takes it out, so two layers can be grouped.
 */
function AddToSelection({ id, name, selected }: { id: string; name: string; selected: boolean }) {
  const selectIllustratorLayer = useLogoStore((s) => s.selectIllustratorLayer)
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={selected ? `Take ${name} out of the selection` : `Add ${name} to the selection`}
      onClick={() => selectIllustratorLayer(id, true)}
      className={cn(ROW_BUTTON, 'hidden w-7 items-center justify-center pointer-coarse:inline-flex')}
    >
      <span
        aria-hidden="true"
        className={cn('inline-flex size-3.5 items-center justify-center rounded-[3px] border', selected ? 'border-fg bg-fg text-sidebar' : 'border-sidebar-muted')}
      >
        {selected && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5.2l2 2 4-4.4" />
          </svg>
        )}
      </span>
    </button>
  )
}

/**
 * A row's own On / Off. In a hidden group it still sets the row's own, but
 * reads as the group's: dimmed, its title naming the group that hides it.
 */
function VisibilityButton({ id, name, visible, hiddenWith }: { id: string; name: string; visible: boolean; hiddenWith: string | null }) {
  const toggleIllustratorLayerVisibility = useLogoStore((s) => s.toggleIllustratorLayerVisibility)
  const inherited = hiddenWith === null ? '' : `Hidden with its group ${hiddenWith}`
  return (
    <button
      type="button"
      onClick={() => toggleIllustratorLayerVisibility(id)}
      className={cn(ROW_BUTTON, 'w-7', visible && !inherited ? 'text-fg' : 'text-sidebar-muted/60 hover:text-sidebar-muted')}
      aria-label={`${visible ? `Hide ${name}` : `Show ${name}`}${inherited ? `, ${inherited.toLowerCase()}` : ''}`}
      title={inherited || undefined}
    >
      {visible ? 'On' : 'Off'}
    </button>
  )
}

/**
 * A layer in a locked group takes no presses on the canvas: a dimmed
 * padlock says so, in the column of a group row's lock, after the name,
 * so locking a group never moves its members' labels.
 */
function LockedWith({ number }: { number: string }) {
  const words = `Locked with its group ${number}`
  return (
    <span role="img" aria-label={words} title={words} className={cn('inline-flex h-7 shrink-0 items-center justify-center text-sidebar-muted/60', LOCK_WIDTH)}>
      <LockGlyph locked />
    </span>
  )
}

/**
 * What follows a layer row's name: it starts with no room and takes what
 * the name leaves, up to its own width, so it gives way whole before the
 * name gives any.
 */
const AFTER_NAME = 'min-w-0 max-w-max shrink-0 grow basis-0 truncate whitespace-nowrap'

/**
 * A layer's row: its own On / Off, its name and links, a dimmed padlock in
 * a locked group, ↑ and ↓ within its group, and Add or Cut.
 */
function LayerRow({ layer, visible, place }: { layer: IllustratorLayer; visible: boolean; place: RowPlace }) {
  const illustrator = useLogoStore((s) => s.illustrator)
  const selectIllustratorLayer = useLogoStore((s) => s.selectIllustratorLayer)
  const moveIllustratorLayer = useLogoStore((s) => s.moveIllustratorLayer)
  const setIllustratorLayerOperation = useLogoStore((s) => s.setIllustratorLayerOperation)
  const { level, number, canUp, canDown, selected, within, hiddenWith, lockedWith } = place
  const row = rowName(illustrator, layer)
  // Slabs share a name: the position tells two rows apart.
  const name = `${number} ${row.name}`
  return (
    <li
      aria-level={level}
      className={cn(
        'flex items-center gap-1 border-b border-border/60 px-1.5 py-1 last:border-b-0',
        selected ? 'bg-interactive' : within && 'bg-interactive/40',
      )}
    >
      <AddToSelection id={layer.id} name={name} selected={selected} />
      <VisibilityButton id={layer.id} name={name} visible={visible} hiddenWith={hiddenWith} />
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${row.empty ? `${name}, ${layer.link?.kind === 'band' ? 'no fit' : 'empty'}` : name}${row.copies.length ? `, copies ${row.copies.join(', ')}` : ''}${row.bands.length ? `, bands ${row.bands.join(', ')}` : ''}`}
        onClick={(event) => selectIllustratorLayer(layer.id, event.shiftKey || event.metaKey)}
        style={indent(level)}
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-md px-1.5 text-left text-xs text-sidebar-text transition-colors hover:bg-interactive-hover hover:text-fg',
          FOCUS_RING,
        )}
        title={
          row.empty
            ? layer.link?.kind === 'band'
              ? `${name}. No fit: its circles allow this band none, or one is not a circle. It comes back when they do`
              : `${name}. Nothing is left of it at this distance: it comes back when its shape grows`
            : name
        }
      >
        {/*
          The name keeps its room; what follows it gives way first, whole in the title and label: the copies and
          bands, and a band's circles' numbers, which take only the room its number, link glyph and fit leave
          them, up to their own width. Only on a row with none left does the fit give way, with an ellipsis, and
          the button clips whatever is left, so nothing paints past it. A guide among a band's circles is written
          short, "g11", and two circles in the band's own group by their places there, ".1, .2", to leave them room.
        */}
        {row.ends !== null && (
          <span className="shrink-0 font-mono-tabular text-sidebar-muted">
            {number}
            {'\u00a0'}
          </span>
        )}
        <span className={cn('min-w-0 max-w-full truncate', row.ends === null ? 'shrink-0' : 'shrink')}>
          {row.ends === null && (
            <>
              <span className="font-mono-tabular text-sidebar-muted">{number}</span>{' '}
            </>
          )}
          {row.follows && (
            <span title={row.empty ? undefined : `Follows ${row.follows}`} className={cn(row.empty && 'text-rose-300')}>
              <LinkGlyph broken={row.empty} />
            </span>
          )}
          {row.shown}
        </span>
        {row.endsShown !== null && (
          <span data-ends className={AFTER_NAME}>
            {'\u2009·\u2009'}
            <span className="font-mono-tabular">{row.endsShown}</span>
          </span>
        )}
        {row.ends !== null && row.empty && (
          <span className="ml-1 shrink-0 text-rose-300" title="No fit">
            <NoFitGlyph />
          </span>
        )}
        {row.copies.length > 0 && (
          <span className={cn(AFTER_NAME, 'ml-1.5 text-sidebar-muted')} title={`Copies ${row.copies.join(', ')} follow this shape`}>
            <CopiesGlyph />
            <span className="font-mono-tabular">{row.copiesShown.join(', ')}</span>
          </span>
        )}
        {row.bands.length > 0 && (
          <span className={cn(AFTER_NAME, 'ml-1.5 text-sidebar-muted')} title={`Bands ${row.bands.join(', ')} follow this circle`}>
            <BandsGlyph />
            <span className="font-mono-tabular">{row.bandsShown.join(', ')}</span>
          </span>
        )}
      </button>
      {lockedWith !== null && <LockedWith number={lockedWith} />}
      <div className="flex shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => moveIllustratorLayer(layer.id, 'up')}
          disabled={!canUp}
          className={MOVE_BUTTON}
          aria-label={`Move ${name} up`}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => moveIllustratorLayer(layer.id, 'down')}
          disabled={!canDown}
          className={MOVE_BUTTON}
          aria-label={`Move ${name} down`}
        >
          ↓
        </button>
      </div>
      <button
        type="button"
        onClick={() => setIllustratorLayerOperation(layer.id, layer.operation === 'add' ? 'subtract' : 'add')}
        className={cn(ROW_BUTTON, OPERATION_WIDTH, layer.operation === 'add' ? 'text-emerald-300' : 'text-rose-300')}
        aria-label={
          layer.operation === 'add'
            ? `${name} adds material. Make it a cut`
            : `${name} cuts material. Make it add`
        }
        title={layer.operation === 'add' ? 'Adds material' : 'Cuts material'}
      >
        {layer.operation === 'add' ? 'Add' : 'Cut'}
      </button>
    </li>
  )
}
type TreeRow =
  | { kind: 'layer'; layer: IllustratorLayer; visible: boolean; place: RowPlace }
  | { kind: 'group'; group: GroupObject; pieces: number; expanded: boolean; place: RowPlace }

/**
 * The groups the selection lies inside, as one key, or '' for none: each
 * opens in the drawer when the selection moves into it.
 */
function holdingGroups(doc: IllustratorDocument, objects: VectorObject[]): string {
  const roots = doc.selectedRootIds ?? doc.selectedLayerIds
  if (!roots.length || !doc.groups?.length) return ''
  const parents = parentsOf(objects)
  return [...new Set(roots.flatMap((id) => ancestorsOf(parents, id)))].sort().join(' ')
}

/**
 * The drawer's rows, top of the stack first: a group's row, then its members
 * indented under it while it is open. A spark starts folded and a group of
 * the user's open; `expanded` holds what the user, or the selection moving
 * inside a group, changed.
 */
function treeRows(doc: IllustratorDocument, objects: VectorObject[], expanded: Record<string, boolean>): TreeRow[] {
  const layerById = new Map(doc.layers.map((layer) => [layer.id, layer]))
  const parents = parentsOf(objects)
  const children = new Map<string | null, VectorObject[]>()
  for (const object of objects) children.set(object.parentId, [...(children.get(object.parentId) ?? []), object])
  const roots = new Set(doc.selectedRootIds ?? doc.selectedLayerIds)
  const pieces = new Map<string, number>()
  for (const layer of doc.layers) for (const group of ancestorsOf(parents, layer.id)) pieces.set(group, (pieces.get(group) ?? 0) + 1)
  const rows: TreeRow[] = []
  // What the groups around a row pass down to it: being selected, hidden or locked.
  type Around = Pick<RowPlace, 'within' | 'hiddenWith' | 'lockedWith'>
  const walk = (parentId: string | null, level: number, around: Around) => {
    const siblings = children.get(parentId) ?? []
    for (let i = siblings.length - 1; i >= 0; i--) {
      const object = siblings[i]
      const place: RowPlace = {
        level,
        number: layerNumber(doc, object.id) ?? '—',
        canUp: i < siblings.length - 1,
        canDown: i > 0,
        selected: roots.has(object.id),
        ...around,
      }
      if (object.type === 'group') {
        const open = expanded[object.id] ?? !isSparkGroup(object)
        rows.push({ kind: 'group', group: object, pieces: pieces.get(object.id) ?? 0, expanded: open, place })
        if (open) {
          walk(object.id, level + 1, {
            within: around.within || place.selected,
            hiddenWith: object.visible ? around.hiddenWith : place.number,
            lockedWith: object.locked ? place.number : around.lockedWith,
          })
        }
        continue
      }
      const layer = layerById.get(object.id)
      if (layer) rows.push({ kind: 'layer', layer, visible: object.visible, place })
    }
  }
  walk(null, 1, { within: false, hiddenWith: null, lockedWith: null })
  return rows
}

/** A spark's kind as its row shows it after the spark glyph: "Radial" for "Spark · radial". */
function sparkKind(name: string): string {
  const kind = name.slice(SPARK_GROUP_PREFIX.length)
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** A dropped spark: a four-pointed star. */
function SparkGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className="shrink-0 text-sidebar-muted">
      <path d="M6 .8l1.3 3.9L11.2 6 7.3 7.3 6 11.2 4.7 7.3.8 6l3.9-1.3z" />
    </svg>
  )
}

/** A group keeps its cuts to itself: a cut inside a boundary. */
function IsolatedGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" className="inline-block shrink-0 align-[-1px]">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" strokeDasharray="2 1.4" />
      <circle cx="6" cy="6" r="2" />
    </svg>
  )
}

/** A padlock, its shackle open while unlocked. */
function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <rect x="1.5" y="5.5" width="8" height="5.5" rx="1" />
      <path d={locked ? 'M3.5 5.5V3.8a2 2 0 0 1 4 0v1.7' : 'M3.5 5.5V3.8a2 2 0 0 1 3.9-.6'} />
    </svg>
  )
}

/** A disclosure triangle: pointing right while folded, down while open. */
function Disclosure({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className={cn('transition-transform', open && 'rotate-90')}>
      <path d="M3 1.5l4 3.5-4 3.5z" />
    </svg>
  )
}

/**
 * A group's row: its On / Off, a toggle that shows or folds its members,
 * its name, then in a column that never gives way how many pieces it
 * holds, every layer inside, as the bar counts them, after a glyph while it
 * keeps its cuts to itself; its lock, after the name so that its members'
 * labels need not clear it; ↑ and ↓ that move its whole run past the next
 * row at its level, and, while it keeps its cuts to itself, whether it adds
 * or cuts as one.
 */
function GroupRow({
  group,
  pieces,
  expanded,
  onToggle,
  place,
}: {
  group: GroupObject
  pieces: number
  expanded: boolean
  onToggle: () => void
  place: RowPlace
}) {
  const selectIllustratorLayer = useLogoStore((s) => s.selectIllustratorLayer)
  const moveIllustratorLayer = useLogoStore((s) => s.moveIllustratorLayer)
  const toggleIllustratorLayerLock = useLogoStore((s) => s.toggleIllustratorLayerLock)
  const setGroupOperation = useLogoStore((s) => s.setGroupOperation)
  const { level, number, canUp, canDown, selected, within, hiddenWith, lockedWith } = place
  const name = `${number} ${group.name}`
  const held = `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`
  // Only a group that isolates its cuts goes into the stack as one, adding or cutting: a shared one's pieces do, each.
  const cuts = group.isolated && group.operation === 'subtract'
  const kept = group.isolated ? (cuts ? ', isolates cuts, cuts as one' : ', isolates cuts') : ''
  const spark = isSparkGroup(group)
  // Unlocked itself, it is locked all the same in a locked group: its padlock shows that, dimmed.
  const lockedAround = !group.locked && lockedWith !== null ? `Locked with its group ${lockedWith}` : ''
  return (
    <li
      aria-level={level}
      className={cn('flex items-center gap-1 border-b border-border/60 px-1.5 py-1 last:border-b-0', selected ? 'bg-interactive' : within && 'bg-interactive/40')}
    >
      <AddToSelection id={group.id} name={name} selected={selected} />
      <VisibilityButton id={group.id} name={name} visible={group.visible} hiddenWith={hiddenWith} />
      <div className="flex min-w-0 flex-1 items-center" style={groupIndent(level)}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Fold ${name}` : `Unfold ${name}`}
          title={expanded ? 'Hide its members' : 'Show its members'}
          onClick={onToggle}
          className={cn(ROW_BUTTON, 'inline-flex w-4 items-center justify-center text-sidebar-muted hover:text-fg')}
        >
          <Disclosure open={expanded} />
        </button>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${name}, ${held}${kept}`}
          title={`${name}, ${held}${group.isolated ? `. Keeps its cuts to itself: they cut only what is in it${cuts ? '. Then it cuts as one' : ''}` : ''}. Double-click a piece on the canvas to work on it alone`}
          onClick={(event) => selectIllustratorLayer(group.id, event.shiftKey || event.metaKey)}
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-md pr-1 pl-0.5 text-left text-xs text-sidebar-text transition-colors hover:bg-interactive-hover hover:text-fg',
            FOCUS_RING,
          )}
        >
          <span className="shrink-0 font-mono-tabular text-sidebar-muted">{number}</span>
          {/* A spark is marked by a glyph, its kind shown alone: "Spark · " on every one would leave the kind no room. */}
          {spark && <SparkGlyph />}
          {/*
            What tells two group rows apart never gives way: the name does, with an ellipsis, whole in the row's
            title, before the column after it, the isolation glyph and how many pieces it holds. Neither has a
            title of its own, which would hide the row's, with its way to a piece.
          */}
          <span className="min-w-0 truncate">
            {spark ? sparkKind(group.name) : group.name}
          </span>
          <span data-count className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono-tabular text-sidebar-muted">
            {group.isolated && <IsolatedGlyph />}
            {pieces}
          </span>
        </button>
      </div>
      <button
        type="button"
        aria-pressed={group.locked}
        onClick={() => toggleIllustratorLayerLock(group.id)}
        className={cn(ROW_BUTTON, 'inline-flex items-center justify-center', LOCK_WIDTH, group.locked ? 'text-fg' : 'text-sidebar-muted/60 hover:text-fg')}
        aria-label={`${group.locked ? `Unlock ${name}` : `Lock ${name}`}${lockedAround ? `, ${lockedAround.toLowerCase()}` : ''}`}
        title={
          lockedAround ||
          (group.locked ? 'Locked: its members take no presses on the canvas' : 'Lock it, so its members take no presses on the canvas')
        }
      >
        <LockGlyph locked={group.locked || Boolean(lockedAround)} />
      </button>
      <div className="flex shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => moveIllustratorLayer(group.id, 'up')}
          disabled={!canUp}
          className={MOVE_BUTTON}
          aria-label={`Move ${name} up`}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => moveIllustratorLayer(group.id, 'down')}
          disabled={!canDown}
          className={MOVE_BUTTON}
          aria-label={`Move ${name} down`}
        >
          ↓
        </button>
      </div>
      {/* Only an isolated group fills this column: it goes into the stack as one, adding or cutting. */}
      {group.isolated ? (
        <button
          type="button"
          onClick={() => setGroupOperation(group.id, cuts ? 'add' : 'subtract')}
          className={cn(ROW_BUTTON, OPERATION_WIDTH, cuts ? 'text-rose-300' : 'text-emerald-300')}
          aria-label={cuts ? `${name} cuts material as one. Make it add` : `${name} adds material as one. Make it a cut`}
          title={
            cuts
              ? 'Keeps its cuts to itself, and cuts as one: its pieces make one shape, which cuts what is below it'
              : 'Keeps its cuts to itself, and adds as one: its pieces make one shape, which adds'
          }
        >
          {cuts ? 'Cut' : 'Add'}
        </button>
      ) : (
        // A shared group neither adds nor cuts: each of its pieces does, in the stack around it.
        <span aria-hidden="true" className={cn('shrink-0', OPERATION_WIDTH)} />
      )}
    </li>
  )
}

/**
 * The guides, under the layers: only when there are any. They are not
 * layers: they never count in the total and never make or print ink. A
 * guide that follows a shape says which, by the shape's number above. The
 * header's switch is the one Cmd+; and the toolbar turn; each row's On / Off
 * is the guide's own. While guides are hidden a row cannot pick its guide.
 */
function GuidesSection() {
  const guides = useLogoStore((s) => s.vectorDocument.guides)
  const illustrator = useLogoStore((s) => s.illustrator)
  const selectGuides = useLogoStore((s) => s.selectGuides)
  const toggleGuideVisibility = useLogoStore((s) => s.toggleGuideVisibility)
  const setGuidesLocked = useLogoStore((s) => s.setGuidesLocked)
  const deleteGuides = useLogoStore((s) => s.deleteGuides)
  const showGuides = useLogoStore((s) => s.ui.showGuides)
  const construction = useLogoStore((s) => s.ui.look === 'construction')
  const toggleShowGuides = useLogoStore((s) => s.toggleShowGuides)
  const titleId = useId()
  if (guides.length === 0) return null
  const onCanvas = construction && showGuides
  const selected = new Set(illustrator.selectedGuideIds ?? [])
  const rows = guideRows(guides, (id) => layerNumber(illustrator, id))
  return (
    <section
      aria-labelledby={titleId}
      className="flex shrink-0 flex-col gap-1.5 lg:min-h-[calc(var(--least)+2.5rem)] lg:shrink"
      style={leastRows(guides.length)}
    >
      <div className="flex items-center gap-1 pt-1">
        <h3 id={titleId} className="flex-1 text-[10px] uppercase tracking-widest text-sidebar-muted">
          Guides <span className="font-mono-tabular">· {guides.length}</span>
        </h3>
        <SwitchButton
          label="Show"
          checked={showGuides}
          onChange={toggleShowGuides}
          title={construction ? 'Show guides (Cmd+;)' : 'Show guides (Cmd+;). Guides show in the construction look (F)'}
          className="h-7"
        />
      </div>
      <ul
        className={cn('rounded-lg border border-border bg-interactive-active/40 lg:min-h-0 lg:overflow-y-auto', !onCanvas && 'opacity-60')}
      >
        {guides.map((guide, index) => {
          const { label, tag, title } = rows[index]
          const name = `Guide ${index + 1} ${title}`
          const pickable = onCanvas && guide.visible
          return (
            <li
              key={guide.id}
              className={cn(
                'flex items-center gap-1 border-b border-border/60 px-1.5 py-1 last:border-b-0',
                selected.has(guide.id) && 'bg-interactive',
              )}
            >
              <button
                type="button"
                onClick={() => toggleGuideVisibility(guide.id)}
                className={cn(ROW_BUTTON, 'w-7', guide.visible ? 'text-fg' : 'text-sidebar-muted/60 hover:text-sidebar-muted')}
                aria-label={guide.visible ? `Hide ${name}` : `Show ${name}`}
              >
                {guide.visible ? 'On' : 'Off'}
              </button>
              {/* What tells two guides apart comes first, and the number never truncates. */}
              <button
                type="button"
                aria-pressed={selected.has(guide.id)}
                disabled={!pickable}
                title={pickable ? title : `${title}. Shown guides can be picked`}
                onClick={(event) => selectGuides([guide.id], event.shiftKey || event.metaKey)}
                className={cn(
                  'flex h-7 min-w-0 flex-1 items-center rounded-md px-2 text-left text-xs text-sidebar-text transition-colors enabled:hover:bg-interactive-hover enabled:hover:text-fg disabled:cursor-default',
                  FOCUS_RING,
                )}
              >
                <span className="min-w-0 truncate">{label}</span>
                {tag && <span className="shrink-0 whitespace-pre font-mono-tabular text-sidebar-muted"> · {tag}</span>}
              </button>
              <button
                type="button"
                aria-pressed={guide.locked}
                onClick={() => setGuidesLocked([guide.id], !guide.locked)}
                className={cn(ROW_BUTTON, 'w-10', guide.locked ? 'text-fg' : 'text-sidebar-muted hover:text-fg')}
                aria-label={guide.locked ? `Unlock ${name}` : `Lock ${name}`}
              >
                {guide.locked ? 'Locked' : 'Lock'}
              </button>
              <button
                type="button"
                onClick={() => deleteGuides([guide.id])}
                className={cn(ROW_BUTTON, 'w-6 text-sidebar-muted hover:text-red-400')}
                aria-label={`Delete ${name}`}
                title="Delete guide"
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
