// Enemy tuning tables, spawning, the AI state machine, and frame selection.

import type {
  Assets,
  Enemy,
  EnemyDef,
  EnemyKind,
  Player,
  Projectile,
  Rng,
  SceneQuery,
  Texture,
  Vec2,
} from '~/doom/types'
import { clamp, normalizeAngle } from '~/doom/core/math'
import { chance, randRange } from '~/doom/core/rng'
import { fromAngle, sub } from '~/doom/core/vec'
import { lineOfSight } from '~/doom/game/combat'
import { moveWithCollision } from '~/doom/game/collision'
import { damagePlayer } from '~/doom/game/player'
import { spawnProjectile } from '~/doom/game/projectile'

/** Seconds a flinch (hurt) lasts before the enemy resumes chasing. */
const HURT_TIME = 0.25
/** Seconds the death animation plays before the enemy becomes a static corpse. */
const DYING_TIME = 0.6
/** Seconds the attack pose is held after a swing/shot. */
const ATTACK_POSE_TIME = 0.3
/** Walk-cycle frame cadence (seconds per frame). */
const WALK_FRAME_TIME = 0.18
/** Damage dealt by an imp fireball. */
const FIREBALL_DAMAGE = 12
/** Half-angle (radians) of aim jitter applied to enemy attacks. */
const AIM_JITTER = 0.06

/** Static tuning per enemy kind. */
export const ENEMY_DEFS: Readonly<Record<EnemyKind, EnemyDef>> = {
  grunt: {
    kind: 'grunt',
    maxHealth: 30,
    speed: 2.0,
    radius: 0.3,
    attackRange: 1.1,
    attackDamage: 8,
    attackCooldown: 1.0,
    ranged: false,
    painChance: 0.5,
    scale: 0.9,
  },
  imp: {
    kind: 'imp',
    maxHealth: 45,
    speed: 1.7,
    radius: 0.32,
    attackRange: 7.0,
    attackDamage: FIREBALL_DAMAGE,
    attackCooldown: 1.4,
    ranged: true,
    painChance: 0.4,
    scale: 1.0,
  },
  demon: {
    kind: 'demon',
    maxHealth: 80,
    speed: 2.6,
    radius: 0.4,
    attackRange: 1.3,
    attackDamage: 16,
    attackCooldown: 1.2,
    ranged: false,
    painChance: 0.25,
    scale: 1.15,
  },
}

/** Lookup the static tuning table for a kind. */
export function enemyDef(kind: EnemyKind): EnemyDef {
  return ENEMY_DEFS[kind]
}

/** Create a fresh enemy at full health, idle, ready to attack. */
export function spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
  const def = enemyDef(kind)
  return {
    kind,
    pos: { x, y },
    angle: 0,
    health: def.maxHealth,
    state: 'idle',
    stateTimer: 0,
    animTimer: 0,
    attackTimer: 0,
    alive: true,
  }
}

/**
 * Advance one enemy by dt. Corpses hold; dying runs its timer then settles into
 * a corpse; hurt flinches briefly then chases. Otherwise the enemy chases the
 * player whenever it can see them, attacking when in range and off cooldown.
 */
export function updateEnemy(
  enemy: Enemy,
  player: Player,
  scene: SceneQuery,
  projectiles: Projectile[],
  rng: Rng,
  dt: number,
): void {
  enemy.animTimer += dt
  if (enemy.attackTimer > 0) {
    enemy.attackTimer = Math.max(0, enemy.attackTimer - dt)
  }

  if (enemy.state === 'dead') {
    return
  }

  if (enemy.state === 'dying') {
    enemy.stateTimer -= dt
    if (enemy.stateTimer <= 0) {
      enemy.state = 'dead'
      enemy.alive = false
    }
    return
  }

  if (enemy.state === 'hurt') {
    enemy.stateTimer -= dt
    if (enemy.stateTimer <= 0) {
      enemy.state = 'chase'
    }
    return
  }

  if (enemy.state === 'attack') {
    enemy.stateTimer -= dt
    if (enemy.stateTimer <= 0) {
      enemy.state = 'chase'
    }
    // Keep facing the player through the swing so projectiles aim true.
    facePlayer(enemy, player.pos)
    return
  }

  // idle / chase: only act when the player is visible.
  if (!lineOfSight(scene, enemy.pos, player.pos)) {
    if (enemy.state === 'idle') {
      return
    }
    // Lost sight while chasing — drift back to idle.
    enemy.state = 'idle'
    return
  }

  enemy.state = 'chase'
  facePlayer(enemy, player.pos)

  const def = enemyDef(enemy.kind)
  const toPlayer = sub(player.pos, enemy.pos)
  const distance = Math.hypot(toPlayer.x, toPlayer.y)

  if (distance <= def.attackRange && enemy.attackTimer <= 0) {
    attack(enemy, player, projectiles, def, rng)
    return
  }

  // Chase: step toward the player, sliding along walls. A little angular wander
  // keeps the swarm from collapsing onto a single line into the player.
  if (distance > def.attackRange * 0.6) {
    const wander = randRange(rng, -AIM_JITTER, AIM_JITTER)
    const step = fromAngle(enemy.angle + wander, def.speed * dt)
    const moved = moveWithCollision(scene, enemy.pos, step, def.radius)
    enemy.pos.x = moved.x
    enemy.pos.y = moved.y
  }
}

