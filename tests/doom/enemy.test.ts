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
})
