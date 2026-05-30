// Pack decoded patches into one RGBA atlas bitmap with a deterministic
// shelf/skyline packer. Build-time only; run by `bun`, so imports are
// extensionless and relative. The atlas is a CPU transport container (no
// power-of-two requirement) consumed downstream as atlas.json + bitmap.

import type { Atlas, DecodedPatch, PackedFrame } from './types'

const DEFAULT_MAX_WIDTH = 2048
const DEFAULT_PADDING = 1

/**
 * Pack `patches` into a single RGBA atlas using a stable shelf packer.
 * Returns frames in INPUT order: frames[i] is the placement of patches[i].
 */
export function packAtlas(
  patches: readonly DecodedPatch[],
  opts?: { maxWidth?: number; padding?: number },
): Atlas {
  const maxWidth = opts?.maxWidth ?? DEFAULT_MAX_WIDTH
  const padding = opts?.padding ?? DEFAULT_PADDING

  // Atlas width: normally maxWidth, but at least wide enough for the widest
  // patch plus padding on both sides so nothing overflows the row.
  let widest = 0
  for (const p of patches) {
    if (p.w > widest) widest = p.w
  }
  const width = Math.max(maxWidth, widest + 2 * padding)

  // Sort INDICES by patch height descending; stable tie-break on original
  // index ascending. We keep indices so placements map back to input order.
  const order: number[] = patches.map((_, i) => i)
  order.sort((a, b) => {
    const ha = patches[a]?.h ?? 0
    const hb = patches[b]?.h ?? 0
    if (hb !== ha) return hb - ha
    return a - b
  })

  // Lay the sorted patches out left-to-right into shelves (rows). A patch
  // that does not fit the current shelf's remaining width starts a new shelf
  // below; each shelf's height is its tallest patch. Padding wraps every side.
  const placements = new Array<PackedFrame | undefined>(patches.length)
  let cursorX = padding
  let shelfY = padding
  let shelfHeight = 0
  let totalHeight = padding

  for (const idx of order) {
    const patch = patches[idx]
    if (patch === undefined) continue

    // Wrap to a new shelf when this patch would exceed the atlas width.
    if (cursorX + patch.w + padding > width && cursorX > padding) {
      shelfY += shelfHeight + padding
      cursorX = padding
      shelfHeight = 0
    }

    placements[idx] = {
      x: cursorX,
      y: shelfY,
      w: patch.w,
      h: patch.h,
      ox: patch.ox,
      oy: patch.oy,
    }

    cursorX += patch.w + padding
    if (patch.h > shelfHeight) shelfHeight = patch.h
    const shelfBottom = shelfY + shelfHeight + padding
    if (shelfBottom > totalHeight) totalHeight = shelfBottom
  }

  const height = Math.max(totalHeight, padding)
  const rgba = new Uint8ClampedArray(width * height * 4)

  // Blit each patch row by row into its placed rectangle. We iterate by input
  // index so each placement is paired with the source patch's pixels.
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i]
    const frame = placements[i]
    if (patch === undefined || frame === undefined) continue
    blit(rgba, width, patch, frame.x, frame.y)
  }

  // Collapse the sparse placement list into the final dense frames array,
  // substituting a zero rect for any (shouldn't happen) gap to keep types tidy.
  const frames: PackedFrame[] = placements.map(
    f => f ?? { x: 0, y: 0, w: 0, h: 0, ox: 0, oy: 0 },
  )

  return { width, height, rgba, frames }
}

/** Copy one patch's RGBA rows into the atlas at destination (dx, dy). */
function blit(
  dest: Uint8ClampedArray,
  destWidth: number,
  patch: DecodedPatch,
  dx: number,
  dy: number,
): void {
  const rowBytes = patch.w * 4
  for (let row = 0; row < patch.h; row++) {
    const srcStart = row * rowBytes
    const destStart = ((dy + row) * destWidth + dx) * 4
    for (let b = 0; b < rowBytes; b++) {
      dest[destStart + b] = patch.rgba[srcStart + b] ?? 0
    }
  }
}
