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
import {
  blitTexture,
  blitTextureBright,
  drawText,
  drawTextCentered,
  fillRect,
} from '~/doom/engine/framebuffer'
import type { SpriteAtlas } from '~/doom/engine/sprites/spriteAtlas'
import { WEAPON_CHAINS } from '~/doom/game/weaponStates'
import { letterOf, viewmodelBob, viewmodelDrawPos } from '~/doom/ui/viewmodel'
import type { WorldStats } from '~/doom/ui/widgets'
import { drawBar, drawPanel } from '~/doom/ui/widgets'

const HUD_TOP = RENDER_H - HUD_HEIGHT

/** Display-only weapon→ammo mapping (the simulation owns the authoritative table). */
const WEAPON_AMMO: Readonly<Record<WeaponKind, AmmoKind | null>> = {
  fist: null,
  chainsaw: null,
  pistol: 'bullets',
  shotgun: 'shells',
  superShotgun: 'shells',
  chaingun: 'bullets',
  rocket: 'rockets',
  plasma: 'cells',
  bfg: 'cells',
}

const WEAPON_LABEL: Readonly<Record<WeaponKind, string>> = {
  fist: 'FIST',
  chainsaw: 'CHAINSAW',
  pistol: 'PISTOL',
  shotgun: 'SHOTGUN',
  superShotgun: 'SUPER SHOTGUN',
  chaingun: 'CHAINGUN',
  rocket: 'ROCKET LAUNCHER',
  plasma: 'PLASMA RIFLE',
  bfg: 'BFG9000',
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

  renderPowerups(fb, player)
}

/** Active timed powerups: short label + remaining seconds, in the top-left corner. */
interface PowerupReadout {
  readonly label: string
  readonly timer: number
  readonly color: Rgb
}

function powerupReadouts(player: Player): readonly PowerupReadout[] {
  return [
    { label: 'INVL', timer: player.invulnTimer, color: pal('white') },
    { label: 'SUIT', timer: player.radSuitTimer, color: pal('green') },
    { label: 'LITE', timer: player.lightAmpTimer, color: pal('yellow') },
    { label: 'BLUR', timer: player.blurTimer, color: pal('cyan') },
  ]
}

function renderPowerups(fb: Framebuffer, player: Player): void {
  let y = 4
  for (const p of powerupReadouts(player)) {
    if (p.timer <= 0) {
      continue
    }
    drawText(fb, `${p.label} ${Math.ceil(p.timer)}`, 4, y, p.color)
    y += 9
  }
  // Berserk persists for the level — a steady pip rather than a countdown.
  if (player.berserk === true) {
    drawText(fb, 'BERSERK', 4, y, pal('red'))
  }
}

/** Pick the procedural-fallback weapon texture for the player's animation phase. */
function weaponTexture(player: Player, assets: Assets): Texture {
  const visual = assets.weapon[player.currentWeapon]
  if (player.weaponState === 'firing' && visual.fire.length > 0) {
    // Headless/no-atlas fallback only: indexing the raw sprite-letter (weaponFrame) % fire.length
    // is an INCIDENTAL mapping — it just needs to flip between the procedural fire frames while
    // firing. The atlas path (renderWeaponSprite) is the real animation; this never ships.
    const frame = visual.fire[player.weaponFrame % visual.fire.length]
    return frame ?? visual.idle
  }
  return visual.idle
}

/** Headless / no-atlas path: the legacy procedural viewmodel, centred above the HUD. */
function renderProceduralWeapon(fb: Framebuffer, player: Player, assets: Assets): void {
  const tex = weaponTexture(player, assets)
  const scale = 2
  const bob = viewmodelBob(player.weaponState, player.bob, player.bobPhase)
  const recoil = player.weaponState === 'firing' ? -3 : 0

  const drawW = tex.width * scale
  const dx = Math.round((VIEW_W - drawW) / 2) + Math.round(bob.x)
  const dy = VIEW_H - tex.height * scale + Math.round(bob.y) + recoil

  blitTexture(fb, tex, dx, dy, scale)
}

/**
 * Atlas-backed first-person viewmodel: resolve the current gun-layer frame from the active
 * weapon's psprite chain, blit it via the §B3 full-screen-relative-offset convention, then
 * overlay the bright muzzle-flash frame at the SAME anchor (bob/slide) so it stays glued to
 * the barrel. Falls back to the procedural look when no atlas is loaded (jsdom/headless).
 */
export function renderWeaponSprite(
  fb: Framebuffer,
  player: Player,
  assets: Assets,
  atlas: SpriteAtlas | null,
): void {
  if (atlas === null) {
    renderProceduralWeapon(fb, player, assets)
    return
  }

  const chain = WEAPON_CHAINS[player.currentWeapon]
  const bob = viewmodelBob(player.weaponState, player.bob, player.bobPhase)

  const gun = chain.states[player.pspIndex]
  if (gun !== undefined) {
    const ref = atlas.actorFrame(gun.sprite, letterOf(gun.frame), 1)
    if (ref !== null) {
      const { x, y } = viewmodelDrawPos(ref, bob.x, bob.y, player.pspSy)
      blitTexture(fb, ref.tex, x, y, 1)
    }
  }

  if (player.flashIndex !== -1) {
    const flash = chain.states[player.flashIndex]
    if (flash !== undefined) {
      const fref = atlas.actorFrame(flash.sprite, letterOf(flash.frame), 1)
      if (fref !== null) {
        // Same anchor as the gun (bob + pspSy) — the flash rides the barrel.
        const { x, y } = viewmodelDrawPos(fref, bob.x, bob.y, player.pspSy)
        blitTextureBright(fb, fref.tex, x, y, 1)
      }
    }
  }
}

/** Per muzzle-flash light level (player.extralight 0/1/2), a subtle additive white tint over
 *  the viewport — Doom's `extralight` screen brighten while a shot's flash plays. Kept low so
 *  it never washes out the frame or blanks the canvas. */
const EXTRALIGHT_ALPHA: readonly number[] = [0, 10, 20]

/** Full-viewport translucent tints: red on damage, gold on pickup, scaled by player flashes.
 *  Invulnerability adds a steady pale tint (a stand-in for Doom's inverse palette) while active. */
export function renderFlash(fb: Framebuffer, player: Player): void {
  // Muzzle-flash screen light: a faint additive brighten while extralight>0 (driven by the
  // weapon's flash-layer light1/light2 actions). Composited UNDER the damage/pickup tints.
  const extraAlpha = EXTRALIGHT_ALPHA[Math.min(2, Math.max(0, player.extralight))] ?? 0
  if (extraAlpha > 0) {
    fillRect(fb, 0, 0, VIEW_W, VIEW_H, pal('white'), extraAlpha)
  }
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
  if (player.invulnTimer > 0) {
    // Blink toward the end (under ~3 s remaining) like Doom's expiring invuln.
    const blink = player.invulnTimer < 3 && Math.floor(player.invulnTimer * 6) % 2 === 0
    if (!blink) {
      fillRect(fb, 0, 0, VIEW_W, VIEW_H, pal('white'), 50)
    }
  }
}
