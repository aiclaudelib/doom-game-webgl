// Build-time orchestrator: freedoom2.wad -> public/sprites/{atlas.png, atlas.json, CREDITS.md}.
//
// Pure, offline, deterministic: same WAD + same code => byte-identical output. Run with bun
// (`bun run build:sprites`) so the scripts/wad/* modules import each other extensionless. The
// runtime never imports this file — it fetches atlas.json + decodes atlas.png. The committed
// atlas is the compact, cropped, packed result; the 27 MB WAD stays out of git (.gitignore).
//
// Usage:
//   bun run build:sprites                 # pack the full game roster (default allowlist)
//   bun run build:sprites --only=TROO,POSS  # pack just those prefixes (fast dev iteration)
//   bun run build:sprites --all           # pack every sprite lump in the WAD

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePatch } from './wad/decodePatch'
import { encodePng } from './wad/encodePng'
import { packAtlas } from './wad/packAtlas'
import { readPlaypal } from './wad/palette'
import { findLump, readWad, spriteLumps } from './wad/readWad'
import { buildSpriteIndex } from './wad/spriteIndex'
import type { DecodedPatch } from './wad/types'
import { REQUIRED_VIEWMODEL_FRAMES } from '../src/doom/game/viewmodelFrames'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const WAD_PATH = resolve(ROOT, 'assets/freedoom2.wad')
const OUT_DIR = resolve(ROOT, 'public/sprites')
const FREEDOOM_URL =
  'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip'
const SOURCE_TAG = 'freedoom2.wad 0.13.0 (BSD, https://freedoom.github.io)'
const MANIFEST_VERSION = 1

/**
 * Sprite prefixes the game actually uses (verified present in freedoom2.wad). Packing only
 * these keeps the committed atlas to a few MB instead of all 1350 lumps. Grouped by role.
 */
const ROSTER: readonly string[] = [
  // monsters
  'TROO', 'POSS', 'SPOS', 'CPOS', 'SARG', 'HEAD', 'BOS2', 'BOSS', 'SKUL', 'PAIN',
  'FATT', 'BSPI', 'SKEL', 'VILE', 'CYBR', 'SPID', 'PLAY',
  // first-person weapon viewmodels + muzzle flashes
  'PUNG', 'SAWG', 'PISG', 'PISF', 'SHTG', 'SHTF', 'SHT2', 'CHGG', 'CHGF',
  'MISG', 'MISF', 'PLSG', 'PLSF', 'BFGG', 'BFGF',
  // world weapon pickups
  'CSAW', 'SHOT', 'SGN2', 'MGUN', 'LAUN', 'PLAS', 'BFUG',
  // projectiles + impact/explosion fx
  'BAL1', 'BAL2', 'BAL7', 'BOSF', 'FATB', 'MANF', 'MISL', 'PLSS', 'APLS', 'APBX',
  'BFS1', 'BFE1', 'BFE2', 'PLSE', 'FIRE', 'PUFF', 'BLUD', 'TFOG', 'IFOG',
  // health / armor / powerups
  'MEDI', 'STIM', 'BON1', 'BON2', 'ARM1', 'ARM2', 'SOUL', 'MEGA',
  'PINV', 'PINS', 'PSTR', 'PVIS', 'PMAP', 'SUIT',
  // ammo + backpack
  'CLIP', 'AMMO', 'SHEL', 'SBOX', 'ROCK', 'BROK', 'CELL', 'CELP', 'BPAK',
  // keys
  'RKEY', 'BKEY', 'YKEY', 'RSKU', 'BSKU', 'YSKU',
  // explosive barrel + decor props
  'BAR1', 'BEXP', 'TLMP', 'TLP2', 'COLU', 'CBRA', 'TRED', 'TGRN', 'TBLU',
  'SMRT', 'SMGT', 'SMBT', 'CAND', 'COL1', 'COL2', 'COL3', 'COL4', 'COL5', 'COL6',
  'TRE1', 'TRE2', 'GOR1', 'GOR2', 'GOR3', 'GOR4', 'GOR5',
  'HDB1', 'HDB2', 'HDB3', 'HDB4', 'HDB5', 'HDB6',
  'POL1', 'POL2', 'POL3', 'POL4', 'POL5', 'POL6', 'POB1', 'POB2', 'BRS1',
]

