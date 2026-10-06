import { isObjectCarveValid } from '../carve/sync.ts'
import type {
  ConstructionRole,
  Contour,
  Fillet,
  GroupObject,
  Guide,
  ObjectLink,
  PathObject,
  Rect,
  Segment,
  VectorArtboard,
  VectorDocument,
  VectorDocumentSource,
  VectorObject,
} from './types.ts'

export const VECTOR_SCHEMA_VERSION = 2

export const DEFAULT_ARTBOARD_RECT: Rect = {
  x: -512,
  y: -512,
  width: 1024,
  height: 1024,
}

export function createDefaultArtboard(): VectorArtboard {
  return {
    id: crypto.randomUUID(),
    name: 'Artboard 1',
    rect: { ...DEFAULT_ARTBOARD_RECT },
    background: null,
  }
}

export function createEmptyVectorDocument(name = 'Untitled Vector Maker document'): VectorDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: VECTOR_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    kind: 'brand-vector',
    activeMode: 'logo',
    name,
    artboards: [createDefaultArtboard()],
    objects: [],
    guides: [],
    fillets: [],
    source: null,
    createdAt: now,
    updatedAt: now,
  }
}

/* ─── Reading version 2 ─── */

/**
 * A version 2 document from outside the editor (a link, a saved mark), or
 * null when a field every document needs is missing or malformed. What is
 * readable but does not fit is repaired rather than refused, so builds
 * shipped at different times can open each other's data. The geometry is
 * always kept:
 *
 * - a recipe of a kind this build does not know, or one that no longer
 *   describes its contours, is dropped, and so is a frame that is not a
 *   finite turn or sits on a recipe;
 * - a link or guide link of a kind it does not know, or to an object that
 *   is not there, is detached, and so is a pin;
 * - a guide of a shape it does not know is dropped, and so is a fillet
 *   between objects that are not there;
 * - an object whose group is missing moves to the root, a group's members
 *   are gathered right after its header, and an empty group goes;
 * - an object of a type it does not know is dropped; a name, flag, parent,
 *   operation or fill rule that is missing or of the wrong type takes the
 *   value a new object has; a contour with no points is dropped;
 * - fields it does not know are dropped.
 *
 * Only an object whose own geometry cannot be read refuses the document.
 *
 * When nothing needs repair, the very same document comes back.
 */
