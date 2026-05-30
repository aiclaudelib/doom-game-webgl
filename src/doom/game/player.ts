// Player factory, movement integration, and stat mutators.
// MUST NOT import game/weapon.ts — the slot→kind mapping lives in the caller.

import {
  MAX_HEALTH,
  MOVE_SPEED,
  PLAYER_RADIUS,
  RUN_MULTIPLIER,
  STRAFE_SPEED,
  TURN_SPEED,
} from '~/doom/config'
import { clamp, normalizeAngle } from '~/doom/core/math'
import { add, clone, fromAngle, rotate, scale } from '~/doom/core/vec'
import type {
  AmmoKind,
  ArmorType,
  InputFrame,
  KeyKind,
  Player,
  PowerupKind,
  SceneQuery,
  Settings,
  Vec2,
  WeaponKind,
} from '~/doom/types'
import { moveWithCollision } from '~/doom/game/collision'

const START_BULLETS = 50
const MAX_BULLETS = 200
const MAX_SHELLS = 50
const MAX_ROCKETS = 50
const MAX_CELLS = 300

/** Overheal / over-armor ceiling for bonuses & spheres (hardcoded 200 in Doom). */
const OVERHEAL_MAX = 200
/** Backpack first-pickup ammo clips: bullets/shells/cells/rockets (§3.4). */
const CLIP_BULLETS = 10
const CLIP_SHELLS = 4
const CLIP_CELLS = 20
const CLIP_ROCKETS = 1
/** Powerup durations in seconds (§3.4). */
const POWERUP_SECONDS: Readonly<Record<PowerupKind, number>> = {
  invuln: 30,
  radsuit: 60,
  lightAmp: 120,
  blur: 60,
}
/** Invulnerability blocks everything below this (telefrag still passes). */
const INVULN_THRESHOLD = 1000
/** Armor absorption denominator per tier: green 1/3, blue 1/2. */
const ARMOR_ABSORB: Readonly<Record<ArmorType, number>> = { none: 0, green: 3, blue: 2 }

/** Fresh player: fist + pistol owned, pistol selected, half a clip of bullets, full health. */
export function createPlayer(start: Vec2, angle: number): Player {
  return {
    pos: clone(start),
    angle: normalizeAngle(angle),
    health: MAX_HEALTH,
    armor: 0,
    armorType: 'none',
    ammo: { bullets: START_BULLETS, shells: 0, rockets: 0, cells: 0 },
    maxAmmo: { bullets: MAX_BULLETS, shells: MAX_SHELLS, rockets: MAX_ROCKETS, cells: MAX_CELLS },
    weapons: {
      fist: true,
      chainsaw: false,
      pistol: true,
      shotgun: false,
      superShotgun: false,
      chaingun: false,
      rocket: false,
      plasma: false,
      bfg: false,
    },
    keys: { red: false, blue: false, yellow: false },
    currentWeapon: 'pistol',
    pendingWeapon: null,
    berserk: false,
    invulnTimer: 0,
    radSuitTimer: 0,
    lightAmpTimer: 0,
    blurTimer: 0,
    allMapRevealed: false,
    hasBackpack: false,
    weaponState: 'ready',
    weaponTimer: 0,
    weaponFrame: 0,
    damageFlash: 0,
    pickupFlash: 0,
    message: '',
    messageTimer: 0,
  }
}

/** Apply held movement intent for one frame: turn, then collide-and-slide the desired delta. */
export function updatePlayerMovement(
  player: Player,
  scene: SceneQuery,
  input: InputFrame,
  settings: Settings,
  dt: number,
): void {
  const keyboardTurn = input.turnAxis * TURN_SPEED * dt
  const mouseTurn = settings.mouseLook ? input.mouseDX * settings.mouseSensitivity : 0
  player.angle = normalizeAngle(player.angle + keyboardTurn + mouseTurn)

  const runMul = input.run ? RUN_MULTIPLIER : 1
  const forwardAxis = clamp(input.moveForward, -1, 1)
  const strafeAxis = clamp(input.moveStrafe, -1, 1)

  const dir = fromAngle(player.angle)
  const right = rotate(dir, Math.PI / 2)

  const forwardDelta = scale(dir, forwardAxis * MOVE_SPEED * runMul * dt)
  const strafeDelta = scale(right, strafeAxis * STRAFE_SPEED * runMul * dt)
  const delta = add(forwardDelta, strafeDelta)

  const next = moveWithCollision(scene, player.pos, delta, PLAYER_RADIUS)
  player.pos = next
}

/**
 * Take damage. Invulnerability blocks anything below 1000 (telefrags still land).
 * Armor absorbs by tier — green 1/3, blue 1/2 (integer floor, never below 0); when
 * armor empties, the tier resets to 'none'. The remainder hits health (§3.4).
 */
export function damagePlayer(player: Player, amount: number): void {
  if (amount <= 0) {
    return
  }
  if (player.invulnTimer > 0 && amount < INVULN_THRESHOLD) {
    return
  }
  const denom = ARMOR_ABSORB[player.armorType]
  let absorbed = 0
  if (denom > 0 && player.armor > 0) {
    absorbed = Math.min(player.armor, Math.floor(amount / denom))
    player.armor = Math.max(0, player.armor - absorbed)
    if (player.armor === 0) {
      player.armorType = 'none'
    }
  }
  player.health = Math.max(0, player.health - (amount - absorbed))
  player.damageFlash = 1
}