interface ManifestFrame {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly ox: number
  readonly oy: number
}

interface ManifestSlot {
  readonly f: number
  readonly flip: boolean
}

interface ManifestActor {
  readonly rotated: boolean
  readonly frames: Record<string, readonly ManifestSlot[]>
}

interface Manifest {
  readonly version: number
  readonly source: string
  readonly image: string
  readonly atlas: { readonly width: number; readonly height: number }
  readonly frames: readonly ManifestFrame[]
  readonly actors: Record<string, ManifestActor>
}

/** Parse `--only=A,B,C` if present; null means "use the default ROSTER". */
function parseOnly(argv: readonly string[]): readonly string[] | null {
  for (const arg of argv) {
    if (arg.startsWith('--only=')) {
      return arg
        .slice('--only='.length)
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s.length > 0)
    }
  }
  return null
}

/** Best-effort download of the Freedoom IWAD if it is missing (offline-friendly: clear error). */
async function ensureWad(): Promise<Uint8Array> {
  if (existsSync(WAD_PATH)) {
    return new Uint8Array(readFileSync(WAD_PATH))
  }
  console.warn(`WAD missing at ${WAD_PATH} — attempting download from ${FREEDOOM_URL}`)
  try {
    const res = await fetch(FREEDOOM_URL)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    // The release is a zip; we cannot unzip without a dep here. Tell the user what to do.
    throw new Error('downloaded archive needs manual extraction')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Could not obtain freedoom2.wad (${reason}). Download Freedoom 0.13.0 from ` +
        `${FREEDOOM_URL}, extract freedoom2.wad into assets/, and re-run.`,
    )
  }
}

/** Crop a decoded patch to its opaque bounding box, shifting the Doom anchor to match. */
function cropToBbox(patch: DecodedPatch): DecodedPatch {
  const { w, h, rgba } = patch
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    // Fully transparent — keep a 1x1 stub so packing/anchoring stay well-defined.
    return { w: 1, h: 1, ox: patch.ox, oy: patch.oy, rgba: new Uint8ClampedArray(4) }
  }
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    const srcRow = (y + minY) * w + minX
    const dstRow = y * cw
    for (let x = 0; x < cw; x++) {
      const si = (srcRow + x) * 4
      const di = (dstRow + x) * 4
      out[di] = rgba[si] ?? 0
      out[di + 1] = rgba[si + 1] ?? 0
      out[di + 2] = rgba[si + 2] ?? 0
      out[di + 3] = rgba[si + 3] ?? 0
    }
  }
  // Anchor stays at the same world point: subtract the crop origin from the offsets.
  return { w: cw, h: ch, ox: patch.ox - minX, oy: patch.oy - minY, rgba: out }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const all = argv.includes('--all')
  const only = parseOnly(argv)
  const allow = only ?? ROSTER
  const allowSet = new Set(allow)

  const wadBytes = await ensureWad()
  const lumps = readWad(wadBytes)
  const playpal = findLump(lumps, 'PLAYPAL')
  if (playpal === undefined) {
    throw new Error('PLAYPAL lump not found in WAD')
  }
  const palette = readPlaypal(playpal.data, 0)

  const sprites = spriteLumps(lumps)
  const index = buildSpriteIndex(sprites)
  const lumpByName = new Map(sprites.map(l => [l.name, l]))

  // Decide which actor prefixes to emit.
  const prefixes = Object.keys(index)
    .filter(p => all || allowSet.has(p))
    .sort()

  // Collect every unique source lump referenced by the kept actors, in a stable order.
  const usedLumps: string[] = []
  const seenLump = new Set<string>()
  for (const prefix of prefixes) {
    const actor = index[prefix]
    if (actor === undefined) continue
    for (const letter of Object.keys(actor.frames).sort()) {
      const slots = actor.frames[letter] ?? []
      for (const slot of slots) {
        if (slot !== null && !seenLump.has(slot.lump)) {
          seenLump.add(slot.lump)
          usedLumps.push(slot.lump)
        }
      }
    }
  }

  // Decode + crop each unique lump once; remember its frame index.
  const patches: DecodedPatch[] = []
  const frameIndexByLump = new Map<string, number>()
  for (const name of usedLumps) {
    const lump = lumpByName.get(name)
    if (lump === undefined) continue
    const decoded = cropToBbox(decodePatch(lump.data, palette))
    frameIndexByLump.set(name, patches.length)
    patches.push(decoded)
  }

  const atlas = packAtlas(patches)

  // Manifest frames (placement + anchor), index-aligned with `patches`.
  const frames: ManifestFrame[] = atlas.frames.map(f => ({
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    ox: f.ox,
    oy: f.oy,
  }))

  // Manifest actors: resolve each slot's lump to its frame index; fall back across nulls.
  const actors: Record<string, ManifestActor> = {}
  for (const prefix of prefixes) {
    const actor = index[prefix]
    if (actor === undefined) continue
    const outFrames: Record<string, ManifestSlot[]> = {}
    for (const letter of Object.keys(actor.frames).sort()) {
      const slots = actor.frames[letter] ?? []
      // Pick a fallback frame index for null rotations: the first resolvable slot.
      let fallback = -1
      for (const slot of slots) {
        if (slot !== null) {
          const fi = frameIndexByLump.get(slot.lump)
          if (fi !== undefined) {
            fallback = fi
            break
          }
        }
      }
      outFrames[letter] = slots.map(slot => {
        if (slot === null) {
          return { f: Math.max(0, fallback), flip: false }
        }
        const fi = frameIndexByLump.get(slot.lump)
        return { f: fi ?? Math.max(0, fallback), flip: slot.flip }
      })
    }
    actors[prefix] = { rotated: actor.rotated, frames: outFrames }
  }

  // Coverage gate: every DRAWN first-person weapon frame (weaponPlan §1.2) must be packed.
  // A dropped letter would silently leave the runtime resolving a viewmodel frame to null —
  // fail the build loudly instead. Resolved frame index must point at a real, sized rect.
  const missing: string[] = []
  for (const [prefix, letters] of Object.entries(REQUIRED_VIEWMODEL_FRAMES)) {
    const actor = actors[prefix]
    for (const letter of letters) {
      const slot = actor?.frames[letter]?.[0]
      const frame = slot !== undefined ? frames[slot.f] : undefined
      if (frame === undefined || frame.w <= 0 || frame.h <= 0) {
        missing.push(`${prefix}/${letter}`)
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `viewmodel coverage gate: ${missing.length} required frame(s) missing from the atlas: ` +
        missing.join(', '),
    )
  }

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    source: SOURCE_TAG,
    image: 'atlas.png',
    atlas: { width: atlas.width, height: atlas.height },
    frames,
    actors,
  }

  const png = encodePng(atlas.width, atlas.height, new Uint8Array(atlas.rgba.buffer))

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true })
  }
  writeFileSync(resolve(OUT_DIR, 'atlas.png'), png)
  writeFileSync(resolve(OUT_DIR, 'atlas.json'), `${JSON.stringify(manifest)}\n`)
  writeFileSync(resolve(OUT_DIR, 'CREDITS.md'), credits())

  const actorCount = Object.keys(actors).length
  console.log(
    `atlas: ${atlas.width}x${atlas.height}, ${frames.length} frames, ${actorCount} actors, ` +
      `${(png.byteLength / 1024).toFixed(0)} KB png`,
  )
}

function credits(): string {
  return [
    '# Sprite credits',
    '',
    'The sprites in `atlas.png` are generated from **Freedoom** (`freedoom2.wad`, v0.13.0),',
    'distributed under the 3-clause BSD license.',
    '',
    '- Project: https://freedoom.github.io',
    '- Source release: https://github.com/freedoom/freedoom/releases/tag/v0.13.0',
    '- License: BSD-3-Clause (see the Freedoom COPYING file)',
    '',
    'They are re-encoded losslessly (Doom picture format → cropped RGBA atlas) by',
    '`scripts/build-sprites.ts`. The raw WAD is not committed; only this generated atlas is.',
    '',
  ].join('\n')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
