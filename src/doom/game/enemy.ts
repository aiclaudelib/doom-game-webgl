// Enemy tuning tables, spawning, the data-driven AI state machine, and frame
// selection. ENEMY_DEFS holds canonical Doom tunings (see doomBehaviorSpec.md
// §3.1): HP, painchance/256, cruise cells/s, damage dice, attack cadence. The
// AI dispatches on the archetype (melee / hitscan / projectile / charger).

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
import { MELEE_RANGE, PLAYER_RADIUS } from '~/doom/config'
import { clamp, normalizeAngle } from '~/doom/core/math'
import { chance, randRange } from '~/doom/core/rng'
import { fromAngle, normalize, scale, sub } from '~/doom/core/vec'
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
/** Half-angle (radians) of aim jitter applied to enemy attacks and chase wander. */
const AIM_JITTER = 0.06
/** Mancubus FATSPREAD: ANG90/8 = 11.25° between fan shots. */
const FAT_SPREAD = Math.PI / 2 / 8

/**
 * Static tuning per enemy kind, faithful to doomBehaviorSpec.md §3.1.
 * speed = cells/s; painChance = painchance/256; damage = (1+floor(rng*sides))*mul.
 * projectileSpeed = cells/s (= u/s ÷ 64). attackCooldown is a faithful cadence in s.
 */
