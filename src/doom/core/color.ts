// RGB color helpers: palette lookup, shading, mixing, distance fog. Pure leaf.

import { FOG_DISTANCE, MIN_SHADE, PALETTE } from '~/doom/config'
import type { PaletteName } from '~/doom/config'
import { clamp, lerp } from '~/doom/core/math'

export type Rgb = readonly [number, number, number]

export function rgb(r: number, g: number, b: number): Rgb {
  return [r, g, b]
}

export function pal(name: PaletteName): Rgb {
  const [r, g, b] = PALETTE[name]
  return [r, g, b]
}

/** Multiply each channel by intensity, clamping each to the 0..255 byte range. */
export function shade(c: Rgb, intensity: number): Rgb {
  return [
    clamp(c[0] * intensity, 0, 255),
    clamp(c[1] * intensity, 0, 255),
    clamp(c[2] * intensity, 0, 255),
  ]
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/** Linear distance shading: 1 at the camera, falling to MIN_SHADE at/after FOG_DISTANCE. */
export function fogIntensity(distance: number): number {
  if (distance <= 0) return 1
  if (distance >= FOG_DISTANCE) return MIN_SHADE
  return lerp(1, MIN_SHADE, distance / FOG_DISTANCE)
}

/** Shade then round to integer 0..255 bytes, ready to write into a pixel buffer. */
export function packShade(c: Rgb, intensity: number): readonly [number, number, number] {
  return [
    Math.round(clamp(c[0] * intensity, 0, 255)),
    Math.round(clamp(c[1] * intensity, 0, 255)),
    Math.round(clamp(c[2] * intensity, 0, 255)),
  ]
}

/** Flood an RGBA buffer with a solid colour. Alpha defaults to fully opaque. */
export function fillRgba(data: Uint8ClampedArray, c: Rgb, alpha = 255): void {
  const r = c[0]
  const g = c[1]
  const b = c[2]
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = alpha
  }
}
