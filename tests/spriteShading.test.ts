// Phase 6B — sprite render quality: distance shading + bright/fullbright + fuzz.
// Locks in that non-bright billboards darken with depth (like the walls) while
// bright/light-amp frames ignore distance, and that the fuzz dither is a stable,
// deterministic screen-coord checkerboard. Pure + headless — no DOM, no RNG.

import { describe, expect, it } from 'vitest'
import type { Framebuffer, Texture } from '~/doom/types'
import { FOG_DISTANCE, MIN_SHADE } from '~/doom/config'
import { fogIntensity } from '~/doom/core/color'
import { createFramebuffer, paintColumn } from '~/doom/engine/framebuffer'
import { spriteIntensity } from '~/doom/engine/sprites'

/** A solid 1×1 opaque white texel — the simplest paintable column source. */
function whiteTexel(): Texture {
  return { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
}

/** Red channel of pixel (x, y) in a framebuffer. */
function red(fb: Framebuffer, x: number, y: number): number {
  return fb.data[(y * fb.width + x) * 4] ?? 0
}

describe('spriteIntensity', () => {
  it('darkens a non-bright sprite as depth grows', () => {
    const near = spriteIntensity(1, false, false)
    const far = spriteIntensity(FOG_DISTANCE - 1, false, false)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThanOrEqual(MIN_SHADE)
  })

  it('matches the wall fog falloff for ordinary frames', () => {
    expect(spriteIntensity(3, false, false)).toBe(fogIntensity(3))
  })

  it('keeps a bright frame at full intensity regardless of distance', () => {
    expect(spriteIntensity(0.1, true, false)).toBe(1)
    expect(spriteIntensity(FOG_DISTANCE * 4, true, false)).toBe(1)
  })

  it('keeps every frame at full intensity under the light-amp powerup', () => {
    expect(spriteIntensity(FOG_DISTANCE * 4, false, true)).toBe(1)
  })
})

describe('paintColumn distance shading', () => {
  it('paints a distant non-bright column darker than a near one', () => {
    const tex = whiteTexel()
    const near = createFramebuffer(2, 4)
    const far = createFramebuffer(2, 4)

    const nearI = spriteIntensity(1, false, false)
    const farI = spriteIntensity(FOG_DISTANCE - 1, false, false)
    paintColumn(near, 0, 0, 3, 0, 4, tex, 0, nearI, true)
    paintColumn(far, 0, 0, 3, 0, 4, tex, 0, farI, true)

    expect(red(near, 0, 1)).toBeGreaterThan(red(far, 0, 1))
  })

  it('paints a bright column at full brightness no matter the distance', () => {
    const tex = whiteTexel()
    const fb = createFramebuffer(2, 4)
    const brightI = spriteIntensity(FOG_DISTANCE * 4, true, false)
    paintColumn(fb, 0, 0, 3, 0, 4, tex, 0, brightI, true)
    expect(red(fb, 0, 1)).toBe(255)
  })
})

describe('paintColumn fuzz dither', () => {
  it('drops every other row deterministically by screen coordinate', () => {
    const tex = whiteTexel()
    const fb = createFramebuffer(2, 4)
    // Column 0: fuzz hides rows where (0 + y) is even → rows 0 and 2 stay black.
    paintColumn(fb, 0, 0, 3, 0, 4, tex, 0, 1, true, true)
    expect(red(fb, 0, 0)).toBe(0)
    expect(red(fb, 0, 1)).toBe(255)
    expect(red(fb, 0, 2)).toBe(0)
    expect(red(fb, 0, 3)).toBe(255)
  })

  it('flips the checkerboard parity on the neighbouring column', () => {
    const tex = whiteTexel()
    const fb = createFramebuffer(2, 4)
    // Column 1: (1 + y) even on odd rows → rows 1 and 3 are hidden instead.
    paintColumn(fb, 1, 0, 3, 0, 4, tex, 0, 1, true, true)
    expect(red(fb, 1, 0)).toBe(255)
    expect(red(fb, 1, 1)).toBe(0)
    expect(red(fb, 1, 2)).toBe(255)
    expect(red(fb, 1, 3)).toBe(0)
  })
})
