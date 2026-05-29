import { describe, expect, it } from 'vitest'
import { MAX_HEALTH } from '~/doom/config'
import { vec } from '~/doom/core/vec'
import {
  addHealth,
  createPlayer,
  damagePlayer,
  giveWeapon,
  requestWeapon,
} from '~/doom/game/player'

describe('createPlayer', () => {
  it('starts with the fist + pistol loadout, half a clip, and full health', () => {
    const player = createPlayer(vec(2.5, 3.5), 0)
    expect(player.health).toBe(MAX_HEALTH)
    expect(player.armor).toBe(0)
    expect(player.weapons.fist).toBe(true)
    expect(player.weapons.pistol).toBe(true)
    expect(player.weapons.shotgun).toBe(false)
    expect(player.weapons.chaingun).toBe(false)
    expect(player.currentWeapon).toBe('pistol')
    expect(player.ammo.bullets).toBe(50)
    expect(player.pos).toEqual({ x: 2.5, y: 3.5 })
  })
})

describe('damagePlayer', () => {
  it('routes part of the damage through armor', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.armor = 100
    damagePlayer(player, 30)
    // Armor soaks one third (10), health loses the remaining two thirds (20).
    expect(player.armor).toBe(90)
    expect(player.health).toBe(MAX_HEALTH - 20)
  })

  it('hits health directly when there is no armor', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(player.armor).toBe(0)
    damagePlayer(player, 30)
    expect(player.health).toBe(MAX_HEALTH - 30)
  })
})

describe('addHealth', () => {
  it('clamps the result to the maximum', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 95
    addHealth(player, 25, MAX_HEALTH)
    expect(player.health).toBe(MAX_HEALTH)
  })
})

describe('requestWeapon', () => {
  it('only switches to an owned weapon', () => {
    const player = createPlayer(vec(1, 1), 0)
    // Shotgun is not owned yet → no switch begins.
    requestWeapon(player, 'shotgun')
    expect(player.pendingWeapon).toBeNull()
    expect(player.weaponState).toBe('ready')

    // After acquiring it, the switch starts.
    giveWeapon(player, 'shotgun')
    requestWeapon(player, 'shotgun')
    expect(player.pendingWeapon).toBe('shotgun')
    expect(player.weaponState).toBe('switching')
  })

  it('does not re-switch to the already-equipped weapon', () => {
    const player = createPlayer(vec(1, 1), 0)
    requestWeapon(player, 'pistol')
    expect(player.pendingWeapon).toBeNull()
    expect(player.weaponState).toBe('ready')
  })
})
