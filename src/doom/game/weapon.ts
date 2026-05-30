// Weapon tuning table and firing logic. tryFire branches on def.fireMode:
//  - melee   : a single hitscan at MELEE_RANGE, dice 2..20 (×10 fist berserk).
//  - hitscan : def.pellets hitscans with horizontal spread (SSG adds a vertical-
//              spread miss chance); damage applied to struck enemies here.
//  - projectile (rocket/plasma/bfg): spawn a player projectile; world.ts resolves
//              its impact + splash/spray (keeps the projectile->enemy edge out).

import { MELEE_RANGE } from '~/doom/config'
import { randRange } from '~/doom/core/rng'
import type {
  Enemy,
  Player,
  Projectile,
  Rng,
  SceneQuery,
  Vec2,
  WeaponDef,
  WeaponKind,
} from '~/doom/types'
import { fromAngle } from '~/doom/core/vec'
import { hitscan } from '~/doom/game/combat'
import { damageEnemy } from '~/doom/game/enemy'
import { setMessage } from '~/doom/game/player'
import { PROJECTILE_DEFS, spawnProjectile } from '~/doom/game/projectile'

/** Seconds a firing animation lasts before the weapon returns to ready (also the fire cadence). */
const SWITCH_TIME = 0.18
/** Full-level hitscan reach (MISSILERANGE 2048u ≈ 32 cells). */
const GUN_RANGE = 32

export const WEAPONS: Readonly<Record<WeaponKind, WeaponDef>> = {
  fist: {
    kind: 'fist',
    ammo: null,
    damageSides: 10,
    damageMul: 2,
    pellets: 1,
    spread: 0.098,
    fireDelay: 0.63,
    range: MELEE_RANGE,
    automatic: false,
    slot: 1,
    fireMode: 'melee',
    ammoPerShot: 0,
    berserkBoost: true,
  },
  chainsaw: {
    kind: 'chainsaw',
    ammo: null,
    damageSides: 10,
    damageMul: 2,
    pellets: 1,
    spread: 0.098,
    fireDelay: 0.114,
    range: MELEE_RANGE,
    automatic: true,
    slot: 1,
    fireMode: 'melee',
    ammoPerShot: 0,
  },
  pistol: {
    kind: 'pistol',
    ammo: 'bullets',
    damageSides: 3,
    damageMul: 5,
    pellets: 1,
    spread: 0.098,
    fireDelay: 0.4,
    range: GUN_RANGE,
    automatic: false,
    slot: 2,
    fireMode: 'hitscan',
    ammoPerShot: 1,
  },
  shotgun: {
    kind: 'shotgun',
    ammo: 'shells',
    damageSides: 3,
    damageMul: 5,
    pellets: 7,
    spread: 0.087,
    fireDelay: 1.257,
    range: GUN_RANGE,
    automatic: false,
    slot: 3,
    fireMode: 'hitscan',
    ammoPerShot: 1,
  },
  superShotgun: {
    kind: 'superShotgun',
    ammo: 'shells',
    damageSides: 3,
    damageMul: 5,
    pellets: 20,
    spread: 0.196,
    fireDelay: 1.771,
    range: GUN_RANGE,
    automatic: false,
    slot: 3,
    fireMode: 'hitscan',
    ammoPerShot: 2,
    verticalSpread: 0.25,
  },
  chaingun: {
    kind: 'chaingun',
    ammo: 'bullets',
    damageSides: 3,
    damageMul: 5,
    pellets: 1,
    spread: 0.098,
    fireDelay: 0.114,
    range: GUN_RANGE,
    automatic: true,
    slot: 4,
    fireMode: 'hitscan',
    ammoPerShot: 1,
  },
  rocket: {
    kind: 'rocket',
    ammo: 'rockets',
    damageSides: 8,
    damageMul: 20,
    pellets: 1,
    spread: 0,
    fireDelay: 0.571,
    range: GUN_RANGE,
    automatic: false,
    slot: 5,
    fireMode: 'projectile',
    ammoPerShot: 1,
    projectileKind: 'rocket',
  },
  plasma: {
    kind: 'plasma',
    ammo: 'cells',
    damageSides: 8,
    damageMul: 5,
    pellets: 1,
    spread: 0,
    fireDelay: 0.086,
    range: GUN_RANGE,
    automatic: true,
    slot: 6,
    fireMode: 'projectile',
    ammoPerShot: 1,
    projectileKind: 'plasma',
  },
  bfg: {
    kind: 'bfg',
    ammo: 'cells',
    damageSides: 8,
    damageMul: 100,
    pellets: 1,
    spread: 0,
    fireDelay: 1.714,
    range: GUN_RANGE,
    automatic: false,
    slot: 7,
    fireMode: 'projectile',
    ammoPerShot: 40,
    projectileKind: 'bfg',
  },
}

export function weaponDef(kind: WeaponKind): WeaponDef {
  return WEAPONS[kind]
}

/**
 * Map a 1..7 selection key to its weapon kind given what the player owns:
 * slot 1 = chainsaw if owned else fist; 3 = superShotgun if owned else shotgun.
 * Other slots map to a single weapon. Returns null for an out-of-range slot.
 */
export function weaponBySlot(slot: number, player: Player): WeaponKind | null {
  switch (slot) {
    case 1:
      return player.weapons.chainsaw === true ? 'chainsaw' : 'fist'
    case 2:
      return 'pistol'
    case 3:
      return player.weapons.superShotgun === true ? 'superShotgun' : 'shotgun'
    case 4:
      return 'chaingun'
    case 5:
      return 'rocket'
    case 6:
      return 'plasma'
    case 7:
      return 'bfg'
    default:
      return null
  }
}

