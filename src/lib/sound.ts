/**
 * UI sound: short clicks synthesized with Web Audio, after the litt design
 * language (DESIGN.md, Sound). Nothing loads.
 *
 * The contract: callers fire and forget `play(name)`. It never throws, never
 * blocks, and does nothing before the viewer's first press or key (browsers
 * keep audio locked until then), while the tab is hidden or while muted.
 *
 * Every sound is a few milliseconds of filtered noise (the mechanism) and,
 * where it helps, a short sine or triangle (the body). One bus carries them
 * all: a conservative master level, a faint generated room for warmth, and a
 * compressor that keeps stacked sounds from clipping. Touch screens sit about
 * 2.5 dB lower: phone speakers are small, bright and close to the ear.
 *
 * Keys carry `data-sound="key" | "soft"`; the delegated listeners below give
 * them a press and a release, or a quiet tick, without a handler of their own.
 * `data-sound="off"` opts out for a control that plays its own sounds.
 */

import { useSyncExternalStore } from 'react'

export type SoundName =
  /** One detent. Fired rapidly while a slider moves; kept tiny. */
  | 'tick'
  /** The end of travel: a duller detent. */
  | 'bump'
  /** A key going down. */
  | 'press'
  /** The same key coming back up. */
  | 'release'
  /** Choosing: a firm click, then a rising confirm. */
  | 'select'
  /** A panel taking over: a click and air sweeping up. */
  | 'open'
  /** Leaving it: the sweep going down. */
  | 'close'
  /** A switch: two tiny clicks, the second lower. */
  | 'toggle'

export interface PlayOptions {
  /** Multiplies the base pitch, to vary a repeated sound. Default 1. */
  pitch?: number
  /** Multiplies the base gain, 0 to 1. Default 1. */
  gain?: number
}

/* Synthesis */

/** Master level: a tick peaks near −24 dBFS, a press near −18. */
const LEVEL = 0.5
/** Touch screens: about −2.5 dB. */
const TOUCH_TRIM = 0.75
/** Room send: warmth, not reverb. */
const WET = 0.07
const SILENT = 0.0001

let noise: AudioBuffer | null = null

/** One second of white noise, made once and read at random offsets. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noise
}

/** A small, dark room: 300ms of decaying stereo noise, low-passed. */
function roomBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.3)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    let lp = 0
    for (let i = 0; i < length; i++) {
      lp += 0.35 * (Math.random() * 2 - 1 - lp)
      data[i] = lp * Math.pow(1 - i / length, 4)
    }
  }
  return buffer
}

/** input → dry and a faint room → master level → compressor → speakers. */
function createBus(ctx: BaseAudioContext, level: number): GainNode {
  const input = ctx.createGain()
  const master = ctx.createGain()
  master.gain.value = level
  const room = ctx.createConvolver()
  room.buffer = roomBuffer(ctx)
  const wet = ctx.createGain()
  wet.gain.value = WET
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -14
  limiter.knee.value = 6
  limiter.ratio.value = 12
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  input.connect(master)
  input.connect(room).connect(wet).connect(master)
  master.connect(limiter).connect(ctx.destination)
  return input
}

interface NoiseLayer {
  at?: number
  filter: BiquadFilterType
  freq: number
  freqTo?: number
  q?: number
  peak: number
  attack?: number
  decay: number
}

interface ToneLayer {
  at?: number
  type?: OscillatorType
  freq: number
  freqTo?: number
  glide?: number
  peak: number
  attack?: number
  decay: number
}

/** One sounding event: a few layers on their own gain, every node let go when the last one ends. */
class Voice {
  private nodes: AudioNode[] = []
  private last: AudioScheduledSourceNode | null = null
  end = 0
  readonly output: GainNode
  private ctx: BaseAudioContext
  private t0: number
  private pitch: number

  constructor(ctx: BaseAudioContext, destination: AudioNode, t0: number, pitch: number, gain: number) {
    this.ctx = ctx
    this.t0 = t0
    this.pitch = pitch
    this.output = ctx.createGain()
    this.output.gain.value = gain
    this.output.connect(destination)
    this.nodes.push(this.output)
  }

