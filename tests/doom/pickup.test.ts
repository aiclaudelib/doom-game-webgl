import { describe, expect, it } from 'vitest'
import { MAX_HEALTH } from '~/doom/config'
import { vec } from '~/doom/core/vec'
import { createPlayer } from '~/doom/game/player'
import { applyPickup, spawnPickup } from '~/doom/game/pickup'

describe('spawnPickup', () => {
  it('creates an active pickup at the position', () => {
    const pickup = spawnPickup('health', 3.5, 4.5)
    expect(pickup.kind).toBe('health')
    expect(pickup.active).toBe(true)
    expect(pickup.pos).toEqual({ x: 3.5, y: 4.5 })
  })
})

describe('applyPickup', () => {
  it('grants a new weapon and reports taken', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(player.weapons.shotgun).toBe(false)
    const result = applyPickup(player, 'shotgun')
    expect(result.taken).toBe(true)
    expect(result.message).toContain('SHOTGUN')
    expect(player.weapons.shotgun).toBe(true)
  })

  it('grants ammo and reports taken', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.ammo.bullets = 0
    const result = applyPickup(player, 'bullets')
    expect(result.taken).toBe(true)
    expect(player.ammo.bullets).toBeGreaterThan(0)
  })

  it('heals up to but not past the maximum', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 50
    const result = applyPickup(player, 'medkit')
    expect(result.taken).toBe(true)
    expect(player.health).toBeGreaterThan(50)
    expect(player.health).toBeLessThanOrEqual(MAX_HEALTH)
  })

  it('reports not-taken for health when already full', () => {
    const player = createPlayer(vec(1, 1), 0)
    // createPlayer starts at full health.
    expect(player.health).toBe(MAX_HEALTH)
    const result = applyPickup(player, 'health')
    expect(result.taken).toBe(false)
    expect(result.message).toBe('')
    expect(player.health).toBe(MAX_HEALTH)
  })
})
