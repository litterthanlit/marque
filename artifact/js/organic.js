// Organic shape makers and editors: blobs, smoothing, roughening, bending, pushing, distortion and ink outlines.
// Pure: imports only geometry.js. Every function returns new contours and leaves its inputs untouched; where
// nothing would change, the input itself is returned (callers use reference equality to detect "no-op").
import { boundsOf, contourBounds, insertNode, isSmooth, moveHandle, segmentCount, segmentCubic, setSmooth, transformContours } from './geometry.js'

export const MAX_NODES = 600
const TAU = Math.PI * 2
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const pt = (x, y) => ({ x, y })
const lerp = (a, b, t) => pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const add = (a, b, k = 1) => pt(a.x + b.x * k, a.y + b.y * k)
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const shift = (h, d) => h && add(h, d)
const approxLen = (s) => (dist(s[0], s[3]) + dist(s[0], s[1]) + dist(s[1], s[2]) + dist(s[2], s[3])) / 2 // chord and control polygon, averaged

// mulberry32. The seed's text is FNV-1a hashed first, which also mixes small integers like 1, 2, 3.
export function rng(seed) {
  let a = 2166136261
  for (const ch of String(seed)) a = Math.imul(a ^ ch.codePointAt(0), 16777619)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// What setSmooth gives node i, computed from its two neighbours only (no copy of the whole contour).
function smoothed(c, i) {
  const m = c.nodes.length, at = (k) => c.nodes[c.closed ? (k + m) % m : k], prev = at(i - 1)
  const nodes = [prev, c.nodes[i], at(i + 1)].filter(Boolean), j = prev ? 1 : 0
  return setSmooth({ closed: false, nodes }, j, true).nodes[j]
}
const smoothSet = (c, pick) => ({ ...c, nodes: c.nodes.map((n, i) => (pick(n, i) ? smoothed(c, i) : n)) })

// ---- Blob ----

export function blobContours(box, { points = 8, wobble = 0.35, smooth = 0.55, seed = 1 } = {}) {
  const n = clamp(Math.round(points) || 3, 3, 24), wob = clamp(wobble, 0, 1), sm = clamp(smooth, 0, 1), r = rng(seed)
  const a0 = r() * TAU
  const ps = Array.from({ length: n }, (_, i) => {
    const a = a0 + (TAU * i) / n + (2 * r() - 1) * 0.35 * wob * (TAU / n), rad = 1 + (2 * r() - 1) * 0.6 * wob
    return pt(Math.cos(a) * rad, Math.sin(a) * rad)
  })
  const nodes = ps.map((p, i) => {
    const prev = ps[(i + n - 1) % n], next = ps[(i + 1) % n], k = 0.3 * sm
    const t = pt((next.x - prev.x) * k, (next.y - prev.y) * k)
    return { x: p.x, y: p.y, hi: sm > 0 ? add(p, t, -1) : null, ho: sm > 0 ? add(p, t) : null }
  })
  const unit = { closed: true, nodes }, b = contourBounds(unit) // fit after the handles exist, so the curve itself fills the box
  const sx = box.w / b.w, sy = box.h / b.h
  return transformContours([unit], [sx, 0, 0, sy, box.x - b.x * sx, box.y - b.y * sy])
}

// ---- Smooth ----

// Corner nodes ease towards the handles setSmooth would give them (amount 1 = exactly those). Anchors never move,
// nodes that are already smooth are left alone, and open-path ends keep only the handle that faces inward.
export function smoothContours(contours, amount = 1) {
  if (!(amount > 0)) return contours
  const k = Math.min(amount, 1)
  const ease = (n, from, to) => {
    const a = from ?? n, b = to ?? n, p = pt(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
    return dist(p, n) < 1e-9 ? null : p
  }
  return contours.map((c) => ({
    ...c,
    nodes: c.nodes.map((n, i) => {
      if (isSmooth(n)) return n
      const h = smoothed(c, i), first = !c.closed && i === 0, last = !c.closed && i === c.nodes.length - 1
      return { x: n.x, y: n.y, hi: first ? null : ease(n, n.hi, h.hi), ho: last ? null : ease(n, n.ho, h.ho) }
    }),
  }))
}

// ---- Subdivide ----

// Split segments into equal-t pieces no longer than about maxLen. The shape does not change.
export function subdivide(c, maxLen, { only = null, cap = MAX_NODES, smoothNew = false } = {}) {
  const room = cap - c.nodes.length
  if (!(maxLen > 0) || room <= 0) return c
  const plan = []
  let extra = 0
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segmentCubic(c, i)
    if (only && only(s) === false) continue
    const k = Math.ceil(approxLen(s) / maxLen)
    if (k > 1 && k < Infinity) {
      plan.push({ i, k, line: !c.nodes[i].ho && !c.nodes[(i + 1) % c.nodes.length].hi })
      extra += k - 1
    }
  }
  const f = Math.min(1, room / extra) // over the cap: every segment gives up the same share
  let out = c
  const fresh = c.nodes.map(() => false)
  for (let p = plan.length - 1; p >= 0; p--) { // back to front, so earlier segment indices stay valid
    const { i, k, line } = plan[p]
    for (let r = 1 + Math.floor((k - 1) * f), at = i; r > 1; r--, at++) {
      out = insertNode(out, at, 1 / r) // the rest of the segment is split 1/r, then 1/(r-1), ...: equal pieces
      fresh.splice(at + 1, 0, line)
    }
  }
  if (out === c) return c
  return smoothNew ? smoothSet(out, (_, j) => fresh[j]) : out
}

// ---- Roughen ----

// Nudge anchors along their normal by up to amount·size·.08. Smooth nodes stay smooth, corners stay corners.
export function roughenContours(contours, { amount = 0.4, detail = 4, seed = 1 } = {}, size) {
  if (!(amount > 0)) return contours
  size ??= ((b) => (b ? Math.max(b.w, b.h) : 0))(boundsOf([{ contours }]))
  if (!(size > 0)) return contours
  const maxLen = size / (3 + 4 * detail), amp = amount * size * 0.08
  return contours.map((c, ci) => {
    const rand = rng(seed + 7919 * ci), s = subdivide(c, maxLen), m = s.nodes.length
    const nodes = s.nodes.map((n, i) => {
      const a = s.nodes[s.closed ? (i + m - 1) % m : Math.max(i - 1, 0)], b = s.nodes[s.closed ? (i + 1) % m : Math.min(i + 1, m - 1)]
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty), u = (2 * rand() - 1) * amp
      const d = tl > 1e-9 ? pt((-ty / tl) * u, (tx / tl) * u) : pt(0, 0)
      return { x: n.x + d.x, y: n.y + d.y, hi: shift(n.hi, d), ho: shift(n.ho, d) }
    })
    const was = s.nodes.map(isSmooth)
    return smoothSet({ ...s, nodes }, (_, i) => was[i])
  })
}

