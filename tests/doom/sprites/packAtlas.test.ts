import { describe, expect, it } from 'vitest'
import { packAtlas } from '../../../scripts/wad/packAtlas'
import type { DecodedPatch, PackedFrame } from '../../../scripts/wad/types'

type Rgba = [number, number, number, number]

/** Build a solid-colour DecodedPatch of the given size + anchor offsets. */
function makePatch(w: number, h: number, ox: number, oy: number, colour: Rgba): DecodedPatch {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    rgba[o] = colour[0]
    rgba[o + 1] = colour[1]
    rgba[o + 2] = colour[2]
    rgba[o + 3] = colour[3]
  }
  return { w, h, ox, oy, rgba }
}

/** Read the RGBA quad at (x, y) of an atlas bitmap. */
function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): Rgba {
  const o = (y * width + x) * 4
  return [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, data[o + 3] ?? 0]
}

/** True when two axis-aligned rects share any area. */
function overlaps(a: PackedFrame, b: PackedFrame): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

const RED: Rgba = [200, 30, 40, 255]
const GREEN: Rgba = [20, 180, 60, 255]
const BLUE: Rgba = [30, 50, 220, 255]

describe('packAtlas', () => {
  const patches: DecodedPatch[] = [
    makePatch(4, 6, 2, 5, RED),
    makePatch(8, 3, 1, 2, GREEN),
    makePatch(5, 9, 3, 8, BLUE),
  ]
  const colours: Rgba[] = [RED, GREEN, BLUE]

  it('returns one frame per input patch, in input order with offsets preserved', () => {
    const atlas = packAtlas(patches)
    expect(atlas.frames).toHaveLength(3)
    atlas.frames.forEach((frame, i) => {
      const src = patches[i]
      expect(frame.w).toBe(src?.w)
      expect(frame.h).toBe(src?.h)
      expect(frame.ox).toBe(src?.ox)
      expect(frame.oy).toBe(src?.oy)
    })
  })

  it('places every frame inside the atlas bounds', () => {
    const atlas = packAtlas(patches)
    for (const frame of atlas.frames) {
      expect(frame.x).toBeGreaterThanOrEqual(0)
      expect(frame.y).toBeGreaterThanOrEqual(0)
      expect(frame.x + frame.w).toBeLessThanOrEqual(atlas.width)
      expect(frame.y + frame.h).toBeLessThanOrEqual(atlas.height)
    }
  })

  it('never overlaps two frame rectangles', () => {
    const atlas = packAtlas(patches)
    for (let i = 0; i < atlas.frames.length; i++) {
      for (let j = i + 1; j < atlas.frames.length; j++) {
        const a = atlas.frames[i]
        const b = atlas.frames[j]
        if (a === undefined || b === undefined) continue
        expect(overlaps(a, b)).toBe(false)
      }
    }
  })

  it('blits each patch colour into its placed rectangle', () => {
    const atlas = packAtlas(patches)
    atlas.frames.forEach((frame, i) => {
      const colour = colours[i]
      expect(pixelAt(atlas.rgba, atlas.width, frame.x, frame.y)).toEqual(colour)
    })
  })

  it('is deterministic for a given input', () => {
    const first = packAtlas(patches)
    const second = packAtlas(patches)
    expect(second.frames).toEqual(first.frames)
    expect(second.width).toBe(first.width)
    expect(second.height).toBe(first.height)
  })
})
