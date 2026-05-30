// Shared leaf types for the WAD → atlas build pipeline. Pure, zero imports.
// Every scripts/wad/* module implements against these contracts so the pieces
// compose without integration drift. Run by `bun`, so .ts imports resolve
// extensionless; never imported by the app runtime (which reads atlas.json).

/** One named WAD lump: its trimmed name (≤8 chars) and raw bytes. */
export interface Lump {
  readonly name: string
  readonly data: Uint8Array
}

/** A decoded Doom picture/patch: RGBA pixels + the Doom anchor offsets. */
export interface DecodedPatch {
  readonly w: number
  readonly h: number
  /** Doom leftoffset / topoffset — the sprite anchor relative to the bitmap. */
  readonly ox: number
  readonly oy: number
  /** Length === w * h * 4, RGBA row-major; alpha 0 marks transparent texels. */
  readonly rgba: Uint8ClampedArray
}

/** A frame's placed rectangle in the atlas plus its Doom anchor offsets. */
export interface PackedFrame {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly ox: number
  readonly oy: number
}

/** The packed atlas: one RGBA bitmap + the per-input-frame placement list. */
export interface Atlas {
  readonly width: number
  readonly height: number
  /** Length === width * height * 4, RGBA row-major. */
  readonly rgba: Uint8ClampedArray
  /** frames[i] is the placement of input patch i (same order as the input). */
  readonly frames: readonly PackedFrame[]
}

/** One concrete (frame-letter, rotation) slot resolved to a source lump. */
export interface FrameRef {
  /** Full source lump name, e.g. 'TROOA1' or 'TROOA2A8'. */
  readonly lump: string
  /** True when this rotation is served by the mirror half of an 8-char lump. */
  readonly flip: boolean
}

/**
 * One actor's sprite set grouped by frame letter. For a rotated actor each
 * letter maps to 8 entries (rot 1..8); for an all-angles letter (rot 0) the
 * array has length 1. A null entry means that rotation has no source lump.
 */
export interface ActorIndex {
  readonly rotated: boolean
  readonly frames: Record<string, readonly (FrameRef | null)[]>
}
