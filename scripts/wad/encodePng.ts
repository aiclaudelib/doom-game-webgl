// Encode an 8-bit RGBA bitmap (colour type 6) to a PNG byte stream using only
// node:zlib for DEFLATE. No third-party deps. Returns a single Uint8Array.

import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

// Precomputed CRC32 table (standard PNG/zlib polynomial 0xEDB88320).
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n >>> 0
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    // Indices are always in-bounds (i < bytes.length; index masked to 0..255),
    // so the `?? 0` fallbacks never fire — they only satisfy
    // noUncheckedIndexedAccess, which flags typed-array element access in TS 5.5+.
    const index = (crc ^ (bytes[i] ?? 0)) & 0xff
    crc = ((CRC_TABLE[index] ?? 0) ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build one PNG chunk on the wire: length + type + data + CRC32(type+data). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])

  const out = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out.set(typeBytes, 4)
  out.set(data, 8)

  const crcInput = new Uint8Array(typeBytes.length + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, typeBytes.length)
  view.setUint32(8 + data.length, crc32(crcInput), false)

  return out
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width, false)
  ihdrView.setUint32(4, height, false)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const rowLength = width * 4
  const raw = new Uint8Array(height * (1 + rowLength))
  for (let y = 0; y < height; y++) {
    const dst = y * (1 + rowLength)
    raw[dst] = 0 // filter None
    raw.set(rgba.subarray(y * rowLength, y * rowLength + rowLength), dst + 1)
  }

  const idatData = new Uint8Array(deflateSync(raw))

  const ihdrChunk = chunk('IHDR', ihdr)
  const idatChunk = chunk('IDAT', idatData)
  const iendChunk = chunk('IEND', new Uint8Array(0))

  const total =
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  const out = new Uint8Array(total)
  let offset = 0
  out.set(PNG_SIGNATURE, offset)
  offset += PNG_SIGNATURE.length
  out.set(ihdrChunk, offset)
  offset += ihdrChunk.length
  out.set(idatChunk, offset)
  offset += idatChunk.length
  out.set(iendChunk, offset)

  return out
}
