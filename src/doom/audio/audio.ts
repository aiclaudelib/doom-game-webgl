// Web Audio host. Lazily creates a single AudioContext + gain graph and exposes
// it through null-safe getters. Everything is guarded so importing or constructing
// this under jsdom (no AudioContext) is a harmless no-op — nothing ever throws.

import type { Settings } from '~/doom/types'

/** Minimal window shape we read without pulling in lib.dom global `window` typing as `any`. */
interface AudioWindow {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

/** Resolve a usable AudioContext constructor, or null when the platform lacks one. */
function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') {
    return AudioContext
  }
  if (typeof window === 'undefined') {
    return null
  }
  const win = window as unknown as AudioWindow
  return win.webkitAudioContext ?? win.AudioContext ?? null
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private musicGain: GainNode | null = null

  constructor(settings: Settings) {
    const Ctor = resolveAudioContextCtor()
    if (Ctor === null) {
      return
    }
    try {
      const ctx = new Ctor()
      const master = ctx.createGain()
      const sfx = ctx.createGain()
      const music = ctx.createGain()
      master.connect(ctx.destination)
      sfx.connect(master)
      music.connect(master)
      this.ctx = ctx
      this.masterGain = master
      this.sfxGain = sfx
      this.musicGain = music
      this.setVolumes(settings)
    } catch {
      this.ctx = null
      this.masterGain = null
      this.sfxGain = null
      this.musicGain = null
    }
  }

  get ready(): boolean {
    return this.ctx !== null
  }

  get context(): AudioContext | null {
    return this.ctx
  }

  get sfxBus(): GainNode | null {
    return this.sfxGain
  }

  get musicBus(): GainNode | null {
    return this.musicGain
  }

  /** Resume a context suspended by autoplay policy. Safe to call repeatedly. */
  resume(): void {
    const ctx = this.ctx
    if (ctx?.state !== 'suspended') {
      return
    }
    void ctx.resume()
  }

  setVolumes(settings: Settings): void {
    const ctx = this.ctx
    if (ctx === null) {
      return
    }
    const now = ctx.currentTime
    this.masterGain?.gain.setValueAtTime(settings.masterVolume, now)
    this.sfxGain?.gain.setValueAtTime(settings.sfxVolume, now)
    this.musicGain?.gain.setValueAtTime(settings.musicVolume, now)
  }

  dispose(): void {
    const ctx = this.ctx
    if (ctx !== null && ctx.state !== 'closed') {
      void ctx.close()
    }
    this.ctx = null
    this.masterGain = null
    this.sfxGain = null
    this.musicGain = null
  }
}
