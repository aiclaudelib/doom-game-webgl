// Groups Doom sprite lumps into a per-actor index keyed by 4-char prefix.
// Each actor's frames map a frame letter to an array of (FrameRef|null) slots:
// length 1 for an all-angles (rot '0') frame, length 8 for rotated frames.
// 8-char lumps encode a mirror pair: the first pair maps flip:false, the
// second pair maps the SAME lump flip:true at its own rotation slot.
// Run by `bun`, so imports resolve extensionless.

import type { ActorIndex, FrameRef, Lump } from './types'

interface ActorBuild {
  rotated: boolean
  frames: Record<string, (FrameRef | null)[]>
}

/** Ensure a rotated (length-8) slot array exists for the given frame letter. */
function ensureRotatedFrame(
  frames: Record<string, (FrameRef | null)[]>,
  letter: string,
): (FrameRef | null)[] {
  const existing = frames[letter]
  if (existing !== undefined) {
    return existing
  }
  const created: (FrameRef | null)[] = [null, null, null, null, null, null, null, null]
  frames[letter] = created
  return created
}

/** Apply one (frame letter, rotation digit) pair from a lump into the actor. */
function applyPair(
  actor: ActorBuild,
  lumpName: string,
  letter: string,
  rotDigit: string,
  flip: boolean,
): void {
  if (rotDigit === '0') {
    actor.frames[letter] = [{ lump: lumpName, flip }]
    return
  }
  const rot = Number.parseInt(rotDigit, 10)
  if (!Number.isInteger(rot) || rot < 1 || rot > 8) {
    return
  }
  actor.rotated = true
  const slots = ensureRotatedFrame(actor.frames, letter)
  slots[rot - 1] = { lump: lumpName, flip }
}

/**
 * Build a deterministic per-actor sprite index from raw lumps. Lumps are
 * processed in input order; arrays are never reordered. Only 6- and 8-char
 * names are interpreted; anything else is ignored.
 */
export function buildSpriteIndex(lumps: readonly Lump[]): Record<string, ActorIndex> {
  const actors: Record<string, ActorBuild> = {}

  for (const lump of lumps) {
    const name = lump.name
    if (name.length !== 6 && name.length !== 8) {
      continue
    }
    const prefix = name.slice(0, 4)
    const frame1 = name[4]
    const rot1 = name[5]
    if (frame1 === undefined || rot1 === undefined) {
      continue
    }

    let actor = actors[prefix]
    if (actor === undefined) {
      actor = { rotated: false, frames: {} }
      actors[prefix] = actor
    }

    applyPair(actor, name, frame1, rot1, false)

    if (name.length === 8) {
      const frame2 = name[6]
      const rot2 = name[7]
      if (frame2 !== undefined && rot2 !== undefined) {
        applyPair(actor, name, frame2, rot2, true)
      }
    }
  }

  const result: Record<string, ActorIndex> = {}
  for (const prefix of Object.keys(actors)) {
    const actor = actors[prefix]
    if (actor === undefined) {
      continue
    }
    result[prefix] = { rotated: actor.rotated, frames: actor.frames }
  }
  return result
}
