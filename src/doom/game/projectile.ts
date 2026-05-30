// Projectiles: spawn, integrate, collide. Fireballs are the only kind for now.

import { PROJECTILE_RADIUS, PROJECTILE_SPEED } from '~/doom/config'
import type {
  Assets,
  Player,
  Projectile,
  ProjectileKind,
  SceneQuery,
  Texture,
  Vec2,
} from '~/doom/types'
import { dist, normalize, scale } from '~/doom/core/vec'
import { damagePlayer } from '~/doom/game/player'

/** Animation cadence for the fireball spin, in seconds per frame. */
const PROJECTILE_FRAME_TIME = 0.08

/**
 * Create a projectile whose velocity is the normalized direction × `speed`
 * (cells/s). `speed` defaults to PROJECTILE_SPEED so existing callers are
 * unchanged; enemies pass their canonical missile speed.
 */
export function spawnProjectile(
  kind: ProjectileKind,
  pos: Vec2,
  dir: Vec2,
  damage: number,
  fromEnemy: boolean,
  speed = PROJECTILE_SPEED,
): Projectile {
  const vel = scale(normalize(dir), speed)
  return {
    kind,
    pos: { x: pos.x, y: pos.y },
    vel,
    damage,
    fromEnemy,
    alive: true,
    animTimer: 0,
  }
}

/**
 * Advance the projectile by vel*dt. It dies on hitting a solid cell. An
 * enemy-fired projectile that comes within PROJECTILE_RADIUS of the player
 * deals damage and dies. The animation clock always advances.
 */
export function updateProjectile(
  proj: Projectile,
  player: Player,
  scene: SceneQuery,
  dt: number,
): void {
  proj.animTimer += dt
  if (!proj.alive) {
    return
  }

  proj.pos.x += proj.vel.x * dt
  proj.pos.y += proj.vel.y * dt

  if (scene.isSolid(Math.floor(proj.pos.x), Math.floor(proj.pos.y))) {
    proj.alive = false
    return
  }

  if (proj.fromEnemy && dist(proj.pos, player.pos) <= PROJECTILE_RADIUS) {
    damagePlayer(player, proj.damage)
    proj.alive = false
  }
}

/** Pick a fireball frame cycling on PROJECTILE_FRAME_TIME from the live animTimer. */
export function projectileFrame(proj: Projectile, assets: Assets): Texture {
  const frames = assets.projectile[proj.kind]
  // createAssets guarantees ≥2 frames; Math.max keeps the modulo safe regardless.
  const index = Math.floor(proj.animTimer / PROJECTILE_FRAME_TIME) % Math.max(1, frames.length)
  return frames[index] ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) }
}
