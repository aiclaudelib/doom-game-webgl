// Additive muzzle-flash blit: B2 contract. A bright texel ADDS toward white over the
// background; a transparent texel (alpha < 128) is culled and leaves the background intact.

import { describe, expect, it } from 'vitest'
import { blitTexture, blitTextureBright, clear, createFramebuffer } from '~/doom/engine/framebuffer'
import type { Rgb } from '~/doom/core/color'
import { createTexture } from '~/doom/engine/texture'

const MID_GREY: Rgb = [100, 100, 100]

/** Read the RGBA quad at (x, y). */
function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const o = (y * width + x) * 4
  return [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, data[o + 3] ?? 0]
}

/** One-texel texture with the given colour + alpha. */
function texel(r: number, g: number, b: number, a: number) {
  const tex = createTexture(1, 1)
  tex.data[0] = r
  tex.data[1] = g
  tex.data[2] = b
  tex.data[3] = a
  return tex
}

describe('blitTextureBright', () => {
  it('raises the background channels additively for an opaque bright texel', () => {
    const fb = createFramebuffer(4, 4)
    clear(fb, MID_GREY)
    blitTextureBright(fb, texel(80, 60, 40, 255), 1, 1, 1)
    const [r, g, b, a] = pixelAt(fb.data, 4, 1, 1)
    expect(r).toBe(180) // 100 + 80
    expect(g).toBe(160) // 100 + 60
    expect(b).toBe(140) // 100 + 40
    expect(a).toBe(255)
    // Every channel is strictly brighter than the mid-grey it sat on.
    expect(r).toBeGreaterThan(MID_GREY[0])
    expect(g).toBeGreaterThan(MID_GREY[1])
    expect(b).toBeGreaterThan(MID_GREY[2])
  })

  it('clamps the additive accumulation to 255 (white)', () => {
    const fb = createFramebuffer(4, 4)
    clear(fb, [200, 200, 200])
    blitTextureBright(fb, texel(200, 200, 200, 255), 0, 0, 1)
    expect(pixelAt(fb.data, 4, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('scales the added light by boost', () => {
    const fb = createFramebuffer(4, 4)
    clear(fb, MID_GREY)
    blitTextureBright(fb, texel(50, 50, 50, 255), 0, 0, 1, 2)
    const [r] = pixelAt(fb.data, 4, 0, 0)
    expect(r).toBe(200) // 100 + 50*2
  })

  it('leaves the background unchanged under a transparent texel (alpha < 128)', () => {
    const fb = createFramebuffer(4, 4)
    clear(fb, MID_GREY)
    blitTextureBright(fb, texel(255, 255, 255, 0), 1, 1, 1)
    expect(pixelAt(fb.data, 4, 1, 1)).toEqual([100, 100, 100, 255])
  })

  it('differs from blitTexture (overwrite) — additive vs replace over a background', () => {
    const over = createFramebuffer(4, 4)
    const add = createFramebuffer(4, 4)
    clear(over, MID_GREY)
    clear(add, MID_GREY)
    const t = texel(40, 40, 40, 255)
    blitTexture(over, t, 0, 0, 1)
    blitTextureBright(add, t, 0, 0, 1)
    // overwrite lands the source value; additive lands source + background.
    expect(pixelAt(over.data, 4, 0, 0)).toEqual([40, 40, 40, 255])
    expect(pixelAt(add.data, 4, 0, 0)).toEqual([140, 140, 140, 255])
  })
})
