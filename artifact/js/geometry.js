// Geometry over immutable contours: matrices, bounds, curves, node editing, shape generators.
// Pure: no DOM, no Paper. Never mutates its inputs.

const KAPPA = 0.5522847498 // cubic bezier control length for a quarter circle
const EPS = 1e-9
const SIN_2DEG = Math.sin((2 * Math.PI) / 180)

const vec = (x, y) => ({ x, y })
const node = (x, y, hi = null, ho = null) => ({ x, y, hi, ho })
const pos = (n) => vec(n.x, n.y)
const lerp = (a, b, t) => vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const withNode = (c, i, n) => ({ ...c, nodes: c.nodes.map((m, k) => (k === i ? n : m)) })

// ---- Matrices: [a b c d e f] like SVG, x' = a*x + c*y + e, y' = b*x + d*y + f ----

export const mat = {
  identity: () => [1, 0, 0, 1, 0, 0],
  // a∘b: apply b first, then a
  multiply: (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ],
  translate: (dx, dy) => [1, 0, 0, 1, dx, dy],
  scale: (sx, sy, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy],
  rotate(rad, cx = 0, cy = 0) {
    const c = Math.cos(rad), s = Math.sin(rad)
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
  },
  // A singular matrix has no inverse; the identity is returned so callers never crash.
  invert([a, b, c, d, e, f]) {
    const det = a * d - b * c
    if (!det) return [1, 0, 0, 1, 0, 0]
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
  },
  apply: (m, p) => vec(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]),
}

// ---- Segments and curves ----

export const segmentCount = (c) => (c.nodes.length < 2 ? 0 : c.closed ? c.nodes.length : c.nodes.length - 1)

export function segmentCubic(c, i) {
  const a = c.nodes[i], b = c.nodes[(i + 1) % c.nodes.length]
  return [pos(a), a.ho ?? pos(a), b.hi ?? pos(b), pos(b)]
}

function cubicAt([p0, p1, p2, p3], t) {
  const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
  return vec(w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y)
}

// t in (0, 1) where one coordinate of a cubic has a zero derivative: a t² + b t + c = 0
function extrema(p0, p1, p2, p3) {
  const d0 = p1 - p0, d1 = p2 - p1, d2 = p3 - p2
  const a = d0 - 2 * d1 + d2, b = 2 * (d1 - d0), c = d0
  let roots = []
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS) roots = [-c / b]
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) roots = [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)]
  }
  return roots.filter((t) => t > 0 && t < 1)
}

// ---- Bounds ----

