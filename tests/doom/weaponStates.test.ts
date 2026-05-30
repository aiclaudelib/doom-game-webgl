import { describe, expect, it } from 'vitest'
import type { Enemy, Player, Projectile, Rng, SceneQuery, WeaponKind } from '~/doom/types'
import { mulberry32 } from '~/doom/core/rng'
import { vec } from '~/doom/core/vec'
import { createPlayer, giveWeapon, requestWeapon } from '~/doom/game/player'
import {
  WEAPONS,
  fireDelaySeconds,
  maybeAutoSwitch,
  nextOwnedWeapon,
  pickBestArmedWeapon,
  updateWeapon,
  weaponBySlot,
} from '~/doom/game/weapon'

const TIC = 1 / 35
const RNG: Rng = () => 0.99

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

function tick(player: Player, attack: boolean, rng: Rng = RNG): ReturnType<typeof updateWeapon> {
  const enemies: Enemy[] = []
  const projectiles: Projectile[] = []
  return updateWeapon(player, attack, openScene(), enemies, projectiles, rng, TIC)
}

/** Raw integer tic span atk → reFire (inclusive), derived from the engine's helper. */
function atkToReFireTics(kind: WeaponKind): number {
  return Math.round(fireDelaySeconds(WEAPONS[kind]) * 35)
}

describe('weaponStates — cadence', () => {
  // fireDelaySeconds is the §2 definition: sum of tics atk→reFire inclusive / TICRATE.
  const expected: Record<string, number> = {
    fist: 22,
    pistol: 19,
    shotgun: 44,
    superShotgun: 62,
    chaingun: 8,
    rocket: 20,
    plasma: 23, // 3 (firePlasma head) + 20 (S_PLASMA2 release frame); held cadence is 3.
    bfg: 60,
  }
  for (const [kind, tics] of Object.entries(expected)) {
    it(`${kind} fireDelaySeconds matches its atk→reFire tic span`, () => {
      expect(fireDelaySeconds(WEAPONS[kind as WeaponKind])).toBeCloseTo(tics / 35, 6)
    })
  }
})

describe('weaponStates — tic sums', () => {
  it('matches the canonical atk→reFire integer tic sums', () => {
    expect(atkToReFireTics('fist')).toBe(22)
    expect(atkToReFireTics('pistol')).toBe(19)
    expect(atkToReFireTics('shotgun')).toBe(44)
    expect(atkToReFireTics('superShotgun')).toBe(62)
    expect(atkToReFireTics('rocket')).toBe(20)
    expect(atkToReFireTics('bfg')).toBe(60)
  })

  it('plasma atk-head loop is 3 tics (held cadence, reFire short-circuits S_PLASMA2)', () => {
    const c = WEAPONS.plasma.chain
    expect(c.states[c.atk]?.tics).toBe(3)
    expect(c.states[c.atk]?.action).toBe('firePlasma')
  })

  it('chaingun shot head is 4 tics and the A/B pair is 8 tics', () => {
    const c = WEAPONS.chaingun.chain
    expect(c.states[c.atk]?.tics).toBe(4)
    const second = c.states[c.atk]?.next ?? -1
    expect(c.states[second]?.tics).toBe(4)
    expect((c.states[c.atk]?.tics ?? 0) + (c.states[second]?.tics ?? 0)).toBe(8)
  })
})

describe('weaponStates — refire loop', () => {
  it('an automatic weapon (chaingun) keeps firing while attack is held', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chaingun')
    player.currentWeapon = 'chaingun'
    player.pspIndex = WEAPONS.chaingun.chain.ready
    player.pspTics = 1
    player.weaponState = 'ready'
    player.ammo.bullets = 100

    let shots = 0
    for (let i = 0; i < 120; i++) {
      const r = tick(player, true)
      if (r.fired !== null) {
        shots++
      }
    }
    // Held: fires repeatedly. ~120 tics / 4-tic shot head ⇒ many shots.
    expect(shots).toBeGreaterThan(10)
  })

  it('a semi-auto weapon (pistol) fires once per held burst then waits at ready', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.ammo.bullets = 100

    // Hold the trigger continuously: the pistol fires exactly once (no auto-refire),
    // since A_ReFire only re-loops while +attack is HELD — but the edge press latched
    // once and is consumed; held `fire` is not automatic, so world reads `input.fire`
    // (edge). Here we emulate a single edge by latching attack only on the first tick.
    let shots = 0
    for (let i = 0; i < 60; i++) {
      const r = tick(player, i === 0)
      if (r.fired !== null) {
        shots++
      }
    }
    expect(shots).toBe(1)
  })

  it('releasing an automatic weapon unwinds back to the ready head', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chaingun')
    player.currentWeapon = 'chaingun'
    player.pspIndex = WEAPONS.chaingun.chain.ready
    player.pspTics = 1
    player.weaponState = 'ready'
    player.ammo.bullets = 100

    for (let i = 0; i < 12; i++) {
      tick(player, true)
    }
    // Release: no more attack. The latched final shot resolves, then the chain unwinds
    // back to the static ready head (one refire cycle of slack before settling).
    for (let i = 0; i < 30; i++) {
      tick(player, false)
    }
    expect(player.weaponState).toBe('ready')
    expect(player.pspIndex).toBe(WEAPONS.chaingun.chain.ready)
  })
})

