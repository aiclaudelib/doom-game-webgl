// Phase D — melee weapons (fist, chainsaw, berserk). Locks the two melee corrections:
//   (1) the chainsaw is NOT berserk-boosted (only the fist is),
//   (2) the chainsaw PULLS the player toward a struck target (through collision, no recoil),
// plus the fist's never-out-of-ammo invariant, the MELEE_RANGE gate, and the idle-buzz flag.
//
// All randomness is a seeded mulberry32 so distributions are deterministic. The pull wiring
// mirrors World.updateWeaponPhase exactly: drive updateWeapon, then nudgePlayer(scale(pull,
// SAW_PULL)). SAW_PULL here MUST match the private const in world.ts (0.18 cells/bite).

import { describe, expect, it } from 'vitest'
import type { Enemy, InputFrame, LevelSource, Player, Rng, SceneQuery, Vec2 } from '~/doom/types'
import { mulberry32 } from '~/doom/core/rng'
import { scale } from '~/doom/core/vec'
import { vec } from '~/doom/core/vec'
import { createAssets } from '~/doom/engine/textures'
import { compileLevel } from '~/doom/game/map'
import { defaultSettings } from '~/doom/game/state'
import { World } from '~/doom/game/world'
import { createPlayer, giveWeapon, nudgePlayer } from '~/doom/game/player'
import { ENEMY_DEFS, spawnEnemy } from '~/doom/game/enemy'
import { WEAPONS, updateWeapon } from '~/doom/game/weapon'
import { MELEE_RANGE, PLAYER_RADIUS } from '~/doom/config'
import { TIC, fireOnce as fireOnceShared, openScene } from './fireHelpers'

/** Mirrors the private SAW_PULL in world.ts (cells dragged per connecting bite). */
const SAW_PULL = 0.18