const unionRect = (a, b) => {
  if (!a || !b) return a || b
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function contourBounds(c) {
  if (!c.nodes.length) return null
  const pts = c.nodes.map(pos)
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segmentCubic(c, i)
    const ts = [...extrema(s[0].x, s[1].x, s[2].x, s[3].x), ...extrema(s[0].y, s[1].y, s[2].y, s[3].y)]
    for (const t of ts) pts.push(cubicAt(s, t))
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const itemBounds = (item) => item.contours.map(contourBounds).reduce((a, b) => unionRect(a, b), null)
export const boundsOf = (items) => items.map(itemBounds).reduce((a, b) => unionRect(a, b), null)

// ---- Transforms ----

export function transformContours(contours, m) {
  const p = (q) => q && mat.apply(m, q)
  return contours.map((c) => ({
    ...c,
    nodes: c.nodes.map((n) => ({ ...mat.apply(m, n), hi: p(n.hi), ho: p(n.ho) })),
  }))
}

export function transformItem(item, m) {
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  return { ...item, contours: transformContours(item.contours, m), strokeWidth: item.strokeWidth * k }
}

// ---- Sampling and nearest point ----

// Polyline approximation. Closed contours do not repeat the first point.
export function flattenContour(c, tol = 0.25) {
  const out = []
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segmentCubic(c, i), [p0, p1, p2, p3] = s
    out.push(p0)
    if (!c.nodes[i].ho && !c.nodes[(i + 1) % c.nodes.length].hi) continue // a line needs no subdividing
    // Wang's bound on the subdivisions needed to stay within tol (cubic: sqrt(6 M / 8 tol))
    const m = Math.max(
      Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
      Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
    )
    const k = Math.min(200, Math.ceil(Math.sqrt((0.75 * m) / tol)))
    for (let j = 1; j < k; j++) out.push(cubicAt(s, j / k))
  }
  if (c.nodes.length && (!c.closed || !out.length)) out.push(pos(c.nodes[c.nodes.length - 1]))
  return out
}

// A segment without handles is a line, parameterised linearly (not as the cubic [a, a, b, b]),
// so that the t found here and the node insertNode puts at t agree.
function nearestOnCubic(s, p) {
  const [p0, p1, p2, p3] = s
  let t, point
  if (p1.x === p0.x && p1.y === p0.y && p2.x === p3.x && p2.y === p3.y) {
    const dx = p3.x - p0.x, dy = p3.y - p0.y, len2 = dx * dx + dy * dy
    t = len2 ? Math.min(1, Math.max(0, ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / len2)) : 0
    point = lerp(p0, p3, t)
  } else {
    const d2 = (u) => { const q = cubicAt(s, u); return (q.x - p.x) ** 2 + (q.y - p.y) ** 2 }
    const N = 24
    let best = 0
    for (let i = 1; i <= N; i++) if (d2(i / N) < d2(best / N)) best = i
    let lo = Math.max(0, (best - 1) / N), hi = Math.min(1, (best + 1) / N)
    for (let i = 0; i < 30; i++) { // ternary search inside the best coarse bracket
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
      if (d2(m1) < d2(m2)) hi = m2
      else lo = m1
    }
    t = (lo + hi) / 2
    point = cubicAt(s, t)
  }
  return { t, point, dist: dist(point, p) }
}

export function nearestOnContour(c, p) {
  if (!c.nodes.length) return null
  if (!segmentCount(c)) return { seg: 0, t: 0, point: pos(c.nodes[0]), dist: dist(c.nodes[0], p) }
  let best = null
  for (let i = 0; i < segmentCount(c); i++) {
    const r = nearestOnCubic(segmentCubic(c, i), p)
    if (!best || r.dist < best.dist) best = { seg: i, ...r }
  }
  return best
}

export function nearestOnItem(item, p) {
  let best = null
  item.contours.forEach((c, ci) => {
    const r = nearestOnContour(c, p)
    if (r && (!best || r.dist < best.dist)) best = { ci, ...r }
  })
  return best
}

// ---- Node editing ----

// De Casteljau split, so the curve is unchanged (a line is split linearly). t outside (0, 1) would
// duplicate a node, so the contour is returned as is.
export function insertNode(c, seg, t) {
  if (seg < 0 || seg >= segmentCount(c) || !(t > 0 && t < 1)) return c
  const j = (seg + 1) % c.nodes.length, a = c.nodes[seg], b = c.nodes[j]
  const [p0, p1, p2, p3] = segmentCubic(c, seg)
  const nodes = c.nodes.slice()
  if (!a.ho && !b.hi) {
    const m = lerp(p0, p3, t)
    nodes.splice(seg + 1, 0, node(m.x, m.y))
    return { ...c, nodes }
  }
  const q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t)
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s = lerp(r0, r1, t)
  nodes[seg] = { ...a, ho: a.ho && q0 }
  nodes[j] = { ...b, hi: b.hi && q2 }
  nodes.splice(seg + 1, 0, node(s.x, s.y, r0, r1))
  return { ...c, nodes }
}

// Neighbours keep their own outer handles.
export const removeNode = (c, i) => ({ ...c, nodes: c.nodes.filter((_, k) => k !== i) })

export function isSmooth(n) {
  if (!n.hi || !n.ho) return false
  const ux = n.hi.x - n.x, uy = n.hi.y - n.y, wx = n.ho.x - n.x, wy = n.ho.y - n.y
  const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy)
  if (lu < EPS || lw < EPS) return false
  return ux * wx + uy * wy < 0 && Math.abs(ux * wy - uy * wx) <= SIN_2DEG * lu * lw
}

export function setSmooth(c, i, smooth) {
  const n = c.nodes[i]
  if (!n) return c
  if (!smooth) return n.hi || n.ho ? withNode(c, i, { x: n.x, y: n.y, hi: null, ho: null }) : c
  const cnt = c.nodes.length
  const prev = c.nodes[c.closed ? (i - 1 + cnt) % cnt : i - 1] ?? n
  const next = c.nodes[c.closed ? (i + 1) % cnt : i + 1] ?? n
  const tl = dist(prev, next)
  if (tl < EPS) return c
  const ux = (next.x - prev.x) / tl, uy = (next.y - prev.y) / tl // tangent, prev → next
  let din = dist(prev, n), dout = dist(next, n)
  if (prev === n) din = dout // end of an open contour: only one neighbour
  if (next === n) dout = din
  const h = (len, sign) => (len < EPS ? null : vec(n.x + sign * ux * (len / 3), n.y + sign * uy * (len / 3)))
  return withNode(c, i, { x: n.x, y: n.y, hi: h(din, -1), ho: h(dout, 1) })
}

export function moveNode(c, i, p) {
  const n = c.nodes[i]
  if (!n || (p.x === n.x && p.y === n.y)) return c
  const dx = p.x - n.x, dy = p.y - n.y
  const shift = (h) => h && vec(h.x + dx, h.y + dy)
  return withNode(c, i, { x: p.x, y: p.y, hi: shift(n.hi), ho: shift(n.ho) })
}