describe('weaponStates — plasma cadence + flash (Phase E3)', () => {
  function armedPlasma(): Player {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'plasma')
    player.currentWeapon = 'plasma'
    player.pspIndex = WEAPONS.plasma.chain.ready
    player.pspTics = 1
    player.weaponState = 'ready'
    player.ammo.cells = 200
    return player
  }

  it('held plasma fires every 3 tics (A_ReFire short-circuits the 20-tic S_PLASMA2)', () => {
    const player = armedPlasma()
    // Record the tic index of every shot across a long held burst. The first shot lands a
    // few tics in (latch → ready → atk), then every subsequent shot is exactly 3 tics apart
    // because reFire loops straight back to the 3-tic firePlasma head while held.
    const shotTics: number[] = []
    for (let i = 0; i < 60; i++) {
      const r = tick(player, true)
      if (r.fired === 'plasma') {
        shotTics.push(i)
      }
    }
    expect(shotTics.length).toBeGreaterThan(10)
    // Steady-state cadence: consecutive shots are 3 tics apart (drop the very first gap,
    // which includes the ready→atk wind-up).
    const gaps = shotTics.slice(1).map((t, idx) => t - (shotTics[idx] ?? 0))
    const steady = gaps.slice(1) // skip the wind-up gap
    for (const g of steady) {
      expect(g).toBe(3)
    }
  })

  it('the muzzle flash head alternates PLSF A/B deterministically by seed', () => {
    const chain = WEAPONS.plasma.chain
    // firePlasma picks chain.flash + (rng()<0.5 ? 0 : 1) (PLSF A or B). A seeded run records
    // the chosen flash head right after each shot; replaying the same seed must reproduce the
    // exact same head sequence (deterministic), and over a long held burst BOTH heads appear.
    function run(seed: number): number[] {
      const rng = mulberry32(seed)
      const player = armedPlasma()
      const heads: number[] = []
      for (let i = 0; i < 90; i++) {
        const r = updateWeapon(player, true, openScene(), [], [], rng, TIC)
        if (r.fired === 'plasma') {
          heads.push(player.flashIndex)
        }
      }
      return heads
    }
    const first = run(1)
    // Both flash heads (chain.flash and chain.flash+1) appear — the alternation is live.
    expect(first).toContain(chain.flash)
    expect(first).toContain(chain.flash + 1)
    // Determinism: the same seed reproduces the identical head sequence (no wall-clock).
    expect(run(1)).toEqual(first)
  })
})

describe('weaponStates — accuracy hook (refireCount)', () => {
  it('starts at 0 and increments under sustained automatic fire', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chaingun')
    player.currentWeapon = 'chaingun'
    player.pspIndex = WEAPONS.chaingun.chain.ready
    player.pspTics = 1
    player.weaponState = 'ready'
    player.ammo.bullets = 100
    expect(player.refireCount).toBe(0)

    for (let i = 0; i < 60; i++) {
      tick(player, true)
    }
    expect(player.refireCount).toBeGreaterThan(0)
  })
})