/** Advance the switch/fire phase timers and resolve back to ready when each elapses. */
export function updateWeapon(player: Player, dt: number): void {
  if (player.weaponState === 'switching') {
    player.weaponTimer += dt
    if (player.weaponTimer >= SWITCH_TIME) {
      const pending = player.pendingWeapon
      if (pending !== null) {
        player.currentWeapon = pending
      }
      player.pendingWeapon = null
      player.weaponState = 'ready'
      player.weaponTimer = 0
      player.weaponFrame = 0
    }
    return
  }

  if (player.weaponState === 'firing') {
    player.weaponTimer += dt
    const def = WEAPONS[player.currentWeapon]
    const frames = Math.max(1, Math.round(def.fireDelay / SWITCH_TIME))
    player.weaponFrame = Math.min(frames - 1, Math.floor(player.weaponTimer / SWITCH_TIME))
    if (player.weaponTimer >= def.fireDelay) {
      player.weaponState = 'ready'
      player.weaponTimer = 0
      player.weaponFrame = 0
    }
  }
}

export interface FireOutcome {
  readonly fired: boolean
  readonly soundKind: WeaponKind | null
  readonly hitEnemy: boolean
}

const NO_FIRE: FireOutcome = { fired: false, soundKind: null, hitEnemy: false }

/** Roll one damage value from the (sides, mul) dice: (1 + floor(rng*sides)) * mul. */
function rollDamage(rng: Rng, sides: number, mul: number): number {
  return (1 + Math.floor(rng() * sides)) * mul
}

/**
 * Fire the current weapon if ready and supplied. Consumes def.ammoPerShot, then
 * dispatches on fireMode. Projectiles are pushed into `projectiles`; world.ts
 * resolves their impacts (so the projectile->enemy damage edge stays out of here).
 */
export function tryFire(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  projectiles: Projectile[],
  rng: Rng,
): FireOutcome {
  if (player.weaponState !== 'ready') {
    return NO_FIRE
  }

  const kind = player.currentWeapon
  const def = WEAPONS[kind]

  const ammoKind = def.ammo
  if (ammoKind !== null && def.ammoPerShot > 0) {
    const current = player.ammo[ammoKind] ?? 0
    if (current < def.ammoPerShot) {
      setMessage(player, 'OUT OF AMMO')
      return NO_FIRE
    }
    player.ammo[ammoKind] = current - def.ammoPerShot
  }

  player.weaponState = 'firing'
  player.weaponTimer = 0
  player.weaponFrame = 0

  switch (def.fireMode) {
    case 'melee':
      return { fired: true, soundKind: kind, hitEnemy: fireMelee(player, scene, enemies, def, rng) }
    case 'projectile':
      fireProjectile(player, projectiles, def, rng)
      return { fired: true, soundKind: kind, hitEnemy: false }
    default:
      return {
        fired: true,
        soundKind: kind,
        hitEnemy: fireHitscan(player, scene, enemies, def, rng),
      }
  }
}

/** Melee: one hitscan at MELEE_RANGE; fist ×10 when berserk, chainsaw never boosted. */
function fireMelee(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  def: WeaponDef,
  rng: Rng,
): boolean {
  const spread = def.spread > 0 ? randRange(rng, -def.spread, def.spread) : 0
  const result = hitscan(scene, enemies, player.pos, player.angle + spread, def.range)
  if (!result.hitEnemy) {
    return false
  }
  const enemy = enemies[result.enemyIndex]
  if (enemy === undefined) {
    return false
  }
  let dmg = rollDamage(rng, def.damageSides, def.damageMul)
  if (def.berserkBoost === true && player.berserk === true) {
    dmg *= 10
  }
  damageEnemy(enemy, dmg, rng)
  return true
}

/**
 * Hitscan: fire def.pellets rays with horizontal spread, each rolling the dice and
 * damaging the struck enemy. SSG models its extra random vertical spread as a
 * per-pellet hit-chance reduction (the planar engine has no vertical aim) — a pellet
 * may "miss vertically" with probability verticalSpread, documented simplification.
 */
function fireHitscan(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  def: WeaponDef,
  rng: Rng,
): boolean {
  let hitAny = false
  for (let i = 0; i < def.pellets; i++) {
    if (def.verticalSpread !== undefined && rng() < def.verticalSpread) {
      continue // vertical-spread miss (planar engine approximation)
    }
    const spread = def.spread > 0 ? randRange(rng, -def.spread, def.spread) : 0
    const result = hitscan(scene, enemies, player.pos, player.angle + spread, def.range)
    if (result.hitEnemy) {
      const enemy = enemies[result.enemyIndex]
      if (enemy !== undefined) {
        damageEnemy(enemy, rollDamage(rng, def.damageSides, def.damageMul), rng)
        hitAny = true
      }
    }
  }
  return hitAny
}

/** Projectile: spawn one missile from the muzzle along the aim, dice-rolled damage. */
function fireProjectile(player: Player, projectiles: Projectile[], def: WeaponDef, rng: Rng): void {
  const projKind = def.projectileKind
  if (projKind === undefined) {
    return
  }
  const pdef = PROJECTILE_DEFS[projKind]
  const dir = fromAngle(player.angle)
  const muzzle: Vec2 = { x: player.pos.x + dir.x * 0.4, y: player.pos.y + dir.y * 0.4 }
  const dmg = rollDamage(rng, 8, pdef.base)
  projectiles.push(spawnProjectile(projKind, muzzle, dir, dmg, false, pdef.speed))
}