export function repairVectorDocument(value: unknown): VectorDocument | null {
  if (!isRecord(value)) return null
  if (
    value.schemaVersion !== VECTOR_SCHEMA_VERSION ||
    value.kind !== 'brand-vector' ||
    (value.activeMode !== 'logo' && value.activeMode !== 'wordmark') ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.artboards) ||
    value.artboards.length === 0 ||
    !value.artboards.every(isVectorArtboard) ||
    !Array.isArray(value.objects)
  ) {
    return null
  }

  const read: VectorObject[] = []
  let changed = !onlyKeys(value, DOCUMENT_KEYS)
  for (const raw of value.objects) {
    const object = readObject(raw)
    if (object === null) return null
    if (object !== raw) changed = true
    if (object) read.push(object)
  }
  const structured = repairStructure(uniqueIds(read))
  const objects = repairReferences(structured)
  if (objects !== read) changed = true

  const ids = new Set(objects.map((object) => object.id))
  const guides = readList(value.guides, (raw) => readGuide(raw, ids))
  const fillets = readList(value.fillets, (raw) => readFillet(raw, ids))
  const artboards = value.artboards.map((artboard) =>
    onlyKeys(artboard, ARTBOARD_KEYS) && onlyKeys(artboard.rect, RECT_KEYS) ? artboard : cleanArtboard(artboard),
  )
  const source = readSource(value.source)
  if (
    guides !== value.guides ||
    fillets !== value.fillets ||
    artboards.some((artboard, index) => artboard !== (value.artboards as unknown[])[index]) ||
    source !== value.source
  ) {
    changed = true
  }
  if (!changed) return value as unknown as VectorDocument
  return {
    schemaVersion: VECTOR_SCHEMA_VERSION,
    id: value.id,
    kind: 'brand-vector',
    activeMode: value.activeMode,
    name: value.name,
    artboards,
    objects,
    guides,
    fillets,
    source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

/**
 * The repairs a document from outside the editor gets, for one that is
 * already typed: the very same document when it needs none.
 */
export function sanitizeVectorDocument(document: VectorDocument): VectorDocument | null {
  return repairVectorDocument(document)
}

const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'id',
  'kind',
  'activeMode',
  'name',
  'artboards',
  'objects',
  'guides',
  'fillets',
  'source',
  'createdAt',
  'updatedAt',
])
const ARTBOARD_KEYS = new Set(['id', 'name', 'rect', 'background'])
const RECT_KEYS = new Set(['x', 'y', 'width', 'height'])
const SOURCE_KEYS = new Set(['seed', 'modeId', 'generatorId', 'generatorVersion', 'paramsHash', 'convertedAt'])
const BASE_KEYS = ['id', 'type', 'name', 'parentId', 'visible', 'locked']
const PATH_KEYS = new Set([...BASE_KEYS, 'operation', 'contours', 'fillRule', 'carve', 'link', 'pin', 'frame', 'sourceShapeId'])
const GROUP_KEYS = new Set([...BASE_KEYS, 'isolated', 'operation', 'frame'])
const CONTOUR_KEYS = new Set(['closed', 'segments'])
const SEGMENT_KEYS = new Set(['point', 'handleIn', 'handleOut'])
const VEC_KEYS = new Set(['x', 'y'])
const GUIDE_KEYS = new Set(['id', 'name', 'visible', 'locked', 'style', 'shape', 'link'])
const FILLET_KEYS = new Set(['id', 'visible', 'radius', 'at', 'between'])

function cleanArtboard(artboard: VectorArtboard): VectorArtboard {
  const { x, y, width, height } = artboard.rect
  return { id: artboard.id, name: artboard.name, rect: { x, y, width, height }, background: artboard.background }
}

function readSource(value: unknown): VectorDocumentSource | null {
  if (!isRecord(value)) return null
  const valid =
    isFiniteNumber(value.seed) &&
    typeof value.modeId === 'string' &&
    typeof value.generatorId === 'string' &&
    typeof value.generatorVersion === 'string' &&
    typeof value.paramsHash === 'string' &&
    typeof value.convertedAt === 'string'
  if (!valid) return null
  if (onlyKeys(value, SOURCE_KEYS)) return value as unknown as VectorDocumentSource
  return {
    seed: value.seed as number,
    modeId: value.modeId as string,
    generatorId: value.generatorId as string,
    generatorVersion: value.generatorVersion as string,
    paramsHash: value.paramsHash as string,
    convertedAt: value.convertedAt as string,
  }
}

/** A list read item by item, dropping what cannot be read: the same array when nothing was dropped. */
function readList<T>(value: unknown, read: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  let changed = false
  const out: T[] = []
  for (const raw of value) {
    const item = read(raw)
    // A null entry reads as null too: it is still dropped, so the list changes.
    if (item === null || item !== raw) changed = true
    if (item) out.push(item)
  }
  return changed ? out : (value as T[])
}

/* ─── Objects ─── */

/**
 * One object: null when its own geometry cannot be read, which refuses the
 * document; undefined when it is of a type this build does not know, which
 * drops it. A flag, name or rule that is missing or of the wrong type takes
 * the value the editor gives a new object, and a contour with no points
 * goes. The very same object when it needs no repair.
 */
