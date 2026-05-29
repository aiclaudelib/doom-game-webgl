// Procedural sound effects. Every sound is synthesized from oscillators + a shared
// white-noise buffer, shaped by a single ADSR gain helper, and routed to audio.sfxBus.
// All nodes self-stop after their envelope so they get garbage-collected.

import type { AudioEngine } from '~/doom/audio/audio'

export type SfxName =
  | 'pistol'
  | 'shotgun'
  | 'chaingun'
  | 'fist'
  | 'door'
  | 'groan'
  | 'hurt'
  | 'pickup'
  | 'menuMove'
  | 'menuSelect'
  | 'enemyDie'
  | 'noAmmo'

/** One cached mono white-noise buffer per AudioContext, built once on first use. */
const noiseCache = new WeakMap<AudioContext, AudioBuffer>()

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx)
  if (cached !== undefined) {
    return cached
  }
  const length = Math.floor(ctx.sampleRate * 1.5)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const channel = buffer.getChannelData(0)
  // Deterministic noise (no Math.random) via a tiny LCG seeded constant — keeps
  // output stable across runs and avoids the global random helper.
  let state = 0x2545f491
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    channel[i] = (state / 0xffffffff) * 2 - 1
  }
  noiseCache.set(ctx, buffer)
  return buffer
}

interface Adsr {
  readonly attack: number
  readonly decay: number
  readonly sustain: number
  readonly release: number
  readonly peak: number
}

/**
 * Build a gain node carrying an ADSR envelope starting at `start`, returning the
 * node plus the time at which it (and anything routed through it) should stop.
 */
function envelope(
  ctx: AudioContext,
  start: number,
  hold: number,
  adsr: Adsr,
): {
  readonly gain: GainNode
  readonly stopAt: number
} {
  const gain = ctx.createGain()
  const g = gain.gain
  const sustainLevel = adsr.peak * adsr.sustain
  const attackEnd = start + adsr.attack
  const decayEnd = attackEnd + adsr.decay
  const releaseStart = Math.max(decayEnd, start + hold)
  const stopAt = releaseStart + adsr.release
  g.setValueAtTime(0.0001, start)
  g.exponentialRampToValueAtTime(Math.max(adsr.peak, 0.0001), attackEnd)
  g.exponentialRampToValueAtTime(Math.max(sustainLevel, 0.0001), decayEnd)
  g.setValueAtTime(Math.max(sustainLevel, 0.0001), releaseStart)
  g.exponentialRampToValueAtTime(0.0001, stopAt)
  return { gain, stopAt }
}

/** Connect a freshly built source through an envelope to the bus and auto-stop it. */
function play(
  bus: GainNode,
  source: AudioScheduledSourceNode,
  pre: AudioNode,
  tail: AudioNode,
  start: number,
  stopAt: number,
): void {
  tail.connect(bus)
  source.connect(pre)
  source.start(start)
  source.stop(stopAt)
}

/** A short white-noise voice through a lowpass — the core of every gun sound. */
function noiseVoice(
  ctx: AudioContext,
  bus: GainNode,
  start: number,
  hold: number,
  cutoff: number,
  adsr: Adsr,
): void {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(cutoff, start)
  const env = envelope(ctx, start, hold, adsr)
  filter.connect(env.gain)
  play(bus, src, filter, env.gain, start, env.stopAt)
}

/** A pitched oscillator voice with an optional frequency glide. */
function oscVoice(
  ctx: AudioContext,
  bus: GainNode,
  type: OscillatorType,
  fromFreq: number,
  toFreq: number,
  detune: number,
  start: number,
  hold: number,
  adsr: Adsr,
): void {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.detune.setValueAtTime(detune, start)
  osc.frequency.setValueAtTime(fromFreq, start)
  if (toFreq !== fromFreq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 1), start + Math.max(hold, 0.01))
  }
  const env = envelope(ctx, start, hold, adsr)
  play(bus, osc, env.gain, env.gain, start, env.stopAt)
}

