import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../../../scripts/wad/encodePng'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const readType = (png: Uint8Array, offset: number): string =>
  String.fromCharCode(
    png[offset + 4] ?? 0,
    png[offset + 5] ?? 0,
    png[offset + 6] ?? 0,
    png[offset + 7] ?? 0,
  )

describe('encodePng', () => {
  it('encodes a 2x1 RGBA image into a valid PNG stream', () => {
    const rgba = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255])
    const png = encodePng(2, 1, rgba)
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)

    // Signature.
    expect(Array.from(png.subarray(0, 8))).toEqual(SIGNATURE)

    // First chunk after the signature is IHDR.
    const ihdrLen = view.getUint32(8, false)
    expect(ihdrLen).toBe(13)
    expect(readType(png, 8)).toBe('IHDR')
    const ihdr = 16 // 8 sig + 4 length + 4 type
    expect(view.getUint32(ihdr, false)).toBe(2) // width
    expect(view.getUint32(ihdr + 4, false)).toBe(1) // height
    expect(png[ihdr + 8]).toBe(8) // bit depth
    expect(png[ihdr + 9]).toBe(6) // colour type RGBA

    // Walk the chunks to find IDAT and confirm the stream ends with IEND.
    let pos = 8
    let idatData: Uint8Array | null = null
    let lastType = ''
    while (pos < png.length) {
      const len = view.getUint32(pos, false)
      const type = readType(png, pos)
      lastType = type
      const dataStart = pos + 8
      if (type === 'IDAT') {
        idatData = png.subarray(dataStart, dataStart + len)
      }
      pos = dataStart + len + 4 // skip data + CRC
    }

    expect(lastType).toBe('IEND')
    expect(idatData).not.toBeNull()

    const inflated = Array.from(inflateSync(idatData ?? new Uint8Array(0)))
    expect(inflated).toEqual([0, 10, 20, 30, 255, 40, 50, 60, 255])
  })
})
