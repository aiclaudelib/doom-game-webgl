import { describe, expect, it } from 'vitest'
import type { Enemy, SceneQuery } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { splashDamage } from '~/doom/game/combat'
import { spawnEnemy } from '~/doom/game/enemy'
import { createPlayer } from '~/doom/game/player'
import { spawnProjectile, updateProjectile } from '~/doom/game/projectile'

function makeScene(solid: (tx: number, ty: number) => boolean): SceneQuery {
  return {
    width: 32,
    height: 32,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: (tx, ty) => solid(tx, ty),
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

describe('updateProjectile', () => {
  it('dies on a solid cell and reports a wall impact', () => {
    // Wall fills column 3. The fireball starts just before it heading +x.
    const scene = makeScene(tx => tx === 3)
    const proj = spawnProjectile('fireball', vec(2.9, 1.5), vec(1, 0), 12, true)
    expect(proj.alive).toBe(true)
    const impact = updateProjectile(proj, scene, createPlayer(vec(20, 20), 0), [], 0.1)
    expect(impact.hit).toBe('wall')
    expect(proj.alive).toBe(false)
  })

  it('reports a player impact on proximity and dies (enemy projectile)', () => {
    const scene = makeScene(() => false)
    const player = createPlayer(vec(2.0, 1.5), 0)
    const proj = spawnProjectile('fireball', vec(2.0, 1.5), vec(1, 0), 15, true)
    const impact = updateProjectile(proj, scene, player, [], 1 / 60)
    expect(impact.hit).toBe('player')
    expect(proj.alive).toBe(false)
    // updateProjectile must NOT apply damage itself (world.ts does).
    expect(player.health).toBe(100)
  })

  it('reports an enemy impact for a player projectile', () => {
    const scene = makeScene(() => false)
    const player = createPlayer(vec(20, 20), 0)
    const enemy: Enemy = spawnEnemy('demon', 2.0, 1.5)
    const proj = spawnProjectile('rocket', vec(2.0, 1.5), vec(1, 0), 80, false)
    const impact = updateProjectile(proj, scene, player, [enemy], 1 / 60)
    expect(impact.hit).toBe('enemy')
    expect(impact.enemyIndex).toBe(0)
    expect(proj.alive).toBe(false)
    expect(enemy.health).toBe(150) // damage applied by world.ts, not here
  })

  it('ignores the player for a non-enemy projectile passing nearby', () => {
    const scene = makeScene(() => false)
    const player = createPlayer(vec(2.0, 1.5), 0)
    const proj = spawnProjectile('plasma', vec(2.0, 1.5), vec(1, 0), 15, false)
    const impact = updateProjectile(proj, scene, player, [], 1 / 60)
    expect(impact.hit).toBe('none')
    expect(player.health).toBe(100)
  })

  it('homing tracer turns toward the player', () => {
    const scene = makeScene(() => false)
    // Tracer heads +x; the player sits well off to +y so the missile must turn.
    const player = createPlayer(vec(6, 6), 0)
    const proj = spawnProjectile('tracer', vec(1, 1), vec(1, 0), 50, true, 5.47)
    expect(proj.homing).toBe(true)
    const before = Math.atan2(proj.vel.y, proj.vel.x)
    // Step the canonical homing cadence (7 fixed steps) so a turn fires.
    for (let i = 0; i < 7; i++) {
      updateProjectile(proj, scene, player, [], 1 / 60)
    }
    const after = Math.atan2(proj.vel.y, proj.vel.x)
    expect(after).toBeGreaterThan(before) // rotated toward +y (the player)
  })
})

describe('splashDamage (combat)', () => {
  it('is full at the centre, less at distance, zero beyond 128u', () => {
    const center = vec(5, 5)
    const full = splashDamage(center, vec(5, 5), 0)
    expect(full).toBe(128)
    // One cell away (64u) with a zero-radius target → 128 - 64 = 64.
    const mid = splashDamage(center, vec(6, 5), 0)
    expect(mid).toBe(64)
    expect(mid).toBeLessThan(full)
    // Two cells away (128u) → 0 (at the edge).
    expect(splashDamage(center, vec(7, 5), 0)).toBe(0)
    // Beyond 128u → clamped to 0.
    expect(splashDamage(center, vec(9, 5), 0)).toBe(0)
  })

  it('a bigger target radius pulls more damage in', () => {
    const center = vec(5, 5)
    const small = splashDamage(center, vec(6, 5), 0)
    const big = splashDamage(center, vec(6, 5), 0.5)
    expect(big).toBeGreaterThan(small)
  })
})
