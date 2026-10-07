import { useEffect, useRef } from 'react'
import {
  decodeLink,
  documentFromGeneratorLink,
  encodeLink,
  type DecodedLink,
  UNREADABLE,
} from '../engine/vector/link.ts'
import { useLogoStore } from '../store/logoStore.ts'

const URL_WRITE_DELAY_MS = 300

type StoreState = ReturnType<typeof useLogoStore.getState>

/** Opens the document the link names, then rewrites the link after each edit. */
export function useUrlState() {
  const opened = useRef(false)

  useEffect(() => {
    if (!opened.current) {
      opened.current = true
      // Reading never means to throw; if it does all the same, say so instead of showing nothing.
      try {
        openLink(decodeLink(window.location.hash))
      } catch {
        openLink(UNREADABLE)
      }
    }

    // Opening a link is not an edit: the hash stays as it came until the
    // objects, guides, fillets or the ink change. Selection changes never rewrite it.
    let written = linkSource(useLogoStore.getState())
    let seen = written
    let timer: number | undefined

    // Encoding compresses the whole document: do it once things settle, not on every step.
    const write = () => {
      window.clearTimeout(timer)
      timer = undefined
      const state = useLogoStore.getState()
      written = linkSource(state)
      const hash = encodeLink(state.vectorDocument, state.params.fillColor)
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
      }
    }

    const unsubscribe = useLogoStore.subscribe((state) => {
      const next = linkSource(state)
      if (sameSource(next, seen)) return
      seen = next
      window.clearTimeout(timer)
      timer = sameSource(next, written) ? undefined : window.setTimeout(write, URL_WRITE_DELAY_MS)
    })

    // Leaving or reloading right after an edit still keeps it in the link.
    const flush = () => {
      if (timer !== undefined) write()
    }
    window.addEventListener('pagehide', flush)

    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
    }
  }, [])
}

function openLink(link: DecodedLink): void {
  const store = useLogoStore.getState()
  switch (link.kind) {
    case 'blank':
      return
    case 'vector':
      store.setParam('fillColor', link.inkColor)
      store.setVectorDocument(link.document)
      return
    case 'legacy-layers':
      store.setParam('fillColor', link.inkColor)
      store.setIllustratorDocument(link.document)
      return
    case 'generator':
      store.setParams(link.params)
      store.setVectorDocument(documentFromGeneratorLink(link.params))
      return
    case 'invalid':
      store.setError(link.reason)
      return
    default:
      link satisfies never
  }
}

function linkSource(state: StoreState) {
  const { objects, guides, fillets, artboards } = state.vectorDocument
  return [objects, guides, fillets, artboards, state.params.fillColor] as const
}

function sameSource(a: ReturnType<typeof linkSource>, b: ReturnType<typeof linkSource>): boolean {
  return a.every((value, i) => value === b[i])
}
