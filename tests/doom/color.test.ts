import { describe, expect, it } from 'vitest'
import { FOG_DISTANCE, MIN_SHADE } from '~/doom/config'
import { fogIntensity, mix, packShade, pal, shade } from '~/doom/core/color'
import type { Rgb } from '~/doom/core/color'

describe('color', () => {
  describe('shade', () => {
    it('darkens by multiplying each channel', () => {
      expect(shade([200, 100, 50], 0.5)).toEqual([100, 50, 25])
    })

    it('clamps each channel to the 0..255 byte range', () => {
      const c: Rgb = [200, 200, 200]
      const bright = shade(c, 10)
      expect(bright).toEqual([255, 255, 255])
      const dark = shade(c, -1)
      expect(dark).toEqual([0, 0, 0])
    })
  })

  describe('mix', () => {
    it('returns endpoint a at t=0 and endpoint b at t=1', () => {
      const a: Rgb = [0, 50, 100]
      const b: Rgb = [200, 150, 0]
      expect(mix(a, b, 0)).toEqual([...a])
      expect(mix(a, b, 1)).toEqual([...b])
    })

    it('interpolates linearly at the midpoint', () => {
      expect(mix([0, 0, 0], [100, 200, 80], 0.5)).toEqual([50, 100, 40])
    })
  })

  describe('fogIntensity', () => {
    it('is 1 at or before the camera', () => {
      expect(fogIntensity(0)).toBe(1)
      expect(fogIntensity(-2)).toBe(1)
    })

    it('reaches MIN_SHADE at and beyond FOG_DISTANCE', () => {
      expect(fogIntensity(FOG_DISTANCE)).toBe(MIN_SHADE)
      expect(fogIntensity(FOG_DISTANCE + 5)).toBe(MIN_SHADE)
    })

    it('decreases monotonically from 1 toward MIN_SHADE over the fog range', () => {
      let prev = fogIntensity(0)
      for (let d = 0.5; d <= FOG_DISTANCE; d += 0.5) {
        const cur = fogIntensity(d)
        expect(cur).toBeLessThanOrEqual(prev)
        expect(cur).toBeGreaterThanOrEqual(MIN_SHADE)
        expect(cur).toBeLessThanOrEqual(1)
        prev = cur
      }
    })
  })

  describe('packShade', () => {
    it('returns integer bytes within 0..255', () => {
      const out = packShade([200, 130, 17], 0.73)
      for (const ch of out) {
        expect(Number.isInteger(ch)).toBe(true)
        expect(ch).toBeGreaterThanOrEqual(0)
        expect(ch).toBeLessThanOrEqual(255)
      }
    })

    it('clamps an overdriven colour to 255', () => {
      expect(packShade([100, 100, 100], 100)).toEqual([255, 255, 255])
    })

    it('rounds rather than truncating', () => {
      // 10 * 0.55 = 5.5 -> rounds to 6.
      expect(packShade([10, 10, 10], 0.55)).toEqual([6, 6, 6])
    })
  })

  it('pal returns a palette colour tuple', () => {
    const red = pal('red')
    expect(red).toHaveLength(3)
    expect(red.every(ch => ch >= 0 && ch <= 255)).toBe(true)
  })
})
