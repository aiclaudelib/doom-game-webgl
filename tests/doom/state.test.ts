import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MASTER_VOLUME, DEFAULT_MOUSE_SENSITIVITY, STORAGE_KEY } from '~/doom/config'
import type { Settings } from '~/doom/types'
import { defaultBindings, defaultSettings, loadSettings, saveSettings } from '~/doom/game/state'

describe('state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('defaultBindings', () => {
    it('returns the documented default key codes', () => {
      const b = defaultBindings()
      expect(b.forward).toBe('KeyW')
      expect(b.back).toBe('KeyS')
      expect(b.fire).toBe('Space')
      // Fire must not collide with a movement key.
      const movement = [b.forward, b.back, b.strafeLeft, b.strafeRight]
      expect(movement).not.toContain(b.fire)
    })

    it('returns a fresh object each call', () => {
      expect(defaultBindings()).not.toBe(defaultBindings())
      expect(defaultBindings()).toEqual(defaultBindings())
    })
  })

  describe('defaultSettings', () => {
    it('pulls tuning defaults from config', () => {
      const s = defaultSettings()
      expect(s.masterVolume).toBe(DEFAULT_MASTER_VOLUME)
      expect(s.mouseSensitivity).toBe(DEFAULT_MOUSE_SENSITIVITY)
      expect(s.mouseLook).toBe(false)
      expect(s.bindings).toEqual(defaultBindings())
    })
  })

  describe('loadSettings', () => {
    it('returns defaults when nothing is persisted', () => {
      expect(loadSettings()).toEqual(defaultSettings())
    })

    it('round-trips saved settings back through load', () => {
      const custom: Settings = {
        ...defaultSettings(),
        masterVolume: 0.3,
        sfxVolume: 0.1,
        mouseLook: true,
        bindings: { ...defaultBindings(), forward: 'KeyI', fire: 'KeyJ' },
      }
      saveSettings(custom)
      const loaded = loadSettings()
      expect(loaded.masterVolume).toBe(0.3)
      expect(loaded.sfxVolume).toBe(0.1)
      expect(loaded.mouseLook).toBe(true)
      expect(loaded.bindings.forward).toBe('KeyI')
      expect(loaded.bindings.fire).toBe('KeyJ')
    })

    it('merges partial persisted data over defaults', () => {
      // Only one field stored — the rest must fall back to defaults.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicVolume: 0.42 }))
      const loaded = loadSettings()
      expect(loaded.musicVolume).toBe(0.42)
      expect(loaded.masterVolume).toBe(DEFAULT_MASTER_VOLUME)
      expect(loaded.bindings).toEqual(defaultBindings())
    })

    it('ignores non-numeric / malformed fields and keeps defaults', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ masterVolume: 'loud', mouseLook: 'yes', bindings: 12 }),
      )
      const loaded = loadSettings()
      expect(loaded.masterVolume).toBe(DEFAULT_MASTER_VOLUME)
      expect(loaded.mouseLook).toBe(false)
      expect(loaded.bindings).toEqual(defaultBindings())
    })

    it('falls back to defaults on corrupt JSON without throwing', () => {
      localStorage.setItem(STORAGE_KEY, '{ not valid json')
      expect(() => loadSettings()).not.toThrow()
      expect(loadSettings()).toEqual(defaultSettings())
    })
  })

  describe('saveSettings', () => {
    it('persists under the configured storage key', () => {
      const s = defaultSettings()
      s.masterVolume = 0.55
      saveSettings(s)
      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw ?? '{}') as Settings
      expect(parsed.masterVolume).toBe(0.55)
    })
  })
})
