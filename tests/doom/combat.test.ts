import { describe, expect, it } from 'vitest'
import type { Enemy, EnemyKind, SceneQuery, Vec2 } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { hitscan, lineOfSight } from '~/doom/game/combat'

function makeScene(solid: (tx: number, ty: number) => boolean): SceneQuery {
  return {
    width: 16,
    height: 16,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: (tx, ty) => solid(tx, ty),
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

function makeEnemy(kind: EnemyKind, pos: Vec2): Enemy {
  return {
    kind,
    pos: { x: pos.x, y: pos.y },
    angle: 0,
    health: 30,
    state: 'chase',
    stateTimer: 0,
    animTimer: 0,
    attackTimer: 0,
    alive: true,
  }
}

describe('lineOfSight', () => {
  it('is true across open space', () => {
    const scene = makeScene(() => false)
    expect(lineOfSight(scene, vec(1.5, 1.5), vec(8.5, 1.5))).toBe(true)
  })

  it('is false when a solid cell blocks the segment', () => {
    // A wall at column 4 stands between the two endpoints.
    const scene = makeScene(tx => tx === 4)
    expect(lineOfSight(scene, vec(1.5, 1.5), vec(8.5, 1.5))).toBe(false)
  })
})

describe('hitscan', () => {
  it('selects the nearest enemy along the ray and reports hitEnemy', () => {
    const scene = makeScene(() => false)
    const near = makeEnemy('grunt', vec(4.5, 1.5))
    const far = makeEnemy('imp', vec(7.5, 1.5))
    const enemies = [far, near] // index 0 is farther; nearest is index 1.
    const result = hitscan(scene, enemies, vec(1.5, 1.5), 0, 24)
    expect(result.hitEnemy).toBe(true)
    expect(result.enemyIndex).toBe(1)
    expect(result.distance).toBeCloseTo(3, 1)
  })

  it('returns -1 when a wall is closer than the enemy', () => {
    // Wall at column 3 sits before the enemy at x=6.5.
    const scene = makeScene(tx => tx === 3)
    const enemy = makeEnemy('grunt', vec(6.5, 1.5))
    const result = hitscan(scene, [enemy], vec(1.5, 1.5), 0, 24)
    expect(result.hitEnemy).toBe(false)
    expect(result.enemyIndex).toBe(-1)
  })

  it('returns -1 when no enemy lies within range', () => {
    const scene = makeScene(() => false)
    const enemy = makeEnemy('grunt', vec(30.5, 1.5))
    const result = hitscan(scene, [enemy], vec(1.5, 1.5), 0, 5)
    expect(result.hitEnemy).toBe(false)
    expect(result.enemyIndex).toBe(-1)
    expect(result.distance).toBe(5)
  })

  it('ignores dead enemies', () => {
    const scene = makeScene(() => false)
    const dead = makeEnemy('grunt', vec(4.5, 1.5))
    dead.state = 'dead'
    dead.alive = false
    const result = hitscan(scene, [dead], vec(1.5, 1.5), 0, 24)
    expect(result.hitEnemy).toBe(false)
    expect(result.enemyIndex).toBe(-1)
  })
})