describe('weaponStates — raise / lower', () => {
  it('lowering commits the swap at the bottom, then raises back to ready', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'shotgun')
    player.ammo.shells = 10

    requestWeapon(player, 'shotgun')
    expect(player.weaponState).toBe('lowering')
    expect(player.currentWeapon).toBe('pistol') // not yet committed
    expect(player.pendingWeapon).toBe('shotgun')

    let maxLowerSy = player.pspSy
    let committedWhileLowering = true
    for (let i = 0; i < 200; i++) {
      tick(player, false)
      if (player.weaponState === 'lowering') {
        maxLowerSy = Math.max(maxLowerSy, player.pspSy)
        // currentWeapon must only flip at/after the bottom — never while still lowering.
        if (player.currentWeapon !== 'pistol') {
          committedWhileLowering = false
        }
      }
      if (player.weaponState === 'ready' && player.currentWeapon === 'shotgun') {
        break
      }
    }
    // The gun slides down (sy climbs from WEAPONTOP=32 toward WEAPONBOTTOM=128); the
    // commit happens only once pspSy >= 128, proving it bottomed out.
    expect(maxLowerSy).toBeGreaterThan(32)
    expect(committedWhileLowering).toBe(true)
    expect(player.currentWeapon).toBe('shotgun')
    expect(player.weaponState).toBe('ready')
    expect(player.pspSy).toBe(32) // fully raised
  })

  it('does not start a fire while lowering or raising', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'shotgun')
    player.ammo.shells = 10
    player.ammo.bullets = 100
    requestWeapon(player, 'shotgun')

    let firedDuringTravel = false
    for (let i = 0; i < 200; i++) {
      const traveling = player.weaponState === 'lowering' || player.weaponState === 'raising'
      const r = tick(player, true)
      if (traveling && r.fired !== null) {
        firedDuringTravel = true
      }
      if (player.weaponState === 'ready' && player.currentWeapon === 'shotgun') {
        break
      }
    }
    expect(firedDuringTravel).toBe(false)
  })
})

describe('weaponStates — slot / cycle / auto-switch', () => {
  it('weaponBySlot maps the default loadout and prefers owned variants', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    expect(weaponBySlot(1, player)).toBe('fist')
    expect(weaponBySlot(3, player)).toBe('shotgun')
    giveWeapon(player, 'chainsaw')
    giveWeapon(player, 'superShotgun')
    expect(weaponBySlot(1, player)).toBe('chainsaw')
    expect(weaponBySlot(3, player)).toBe('superShotgun')
  })

  it('weaponBySlot cycles intra-slot when already in the slot', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chainsaw')
    player.currentWeapon = 'fist'
    expect(weaponBySlot(1, player)).toBe('chainsaw')
    player.currentWeapon = 'chainsaw'
    expect(weaponBySlot(1, player)).toBe('fist')
  })

  it('nextOwnedWeapon walks owned weapons in slot order, wrapping', () => {
    const player = createPlayer(vec(1.5, 1.5), 0) // owns fist + pistol
    player.currentWeapon = 'fist'
    expect(nextOwnedWeapon(player, 1)).toBe('pistol')
    expect(nextOwnedWeapon(player, -1)).toBe('pistol') // wraps
    player.currentWeapon = 'pistol'
    expect(nextOwnedWeapon(player, 1)).toBe('fist')
  })

  it('empty pistol with shells + shotgun auto-switches to the shotgun (no dry-fire)', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'shotgun')
    player.ammo.bullets = 0
    player.ammo.shells = 8
    player.currentWeapon = 'pistol'
    expect(pickBestArmedWeapon(player)).toBe('shotgun')

    let dry = false
    for (let i = 0; i < 20; i++) {
      const r = tick(player, true)
      if (r.dryFired) {
        dry = true
      }
      if (player.pendingWeapon === 'shotgun') {
        break
      }
    }
    expect(player.pendingWeapon).toBe('shotgun')
    expect(dry).toBe(false)
  })

  it('default fist+pistol with empty pistol dry-fires and never auto-switches to fist', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.ammo.bullets = 0
    expect(pickBestArmedWeapon(player)).toBeNull()

    let dry = false
    for (let i = 0; i < 20 && !dry; i++) {
      const r = tick(player, true)
      if (r.dryFired) {
        dry = true
      }
    }
    expect(dry).toBe(true)
    expect(player.pendingWeapon).toBeNull()
    expect(player.currentWeapon).toBe('pistol')
  })

  it('a higher-rank pickup triggers maybeAutoSwitch', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'rocket')
    maybeAutoSwitch(player, 'rocket')
    expect(player.pendingWeapon).toBe('rocket')
  })

  it('a lower-rank pickup does NOT auto-switch', () => {
    const player = createPlayer(vec(1.5, 1.5), 0) // current pistol (rank 2)
    giveWeapon(player, 'fist') // already owned; rank 1 < 2
    maybeAutoSwitch(player, 'fist')
    expect(player.pendingWeapon).toBeNull()
  })
})

describe('weaponStates — determinism', () => {
  it('same seed + same input script yields an identical psprite trace', () => {
    function run(): string {
      const player = createPlayer(vec(1.5, 1.5), 0)
      player.ammo.bullets = 100
      const script = [true, true, false, false, true, false, true, true, false, true]
      const trace: string[] = []
      for (let i = 0; i < 80; i++) {
        const attack = script[i % script.length] ?? false
        tick(player, attack, () => 0.42)
        trace.push(`${player.pspIndex},${player.pspTics},${player.flashIndex}`)
      }
      return trace.join('|')
    }
    expect(run()).toBe(run())
  })
})
