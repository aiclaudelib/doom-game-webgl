// World pickup factory and the apply-on-touch effect resolver.
// EXACT canonical sums / caps / refuse rules from doomBehaviorSpec.md §3.4.

import { MAX_HEALTH } from '~/doom/config'
import type {
  AmmoKind,
  KeyKind,
  Pickup,
  PickupKind,
  Player,
  PowerupKind,
  WeaponKind,
} from '~/doom/types'
import {
  addArmorBonus,
  addHealth,
  giveArmorTyped,
  giveAmmo,
  giveBackpack,
  giveBerserk,
  giveKey,
  giveWeapon,
  startPowerup,
} from '~/doom/game/player'
import { maybeAutoSwitch } from '~/doom/game/weapon'

/** Overheal / over-armor ceiling for bonuses & spheres (hardcoded 200 in Doom). */
const OVERHEAL_MAX = 200
const GREEN_ARMOR = 100
const BLUE_ARMOR = 200

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

const REFUSED: PickupResult = { taken: false, message: '' }

// ── Data tables (DRY — one builder per family, no copied blocks) ───────────────

interface AmmoPickupConfig {
  readonly ammo: AmmoKind
  readonly amount: number
  readonly message: string
}

type AmmoPickupKind =
  | 'bullets'
  | 'clipDropped'
  | 'bulletBox'
  | 'shells'
  | 'shellBox'
  | 'rockets'
  | 'rocketBox'
  | 'cells'
  | 'cellPack'

/** Ammo pickups: §3.4 sums. Clip +10, box +50; shells +4, box +20; rockets +1/+5; cells +20/+100. */
const AMMO_PICKUPS: Readonly<Record<AmmoPickupKind, AmmoPickupConfig>> = {
  bullets: { ammo: 'bullets', amount: 10, message: 'PICKED UP A CLIP' },
  // Dropped clip = half a clip (5 bullets) — the canonical dropped-ammo halving (§3.4).
  clipDropped: { ammo: 'bullets', amount: 5, message: 'PICKED UP A CLIP' },
  bulletBox: { ammo: 'bullets', amount: 50, message: 'PICKED UP A BOX OF BULLETS' },
  shells: { ammo: 'shells', amount: 4, message: 'PICKED UP SHOTGUN SHELLS' },
  shellBox: { ammo: 'shells', amount: 20, message: 'PICKED UP A BOX OF SHELLS' },
  rockets: { ammo: 'rockets', amount: 1, message: 'PICKED UP A ROCKET' },
  rocketBox: { ammo: 'rockets', amount: 5, message: 'PICKED UP A BOX OF ROCKETS' },
  cells: { ammo: 'cells', amount: 20, message: 'PICKED UP AN ENERGY CELL' },
  cellPack: { ammo: 'cells', amount: 100, message: 'PICKED UP AN ENERGY CELL PACK' },
}

interface WeaponPickupConfig {
  readonly weapon: WeaponKind
  /** Bundled ammo granted on pickup (canonical amount), or null for melee. */
  readonly ammo: AmmoKind | null
  readonly amount: number
  readonly label: string
}

type WeaponPickupKind =
  | 'shotgun'
  | 'chaingun'
  | 'superShotgun'
  | 'rocketLauncher'
  | 'plasmaGun'
  | 'bfg'
  | 'chainsaw'

/** Weapon pickups → WeaponKind + bundled ammo (rocketLauncher→'rocket', plasmaGun→'plasma'). */
const WEAPON_PICKUPS: Readonly<Record<WeaponPickupKind, WeaponPickupConfig>> = {
  shotgun: { weapon: 'shotgun', ammo: 'shells', amount: 8, label: 'SHOTGUN' },
  chaingun: { weapon: 'chaingun', ammo: 'bullets', amount: 10, label: 'CHAINGUN' },
  superShotgun: { weapon: 'superShotgun', ammo: 'shells', amount: 8, label: 'SUPER SHOTGUN' },
  rocketLauncher: { weapon: 'rocket', ammo: 'rockets', amount: 2, label: 'ROCKET LAUNCHER' },
  plasmaGun: { weapon: 'plasma', ammo: 'cells', amount: 40, label: 'PLASMA RIFLE' },
  bfg: { weapon: 'bfg', ammo: 'cells', amount: 40, label: 'BFG9000' },
  chainsaw: { weapon: 'chainsaw', ammo: null, amount: 0, label: 'CHAINSAW' },
}

