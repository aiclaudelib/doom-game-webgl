// PickupKind → 4-letter Doom/Freedoom sprite prefix for the packed atlas. Pure data
// leaf (config/types layer): world.ts maps a pickup to atlas.actorFrame(prefix,'A',1)
// when the atlas is loaded, else falls back to the procedural Assets.pickup icon.

import type { PickupKind } from '~/doom/types'

/** Atlas sprite prefix per pickup kind (spritePlan.md §1 / doomBehaviorSpec.md §3.4). */
export const PICKUP_SPRITE: Readonly<Record<PickupKind, string>> = {
  // Existing kinds reinterpreted canonically.
  health: 'STIM',
  medkit: 'MEDI',
  armor: 'ARM1',
  bullets: 'CLIP',
  // Dropped half-clip reuses the CLIP atlas sprite (it is a clip, just worth 5 bullets).
  clipDropped: 'CLIP',
  shells: 'SHEL',
  shotgun: 'SHOT',
  chaingun: 'MGUN',
  keyRed: 'RKEY',
  keyBlue: 'BKEY',
  keyYellow: 'YKEY',
  // Health / armor.
  healthBonus: 'BON1',
  armorBonus: 'BON2',
  greenArmor: 'ARM1',
  blueArmor: 'ARM2',
  soulsphere: 'SOUL',
  megasphere: 'MEGA',
  // Powerups.
  berserk: 'PSTR',
  invuln: 'PINV',
  radsuit: 'SUIT',
  lightAmp: 'PVIS',
  allMap: 'PMAP',
  blur: 'PINS',
  backpack: 'BPAK',
  // Ammo.
  rockets: 'ROCK',
  rocketBox: 'BROK',
  cells: 'CELL',
  cellPack: 'CELP',
  bulletBox: 'AMMO',
  shellBox: 'SBOX',
  // Weapons.
  superShotgun: 'SGN2',
  rocketLauncher: 'LAUN',
  plasmaGun: 'PLAS',
  bfg: 'BFUG',
  chainsaw: 'CSAW',
  // Skull keys.
  keySkullRed: 'RSKU',
  keySkullBlue: 'BSKU',
  keySkullYellow: 'YSKU',
}