/** Open arena, except every cell with tx >= wallTx is solid (a wall to the east). */
function walledScene(wallTx: number): SceneQuery {
  return {
    width: 64,
    height: 64,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: tx => tx >= wallTx,
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

/**
 * Melee-flavoured fire helper: the shared fireOnce with an empty projectiles array (melee never
 * spawns projectiles), surfacing the chainsaw pull vector the suite cares about.
 */
function fireOnce(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  rng: Rng,
): { fired: string | null; dryFired: boolean; pull: Vec2 | undefined } {
  return fireOnceShared(player, scene, enemies, [], rng)
}

/** Assert a pull vector was produced and narrow it to Vec2 (no `!`/`as` to keep gates clean). */
function requirePull(pull: Vec2 | undefined): Vec2 {
  if (pull === undefined) {
    throw new Error('expected a chainsaw pull vector')
  }
  return pull
}

/** One full bite against a fresh max-HP baron; returns the raw damage that landed. */
function biteDamage(weapon: 'fist' | 'chainsaw', berserk: boolean, rng: Rng): number {
  const player = createPlayer(vec(1.5, 1.5), 0)
  if (weapon === 'chainsaw') {
    giveWeapon(player, 'chainsaw')
  }
  player.currentWeapon = weapon
  player.berserk = berserk
  // Baron has 1000 HP so neither a 20 nor a 200 hit clamps at 0.
  const baron = spawnEnemy('baron', 2.0, 1.5)
  const got = fireOnce(player, openScene(), [baron], rng)
  expect(got.fired).toBe(weapon)
  return ENEMY_DEFS.baron.maxHealth - baron.health
}

describe('fist (A_Punch)', () => {
  it('rolls 2..20 normally and 20..200 under berserk (×10)', () => {
    const rng = mulberry32(0xf157)
    let normalMin = Number.POSITIVE_INFINITY
    let normalMax = 0
    let berserkMin = Number.POSITIVE_INFINITY
    let berserkMax = 0
    for (let i = 0; i < 400; i++) {
      const n = biteDamage('fist', false, rng)
      normalMin = Math.min(normalMin, n)
      normalMax = Math.max(normalMax, n)
      expect(n % 2).toBe(0) // (1+floor(rng*10))*2 is always even
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(20)

      const b = biteDamage('fist', true, rng)
      berserkMin = Math.min(berserkMin, b)
      berserkMax = Math.max(berserkMax, b)
      expect(b % 20).toBe(0) // ×10 of an even base
      expect(b).toBeGreaterThanOrEqual(20)
      expect(b).toBeLessThanOrEqual(200)
    }
    // Large sample must actually exercise the extremes of both ranges.
    expect(normalMin).toBe(2)
    expect(normalMax).toBe(20)
    expect(berserkMin).toBe(20)
    expect(berserkMax).toBe(200)
  })

  it('NEVER reports OUT OF AMMO — ammo:null keeps the ready check always passing', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.currentWeapon = 'fist'
    let fires = 0
    let dryFires = 0
    // Many ready+attack ticks: the fist must keep firing, never dry-fire.
    for (let i = 0; i < 2000; i++) {
      const r = updateWeapon(player, true, openScene(), [], [], mulberry32(i + 1), TIC)
      if (r.fired === 'fist') {
        fires++
      }
      if (r.dryFired) {
        dryFires++
      }
    }
    expect(dryFires).toBe(0)
    expect(fires).toBeGreaterThan(0)
    expect(player.message).not.toBe('OUT OF AMMO')
  })

  it('never pulls — the fist has no meleePull', () => {
    expect(WEAPONS.fist.meleePull).toBeUndefined()
    const player = createPlayer(vec(1.5, 1.5), 0)
    player.currentWeapon = 'fist'
    const enemy = spawnEnemy('baron', 2.0, 1.5)
    const r = fireOnce(player, openScene(), [enemy], mulberry32(7))
    expect(r.fired).toBe('fist')
    expect(r.pull).toBeUndefined()
  })
})

describe('chainsaw (A_Saw)', () => {
  it('stays 2..20 even under berserk and carries NO berserkBoost key', () => {
    // The corner-stone regression: a contributor must never add berserkBoost to the saw.
    expect(WEAPONS.chainsaw.damage.berserkBoost).toBeUndefined()

    const rng = mulberry32(0x5a4)
    let min = Number.POSITIVE_INFINITY
    let max = 0
    for (let i = 0; i < 400; i++) {
      const d = biteDamage('chainsaw', true, rng) // berserk ON — must NOT scale ×10
      min = Math.min(min, d)
      max = Math.max(max, d)
      expect(d).toBeGreaterThanOrEqual(2)
      expect(d).toBeLessThanOrEqual(20)
    }
    expect(min).toBe(2)
    expect(max).toBe(20) // 20, not 200 — proves berserk did NOT boost the saw
  })

  it('is automatic and declares meleePull', () => {
    expect(WEAPONS.chainsaw.automatic).toBe(true)
    expect(WEAPONS.chainsaw.meleePull).toBe(true)
    expect(WEAPONS.chainsaw.ammo).toBeNull()
    expect(WEAPONS.chainsaw.ammoPerShot).toBe(0)
  })
})

describe('chainsaw pull (no recoil)', () => {
  it('drags the player toward a struck enemy, closing the gap', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chainsaw')
    player.currentWeapon = 'chainsaw'
    const enemy = spawnEnemy('baron', 2.4, 1.5) // 0.9 cells east, inside MELEE_RANGE 1.1
    const scene = openScene()
    const gapBefore = enemy.pos.x - player.pos.x

    const r = fireOnce(player, scene, [enemy], mulberry32(3))
    expect(r.fired).toBe('chainsaw')
    const pull = requirePull(r.pull)
    // Unit vector pointing from player toward the enemy (straight east here).
    expect(Math.hypot(pull.x, pull.y)).toBeCloseTo(1, 6)
    expect(pull.x).toBeCloseTo(1, 6)

    const before = player.pos.x
    nudgePlayer(scene, player, scale(pull, SAW_PULL))
    const moved = player.pos.x - before
    // Closed the gap by exactly SAW_PULL east, no overshoot past the enemy.
    expect(moved).toBeCloseTo(SAW_PULL, 6)
    expect(player.pos.x).toBeLessThan(enemy.pos.x)
    expect(enemy.pos.x - player.pos.x).toBeLessThan(gapBefore)
  })

  it('a whiff produces NO movement (no enemy in range → no pull)', () => {
    const player = createPlayer(vec(1.5, 1.5), 0)
    giveWeapon(player, 'chainsaw')
    player.currentWeapon = 'chainsaw'
    // Enemy 5 cells away — far beyond MELEE_RANGE, so no bite connects.
    const enemy = spawnEnemy('baron', 6.5, 1.5)
    const scene = openScene()
    const start = { ...player.pos }

    const r = fireOnce(player, scene, [enemy], mulberry32(11))
    expect(r.fired).toBe('chainsaw') // it still swings...
    expect(r.pull).toBeUndefined() // ...but nothing was hit, so no pull
    // Even if a caller blindly applied an (undefined→{0,0}) nudge, position is unchanged.
    expect(player.pos.x).toBeCloseTo(start.x, 6)
    expect(player.pos.y).toBeCloseTo(start.y, 6)
  })

  it('the pull is collision-bounded — a wall stops it, never clips through', () => {
    // Wall fills tx>=2; the player at x=1.7 (radius 0.22 → edge 1.92) can advance east only
    // until its edge meets x=2.0, i.e. centre x=1.78. A 0.18 pull east would land at 1.88
    // (clipping), so collision MUST cap it at <= 1.78.
    const scene = walledScene(2)
    const player = createPlayer(vec(1.7, 1.5), 0)
    giveWeapon(player, 'chainsaw')
    player.currentWeapon = 'chainsaw'
    // Enemy at x=1.95 sits just in FRONT of the wall (cell tx=1) and within MELEE_RANGE of
    // x=1.7, so the bite connects (the ray reaches it before castWall stops at x=2.0).
    const enemy = spawnEnemy('baron', 1.95, 1.5)

    const r = fireOnce(player, scene, [enemy], mulberry32(5))
    expect(r.fired).toBe('chainsaw')
    const pull = requirePull(r.pull)

    nudgePlayer(scene, player, scale(pull, SAW_PULL))
    // Capped by the wall — the player edge never crosses x=2.0.
    expect(player.pos.x).toBeLessThanOrEqual(2 - PLAYER_RADIUS + 1e-9)
  })
})

