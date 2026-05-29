import { describe, expect, it } from 'vitest'
import type { Enemy, Rng, SceneQuery } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { createPlayer, giveWeapon } from '~/doom/game/player'
import { spawnEnemy } from '~/doom/game/enemy'
import { WEAPONS, tryFire, weaponBySlot } from '~/doom/game/weapon'

function openScene(): SceneQuery {
  return {
    width: 32,
    height: 32,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: () => false,
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

// Constant Rng → no flinch (chance false) and deterministic spread.
const RNG: Rng = () => 0.99

describe('weaponBySlot', () => {
  it('maps the 1..4 selection keys to weapon kinds', () => {
    expect(weaponBySlot(1)).toBe('fist')
    expect(weaponBySlot(2)).toBe('pistol')
    expect(weaponBySlot(3)).toBe('shotgun')
    expect(weaponBySlot(4)).toBe('chaingun')
  })

  it('returns null for unmapped slots', () => {
    expect(weaponBySlot(0)).toBeNull()
    expect(weaponBySlot(5)).toBeNull()
  })
})

describe('tryFire', () => {
  it('consumes one bullet and reports fired for the pistol', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    const before = player.ammo.bullets
    const outcome = tryFire(player, openScene(), [], RNG)
    expect(outcome.fired).toBe(true)
    expect(outcome.soundKind).toBe('pistol')
    expect(player.ammo.bullets).toBe(before - 1)
    expect(player.weaponState).toBe('firing')
  })

  it('does not fire an empty weapon', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.ammo.bullets = 0
    const outcome = tryFire(player, openScene(), [], RNG)
    expect(outcome.fired).toBe(false)
    expect(outcome.soundKind).toBeNull()
    expect(player.weaponState).toBe('ready')
  })

  it('does not fire while not ready', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.weaponState = 'firing'
    const outcome = tryFire(player, openScene(), [], RNG)
    expect(outcome.fired).toBe(false)
  })

  it('fires def.pellets hitscans for the shotgun', () => {
    expect(WEAPONS.shotgun.pellets).toBe(7)
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'shotgun')
    player.currentWeapon = 'shotgun'
    player.ammo.shells = 5

    // A demon (80 hp) one tile ahead: every pellet lands within ENEMY_HIT_RADIUS,
    // so total damage = 7 × shotgun damage, proving all pellets resolved.
    const demon: Enemy = spawnEnemy('demon', 2.5, 1.5)
    const enemies: Enemy[] = [demon]
    const outcome = tryFire(player, openScene(), enemies, RNG)

    expect(outcome.fired).toBe(true)
    expect(outcome.soundKind).toBe('shotgun')
    expect(outcome.hitEnemy).toBe(true)
    expect(player.ammo.shells).toBe(4)
    expect(demon.health).toBe(80 - WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage)
  })
})
