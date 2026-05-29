// Bottom status bar, first-person weapon sprite and full-screen damage/pickup tints.
// Draws straight onto the framebuffer; reads Player/Assets/WorldStats but never game logic.

import {
  HUD_HEIGHT,
  MAX_ARMOR,
  MAX_HEALTH,
  RENDER_H,
  RENDER_W,
  VIEW_H,
  VIEW_W,
} from '~/doom/config'
import type {
  AmmoKind,
  Assets,
  Framebuffer,
  KeyKind,
  Player,
  Texture,
  WeaponKind,
} from '~/doom/types'
import type { Rgb } from '~/doom/core/color'
import { pal } from '~/doom/core/color'
import { blitTexture, drawText, drawTextCentered, fillRect } from '~/doom/engine/framebuffer'
import type { WorldStats } from '~/doom/ui/widgets'
import { drawBar, drawPanel } from '~/doom/ui/widgets'

const HUD_TOP = RENDER_H - HUD_HEIGHT

/** Display-only weapon→ammo mapping (the simulation owns the authoritative table). */
const WEAPON_AMMO: Readonly<Record<WeaponKind, AmmoKind | null>> = {
  fist: null,
  pistol: 'bullets',
  shotgun: 'shells',
  chaingun: 'bullets',
}

const WEAPON_LABEL: Readonly<Record<WeaponKind, string>> = {
  fist: 'FIST',
  pistol: 'PISTOL',
  shotgun: 'SHOTGUN',
  chaingun: 'CHAINGUN',
}

const KEY_ORDER: readonly KeyKind[] = ['red', 'blue', 'yellow']

const KEY_COLOR: Readonly<Record<KeyKind, Rgb>> = {
  red: pal('red'),
  blue: pal('blue'),
  yellow: pal('yellow'),
}

/** Draw a captioned value + gauge column (shared by HEALTH and ARMOR). */
function drawStat(
  fb: Framebuffer,
  label: string,
  value: number,
  frac: number,
  x: number,
  fg: Rgb,
): void {
  const y = HUD_TOP + 6
  drawText(fb, label, x, y, pal('lightGray'))
  drawText(fb, `${Math.max(0, Math.round(value))}`, x, y + 9, pal('white'))
  drawBar(fb, x, y + 20, 56, 8, frac, fg, pal('darkSteel'))
}

/** Bottom status bar: HEALTH, ARMOR, AMMO, owned keys, weapon name and transient message. */
export function renderHud(fb: Framebuffer, player: Player, stats: WorldStats): void {
  drawPanel(fb, 0, HUD_TOP, RENDER_W, HUD_HEIGHT)

  drawStat(fb, 'HEALTH', player.health, player.health / MAX_HEALTH, 6, pal('red'))
  drawStat(fb, 'ARMOR', player.armor, player.armor / MAX_ARMOR, 74, pal('cyan'))

  // Ammo for the current weapon ('--' for the ammo-free melee weapon).
  const ammoKind = WEAPON_AMMO[player.currentWeapon]
  const ammoX = 150
  drawText(fb, 'AMMO', ammoX, HUD_TOP + 6, pal('lightGray'))
  const ammoText = ammoKind === null ? '--' : `${player.ammo[ammoKind]}`
  drawText(fb, ammoText, ammoX, HUD_TOP + 15, pal('yellow'), 2)

  // Weapon name.
  drawText(fb, WEAPON_LABEL[player.currentWeapon], ammoX, HUD_TOP + 32, pal('white'))

  // Owned keys as coloured pips along the right edge.
  let pipX = RENDER_W - 12
  for (const key of KEY_ORDER) {
    if (player.keys[key]) {
      fillRect(fb, pipX, HUD_TOP + 6, 8, 12, KEY_COLOR[key])
      pipX -= 12
    }
  }

  // Level + kills readout above the keys.
  const infoX = RENDER_W - 80
  drawText(fb, stats.level, infoX, HUD_TOP + 22, pal('gray'))
  drawText(fb, `KILLS ${stats.kills}/${stats.totalEnemies}`, infoX, HUD_TOP + 31, pal('gray'))

  // Transient pickup/event message centred just above the bar.
  if (player.messageTimer > 0 && player.message.length > 0) {
    drawTextCentered(fb, player.message, RENDER_W / 2, HUD_TOP - 12, pal('white'))
  }
}

/** Pick the right weapon texture for the player's animation phase. */
function weaponTexture(player: Player, assets: Assets): Texture {
  const visual = assets.weapon[player.currentWeapon]
  if (player.weaponState === 'firing' && visual.fire.length > 0) {
    const frame = visual.fire[player.weaponFrame % visual.fire.length]
    return frame ?? visual.idle
  }
  return visual.idle
}

/** First-person weapon centred above the HUD with a subtle idle/walk bob. */
export function renderWeaponSprite(fb: Framebuffer, player: Player, assets: Assets): void {
  const tex = weaponTexture(player, assets)
  const scale = 2

  // Gentle horizontal/vertical bob driven by the weapon timer; firing nudges the gun
  // upward for a touch of recoil. Deterministic — no wall-clock source.
  const bobPhase = player.weaponTimer * 6
  const bobX = Math.round(Math.sin(bobPhase) * 2)
  const bobY = Math.round(Math.abs(Math.cos(bobPhase)) * 2)
  const recoil = player.weaponState === 'firing' ? -3 : 0

  const drawW = tex.width * scale
  const dx = Math.round((VIEW_W - drawW) / 2) + bobX
  const dy = VIEW_H - tex.height * scale + bobY + recoil

  blitTexture(fb, tex, dx, dy, scale)
}

/** Full-viewport translucent tints: red on damage, gold on pickup, scaled by player flashes. */
export function renderFlash(fb: Framebuffer, player: Player): void {
  if (player.damageFlash > 0) {
    const a = Math.round(Math.min(1, player.damageFlash) * 140)
    if (a > 0) {
      fillRect(fb, 0, 0, VIEW_W, VIEW_H, pal('red'), a)
    }
  }
  if (player.pickupFlash > 0) {
    const a = Math.round(Math.min(1, player.pickupFlash) * 90)
    if (a > 0) {
      fillRect(fb, 0, 0, VIEW_W, VIEW_H, pal('yellow'), a)
    }
  }
}
