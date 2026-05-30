// Decode a Doom picture/patch lump into RGBA.
//
// Doom picture format (little-endian): a header (width, height, signed
// leftoffset/topoffset) followed by a per-column offset table, then column
// "post" data. Each post is a run of vertical pixels at a top delta; columns
// can hold several posts with transparent gaps between them.
//
// We use the classic (non-"tall") topdelta semantics: topdelta is an absolute
// y within the column. Freedoom sprites are standard patches, not tall
// patches, so we never need the cumulative tall-patch delta interpretation.

import type { DecodedPatch } from './types'

export function decodePatch(data: Uint8Array, palette: Uint8Array): DecodedPatch {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // Read bytes through DataViews so element access yields a plain `number`
  // (Uint8Array indexing is `number | undefined` under noUncheckedIndexedAccess).
  const pal = new DataView(palette.buffer, palette.byteOffset, palette.byteLength)

  const width = view.getUint16(0, true)
  const height = view.getUint16(2, true)
  const leftoffset = view.getInt16(4, true)
  const topoffset = view.getInt16(6, true)

  // columnofs: uint32 LE × width, starting at byte offset 8.
  const columnofs = new Array<number>(width)
  for (let x = 0; x < width; x++) {
    columnofs[x] = view.getUint32(8 + x * 4, true)
  }

  // All zero => fully transparent (alpha 0) for untouched texels.
  const rgba = new Uint8ClampedArray(width * height * 4)

  for (let x = 0; x < width; x++) {
    let p = columnofs[x] ?? 0
    // Walk this column's posts until the 0xff terminator.
    for (;;) {
      const topdelta = view.getUint8(p)
      p += 1
      if (topdelta === 0xff) {
        break
      }
      const length = view.getUint8(p)
      p += 1
      p += 1 // skip the unused 'pad' byte BEFORE the pixels
      for (let i = 0; i < length; i++) {
        const palIndex = view.getUint8(p)
        p += 1
        const y = topdelta + i
        if (y >= 0 && y < height) {
          const di = (y * width + x) * 4
          rgba[di] = pal.getUint8(palIndex * 3)
          rgba[di + 1] = pal.getUint8(palIndex * 3 + 1)
          rgba[di + 2] = pal.getUint8(palIndex * 3 + 2)
          rgba[di + 3] = 255
        }
      }
      p += 1 // skip the unused 'pad' byte AFTER the pixels
    }
  }

  return { w: width, h: height, ox: leftoffset, oy: topoffset, rgba }
}