function readObject(value: unknown): VectorObject | null | undefined {
  if (!isRecord(value)) return null
  if (value.type !== 'path' && value.type !== 'group') return undefined
  const id = typeof value.id === 'string' ? value.id : isFiniteNumber(value.id) ? String(value.id) : crypto.randomUUID()
  const base = {
    id,
    name: typeof value.name === 'string' ? value.name : '',
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    visible: typeof value.visible === 'boolean' ? value.visible : true,
    locked: typeof value.locked === 'boolean' ? value.locked : false,
  }
  const operation = isOperation(value.operation) ? value.operation : 'add'
  const baseSame =
    id === value.id &&
    base.name === value.name &&
    base.parentId === value.parentId &&
    base.visible === value.visible &&
    base.locked === value.locked &&
    operation === value.operation

  if (value.type === 'group') {
    const isolated = typeof value.isolated === 'boolean' ? value.isolated : false
    const frame = value.frame === undefined || isValidFrame(value.frame) ? value.frame : undefined
    const same = baseSame && isolated === value.isolated && frame === value.frame && (frame === undefined || onlyKeys(frame, FRAME_KEYS))
    if (same && onlyKeys(value, GROUP_KEYS)) return value as unknown as GroupObject
    const group: GroupObject = { ...base, type: 'group', isolated, operation }
    if (frame) group.frame = { rotation: (frame as { rotation: number }).rotation }
    return group
  }

  if (!Array.isArray(value.contours)) return null
  // The editor gives several contours even-odd, so their holes are holes whichever way they turn.
  const fillRule = value.fillRule === 'nonzero' || value.fillRule === 'evenodd' ? value.fillRule : 'evenodd'
  let contoursChanged = false
  const contours: Contour[] = []
  for (const raw of value.contours) {
    const contour = readContour(raw)
    if (!contour) return null
    if (contour !== raw) contoursChanged = true
    // An empty contour draws nothing, and would shift the numbering point edits go by.
    if (contour.segments.length === 0) contoursChanged = true
    else contours.push(contour)
  }

  const carve = value.carve !== undefined && isObjectCarveValid(value.carve, contours) ? value.carve : undefined
  const link = readLink(value.link)
  const pin = carve && isRecord(value.pin) && typeof value.pin.centreOf === 'string' ? value.pin : undefined
  const frame = !carve && isValidFrame(value.frame) ? value.frame : undefined
  const sourceShapeId = typeof value.sourceShapeId === 'string' ? value.sourceShapeId : undefined
  const same =
    baseSame &&
    !contoursChanged &&
    fillRule === value.fillRule &&
    carve === value.carve &&
    link === value.link &&
    pin === value.pin &&
    frame === value.frame &&
    sourceShapeId === value.sourceShapeId &&
    (pin === undefined || onlyKeys(pin, PIN_KEYS)) &&
    (frame === undefined || onlyKeys(frame, FRAME_KEYS)) &&
    onlyKeys(value, PATH_KEYS)
  if (same) return value as unknown as PathObject

  const object: PathObject = {
    ...base,
    type: 'path',
    operation,
    contours: contoursChanged ? contours : (value.contours as Contour[]),
    fillRule,
  }
  if (carve) object.carve = carve
  if (link) object.link = link
  if (pin) object.pin = { centreOf: (pin as { centreOf: string }).centreOf }
  if (frame) object.frame = { rotation: (frame as { rotation: number }).rotation }
  if (sourceShapeId !== undefined) object.sourceShapeId = sourceShapeId
  return object
}

const PIN_KEYS = new Set(['centreOf'])
const FRAME_KEYS = new Set(['rotation'])

/** A link of a kind this build knows, or undefined. The same link when it needs no repair. */
function readLink(value: unknown): ObjectLink | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === 'band' && typeof value.a === 'string' && typeof value.b === 'string') {
    return onlyKeys(value, BAND_KEYS) ? (value as unknown as ObjectLink) : { kind: 'band', a: value.a, b: value.b }
  }
  if (value.kind === 'offset' && typeof value.of === 'string' && isFiniteNumber(value.distance)) {
    return onlyKeys(value, OFFSET_KEYS)
      ? (value as unknown as ObjectLink)
      : { kind: 'offset', of: value.of, distance: value.distance }
  }
  return undefined
}

