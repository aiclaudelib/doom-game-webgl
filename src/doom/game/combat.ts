// Pure combat geometry: line-of-sight visibility and hitscan ray marching.
// No entity-module imports — operates only on the SceneQuery + enemy snapshots.

import { ENEMY_HALF_HEIGHT, ENEMY_HIT_RADIUS } from '~/doom/config'
import type { Enemy, HitscanResult, SceneQuery, Vec2 } from '~/doom/types'
import { fromAngle } from '~/doom/core/vec'

/**
 * A live enemy that combat/projectiles may strike: present, alive, and not already
 * in its death sequence. Shared so hitscan and projectile collision agree on the
 * "is this a valid target" rule (and don't duplicate the guard). Pure.
 */
export function isTargetable(enemy: Enemy | undefined): enemy is Enemy {
  return enemy?.alive === true && enemy.state !== 'dead' && enemy.state !== 'dying'
}

/**
 * DDA traversal from `from` to `to`; returns false the moment a solid cell lies
 * on the segment before the target is reached. The endpoints' own cells are not
 * treated as blockers so an enemy standing in a doorway can still see out.
 */
export function lineOfSight(scene: SceneQuery, from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const segLen = Math.hypot(dx, dy)
  if (segLen < 1e-6) {
    return true
  }

  let mapX = Math.floor(from.x)
  let mapY = Math.floor(from.y)
  const targetX = Math.floor(to.x)
  const targetY = Math.floor(to.y)

  const dirX = dx / segLen
  const dirY = dy / segLen

  // Distance along the ray to cross one full cell on each axis.
  const deltaX = dirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirX)
  const deltaY = dirY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirY)

  let stepX: number
  let sideX: number
  if (dirX < 0) {
    stepX = -1
    sideX = (from.x - mapX) * deltaX
  } else {
    stepX = 1
    sideX = (mapX + 1 - from.x) * deltaX
  }

  let stepY: number
  let sideY: number
  if (dirY < 0) {
    stepY = -1
    sideY = (from.y - mapY) * deltaY
  } else {
    stepY = 1
    sideY = (mapY + 1 - from.y) * deltaY
  }

  // Bound iterations to the Manhattan cell span plus slack — never loops forever.
  const maxSteps = Math.abs(targetX - mapX) + Math.abs(targetY - mapY) + 2
  for (let i = 0; i < maxSteps; i++) {
    if (sideX < sideY) {
      sideX += deltaX
      mapX += stepX
    } else {
      sideY += deltaY
      mapY += stepY
    }
    if (mapX === targetX && mapY === targetY) {
      return true
    }
    if (scene.isSolid(mapX, mapY)) {
      return false
    }
  }
  return true
}

/**
 * March a ray from `origin` along `angle` up to `range`. Tracks the first solid
 * wall along the ray and the nearest non-dead enemy whose centre is within
 * ENEMY_HIT_RADIUS of the ray; an enemy only counts when it is nearer than that
 * wall. Returns the closest impact.
 *
 * `slope` is an optional vertical rise/run for the shot (0 = level, the default for
 * every non-SSG caller). With a non-zero slope a far target may be cleared vertically:
 * the gun's vertical rise at the target's distance must stay within ENEMY_HALF_HEIGHT.
 * `slope===0` ⇒ the gate always passes ⇒ byte-identical to the old 5-arg behaviour.
 */
