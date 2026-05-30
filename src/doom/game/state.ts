// Settings + key bindings: factories and localStorage persistence (headless-safe).

import type { KeyBindings, Settings } from '~/doom/types'
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MOUSE_SENSITIVITY,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  STORAGE_KEY,
} from '~/doom/config'

/** Fresh default key bindings. Fire (Space) never collides with a movement key. */
export function defaultBindings(): KeyBindings {
  return {
    forward: 'KeyW',
    back: 'KeyS',
    turnLeft: 'ArrowLeft',
    turnRight: 'ArrowRight',
    strafeLeft: 'KeyA',
    strafeRight: 'KeyD',
    run: 'ShiftLeft',
    use: 'KeyE',
    fire: 'Space',
    weapon1: 'Digit1',
    weapon2: 'Digit2',
    weapon3: 'Digit3',
    weapon4: 'Digit4',
    weapon5: 'Digit5',
    weapon6: 'Digit6',
    weapon7: 'Digit7',
    weaponNext: 'BracketRight',
    weaponPrev: 'BracketLeft',
  }
}

/** Fresh default settings, pulling tuning from config. */
export function defaultSettings(): Settings {
  return {
    masterVolume: DEFAULT_MASTER_VOLUME,
    sfxVolume: DEFAULT_SFX_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
    mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
    mouseLook: false,
    bindings: defaultBindings(),
  }
}

/** Load persisted settings merged over defaults; never throws, defaults under jsdom. */
export function loadSettings(): Settings {
  const base = defaultSettings()
  if (typeof localStorage === 'undefined') {
    return base
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return base
    }
    const parsed: unknown = JSON.parse(raw)
    return mergeSettings(base, parsed)
  } catch {
    return base
  }
}

/** Persist settings; swallows quota/security errors and no-ops under jsdom. */
export function saveSettings(settings: Settings): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore — private mode / quota exceeded must not crash the game.
  }
}

function mergeSettings(base: Settings, raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) {
    return base
  }
  const src = raw as Record<string, unknown>
  return {
    masterVolume: numberOr(src.masterVolume, base.masterVolume),
    sfxVolume: numberOr(src.sfxVolume, base.sfxVolume),
    musicVolume: numberOr(src.musicVolume, base.musicVolume),
    mouseSensitivity: numberOr(src.mouseSensitivity, base.mouseSensitivity),
    mouseLook: typeof src.mouseLook === 'boolean' ? src.mouseLook : base.mouseLook,
    bindings: mergeBindings(base.bindings, src.bindings),
  }
}

function mergeBindings(base: KeyBindings, raw: unknown): KeyBindings {
  if (typeof raw !== 'object' || raw === null) {
    return base
  }
  const src = raw as Record<string, unknown>
  const merged: KeyBindings = { ...base }
  for (const key of Object.keys(base) as (keyof KeyBindings)[]) {
    const value = src[key]
    if (typeof value === 'string' && value.length > 0) {
      merged[key] = value
    }
  }
  return merged
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
