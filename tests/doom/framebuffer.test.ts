import { describe, expect, it } from 'vitest'
import { createFramebuffer, fillRect, paintColumn, setPixel } from '~/doom/engine/framebuffer'
import type { Rgb } from '~/doom/core/color'
import { createTexture, fillTexture } from '~/doom/engine/texture'

const WHITE: Rgb = [255, 255, 255]
const RED: Rgb = [200, 30, 40]

/** Read the RGBA quad at (x, y) as a plain number tuple. */
function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const o = (y * width + x) * 4
  return [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, data[o + 3] ?? 0]
}

describe('framebuffer', () => {
  describe('createFramebuffer', () => {
    it('sizes data to width * height * 4 and zero-fills it', () => {
      const fb = createFramebuffer(8, 5)
      expect(fb.width).toBe(8)
      expect(fb.height).toBe(5)
      expect(fb.data).toBeInstanceOf(Uint8ClampedArray)
      expect(fb.data.length).toBe(8 * 5 * 4)
      expect(Array.from(fb.data).every(v => v === 0)).toBe(true)
    })
  })

  describe('setPixel', () => {
    it('writes an opaque RGBA quad at the target coordinate', () => {
      const fb = createFramebuffer(4, 4)
      setPixel(fb, 2, 1, RED)
      expect(pixelAt(fb.data, 4, 2, 1)).toEqual([200, 30, 40, 255])
    })

    it('ignores out-of-bounds coordinates without throwing', () => {
      const fb = createFramebuffer(4, 4)
      setPixel(fb, -1, 0, WHITE)
      setPixel(fb, 0, -1, WHITE)
      setPixel(fb, 4, 0, WHITE)
      setPixel(fb, 0, 4, WHITE)
      expect(Array.from(fb.data).every(v => v === 0)).toBe(true)
    })

    it('alpha-blends a half-transparent pixel over the existing one', () => {
      const fb = createFramebuffer(2, 2)
      setPixel(fb, 0, 0, [0, 0, 0]) // opaque black base
      setPixel(fb, 0, 0, [255, 255, 255], 128) // ~50% white over black
      const [r, g, b, a] = pixelAt(fb.data, 2, 0, 0)
      expect(a).toBe(255)
      expect(r).toBeGreaterThan(120)
      expect(r).toBeLessThan(135)
      expect(g).toBe(r)
      expect(b).toBe(r)
    })

    it('is a no-op at alpha 0', () => {
      const fb = createFramebuffer(2, 2)
      setPixel(fb, 1, 1, WHITE, 0)
      expect(pixelAt(fb.data, 2, 1, 1)).toEqual([0, 0, 0, 0])
    })
  })

  describe('fillRect', () => {
    it('fills the requested region and leaves the rest untouched', () => {
      const fb = createFramebuffer(6, 6)
      fillRect(fb, 1, 2, 3, 2, RED)
      // Inside the rect.
      expect(pixelAt(fb.data, 6, 1, 2)).toEqual([200, 30, 40, 255])
      expect(pixelAt(fb.data, 6, 3, 3)).toEqual([200, 30, 40, 255])
      // Just outside the rect stays zeroed.
      expect(pixelAt(fb.data, 6, 0, 2)).toEqual([0, 0, 0, 0])
      expect(pixelAt(fb.data, 6, 4, 2)).toEqual([0, 0, 0, 0])
      expect(pixelAt(fb.data, 6, 1, 4)).toEqual([0, 0, 0, 0])
    })

    it('clips a rectangle that overruns the buffer edge', () => {
      const fb = createFramebuffer(4, 4)
      // Should not throw and should fill only the in-bounds part.
      fillRect(fb, 2, 2, 10, 10, WHITE)
      expect(pixelAt(fb.data, 4, 3, 3)).toEqual([255, 255, 255, 255])
      expect(pixelAt(fb.data, 4, 1, 1)).toEqual([0, 0, 0, 0])
    })
  })

  describe('paintColumn', () => {
    it('writes opaque texels across the clipped y-range, inclusive of the last row', () => {
      const fb = createFramebuffer(8, 10)
      const tex = createTexture(4, 4)
      fillTexture(tex, WHITE)
      // drawEnd (6) is the INCLUSIVE last row, so rows 2..6 are painted.
      paintColumn(fb, 3, 2, 6, 2, 4, tex, 0, 1, false)
      // Inside the painted span (inclusive of drawEnd).
      for (let y = 2; y <= 6; y++) {
        const px = pixelAt(fb.data, 8, 3, y)
        expect(px).toEqual([255, 255, 255, 255])
      }
      // Rows just above the span and just past the inclusive end are untouched.
      expect(pixelAt(fb.data, 8, 3, 1)).toEqual([0, 0, 0, 0])
      expect(pixelAt(fb.data, 8, 3, 7)).toEqual([0, 0, 0, 0])
    })

    it('clamps the visible range to [0, height) and leaves clipped-out rows untouched', () => {
      const fb = createFramebuffer(4, 6)
      const tex = createTexture(2, 8)
      fillTexture(tex, WHITE)
      // Projected span overruns both ends; only rows 0..5 may be written.
      paintColumn(fb, 1, -4, 12, -4, 16, tex, 0, 1, false)
      for (let y = 0; y < 6; y++) {
        expect(pixelAt(fb.data, 4, 1, y)[3]).toBe(255)
      }
      // Neighbouring columns must remain blank — the strip writes one column only.
      for (let y = 0; y < 6; y++) {
        expect(pixelAt(fb.data, 4, 0, y)).toEqual([0, 0, 0, 0])
        expect(pixelAt(fb.data, 4, 2, y)).toEqual([0, 0, 0, 0])
      }
    })

    it('skips transparent texels when alphaTest is on', () => {
      const fb = createFramebuffer(4, 4)
      const tex = createTexture(1, 1) // single fully-transparent texel (alpha 0)
      paintColumn(fb, 2, 0, 4, 0, 4, tex, 0, 1, true)
      for (let y = 0; y < 4; y++) {
        expect(pixelAt(fb.data, 4, 2, y)).toEqual([0, 0, 0, 0])
      }
    })

    it('ignores off-buffer columns and non-positive spans', () => {
      const fb = createFramebuffer(4, 4)
      const tex = createTexture(2, 2)
      fillTexture(tex, WHITE)
      paintColumn(fb, -1, 0, 4, 0, 4, tex, 0, 1, false)
      paintColumn(fb, 4, 0, 4, 0, 4, tex, 0, 1, false)
      paintColumn(fb, 1, 0, 4, 0, 0, tex, 0, 1, false) // spanHeight <= 0
      expect(Array.from(fb.data).every(v => v === 0)).toBe(true)
    })

    it('shades the written texels by the intensity multiplier', () => {
      const fb = createFramebuffer(2, 4)
      const tex = createTexture(1, 4)
      fillTexture(tex, [200, 200, 200])
      paintColumn(fb, 0, 0, 4, 0, 4, tex, 0, 0.5, false)
      const [r, g, b, a] = pixelAt(fb.data, 2, 0, 0)
      expect(a).toBe(255)
      expect(r).toBe(100)
      expect(g).toBe(100)
      expect(b).toBe(100)
    })
  })
})