export function addHealth(player: Player, amount: number, max: number): void {
  player.health = clamp(player.health + amount, 0, max)
}

/** Set armor to a tier's points if it would raise armor; refuse if already at/above cap. */
export function giveArmorTyped(player: Player, type: 'green' | 'blue', points: number): boolean {
  if (player.armor >= points) {
    return false
  }
  player.armor = points
  player.armorType = type
  return true
}

/**
 * Armor bonus (BON2): +1 up to the 200 ceiling; sets green tier only when currently
 * unarmored (never downgrades blue). Always counts as taken while below the ceiling.
 */
export function addArmorBonus(player: Player): boolean {
  if (player.armor >= OVERHEAL_MAX) {
    return false
  }
  player.armor = clamp(player.armor + 1, 0, OVERHEAL_MAX)
  if (player.armorType === 'none') {
    player.armorType = 'green'
  }
  return true
}

export function giveAmmo(player: Player, kind: AmmoKind, amount: number): void {
  const cap = player.maxAmmo[kind] ?? 0
  const current = player.ammo[kind] ?? 0
  player.ammo[kind] = clamp(current + amount, 0, cap)
}

/**
 * Backpack: the first one doubles every maxAmmo cap (→ 400/100/600/100) and grants
 * one clip of each (10/4/20/1); later backpacks only top up the clips. Always taken.
 */
export function giveBackpack(player: Player): void {
  if (!player.hasBackpack) {
    player.hasBackpack = true
    player.maxAmmo.bullets = MAX_BULLETS * 2
    player.maxAmmo.shells = MAX_SHELLS * 2
    player.maxAmmo.cells = MAX_CELLS * 2
    player.maxAmmo.rockets = MAX_ROCKETS * 2
  }
  giveAmmo(player, 'bullets', CLIP_BULLETS)
  giveAmmo(player, 'shells', CLIP_SHELLS)
  giveAmmo(player, 'cells', CLIP_CELLS)
  giveAmmo(player, 'rockets', CLIP_ROCKETS)
  player.pickupFlash = 1
}

/** Activate a timed powerup (re-pickup resets, never stacks) — duration from §3.4. */
export function startPowerup(player: Player, which: PowerupKind, seconds: number): void {
  const t = seconds > 0 ? seconds : POWERUP_SECONDS[which]
  if (which === 'invuln') {
    player.invulnTimer = t
  } else if (which === 'radsuit') {
    player.radSuitTimer = t
  } else if (which === 'lightAmp') {
    player.lightAmpTimer = t
  } else {
    player.blurTimer = t
  }
  player.pickupFlash = 1
}

/** Grant a weapon; returns true only when it was not already owned. Flashes on pickup. */
export function giveWeapon(player: Player, kind: WeaponKind): boolean {
  const newlyOwned = !player.weapons[kind]
  player.weapons[kind] = true
  if (newlyOwned) {
    player.pickupFlash = 1
  }
  return newlyOwned
}

export function giveKey(player: Player, key: KeyKind): void {
  player.keys[key] = true
  player.pickupFlash = 1
}

/** Begin a weapon switch when the requested weapon is owned and not already selected. */
export function requestWeapon(player: Player, kind: WeaponKind): void {
  const owned = player.weapons[kind] === true
  if (!owned || kind === player.currentWeapon) {
    return
  }
  player.pendingWeapon = kind
  player.weaponState = 'switching'
  player.weaponTimer = 0
}

/**
 * Berserk pack: heal to 100 (no overheal), latch the level-long ×10 fist flag, and
 * auto-switch to the fist (which must already be owned — it always is).
 */
export function giveBerserk(player: Player): void {
  if (player.health < MAX_HEALTH) {
    player.health = MAX_HEALTH
  }
  player.berserk = true
  player.pickupFlash = 1
  requestWeapon(player, 'fist')
}

export function setMessage(player: Player, text: string): void {
  player.message = text
  player.messageTimer = 3
}

/**
 * Decay the damage/pickup screen tints, the transient HUD message, and the timed
 * powerups (invuln/radsuit/lightAmp/blur). Berserk + allMap persist for the level.
 */
export function tickPlayerTimers(player: Player, dt: number): void {
  player.damageFlash = Math.max(0, player.damageFlash - dt * 2)
  player.pickupFlash = Math.max(0, player.pickupFlash - dt * 2)
  player.invulnTimer = Math.max(0, player.invulnTimer - dt)
  player.radSuitTimer = Math.max(0, player.radSuitTimer - dt)
  player.lightAmpTimer = Math.max(0, player.lightAmpTimer - dt)
  player.blurTimer = Math.max(0, player.blurTimer - dt)
  if (player.messageTimer > 0) {
    player.messageTimer = Math.max(0, player.messageTimer - dt)
    if (player.messageTimer === 0) {
      player.message = ''
    }
  }
}