  private envelope(start: number, peak: number, attack: number, decay: number) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(peak, start + attack)
    g.gain.exponentialRampToValueAtTime(SILENT, start + attack + decay)
    g.gain.setValueAtTime(0, start + attack + decay)
    this.nodes.push(g)
    return g
  }

  private schedule(source: AudioScheduledSourceNode, start: number, stop: number, offset?: number) {
    if (offset !== undefined && source instanceof AudioBufferSourceNode) source.start(start, offset)
    else source.start(start)
    source.stop(stop)
    this.nodes.push(source)
    if (stop - this.t0 >= this.end) {
      this.end = stop - this.t0
      this.last = source
    }
  }

  noise({ at = 0, filter, freq, freqTo, q = 1, peak, attack = 0.0004, decay }: NoiseLayer) {
    const start = this.t0 + at
    const buffer = noiseBuffer(this.ctx)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const f = this.ctx.createBiquadFilter()
    f.type = filter
    f.Q.value = q
    f.frequency.setValueAtTime(freq * this.pitch, start)
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo * this.pitch, start + attack + decay)
    this.nodes.push(f)
    src.connect(f).connect(this.envelope(start, peak, attack, decay)).connect(this.output)
    // A random offset, so repeated ticks never sound identical.
    this.schedule(src, start, start + attack + decay + 0.005, Math.random() * (buffer.duration - 0.3))
  }

  tone({ at = 0, type = 'sine', freq, freqTo, glide, peak, attack = 0.0008, decay }: ToneLayer) {
    const start = this.t0 + at
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq * this.pitch, start)
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(freqTo * this.pitch, start + (glide ?? attack + decay))
    osc.connect(this.envelope(start, peak, attack, decay)).connect(this.output)
    this.schedule(osc, start, start + attack + decay + 0.005)
  }

  done() {
    const nodes = this.nodes
    const cleanup = () => {
      for (const node of nodes) {
        try {
          node.disconnect()
        } catch {
          // Already let go.
        }
      }
    }
    if (this.last) this.last.onended = cleanup
    else cleanup()
    return this
  }
}

/** A short, bright contact click: the mechanism. */
function click(v: Voice, at: number, freq: number, peak: number, decay = 0.004) {
  v.noise({ at, filter: 'bandpass', freq, q: 1.2, peak, attack: 0.0003, decay })
}

