// Runnable coverage gate for the first-person weapon viewmodel: the COMMITTED atlas manifest
// must carry every drawn weapon frame (weaponPlan §1.2 / src/doom/game/viewmodelFrames.ts).
// build:sprites needs the gitignored WAD, so the gate that runs in CI is THIS test — it asserts
// every required (prefix, letter) resolves to a real, sized, single-slot (rotated===false) frame.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpriteAtlas } from '~/doom/engine/sprites/spriteAtlas'
import type { AtlasManifest } from '~/doom/engine/sprites/atlasTypes'
import { REQUIRED_VIEWMODEL_FRAMES } from '~/doom/game/viewmodelFrames'

// vitest runs from the repo root, so the committed atlas lives at this fixed path.
const ATLAS_JSON = resolve(process.cwd(), 'public/sprites/atlas.json')

function loadCommittedAtlas(): SpriteAtlas {
  const manifest = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasManifest
  const { width, height } = manifest.atlas
  // Geometry-only check — pixel content is irrelevant, so a zeroed bitmap suffices.
  const rgba = new Uint8ClampedArray(width * height * 4)
  return new SpriteAtlas(manifest, rgba, width, height)
}

describe('viewmodel coverage (committed atlas.json)', () => {
  const atlas = loadCommittedAtlas()

  it('packs all 15 viewmodel prefixes as single-slot (rotated===false) actors', () => {
    const prefixes = Object.keys(REQUIRED_VIEWMODEL_FRAMES)
    expect(prefixes).toHaveLength(15)
    for (const prefix of prefixes) {
      expect(atlas.hasActor(prefix)).toBe(true)
      expect(atlas.manifest.actors[prefix]?.rotated).toBe(false)
    }
  })

  for (const [prefix, letters] of Object.entries(REQUIRED_VIEWMODEL_FRAMES)) {
    for (const letter of letters) {
      it(`resolves ${prefix}/${letter} to a real sized frame`, () => {
        const ref = atlas.actorFrame(prefix, letter, 1)
        expect(ref).not.toBeNull()
        expect(ref?.tex.width ?? 0).toBeGreaterThan(0)
        expect(ref?.tex.height ?? 0).toBeGreaterThan(0)
      })
    }
  }
})
