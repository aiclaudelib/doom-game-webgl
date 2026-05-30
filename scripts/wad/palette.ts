// Extract a 256-colour RGB palette from a Doom PLAYPAL lump.
// PLAYPAL holds 14 palettes, each 768 bytes (256 RGB triplets). The first
// (index 0) is the base game palette; the rest are pain/pickup/radsuit tints.
// decodePatch maps a palette index i to r=pal[i*3], g=pal[i*3+1], b=pal[i*3+2].
// Run by `bun`; never imported by the app runtime.

const PALETTE_SIZE = 768

/**
 * Return a 768-byte RGB palette copy for the given PLAYPAL `index` (default 0).
 * Reads bytes [index*768, index*768+768). If that slice is out of range, falls
 * back to palette 0; if even palette 0 is short, returns a zero-filled buffer.
 */
export function readPlaypal(playpal: Uint8Array, index = 0): Uint8Array {
  const out = new Uint8Array(PALETTE_SIZE)
  const start = index * PALETTE_SIZE
  if (index >= 0 && start + PALETTE_SIZE <= playpal.length) {
    out.set(playpal.subarray(start, start + PALETTE_SIZE))
    return out
  }
  if (PALETTE_SIZE <= playpal.length) {
    out.set(playpal.subarray(0, PALETTE_SIZE))
  }
  return out
}