/** Apply damage; ≤0 health kills (dying), else a painChance roll may flinch. */
export function damageEnemy(enemy: Enemy, amount: number, rng: Rng): void {
  if (enemy.state === 'dead' || enemy.state === 'dying') {
    return
  }
  enemy.health -= amount
  if (enemy.health <= 0) {
    enemy.health = 0
    enemy.state = 'dying'
    enemy.stateTimer = DYING_TIME
    enemy.animTimer = 0
    return
  }
  if (chance(rng, enemyDef(enemy.kind).painChance)) {
    enemy.state = 'hurt'
    enemy.stateTimer = HURT_TIME
  }
}

/** Choose the texture for the current state, cycling walk frames over animTimer. */
export function enemyFrame(enemy: Enemy, assets: Assets): Texture {
  const visual = assets.enemy[enemy.kind]

  if (enemy.state === 'dead') {
    return lastFrame(visual.die)
  }
  if (enemy.state === 'dying') {
    const progress = clamp(1 - enemy.stateTimer / DYING_TIME, 0, 1)
    return progressFrame(visual.die, progress)
  }
  if (enemy.state === 'hurt') {
    return firstFrame(visual.hurt)
  }
  if (enemy.state === 'attack') {
    return frameByTime(visual.attack, enemy.animTimer, WALK_FRAME_TIME)
  }
  // idle / chase share the walk cycle.
  return frameByTime(visual.walk, enemy.animTimer, WALK_FRAME_TIME)
}

/** Rotate the enemy to look at the target position. */
function facePlayer(enemy: Enemy, target: Vec2): void {
  enemy.angle = normalizeAngle(Math.atan2(target.y - enemy.pos.y, target.x - enemy.pos.x))
}

/** Execute an attack: ranged enemies launch a fireball, melee enemies bite. */
function attack(
  enemy: Enemy,
  player: Player,
  projectiles: Projectile[],
  def: EnemyDef,
  rng: Rng,
): void {
  if (def.ranged) {
    // Fire along the facing angle with a touch of jitter so the imp can miss.
    const aim = enemy.angle + randRange(rng, -AIM_JITTER, AIM_JITTER)
    const dir = fromAngle(aim)
    projectiles.push(spawnProjectile('fireball', enemy.pos, dir, def.attackDamage, true))
  } else {
    damagePlayer(player, def.attackDamage)
  }
  enemy.state = 'attack'
  enemy.stateTimer = ATTACK_POSE_TIME
  enemy.attackTimer = def.attackCooldown
}

/** Read a frame at `index`, clamped into [0, count-1]; empty list → a blank texture. */
function safeFrame(frames: readonly Texture[], index: number): Texture {
  const count = frames.length
  if (count === 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  }
  const clamped = clamp(index, 0, count - 1)
  return frames[clamped] ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) }
}

/** Cycle through `frames` on a fixed cadence; safe on empty/short lists. */
function frameByTime(frames: readonly Texture[], time: number, frameTime: number): Texture {
  const count = frames.length
  const step = count === 0 ? 0 : Math.floor(time / frameTime) % count
  return safeFrame(frames, step)
}

/** Map a 0..1 progress value onto a frame index across the list (holds the last). */
function progressFrame(frames: readonly Texture[], progress: number): Texture {
  return safeFrame(frames, Math.floor(progress * frames.length))
}

function firstFrame(frames: readonly Texture[]): Texture {
  return safeFrame(frames, 0)
}

function lastFrame(frames: readonly Texture[]): Texture {
  return safeFrame(frames, frames.length - 1)
}
