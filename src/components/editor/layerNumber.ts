import type { IllustratorDocument } from '../../engine/illustrator/types.ts'
import { layerNumbers } from '../../engine/vector/groups.ts'

export { layerNumbers }

/**
 * A layer's or group's number as the drawer shows it, counted within each
 * level from 01 at the bottom: "03" at the root, "03.2" for the second
 * member of group 03 (see `stackNumbers`); null when it is gone. Without
 * groups a layer's number is its place in the stack.
 */
export function layerNumber(doc: Pick<IllustratorDocument, 'layers' | 'groups'>, id: string): string | null {
  return layerNumbers(doc).get(id) ?? null
}

/**
 * A number as a row inside a group writes it, short where it has little
 * room: a layer or group in the same group as `from` by its place there
 * alone, ".1" for "03.1" seen from "03.4", as the row's own number already
 * says which group; anything else in full. Null when it is gone.
 */
export function nearNumber(doc: Pick<IllustratorDocument, 'layers' | 'groups'>, id: string, from: string): string | null {
  const number = layerNumber(doc, id)
  const own = layerNumber(doc, from)
  if (!number || !own) return number
  const cut = own.lastIndexOf('.')
  if (cut < 0) return number
  const group = own.slice(0, cut + 1)
  const rest = number.slice(group.length)
  return number.startsWith(group) && !rest.includes('.') ? `.${rest}` : number
}

/**
 * A band's circles as the drawer numbers them: a layer's number, or a
 * guide's, "guide 3", or with `short`, as a drawer row has room for, "g3",
 * and a circle in the same group as the band `from` by its place there
 * alone, ".1" (see `nearNumber`).
 */
export function bandEnds(doc: Pick<IllustratorDocument, 'layers' | 'groups' | 'guides'>, link: { a: string; b: string }, short = false, from?: string): string[] {
  return [link.a, link.b].map((id) => {
    const number = short && from ? nearNumber(doc, id, from) : layerNumber(doc, id)
    if (number) return number
    const guide = (doc.guides ?? []).findIndex((each) => each.id === id)
    return guide < 0 ? '—' : `${short ? 'g' : 'guide '}${guide + 1}`
  })
}
