// Procedural background music. A lookahead scheduler (setInterval) repeatedly queues
// the next slice of a looping pattern — a bass line plus an arpeggio — directly onto
// audio.musicBus, scheduled strictly off audio.context.currentTime (the only clock we
// have). No-op whenever the audio engine is unavailable (jsdom / no AudioContext).

import type { AudioEngine } from '~/doom/audio/audio'

export type MusicTrack = 'menu' | 'combat'

/** How far ahead (s) we schedule, and how often (ms) the timer wakes to refill. */
const LOOKAHEAD = 0.25
const TIMER_INTERVAL = 60

interface TrackConfig {
  readonly tempo: number // seconds per sixteenth-note step
  readonly bass: readonly number[] // frequencies per bar position
  readonly arp: readonly number[] // arpeggio frequencies cycled per step
  readonly bassGain: number
  readonly arpGain: number
}

const A2 = 110
const C3 = 130.81
const D3 = 146.83
const E3 = 164.81
const F3 = 174.61
const G3 = 196
const A3 = 220
const C4 = 261.63
const D4 = 293.66
const E4 = 329.63
const G4 = 392

const TRACKS: Readonly<Record<MusicTrack, TrackConfig>> = {
  menu: {
    tempo: 0.22,
    bass: [A2, A2, F3, F3, C3, C3, E3, E3],
    arp: [A3, C4, E4, C4, F3, A3, C4, A3, C3, E3, G3, E3, E3, G3, C4, G3],
    bassGain: 0.18,
    arpGain: 0.1,
  },
  combat: {
    tempo: 0.13,
    bass: [E3, E3, E3, G3, A2, A2, C3, D3],
    arp: [E4, G4, E4, D4, C4, D4, E4, G4, A3, C4, E4, D4, C4, A3, G3, E3],
    bassGain: 0.22,
    arpGain: 0.13,
  },
}

export class MusicPlayer {
  private readonly audio: AudioEngine
  private timer: ReturnType<typeof setInterval> | null = null
  private track: MusicTrack | null = null
  private nextStepTime = 0
  private step = 0
  private active: AudioScheduledSourceNode[] = []

  constructor(audio: AudioEngine) {
    this.audio = audio
  }

  play(track: MusicTrack): void {
    if (!this.audio.ready || typeof setInterval === 'undefined') {
      return
    }
    const ctx = this.audio.context
    if (ctx === null) {
      return
    }
    this.stop()
    this.track = track
    this.step = 0
    this.nextStepTime = ctx.currentTime + 0.05
    this.timer = setInterval(() => this.schedule(), TIMER_INTERVAL)
    this.schedule()
  }

  private schedule(): void {
    const ctx = this.audio.context
    const bus = this.audio.musicBus
    const track = this.track
    if (ctx === null || bus === null || track === null) {
      return
    }
    const cfg = TRACKS[track]
    const horizon = ctx.currentTime + LOOKAHEAD
    while (this.nextStepTime < horizon) {
      this.emitStep(ctx, bus, cfg, this.step, this.nextStepTime)
      this.nextStepTime += cfg.tempo
      this.step = (this.step + 1) % cfg.arp.length
    }
  }

  private emitStep(
    ctx: AudioContext,
    bus: GainNode,
    cfg: TrackConfig,
    step: number,
    time: number,
  ): void {
    // Bass advances once per two steps so it underpins the faster arpeggio.
    if (step % 2 === 0) {
      const bassIndex = (step / 2) % cfg.bass.length
      const bassFreq = cfg.bass[bassIndex] ?? cfg.bass[0] ?? A2
      this.voice(ctx, bus, 'triangle', bassFreq, cfg.tempo * 1.9, cfg.bassGain, time)
    }
    const arpFreq = cfg.arp[step] ?? cfg.arp[0] ?? A3
    this.voice(ctx, bus, 'square', arpFreq, cfg.tempo * 0.9, cfg.arpGain, time)
  }

  private voice(
    ctx: AudioContext,
    bus: GainNode,
    type: OscillatorType,
    freq: number,
    duration: number,
    peak: number,
    start: number,
  ): void {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    const gain = ctx.createGain()
    const stopAt = start + duration
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt)
    osc.connect(gain)
    gain.connect(bus)
    osc.start(start)
    osc.stop(stopAt)
    this.active.push(osc)
    osc.onended = () => {
      const idx = this.active.indexOf(osc)
      if (idx >= 0) {
        this.active.splice(idx, 1)
      }
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.track = null
    for (const node of this.active) {
      try {
        node.stop()
      } catch {
        // Already stopped or never started — safe to ignore.
      }
    }
    this.active = []
  }

  dispose(): void {
    this.stop()
  }
}
