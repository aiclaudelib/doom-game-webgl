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
    expect(player.ammo.bullets).toBe(10)
  })

  it('heals up to but not past the maximum', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 50
    const result = applyPickup(player, 'medkit')
    expect(result.taken).toBe(true)
    expect(player.health).toBe(75)
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

describe('applyPickup — health & spheres (spec 3.4)', () => {
  it('stimpack adds +10 capped at 100', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 95
    expect(applyPickup(player, 'health').taken).toBe(true)
    expect(player.health).toBe(MAX_HEALTH)
  })

  it('health bonus adds +1 up to the 200 overheal ceiling, always below it', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 100
    expect(applyPickup(player, 'healthBonus').taken).toBe(true)
    expect(player.health).toBe(101)
    player.health = 200
    expect(applyPickup(player, 'healthBonus').taken).toBe(false)
    expect(player.health).toBe(200)
  })

  it('soulsphere adds +100 capped at 200', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 150
    expect(applyPickup(player, 'soulsphere').taken).toBe(true)
    expect(player.health).toBe(200)
  })

  it('megasphere sets health 200 and blue armor 200', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 10
    expect(applyPickup(player, 'megasphere').taken).toBe(true)
    expect(player.health).toBe(200)
    expect(player.armor).toBe(200)
    expect(player.armorType).toBe('blue')
  })
})

describe('applyPickup — armor (spec 3.4)', () => {
  it('green armor sets 100 and refuses at/above 100', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'greenArmor').taken).toBe(true)
    expect(player.armor).toBe(100)
    expect(player.armorType).toBe('green')
    expect(applyPickup(player, 'greenArmor').taken).toBe(false)
  })

  it('blue armor sets 200 and refuses at/above 200', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'blueArmor').taken).toBe(true)
    expect(player.armor).toBe(200)
    expect(player.armorType).toBe('blue')
    expect(applyPickup(player, 'blueArmor').taken).toBe(false)
  })

  it('armor bonus adds +1 up to 200, setting green only when unarmored', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'armorBonus').taken).toBe(true)
    expect(player.armor).toBe(1)
    expect(player.armorType).toBe('green')
    player.armor = 200
    expect(applyPickup(player, 'armorBonus').taken).toBe(false)
  })

  it('armor bonus never downgrades blue to green', () => {
    const player = createPlayer(vec(1, 1), 0)
    applyPickup(player, 'blueArmor')
    player.armor = 150
    expect(applyPickup(player, 'armorBonus').taken).toBe(true)
    expect(player.armorType).toBe('blue')
    expect(player.armor).toBe(151)
  })
})

describe('applyPickup — ammo sums & caps (spec 3.4)', () => {
  interface AmmoCase {
    readonly kind:
      | 'bulletBox'
      | 'shells'
      | 'shellBox'
      | 'rockets'
      | 'rocketBox'
      | 'cells'
      | 'cellPack'
    readonly ammo: 'bullets' | 'shells' | 'rockets' | 'cells'
    readonly amount: number
  }
  const cases: readonly AmmoCase[] = [
    { kind: 'bulletBox', ammo: 'bullets', amount: 50 },
    { kind: 'shells', ammo: 'shells', amount: 4 },
    { kind: 'shellBox', ammo: 'shells', amount: 20 },
    { kind: 'rockets', ammo: 'rockets', amount: 1 },
    { kind: 'rocketBox', ammo: 'rockets', amount: 5 },
    { kind: 'cells', ammo: 'cells', amount: 20 },
    { kind: 'cellPack', ammo: 'cells', amount: 100 },
  ]
  for (const { kind, ammo, amount } of cases) {
    it(`${kind} grants +${amount} ${ammo}`, () => {
      const player = createPlayer(vec(1, 1), 0)
      player.ammo[ammo] = 0
      expect(applyPickup(player, kind).taken).toBe(true)
      expect(player.ammo[ammo]).toBe(amount)
    })
  }

  it('refuses ammo when already at the cap', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.ammo.cells = player.maxAmmo.cells
    expect(applyPickup(player, 'cellPack').taken).toBe(false)
  })

  it('backpack doubles caps and grants one clip of each', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.ammo.bullets = 0
    const result = applyPickup(player, 'backpack')
    expect(result.taken).toBe(true)
    expect(player.maxAmmo).toEqual({ bullets: 400, shells: 100, rockets: 100, cells: 600 })
    expect(player.ammo.bullets).toBe(10)
    expect(player.ammo.shells).toBe(4)
    expect(player.ammo.cells).toBe(20)
    expect(player.ammo.rockets).toBe(1)
  })
})

describe('applyPickup — weapons & bundled ammo (spec 3.4)', () => {
  it('super shotgun maps to superShotgun + shells', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.ammo.shells = 0
    expect(applyPickup(player, 'superShotgun').taken).toBe(true)
    expect(player.weapons.superShotgun).toBe(true)
    expect(player.ammo.shells).toBe(8)
  })

  it('rocket launcher maps to the rocket weapon + rockets', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'rocketLauncher').taken).toBe(true)
    expect(player.weapons.rocket).toBe(true)
    expect(player.ammo.rockets).toBe(2)
  })

  it('plasma gun maps to the plasma weapon + cells', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'plasmaGun').taken).toBe(true)
    expect(player.weapons.plasma).toBe(true)
    expect(player.ammo.cells).toBe(40)
  })

  it('bfg + chainsaw grant their weapons', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'bfg').taken).toBe(true)
    expect(player.weapons.bfg).toBe(true)
    expect(applyPickup(player, 'chainsaw').taken).toBe(true)
    expect(player.weapons.chainsaw).toBe(true)
    // The chainsaw has no bundled ammo, so a second pickup is refused.
    expect(applyPickup(player, 'chainsaw').taken).toBe(false)
  })
})

describe('applyPickup — powerups & keys (spec 3.4)', () => {
  it('activates the timed powerups with canonical durations', () => {
    const player = createPlayer(vec(1, 1), 0)
    applyPickup(player, 'invuln')
    expect(player.invulnTimer).toBe(30)
    applyPickup(player, 'radsuit')
    expect(player.radSuitTimer).toBe(60)
    applyPickup(player, 'lightAmp')
    expect(player.lightAmpTimer).toBe(120)
    applyPickup(player, 'blur')
    expect(player.blurTimer).toBe(60)
  })

  it('berserk heals to 100 and sets the level-long flag', () => {
    const player = createPlayer(vec(1, 1), 0)
    player.health = 20
    expect(applyPickup(player, 'berserk').taken).toBe(true)
    expect(player.health).toBe(100)
    expect(player.berserk).toBe(true)
  })

  it('area map sets the level flag once', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'allMap').taken).toBe(true)
    expect(player.allMapRevealed).toBe(true)
    expect(applyPickup(player, 'allMap').taken).toBe(false)
  })

  it('skull keys unlock the same lock as the matching card', () => {
    const player = createPlayer(vec(1, 1), 0)
    expect(applyPickup(player, 'keySkullRed').taken).toBe(true)
    expect(player.keys.red).toBe(true)
    // The matching card is now redundant.
    expect(applyPickup(player, 'keyRed').taken).toBe(false)
  })
})