const synths: Record<SoundName, (v: Voice) => void> = {
  // A detent: 4ms of band-passed noise and a 5ms falling blip.
  tick(v) {
    click(v, 0, 5200, 1.2, 0.005)
    v.tone({ freq: 2900, freqTo: 2400, peak: 0.16, attack: 0.0003, decay: 0.006 })
  },
  // The same detent hitting a stop: lower, softer, no sparkle.
  bump(v) {
    v.noise({ filter: 'lowpass', freq: 1400, q: 0.8, peak: 1.2, attack: 0.0006, decay: 0.009 })
    v.tone({ freq: 380, freqTo: 290, peak: 0.45, attack: 0.0008, decay: 0.02 })
  },
  // Key down: a low thock with a little body, and the contact.
  press(v) {
    v.noise({ filter: 'lowpass', freq: 1100, q: 0.9, peak: 1.1, attack: 0.0008, decay: 0.028 })
    v.tone({ freq: 175, freqTo: 105, glide: 0.03, peak: 0.6, attack: 0.001, decay: 0.045 })
    click(v, 0, 2800, 0.5, 0.003)
  },
  // Key up: lighter, higher, quieter.
  release(v) {
    click(v, 0, 3600, 0.9, 0.005)
    v.tone({ type: 'triangle', freq: 1100, freqTo: 900, peak: 0.08, decay: 0.01 })
    v.tone({ freq: 320, peak: 0.16, decay: 0.012 })
  },
  // Choosing: a firm click, then E6 and B6.
  select(v) {
    click(v, 0, 4200, 1.2, 0.004)
    v.tone({ freq: 240, freqTo: 160, peak: 0.45, decay: 0.025 })
    v.tone({ at: 0.012, freq: 1318.5, peak: 0.12, attack: 0.003, decay: 0.06 })
    v.tone({ at: 0.05, freq: 1975.5, peak: 0.09, attack: 0.003, decay: 0.08 })
  },
  // A panel taking over: a soft click, then air sweeping up.
  open(v) {
    click(v, 0, 3000, 0.6, 0.004)
    v.tone({ freq: 260, peak: 0.22, decay: 0.018 })
    v.noise({ filter: 'bandpass', freq: 500, freqTo: 4200, q: 0.8, peak: 0.3, attack: 0.07, decay: 0.12 })
  },
  // Letting it go: a soft click, then air sweeping down.
  close(v) {
    click(v, 0, 2600, 0.6, 0.004)
    v.tone({ freq: 220, peak: 0.22, decay: 0.018 })
    v.noise({ filter: 'bandpass', freq: 3800, freqTo: 450, q: 0.8, peak: 0.28, attack: 0.03, decay: 0.13 })
  },
  // A switch: two tiny clicks 16ms apart, the second lower.
  toggle(v) {
    click(v, 0, 4500, 0.9, 0.0035)
    v.tone({ freq: 700, peak: 0.12, decay: 0.006 })
    click(v, 0.016, 3000, 0.75, 0.004)
    v.tone({ at: 0.016, freq: 520, peak: 0.12, decay: 0.008 })
  },
}

/* Playback: one shared context, unlocked by the first gesture */

/** The least time between two of the same sound, in ms. Calls inside it are dropped, not queued. */
const MIN_GAP: Record<SoundName, number> = { tick: 14, bump: 40, press: 20, release: 20, select: 40, open: 80, close: 80, toggle: 40 }
const MAX_VOICES = 8

let ctx: AudioContext | null = null
let bus: GainNode | null = null
let gestured = false
let resumedAt = 0
const lastPlayed: Partial<Record<SoundName, number>> = {}
const voiceEnds: number[] = []

/** Sticky user activation: true once the viewer has pressed, clicked or typed. */
function hasActivation(): boolean {
  try {
    if (navigator.userActivation) return navigator.userActivation.hasBeenActive
  } catch {
    // Older browsers: the listeners below keep count.
  }
  return gestured
}

function isTouch(): boolean {
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches
  } catch {
    return false
  }
}

function context(): AudioContext | null {
  if (ctx) return ctx.state === 'closed' ? null : ctx
  if (!hasActivation()) return null
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    bus = createBus(ctx, LEVEL * (isTouch() ? TOUCH_TRIM : 1))
    noiseBuffer(ctx)
    resumedAt = performance.now()
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    return ctx
  } catch {
    ctx = null
    bus = null
    return null
  }
}

/** Whether the context can take a sound now. A suspended one is asked to resume, and sounds wait for it rather than pile up. */
function ready(ac: AudioContext): boolean {
  if (ac.state === 'running') return true
  if (ac.state === 'closed') return false
  const now = performance.now()
  if (now - resumedAt > 1000) {
    resumedAt = now
    ac.resume().catch(() => {})
  }
  return now - resumedAt < 250
}

/** Plays a UI sound. Does nothing before the first gesture, while hidden or while muted. */
export function play(name: SoundName, options?: PlayOptions): void {
  try {
    if (typeof window === 'undefined' || isMuted() || document.visibilityState === 'hidden') return
    const ac = context()
    if (!ac || !bus || !ready(ac)) return
    const now = performance.now()
    const last = lastPlayed[name]
    if (last !== undefined && now - last < MIN_GAP[name]) return
    const t = ac.currentTime
    while (voiceEnds.length && voiceEnds[0] <= t) voiceEnds.shift()
    if (voiceEnds.length >= MAX_VOICES) return
    lastPlayed[name] = now
    const pitch = clamp(options?.pitch ?? 1, 0.25, 4)
    const gain = clamp(options?.gain ?? 1, 0, 1)
    const voice = new Voice(ac, bus, t, pitch, gain)
    synths[name](voice)
    voice.done()
    const end = t + voice.end
    const i = voiceEnds.findIndex((e) => e > end)
    voiceEnds.splice(i === -1 ? voiceEnds.length : i, 0, end)
  } catch {
    // Sound is never worth an error.
  }
}