export function hitscan(
  scene: SceneQuery,
  enemies: readonly Enemy[],
  origin: Vec2,
  angle: number,
  range: number,
  slope = 0,
): HitscanResult {
  const dir = fromAngle(angle)

  // 1. Find the wall distance via DDA so enemies behind walls are excluded.
  const wallDist = castWall(scene, origin, dir, range)

  // 2. Project each candidate enemy onto the ray, keeping the nearest valid hit.
  let bestIndex = -1
  let bestDist = wallDist
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i]
    if (!isTargetable(enemy)) {
      continue
    }
    const relX = enemy.pos.x - origin.x
    const relY = enemy.pos.y - origin.y
    // Distance along the ray to the enemy's closest approach.
    const along = relX * dir.x + relY * dir.y
    if (along <= 0 || along >= bestDist) {
      continue
    }
    // Perpendicular offset from the ray line.
    const perpX = relX - dir.x * along
    const perpY = relY - dir.y * along
    const perp = Math.hypot(perpX, perpY)
    if (perp <= ENEMY_HIT_RADIUS) {
      // Vertical gate: the shot's rise at the enemy's distance must clear the target's
      // half-height. slope===0 ⇒ vertOffset===0 ⇒ always satisfied (identical legacy path).
      const vertOffset = Math.abs(slope) * along
      if (vertOffset <= ENEMY_HALF_HEIGHT) {
        bestIndex = i
        bestDist = along
      }
    }
  }

  const distance = bestIndex >= 0 ? bestDist : wallDist
  return {
    enemyIndex: bestIndex,
    distance,
    point: { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance },
    hitEnemy: bestIndex >= 0,
  }
}

/**
 * Splash falloff (Doom A_Explode / P_RadiusAttack). Distance is measured cell-wise then
 * converted to map units (×64); the target's own radius (in cells, ×64) is subtracted so
 * big targets take full damage closer in. Result: `peak` at the centre, fading linearly,
 * 0 at or beyond `peak` units. `peak` defaults to 128, so the 3-arg form is byte-identical
 * to the original; the rocket threads its own `splashPeak` through applySplash so the magic
 * 128 is data-driven (a smaller peak shrinks the blast radius). Pure.
 *
 * SANCTIONED DEVIATION (weaponPlan §1.4 / §5): canon `P_RadiusAttack` measures distance with
 * the octagonal `P_AproxDistance ((max + min) / 2)` and a fixed peak 128; we use Chebyshev
 * `max(|dx|,|dy|)·64 − radius·64`. The peak, the `peak − dist` falloff, the LOS gate, the
 * shooter self-damage, and the Cyberdemon/Spider splash immunity are all preserved (those live
 * in world.applySplash) — only the distance metric is the cheaper Chebyshev, kept by design.
 */
export function splashDamage(
  centerCells: Vec2,
  targetCells: Vec2,
  targetRadiusCells: number,
  peak = 128,
): number {
  const dx = Math.abs(targetCells.x - centerCells.x)
  const dy = Math.abs(targetCells.y - centerCells.y)
  const distUnits = Math.max(dx, dy) * 64 - targetRadiusCells * 64
  const dmg = peak - distUnits
  if (dmg <= 0) {
    return 0
  }
  return dmg > peak ? peak : dmg
}

/** DDA march returning the distance to the first solid cell, clamped to `range`. */
function castWall(scene: SceneQuery, origin: Vec2, dir: Vec2, range: number): number {
  let mapX = Math.floor(origin.x)
  let mapY = Math.floor(origin.y)

  const deltaX = dir.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.x)
  const deltaY = dir.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.y)

  let stepX: number
  let sideX: number
  if (dir.x < 0) {
    stepX = -1
    sideX = (origin.x - mapX) * deltaX
  } else {
    stepX = 1
    sideX = (mapX + 1 - origin.x) * deltaX
  }

  let stepY: number
  let sideY: number
  if (dir.y < 0) {
    stepY = -1
    sideY = (origin.y - mapY) * deltaY
  } else {
    stepY = 1
    sideY = (mapY + 1 - origin.y) * deltaY
  }

  let dist = 0
  while (dist < range) {
    if (sideX < sideY) {
      dist = sideX
      sideX += deltaX
      mapX += stepX
    } else {
      dist = sideY
      sideY += deltaY
      mapY += stepY
    }
    if (dist >= range) {
      break
    }
    if (scene.isSolid(mapX, mapY)) {
      return dist
    }
  }
  return range
}
