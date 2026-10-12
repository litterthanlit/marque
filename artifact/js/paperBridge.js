// The only module that touches Paper.js, and it receives the namespace as an argument.
// Paper keeps handles RELATIVE to their anchor; ours are ABSOLUTE. Converting happens here and nowhere else.

import { LIMITS } from './consts.js'
import { boundsOf, transformContours } from './geometry.js'
import { makeItem } from './model.js'

const fail = (code, message = code) => Object.assign(new Error(message), { code })
const NO_INSERT = { insert: false }
const BOOLEAN = { union: 'unite', subtract: 'subtract', intersect: 'intersect', exclude: 'exclude' }

export function createBridge(paper) {
  if (!paper?.PaperScope) {
    const unavailable = () => { throw fail('unavailable', 'Paper.js is not available') }
    return { available: false, parsePathData: unavailable, booleanOp: unavailable, flatten: unavailable,
      simplify: unavailable, importSvg: unavailable, area: unavailable }
  }

  // One private scope, so we never disturb a scope the host page might use.
  const scope = new paper.PaperScope()
  scope.setup(new scope.Size(1, 1))
  const { Path, CompoundPath, Segment, Point } = scope

  // Runs fn in our scope and discards everything it created.
  function run(fn) {
    scope.activate()
    try { return fn() } finally { scope.project.clear() }
  }

  // ---- Conversion: our contours <-> Paper paths (relative handles, zero-length = none) ----

  const segmentOf = (n) => new Segment(
    new Point(n.x, n.y),
    n.hi && new Point(n.hi.x - n.x, n.hi.y - n.y),
    n.ho && new Point(n.ho.x - n.x, n.ho.y - n.y),
  )

  const nodeOf = ({ point: { x, y }, handleIn: i, handleOut: o }) => {
    const abs = (h) => (Math.abs(h.x) < 1e-9 && Math.abs(h.y) < 1e-9 ? null : { x: x + h.x, y: y + h.y })
    return { x, y, hi: abs(i), ho: abs(o) }
  }

  const contoursOf = (pathItem) => (pathItem.children || [pathItem])
    .filter((p) => p.segments.length >= 2)
    .map((p) => ({ closed: p.closed, nodes: p.segments.map(nodeOf) }))

  // Fills close open contours implicitly, so booleans see every contour as closed.
  function pathItemOf(item) {
    const paths = item.contours.filter((c) => c.nodes.length >= 2)
      .map((c) => new Path({ segments: c.nodes.map(segmentOf), closed: true, ...NO_INSERT }))
    const res = paths.length > 1 ? new CompoundPath({ children: paths, ...NO_INSERT }) : paths[0] || new Path(NO_INSERT)
    res.fillRule = item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
    return res
  }

  // ---- Public API ----

  function parsePathData(d) {
    if (typeof d !== 'string' || !/^\s*[Mm]/.test(d) || /[^\s,\d.+\-eEMmLlHhVvCcSsQqTtAaZz]/.test(d)) throw fail('invalid_path')
    return run(() => {
      const contours = contoursOf(scope.PathItem.create(d))
      if (!contours.length) throw fail('invalid_path')
      return contours
    })
  }

  // items in stack order; subtract = items[0] minus all the others
  function booleanOp(items, kind) {
    const op = BOOLEAN[kind]
    if (!op) throw fail('bad_request', `Unknown boolean operation: ${kind}`)
    if (!items.length) return []
    return run(() => contoursOf(items.map(pathItemOf).reduce((a, b) => a[op](b, NO_INSERT))))
  }

  // Folds the visible stack like the renderer does: add unites, cut subtracts (skipped with nothing beneath).
  // Only fills take part, since a stroke has no area to unite.
  function flatten(items) {
    const warnings = new Set()
    const contours = run(() => {
      let acc = null
      for (const it of items) {
        if (it.visible === false) continue
        if (it.stroke !== null) warnings.add('Strokes were left out.')
        if (it.fill === null) continue
        if (it.contours.some((c) => !c.closed)) warnings.add('Open paths were closed.')
        const p = pathItemOf(it)
        if (it.op === 'cut') acc = acc && acc.subtract(p, NO_INSERT)
        else acc = acc ? acc.unite(p, NO_INSERT) : p
      }
      return acc ? contoursOf(acc) : []
    })
    return { contours, warnings: [...warnings] }
  }

  function simplify(points, { tolerance = 2.5, close = false } = {}) {
    if (!points || points.length < 2) return null
    return run(() => {
      for (let tol = tolerance; tol > 0.01; tol /= 4) { // an oversized tolerance can collapse the fit to a single node
        const path = new Path({ segments: points.map((p) => [p.x, p.y]), ...NO_INSERT })
        path.closed = close
        path.simplify(tol)
        const [contour] = contoursOf(path)
        if (contour) return contour
      }
      return null
    })
  }

  // Filled area under the nonzero rule: crossings are resolved and holes reoriented before summing.
  function area(contours) {
    return run(() => {
      const paths = contours.filter((c) => c.nodes.length >= 2)
        .map((c) => new Path({ segments: c.nodes.map(segmentOf), closed: true, ...NO_INSERT }))
      if (!paths.length) return 0
      const all = new CompoundPath({ children: paths, fillRule: 'nonzero', ...NO_INSERT })
      return Math.abs(all.resolveCrossings().reorient(true, true).area)
    })
  }

  // Browser only. Matrices are baked into the geometry; clips, text, images and anything hidden are skipped.
  function importSvg(text) {
    if (typeof DOMParser === 'undefined') throw fail('unsupported', 'SVG import needs a browser')
    return run(() => {
      const dom = new DOMParser().parseFromString(String(text).trim(), 'image/svg+xml')
      const root = dom.documentElement
      if (!root || root.nodeName.toLowerCase() !== 'svg' || dom.querySelector('parsererror')) throw fail('invalid_svg')

      // Size: viewBox first, then width/height, else the content bounds.
      const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat)
      const hasBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
      if (hasBox) { root.removeAttribute('width'); root.removeAttribute('height') } // keep viewBox units 1:1
      const attr = (name) => {
        const raw = root.getAttribute(name) || '', v = parseFloat(raw)
        return v > 0 && !raw.includes('%') ? v : null
      }

      let group
      try {
        group = scope.project.importSVG(root, { expandShapes: true, insert: true, applyMatrix: false })
      } catch (e) {
        throw fail('invalid_svg', e.message)
      }

      if (!group) throw fail('invalid_svg')
      const items = []
      let skipped = 0
      const color = (c) => { // flat colours only: a gradient becomes its first stop
        if (c?.gradient) c = c.gradient.stops[0]?.color
        return c && c.alpha > 0 ? c.toCSS(true) : null
      }
      const visit = (node) => {
        if (node.visible === false) { skipped++; return }
        if (node.clipMask) { if (node.className !== 'Shape') skipped++; return } // a Shape clip is the viewBox's own
        if (node.className !== 'Path' && node.className !== 'CompoundPath') {
          if (node.children) node.children.forEach(visit)
          else skipped++
          return
        }
        const m = node.globalMatrix, matrix = [m.a, m.b, m.c, m.d, m.tx, m.ty]
        const contours = transformContours(contoursOf(node), matrix)
        if (!contours.length) { skipped++; return }
        if (items.length >= LIMITS.maxItems) { skipped++; return }
        let opacity = 1
        for (let p = node; p; p = p.parent) opacity *= p.opacity
        const stroke = color(node.strokeColor)
        const isLine = contours.every((c) => !c.closed && c.nodes.length === 2) // <line> has no area to fill
        const fill = isLine ? null : color(node.fillColor)
        if (!fill && !stroke) { skipped++; return } // paints nothing
        items.push({
          ...makeItem(contours, {}, node.name || 'Path'),
          fill, stroke, opacity,
          strokeWidth: stroke ? node.strokeWidth * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 2,
          cap: node.strokeCap, join: node.strokeJoin,
          fillRule: node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        })
      }
      visit(group)

      let width = hasBox ? vb[2] : attr('width'), height = hasBox ? vb[3] : attr('height')
      if (!width || !height) {
        const b = boundsOf(items) // no usable size attributes: fit the content
        width = width || (b ? Math.max(1, Math.ceil(b.x + b.w)) : 512)
        height = height || (b ? Math.max(1, Math.ceil(b.y + b.h)) : 512)
      }
      return { items, width, height, skipped }
    })
  }

  return { available: true, parsePathData, booleanOp, flatten, simplify, importSvg, area }
}
