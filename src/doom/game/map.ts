// ASCII level compilation: tile-id table + parser turning a LevelSource grid
// into a runtime Level (flat tile array + extracted spawns).

import type {
  EnemyKind,
  EnemySpawn,
  Level,
  LevelSource,
  PickupKind,
  PickupSpawn,
  TileDef,
  Vec2,
} from '~/doom/types'
import { vec } from '~/doom/core/vec'

/** Static tile-id table, indexed by id 0..9. Kept in sync with Assets.wall indices. */
export const TILE_DEFS: readonly TileDef[] = [
  // 0: floor / empty
  { solid: false, wallTexture: -1, door: false, locked: null, exit: false, secret: false },
  // 1: brick wall
  { solid: true, wallTexture: 1, door: false, locked: null, exit: false, secret: false },
  // 2: metal wall
  { solid: true, wallTexture: 2, door: false, locked: null, exit: false, secret: false },
  // 3: tech wall
  { solid: true, wallTexture: 3, door: false, locked: null, exit: false, secret: false },
  // 4: door (solid only while closed; live World flips it)
  { solid: true, wallTexture: 4, door: true, locked: null, exit: false, secret: false },
  // 5: exit switch
  { solid: true, wallTexture: 5, door: false, locked: null, exit: true, secret: false },
  // 6: secret wall (looks like brick)
  { solid: true, wallTexture: 6, door: false, locked: null, exit: false, secret: true },
  // 7: red locked door
  { solid: true, wallTexture: 7, door: true, locked: 'red', exit: false, secret: false },
  // 8: blue locked door
  { solid: true, wallTexture: 8, door: true, locked: 'blue', exit: false, secret: false },
  // 9: yellow locked door
  { solid: true, wallTexture: 9, door: true, locked: 'yellow', exit: false, secret: false },
] as const

const EMPTY_FLOOR: TileDef = {
  solid: false,
  wallTexture: -1,
  door: false,
  locked: null,
  exit: false,
  secret: false,
}

/** Guarded lookup → empty-floor def for any unknown id. */
export function tileDef(id: number): TileDef {
  return TILE_DEFS[id] ?? EMPTY_FLOOR
}

/** Map authoring char → tile id. Chars not listed are spawns or plain floor. */
const CHAR_TO_TILE: Readonly<Record<string, number>> = {
  '#': 1,
  '=': 2,
  '%': 3,
  D: 4,
  X: 5,
  '*': 6,
  R: 7,
  B: 8,
  Y: 9,
}

// Spawn chars for the full base roster. Chosen to avoid clashing with tile chars
// (# = % D X * R B Y), the player (@) or pickup chars (h a m b s G C r u y):
//   g grunt, S shotgunGuy, c chaingunner, i imp, d demon, p spectre, l lostSoul,
//   k cacodemon, K hellKnight, n baron, f mancubus, A arachnotron, v revenant.
const CHAR_TO_ENEMY: Readonly<Record<string, EnemyKind>> = {
  g: 'grunt',
  S: 'shotgunGuy',
  c: 'chaingunner',
  i: 'imp',
  d: 'demon',
  p: 'spectre',
  l: 'lostSoul',
  k: 'cacodemon',
  K: 'hellKnight',
  n: 'baron',
  f: 'mancubus',
  A: 'arachnotron',
  v: 'revenant',
}

const CHAR_TO_PICKUP: Readonly<Record<string, PickupKind>> = {
  h: 'health',
  a: 'armor',
  m: 'medkit',
  b: 'bullets',
  s: 'shells',
  G: 'shotgun',
  C: 'chaingun',
  r: 'keyRed',
  u: 'keyBlue',
  y: 'keyYellow',
}

/** Flat row-major index for a cell. */
export function cellIndex(width: number, tx: number, ty: number): number {
  return ty * width + tx
}

/** Parse equal-length ASCII rows into a Level: tile ids, player start, spawns. */
export function compileLevel(src: LevelSource): Level {
  const height = src.rows.length
  const width = height > 0 ? (src.rows[0]?.length ?? 0) : 0
  const tiles = new Uint8Array(width * height)

  let playerStart: Vec2 = vec(width / 2, height / 2)
  const enemySpawns: EnemySpawn[] = []
  const pickupSpawns: PickupSpawn[] = []

  for (let ty = 0; ty < height; ty++) {
    const row = src.rows[ty] ?? ''
    for (let tx = 0; tx < width; tx++) {
      const ch = row[tx] ?? ' '
      const cx = tx + 0.5
      const cy = ty + 0.5
      const idx = cellIndex(width, tx, ty)

      const tileId = CHAR_TO_TILE[ch]
      if (tileId !== undefined) {
        tiles[idx] = tileId
        continue
      }

      // Everything below stays floor id 0 in the grid.
      if (ch === '@') {
        playerStart = vec(cx, cy)
        continue
      }

      const enemyKind = CHAR_TO_ENEMY[ch]
      if (enemyKind !== undefined) {
        enemySpawns.push({ kind: enemyKind, x: cx, y: cy })
        continue
      }

      const pickupKind = CHAR_TO_PICKUP[ch]
      if (pickupKind !== undefined) {
        pickupSpawns.push({ kind: pickupKind, x: cx, y: cy })
      }
      // ' ' / '.' / unknown → floor id 0 (already zeroed).
    }
  }

  return {
    name: src.name,
    width,
    height,
    tiles,
    floorFlat: src.floorFlat,
    ceilingFlat: src.ceilingFlat,
    playerStart,
    playerAngle: src.playerAngle,
    enemySpawns,
    pickupSpawns,
  }
}

/** Guarded tile read → 0 (empty) for out-of-bounds. */
export function tileAt(level: Level, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) {
    return 0
  }
  return level.tiles[cellIndex(level.width, tx, ty)] ?? 0
}
