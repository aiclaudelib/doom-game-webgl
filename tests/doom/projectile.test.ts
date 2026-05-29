import { describe, expect, it } from 'vitest'
import type { SceneQuery } from '~/doom/types'
import { vec } from '~/doom/core/vec'
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
  it('dies when it enters a solid cell', () => {
    // Wall fills column 3. The fireball starts just before it heading +x.
    const scene = makeScene(tx => tx === 3)
    const proj = spawnProjectile('fireball', vec(2.9, 1.5), vec(1, 0), 12, true)
    expect(proj.alive).toBe(true)
    // One step at PROJECTILE_SPEED (4.5) over a generous dt crosses into x≥3.
    updateProjectile(proj, createPlayer(vec(20, 20), 0), scene, 0.1)
    expect(proj.alive).toBe(false)
  })

  it('damages the player on proximity and dies', () => {
    const scene = makeScene(() => false)
    const player = createPlayer(vec(2.0, 1.5), 0)
    const before = player.health
    // Enemy fireball launched right next to the player.
    const proj = spawnProjectile('fireball', vec(2.0, 1.5), vec(1, 0), 15, true)
    updateProjectile(proj, player, scene, 1 / 60)
    expect(player.health).toBeLessThan(before)
    expect(proj.alive).toBe(false)
  })

  it('leaves the player unharmed when the projectile is not from an enemy', () => {
    const scene = makeScene(() => false)
    const player = createPlayer(vec(2.0, 1.5), 0)
    const before = player.health
    const proj = spawnProjectile('fireball', vec(2.0, 1.5), vec(1, 0), 15, false)
    updateProjectile(proj, player, scene, 1 / 60)
    expect(player.health).toBe(before)
  })
})
