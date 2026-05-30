import { describe, expect, it } from 'vitest'
import { decodePatch } from '../../../scripts/wad/decodePatch'

// Palette where index 5 = (200, 100, 50); everything else stays zero.
const palette = (() => {
  const p = new Uint8Array(256 * 3)
  p[5 * 3] = 200
  p[5 * 3 + 1] = 100
  p[5 * 3 + 2] = 50
  return p
})()

describe('decodePatch', () => {
  it('decodes a single post into the right pixel and leaves gaps transparent', () => {
    // 1-wide, 3-tall patch. Header is 8 bytes; columnofs is 1 × 4 bytes at
    // offset 8, so column 0 data starts at 8 + 4 * 1 = 12.
    const colStart = 12
    const data = new Uint8Array(colStart + 6)
    const view = new DataView(data.buffer)
    view.setUint16(0, 1, true) // width
    view.setUint16(2, 3, true) // height
    view.setInt16(4, 11, true) // leftoffset (ox)
    view.setInt16(6, -7, true) // topoffset (oy), signed
    view.setUint32(8, colStart, true) // columnofs[0]

    // One post: topdelta=1, length=1, pad, pixel(index 5), pad, terminator.
    data[colStart] = 1 // topdelta
    data[colStart + 1] = 1 // length
    data[colStart + 2] = 0 // unused pad before pixels
    data[colStart + 3] = 5 // pixel palette index
    data[colStart + 4] = 0 // unused pad after pixels
    data[colStart + 5] = 0xff // column terminator

    const patch = decodePatch(data, palette)

    expect(patch.w).toBe(1)
    expect(patch.h).toBe(3)
    expect(patch.ox).toBe(11)
    expect(patch.oy).toBe(-7)
    expect(patch.rgba).toHaveLength(1 * 3 * 4)

    // Pixel at (0, 1) is the painted one.
    const di = (1 * 1 + 0) * 4
    expect(patch.rgba[di]).toBe(200)
    expect(patch.rgba[di + 1]).toBe(100)
    expect(patch.rgba[di + 2]).toBe(50)
    expect(patch.rgba[di + 3]).toBe(255)

    // Pixels at (0, 0) and (0, 2) remain transparent (alpha 0).
    expect(patch.rgba[(0 * 1 + 0) * 4 + 3]).toBe(0)
    expect(patch.rgba[(2 * 1 + 0) * 4 + 3]).toBe(0)
  })

  it('leaves a column with an immediate terminator fully transparent', () => {
    // 2-wide, 3-tall patch. Header 8 bytes; columnofs is 2 × 4 bytes at offset
    // 8, so column data starts at 8 + 4 * 2 = 16.
    const col0Start = 16
    const col0Len = 6 // topdelta, length, pad, pixel, pad, terminator
    const col1Start = col0Start + col0Len
    const data = new Uint8Array(col1Start + 1) // column 1 is a lone 0xff
    const view = new DataView(data.buffer)
    view.setUint16(0, 2, true) // width
    view.setUint16(2, 3, true) // height
    view.setInt16(4, 0, true) // leftoffset
    view.setInt16(6, 0, true) // topoffset
    view.setUint32(8, col0Start, true) // columnofs[0]
    view.setUint32(12, col1Start, true) // columnofs[1]

    // Column 0: one pixel (index 5) at topdelta 0.
    data[col0Start] = 0 // topdelta
    data[col0Start + 1] = 1 // length
    data[col0Start + 2] = 0 // pad
    data[col0Start + 3] = 5 // pixel
    data[col0Start + 4] = 0 // pad
    data[col0Start + 5] = 0xff // terminator

    // Column 1: immediate terminator -> fully empty.
    data[col1Start] = 0xff

    const patch = decodePatch(data, palette)

    expect(patch.w).toBe(2)
    expect(patch.h).toBe(3)

    // Column 0 painted its top pixel.
    expect(patch.rgba[(0 * 2 + 0) * 4 + 3]).toBe(255)

    // Every texel of column 1 (x === 1) stays transparent.
    for (let y = 0; y < 3; y++) {
      expect(patch.rgba[(y * 2 + 1) * 4 + 3]).toBe(0)
    }
  })
})