// ---- Bend ----

// Drag the point at t on a segment by delta: the two handles move so that B(t) shifts by exactly delta.
export function bendSegment(c, seg, t, delta) {
  if (seg < 0 || seg >= segmentCount(c)) return c
  t = clamp(t, 0.15, 0.85)
  const j = (seg + 1) % c.nodes.length
  let [p0, p1, p2, p3] = segmentCubic(c, seg)
  if (!c.nodes[seg].ho && !c.nodes[j].hi) { p1 = lerp(p0, p3, 1 / 3); p2 = lerp(p0, p3, 2 / 3) }
  const u = 1 - t, k = 1 / (3 * t * u * (u * u + t * t)) // B(t) moves by 3u²t·(k·u·δ) + 3ut²·(k·t·δ) = δ
  const out = moveHandle(c, seg, 'ho', add(p1, delta, k * u)) // mirror keeps a smooth end node smooth
  return moveHandle(out, j, 'hi', add(p2, delta, k * t))
}

// ---- Push ----

// Smudge: anchors and handles within `radius` of center follow delta, weighted by (1 − s²)² · strength.
export function pushContours(contours, center, delta, radius, strength) {
  if (!(radius > 0) || !(strength > 0) || (!delta.x && !delta.y)) return contours
  const reach = (4 * radius) / 3, step = radius / 3
  // Segments near the brush that are longer than radius/3 are cut into pieces of at most .75 of that, so a
  // second push over the same spot (which stretches them a little) finds them still short enough.
  const split = (s) => {
    const xs = s.map((p) => p.x), ys = s.map((p) => p.y)
    return center.x >= Math.min(...xs) - reach && center.x <= Math.max(...xs) + reach &&
      center.y >= Math.min(...ys) - reach && center.y <= Math.max(...ys) + reach && approxLen(s) > step
  }
  const pull = (p) => {
    const s = p && dist(p, center) / radius
    return p && s < 1 ? add(p, delta, strength * (1 - s * s) ** 2) : p
  }
  let count = contours.reduce((n, c) => n + c.nodes.length, 0)
  const out = contours.map((c) => {
    const s = subdivide(c, step * 0.75, { only: split, smoothNew: true, cap: c.nodes.length + Math.max(0, MAX_NODES - count) })
    count += s.nodes.length - c.nodes.length
    let moved = false
    const nodes = s.nodes.map((n) => {
      const a = pull(n), hi = pull(n.hi), ho = pull(n.ho)
      if (a === n && hi === n.hi && ho === n.ho) return n
      moved = true
      return { x: a.x, y: a.y, hi, ho }
    })
    return moved ? { ...s, nodes } : c
  })
  return out.some((c, i) => c !== contours[i]) ? out : contours
}

// ---- Distort ----

