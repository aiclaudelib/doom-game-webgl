import { describe, expect, it } from 'vitest'
import type { Player, Projectile, Rng } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { splashDamage } from '~/doom/game/combat'
import { createPlayer, giveWeapon } from '~/doom/game/player'
import { WEAPONS } from '~/doom/game/weapon'
import { fireOnce, openScene } from './fireHelpers'

/**
 * Drive the shared tic-engine fire loop until exactly one shot resolves, returning the
 * WeaponKind that fired plus the projectile spawned by that shot (if any).
 */
function fireProjectileOnce(
  player: Player,
  projectiles: Projectile[],
  rng: Rng,
): { fired: string | null; dryFired: boolean; spawned: Projectile | null } {
  const before = projectiles.length
  const r = fireOnce(player, openScene(), [], projectiles, rng)
  const spawned = projectiles.length > before ? (projectiles[before] ?? null) : null
  return { fired: r.fired, dryFired: r.dryFired, spawned }
}

/** Arm `player` with `kind` as a fresh ready weapon and the given ammo. */
function armProjectile(kind: 'rocket' | 'plasma' | 'bfg', ammo: number): Player {
  const player = createPlayer(vec(1.5, 1.5), 0)
  giveWeapon(player, kind)
  player.currentWeapon = kind
  player.pspIndex = WEAPONS[kind].chain.ready
  player.pspTics = 1
  player.weaponState = 'ready'
  const ammoKind = WEAPONS[kind].ammo
  if (ammoKind !== null) {
    player.ammo[ammoKind] = ammo
  }
  return player
}

describe('projectile weapons — direct damage rolls (Phase E1/E6)', () => {
  // damage = (1 + floor(rng*8)) * base. We sweep rng across [0,1) to exercise every die face.
  function sweepDamage(kind: 'rocket' | 'plasma' | 'bfg'): number[] {
    const dmgs: number[] = []
    for (let face = 0; face < 8; face++) {
      // Pick an rng value squarely inside face f: floor(rng*8) === f.
      const rngVal = (face + 0.5) / 8
      const rng: Rng = () => rngVal
      const player = armProjectile(kind, 200)
      const projectiles: Projectile[] = []
      const r = fireProjectileOnce(player, projectiles, rng)
      expect(r.fired).toBe(kind)
      expect(r.spawned).not.toBeNull()
      if (r.spawned !== null) {
        dmgs.push(r.spawned.damage)
      }
    }
    return dmgs
  }

  it('rocket direct damage rolls 20..160 in steps of 20 (×20)', () => {
    const dmgs = sweepDamage('rocket')
    expect(Math.min(...dmgs)).toBe(20)
    expect(Math.max(...dmgs)).toBe(160)
    for (const d of dmgs) {
      expect(d % 20).toBe(0)
      expect(d).toBeGreaterThanOrEqual(20)
      expect(d).toBeLessThanOrEqual(160)
    }
  })

  it('plasma direct damage rolls 5..40 in steps of 5 (×5)', () => {
    const dmgs = sweepDamage('plasma')
    expect(Math.min(...dmgs)).toBe(5)
    expect(Math.max(...dmgs)).toBe(40)
    for (const d of dmgs) {
      expect(d % 5).toBe(0)
      expect(d).toBeGreaterThanOrEqual(5)
      expect(d).toBeLessThanOrEqual(40)
    }
  })

  it('bfg ball direct damage rolls 100..800 in steps of 100 (×100)', () => {
    const dmgs = sweepDamage('bfg')
    expect(Math.min(...dmgs)).toBe(100)
    expect(Math.max(...dmgs)).toBe(800)
    for (const d of dmgs) {
      expect(d % 100).toBe(0)
      expect(d).toBeGreaterThanOrEqual(100)
      expect(d).toBeLessThanOrEqual(800)
    }
  })
})

describe('projectile weapons — ammo debit + refuse-when-short (Phase E6)', () => {
  const RNG: Rng = () => 0.5

  it('rocket debits 1 rocket per shot', () => {
    const player = armProjectile('rocket', 3)
    const projectiles: Projectile[] = []
    fireProjectileOnce(player, projectiles, RNG)
    expect(player.ammo.rockets).toBe(2)
    expect(projectiles).toHaveLength(1)
    expect(projectiles[0]?.kind).toBe('rocket')
  })

  it('plasma debits 1 cell per shot', () => {
    const player = armProjectile('plasma', 50)
    const projectiles: Projectile[] = []
    fireProjectileOnce(player, projectiles, RNG)
    expect(player.ammo.cells).toBe(49)
    expect(projectiles[0]?.kind).toBe('plasma')
  })

  it('bfg debits 40 cells per shot and freezes its firing origin', () => {
    expect(WEAPONS.bfg.ammoPerShot).toBe(40)
    const player = armProjectile('bfg', 50)
    const projectiles: Projectile[] = []
    const r = fireProjectileOnce(player, projectiles, RNG)
    expect(r.fired).toBe('bfg')
    expect(player.ammo.cells).toBe(10)
    expect(projectiles[0]?.kind).toBe('bfg')
    // The fire-time facing is frozen for the BFG spray fan. The player faces angle 0, so the
    // muzzle direction (fromAngle(0) = +x) pins originAngle to exactly 0 — proving the spray
    // uses the FROZEN fire-time facing (later player turning never swings the cone).
    expect(projectiles[0]?.originAngle).toBeCloseTo(0, 6)
  })

  it('bfg refuses to fire with fewer than 40 cells (dry-fires, cells untouched)', () => {
    const player = armProjectile('bfg', 39)
    // Drain bullets so the empty-BFG trigger has no armed weapon to auto-switch to.
    player.ammo.bullets = 0
    const projectiles: Projectile[] = []
    const r = fireProjectileOnce(player, projectiles, RNG)
    expect(r.fired).toBeNull()
    expect(r.dryFired).toBe(true)
    expect(player.ammo.cells).toBe(39)
    expect(projectiles).toHaveLength(0)
  })
})

describe('splashDamage — peak param shrinks the blast radius (Phase E2)', () => {
  it('a smaller peak yields a smaller blast: full at centre, faster falloff', () => {
    const center = vec(5, 5)
    // Epicentre damage equals the peak.
    expect(splashDamage(center, center, 0)).toBe(128)
    expect(splashDamage(center, center, 0, 64)).toBe(64)

    // One cell away (64u), zero-radius target: peak − 64.
    const oneCell = vec(6, 5)
    expect(splashDamage(center, oneCell, 0)).toBe(64) // 128 − 64
    expect(splashDamage(center, oneCell, 0, 64)).toBe(0) // 64 − 64 = 0 (out of the smaller blast)
  })

  it('an enemy that takes splash at peak 128 takes 0 at a reduced peak', () => {
    const center = vec(5, 5)
    // Target ~1 cell out with a small radius — inside the 128 blast, outside a 32-peak blast.
    const target = vec(6, 5)
    const radius = 0.2
    const atFull = splashDamage(center, target, radius, 128)
    const atReduced = splashDamage(center, target, radius, 32)
    expect(atFull).toBeGreaterThan(0)
    expect(atReduced).toBe(0)
  })

  it('the 3-arg form is byte-identical to peak=128', () => {
    const center = vec(5, 5)
    const target = vec(5.6, 5)
    expect(splashDamage(center, target, 0.1)).toBe(splashDamage(center, target, 0.1, 128))
  })
})
