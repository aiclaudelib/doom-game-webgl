// Per-weapon psprite state chains (35Hz), transcribed faithfully from linuxdoom-1.10
// info.c. Pure data — types only. The tic engine in game/weapon.ts walks these tables.
//
// Each state: { sprite, frame, tics, bright, action, next }. `next` indexes into the
// SAME chain's states[]. Heads up/down/ready are 1-tic self-loops broken by the engine
// via input / A_Raise / A_Lower (not by `next`). 0-tic states fall through the same tic.
// Frame letters: A=0 B=1 C=2 D=3 E=4 F=5 G=6 H=7 I=8 J=9.

import type { WeaponKind, WeaponStateChain } from '~/doom/types'

export const WEAPON_CHAINS: Readonly<Record<WeaponKind, WeaponStateChain>> = {
  // FIST (PUNG) — no flash layer.
  fist: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: -1,
    states: [
      { sprite: 'PUNG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'PUNG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'PUNG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'PUNG', frame: 1, tics: 4, bright: false, action: null, next: 4 },
      { sprite: 'PUNG', frame: 2, tics: 4, bright: false, action: 'punch', next: 5 },
      { sprite: 'PUNG', frame: 3, tics: 5, bright: false, action: null, next: 6 },
      { sprite: 'PUNG', frame: 2, tics: 4, bright: false, action: null, next: 7 },
      { sprite: 'PUNG', frame: 1, tics: 5, bright: false, action: 'reFire', next: 2 },
    ],
  },

  // CHAINSAW (SAWG) — no flash layer; ready oscillates C↔D.
  chainsaw: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 4,
    flash: -1,
    states: [
      { sprite: 'SAWG', frame: 2, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'SAWG', frame: 2, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'SAWG', frame: 2, tics: 4, bright: false, action: 'ready', next: 3 },
      { sprite: 'SAWG', frame: 3, tics: 4, bright: false, action: 'ready', next: 2 },
      { sprite: 'SAWG', frame: 0, tics: 4, bright: false, action: 'saw', next: 5 },
      { sprite: 'SAWG', frame: 1, tics: 4, bright: false, action: 'saw', next: 6 },
      { sprite: 'SAWG', frame: 1, tics: 0, bright: false, action: 'reFire', next: 2 },
    ],
  },

  // PISTOL (PISG / flash PISF) — flash head index 7.
  pistol: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 7,
    states: [
      { sprite: 'PISG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'PISG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'PISG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'PISG', frame: 0, tics: 4, bright: false, action: null, next: 4 },
      { sprite: 'PISG', frame: 1, tics: 6, bright: false, action: 'firePistol', next: 5 },
      { sprite: 'PISG', frame: 2, tics: 4, bright: false, action: null, next: 6 },
      { sprite: 'PISG', frame: 1, tics: 5, bright: false, action: 'reFire', next: 2 },
      { sprite: 'PISF', frame: 0, tics: 7, bright: true, action: 'light1', next: 8 },
      { sprite: 'PISF', frame: 0, tics: 0, bright: true, action: 'light0', next: 8 },
    ],
  },

  // SHOTGUN (SHTG / flash SHTF) — flash head index 12.
  shotgun: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 12,
    states: [
      { sprite: 'SHTG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'SHTG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'SHTG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'SHTG', frame: 0, tics: 3, bright: false, action: null, next: 4 },
      { sprite: 'SHTG', frame: 0, tics: 7, bright: false, action: 'fireShotgun', next: 5 },
      { sprite: 'SHTG', frame: 1, tics: 5, bright: false, action: null, next: 6 },
      { sprite: 'SHTG', frame: 2, tics: 5, bright: false, action: null, next: 7 },
      { sprite: 'SHTG', frame: 3, tics: 4, bright: false, action: null, next: 8 },
      { sprite: 'SHTG', frame: 2, tics: 5, bright: false, action: null, next: 9 },
      { sprite: 'SHTG', frame: 1, tics: 5, bright: false, action: null, next: 10 },
      { sprite: 'SHTG', frame: 0, tics: 3, bright: false, action: null, next: 11 },
      { sprite: 'SHTG', frame: 0, tics: 7, bright: false, action: 'reFire', next: 2 },
      { sprite: 'SHTF', frame: 0, tics: 4, bright: true, action: 'light1', next: 13 },
      { sprite: 'SHTF', frame: 1, tics: 3, bright: true, action: 'light2', next: 14 },
      { sprite: 'SHTF', frame: 0, tics: 0, bright: true, action: 'light0', next: 14 },
    ],
  },

  // SUPER SHOTGUN (SHT2 / flash SHT2 I,J) — flash head index 13.
  superShotgun: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 13,
    states: [
      { sprite: 'SHT2', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'SHT2', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'SHT2', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'SHT2', frame: 0, tics: 3, bright: false, action: null, next: 4 },
      { sprite: 'SHT2', frame: 0, tics: 7, bright: false, action: 'fireShotgun2', next: 5 },
      { sprite: 'SHT2', frame: 1, tics: 7, bright: false, action: null, next: 6 },
      { sprite: 'SHT2', frame: 2, tics: 7, bright: false, action: 'checkReload', next: 7 },
      { sprite: 'SHT2', frame: 3, tics: 7, bright: false, action: 'openShotgun2', next: 8 },
      { sprite: 'SHT2', frame: 4, tics: 7, bright: false, action: null, next: 9 },
      { sprite: 'SHT2', frame: 5, tics: 7, bright: false, action: 'loadShotgun2', next: 10 },
      { sprite: 'SHT2', frame: 6, tics: 6, bright: false, action: null, next: 11 },
      { sprite: 'SHT2', frame: 7, tics: 6, bright: false, action: 'closeShotgun2', next: 12 },
      { sprite: 'SHT2', frame: 0, tics: 5, bright: false, action: 'reFire', next: 2 },
      { sprite: 'SHT2', frame: 8, tics: 5, bright: true, action: 'light1', next: 14 },
      { sprite: 'SHT2', frame: 9, tics: 4, bright: true, action: 'light2', next: 15 },
      { sprite: 'SHT2', frame: 0, tics: 0, bright: true, action: 'light0', next: 15 },
    ],
  },

  // CHAINGUN (CHGG / flash CHGF) — flash heads 6 (CHGF A) and 7 (CHGF B).
  chaingun: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 6,
    states: [
      { sprite: 'CHGG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'CHGG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'CHGG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'CHGG', frame: 0, tics: 4, bright: false, action: 'fireCGun', next: 4 },
      { sprite: 'CHGG', frame: 1, tics: 4, bright: false, action: 'fireCGun', next: 5 },
      { sprite: 'CHGG', frame: 1, tics: 0, bright: false, action: 'reFire', next: 2 },
      { sprite: 'CHGF', frame: 0, tics: 5, bright: true, action: 'light1', next: 8 },
      { sprite: 'CHGF', frame: 1, tics: 5, bright: true, action: 'light2', next: 8 },
      { sprite: 'CHGF', frame: 0, tics: 0, bright: true, action: 'light0', next: 8 },
    ],
  },

  // ROCKET (MISG / flash MISF) — explicit gunFlash at atk, flash head 6.
  rocket: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 6,
    states: [
      { sprite: 'MISG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'MISG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'MISG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'MISG', frame: 1, tics: 8, bright: false, action: 'gunFlash', next: 4 },
      { sprite: 'MISG', frame: 1, tics: 12, bright: false, action: 'fireMissile', next: 5 },
      { sprite: 'MISG', frame: 1, tics: 0, bright: false, action: 'reFire', next: 2 },
      { sprite: 'MISF', frame: 0, tics: 3, bright: true, action: 'light1', next: 7 },
      { sprite: 'MISF', frame: 1, tics: 4, bright: true, action: null, next: 8 },
      { sprite: 'MISF', frame: 2, tics: 4, bright: true, action: 'light2', next: 9 },
      { sprite: 'MISF', frame: 3, tics: 4, bright: true, action: 'light2', next: 10 },
      { sprite: 'MISF', frame: 0, tics: 0, bright: true, action: 'light0', next: 10 },
    ],
  },

  // PLASMA (PLSG / flash PLSF) — flash heads 5 (PLSF A) and 6 (PLSF B).
  plasma: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 5,
    states: [
      { sprite: 'PLSG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'PLSG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'PLSG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'PLSG', frame: 0, tics: 3, bright: false, action: 'firePlasma', next: 4 },
      { sprite: 'PLSG', frame: 1, tics: 20, bright: false, action: 'reFire', next: 2 },
      { sprite: 'PLSF', frame: 0, tics: 4, bright: true, action: 'light1', next: 7 },
      { sprite: 'PLSF', frame: 1, tics: 4, bright: true, action: 'light1', next: 7 },
      { sprite: 'PLSF', frame: 0, tics: 0, bright: true, action: 'light0', next: 7 },
    ],
  },

  // BFG (BFGG / flash BFGF) — flash head 7.
  bfg: {
    up: 0,
    down: 1,
    ready: 2,
    atk: 3,
    flash: 7,
    states: [
      { sprite: 'BFGG', frame: 0, tics: 1, bright: false, action: 'raise', next: 0 },
      { sprite: 'BFGG', frame: 0, tics: 1, bright: false, action: 'lower', next: 1 },
      { sprite: 'BFGG', frame: 0, tics: 1, bright: false, action: 'ready', next: 2 },
      { sprite: 'BFGG', frame: 0, tics: 20, bright: false, action: 'bfgSound', next: 4 },
      { sprite: 'BFGG', frame: 1, tics: 10, bright: false, action: 'gunFlash', next: 5 },
      { sprite: 'BFGG', frame: 1, tics: 10, bright: false, action: 'fireBFG', next: 6 },
      { sprite: 'BFGG', frame: 1, tics: 20, bright: false, action: 'reFire', next: 2 },
      { sprite: 'BFGF', frame: 0, tics: 11, bright: true, action: 'light1', next: 8 },
      { sprite: 'BFGF', frame: 1, tics: 6, bright: true, action: 'light2', next: 9 },
      { sprite: 'BFGF', frame: 0, tics: 0, bright: true, action: 'light0', next: 9 },
    ],
  },
}
