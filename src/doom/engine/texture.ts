// Texture create/write helpers. A texture is RGBA; alpha 0 marks transparent pixels.

import type { Texture } from '~/doom/types'
import type { Rgb } from '~/doom/core/color'
import { fillRgba } from '~/doom/core/color'

/** Allocate a zeroed (fully transparent) RGBA texture. */
export function createTexture(width: number, height: number): Texture {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }
}

/** Byte offset of pixel (x, y) in the texture's data. No bounds check — caller in-range. */
export function texelOffset(tex: Texture, x: number, y: number): number {
  return (y * tex.width + x) * 4
}

/** Write one texel. Out-of-range coordinates are ignored. Alpha defaults to fully opaque. */
export function setTexel(tex: Texture, x: number, y: number, c: Rgb, alpha = 255): void {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return
  const o = texelOffset(tex, x, y)
  tex.data[o] = c[0]
  tex.data[o + 1] = c[1]
  tex.data[o + 2] = c[2]
  tex.data[o + 3] = alpha
}

/** Flood the whole texture with a solid colour. Alpha defaults to fully opaque. */
export function fillTexture(tex: Texture, c: Rgb, alpha = 255): void {
  fillRgba(tex.data, c, alpha)
}
