import { describe, expect, it } from 'vitest'
import type { Enemy, Projectile, Rng } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { createPlayer, giveWeapon } from '~/doom/game/player'
import { ENEMY_DEFS, spawnEnemy } from '~/doom/game/enemy'
import { WEAPONS, updateWeapon, weaponBySlot } from '~/doom/game/weapon'
import { TIC, fireOnce, openScene } from './fireHelpers'

// Constant Rng → no flinch (chance false) and deterministic spread. Melee still rolls
// rollDamage = (1+floor(0.99*10))*2 = 20. Hitscan now uses rollHitscanDamage =
// 5*((floor(0.99*256)%3)+1) = 5*((253%3)+1) = 5*(1+1) = 10 per pellet, and rndDiff =
// 253-253 = 0 so spread (and SSG slope) collapse to 0 → every pellet lands dead-on.
const RNG: Rng = () => 0.99

// Per-pellet hitscan damage under the constant RNG (see above): 5*((253%3)+1) = 10.
const HITSCAN_PELLET_DMG = 5 * ((Math.floor(0.99 * 256) % 3) + 1)

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

describe('firing (tic engine)', () => {
  it('consumes one bullet and reports fired for the pistol', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    const before = player.ammo.bullets
    const result = fireOnce(player, openScene(), [], [], RNG)
    expect(result.fired).toBe('pistol')
    expect(player.ammo.bullets).toBe(before - 1)
    expect(player.weaponState).toBe('firing')
  })

  it('does not fire an empty weapon (dry-fires instead)', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.ammo.bullets = 0
    const result = fireOnce(player, openScene(), [], [], RNG)
    expect(result.fired).toBeNull()
    expect(result.dryFired).toBe(true)
  })

  it('does not fire while still raising', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    // Mid-raise: the gun is sliding up and must not start a new shot on a ready-less tic.
    player.weaponState = 'raising'
    player.pspIndex = WEAPONS.pistol.chain.up
    player.pspTics = 1
    player.pspSy = 80
    const before = player.ammo.bullets
    updateWeapon(player, true, openScene(), [], [], RNG, TIC)
    expect(player.ammo.bullets).toBe(before)
  })

  it('fires def.pellets hitscans for the shotgun', () => {
    expect(WEAPONS.shotgun.pellets).toBe(7)
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'shotgun')
    player.currentWeapon = 'shotgun'
    player.ammo.shells = 5

    // A demon one tile ahead: rndDiff=0 collapses spread to 0 so every pellet lands
    // within ENEMY_HIT_RADIUS, total damage = 7 × rollHitscanDamage (10), proving all
    // pellets resolved.
    const demon: Enemy = spawnEnemy('demon', 2.5, 1.5)
    const enemies: Enemy[] = [demon]
    const result = fireOnce(player, openScene(), enemies, [], RNG)

    expect(result.fired).toBe('shotgun')
    expect(player.ammo.shells).toBe(4)
    expect(demon.health).toBe(
      ENEMY_DEFS.demon.maxHealth - WEAPONS.shotgun.pellets * HITSCAN_PELLET_DMG,
    )
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
    const result = fireOnce(player, openScene(), [target], [], RNG)

    expect(result.fired).toBe('superShotgun')
    expect(player.ammo.shells).toBe(3)
    // rndDiff = 253-253 = 0 → both the horizontal spread and the SSG vertical slope are
    // 0, so all 20 pellets land dead-on a target one tile away (slope*along = 0 clears the
    // ENEMY_HALF_HEIGHT gate). Each lands rollHitscanDamage (10).
    expect(target.health).toBe(ENEMY_DEFS.baron.maxHealth - 20 * HITSCAN_PELLET_DMG)
  })

  it('spawns a projectile for the rocket launcher and consumes a rocket', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'rocket')
    player.currentWeapon = 'rocket'
    player.ammo.rockets = 3
    const projectiles: Projectile[] = []
    const result = fireOnce(player, openScene(), [], projectiles, RNG)
    expect(result.fired).toBe('rocket')
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
    const result = fireOnce(player, openScene(), [], projectiles, RNG)
    expect(result.fired).toBe('bfg')
    expect(player.ammo.cells).toBe(10)
    expect(projectiles[0]?.kind).toBe('bfg')
    // The fire-time facing is frozen for the spray fan. Player faces angle 0 here, so the
    // muzzle direction (fromAngle(0) = +x) gives a frozen originAngle of exactly 0.
    expect(projectiles[0]?.originAngle).toBeCloseTo(0, 6)
  })

  it('does not fire the BFG without 40 cells', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'bfg')
    player.currentWeapon = 'bfg'
    player.ammo.cells = 39
    // Drain the pistol too so the empty-BFG trigger has no armed weapon to auto-switch
    // to — the BFG simply refuses and dry-fires, cells untouched.
    player.ammo.bullets = 0
    const result = fireOnce(player, openScene(), [], [], RNG)
    expect(result.fired).toBeNull()
    expect(result.dryFired).toBe(true)
    expect(player.ammo.cells).toBe(39)
  })

  it('fist deals ×10 under berserk', () => {
    const scene = openScene()
    // A high-HP baron (1000) so neither hit clamps at 0 and the raw delta shows.
    const targetA: Enemy = spawnEnemy('baron', 2.0, 1.5)
    const targetB: Enemy = spawnEnemy('baron', 2.0, 1.5)

    const normal = createPlayer(vec(1.5, 1.5), 0)
    normal.currentWeapon = 'fist'
    fireOnce(normal, scene, [targetA], [], RNG)
    const normalDmg = ENEMY_DEFS.baron.maxHealth - targetA.health

    const berserk = createPlayer(vec(1.5, 1.5), 0)
    berserk.currentWeapon = 'fist'
    berserk.berserk = true
    fireOnce(berserk, scene, [targetB], [], RNG)
    const berserkDmg = ENEMY_DEFS.baron.maxHealth - targetB.health

    expect(normalDmg).toBeGreaterThan(0)
    expect(berserkDmg).toBe(normalDmg * 10)
  })
})
