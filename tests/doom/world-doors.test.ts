import { describe, expect, it } from 'vitest'
import { DOOR_PASSABLE_AT } from '~/doom/config'
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
  weaponCycle: 0,
  pointerX: 0,
  pointerY: 0,
  pointerDown: false,
}

function input(partial: Partial<InputFrame>): InputFrame {
  return { ...IDLE, ...partial }
}

const assets = createAssets(2)

function buildWorld(rows: readonly string[]): World {
  const src: LevelSource = {
    name: 'DOOR TEST',
    rows,
    floorFlat: 0,
    ceilingFlat: 2,
    playerAngle: 0,
  }
  return new World(compileLevel(src), assets, mulberry32(3), defaultSettings())
}

describe('World doors', () => {
  it('opens a plain door on use and slides it to passable', () => {
    // Player at (1.5,1.5); a plain door 'D' sits in the adjacent cell within USE_RANGE.
    const world = buildWorld(['#####', '#@D.#', '#####'])
    expect(world.isSolid(2, 1)).toBe(true) // shut → solid
    expect(world.doorOpennessAt(2, 1)).toBe(0)

    const events = world.update(input({ use: true }), 1 / 60)
    expect(events.doorOpened).toBe(true)

    // Let the door animate fully open over the next second of ticks.
    for (let i = 0; i < 120; i++) {
      world.update(IDLE, 1 / 60)
    }
    expect(world.doorOpennessAt(2, 1)).toBeGreaterThanOrEqual(DOOR_PASSABLE_AT)
    expect(world.isSolid(2, 1)).toBe(false)
  })

  it('blocks a locked door without the key and tells the player', () => {
    // 'R' is a red-locked door; the player holds no keys at spawn.
    const world = buildWorld(['#####', '#@R.#', '#####'])
    const events = world.update(input({ use: true }), 1 / 60)
    expect(events.doorOpened).toBe(false)
    expect(world.isSolid(2, 1)).toBe(true)
    expect(world.player.message).toContain('RED')
    expect(world.doorOpennessAt(2, 1)).toBe(0)
  })

  it('opens the locked door once the matching key is held', () => {
    const world = buildWorld(['#####', '#@R.#', '#####'])
    world.player.keys.red = true
    const events = world.update(input({ use: true }), 1 / 60)
    expect(events.doorOpened).toBe(true)
  })

  it('reports zero openness for non-door cells', () => {
    const world = buildWorld(['#####', '#@..#', '#####'])
    expect(world.doorOpennessAt(0, 0)).toBe(0) // brick wall
    expect(world.doorOpennessAt(2, 1)).toBe(0) // open floor
  })

  it('recedes a secret wall on use and slides it to passable', () => {
    // '*' is a secret wall in the adjacent cell; it should open like a door on use.
    const world = buildWorld(['#####', '#@*.#', '#####'])
    expect(world.isSolid(2, 1)).toBe(true) // secret starts solid
    expect(world.doorOpennessAt(2, 1)).toBe(0)

    const events = world.update(input({ use: true }), 1 / 60)
    expect(events.doorOpened).toBe(true)

    // Let the secret slide fully open over the next second of ticks.
    for (let i = 0; i < 120; i++) {
      world.update(IDLE, 1 / 60)
    }
    expect(world.doorOpennessAt(2, 1)).toBeGreaterThanOrEqual(DOOR_PASSABLE_AT)
    expect(world.isSolid(2, 1)).toBe(false)
  })
})