const BAND_KEYS = new Set(['kind', 'a', 'b'])
const OFFSET_KEYS = new Set(['kind', 'of', 'distance'])

function readContour(value: unknown): Contour | null {
  if (!isRecord(value) || typeof value.closed !== 'boolean' || !Array.isArray(value.segments)) return null
  let changed = !onlyKeys(value, CONTOUR_KEYS)
  const segments: Segment[] = []
  for (const raw of value.segments) {
    if (
      !isRecord(raw) ||
      !isVec2(raw.point) ||
      !(raw.handleIn === null || isVec2(raw.handleIn)) ||
      !(raw.handleOut === null || isVec2(raw.handleOut))
    ) {
      return null
    }
    const clean =
      onlyKeys(raw, SEGMENT_KEYS) &&
      onlyKeys(raw.point, VEC_KEYS) &&
      (raw.handleIn === null || onlyKeys(raw.handleIn, VEC_KEYS)) &&
      (raw.handleOut === null || onlyKeys(raw.handleOut, VEC_KEYS))
    if (clean) {
      segments.push(raw as unknown as Segment)
      continue
    }
    changed = true
    segments.push({ point: vec(raw.point), handleIn: raw.handleIn && vec(raw.handleIn), handleOut: raw.handleOut && vec(raw.handleOut) })
  }
  return changed ? { closed: value.closed, segments } : (value as unknown as Contour)
}

function vec(value: Record<string, unknown>): { x: number; y: number } {
  return { x: value.x as number, y: value.y as number }
}

/* ─── Groups ─── */

/**
 * How deep groups nest at most. An object deeper than this moves to the
 * root, so every chain of parents the editor walks is short.
 */
export const MAX_GROUP_DEPTH = 64

/**
 * Groups as the stack keeps them: every parent is a group that is there,
 * with no loops and no deeper than `MAX_GROUP_DEPTH`; a group's members
 * follow its header directly, in the order they were in; a group with
 * nothing in it is gone. The same array when it already was so. Reading a
 * document and committing an edit both keep it, so what the editor draws is
 * what reopening the link draws. It walks each object once, without
 * recursion, so no document is too deep or too large for it.
 */
