import { describe, expect, it } from 'vitest'
import { createAssets } from '~/doom/engine/textures'
import type { Assets, EnemyKind, PickupKind, Texture, WeaponKind } from '~/doom/types'

const ENEMY_KINDS: readonly EnemyKind[] = ['grunt', 'imp', 'demon']
const WEAPON_KINDS: readonly WeaponKind[] = ['fist', 'pistol', 'shotgun', 'chaingun']
const PICKUP_KINDS: readonly PickupKind[] = [
  'health',
  'medkit',
  'armor',
  'bullets',
  'shells',
  'shotgun',
  'chaingun',
  'keyRed',
  'keyBlue',
  'keyYellow',
]

/** A texture is well-formed when its data length matches width * height * 4. */
function isWellFormed(tex: Texture): boolean {
  return (
    tex.width > 0 &&
    tex.height > 0 &&
    tex.data instanceof Uint8ClampedArray &&
    tex.data.length === tex.width * tex.height * 4
  )
}

/** Concatenate every texture's bytes into one flat array for a determinism fingerprint. */
function flatten(assets: Assets): number[] {
  const out: number[] = []
  const push = (tex: Texture): void => {
    for (const byte of tex.data) out.push(byte)
  }
  for (const tex of assets.wall) push(tex)
  for (const tex of assets.flat) push(tex)
  for (const kind of ENEMY_KINDS) {
    const v = assets.enemy[kind]
    for (const tex of [...v.walk, ...v.attack, ...v.hurt, ...v.die]) push(tex)
  }
  for (const kind of WEAPON_KINDS) {
    const v = assets.weapon[kind]
    push(v.idle)
    for (const tex of v.fire) push(tex)
  }
  for (const kind of PICKUP_KINDS) push(assets.pickup[kind])
  for (const tex of assets.projectile.fireball) push(tex)
  return out
}

describe('textures', () => {
  describe('createAssets structure', () => {
    const assets = createAssets(1)

    it('has at least 10 wall textures, all well-formed', () => {
      expect(assets.wall.length).toBeGreaterThanOrEqual(10)
      for (const tex of assets.wall) expect(isWellFormed(tex)).toBe(true)
    })

    it('has at least 4 flat textures, all well-formed', () => {
      expect(assets.flat.length).toBeGreaterThanOrEqual(4)
      for (const tex of assets.flat) expect(isWellFormed(tex)).toBe(true)
    })

    it('has the required animation frames for every enemy', () => {
      for (const kind of ENEMY_KINDS) {
        const v = assets.enemy[kind]
        expect(v.walk.length).toBeGreaterThanOrEqual(2)
        expect(v.attack.length).toBeGreaterThanOrEqual(1)
        expect(v.hurt.length).toBeGreaterThanOrEqual(1)
        expect(v.die.length).toBeGreaterThanOrEqual(3)
        for (const tex of [...v.walk, ...v.attack, ...v.hurt, ...v.die]) {
          expect(isWellFormed(tex)).toBe(true)
        }
      }
    })

    it('has an idle frame plus a firing sequence for every weapon', () => {
      for (const kind of WEAPON_KINDS) {
        const v = assets.weapon[kind]
        expect(isWellFormed(v.idle)).toBe(true)
        expect(v.fire.length).toBeGreaterThanOrEqual(2)
        for (const tex of v.fire) expect(isWellFormed(tex)).toBe(true)
      }
    })

    it('has one well-formed icon for every pickup kind', () => {
      for (const kind of PICKUP_KINDS) {
        expect(isWellFormed(assets.pickup[kind])).toBe(true)
      }
    })

    it('has at least 2 fireball projectile frames', () => {
      expect(assets.projectile.fireball.length).toBeGreaterThanOrEqual(2)
      for (const tex of assets.projectile.fireball) expect(isWellFormed(tex)).toBe(true)
    })
  })

  describe('determinism', () => {
    it('produces byte-identical data for the same seed', () => {
      const a = flatten(createAssets(2024))
      const b = flatten(createAssets(2024))
      expect(a.length).toBe(b.length)
      expect(a).toEqual(b)
    })

    it('produces different data for different seeds', () => {
      const a = flatten(createAssets(1))
      const b = flatten(createAssets(2))
      expect(a.length).toBe(b.length)
      expect(a).not.toEqual(b)
    })
  })
})