/** Key pickups (cards + skull keys share locks) → KeyKind. */
const KEY_PICKUPS: Readonly<Record<string, KeyKind>> = {
  keyRed: 'red',
  keyBlue: 'blue',
  keyYellow: 'yellow',
  keySkullRed: 'red',
  keySkullBlue: 'blue',
  keySkullYellow: 'yellow',
}

const KEY_LABELS: Readonly<Record<KeyKind, string>> = {
  red: 'RED',
  blue: 'BLUE',
  yellow: 'YELLOW',
}

interface PowerupTimedConfig {
  readonly which: PowerupKind
  readonly seconds: number
  readonly message: string
}

/** Timed powerups (PINV/SUIT/PVIS/PINS) → kind + duration (§3.4). */
const POWERUP_PICKUPS: Readonly<Record<PowerupKind, PowerupTimedConfig>> = {
  invuln: { which: 'invuln', seconds: 30, message: 'INVULNERABILITY!' },
  radsuit: { which: 'radsuit', seconds: 60, message: 'RADIATION SHIELDING SUIT' },
  lightAmp: { which: 'lightAmp', seconds: 120, message: 'LIGHT AMPLIFICATION VISOR' },
  blur: { which: 'blur', seconds: 60, message: 'PARTIAL INVISIBILITY' },
}

// ── Family appliers ───────────────────────────────────────────────────────────

/** Capped health top-up that refuses at/above `cap` (stimpack/medikit). */
function applyHealthCapped(
  player: Player,
  amount: number,
  cap: number,
  label: string,
): PickupResult {
  if (player.health >= cap) {
    return REFUSED
  }
  addHealth(player, amount, cap)
  player.pickupFlash = 1
  return { taken: true, message: label }
}

/** Overheal-ceiling health (health bonus +1, soulsphere +100) — always taken below 200. */
function applyOverhealHealth(player: Player, amount: number, label: string): PickupResult {
  if (player.health >= OVERHEAL_MAX) {
    return REFUSED
  }
  addHealth(player, amount, OVERHEAL_MAX)
  player.pickupFlash = 1
  return { taken: true, message: label }
}

function applyAmmoPickup(player: Player, config: AmmoPickupConfig): PickupResult {
  const current = player.ammo[config.ammo] ?? 0
  const cap = player.maxAmmo[config.ammo] ?? 0
  if (current >= cap) {
    return REFUSED
  }
  giveAmmo(player, config.ammo, config.amount)
  player.pickupFlash = 1
  return { taken: true, message: config.message }
}

function applyWeaponPickup(player: Player, config: WeaponPickupConfig): PickupResult {
  const newlyOwned = giveWeapon(player, config.weapon)
  if (newlyOwned) {
    // Auto-switch to a freshly-picked weapon when it ranks at least as high as the current.
    maybeAutoSwitch(player, config.weapon)
  }
  // Melee weapons (chainsaw) carry no ammo — taken iff newly owned.
  const ammoKind = config.ammo
  if (ammoKind === null) {
    return newlyOwned ? { taken: true, message: `PICKED UP A ${config.label}` } : REFUSED
  }
  // The bundled ammo can still be claimed when the weapon is already owned, but only
  // while there's room — otherwise the pickup would be consumed for nothing.
  const current = player.ammo[ammoKind] ?? 0
  const cap = player.maxAmmo[ammoKind] ?? 0
  const ammoRoom = current < cap
  if (!newlyOwned && !ammoRoom) {
    return REFUSED
  }
  if (ammoRoom) {
    giveAmmo(player, ammoKind, config.amount)
  }
  return { taken: true, message: `PICKED UP A ${config.label}` }
}

function applyKeyPickup(player: Player, key: KeyKind): PickupResult {
  if (player.keys[key]) {
    return REFUSED
  }
  giveKey(player, key)
  return { taken: true, message: `PICKED UP THE ${KEY_LABELS[key]} KEY` }
}

function applyTimedPowerup(player: Player, config: PowerupTimedConfig): PickupResult {
  startPowerup(player, config.which, config.seconds)
  return { taken: true, message: config.message }
}

