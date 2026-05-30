// Projectiles: spawn, integrate, collide, steer (homing). updateProjectile is
// CYCLE-SAFE: it never imports enemy.ts and never applies damage — it returns a
// ProjectileImpact descriptor and world.ts (which may import enemy/player/combat)
// applies the actual damage + splash + BFG spray. This keeps the dependency layer
// config/types <- core <- game/projectile clean (no projectile->enemy edge).

import { ENEMY_HIT_RADIUS, PROJECTILE_RADIUS, PROJECTILE_SPEED } from '~/doom/config'
import type {
  Assets,
  Enemy,
  Player,
  Projectile,
  ProjectileImpact,
  ProjectileKind,
  SceneQuery,
  Texture,
  Vec2,
} from '~/doom/types'
import { dist, normalize, scale } from '~/doom/core/vec'
import { isTargetable } from '~/doom/game/combat'

/** Animation cadence for the projectile spin, in seconds per frame. */
const PROJECTILE_FRAME_TIME = 0.08

/** Revenant tracer homing: turn cap per home tick (TRACEANGLE 16.875°). */
const TRACER_TURN = (16.875 * Math.PI) / 180
/** Homing recomputes only every 7th 60Hz step (~Doom's every-4th-tic @35Hz). */
const HOMING_PERIOD = 7

/**
 * Static per-kind tuning, faithful to doomBehaviorSpec.md §3.3.
 * speed = cells/s (= map u/s ÷ 64). impact damage = (1+floor(rng*8))*base.
 * radiusCells = the canonical missile body radius (u ÷ 64) from §3.3 — the planar
 * collision in updateProjectile uses the tuned PROJECTILE_RADIUS/ENEMY_HIT_RADIUS
 * constants, so this records the physical radius for reference/splash sizing.
 * splashCells (when set) = a radial blast on impact. sprite = atlas billboard prefix.
 */
export interface ProjectileDef {
  readonly speed: number
  readonly base: number
  readonly radiusCells: number
  readonly splashCells?: number
  readonly homing?: boolean
  readonly bfgSpray?: boolean
  readonly sprite: string
}

export const PROJECTILE_DEFS: Readonly<Record<ProjectileKind, ProjectileDef>> = {
  fireball: { speed: 5.47, base: 3, radiusCells: 0.094, sprite: 'BAL1' },
  cacoball: { speed: 5.47, base: 5, radiusCells: 0.094, sprite: 'BAL2' },
  baronball: { speed: 8.2, base: 8, radiusCells: 0.094, sprite: 'BAL7' },
  fatshot: { speed: 10.94, base: 8, radiusCells: 0.094, sprite: 'MANF' },
  tracer: { speed: 5.47, base: 10, radiusCells: 0.172, homing: true, sprite: 'FATB' },
  aplasma: { speed: 13.67, base: 5, radiusCells: 0.203, sprite: 'APLS' },
  rocket: { speed: 10.94, base: 20, radiusCells: 0.172, splashCells: 2.0, sprite: 'MISL' },
  plasma: { speed: 13.67, base: 5, radiusCells: 0.203, sprite: 'PLSS' },
  bfg: { speed: 13.67, base: 100, radiusCells: 0.203, bfgSpray: true, sprite: 'BFS1' },
}

/** Lookup a projectile's static tuning. */
export function projectileDef(kind: ProjectileKind): ProjectileDef {
  return PROJECTILE_DEFS[kind]
}

/**
 * Create a projectile whose velocity is the normalized direction × `speed`
 * (cells/s). `speed` defaults to PROJECTILE_SPEED so existing callers are
 * unchanged; enemies pass their canonical missile speed. Homing kinds (tracer)
 * carry a steer flag + step counter; BFG carries the frozen firing origin/angle.
 */
export function spawnProjectile(
  kind: ProjectileKind,
  pos: Vec2,
  dir: Vec2,
  damage: number,
  fromEnemy: boolean,
  speed = PROJECTILE_SPEED,
  owner: Enemy | null = null,
): Projectile {
  const def = PROJECTILE_DEFS[kind]
  const vel = scale(normalize(dir), speed)
  const proj: Projectile = {
    kind,
    pos: { x: pos.x, y: pos.y },
    vel,
    damage,
    fromEnemy,
    alive: true,
    animTimer: 0,
  }
  if (owner !== null) {
    proj.owner = owner
  }
  if (def.homing === true) {
    proj.homing = true
    proj.steps = 0
  }
  if (def.bfgSpray === true) {
    proj.originPos = { x: pos.x, y: pos.y }
    proj.originAngle = Math.atan2(dir.y, dir.x)
  }
  return proj
}

