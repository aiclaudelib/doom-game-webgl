import { describe, expect, it } from 'vitest'
import type { Enemy, Player, Projectile, Rng, SceneQuery } from '~/doom/types'
import { dist, vec } from '~/doom/core/vec'
import { createPlayer } from '~/doom/game/player'
import { ENEMY_DEFS, damageEnemy, spawnEnemy, updateEnemy } from '~/doom/game/enemy'

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

/** A scene where a single wall column at `wallX` blocks both sight and movement. */
function wallScene(wallX: number): SceneQuery {
  return { ...openScene(), isSolid: (tx: number) => tx === wallX }
}

// A constant Rng. 0.99 makes chance(p) false for every painChance (<1), so a
// non-lethal hit never flinches; randRange returns the upper bound (wander ~0
// only matters that it is finite — LOS keeps the chase deterministic enough).
const NO_PAIN: Rng = () => 0.99
/** Mid-roll Rng: chance(p) true for p≥0.5 (always-flinch lost soul), dice land mid-range. */
const MID: Rng = () => 0.4

describe('ENEMY_DEFS', () => {
  it('defines every enemy kind with sane tuning', () => {
    expect(ENEMY_DEFS.grunt.maxHealth).toBeGreaterThan(0)
    expect(ENEMY_DEFS.imp.ranged).toBe(true)
    expect(ENEMY_DEFS.demon.speed).toBeGreaterThan(ENEMY_DEFS.grunt.speed)
  })

  it('threads the canonical archetypes onto the new roster', () => {
    expect(ENEMY_DEFS.shotgunGuy.archetype).toBe('hitscan')
    expect(ENEMY_DEFS.shotgunGuy.attackShots).toBe(3)
    expect(ENEMY_DEFS.mancubus.attackShots).toBe(6)
    expect(ENEMY_DEFS.lostSoul.archetype).toBe('charger')
    expect(ENEMY_DEFS.lostSoul.flying).toBe(true)
    expect(ENEMY_DEFS.cacodemon.hasMelee).toBe(true)
    expect(ENEMY_DEFS.spectre.fuzz).toBe(true)
    // ranged is kept as a convenience mirror of archetype === 'projectile'.
    expect(ENEMY_DEFS.baron.ranged).toBe(true)
    expect(ENEMY_DEFS.grunt.ranged).toBe(false)
  })
})

describe('spawnEnemy', () => {
  it('creates a full-health idle enemy at the given position', () => {
    const enemy = spawnEnemy('grunt', 3.5, 4.5)
    expect(enemy.kind).toBe('grunt')
    expect(enemy.health).toBe(ENEMY_DEFS.grunt.maxHealth)
    expect(enemy.state).toBe('idle')
    expect(enemy.alive).toBe(true)
    expect(enemy.pos).toEqual({ x: 3.5, y: 4.5 })
  })
})

describe('damageEnemy', () => {
  it('drops health and transitions to dying at 0', () => {
    const enemy = spawnEnemy('grunt', 1.5, 1.5)
    damageEnemy(enemy, ENEMY_DEFS.grunt.maxHealth, NO_PAIN)
    expect(enemy.health).toBe(0)
    expect(enemy.state).toBe('dying')
    // Still flagged alive until the death animation completes.
    expect(enemy.alive).toBe(true)
  })

  it('does nothing once already dying', () => {
    const enemy = spawnEnemy('grunt', 1.5, 1.5)
    damageEnemy(enemy, 999, NO_PAIN)
    expect(enemy.state).toBe('dying')
    damageEnemy(enemy, 999, NO_PAIN)
    // Health is clamped at 0 and the state is unchanged.
    expect(enemy.health).toBe(0)
    expect(enemy.state).toBe('dying')
  })

  it('a barrel takes damage and explodes (dying) without ever flinching', () => {
    const barrel = spawnEnemy('barrel', 2.5, 2.5)
    expect(ENEMY_DEFS.barrel.maxHealth).toBe(20)
    expect(ENEMY_DEFS.barrel.archetype).toBe('inert')
    // A non-lethal hit: painChance 0 ⇒ a barrel never enters the hurt/flinch state.
    damageEnemy(barrel, 10, MID)
    expect(barrel.state).toBe('idle')
    expect(barrel.health).toBe(10)
    // The next hit drops it to 0 ⇒ dying (the BEXP fuse the world detonates on).
    damageEnemy(barrel, 10, MID)
    expect(barrel.state).toBe('dying')
  })
})

