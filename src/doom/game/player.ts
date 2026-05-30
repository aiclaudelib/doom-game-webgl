// Player factory, movement integration, and stat mutators.
// MUST NOT import game/weapon.ts — the slot→kind mapping lives in the caller.

import {
  MAX_ARMOR,
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
  InputFrame,
  KeyKind,
  Player,
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

/** Fresh player: fist + pistol owned, pistol selected, half a clip of bullets, full health. */
export function createPlayer(start: Vec2, angle: number): Player {
  return {
    pos: clone(start),
    angle: normalizeAngle(angle),
    health: MAX_HEALTH,
    armor: 0,
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

/** Take damage: armor soaks one third (down to 0), the remainder hits health. */
export function damagePlayer(player: Player, amount: number): void {
  if (amount <= 0) {
    return
  }
  const absorbed = Math.min(player.armor, amount / 3)
  player.armor = Math.max(0, player.armor - absorbed)
  player.health = Math.max(0, player.health - (amount - absorbed))
  player.damageFlash = 1
}

export function addHealth(player: Player, amount: number, max: number): void {
  player.health = clamp(player.health + amount, 0, max)
}

export function addArmor(player: Player, amount: number): void {
  player.armor = clamp(player.armor + amount, 0, MAX_ARMOR)
}

export function giveAmmo(player: Player, kind: AmmoKind, amount: number): void {
  const cap = player.maxAmmo[kind] ?? 0
  const current = player.ammo[kind] ?? 0
  player.ammo[kind] = clamp(current + amount, 0, cap)
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

export function setMessage(player: Player, text: string): void {
  player.message = text
  player.messageTimer = 3
}

/** Decay the damage/pickup screen tints and the transient HUD message. */
export function tickPlayerTimers(player: Player, dt: number): void {
  player.damageFlash = Math.max(0, player.damageFlash - dt * 2)
  player.pickupFlash = Math.max(0, player.pickupFlash - dt * 2)
  if (player.messageTimer > 0) {
    player.messageTimer = Math.max(0, player.messageTimer - dt)
    if (player.messageTimer === 0) {
      player.message = ''
    }
  }
}