const NO_IMPACT: ProjectileImpact = { hit: 'none', enemyIndex: -1, pos: { x: 0, y: 0 } }

/**
 * Advance the projectile by vel*dt, steering homing tracers toward the player on
 * the canonical cadence, then test collisions. Returns the impact descriptor;
 * world.ts applies any damage/splash/spray. The projectile is marked dead on any
 * real impact. NO enemy.ts import; NO damageEnemy/damagePlayer here.
 */
export function updateProjectile(
  proj: Projectile,
  scene: SceneQuery,
  player: Player,
  enemies: readonly Enemy[],
  dt: number,
): ProjectileImpact {
  proj.animTimer += dt
  if (!proj.alive) {
    return NO_IMPACT
  }

  // Homing (tracer): every HOMING_PERIOD-th fixed step, rotate velocity toward the
  // player by up to TRACER_TURN, then renormalize back to the missile's speed.
  if (proj.homing === true) {
    proj.steps = (proj.steps ?? 0) + 1
    if (proj.steps % HOMING_PERIOD === 0) {
      steerToward(proj, player.pos)
    }
  }

  proj.pos.x += proj.vel.x * dt
  proj.pos.y += proj.vel.y * dt

  // Wall: a solid cell stops the projectile flat.
  if (scene.isSolid(Math.floor(proj.pos.x), Math.floor(proj.pos.y))) {
    proj.alive = false
    return { hit: 'wall', enemyIndex: -1, pos: { x: proj.pos.x, y: proj.pos.y } }
  }

  // Enemy projectiles strike the player; player projectiles strike live enemies.
  // For INFIGHTING (doomBehaviorSpec.md §4 / §5 #20) an enemy missile ALSO collides with
  // any live, non-owner enemy in its path — world.ts turns that into a retaliation. We test
  // the non-owner enemies first so a missile that grazes another monster provokes it; only
  // if it misses every enemy does it fall through to the player check.
  if (proj.fromEnemy) {
    const enemyHit = enemyCollision(proj, enemies, proj.owner ?? null)
    if (enemyHit >= 0) {
      proj.alive = false
      return { hit: 'enemy', enemyIndex: enemyHit, pos: { x: proj.pos.x, y: proj.pos.y } }
    }
    if (dist(proj.pos, player.pos) <= PROJECTILE_RADIUS) {
      proj.alive = false
      return { hit: 'player', enemyIndex: -1, pos: { x: proj.pos.x, y: proj.pos.y } }
    }
    return NO_IMPACT
  }

  const enemyHit = enemyCollision(proj, enemies, null)
  if (enemyHit >= 0) {
    proj.alive = false
    return { hit: 'enemy', enemyIndex: enemyHit, pos: { x: proj.pos.x, y: proj.pos.y } }
  }

  return NO_IMPACT
}

/**
 * Nearest live enemy whose centre is within ENEMY_HIT_RADIUS of the projectile, skipping
 * `skip` (the firing enemy, so its own missile never hits itself). Returns the index or -1.
 * Shared by the player-shot and enemy-infight paths so the collision rule stays single-source.
 */
function enemyCollision(proj: Projectile, enemies: readonly Enemy[], skip: Enemy | null): number {
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i]
    if (!isTargetable(enemy) || enemy === skip) {
      continue
    }
    if (dist(proj.pos, enemy.pos) <= ENEMY_HIT_RADIUS) {
      return i
    }
  }
  return -1
}

/** Rotate proj.vel toward `target` by at most TRACER_TURN, keeping its speed. */
function steerToward(proj: Projectile, target: Vec2): void {
  const speed = Math.hypot(proj.vel.x, proj.vel.y)
  if (speed < 1e-6) {
    return
  }
  const cur = Math.atan2(proj.vel.y, proj.vel.x)
  const want = Math.atan2(target.y - proj.pos.y, target.x - proj.pos.x)
  let diff = want - cur
  // Normalize the angular difference to (-π, π].
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const turn = diff > TRACER_TURN ? TRACER_TURN : diff < -TRACER_TURN ? -TRACER_TURN : diff
  const next = cur + turn
  proj.vel = { x: Math.cos(next) * speed, y: Math.sin(next) * speed }
}

/** Pick a projectile frame cycling on PROJECTILE_FRAME_TIME from the live animTimer. */
export function projectileFrame(proj: Projectile, assets: Assets): Texture {
  const frames = assets.projectile[proj.kind]
  // createAssets guarantees ≥2 frames; Math.max keeps the modulo safe regardless.
  const index = Math.floor(proj.animTimer / PROJECTILE_FRAME_TIME) % Math.max(1, frames.length)
  return frames[index] ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) }
}