export function moveHandle(c, i, which, p, { mirror = true } = {}) {
  const n = c.nodes[i]
  if (!n) return c
  const len = dist(n, p)
  const next = { ...n, [which]: len < EPS ? null : vec(p.x, p.y) }
  if (mirror && len >= EPS && isSmooth(n)) { // keep the opposite handle collinear, same length
    const other = which === 'hi' ? 'ho' : 'hi', ol = dist(n, n[other])
    next[other] = vec(n.x - ((p.x - n.x) / len) * ol, n.y - ((p.y - n.y) / len) * ol)
  }
  return withNode(c, i, next)
}

// ---- Drag helpers ----

export function dragRect(a, b, { square = false, center = false } = {}) {
  let dx = b.x - a.x, dy = b.y - a.y
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    dx = dx < 0 ? -s : s
    dy = dy < 0 ? -s : s
  }
  const w = Math.abs(dx), h = Math.abs(dy)
  return center
    ? { x: a.x - w, y: a.y - h, w: 2 * w, h: 2 * h }
    : { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w, h }
}

// Snap the direction from→to to the nearest multiple of 45°, keeping the distance.
export function constrain45(from, to) {
  const S = Math.SQRT1_2, dirs = [[1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S], [0, -1], [S, -S]]
  const k = (((Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) % 8) + 8) % 8)
  const len = dist(from, to)
  return vec(from.x + dirs[k][0] * len, from.y + dirs[k][1] * len)
}

// ---- Shape generators (all return Contour[]) ----

export function rectContours(x, y, w, h, r = 0) {
  r = Math.min(Math.max(r, 0), Math.min(w, h) / 2)
  if (!(r > 0)) return [{ closed: true, nodes: [node(x, y), node(x + w, y), node(x + w, y + h), node(x, y + h)] }]
  const k = r * KAPPA, X = x + w, Y = y + h
  return [{ closed: true, nodes: [ // clockwise from the end of the top-left arc
    node(x + r, y, vec(x + r - k, y)), node(X - r, y, null, vec(X - r + k, y)),
    node(X, y + r, vec(X, y + r - k)), node(X, Y - r, null, vec(X, Y - r + k)),
    node(X - r, Y, vec(X - r + k, Y)), node(x + r, Y, null, vec(x + r - k, Y)),
    node(x, Y - r, vec(x, Y - r + k)), node(x, y + r, null, vec(x, y + r - k)),
  ] }]
}

export function ellipseContours(cx, cy, rx, ry) {
  const kx = rx * KAPPA, ky = ry * KAPPA
  return [{ closed: true, nodes: [ // clockwise from the top
    node(cx, cy - ry, vec(cx - kx, cy - ry), vec(cx + kx, cy - ry)),
    node(cx + rx, cy, vec(cx + rx, cy - ky), vec(cx + rx, cy + ky)),
    node(cx, cy + ry, vec(cx + kx, cy + ry), vec(cx - kx, cy + ry)),
    node(cx - rx, cy, vec(cx - rx, cy + ky), vec(cx - rx, cy - ky)),
  ] }]
}

export function polygonContours(cx, cy, rx, ry, sides, { star = false, inner = 0.5, rotation = -Math.PI / 2 } = {}) {
  const n = Math.min(24, Math.max(3, Math.round(sides) || 3)), count = star ? 2 * n : n
  const nodes = []
  for (let i = 0; i < count; i++) {
    const a = rotation + (2 * Math.PI * i) / count, k = star && i % 2 ? inner : 1
    nodes.push(node(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k))
  }
  return [{ closed: true, nodes }]
}

export const lineContours = (a, b) => [{ closed: false, nodes: [node(a.x, a.y), node(b.x, b.y)] }]

// ---- Path data ----

// Round to `precision` decimals, strip trailing zeros; -0 becomes '0'.
export function formatNumber(n, precision = 2) {
  const f = 10 ** precision, r = Math.round(n * f) / f
  return r === 0 ? '0' : String(r)
}

// 'M x y', then 'L' (no handles on the segment) or 'C' per segment; 'Z' closes.
// A straight closing segment is left to the 'Z'.
export function contoursToD(contours, precision = 2) {
  const f = (...nums) => nums.map((n) => formatNumber(n, precision)).join(' ')
  const out = []
  for (const c of contours) {
    const { nodes } = c
    if (!nodes.length) continue
    out.push('M ' + f(nodes[0].x, nodes[0].y))
    for (let i = 0; i < segmentCount(c); i++) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length]
      if (a.ho || b.hi) {
        const h1 = a.ho ?? a, h2 = b.hi ?? b
        out.push('C ' + f(h1.x, h1.y, h2.x, h2.y, b.x, b.y))
      } else if (i < nodes.length - 1) out.push('L ' + f(b.x, b.y))
    }
    if (c.closed) out.push('Z')
  }
  return out.join(' ')
}
