// World pickup factory and the apply-on-touch effect resolver.

import { MAX_ARMOR, MAX_HEALTH } from '~/doom/config'
import type { AmmoKind, KeyKind, Pickup, PickupKind, Player, WeaponKind } from '~/doom/types'
import { addArmor, addHealth, giveAmmo, giveKey, giveWeapon } from '~/doom/game/player'

const HEALTH_BONUS = 10
const MEDKIT_BONUS = 25
const ARMOR_BONUS = 25
const BULLET_CLIP = 20
const SHELL_BOX = 8
const WEAPON_AMMO = 8

export function spawnPickup(kind: PickupKind, x: number, y: number): Pickup {
  return {
    kind,
    pos: { x, y },
    active: true,
  }
}

export interface PickupResult {
  readonly taken: boolean
  readonly message: string
}

interface AmmoPickupConfig {
  readonly ammo: AmmoKind
  readonly amount: number
  readonly message: string
}

const AMMO_PICKUPS: Readonly<Record<'bullets' | 'shells', AmmoPickupConfig>> = {
  bullets: { ammo: 'bullets', amount: BULLET_CLIP, message: 'PICKED UP A CLIP' },
  shells: { ammo: 'shells', amount: SHELL_BOX, message: 'PICKED UP SHOTGUN SHELLS' },
}

interface WeaponPickupConfig {
  readonly weapon: WeaponKind
  readonly ammo: AmmoKind
  readonly label: string
}

const WEAPON_PICKUPS: Readonly<Record<'shotgun' | 'chaingun', WeaponPickupConfig>> = {
  shotgun: { weapon: 'shotgun', ammo: 'shells', label: 'SHOTGUN' },
  chaingun: { weapon: 'chaingun', ammo: 'bullets', label: 'CHAINGUN' },
}

const KEY_PICKUPS: Readonly<Record<'keyRed' | 'keyBlue' | 'keyYellow', KeyKind>> = {
  keyRed: 'red',
  keyBlue: 'blue',
  keyYellow: 'yellow',
}

const KEY_LABELS: Readonly<Record<KeyKind, string>> = {
  red: 'RED',
  blue: 'BLUE',
  yellow: 'YELLOW',
}

function applyHealth(player: Player, amount: number, label: string): PickupResult {
  if (player.health >= MAX_HEALTH) {
    return { taken: false, message: '' }
  }
  addHealth(player, amount, MAX_HEALTH)
  player.pickupFlash = 1
  return { taken: true, message: label }
}

function applyAmmoPickup(player: Player, config: AmmoPickupConfig): PickupResult {
  const current = player.ammo[config.ammo] ?? 0
  const cap = player.maxAmmo[config.ammo] ?? 0
  if (current >= cap) {
    return { taken: false, message: '' }
  }
  giveAmmo(player, config.ammo, config.amount)
  player.pickupFlash = 1
  return { taken: true, message: config.message }
}

function applyWeaponPickup(player: Player, config: WeaponPickupConfig): PickupResult {
  const newlyOwned = giveWeapon(player, config.weapon)
  // The bundled ammo can still be claimed when the weapon is already owned, but
  // only while there's room — otherwise the pickup would be consumed for nothing.
  const current = player.ammo[config.ammo] ?? 0
  const cap = player.maxAmmo[config.ammo] ?? 0
  const ammoRoom = current < cap
  if (!newlyOwned && !ammoRoom) {
    return { taken: false, message: '' }
  }
  // Grant the ammo exactly once, only when we actually consume the pickup.
  if (ammoRoom) {
    giveAmmo(player, config.ammo, WEAPON_AMMO)
  }
  return { taken: true, message: `PICKED UP A ${config.label}` }
}

function applyKeyPickup(player: Player, key: KeyKind): PickupResult {
  if (player.keys[key]) {
    return { taken: false, message: '' }
  }
  giveKey(player, key)
  return { taken: true, message: `PICKED UP THE ${KEY_LABELS[key]} KEY` }
}

/** Apply a pickup's effect; taken=false (left in the world) when the player gains nothing useful. */
export function applyPickup(player: Player, kind: PickupKind): PickupResult {
  switch (kind) {
    case 'health':
      return applyHealth(player, HEALTH_BONUS, 'PICKED UP A STIMPACK')
    case 'medkit':
      return applyHealth(player, MEDKIT_BONUS, 'PICKED UP A MEDIKIT')
    case 'armor': {
      if (player.armor >= MAX_ARMOR) {
        return { taken: false, message: '' }
      }
      addArmor(player, ARMOR_BONUS)
      player.pickupFlash = 1
      return { taken: true, message: 'PICKED UP ARMOR' }
    }
    case 'bullets':
      return applyAmmoPickup(player, AMMO_PICKUPS.bullets)
    case 'shells':
      return applyAmmoPickup(player, AMMO_PICKUPS.shells)
    case 'shotgun':
      return applyWeaponPickup(player, WEAPON_PICKUPS.shotgun)
    case 'chaingun':
      return applyWeaponPickup(player, WEAPON_PICKUPS.chaingun)
    case 'keyRed':
      return applyKeyPickup(player, KEY_PICKUPS.keyRed)
    case 'keyBlue':
      return applyKeyPickup(player, KEY_PICKUPS.keyBlue)
    case 'keyYellow':
      return applyKeyPickup(player, KEY_PICKUPS.keyYellow)
    default:
      return { taken: false, message: '' }
  }
}
