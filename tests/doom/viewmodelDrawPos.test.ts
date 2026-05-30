// Golden placement test for the viewmodel draw convention (B3). Pins WEAPON_BASE_Y and the
// full-screen-relative-NEGATIVE-offset math against the COMMITTED atlas. The regression guard
// (left edge < 160) catches the old world-billboard `160 - ox` bug ever creeping back in.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpriteAtlas } from '~/doom/engine/sprites/spriteAtlas'
import type { ActorFrameRef } from '~/doom/engine/sprites/spriteAtlas'
import type { AtlasManifest } from '~/doom/engine/sprites/atlasTypes'
import { WEAPON_BASE_Y, letterOf, viewmodelDrawPos } from '~/doom/ui/viewmodel'

// vitest runs from the repo root, so the committed atlas lives at this fixed path.
const ATLAS_JSON = resolve(process.cwd(), 'public/sprites/atlas.json')

function loadAtlas(): SpriteAtlas {
  const manifest = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasManifest
  const { width, height } = manifest.atlas
  return new SpriteAtlas(manifest, new Uint8ClampedArray(width * height * 4), width, height)
}

function refFor(atlas: SpriteAtlas, prefix: string, letter: string): ActorFrameRef {
  const ref = atlas.actorFrame(prefix, letter, 1)
  if (ref === null) throw new Error(`missing ${prefix}/${letter}`)
  return ref
}

// WEAPONTOP — the fully-raised slide value the engine settles a ready gun at.
const WEAPONTOP = 32

describe('viewmodelDrawPos (committed atlas golden offsets)', () => {
  const atlas = loadAtlas()

  it('places PISG/A at x === 125 at bob 0 (offset-driven, no +160)', () => {
    const ref = refFor(atlas, 'PISG', letterOf(0))
    expect(viewmodelDrawPos(ref, 0, 0, WEAPONTOP).x).toBe(125)
  })

  it('places BFGG/A at x === 95 at bob 0', () => {
    const ref = refFor(atlas, 'BFGG', letterOf(0))
    expect(viewmodelDrawPos(ref, 0, 0, WEAPONTOP).x).toBe(95)
  })

  it('gives two frames with different ox different x', () => {
    const pisg = refFor(atlas, 'PISG', 'A') // ox -125
    const shtg = refFor(atlas, 'SHTG', 'A') // ox -122
    expect(pisg.ox).not.toBe(shtg.ox)
    const xPisg = viewmodelDrawPos(pisg, 0, 0, WEAPONTOP).x
    const xShtg = viewmodelDrawPos(shtg, 0, 0, WEAPONTOP).x
    expect(xPisg).not.toBe(xShtg)
  })

  it('REGRESSION GUARD: every viewmodel left edge is < 160 (no 160-ox bug)', () => {
    for (const prefix of ['PISG', 'SHTG', 'SHT2', 'BFGG', 'PUNG', 'CHGG', 'MISG', 'PLSG']) {
      const ref = refFor(atlas, prefix, 'A')
      const x = viewmodelDrawPos(ref, 0, 0, WEAPONTOP).x
      expect(x).toBeLessThan(160)
    }
  })

  it('the bob shift moves x/y; pspSy slides y downward', () => {
    const ref = refFor(atlas, 'PISG', 'A')
    const base = viewmodelDrawPos(ref, 0, 0, WEAPONTOP)
    const bobbed = viewmodelDrawPos(ref, 6, 3, WEAPONTOP)
    expect(bobbed.x).toBe(base.x + 6)
    expect(bobbed.y).toBe(base.y + 3)
    // Sliding down (larger pspSy) lowers the gun on screen.
    const lowered = viewmodelDrawPos(ref, 0, 0, 128)
    expect(lowered.y).toBeGreaterThan(base.y)
    expect(lowered.y - base.y).toBe(128 - WEAPONTOP)
  })

  it('pins WEAPON_BASE_Y: fully-raised PISG/A rests its bottom at the 160px view floor', () => {
    expect(WEAPON_BASE_Y).toBe(-61)
    const ref = refFor(atlas, 'PISG', 'A') // oy -97, h 92
    const top = viewmodelDrawPos(ref, 0, 0, WEAPONTOP).y
    expect(top + ref.tex.height).toBe(160)
  })
})
