import { describe, expect, it } from 'vitest'
import type { SceneQuery } from '~/doom/types'
import { PLAYER_RADIUS } from '~/doom/config'
import { vec } from '~/doom/core/vec'
import { isBlocked, moveWithCollision } from '~/doom/game/collision'

// Minimal SceneQuery: solid wherever the predicate says so. Everything else is
// open floor. Only isSolid matters for collision; the rest are inert stubs.
function makeScene(solid: (tx: number, ty: number) => boolean): SceneQuery {
  return {
    width: 8,
    height: 8,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: (tx, ty) => solid(tx, ty),
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

describe('isBlocked', () => {
  it('detects overlap with a solid cell', () => {
    // Wall fills cell (3, y). A circle centred at x=2.9 with radius 0.22 pokes in.
    const scene = makeScene(tx => tx === 3)
    expect(isBlocked(scene, vec(2.9, 1.5), PLAYER_RADIUS)).toBe(true)
  })

  it('returns false in clear space', () => {
    const scene = makeScene(tx => tx === 3)
    expect(isBlocked(scene, vec(1.5, 1.5), PLAYER_RADIUS)).toBe(false)
  })
})

describe('moveWithCollision', () => {
  it('slides along a wall: blocked axis is zeroed, free axis advances', () => {
    // A vertical wall along x=3. Moving diagonally toward it, the x component is
    // blocked while the y component is free, so the player grazes the wall.
    const scene = makeScene(tx => tx === 3)
    const start = vec(2.7, 1.5)
    const result = moveWithCollision(scene, start, vec(0.2, 0.3), PLAYER_RADIUS)
    // x stays put (moving to 2.9 would overlap the wall at radius 0.22).
    expect(result.x).toBeCloseTo(2.7)
    // y is unobstructed and moves the full amount.
    expect(result.y).toBeCloseTo(1.8)
  })

  it('moves freely through open space on both axes', () => {
    const scene = makeScene(() => false)
    const result = moveWithCollision(scene, vec(1, 1), vec(0.5, -0.25), PLAYER_RADIUS)
    expect(result.x).toBeCloseTo(1.5)
    expect(result.y).toBeCloseTo(0.75)
  })
})
