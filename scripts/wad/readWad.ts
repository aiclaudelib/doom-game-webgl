// Parse a raw WAD buffer into its directory of named lumps, and expose the two
// lookups the sprite pipeline needs: a name probe and the S_START/S_END slice.
// Run by `bun`, so imports are extensionless and relative.

import type { Lump } from './types'

const DIR_ENTRY_SIZE = 16
const NAME_LEN = 8

/** Decode an 8-byte lump name: ASCII, truncated at the first NUL. */
function decodeName(data: Uint8Array, off: number): string {
  let name = ''
  for (let i = 0; i < NAME_LEN; i++) {
    const byte = data[off + i]
    if (byte === undefined || byte === 0) break
    name += String.fromCharCode(byte)
  }
  return name
}

/** Parse a WAD (IWAD/PWAD) buffer into its ordered list of lumps. */
export function readWad(data: Uint8Array): Lump[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const numLumps = view.getInt32(4, true)
  const dirOfs = view.getInt32(8, true)

  const lumps: Lump[] = []
  for (let i = 0; i < numLumps; i++) {
    const entry = dirOfs + i * DIR_ENTRY_SIZE
    const filepos = view.getInt32(entry, true)
    const size = view.getInt32(entry + 4, true)
    const name = decodeName(data, entry + 8)
    lumps.push({ name, data: data.subarray(filepos, filepos + size) })
  }
  return lumps
}

/** First lump with the exact given name, or undefined. */
export function findLump(lumps: readonly Lump[], name: string): Lump | undefined {
  return lumps.find(lump => lump.name === name)
}

/** Lumps strictly between S_START and the next S_END, keeping only size > 0. */
export function spriteLumps(lumps: readonly Lump[]): Lump[] {
  const start = lumps.findIndex(lump => lump.name === 'S_START')
  if (start === -1) return []
  const out: Lump[] = []
  for (let i = start + 1; i < lumps.length; i++) {
    const lump = lumps[i]
    if (lump === undefined) continue
    if (lump.name === 'S_END') break
    if (lump.data.length > 0) out.push(lump)
  }
  return out
}