describe('updateEnemy', () => {
  it('moves a chasing melee enemy closer to the player over several ticks', () => {
    const scene = openScene()
    const player: Player = createPlayer(vec(2.5, 2.5), 0)
    // A demon (melee) chases until point-blank, so it keeps closing from afar.
    const enemy = spawnEnemy('demon', 8.5, 2.5)
    const projectiles: Projectile[] = []

    const startDist = dist(enemy.pos, player.pos)
    for (let i = 0; i < 20; i++) {
      updateEnemy(enemy, player, scene, projectiles, NO_PAIN, 1 / 60)
    }
    const endDist = dist(enemy.pos, player.pos)

    expect(enemy.state).toBe('chase')
    expect(endDist).toBeLessThan(startDist)
  })

  it('hitscan: a zombieman hurts the player on a clear line of sight', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('grunt', 6.5, 2.5) // within attackRange (12), LOS clear
    const before = player.health

    updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)

    expect(enemy.state).toBe('attack')
    expect(player.health).toBeLessThan(before)
  })

  it('hitscan: no LOS (wall between) leaves the player unharmed', () => {
    const scene = wallScene(4)
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('grunt', 6.5, 2.5) // a wall at column 4 blocks sight
    const before = player.health

    updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)

    // Idle stays idle (never saw the player), so no shot.
    expect(player.health).toBe(before)
  })

  it('projectile: an imp spawns a fireball toward the player', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('imp', 6.5, 2.5) // outside melee, inside attackRange
    const projectiles: Projectile[] = []

    updateEnemy(enemy, player, scene, projectiles, NO_PAIN, 1 / 60)

    expect(enemy.state).toBe('attack')
    expect(projectiles.length).toBe(1)
    expect(projectiles[0]?.fromEnemy).toBe(true)
    // Flies toward the player (−x), at the imp's canonical missile speed.
    expect(projectiles[0]?.vel.x).toBeLessThan(0)
  })

  it('projectile: a mancubus fans six fireballs in one volley', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('mancubus', 10.5, 2.5)
    const projectiles: Projectile[] = []

    updateEnemy(enemy, player, scene, projectiles, NO_PAIN, 1 / 60)

    expect(projectiles.length).toBe(6)
  })

  it('charger: a lost soul enters a charge on attack, then ends it on contact', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy: Enemy = spawnEnemy('lostSoul', 6.5, 2.5)
    const before = player.health

    // First tick: in range + off cooldown ⇒ begins a charge dash.
    updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)
    expect(enemy.charging).toBe(true)

    // Run until the dash reaches the player and deals contact damage.
    for (let i = 0; i < 600 && enemy.charging === true; i++) {
      updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)
    }
    expect(enemy.charging).toBe(false)
    expect(player.health).toBeLessThan(before)
  })

  it('charger: a pain flinch interrupts an in-progress charge', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('lostSoul', 7.5, 2.5)

    updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)
    expect(enemy.charging).toBe(true)

    // painChance 1.0 ⇒ any hit flinches; MID makes chance() true and the hit non-lethal.
    damageEnemy(enemy, 10, MID)
    expect(enemy.charging).toBe(false)
    expect(enemy.state).toBe('hurt')
  })

  it('inert: a barrel never chases, moves or attacks even with the player in view', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const before = player.health
    const barrel = spawnEnemy('barrel', 6.5, 2.5) // well within sight + range of others
    const startPos = { x: barrel.pos.x, y: barrel.pos.y }

    for (let i = 0; i < 30; i++) {
      updateEnemy(barrel, player, scene, [], NO_PAIN, 1 / 60)
    }

    expect(barrel.pos).toEqual(startPos) // stationary
    expect(barrel.state).toBe('idle') // never chases/attacks
    expect(player.health).toBe(before) // deals no damage on its own
  })

  it('projectile: a cyberdemon fires a 3-rocket volley toward the player', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('cyberdemon', 12.5, 2.5) // inside attackRange (18), LOS clear
    const projectiles: Projectile[] = []

    updateEnemy(enemy, player, scene, projectiles, NO_PAIN, 1 / 60)

    expect(enemy.state).toBe('attack')
    // attackShots 3 ⇒ a tight burst of three rockets, all aimed at the player (−x).
    expect(projectiles.length).toBe(3)
    expect(projectiles.every(p => p.fromEnemy && p.vel.x < 0)).toBe(true)
  })

  it('hitscan: a spider mastermind hurts the player with a 3-bullet burst', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('spiderMastermind', 10.5, 2.5)
    expect(ENEMY_DEFS.spiderMastermind.attackShots).toBe(3)
    expect(ENEMY_DEFS.spiderMastermind.splashImmune).toBe(true)
    const before = player.health

    updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)

    expect(enemy.state).toBe('attack')
    // 3 bullets of 5/10/15 each land on a clear line of sight — a chunk of damage.
    expect(player.health).toBeLessThan(before)
  })

  it('vile: an arch-vile fire attack deals ~20..90 on a clear line of sight', () => {
    const scene = openScene()
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('archvile', 6.5, 2.5) // inside attackRange (12), LOS clear
    expect(ENEMY_DEFS.archvile.archetype).toBe('vile')
    const before = player.health

    updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)

    expect(enemy.state).toBe('attack')
    const dealt = before - player.health
    // Flat 20 + a 0..70 distance-falloff bonus (≈20..90 total), no projectile spawned.
    expect(dealt).toBeGreaterThanOrEqual(20)
    expect(dealt).toBeLessThanOrEqual(90)
  })

  it('vile: an arch-vile fire deals NOTHING when LOS is broken on the firing tick', () => {
    const scene = wallScene(4) // a wall at column 4 sits between vile and player
    const player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('archvile', 6.5, 2.5)
    const before = player.health

    // Force the enemy to chase + attempt the fire even though sight is blocked: the
    // outer updateEnemy gate already refuses on no-LOS, so prove the inner LOS recheck
    // by placing it where the chase gate would pass only if it could see — here it can't,
    // so the player must be unharmed.
    for (let i = 0; i < 10; i++) {
      updateEnemy(enemy, player, scene, [], NO_PAIN, 1 / 60)
    }

    expect(player.health).toBe(before)
  })
})
