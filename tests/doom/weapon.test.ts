import { describe, expect, it } from 'vitest'
import type { Enemy, Projectile, Rng, SceneQuery } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { createPlayer, giveWeapon } from '~/doom/game/player'
import { ENEMY_DEFS, spawnEnemy } from '~/doom/game/enemy'
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

// Constant Rng → no flinch (chance false) and deterministic spread. Each gun-shot
// pellet rolls (1+floor(0.99*3))*5 = 15; melee rolls (1+floor(0.99*10))*2 = 20.
const RNG: Rng = () => 0.99

describe('weaponBySlot', () => {
  it('maps the 1..7 selection keys to weapon kinds (default loadout)', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    expect(weaponBySlot(1, player)).toBe('fist')
    expect(weaponBySlot(2, player)).toBe('pistol')
    expect(weaponBySlot(3, player)).toBe('shotgun')
    expect(weaponBySlot(4, player)).toBe('chaingun')
    expect(weaponBySlot(5, player)).toBe('rocket')
    expect(weaponBySlot(6, player)).toBe('plasma')
    expect(weaponBySlot(7, player)).toBe('bfg')
  })

  it('prefers chainsaw/super-shotgun when owned', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chainsaw')
    giveWeapon(player, 'superShotgun')
    expect(weaponBySlot(1, player)).toBe('chainsaw')
    expect(weaponBySlot(3, player)).toBe('superShotgun')
  })

  it('returns null for unmapped slots', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    expect(weaponBySlot(0, player)).toBeNull()
    expect(weaponBySlot(8, player)).toBeNull()
  })
})

describe('tryFire', () => {
  it('consumes one bullet and reports fired for the pistol', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    const before = player.ammo.bullets
    const outcome = tryFire(player, openScene(), [], [], RNG)
    expect(outcome.fired).toBe(true)
    expect(outcome.soundKind).toBe('pistol')
    expect(player.ammo.bullets).toBe(before - 1)
    expect(player.weaponState).toBe('firing')
  })

  it('does not fire an empty weapon', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.ammo.bullets = 0
    const outcome = tryFire(player, openScene(), [], [], RNG)
    expect(outcome.fired).toBe(false)
    expect(outcome.soundKind).toBeNull()
    expect(player.weaponState).toBe('ready')
  })

  it('does not fire while not ready', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.weaponState = 'firing'
    const outcome = tryFire(player, openScene(), [], [], RNG)
    expect(outcome.fired).toBe(false)
  })

  it('fires def.pellets hitscans for the shotgun', () => {
    expect(WEAPONS.shotgun.pellets).toBe(7)
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'shotgun')
    player.currentWeapon = 'shotgun'
    player.ammo.shells = 5

    // A demon one tile ahead: every pellet lands within ENEMY_HIT_RADIUS, so total
    // damage = 7 × per-pellet roll (15), proving all pellets resolved.
    const demon: Enemy = spawnEnemy('demon', 2.5, 1.5)
    const enemies: Enemy[] = [demon]
    const outcome = tryFire(player, openScene(), enemies, [], RNG)

    const pelletDmg =
      (1 + Math.floor(0.99 * WEAPONS.shotgun.damageSides)) * WEAPONS.shotgun.damageMul
    expect(outcome.fired).toBe(true)
    expect(outcome.soundKind).toBe('shotgun')
    expect(outcome.hitEnemy).toBe(true)
    expect(player.ammo.shells).toBe(4)
    expect(demon.health).toBe(ENEMY_DEFS.demon.maxHealth - WEAPONS.shotgun.pellets * pelletDmg)
  })

  it('super shotgun consumes 2 shells and resolves up to 20 pellets', () => {
    expect(WEAPONS.superShotgun.pellets).toBe(20)
    expect(WEAPONS.superShotgun.ammoPerShot).toBe(2)
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'superShotgun')
    player.currentWeapon = 'superShotgun'
    player.ammo.shells = 5

    // A high-HP baron (1000) so it never dies mid-volley and all 20 pellets land.
    const target: Enemy = spawnEnemy('baron', 2.5, 1.5)
    const outcome = tryFire(player, openScene(), [target], [], RNG)

    expect(outcome.fired).toBe(true)
    expect(outcome.soundKind).toBe('superShotgun')
    expect(player.ammo.shells).toBe(3)
    // RNG 0.99 never trips the verticalSpread (0.25) miss, so all 20 land.
    const pelletDmg =
      (1 + Math.floor(0.99 * WEAPONS.superShotgun.damageSides)) * WEAPONS.superShotgun.damageMul
    expect(target.health).toBe(ENEMY_DEFS.baron.maxHealth - 20 * pelletDmg)
  })

  it('spawns a projectile for the rocket launcher and consumes a rocket', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'rocket')
    player.currentWeapon = 'rocket'
    player.ammo.rockets = 3
    const projectiles: Projectile[] = []
    const outcome = tryFire(player, openScene(), [], projectiles, RNG)
    expect(outcome.fired).toBe(true)
    expect(player.ammo.rockets).toBe(2)
    expect(projectiles).toHaveLength(1)
    expect(projectiles[0]?.kind).toBe('rocket')
    expect(projectiles[0]?.fromEnemy).toBe(false)
  })

  it('BFG consumes 40 cells and spawns a bfg ball with a frozen origin', () => {
    expect(WEAPONS.bfg.ammoPerShot).toBe(40)
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'bfg')
    player.currentWeapon = 'bfg'
    player.ammo.cells = 50
    const projectiles: Projectile[] = []
    const outcome = tryFire(player, openScene(), [], projectiles, RNG)
    expect(outcome.fired).toBe(true)
    expect(player.ammo.cells).toBe(10)
    expect(projectiles[0]?.kind).toBe('bfg')
    expect(projectiles[0]?.originPos).toBeDefined()
  })

  it('does not fire the BFG without 40 cells', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'bfg')
    player.currentWeapon = 'bfg'
    player.ammo.cells = 39
    const outcome = tryFire(player, openScene(), [], [], RNG)
    expect(outcome.fired).toBe(false)
  })

  it('fist deals ×10 under berserk', () => {
    const scene = openScene()
    // A high-HP baron (1000) so neither hit clamps at 0 and the raw delta shows.
    const targetA: Enemy = spawnEnemy('baron', 2.0, 1.5)
    const targetB: Enemy = spawnEnemy('baron', 2.0, 1.5)

    const normal = createPlayer(vec(1.5, 1.5), 0)
    normal.currentWeapon = 'fist'
    tryFire(normal, scene, [targetA], [], RNG)
    const normalDmg = ENEMY_DEFS.baron.maxHealth - targetA.health

    const berserk = createPlayer(vec(1.5, 1.5), 0)
    berserk.currentWeapon = 'fist'
    berserk.berserk = true
    tryFire(berserk, scene, [targetB], [], RNG)
    const berserkDmg = ENEMY_DEFS.baron.maxHealth - targetB.health

    expect(normalDmg).toBeGreaterThan(0)
    expect(berserkDmg).toBe(normalDmg * 10)
  })
})
