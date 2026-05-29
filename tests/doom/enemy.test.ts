import { describe, expect, it } from 'vitest'
import type { Player, Projectile, Rng, SceneQuery } from '~/doom/types'
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

// A constant Rng. 0.99 makes chance(p) false for every painChance (<1), so a
// non-lethal hit never flinches; randRange returns the upper bound (wander ~0
// only matters that it is finite — LOS keeps the chase deterministic enough).
const NO_PAIN: Rng = () => 0.99

describe('ENEMY_DEFS', () => {
  it('defines every enemy kind with sane tuning', () => {
    expect(ENEMY_DEFS.grunt.maxHealth).toBeGreaterThan(0)
    expect(ENEMY_DEFS.imp.ranged).toBe(true)
    expect(ENEMY_DEFS.demon.speed).toBeGreaterThan(ENEMY_DEFS.grunt.speed)
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
  it('moves a chasing enemy closer to the player over several ticks', () => {
    const scene = openScene()
    const player: Player = createPlayer(vec(2.5, 2.5), 0)
    const enemy = spawnEnemy('grunt', 8.5, 2.5)
    const projectiles: Projectile[] = []

    const startDist = dist(enemy.pos, player.pos)
    for (let i = 0; i < 10; i++) {
      updateEnemy(enemy, player, scene, projectiles, NO_PAIN, 1 / 60)
    }
    const endDist = dist(enemy.pos, player.pos)

    expect(enemy.state).toBe('chase')
    expect(endDist).toBeLessThan(startDist)
  })
})
