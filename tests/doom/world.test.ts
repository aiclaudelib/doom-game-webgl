import { describe, expect, it } from 'vitest'
import type { InputFrame, LevelSource, NavEdge } from '~/doom/types'
import { mulberry32 } from '~/doom/core/rng'
import { createAssets } from '~/doom/engine/textures'
import { compileLevel } from '~/doom/game/map'
import { defaultSettings } from '~/doom/game/state'
import { World } from '~/doom/game/world'

const NO_NAV: NavEdge = {
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
}

const IDLE: InputFrame = {
  moveForward: 0,
  moveStrafe: 0,
  turnAxis: 0,
  mouseDX: 0,
  firing: false,
  fire: false,
  run: false,
  use: false,
  nav: NO_NAV,
  weaponSlot: 0,
  pointerX: 0,
  pointerY: 0,
  pointerDown: false,
}

function input(partial: Partial<InputFrame>): InputFrame {
  return { ...IDLE, ...partial }
}

// Player '@' faces east (angle 0) down a clear corridor. A grunt 'g' is lined up
// straight ahead, a health pickup 'h' sits one tile east of the start, and the
// exit switch 'X' caps the far end.
const SOURCE: LevelSource = {
  name: 'World Test',
  rows: ['##########', '#@h..g..X#', '##########'],
  floorFlat: 0,
  ceilingFlat: 2,
  playerAngle: 0,
}

function makeWorld(): World {
  const level = compileLevel(SOURCE)
  const assets = createAssets(1)
  return new World(level, assets, mulberry32(1), defaultSettings())
}

