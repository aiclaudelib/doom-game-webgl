// Weapon tuning table and firing logic.
// tryFire runs def.pellets hitscans through combat.hitscan and applies damage to struck enemies.

import { MELEE_RANGE } from '~/doom/config'
import { randRange } from '~/doom/core/rng'
import type { Enemy, Player, Rng, SceneQuery, WeaponDef, WeaponKind } from '~/doom/types'
import { hitscan } from '~/doom/game/combat'
import { damageEnemy } from '~/doom/game/enemy'
import { setMessage } from '~/doom/game/player'

/** Seconds a firing animation lasts before the weapon returns to ready (also the fire cadence). */
const SWITCH_TIME = 0.18

export const WEAPONS: Readonly<Record<WeaponKind, WeaponDef>> = {
  fist: {
    kind: 'fist',
    ammo: null,
    damage: 22,
    pellets: 1,
    spread: 0,
    fireDelay: 0.32,
    range: MELEE_RANGE,
    automatic: false,
    slot: 1,
  },
  pistol: {
    kind: 'pistol',
    ammo: 'bullets',
    damage: 14,
    pellets: 1,
    spread: 0,
    fireDelay: 0.36,
    range: 24,
    automatic: false,
    slot: 2,
  },
  shotgun: {
    kind: 'shotgun',
    ammo: 'shells',
    damage: 11,
    pellets: 7,
    spread: 0.13,
    fireDelay: 0.78,
    range: 20,
    automatic: false,
    slot: 3,
  },
  chaingun: {
    kind: 'chaingun',
    ammo: 'bullets',
    damage: 12,
    pellets: 1,
    spread: 0.05,
    fireDelay: 0.1,
    range: 24,
    automatic: true,
    slot: 4,
  },
}

const SLOT_ORDER: readonly WeaponKind[] = ['fist', 'pistol', 'shotgun', 'chaingun']

export function weaponDef(kind: WeaponKind): WeaponDef {
  return WEAPONS[kind]
}

/** Map a 1..4 selection key to its weapon kind, or null for an unmapped slot. */
export function weaponBySlot(slot: number): WeaponKind | null {
  return SLOT_ORDER[slot - 1] ?? null
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

/** Fire the current weapon if ready and supplied. Consumes one ammo unit and resolves all pellets. */
export function tryFire(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  rng: Rng,
): FireOutcome {
  if (player.weaponState !== 'ready') {
    return NO_FIRE
  }

  const kind = player.currentWeapon
  const def = WEAPONS[kind]

  const ammoKind = def.ammo
  if (ammoKind !== null) {
    const current = player.ammo[ammoKind] ?? 0
    if (current <= 0) {
      setMessage(player, 'OUT OF AMMO')
      return NO_FIRE
    }
    player.ammo[ammoKind] = current - 1
  }

  player.weaponState = 'firing'
  player.weaponTimer = 0
  player.weaponFrame = 0

  let hitAny = false
  for (let i = 0; i < def.pellets; i++) {
    const spread = def.spread > 0 ? randRange(rng, -def.spread, def.spread) : 0
    const result = hitscan(scene, enemies, player.pos, player.angle + spread, def.range)
    if (result.hitEnemy) {
      const enemy = enemies[result.enemyIndex]
      if (enemy !== undefined) {
        damageEnemy(enemy, def.damage, rng)
        hitAny = true
      }
    }
  }

  return { fired: true, soundKind: kind, hitEnemy: hitAny }
}