describe('melee range gate', () => {
  it('hits inside MELEE_RANGE and misses just outside it', () => {
    // A deterministic-zero-spread RNG (rndDiff = floor(0.5*256)-floor(0.5*256) = 0) so the
    // bite goes straight east and the only variable is distance vs MELEE_RANGE (1.1).
    const straight: Rng = () => 0.5

    const inside = createPlayer(vec(1.5, 1.5), 0)
    inside.currentWeapon = 'fist'
    const near = spawnEnemy('baron', 1.5 + (MELEE_RANGE - 0.2), 1.5) // 0.9 < 1.1 → hit
    const hp0 = near.health
    fireOnce(inside, openScene(), [near], straight)
    expect(near.health).toBeLessThan(hp0)

    const outside = createPlayer(vec(1.5, 1.5), 0)
    outside.currentWeapon = 'fist'
    const far = spawnEnemy('baron', 1.5 + (MELEE_RANGE + 0.2), 1.5) // 1.3 > 1.1 → miss
    const hp1 = far.health
    fireOnce(outside, openScene(), [far], straight)
    expect(far.health).toBe(hp1)
  })
})

describe('weaponIdle reporting (sound-side flag only)', () => {
  // A bare arena so the world has no enemies/walls in the way of the chainsaw.
  const ARENA: LevelSource = {
    name: 'Saw Idle',
    rows: ['#####', '#@..#', '#####'],
    floorFlat: 0,
    ceilingFlat: 2,
    playerAngle: 0,
  }
  const BASE_INPUT: InputFrame = {
    moveForward: 0,
    moveStrafe: 0,
    turnAxis: 0,
    mouseDX: 0,
    firing: false,
    fire: false,
    run: false,
    use: false,
    nav: { up: false, down: false, left: false, right: false, confirm: false, back: false },
    weaponSlot: 0,
    weaponCycle: 0,
    pointerX: 0,
    pointerY: 0,
    pointerDown: false,
  }

  function armedSawWorld(): World {
    const world = new World(compileLevel(ARENA), createAssets(1), mulberry32(1), defaultSettings())
    world.player.weapons.chainsaw = true
    world.player.currentWeapon = 'chainsaw'
    world.player.weaponState = 'ready'
    world.player.pendingWeapon = null
    return world
  }

  it("World.update reports weaponIdle 'chainsaw' when idle-holding the saw, null while firing", () => {
    // Bind to the SHIPPED predicate by driving a real World through update — not a re-impl.
    // Idle (no attack): the saw sits ready and buzzes → events.weaponIdle === 'chainsaw'.
    const idleWorld = armedSawWorld()
    const idleEvents = idleWorld.update({ ...BASE_INPUT }, TIC)
    expect(idleEvents.weaponIdle).toBe('chainsaw')

    // Firing (the chainsaw is automatic → it reads input.firing): biting, not idling → null.
    const firingWorld = armedSawWorld()
    const firingEvents = firingWorld.update({ ...BASE_INPUT, firing: true }, TIC)
    expect(firingEvents.weaponIdle).toBeNull()
  })

  it('World.update never reports weaponIdle for the fist (only the chainsaw idle-buzzes)', () => {
    const world = new World(compileLevel(ARENA), createAssets(1), mulberry32(1), defaultSettings())
    world.player.currentWeapon = 'fist'
    world.player.weaponState = 'ready'
    const events = world.update({ ...BASE_INPUT }, TIC)
    expect(events.weaponIdle).toBeNull()
  })
})
