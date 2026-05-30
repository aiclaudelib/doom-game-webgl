import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '~/doom/types'
import { mulberry32 } from '~/doom/core/rng'
import { vec } from '~/doom/core/vec'
import * as combat from '~/doom/game/combat'
import { ENEMY_HALF_HEIGHT } from '~/doom/config'
import { createPlayer, giveWeapon } from '~/doom/game/player'
import { spawnEnemy } from '~/doom/game/enemy'
import { SLOPE_UNIT, WEAPONS, rollHitscanDamage, updateWeapon } from '~/doom/game/weapon'
import { TIC, fireOnce, openScene } from './fireHelpers'

/** Arm `player` with a freshly-equipped, ammo-loaded weapon ready to fire. */
function arm(kind: 'pistol' | 'shotgun' | 'superShotgun' | 'chaingun'): Player {
  const player = createPlayer(vec(2.5, 2.5), 0)
  giveWeapon(player, kind)
  player.currentWeapon = kind
  player.weaponState = 'ready'
  player.pspIndex = WEAPONS[kind].chain.ready
  player.pspTics = 1
  player.pspSy = 32
  player.ammo.bullets = 999
  player.ammo.shells = 999
  return player
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('chaingun ammo guard (no phantom bullet)', () => {
  // The CHGG atk chain dispatches fireCGun on TWO consecutive frames (CHGG A then B). Without
  // the fire-action ammo guard, the A frame fires the last bullet (→0) and 4 tics later the B
  // frame fires AGAIN (→-1). The guard makes an out-of-ammo fire frame a no-op.
  function countChaingunFires(
    startBullets: number,
    ticCap: number,
  ): { fires: number; minAmmo: number } {
    const player = arm('chaingun')
    player.ammo.bullets = startBullets
    let fires = 0
    let minAmmo = startBullets
    for (let i = 0; i < ticCap; i++) {
      // Held automatic fire (the real world feeds input.firing each frame).
      const r = updateWeapon(player, true, openScene(), [], [], mulberry32(7), TIC)
      if (r.fired === 'chaingun') {
        fires++
      }
      minAmmo = Math.min(minAmmo, player.ammo.bullets)
    }
    return { fires, minAmmo }
  }

  it('with 1 bullet fires EXACTLY once and ammo never goes below 0', () => {
    const { fires, minAmmo } = countChaingunFires(1, 60)
    expect(fires).toBe(1)
    expect(minAmmo).toBeGreaterThanOrEqual(0)
  })

  it('with N bullets fires exactly N times (one debit per shot, no phantom)', () => {
    for (const n of [1, 2, 3, 5, 8]) {
      const { fires, minAmmo } = countChaingunFires(n, 400)
      expect(fires).toBe(n)
      expect(minAmmo).toBe(0) // drains to exactly empty, never negative
    }
  })
})

describe('Phase C — hitscan damage roll', () => {
  it('fireHitscan only ever deals {5,10,15} per pellet', () => {
    // Engine-path invariant: a huge-HP target one tile ahead absorbs every shot; the
    // per-shot health delta is exactly one rolled damage value (pistol = 1 pellet).
    const rng = mulberry32(12345)
    const seen = new Set<number>()
    for (let i = 0; i < 3000; i++) {
      const player = arm('pistol')
      player.refireCount = 1 // force the spread path so the same rng pattern is exercised
      const target = spawnEnemy('baron', 3.5, 2.5)
      target.health = 1_000_000
      const before = target.health
      fireOnce(player, openScene(), [target], [], rng)
      const dmg = before - target.health
      expect([5, 10, 15]).toContain(dmg)
      seen.add(dmg)
    }
    expect(seen).toEqual(new Set([5, 10, 15]))
  })

  it('the %3 byte bias makes 5 the modal damage; the gap to 10/15 is <1%', () => {
    // Test the REAL exported rollHitscanDamage, not a re-implementation. Of the 256 byte
    // values 86 map to 5, 85 to 10, 85 to 15, so 5 is faithfully favoured while 10 and 15 are
    // TIED in expectation (asserting 10>=15 would test sampling noise, not the mechanic).
    const rng = mulberry32(12345)
    const counts: Record<number, number> = { 5: 0, 10: 0, 15: 0 }
    const seen = new Set<number>()
    const SAMPLES = 2_000_000
    for (let i = 0; i < SAMPLES; i++) {
      const d = rollHitscanDamage(rng)
      seen.add(d)
      counts[d] = (counts[d] ?? 0) + 1
    }
    // Only {5,10,15} are ever produced (checked once, out of the hot loop).
    expect(seen).toEqual(new Set([5, 10, 15]))
    expect(counts[5]).toBeGreaterThanOrEqual(counts[10] ?? 0)
    expect(counts[5]).toBeGreaterThanOrEqual(counts[15] ?? 0)
    // All three buckets are within 1% of one another (the bias is exactly 1/256).
    const gap5to10 = Math.abs((counts[5] ?? 0) - (counts[10] ?? 0)) / SAMPLES
    const gap5to15 = Math.abs((counts[5] ?? 0) - (counts[15] ?? 0)) / SAMPLES
    expect(gap5to10).toBeLessThan(0.01)
    expect(gap5to15).toBeLessThan(0.01)
  })

  it('255*(1<<5)*SLOPE_UNIT pins the SSG slope scale (~0.12 rise/run at max byte)', () => {
    // The vertical slope gate scales (P_Random−P_Random) << verticalSlopeShift(=5) by SLOPE_UNIT.
    // Golden value: the extreme byte (255) maps to ≈0.11995 rise/run — pinned so a drift in
    // SLOPE_UNIT (too large → everything misses, too small → everything lands) is caught.
    expect(255 * (1 << 5) * SLOPE_UNIT).toBeCloseTo(0.11995, 4)
  })
})

describe('Phase C — horizontal spread shape & bounds', () => {
  // Capture the angle handed to combat.hitscan for each pellet by spying on the module.
  function captureAngles(
    kind: 'pistol' | 'shotgun' | 'superShotgun' | 'chaingun',
    shots: number,
    seed: number,
    refireCount: number,
  ): number[] {
    const rng = mulberry32(seed)
    const real = combat.hitscan.bind(combat)
    const angles: number[] = []
    const spy = vi
      .spyOn(combat, 'hitscan')
      .mockImplementation((scene, enemies, origin, angle, range, slope) => {
        angles.push(angle)
        return real(scene, enemies, origin, angle, range, slope)
      })
    for (let i = 0; i < shots; i++) {
      const player = arm(kind)
      player.refireCount = refireCount
      // Empty scene → no enemy, but spread/slope rng is still consumed before the call.
      fireOnce(player, openScene(), [], [], rng)
    }
    spy.mockRestore()
    return angles
  }

  it('shift=18 stays within ±0.09818 rad; shift=19 (SSG) within ±0.19636 rad', () => {
    const sg = captureAngles('shotgun', 1500, 1, 0)
    const ssg = captureAngles('superShotgun', 600, 2, 0)
    expect(sg.length).toBe(1500 * WEAPONS.shotgun.pellets)
    const sgMax = Math.max(...sg.map(a => Math.abs(a)))
    const ssgMax = Math.max(...ssg.map(a => Math.abs(a)))
    expect(sgMax).toBeLessThanOrEqual(0.09818)
    expect(ssgMax).toBeLessThanOrEqual(0.19636)
    // SSG cone is ~2× the shotgun cone (shift 19 vs 18).
    expect(ssgMax).toBeGreaterThan(sgMax * 1.9)
  })

  it('is triangular: denser near centre than at the edge', () => {
    const angles = captureAngles('shotgun', 4000, 7, 0)
    const near = angles.filter(a => Math.abs(a) < 0.02).length
    const edge = angles.filter(a => Math.abs(a) > 0.06 && Math.abs(a) < 0.08).length
    expect(near).toBeGreaterThan(edge)
  })
})

describe('Phase C — first-shot accuracy', () => {
  function firstAngle(
    kind: 'pistol' | 'chaingun',
    refireCount: number,
    seed: number,
  ): { angle: number; calls: number } {
    const rng = mulberry32(seed)
    const real = combat.hitscan.bind(combat)
    let captured = Number.NaN
    let calls = 0
    const spy = vi
      .spyOn(combat, 'hitscan')
      .mockImplementation((scene, enemies, origin, angle, range, slope) => {
        if (calls === 0) {
          captured = angle
        }
        calls++
        return real(scene, enemies, origin, angle, range, slope)
      })
    const player = arm(kind)
    player.refireCount = refireCount
    fireOnce(player, openScene(), [], [], rng)
    spy.mockRestore()
    return { angle: captured, calls }
  }

  it('pistol refireCount=0 fires exactly along player.angle; refireCount=1 spreads', () => {
    const accurate = firstAngle('pistol', 0, 3)
    expect(accurate.calls).toBe(1)
    expect(accurate.angle).toBe(0) // player.angle === 0, no spread rng consumed

    // With a non-zero refire counter the very next shot spreads off-axis (with high
    // probability over a few seeds — the triangular driver is ~0 only at the exact centre).
    const spread = [11, 12, 13, 14].map(s => firstAngle('pistol', 1, s).angle)
    expect(spread.some(a => a !== 0)).toBe(true)
  })

  it('chaingun: shots #1 & #2 are pinpoint (refireCount 0), shot #3 spreads (refireCount >= 1)', () => {
    // The two-frame CHGG chain fires fireCGun twice per A_ReFire bump, so the OPENING pair
    // (shots #1 & #2) both see refireCount===0 → pinpoint; from the second pair on refireCount>0
    // → off-axis. This emerges from the chain, NOT a deleted `accurateShots` field.
    const rng = mulberry32(909)
    const real = combat.hitscan.bind(combat)
    const shots: { angle: number; refire: number }[] = []
    const player = arm('chaingun')
    const spy = vi
      .spyOn(combat, 'hitscan')
      .mockImplementation((scene, enemies, origin, angle, range, slope) => {
        shots.push({ angle, refire: player.refireCount })
        return real(scene, enemies, origin, angle, range, slope)
      })
    // Hold automatic fire long enough for at least three shots.
    for (let i = 0; i < 40 && shots.length < 3; i++) {
      updateWeapon(player, true, openScene(), [], [], rng, TIC)
    }
    spy.mockRestore()
    expect(shots.length).toBeGreaterThanOrEqual(3)
    // Shots #1 and #2 fire at refireCount 0 and are pinpoint (player.angle === 0).
    expect(shots[0]?.refire).toBe(0)
    expect(shots[0]?.angle).toBe(0)
    expect(shots[1]?.refire).toBe(0)
    expect(shots[1]?.angle).toBe(0)
    // Shot #3 belongs to the second pair: refireCount has bumped and the shot spreads off-axis.
    expect(shots[2]?.refire ?? 0).toBeGreaterThanOrEqual(1)
    expect(shots[2]?.angle).not.toBe(0)
  })

  it('shotgun & SSG always spread, even on the very first shot (refireCount=0)', () => {
    // Multi-pellet weapons ignore the accurate path: at least one pellet is off-axis.
    const sgAngles: number[] = []
    {
      const rng = mulberry32(21)
      const real = combat.hitscan.bind(combat)
      const spy = vi
        .spyOn(combat, 'hitscan')
        .mockImplementation((scene, enemies, origin, angle, range, slope) => {
          sgAngles.push(angle)
          return real(scene, enemies, origin, angle, range, slope)
        })
      const player = arm('shotgun')
      player.refireCount = 0
      fireOnce(player, openScene(), [], [], rng)
      spy.mockRestore()
    }
    expect(sgAngles.length).toBe(WEAPONS.shotgun.pellets)
    expect(sgAngles.some(a => a !== 0)).toBe(true)
  })
})

describe('Phase C — pellet counts & ammo cost', () => {
  function pelletCalls(kind: 'pistol' | 'shotgun' | 'superShotgun' | 'chaingun'): number {
    const rng = mulberry32(99)
    let calls = 0
    const real = combat.hitscan.bind(combat)
    const spy = vi
      .spyOn(combat, 'hitscan')
      .mockImplementation((scene, enemies, origin, angle, range, slope) => {
        calls++
        return real(scene, enemies, origin, angle, range, slope)
      })
    const player = arm(kind)
    fireOnce(player, openScene(), [], [], rng)
    spy.mockRestore()
    return calls
  }

  it('fires 1/7/20/1 rays for pistol/shotgun/SSG/chaingun', () => {
    expect(pelletCalls('pistol')).toBe(1)
    expect(pelletCalls('shotgun')).toBe(7)
    expect(pelletCalls('superShotgun')).toBe(20)
    expect(pelletCalls('chaingun')).toBe(1)
    expect(WEAPONS.shotgun.pellets).toBe(7)
    expect(WEAPONS.superShotgun.pellets).toBe(20)
  })

  it('the super shotgun consumes 2 shells per shot', () => {
    const player = arm('superShotgun')
    player.ammo.shells = 10
    fireOnce(player, openScene(), [], [], mulberry32(5))
    expect(player.ammo.shells).toBe(8)
    expect(WEAPONS.superShotgun.ammoPerShot).toBe(2)
  })
})

describe('Phase C — SSG vertical slope gate (combat.hitscan)', () => {
  it('hitscan(...,0) is byte-identical to the 5-arg form', () => {
    const scene = openScene()
    const enemies = [spawnEnemy('grunt', 6.5, 2.5)]
    const five = combat.hitscan(scene, enemies, vec(2.5, 2.5), 0, 24)
    const six = combat.hitscan(scene, enemies, vec(2.5, 2.5), 0, 24, 0)
    expect(six).toEqual(five)
  })

  it('a steep slope clears a far target but not a near one', () => {
    const scene = openScene()
    // slope just past the half-height gate at 8 cells, still under it at 1 cell.
    const slope = (ENEMY_HALF_HEIGHT / 4) * 1.01 // vertOffset = slope*along
    const near = [spawnEnemy('grunt', 3.5, 2.5)] // along ≈ 1 → vertOffset ≈ 0.11 < 0.44
    const far = [spawnEnemy('grunt', 6.5, 2.5)] // along ≈ 4 → vertOffset ≈ 0.45 > 0.44
    const nearHit = combat.hitscan(scene, near, vec(2.5, 2.5), 0, 24, slope)
    const farHit = combat.hitscan(scene, far, vec(2.5, 2.5), 0, 24, slope)
    expect(nearHit.hitEnemy).toBe(true)
    expect(farHit.hitEnemy).toBe(false)
  })

  it('SSG lands most pellets point-blank, far fewer at range (slope gate band)', () => {
    // Use a deterministic real RNG; count damage dealt (each landed pellet deals 5/10/15).
    function landedDamage(distance: number, seed: number): number {
      const player = arm('superShotgun')
      const target = spawnEnemy('baron', 2.5 + distance, 2.5)
      target.health = 1_000_000
      const before = target.health
      fireOnce(player, openScene(), [target], [], mulberry32(seed))
      return before - target.health
    }
    const SEEDS = 16
    let nearTotal = 0
    let farTotal = 0
    for (let s = 100; s < 100 + SEEDS; s++) {
      nearTotal += landedDamage(0.6, s) // ~0.6 cells away → slope*along tiny → most land
      farTotal += landedDamage(14, s) // far → steep pellets clear the half-height gate
    }
    // Theoretical per-shot max if EVERY pellet lands a 15: 20 pellets × 15 = 300 → cap.
    const PELLETS = WEAPONS.superShotgun.pellets
    const perShotMax = PELLETS * 15
    const totalMax = perShotMax * SEEDS
    // HIGH band: point-blank most pellets must land. With ~10 avg/pellet and ~all 20 landing,
    // near ≈ 200/shot. Require near >= 55% of the all-15 ceiling — this fails loudly if a too-
    // LARGE SLOPE_UNIT makes pellets miss even point-blank (near would collapse toward 0).
    expect(nearTotal).toBeGreaterThan(totalMax * 0.55)
    // …and far must be MEANINGFULLY lower (not merely >), so a too-SMALL SLOPE_UNIT that lets
    // everything land at range (far ≈ near) is caught.
    expect(farTotal).toBeLessThan(nearTotal * 0.75)
    expect(nearTotal).toBeGreaterThan(farTotal)
  })
})

describe('Phase C — WeaponDef shape', () => {
  it('super shotgun has verticalSlopeShift===5 and no legacy verticalSpread', () => {
    expect(WEAPONS.superShotgun.verticalSlopeShift).toBe(5)
    // The old miss-hack lived on `spread.vertical`; Phase C uses the slope gate instead.
    // (spread.vertical may remain 0 as a documented placeholder, but must never be a
    // probability-of-miss the engine reads — fireHitscan no longer references it.)
    expect(WEAPONS.superShotgun.spreadShift).toBe(19)
    expect('verticalSpread' in WEAPONS.superShotgun).toBe(false)
  })
})