// Convex means every turn goes the same way; a bow-tie or a flat quad fails.
export function isConvexQuad(q) {
  if (!Array.isArray(q) || q.length !== 4 || q.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  const cross = q.map((p, i) => {
    const a = q[(i + 1) % 4], b = q[(i + 2) % 4]
    return (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)
  })
  return cross.every((v) => v > 1e-9) || cross.every((v) => v < -1e-9)
}

// Projective map of rect onto quad = [TL, TR, BR, BL] (Heckbert's unit-square-to-quad coefficients),
// applied to anchors and handles. A parallelogram quad reduces to an affine map.
export function distortContours(contours, rect, quad) {
  if (!(rect.w > 0) || !(rect.h > 0) || !isConvexQuad(quad)) return contours
  const [p0, p1, p2, p3] = quad
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0, h = 0
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dy1 * dx2
    g = (dx3 * dy2 - dy3 * dx2) / den
    h = (dx1 * dy3 - dy1 * dx3) / den
  }
  const a = p1.x - p0.x + g * p1.x, b = p1.y - p0.y + g * p1.y, c = p3.x - p0.x + h * p3.x, d = p3.y - p0.y + h * p3.y
  const map = (q) => {
    const u = (q.x - rect.x) / rect.w, v = (q.y - rect.y) / rect.h, w = 1 / (g * u + h * v + 1)
    return pt((a * u + c * v + p0.x) * w, (b * u + d * v + p0.y) * w)
  }
  return contours.map((ct) => ({ ...ct, nodes: ct.nodes.map((n) => ({ ...map(n), hi: n.hi && map(n.hi), ho: n.ho && map(n.ho) })) }))
}

// ---- Ink ----

// A closed outline polygon around a stroke of {x, y, t?, p?} samples. Width follows pen pressure when it varies,
// otherwise it thins with speed; the ends taper with a smoothstep and get round caps.
export function inkOutline(samples, { size = 16, thinning = 0.5, taper = 0.5, streamline = 0.5 } = {}) {
  const R = size / 2, kept = samples.filter((s, i) => !i || dist(s, samples[i - 1]) > 1e-9), raw = []
  kept.forEach((s, i) => { // sparse samples (fast strokes) get in-betweens, so tapers and caps have points to work on
    const prev = kept[i - 1]
    for (let k = 1, n = prev ? Math.max(Math.ceil(dist(prev, s) / (R / 2)), kept.length < 3 ? 2 : 1) : 0; k < n; k++) {
      const f = k / n, mix = (a, b) => a + (b - a) * f
      raw.push({ x: mix(prev.x, s.x), y: mix(prev.y, s.y), t: mix(prev.t, s.t), p: mix(prev.p, s.p) })
    }
    raw.push(s)
  })
  const m = raw.length
  if (!m) return []
  if (m < 2) return Array.from({ length: 16 }, (_, k) => pt(raw[0].x + R * Math.cos((TAU * k) / 16), raw[0].y + R * Math.sin((TAU * k) / 16)))
  const keep = 1 - 0.85 * streamline, pts = [raw[0]]
  for (let i = 1; i < m - 1; i++) pts.push(lerp(pts[i - 1], raw[i], keep))
  pts.push(raw[m - 1]) // the stroke always ends where the pointer did
  const known = raw.map((s) => s.p).filter(Number.isFinite)
  const byPen = known.length > 0 && known.reduce((a, v) => Math.max(a, v), -Infinity) - known.reduce((a, v) => Math.min(a, v), Infinity) > 0.05
  const arc = [0]
  for (let i = 1; i < m; i++) arc.push(arc[i - 1] + dist(pts[i], pts[i - 1]))
  const L = arc[m - 1], span = taper * Math.min(L / 2, 6 * size)
  let pr = 1, tan = pt(1, 0)
  const left = [], right = [], ends = []
  for (let i = 0; i < m; i++) {
    let target = raw[i].p
    if (!byPen) {
      const j = Math.max(i, 1), dt = raw[j].t - raw[j - 1].t
      target = 1 - clamp(dist(raw[j], raw[j - 1]) / (dt > 0 ? dt : 16) / (0.1 * size), 0, 1)
    } else if (!Number.isFinite(target)) target = pr
    pr = i ? pr + (target - pr) * 0.25 : target
    let r = Math.max(0.05 * size, R * (1 - thinning * (1 - pr)))
    const f = span > 0 ? Math.min(arc[i], L - arc[i]) / span : 1
    if (f < 1) r *= f * f * (3 - 2 * f)
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, m - 1)], tl = dist(a, b)
    if (tl > 1e-9) tan = pt((b.x - a.x) / tl, (b.y - a.y) / tl)
    const n = pt(-tan.y, tan.x)
    left.push(add(pts[i], n, r))
    right.push(add(pts[i], n, -r))
    ends.push({ p: pts[i], n, t: tan, r })
  }
  const cap = (e, dir) => Array.from({ length: 7 }, (_, k) => {
    const a = ((k + 1) * Math.PI) / 8 // 7 points round the half-circle between the two sides
    return pt(e.p.x + e.r * (dir * e.n.x * Math.cos(a) + dir * e.t.x * Math.sin(a)), e.p.y + e.r * (dir * e.n.y * Math.cos(a) + dir * e.t.y * Math.sin(a)))
  })
  const poly = [...left, ...cap(ends[m - 1], 1), ...right.reverse(), ...cap(ends[0], -1)]
  return poly.filter((p, i) => dist(p, poly[(i + poly.length - 1) % poly.length]) > 1e-9)
}