export function repairStructure(objects: VectorObject[]): VectorObject[] {
  if (!objects.some((object) => object.type === 'group' || object.parentId !== null)) return objects
  const byId = new Map<string, VectorObject>()
  const order = new Map<VectorObject, number>()
  objects.forEach((object, index) => {
    if (!byId.has(object.id)) byId.set(object.id, object)
    order.set(object, index)
  })

  // Every parent a group that is there.
  const parentOf = new Map<VectorObject, VectorObject | null>()
  for (const object of objects) {
    const parent = object.parentId === null ? undefined : byId.get(object.parentId)
    parentOf.set(object, parent && parent.type === 'group' && parent !== object ? parent : null)
  }

  // Each object's depth, walking up from it until the root or an object
  // already known. A loop is broken where it is met: its first object in
  // the stack moves to the root. Past the deepest nesting, an object moves
  // to the root too, and its members come with it.
  const depthOf = new Map<VectorObject, number>()
  for (const object of objects) {
    if (depthOf.has(object)) continue
    const chain: VectorObject[] = []
    const onChain = new Set<VectorObject>()
    let node: VectorObject | null = object
    while (node !== null && !depthOf.has(node)) {
      if (onChain.has(node)) {
        const loop = chain.slice(chain.indexOf(node))
        const first = loop.reduce((a, b) => (order.get(b)! < order.get(a)! ? b : a))
        parentOf.set(first, null)
        // Walk again from the start: the loop now ends at the root.
        chain.length = 0
        onChain.clear()
        node = object
        continue
      }
      chain.push(node)
      onChain.add(node)
      node = parentOf.get(node) ?? null
    }
    let depth = node === null ? -1 : depthOf.get(node)!
    for (let i = chain.length - 1; i >= 0; i--) {
      depth += 1
      if (depth > MAX_GROUP_DEPTH) {
        parentOf.set(chain[i], null)
        depth = 0
      }
      depthOf.set(chain[i], depth)
    }
  }

  // Members in stack order under each parent; the root is null.
  const children = new Map<VectorObject | null, VectorObject[]>()
  for (const object of objects) {
    const parent = parentOf.get(object) ?? null
    const list = children.get(parent) ?? []
    list.push(object)
    children.set(parent, list)
  }
  // A group with a path somewhere inside it is filled; any other is empty.
  const filled = new Set<VectorObject>()
  for (const object of objects) {
    if (object.type !== 'path') continue
    let parent = parentOf.get(object) ?? null
    while (parent !== null && !filled.has(parent)) {
      filled.add(parent)
      parent = parentOf.get(parent) ?? null
    }
  }

  const ordered: VectorObject[] = []
  const open: Array<{ members: VectorObject[]; next: number }> = [{ members: children.get(null) ?? [], next: 0 }]
  while (open.length > 0) {
    const level = open.at(-1)!
    if (level.next === level.members.length) {
      open.pop()
      continue
    }
    const object = level.members[level.next++]
    // Only the first header with an id is that group: a later one would give its members a second time.
    if (object.type === 'group' && (byId.get(object.id) !== object || !filled.has(object))) continue
    const parentId = parentOf.get(object)?.id ?? null
    ordered.push(parentId === object.parentId ? object : { ...object, parentId })
    if (object.type === 'group') open.push({ members: children.get(object) ?? [], next: 0 })
  }
  const same = ordered.length === objects.length && ordered.every((object, index) => object === objects[index])
  return same ? objects : ordered
}

/**
 * Every id once: the first object keeps it and a later one takes a fresh id,
 * so a parent, link or pin naming it means the first. The same array when
 * no id repeats.
 */
function uniqueIds(objects: VectorObject[]): VectorObject[] {
  const seen = new Set<string>()
  let changed = false
  const next = objects.map((object) => {
    if (!seen.has(object.id)) {
      seen.add(object.id)
      return object
    }
    changed = true
    return { ...object, id: crypto.randomUUID() }
  })
  return changed ? next : objects
}

/** Links and pins to objects that are not there are detached. The same array when none is. */
function repairReferences(objects: VectorObject[]): VectorObject[] {
  const ids = new Set(objects.map((object) => object.id))
  const there = (id: string, self: string) => id !== self && ids.has(id)
  let changed = false
  const next = objects.map((object) => {
    if (object.type !== 'path') return object
    const { link, pin } = object
    const keepLink =
      !link || (link.kind === 'band' ? there(link.a, object.id) && there(link.b, object.id) : there(link.of, object.id))
    const keepPin = !pin || there(pin.centreOf, object.id)
    if (keepLink && keepPin) return object
    changed = true
    const repaired: PathObject = { ...object }
    if (!keepLink) delete repaired.link
    if (!keepPin) delete repaired.pin
    return repaired
  })
  return changed ? next : objects
}

/* ─── Guides and fillets ─── */

const GUIDE_STYLES = new Set(['solid', 'dashed', 'dotted'])
const ROLES = new Set(['centre-x', 'centre-y', 'top', 'right', 'bottom', 'left', 'circumcircle', 'incircle'])

function isConstructionRole(value: unknown): value is ConstructionRole {
  return typeof value === 'string' && (ROLES.has(value) || /^axis-\d+$/.test(value))
}

