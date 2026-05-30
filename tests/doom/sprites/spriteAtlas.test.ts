import { describe, expect, it } from 'vitest'
import { SpriteAtlas } from '~/doom/engine/sprites/spriteAtlas'
import type { AtlasManifest } from '~/doom/engine/sprites/atlasTypes'

type Rgba = [number, number, number, number]

const FRAME0: Rgba = [200, 30, 40, 255]
const FRAME1: Rgba = [20, 180, 60, 255]

const ATLAS_W = 4
const ATLAS_H = 2

const manifest: AtlasManifest = {
  version: 1,
  source: 'test',
  image: 'atlas.png',
  atlas: { width: ATLAS_W, height: ATLAS_H },
  frames: [
    { x: 0, y: 0, w: 2, h: 2, ox: 1, oy: 2 },
    { x: 2, y: 0, w: 2, h: 2, ox: 0, oy: 1 },
  ],
  actors: {
    TEST: { rotated: false, frames: { A: [{ f: 0, flip: false }] } },
    MON: {
      rotated: true,
      frames: {
        A: [
          { f: 0, flip: false },
          { f: 1, flip: false },
          { f: 0, flip: false },
          { f: 1, flip: false },
          { f: 0, flip: false },
          { f: 1, flip: false },
          { f: 0, flip: false },
          { f: 1, flip: true },
        ],
      },
    },
  },
}

/** Build the 4x2 RGBA atlas: left 2x2 block FRAME0, right 2x2 block FRAME1. */
function buildRgba(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(ATLAS_W * ATLAS_H * 4)
  for (let y = 0; y < ATLAS_H; y++) {
    for (let x = 0; x < ATLAS_W; x++) {
      const colour = x < 2 ? FRAME0 : FRAME1
      const o = (y * ATLAS_W + x) * 4
      data[o] = colour[0]
      data[o + 1] = colour[1]
      data[o + 2] = colour[2]
      data[o + 3] = colour[3]
    }
  }
  return data
}

/** Read the top-left RGBA quad of a sliced texture. */
function topLeft(data: Uint8ClampedArray): Rgba {
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
}

describe('SpriteAtlas', () => {
  const atlas = new SpriteAtlas(manifest, buildRgba(), ATLAS_W, ATLAS_H)

  it('exposes the manifest and known actors', () => {
    expect(atlas.manifest).toBe(manifest)
    expect(atlas.hasActor('TEST')).toBe(true)
    expect(atlas.hasActor('MON')).toBe(true)
    expect(atlas.hasActor('NOPE')).toBe(false)
  })

  it('slices a frame into a sized texture with the frame colour', () => {
    const tex = atlas.frameTexture(0)
    expect(tex.width).toBe(2)
    expect(tex.height).toBe(2)
    expect(topLeft(tex.data)).toEqual(FRAME0)
  })

  it('caches the same texture instance for repeat lookups', () => {
    expect(atlas.frameTexture(0)).toBe(atlas.frameTexture(0))
  })

  it('returns a 1x1 transparent texture for a missing frame index', () => {
    const tex = atlas.frameTexture(99)
    expect(tex.width).toBe(1)
    expect(tex.height).toBe(1)
    expect(topLeft(tex.data)).toEqual([0, 0, 0, 0])
  })

  it('resolves an all-angles actor frame (offsets + 2x2 tex, no flip)', () => {
    const ref = atlas.actorFrame('TEST', 'A', 3)
    expect(ref).not.toBeNull()
    expect(ref?.flip).toBe(false)
    expect(ref?.ox).toBe(1)
    expect(ref?.oy).toBe(2)
    expect(ref?.tex.width).toBe(2)
    expect(ref?.tex.height).toBe(2)
  })

  it('picks the 8th rotation slot (flipped) for a rotated actor', () => {
    const ref = atlas.actorFrame('MON', 'A', 8)
    expect(ref).not.toBeNull()
    expect(ref?.flip).toBe(true)
    expect(ref?.ox).toBe(0)
    expect(ref?.oy).toBe(1)
  })

  it('returns null for an unknown actor', () => {
    expect(atlas.actorFrame('NOPE', 'A', 1)).toBeNull()
  })

  it('returns null for an unknown frame letter', () => {
    expect(atlas.actorFrame('TEST', 'Z', 1)).toBeNull()
  })
})