const GUN_ADSR: Adsr = { attack: 0.001, decay: 0.04, sustain: 0.2, release: 0.05, peak: 0.9 }
const THUMP_ADSR: Adsr = { attack: 0.002, decay: 0.08, sustain: 0.1, release: 0.06, peak: 0.8 }
const BLIP_ADSR: Adsr = { attack: 0.005, decay: 0.05, sustain: 0.4, release: 0.06, peak: 0.5 }
const DOOR_OSC_ADSR: Adsr = { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.2, peak: 0.35 }
const DOOR_NOISE_ADSR: Adsr = { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.2, peak: 0.2 }
const GROAN_ADSR: Adsr = { attack: 0.03, decay: 0.1, sustain: 0.6, release: 0.15, peak: 0.45 }
const GROAN_NOISE_ADSR: Adsr = {
  attack: 0.04,
  decay: 0.15,
  sustain: 0.3,
  release: 0.15,
  peak: 0.18,
}
const DIE_ADSR: Adsr = { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.25, peak: 0.5 }
const DIE_NOISE_ADSR: Adsr = { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2, peak: 0.3 }
const HURT_ADSR: Adsr = { attack: 0.002, decay: 0.08, sustain: 0.4, release: 0.08, peak: 0.5 }
const TICK_ADSR: Adsr = { attack: 0.002, decay: 0.03, sustain: 0.2, release: 0.03, peak: 0.3 }
const CLICK_ADSR: Adsr = { attack: 0.002, decay: 0.04, sustain: 0.1, release: 0.04, peak: 0.35 }

/** A pair of slightly mistuned saw oscillators — the chorus behind monster vocals. */
function detunedPair(
  ctx: AudioContext,
  bus: GainNode,
  from: number,
  to: number,
  spread: number,
  start: number,
  hold: number,
  adsr: Adsr,
): void {
  oscVoice(ctx, bus, 'sawtooth', from, to, -spread, start, hold, adsr)
  oscVoice(ctx, bus, 'sawtooth', from + 2, to + 2, spread, start, hold, adsr)
}

function synth(ctx: AudioContext, bus: GainNode, name: SfxName, now: number): void {
  switch (name) {
    case 'pistol': {
      noiseVoice(ctx, bus, now, 0.04, 2200, GUN_ADSR)
      oscVoice(ctx, bus, 'square', 320, 120, 0, now, 0.03, GUN_ADSR)
      break
    }
    case 'chaingun': {
      noiseVoice(ctx, bus, now, 0.03, 2600, GUN_ADSR)
      oscVoice(ctx, bus, 'square', 380, 160, 0, now, 0.025, GUN_ADSR)
      break
    }
    case 'shotgun': {
      noiseVoice(ctx, bus, now, 0.12, 1600, { ...GUN_ADSR, decay: 0.1, release: 0.12, peak: 1 })
      oscVoice(ctx, bus, 'sine', 120, 50, 0, now, 0.14, THUMP_ADSR)
      break
    }
    case 'fist': {
      oscVoice(ctx, bus, 'sine', 180, 70, 0, now, 0.06, THUMP_ADSR)
      noiseVoice(ctx, bus, now, 0.03, 800, { ...GUN_ADSR, peak: 0.4 })
      break
    }
    case 'door': {
      oscVoice(ctx, bus, 'sawtooth', 90, 200, 0, now, 0.5, DOOR_OSC_ADSR)
      noiseVoice(ctx, bus, now, 0.5, 600, DOOR_NOISE_ADSR)
      break
    }
    case 'groan': {
      detunedPair(ctx, bus, 140, 90, 20, now, 0.35, GROAN_ADSR)
      noiseVoice(ctx, bus, now, 0.3, 900, GROAN_NOISE_ADSR)
      break
    }
    case 'enemyDie': {
      detunedPair(ctx, bus, 220, 60, 22, now, 0.4, DIE_ADSR)
      noiseVoice(ctx, bus, now, 0.35, 1200, DIE_NOISE_ADSR)
      break
    }
    case 'hurt': {
      oscVoice(ctx, bus, 'square', 420, 160, 0, now, 0.18, HURT_ADSR)
      break
    }
    case 'pickup': {
      oscVoice(ctx, bus, 'square', 660, 990, 0, now, 0.08, BLIP_ADSR)
      break
    }
    case 'menuSelect': {
      oscVoice(ctx, bus, 'square', 740, 1110, 0, now, 0.07, BLIP_ADSR)
      break
    }
    case 'menuMove': {
      oscVoice(ctx, bus, 'triangle', 520, 520, 0, now, 0.03, TICK_ADSR)
      break
    }
    case 'noAmmo': {
      oscVoice(ctx, bus, 'square', 160, 120, 0, now, 0.05, CLICK_ADSR)
      break
    }
  }
}

export function playSfx(audio: AudioEngine, name: SfxName): void {
  if (!audio.ready) {
    return
  }
  const ctx = audio.context
  const bus = audio.sfxBus
  if (ctx === null || bus === null) {
    return
  }
  synth(ctx, bus, name, ctx.currentTime)
}
