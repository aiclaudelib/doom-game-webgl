import { describe, expect, it } from 'vitest'
import type { LevelSource } from '~/doom/types'
import { compileLevel, tileAt } from '~/doom/game/map'

// A compact level exercising every kind of authoring char: walls, doors, the
// exit switch, a secret, the player start, plus enemy + pickup spawns.
const SOURCE: LevelSource = {
  name: 'Test Arena',
  rows: ['#####', '#@g.#', '#.D.#', '#h.X#', '#####'],
  floorFlat: 0,
  ceilingFlat: 2,
  playerAngle: Math.PI / 2,
}

describe('compileLevel', () => {
  it('produces the grid dimensions from the rows', () => {
    const level = compileLevel(SOURCE)
    expect(level.width).toBe(5)
    expect(level.height).toBe(5)
    expect(level.tiles.length).toBe(25)
    expect(level.name).toBe('Test Arena')
    expect(level.floorFlat).toBe(0)
    expect(level.ceilingFlat).toBe(2)
    expect(level.playerAngle).toBeCloseTo(Math.PI / 2)
  })

  it('maps authoring chars to the tile ids from the table', () => {
    const level = compileLevel(SOURCE)
    // Border bricks → id 1.
    expect(tileAt(level, 0, 0)).toBe(1)
    expect(tileAt(level, 4, 4)).toBe(1)
    // Door 'D' at (2,2) → id 4.
    expect(tileAt(level, 2, 2)).toBe(4)
    // Exit switch 'X' at (3,3) → id 5.
    expect(tileAt(level, 3, 3)).toBe(5)
  })

  it('places the player start at the @ cell centre', () => {
    const level = compileLevel(SOURCE)
    // '@' sits at column 1, row 1 → centre (1.5, 1.5).
    expect(level.playerStart.x).toBeCloseTo(1.5)
    expect(level.playerStart.y).toBeCloseTo(1.5)
  })

  it('extracts enemy and pickup spawns at cell centres', () => {
    const level = compileLevel(SOURCE)
    expect(level.enemySpawns).toEqual([{ kind: 'grunt', x: 2.5, y: 1.5 }])
    expect(level.pickupSpawns).toEqual([{ kind: 'health', x: 1.5, y: 3.5 }])
  })

  it('turns spawn cells into floor id 0 in the grid', () => {
    const level = compileLevel(SOURCE)
    // Player start cell.
    expect(tileAt(level, 1, 1)).toBe(0)
    // Grunt spawn cell.
    expect(tileAt(level, 2, 1)).toBe(0)
    // Health pickup cell.
    expect(tileAt(level, 1, 3)).toBe(0)
  })

  it('guards out-of-bounds reads to 0', () => {
    const level = compileLevel(SOURCE)
    expect(tileAt(level, -1, 0)).toBe(0)
    expect(tileAt(level, 0, -1)).toBe(0)
    expect(tileAt(level, 5, 0)).toBe(0)
    expect(tileAt(level, 0, 5)).toBe(0)
  })
})
