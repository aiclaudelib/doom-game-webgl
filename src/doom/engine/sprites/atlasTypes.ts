// Type contract for public/sprites/atlas.json — the sprite manifest emitted by
// scripts/build-sprites.ts and consumed by the runtime atlas loader. This is a
// dependency leaf: zero imports, so loader/atlas/asset code can share it freely.
//
// Shape MUST stay in lockstep with the Manifest written by scripts/build-sprites.ts.

/** A frame's placed rectangle in the atlas bitmap plus its Doom anchor offsets. */
export interface AtlasFrame {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Doom leftoffset / topoffset, relative to this (cropped) frame's top-left. */
  readonly ox: number
  readonly oy: number
}

/** One rotation slot: which frame to draw and whether it is mirrored. */
export interface AtlasActorSlot {
  /** Index into AtlasManifest.frames. */
  readonly f: number
  /** True when this rotation is the mirror half of an 8-char lump (draw flipped). */
  readonly flip: boolean
}

/**
 * One actor's sprite set, grouped by frame letter. Each letter maps to either
 * 8 slots (rotations 1..8) when `rotated`, or 1 slot (all-angles) for death
 * frames, projectiles, pickups, props and first-person weapons.
 */
export interface AtlasActor {
  readonly rotated: boolean
  readonly frames: Record<string, readonly AtlasActorSlot[]>
}

/** The full atlas manifest: bitmap dimensions, frame table, and actor index. */
export interface AtlasManifest {
  readonly version: number
  readonly source: string
  /** Atlas image filename, resolved relative to the manifest URL. */
  readonly image: string
  readonly atlas: { readonly width: number; readonly height: number }
  readonly frames: readonly AtlasFrame[]
  readonly actors: Record<string, AtlasActor>
}
