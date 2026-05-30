import { describe, expect, it } from 'vitest'
import { MAX_HEALTH } from '~/doom/config'
import { vec } from '~/doom/core/vec'
import {
  addHealth,
  createPlayer,
  damagePlayer,
  giveArmorTyped,
  giveBackpack,
  giveBerserk,
  giveWeapon,
  requestWeapon,
  startPowerup,
  tickPlayerTimers,
} from '~/doom/game/player'

describe('createPlayer', () => {
  it('starts with the fist + pistol loadout, half a clip, and full health', () => {
    const player = createPlayer(vec(2.5, 3.5), 0)
    expect(player.health).toBe(MAX_HEALTH)
    expect(player.armor).toBe(0)
    expect(player.armorType).toBe('none')
    expect(player.weapons.fist).toBe(true)
    expect(player.weapons.pistol).toBe(true)
    expect(player.weapons.shotgun).toBe(false)
    expect(player.weapons.chaingun).toBe(false)
    expect(player.currentWeapon).toBe('pistol')
    expect(player.ammo.bullets).toBe(50)
    expect(player.pos).toEqual({ x: 2.5, y: 3.5 })
  })

  it('starts with no powerups active and backpack unclaimed', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(player.invulnTimer).toBe(0)
    expect(player.radSuitTimer).toBe(0)
    expect(player.lightAmpTimer).toBe(0)
    expect(player.blurTimer).toBe(0)
    expect(player.allMapRevealed).toBe(false)
    expect(player.hasBackpack).toBe(false)
  })
})

describe('damagePlayer', () => {
  it('routes part of the damage through green armor (1/3 absorb)', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.armor = 100
    player.armorType = 'green'
    damagePlayer(player, 30)
    // Green absorbs floor(30/3)=10, health loses the remaining 20.
    expect(player.armor).toBe(90)
    expect(player.health).toBe(MAX_HEALTH - 20)
  })

  it('routes more damage through blue armor (1/2 absorb)', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.armor = 100
    player.armorType = 'blue'
    damagePlayer(player, 30)
    // Blue absorbs floor(30/2)=15, health loses the remaining 15.
    expect(player.armor).toBe(85)
    expect(player.health).toBe(MAX_HEALTH - 15)
  })

  it('resets armorType to none when armor empties', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.armor = 2
    player.armorType = 'green'
    damagePlayer(player, 30)
    expect(player.armor).toBe(0)
    expect(player.armorType).toBe('none')
  })

  it('hits health directly when there is no armor', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(player.armor).toBe(0)
    damagePlayer(player, 30)
    expect(player.health).toBe(MAX_HEALTH - 30)
  })

  it('invulnerability blocks damage below 1000 but not telefrags', () => {
    const player = createPlayer(vec(1, 1), 0)
    startPowerup(player, 'invuln', 30)
    damagePlayer(player, 999)
    expect(player.health).toBe(MAX_HEALTH)
    damagePlayer(player, 1000)
    expect(player.health).toBe(0)
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

describe('armor & backpack mutators', () => {
  it('giveArmorTyped refuses when current armor already meets the points', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.armor = 100
    expect(giveArmorTyped(player, 'green', 100)).toBe(false)
    // A higher tier still raises it.
    expect(giveArmorTyped(player, 'blue', 200)).toBe(true)
    expect(player.armorType).toBe('blue')
    expect(player.armor).toBe(200)
  })

  it('giveBackpack doubles caps once, then only tops up clips', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.ammo.bullets = 0
    giveBackpack(player)
    expect(player.maxAmmo.bullets).toBe(400)
    expect(player.maxAmmo.cells).toBe(600)
    expect(player.ammo.bullets).toBe(10)
    // A second backpack does not re-double, only adds another clip.
    giveBackpack(player)
    expect(player.maxAmmo.bullets).toBe(400)
    expect(player.ammo.bullets).toBe(20)
  })
})

describe('giveBerserk', () => {
  it('heals to 100, latches the flag, and requests the fist', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 10
    giveBerserk(player)
    expect(player.health).toBe(100)
    expect(player.berserk).toBe(true)
    expect(player.pendingWeapon).toBe('fist')
  })

  it('never overheals past 100', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 200
    giveBerserk(player)
    expect(player.health).toBe(200)
  })
})

describe('tickPlayerTimers', () => {
  it('decays the timed powerups by dt and clamps at 0', () => {
    const player = createPlayer(vec(1, 1), 0)
    startPowerup(player, 'invuln', 1)
    startPowerup(player, 'blur', 0.05)
    tickPlayerTimers(player, 0.1)
    expect(player.invulnTimer).toBeCloseTo(0.9, 5)
    expect(player.blurTimer).toBe(0)
  })

  it('berserk and allMap persist across ticks', () => {
    const player = createPlayer(vec(1, 1), 0)
    giveBerserk(player)
    player.allMapRevealed = true
    tickPlayerTimers(player, 5)
    expect(player.berserk).toBe(true)
    expect(player.allMapRevealed).toBe(true)
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
