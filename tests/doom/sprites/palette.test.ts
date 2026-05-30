import { describe, expect, it } from 'vitest'
import { readPlaypal } from '../../../scripts/wad/palette'

const PALETTE_SIZE = 768
const PALETTE_COUNT = 14

const buildPlaypal = (): Uint8Array => {
  const buf = new Uint8Array(PALETTE_SIZE * PALETTE_COUNT)
  const view = new DataView(buf.buffer)
  // Palette 0, entry 0 = (1, 2, 3).
  view.setUint8(0, 1)
  view.setUint8(1, 2)
  view.setUint8(2, 3)
  // Palette 0, entry 255 = (250, 251, 252).
  view.setUint8(255 * 3, 250)
  view.setUint8(255 * 3 + 1, 251)
  view.setUint8(255 * 3 + 2, 252)
  // Palette 1, entry 0 = (10, 11, 12).
  view.setUint8(PALETTE_SIZE, 10)
  view.setUint8(PALETTE_SIZE + 1, 11)
  view.setUint8(PALETTE_SIZE + 2, 12)
  return buf
}

describe('readPlaypal', () => {
  it('returns a 768-byte copy of palette 0 by default', () => {
    const pal = readPlaypal(buildPlaypal())
    expect(pal).toHaveLength(PALETTE_SIZE)
    expect([pal[0], pal[1], pal[2]]).toEqual([1, 2, 3])
    expect([pal[765], pal[766], pal[767]]).toEqual([250, 251, 252])
  })

  it('returns the requested palette by index', () => {
    const pal = readPlaypal(buildPlaypal(), 1)
    expect(pal).toHaveLength(PALETTE_SIZE)
    expect([pal[0], pal[1], pal[2]]).toEqual([10, 11, 12])
  })

  it('returns an independent copy, not a view into the source', () => {
    const buf = buildPlaypal()
    const pal = readPlaypal(buf)
    buf[0] = 99
    expect(pal[0]).toBe(1)
  })

  it('falls back to palette 0 when the index is out of range', () => {
    const pal = readPlaypal(buildPlaypal(), 99)
    expect(pal).toHaveLength(PALETTE_SIZE)
    expect([pal[0], pal[1], pal[2]]).toEqual([1, 2, 3])
  })

  it('falls back to palette 0 for a negative index', () => {
    const pal = readPlaypal(buildPlaypal(), -1)
    expect([pal[0], pal[1], pal[2]]).toEqual([1, 2, 3])
  })

  it('returns a zero-filled palette when even palette 0 is too short', () => {
    const pal = readPlaypal(new Uint8Array(10))
    expect(pal).toHaveLength(PALETTE_SIZE)
    expect(pal.every(b => b === 0)).toBe(true)
  })
})