describe('World', () => {
  it('exposes SceneQuery dimensions and initial stats from the level', () => {
    const world = makeWorld()
    expect(world.width).toBe(10)
    expect(world.height).toBe(3)
    expect(world.stats.totalEnemies).toBe(1)
    expect(world.stats.kills).toBe(0)
    expect(world.stats.level).toBe('World Test')
  })

  it('kills a lined-up enemy when fired upon repeatedly', () => {
    const world = makeWorld()
    let died = false

    // Hold fire for plenty of ticks. tryFire only fires on a ready frame; the
    // weapon cycles ready→firing→ready on its own. Death finishes after the
    // dying animation, which is the frame kills increments.
    for (let i = 0; i < 240 && !died; i++) {
      const events = world.update(input({ fire: true, firing: true }), 1 / 60)
      if (events.enemyDied) {
        died = true
      }
    }

    expect(died).toBe(true)
    expect(world.stats.kills).toBe(1)
  })

  it('grabs a pickup the player walks onto', () => {
    const world = makeWorld()
    // Below the cap so the stimpack heals (it would be refused at ≥100). The grunt
    // down the corridor now hitscans the player while they walk, so compare against
    // the health on the tick BEFORE the grab — proving the stimpack added on top.
    world.player.health = 40

    let grabbed = false
    let healthBeforeGrab = world.player.health
    // Walk east toward the health pickup one tile away.
    for (let i = 0; i < 120 && !grabbed; i++) {
      healthBeforeGrab = world.player.health
      const events = world.update(input({ moveForward: 1 }), 1 / 60)
      if (events.pickedUp) {
        grabbed = true
      }
    }

    expect(grabbed).toBe(true)
    // The stimpack's +10 outweighs at most one hitscan hit on the grab tick.
    expect(world.player.health).toBeGreaterThan(healthBeforeGrab)
  })

  it('reports reachedExit when the player stands beside the (solid) exit switch', () => {
    const world = makeWorld()
    // The exit switch at column 8 is solid, so the player can never stand on it.
    // Standing in the adjacent cell (column 7) must still complete the level.
    world.player.pos.x = 7.5
    world.player.pos.y = 1.5
    expect(world.isSolid(8, 1)).toBe(true) // switch stays solid/visible
    const events = world.update(input({}), 1 / 60)
    expect(events.reachedExit).toBe(true)

    // The flag latches — a second tick beside the same switch does not re-fire it.
    const again = world.update(input({}), 1 / 60)
    expect(again.reachedExit).toBe(false)
  })

  it('does not report reachedExit when nowhere near the exit switch', () => {
    const world = makeWorld()
    // Start cell (column 1) is far from the exit at column 8.
    const events = world.update(input({}), 1 / 60)
    expect(events.reachedExit).toBe(false)
  })

  it('a fired rocket spawns a projectile that kills a lined-up enemy via impact + splash', () => {
    const world = makeWorld()
    const player = world.player
    // Arm the rocket launcher; the grunt (HP 20) sits straight ahead down the corridor.
    player.weapons.rocket = true
    player.currentWeapon = 'rocket'
    player.ammo.rockets = 5

    // Hold fire: tryFire spawns the rocket on a ready frame, it flies down the
    // corridor, and on impact world applies direct (20..160) + Chebyshev splash.
    let died = false
    for (let i = 0; i < 240 && !died; i++) {
      const events = world.update(input({ fire: true, firing: true }), 1 / 60)
      if (events.enemyDied) {
        died = true
      }
    }
    expect(died).toBe(true)
    expect(world.stats.kills).toBe(1)
  })

  it('applies a powerup the player walks onto (blur timer starts)', () => {
    // A blur sphere 'w' sits one tile east of the start down a clear corridor.
    const source: LevelSource = {
      name: 'Powerup Test',
      rows: ['##########', '#@w......X#', '##########'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const powerWorld = new World(
      compileLevel(source),
      createAssets(1),
      mulberry32(1),
      defaultSettings(),
    )
    expect(powerWorld.player.blurTimer).toBe(0)

    let grabbed = false
    for (let i = 0; i < 120 && !grabbed; i++) {
      const events = powerWorld.update(input({ moveForward: 1 }), 1 / 60)
      if (events.pickedUp) {
        grabbed = true
      }
    }
    expect(grabbed).toBe(true)
    expect(powerWorld.player.blurTimer).toBeGreaterThan(0)
  })

  it('shooting a barrel explodes it, chain-detonates an adjacent barrel, and hurts the player', () => {
    // Player '@' faces east; two barrels 'Q' sit down the corridor (cols 3 and 5).
    // The nearest is shot, detonates, and its 2-cell Chebyshev splash both chains the
    // far barrel AND reaches back to the (close) player — proving splash hurts the shooter.
    const source: LevelSource = {
      name: 'Barrel Test',
      rows: ['##########', '#@.Q.Q..X#', '##########'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    // Two barrels spawned; neither counts toward the kill total (decor, not monsters).
    expect(world.enemyStates.filter(e => e.kind === 'barrel')).toHaveLength(2)
    expect(world.stats.totalEnemies).toBe(0)

    const healthBefore = world.player.health
    // Hold fire: the pistol hitscans the nearest barrel; it dies → detonates → chains.
    for (let i = 0; i < 240; i++) {
      world.update(input({ fire: true, firing: true }), 1 / 60)
      const barrels = world.enemyStates.filter(e => e.kind === 'barrel')
      const allBlown = barrels.every(b => b.state === 'dying' || b.state === 'dead')
      if (allBlown) {
        break
      }
    }

    const barrels = world.enemyStates.filter(e => e.kind === 'barrel')
    // BOTH barrels detonated — the shot one and the chained one.
    expect(barrels.every(b => b.state === 'dying' || b.state === 'dead')).toBe(true)
    // The explosion's splash hurt the player (splash hurts the shooter).
    expect(world.player.health).toBeLessThan(healthBefore)
    // Barrels never count as kills.
    expect(world.stats.kills).toBe(0)
  })

  it('ticks a decor prop and advances its animation clock', () => {
    // A techlamp 'T' (animated, fullbright) sits beside the player; no monsters.
    const source: LevelSource = {
      name: 'Prop Test',
      rows: ['##########', '#@T.....X#', '##########'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    expect(world.propStates).toHaveLength(1)
    expect(world.propStates[0]?.kind).toBe('techLamp')
    expect(world.propStates[0]?.animTimer).toBe(0)

    for (let i = 0; i < 30; i++) {
      world.update(input({}), 1 / 60)
    }
    // The prop's animation clock advanced (animated props loop on this clock).
    expect(world.propStates[0]?.animTimer).toBeGreaterThan(0)
  })

  it('reports dryFired on an empty trigger pull and not on a real shot', () => {
    const world = makeWorld()
    // Drain the pistol's ammo so the next fresh press clicks empty.
    world.player.ammo.bullets = 0

    let sawDryFire = false
    for (let i = 0; i < 30 && !sawDryFire; i++) {
      const events = world.update(input({ fire: true }), 1 / 60)
      expect(events.fired).toBeNull()
      if (events.dryFired) {
        sawDryFire = true
      }
    }
    expect(sawDryFire).toBe(true)

    // A real shot (ammo present) reports fired, never dryFired.
    const armed = makeWorld()
    let sawShot = false
    for (let i = 0; i < 30 && !sawShot; i++) {
      const events = armed.update(input({ fire: true }), 1 / 60)
      if (events.fired !== null) {
        expect(events.dryFired).toBe(false)
        sawShot = true
      }
    }
    expect(sawShot).toBe(true)
  })
})