/** Set-armor pickups (green ARM1 set 100, blue ARM2 set 200) refusing at/above their cap. */
function applySetArmor(
  player: Player,
  type: 'green' | 'blue',
  points: number,
  label: string,
): PickupResult {
  if (!giveArmorTyped(player, type, points)) {
    return REFUSED
  }
  player.pickupFlash = 1
  return { taken: true, message: label }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/** Apply a pickup's effect; taken=false (left in the world) when the player gains nothing useful. */
export function applyPickup(player: Player, kind: PickupKind): PickupResult {
  switch (kind) {
    // Health.
    case 'health':
      return applyHealthCapped(player, 10, MAX_HEALTH, 'PICKED UP A STIMPACK')
    case 'medkit':
      return applyHealthCapped(player, 25, MAX_HEALTH, 'PICKED UP A MEDIKIT')
    case 'healthBonus':
      return applyOverhealHealth(player, 1, 'PICKED UP A HEALTH BONUS')
    case 'soulsphere':
      return applyOverhealHealth(player, 100, 'SUPERCHARGE!')
    case 'megasphere': {
      // SETS health=200 + blue armor 200, always taken.
      player.health = OVERHEAL_MAX
      giveArmorTyped(player, 'blue', BLUE_ARMOR)
      player.armor = BLUE_ARMOR
      player.armorType = 'blue'
      player.pickupFlash = 1
      return { taken: true, message: 'MEGASPHERE!' }
    }
    // Armor.
    case 'armor':
    case 'greenArmor':
      return applySetArmor(player, 'green', GREEN_ARMOR, 'PICKED UP THE ARMOR')
    case 'blueArmor':
      return applySetArmor(player, 'blue', BLUE_ARMOR, 'PICKED UP THE MEGAARMOR')
    case 'armorBonus':
      return addArmorBonus(player) ? { taken: true, message: 'PICKED UP AN ARMOR BONUS' } : REFUSED
    // Powerups.
    case 'berserk':
      giveBerserk(player)
      return { taken: true, message: 'BERSERK!' }
    case 'invuln':
      return applyTimedPowerup(player, POWERUP_PICKUPS.invuln)
    case 'radsuit':
      return applyTimedPowerup(player, POWERUP_PICKUPS.radsuit)
    case 'lightAmp':
      return applyTimedPowerup(player, POWERUP_PICKUPS.lightAmp)
    case 'blur':
      return applyTimedPowerup(player, POWERUP_PICKUPS.blur)
    case 'allMap':
      if (player.allMapRevealed) {
        return REFUSED
      }
      player.allMapRevealed = true
      player.pickupFlash = 1
      return { taken: true, message: 'COMPUTER AREA MAP' }
    case 'backpack':
      giveBackpack(player)
      return { taken: true, message: 'PICKED UP A BACKPACK FULL OF AMMO' }
    // Ammo.
    case 'bullets':
      return applyAmmoPickup(player, AMMO_PICKUPS.bullets)
    case 'clipDropped':
      return applyAmmoPickup(player, AMMO_PICKUPS.clipDropped)
    case 'bulletBox':
      return applyAmmoPickup(player, AMMO_PICKUPS.bulletBox)
    case 'shells':
      return applyAmmoPickup(player, AMMO_PICKUPS.shells)
    case 'shellBox':
      return applyAmmoPickup(player, AMMO_PICKUPS.shellBox)
    case 'rockets':
      return applyAmmoPickup(player, AMMO_PICKUPS.rockets)
    case 'rocketBox':
      return applyAmmoPickup(player, AMMO_PICKUPS.rocketBox)
    case 'cells':
      return applyAmmoPickup(player, AMMO_PICKUPS.cells)
    case 'cellPack':
      return applyAmmoPickup(player, AMMO_PICKUPS.cellPack)
    // Weapons.
    case 'shotgun':
      return applyWeaponPickup(player, WEAPON_PICKUPS.shotgun)
    case 'chaingun':
      return applyWeaponPickup(player, WEAPON_PICKUPS.chaingun)
    case 'superShotgun':
      return applyWeaponPickup(player, WEAPON_PICKUPS.superShotgun)
    case 'rocketLauncher':
      return applyWeaponPickup(player, WEAPON_PICKUPS.rocketLauncher)
    case 'plasmaGun':
      return applyWeaponPickup(player, WEAPON_PICKUPS.plasmaGun)
    case 'bfg':
      return applyWeaponPickup(player, WEAPON_PICKUPS.bfg)
    case 'chainsaw':
      return applyWeaponPickup(player, WEAPON_PICKUPS.chainsaw)
    // Keys (cards + skulls share locks).
    case 'keyRed':
    case 'keySkullRed':
      return applyKeyPickup(player, KEY_PICKUPS[kind] ?? 'red')
    case 'keyBlue':
    case 'keySkullBlue':
      return applyKeyPickup(player, KEY_PICKUPS[kind] ?? 'blue')
    case 'keyYellow':
    case 'keySkullYellow':
      return applyKeyPickup(player, KEY_PICKUPS[kind] ?? 'yellow')
    default:
      return REFUSED
  }
}
