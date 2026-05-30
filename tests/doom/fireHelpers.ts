// Shared test helpers for driving the 35Hz psprite tic engine. Several weapon suites need to
// "fire one shot": hold the attack input and step updateWeapon at 1/35s until exactly one shot
// resolves (or a per-weapon tic cap derived from fireDelaySeconds). Factored here so the body
// lives in ONE place (no jscpd-flagged copy-paste across weapon/hitscan/melee/projectile tests).

import type { Enemy, Player, Projectile, Rng, SceneQuery, Vec2 } from '~/doom/types'
import { WEAPONS, fireDelaySeconds, updateWeapon } from '~/doom/game/weapon'

/** Fixed engine tic step (35Hz). */
export const TIC = 1 / 35

/** A wide-open, wall-free arena scene for headless firing tests. */
export function openScene(): SceneQuery {
  return {
    width: 64,
    height: 64,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: () => false,
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

/** The accumulated outcome of one fire resolution. */
export interface FireResult {
  fired: string | null
  dryFired: boolean
  /** Chainsaw pull vector (undefined unless a meleePull bite connected). */
  pull: Vec2 | undefined
}

/**
 * Drive the tic engine with the attack HELD until one shot resolves (fired or dry-fired) or a
 * tic cap (fireDelaySeconds + slack) elapses. Returns the accumulated fired/dryFired/pull. The
 * caller owns the `projectiles` array, so a projectile-weapon suite can inspect what spawned.
 */
export function fireOnce(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  projectiles: Projectile[],
  rng: Rng,
): FireResult {
  const cap = Math.ceil(fireDelaySeconds(WEAPONS[player.currentWeapon]) / TIC) + 8
  let fired: string | null = null
  let dryFired = false
  let pull: Vec2 | undefined
  for (let i = 0; i < cap && fired === null && !dryFired; i++) {
    const r = updateWeapon(player, true, scene, enemies, projectiles, rng, TIC)
    if (r.fired !== null) {
      fired = r.fired
    }
    if (r.dryFired) {
      dryFired = true
    }
    if (r.pull !== undefined) {
      pull = r.pull
    }
  }
  return { fired, dryFired, pull }
}