/* Mute: remembered per device, followed across tabs */

const MUTE_KEY = 'sound-muted'
let muted: boolean | null = null
const listeners = new Set<() => void>()

function readStoredMute(): boolean {
  try {
    const value = localStorage.getItem(MUTE_KEY)
    return value === '1' || value === 'true'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  if (typeof window === 'undefined') return false
  if (muted === null) muted = readStoredMute()
  return muted
}

export function setMuted(next: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    // Kept for this visit only.
  }
  if (next === muted) return
  muted = next
  for (const listener of [...listeners]) listener()
}

function subscribeMuted(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

/** Whether sound is muted, kept in step with the switch and other tabs. */
export function useMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, () => false)
}

/* Browser wiring: unlock on the first gesture, key sounds, tabs, visibility */

type KeyKind = 'key' | 'soft'

function soundTarget(target: EventTarget | null): { el: Element; kind: KeyKind } | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('[data-sound]')
  if (!el) return null
  const kind = el.getAttribute('data-sound')
  if (kind !== 'key' && kind !== 'soft') return null
  if (el.matches(":disabled, [aria-disabled='true']")) return null
  return { el, kind }
}

let pointerKey: number | null = null
let keyboardKey: string | null = null

function unlock() {
  gestured = true
  const ac = context()
  if (ac && ac.state !== 'running' && document.visibilityState !== 'hidden') ready(ac)
}

function onPointerDown(e: PointerEvent) {
  unlock()
  if (e.button !== 0) return
  const hit = soundTarget(e.target)
  if (!hit) return
  if (hit.kind === 'key') {
    play('press')
    pointerKey = e.pointerId
  } else {
    play('tick', { gain: 0.5, pitch: 0.92 })
  }
}

function onPointerUp(e: PointerEvent) {
  if (pointerKey === null || e.pointerId !== pointerKey) return
  pointerKey = null
  play('release', e.type === 'pointercancel' ? { gain: 0.5 } : undefined)
}

function onKeyDown(e: KeyboardEvent) {
  unlock()
  if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
  const hit = soundTarget(e.target)
  if (!hit) return
  // Space only presses buttons; Enter presses buttons and links.
  if (e.key === ' ' && hit.el.tagName !== 'BUTTON') return
  if (hit.kind === 'key') {
    play('press')
    keyboardKey = e.key
  } else {
    play('tick', { gain: 0.5, pitch: 0.92 })
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (keyboardKey === null || e.key !== keyboardKey) return
  keyboardKey = null
  play('release')
}

function onStorage(e: StorageEvent) {
  if (e.key !== MUTE_KEY && e.key !== null) return
  const next = readStoredMute()
  if (next === muted) return
  muted = next
  for (const listener of [...listeners]) listener()
}

function onVisibility() {
  // Let the audio device sleep while nobody can hear it.
  if (document.visibilityState === 'hidden' && ctx?.state === 'running') ctx.suspend().catch(() => {})
}

let installed = false

/** Adds the gesture, key, storage and visibility listeners, once. */
export function installSound(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const opts: AddEventListenerOptions = { capture: true, passive: true }
  window.addEventListener('pointerdown', onPointerDown, opts)
  window.addEventListener('pointerup', onPointerUp, opts)
  window.addEventListener('pointercancel', onPointerUp, opts)
  window.addEventListener('keydown', onKeyDown, opts)
  window.addEventListener('keyup', onKeyUp, opts)
  window.addEventListener('touchend', unlock, opts)
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 1
}