/** A guide, or null when its shape is of a kind this build does not know or it cannot be read. */
function readGuide(value: unknown, ids: Set<string>): Guide | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.visible !== 'boolean' ||
    typeof value.locked !== 'boolean'
  ) {
    return null
  }
  const shape = readGuideShape(value.shape)
  if (!shape) return null
  const style = typeof value.style === 'string' && GUIDE_STYLES.has(value.style) ? (value.style as Guide['style']) : 'solid'
  const rawLink = value.link
  const link =
    isRecord(rawLink) && rawLink.kind === 'construction' && typeof rawLink.of === 'string' && ids.has(rawLink.of) && isConstructionRole(rawLink.role)
      ? rawLink
      : undefined
  const same =
    shape === value.shape &&
    style === value.style &&
    link === rawLink &&
    (link === undefined || onlyKeys(link, GUIDE_LINK_KEYS)) &&
    onlyKeys(value, GUIDE_KEYS)
  if (same) return value as unknown as Guide
  const guide: Guide = { id: value.id, name: value.name, visible: value.visible, locked: value.locked, style, shape }
  if (link) guide.link = { kind: 'construction', of: link.of as string, role: link.role as ConstructionRole }
  return guide
}

const GUIDE_LINK_KEYS = new Set(['kind', 'of', 'role'])

function readGuideShape(value: unknown): Guide['shape'] | null {
  if (!isRecord(value)) return null
  if (value.kind === 'line' && isVec2(value.p) && isFiniteNumber(value.angle)) {
    return onlyKeys(value, new Set(['kind', 'p', 'angle'])) && onlyKeys(value.p, VEC_KEYS)
      ? (value as unknown as Guide['shape'])
      : { kind: 'line', p: vec(value.p), angle: value.angle }
  }
  if (value.kind === 'circle' && isVec2(value.c) && isFiniteNumber(value.r) && value.r >= 0) {
    return onlyKeys(value, new Set(['kind', 'c', 'r'])) && onlyKeys(value.c, VEC_KEYS)
      ? (value as unknown as Guide['shape'])
      : { kind: 'circle', c: vec(value.c), r: value.r }
  }
  if (value.kind === 'path') {
    const contour = readContour(value.contour)
    if (!contour) return null
    return contour === value.contour && onlyKeys(value, new Set(['kind', 'contour']))
      ? (value as unknown as Guide['shape'])
      : { kind: 'path', contour }
  }
  return null
}

/** A fillet, or null when it cannot be read or either object it sits between is not there. */
function readFillet(value: unknown, ids: Set<string>): Fillet | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.visible !== 'boolean' ||
    !isFiniteNumber(value.radius) ||
    value.radius <= 0 ||
    !isVec2(value.at) ||
    !Array.isArray(value.between) ||
    value.between.length !== 2 ||
    !value.between.every((id) => typeof id === 'string' && ids.has(id))
  ) {
    return null
  }
  if (onlyKeys(value, FILLET_KEYS) && onlyKeys(value.at, VEC_KEYS)) return value as unknown as Fillet
  return {
    id: value.id,
    visible: value.visible,
    radius: value.radius,
    at: vec(value.at),
    between: [value.between[0], value.between[1]],
  }
}

/* ─── Small checks ─── */

function isOperation(value: unknown): value is 'add' | 'subtract' {
  return value === 'add' || value === 'subtract'
}

function isValidFrame(frame: unknown): frame is { rotation: number } {
  return isRecord(frame) && isFiniteNumber(frame.rotation)
}

function isVectorArtboard(value: unknown): value is VectorArtboard {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRect(value.rect) &&
    (typeof value.background === 'string' || value.background === null)
  )
}

function isVec2(value: unknown): value is Record<string, unknown> & { x: number; y: number } {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isRect(value: unknown): value is Rect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  )
}

/** Does a record hold no fields beyond these? */
function onlyKeys(value: unknown, keys: Set<string>): boolean {
  if (!isRecord(value)) return false
  for (const key of Object.keys(value)) if (!keys.has(key)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
