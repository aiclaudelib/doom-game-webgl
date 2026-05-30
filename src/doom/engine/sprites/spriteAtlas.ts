// Runtime view over a packed sprite atlas: lazily slices per-frame Textures out of
// the atlas bitmap, resolves an actor's frame letter + rotation to a draw ref, and
// computes which of the 8 rotation views faces the camera. Pure data + typed-array
// work, so it runs identically under jsdom (no DOM/GL touched here).

import type { Texture } from '~/doom/types'
import type { AtlasManifest } from '~/doom/engine/sprites/atlasTypes'
import { createTexture } from '~/doom/engine/texture'

/** A resolved sprite to draw: its texture, mirror flag and Doom anchor offsets. */
export interface ActorFrameRef {
  readonly tex: Texture
  readonly flip: boolean
  readonly ox: number
  readonly oy: number
}

export class SpriteAtlas {
  private readonly _manifest: AtlasManifest
  private readonly rgba: Uint8ClampedArray
  private readonly width: number
  private readonly height: number
  private readonly frameCache = new Map<number, Texture>()

  constructor(manifest: AtlasManifest, rgba: Uint8ClampedArray, width: number, height: number) {
    this._manifest = manifest
    this.rgba = rgba
    this.width = width
    this.height = height
  }

  get manifest(): AtlasManifest {
    return this._manifest
  }

  hasActor(name: string): boolean {
    return this._manifest.actors[name] !== undefined
  }

  /** Slice frame `index` out of the atlas into its own Texture (cached). */
  frameTexture(index: number): Texture {
    const cached = this.frameCache.get(index)
    if (cached !== undefined) return cached

    const frame = this._manifest.frames[index]
    if (frame === undefined) {
      const empty = createTexture(1, 1)
      this.frameCache.set(index, empty)
      return empty
    }

    const tex = createTexture(frame.w, frame.h)
    for (let y = 0; y < frame.h; y++) {
      const sy = frame.y + y
      if (sy < 0 || sy >= this.height) continue
      for (let x = 0; x < frame.w; x++) {
        const srcOffset = (sy * this.width + (frame.x + x)) * 4
        const dstOffset = (y * frame.w + x) * 4
        tex.data[dstOffset] = this.rgba[srcOffset] ?? 0
        tex.data[dstOffset + 1] = this.rgba[srcOffset + 1] ?? 0
        tex.data[dstOffset + 2] = this.rgba[srcOffset + 2] ?? 0
        tex.data[dstOffset + 3] = this.rgba[srcOffset + 3] ?? 0
      }
    }

    this.frameCache.set(index, tex)
    return tex
  }

  /** Resolve actor `name`, frame `letter`, rotation `rot` (1..8) to a draw ref, or null. */
  actorFrame(name: string, letter: string, rot: number): ActorFrameRef | null {
    const actor = this._manifest.actors[name]
    if (actor === undefined) return null

    const slots = actor.frames[letter]
    if (slots === undefined || slots.length === 0) return null

    const slot = slots.length === 1 ? slots[0] : slots[(((rot - 1) % 8) + 8) % 8]
    if (slot === undefined || slot === null) return null

    const frame = this._manifest.frames[slot.f]
    if (frame === undefined) return null

    return { tex: this.frameTexture(slot.f), flip: slot.flip, ox: frame.ox, oy: frame.oy }
  }
}

/**
 * Pick the 1..8 rotation view of a thing as seen by a viewer. Viewer in front of the
 * thing's facing yields 1 (front), directly behind yields 5 (back).
 */
export function spriteRotation(
  thingAngle: number,
  viewerX: number,
  viewerY: number,
  thingX: number,
  thingY: number,
): number {
  const ang = Math.atan2(thingY - viewerY, thingX - viewerX)
  const delta = thingAngle - ang
  const idx = ((Math.floor(delta / (Math.PI / 4) + 4.5) % 8) + 8) % 8
  return idx + 1
}