export const ENEMY_DEFS: Readonly<Record<EnemyKind, EnemyDef>> = {
  grunt: {
    kind: 'grunt',
    maxHealth: 20,
    speed: 1.09,
    radius: 0.31,
    attackRange: 12,
    attackCooldown: 1.0,
    painChance: 0.78,
    scale: 0.9,
    archetype: 'hitscan',
    ranged: false,
    damageSides: 5,
    damageMul: 3,
    attackShots: 1,
  },
  shotgunGuy: {
    kind: 'shotgunGuy',
    maxHealth: 30,
    speed: 1.46,
    radius: 0.31,
    attackRange: 12,
    attackCooldown: 1.2,
    painChance: 0.66,
    scale: 0.92,
    archetype: 'hitscan',
    ranged: false,
    damageSides: 5,
    damageMul: 3,
    attackShots: 3,
  },
  chaingunner: {
    kind: 'chaingunner',
    maxHealth: 70,
    speed: 1.46,
    radius: 0.31,
    attackRange: 12,
    attackCooldown: 0.45,
    painChance: 0.66,
    scale: 0.95,
    archetype: 'hitscan',
    ranged: false,
    damageSides: 5,
    damageMul: 3,
    attackShots: 1,
  },
  imp: {
    kind: 'imp',
    maxHealth: 60,
    speed: 1.46,
    radius: 0.31,
    attackRange: 7,
    attackCooldown: 1.2,
    painChance: 0.78,
    scale: 1.0,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 3,
    attackShots: 1,
    hasMelee: true,
    meleeSides: 8,
    meleeMul: 3,
    projectileSpeed: 5.47,
  },
  demon: {
    kind: 'demon',
    maxHealth: 150,
    speed: 2.73,
    radius: 0.47,
    attackRange: 1.3,
    attackCooldown: 1.0,
    painChance: 0.7,
    scale: 1.15,
    archetype: 'melee',
    ranged: false,
    damageSides: 10,
    damageMul: 4,
    attackShots: 1,
  },
  spectre: {
    kind: 'spectre',
    maxHealth: 150,
    speed: 2.73,
    radius: 0.47,
    attackRange: 1.3,
    attackCooldown: 1.0,
    painChance: 0.7,
    scale: 1.15,
    archetype: 'melee',
    ranged: false,
    damageSides: 10,
    damageMul: 4,
    attackShots: 1,
    fuzz: true,
  },
  lostSoul: {
    kind: 'lostSoul',
    maxHealth: 100,
    speed: 0.73,
    radius: 0.25,
    attackRange: 12,
    attackCooldown: 1.0,
    painChance: 1.0,
    scale: 0.8,
    archetype: 'charger',
    ranged: false,
    damageSides: 8,
    damageMul: 3,
    attackShots: 1,
    projectileSpeed: 10.94,
    flying: true,
  },
  cacodemon: {
    kind: 'cacodemon',
    maxHealth: 400,
    speed: 4.38,
    radius: 0.48,
    attackRange: 10,
    attackCooldown: 1.0,
    painChance: 0.5,
    scale: 1.3,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 5,
    attackShots: 1,
    hasMelee: true,
    meleeSides: 6,
    meleeMul: 10,
    projectileSpeed: 5.47,
    flying: true,
  },
  hellKnight: {
    kind: 'hellKnight',
    maxHealth: 500,
    speed: 4.38,
    radius: 0.38,
    attackRange: 12,
    attackCooldown: 1.2,
    painChance: 0.195,
    scale: 1.35,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 8,
    attackShots: 1,
    hasMelee: true,
    meleeSides: 8,
    meleeMul: 10,
    projectileSpeed: 8.2,
  },
  baron: {
    kind: 'baron',
    maxHealth: 1000,
    speed: 4.38,
    radius: 0.38,
    attackRange: 12,
    attackCooldown: 1.2,
    painChance: 0.195,
    scale: 1.4,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 8,
    attackShots: 1,
    hasMelee: true,
    meleeSides: 8,
    meleeMul: 10,
    projectileSpeed: 8.2,
  },
  mancubus: {
    kind: 'mancubus',
    maxHealth: 600,
    speed: 1.09,
    radius: 0.75,
    attackRange: 14,
    attackCooldown: 1.5,
    painChance: 0.3125,
    scale: 1.4,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 8,
    attackShots: 6,
    projectileSpeed: 10.94,
  },
  arachnotron: {
    kind: 'arachnotron',
    maxHealth: 500,
    speed: 2.19,
    radius: 1.0,
    attackRange: 14,
    attackCooldown: 0.5,
    painChance: 0.5,
    scale: 1.4,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 5,
    attackShots: 1,
    projectileSpeed: 13.67,
  },
  revenant: {
    kind: 'revenant',
    maxHealth: 300,
    speed: 2.73,
    radius: 0.31,
    attackRange: 12,
    attackCooldown: 1.1,
    painChance: 0.39,
    scale: 1.2,
    archetype: 'projectile',
    ranged: true,
    damageSides: 8,
    damageMul: 10,
    attackShots: 1,
    hasMelee: true,
    meleeSides: 10,
    meleeMul: 6,
    meleeRange: 3.0,
    projectileSpeed: 5.47,
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

/** Roll one damage value from the (sides, mul) dice: (1 + floor(rng*sides)) * mul. */
function rollDamage(rng: Rng, sides: number, mul: number): number {
  return (1 + Math.floor(rng() * sides)) * mul
}

/**
 * Advance one enemy by dt. Corpses hold; dying runs its timer then settles into
 * a corpse; hurt flinches briefly then chases. A charging lost soul dashes along
 * its chargeVel until it touches the player or a wall. Otherwise the enemy chases
 * the player whenever it can see them, attacking when in range and off cooldown.
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

  // A charging lost soul keeps dashing even mid-flinch is not allowed: pain
  // clears the charge below in damageEnemy. While charging, ignore the normal
  // chase logic and run the dash.
  if (enemy.charging === true) {
    chargeStep(enemy, player, scene, rng)
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
    attack(enemy, player, scene, projectiles, def, rng, distance)
    return
  }

  // Chase: step toward the player, sliding along walls. A little angular wander
  // keeps the swarm from collapsing onto a single line into the player.
  const stopDistance = def.archetype === 'melee' ? def.attackRange * 0.6 : 1.2
  if (distance > stopDistance) {
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
    enemy.charging = false
    enemy.chargeVel = undefined
    return
  }
  if (chance(rng, enemyDef(enemy.kind).painChance)) {
    enemy.state = 'hurt'
    enemy.stateTimer = HURT_TIME
    // A flinch interrupts a charge (lost soul painchance 256 ⇒ always flinches).
    enemy.charging = false
    enemy.chargeVel = undefined
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

/** Resolve an enemy's melee reach in cells (def override, else config default). */
function meleeReach(def: EnemyDef): number {
  return def.meleeRange ?? MELEE_RANGE
}

/**
 * Execute an attack, dispatched on the archetype. Hitscan applies bullets on LOS;
 * projectile spawns one-or-more missiles (fan for the mancubus); melee bites in
 * range; charger launches a dash. Hybrids prefer their melee branch up close.
 */
function attack(
  enemy: Enemy,
  player: Player,
  scene: SceneQuery,
  projectiles: Projectile[],
  def: EnemyDef,
  rng: Rng,
  distance: number,
): void {
  enemy.state = 'attack'
  enemy.stateTimer = ATTACK_POSE_TIME
  enemy.attackTimer = def.attackCooldown

  // Hybrids (imp/caco/revenant) bite when the player is within melee reach.
  if (def.hasMelee === true && distance <= meleeReach(def)) {
    damagePlayer(
      player,
      rollDamage(rng, def.meleeSides ?? def.damageSides, def.meleeMul ?? def.damageMul),
    )
    return
  }

  switch (def.archetype) {
    case 'hitscan':
      hitscanAttack(enemy, player, scene, def, rng)
      return
    case 'projectile':
      projectileAttack(enemy, projectiles, def, rng)
      return
    case 'charger':
      beginCharge(enemy, player, def)
      return
    default:
      // melee: bite when in range.
      if (distance <= meleeReach(def) || distance <= def.attackRange) {
        damagePlayer(player, rollDamage(rng, def.damageSides, def.damageMul))
      }
  }
}

/**
 * Hitscan: Doom hitscan is reliable, so on a clear line of sight every bullet
 * lands. attackShots bullets (zombieman 1, shotgun guy 3) each roll the dice.
 */
function hitscanAttack(
  enemy: Enemy,
  player: Player,
  scene: SceneQuery,
  def: EnemyDef,
  rng: Rng,
): void {
  if (!lineOfSight(scene, enemy.pos, player.pos)) {
    return
  }
  for (let i = 0; i < def.attackShots; i++) {
    damagePlayer(player, rollDamage(rng, def.damageSides, def.damageMul))
  }
}

/**
 * Projectile: fire attackShots fireballs toward the player. A single shot uses the
 * facing angle with a touch of jitter; the mancubus (6 shots) fans them out in
 * ±FAT_SPREAD steps around the facing.
 */
function projectileAttack(enemy: Enemy, projectiles: Projectile[], def: EnemyDef, rng: Rng): void {
  const speed = def.projectileSpeed
  const shots = def.attackShots
  for (let i = 0; i < shots; i++) {
    const spread =
      shots > 1 ? (i - (shots - 1) / 2) * FAT_SPREAD : randRange(rng, -AIM_JITTER, AIM_JITTER)
    const dir = fromAngle(enemy.angle + spread)
    const dmg = rollDamage(rng, def.damageSides, def.damageMul)
    projectiles.push(spawnProjectile('fireball', enemy.pos, dir, dmg, true, speed))
  }
}

/** Begin a lost-soul charge: lock chargeVel toward the player at the dash speed. */
function beginCharge(enemy: Enemy, player: Player, def: EnemyDef): void {
  const dir = normalize(sub(player.pos, enemy.pos))
  enemy.charging = true
  enemy.chargeVel = scale(dir, def.projectileSpeed ?? 0)
}

/**
 * Advance a charging lost soul one fixed step. It moves along chargeVel; touching
 * the player deals contact damage and ends the charge; hitting a wall ends it too.
 * Either way the cooldown is set so it pauses before the next dash.
 */
function chargeStep(enemy: Enemy, player: Player, scene: SceneQuery, rng: Rng): void {
  const def = enemyDef(enemy.kind)
  const vel = enemy.chargeVel ?? { x: 0, y: 0 }
  const step = scale(vel, 1 / 60)
  const before = enemy.pos
  const moved = moveWithCollision(scene, before, step, def.radius)

  // Contact with the player: deal contact damage, stop, go on cooldown.
  const reach = def.radius + PLAYER_RADIUS
  if (Math.hypot(player.pos.x - moved.x, player.pos.y - moved.y) <= reach) {
    damagePlayer(player, rollDamage(rng, def.damageSides, def.damageMul))
    endCharge(enemy, def)
    return
  }

  // Hit a wall (no progress this step): stop the charge.
  if (Math.abs(moved.x - before.x) < 1e-4 && Math.abs(moved.y - before.y) < 1e-4) {
    endCharge(enemy, def)
    return
  }

  enemy.pos.x = moved.x
  enemy.pos.y = moved.y
}

/** Stop a charge and put the lost soul into its attack-recover pose + cooldown. */
function endCharge(enemy: Enemy, def: EnemyDef): void {
  enemy.charging = false
  enemy.chargeVel = undefined
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
