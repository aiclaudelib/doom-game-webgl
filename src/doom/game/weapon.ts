// Weapon tuning table + the 35Hz psprite tic engine. Firing happens INSIDE the tic
// engine (faithful Doom P_SetPsprite: actions run ON ENTRY). The fire* actions branch
// on def.fireMode:
//  - melee   : a single hitscan at MELEE_RANGE, dice 2..20 (×10 fist berserk).
//  - hitscan : def.pellets rays with faithful triangular (P_Random−P_Random) spread
//              (SSG also perturbs the bullet slope per pellet); damage applied here.
//  - projectile (rocket/plasma/bfg): spawn a player projectile; world.ts resolves
//              its impact + splash/spray (keeps the projectile->enemy edge out).

import { MELEE_RANGE } from '~/doom/config'
import {
  SECONDS_PER_TIC,
  type Enemy,
  type Player,
  type Projectile,
  type PspAction,
  type Rng,
  type SceneQuery,
  type Vec2,
  type WeaponDef,
  type WeaponKind,
} from '~/doom/types'
import { fromAngle, normalize, sub } from '~/doom/core/vec'
import { hitscan } from '~/doom/game/combat'
import { damageEnemy } from '~/doom/game/enemy'
import { requestWeapon, setMessage } from '~/doom/game/player'
import { PROJECTILE_DEFS, spawnProjectile } from '~/doom/game/projectile'
import { WEAPON_CHAINS } from '~/doom/game/weaponStates'

/** Full-level hitscan reach (MISSILERANGE 2048u ≈ 32 cells). */
const GUN_RANGE = 32

/**
 * Sides on the projectile damage die (canon `(P_Random%8)+1`). The direct-hit damage for
 * EVERY projectile weapon is single-sourced from `PROJECTILE_DEFS[kind].base * (1..8)` here —
 * the rocket/plasma/bfg `WeaponDef.damage` fields are an engine-unused placeholder (kept only
 * to satisfy the flat WeaponDef shape; the projectile path never reads them).
 */
const PROJECTILE_DAMAGE_SIDES = 8

/** Weapon-slide bounds in view units; A_Raise / A_Lower move 6 units/tic. */
const WEAPONTOP = 32
const WEAPONBOTTOM = 128
const RAISE_LOWER_SPEED = 6

export const WEAPONS: Readonly<Record<WeaponKind, WeaponDef>> = {
  fist: {
    kind: 'fist',
    slot: 1,
    ammo: null,
    ammoPerShot: 0,
    fireMode: 'melee',
    pellets: 1,
    automatic: false,
    damage: { sides: 10, mul: 2, berserkBoost: true },
    spread: { horizontal: 0.098 },
    range: MELEE_RANGE,
    chain: WEAPON_CHAINS.fist,
    autoSwitchRank: 1,
  },
  chainsaw: {
    kind: 'chainsaw',
    slot: 1,
    ammo: null,
    ammoPerShot: 0,
    fireMode: 'melee',
    pellets: 1,
    automatic: true,
    damage: { sides: 10, mul: 2 },
    spread: { horizontal: 0.098 },
    range: MELEE_RANGE,
    meleePull: true,
    chain: WEAPON_CHAINS.chainsaw,
    autoSwitchRank: 3,
  },
  pistol: {
    kind: 'pistol',
    slot: 2,
    ammo: 'bullets',
    ammoPerShot: 1,
    fireMode: 'hitscan',
    pellets: 1,
    automatic: false,
    damage: { sides: 3, mul: 5 },
    spread: { horizontal: 0.098 },
    range: GUN_RANGE,
    spreadShift: 18,
    firstShotAccurate: true,
    chain: WEAPON_CHAINS.pistol,
    autoSwitchRank: 2,
  },
  shotgun: {
    kind: 'shotgun',
    slot: 3,
    ammo: 'shells',
    ammoPerShot: 1,
    fireMode: 'hitscan',
    pellets: 7,
    automatic: false,
    damage: { sides: 3, mul: 5 },
    spread: { horizontal: 0.087 },
    range: GUN_RANGE,
    spreadShift: 18,
    chain: WEAPON_CHAINS.shotgun,
    autoSwitchRank: 4,
  },
  superShotgun: {
    kind: 'superShotgun',
    slot: 3,
    ammo: 'shells',
    ammoPerShot: 2,
    fireMode: 'hitscan',
    pellets: 20,
    automatic: false,
    damage: { sides: 3, mul: 5 },
    spread: { horizontal: 0.196, vertical: 0 },
    range: GUN_RANGE,
    spreadShift: 19,
    verticalSlopeShift: 5,
    chain: WEAPON_CHAINS.superShotgun,
    autoSwitchRank: 5,
  },
  chaingun: {
    kind: 'chaingun',
    slot: 4,
    ammo: 'bullets',
    ammoPerShot: 1,
    fireMode: 'hitscan',
    pellets: 1,
    automatic: true,
    damage: { sides: 3, mul: 5 },
    spread: { horizontal: 0.098 },
    range: GUN_RANGE,
    spreadShift: 18,
    firstShotAccurate: true,
    chain: WEAPON_CHAINS.chaingun,
    autoSwitchRank: 6,
  },
  rocket: {
    kind: 'rocket',
    slot: 5,
    ammo: 'rockets',
    ammoPerShot: 1,
    fireMode: 'projectile',
    pellets: 1,
    automatic: false,
    damage: { sides: 8, mul: 20 },
    spread: { horizontal: 0 },
    range: GUN_RANGE,
    projectileKind: 'rocket',
    chain: WEAPON_CHAINS.rocket,
    autoSwitchRank: 7,
  },
  plasma: {
    kind: 'plasma',
    slot: 6,
    ammo: 'cells',
    ammoPerShot: 1,
    fireMode: 'projectile',
    pellets: 1,
    automatic: true,
    damage: { sides: 8, mul: 5 },
    spread: { horizontal: 0 },
    range: GUN_RANGE,
    projectileKind: 'plasma',
    chain: WEAPON_CHAINS.plasma,
    autoSwitchRank: 8,
  },
  bfg: {
    kind: 'bfg',
    slot: 7,
    ammo: 'cells',
    ammoPerShot: 40,
    fireMode: 'projectile',
    pellets: 1,
    automatic: false,
    damage: { sides: 8, mul: 100 },
    spread: { horizontal: 0 },
    range: GUN_RANGE,
    projectileKind: 'bfg',
    chain: WEAPON_CHAINS.bfg,
    autoSwitchRank: 9,
  },
}

export function weaponDef(kind: WeaponKind): WeaponDef {
  return WEAPONS[kind]
}

/** Weapon kinds in slot-ascending selection order (next/prev cycling). */
export const WEAPON_SELECT_ORDER: readonly WeaponKind[] = [
  'fist',
  'chainsaw',
  'pistol',
  'shotgun',
  'superShotgun',
  'chaingun',
  'rocket',
  'plasma',
  'bfg',
]

/** Selection-key slot → candidate kinds, weakest first (last = "best" variant). */
export const SLOT_CANDIDATES: Readonly<Record<number, readonly WeaponKind[]>> = {
  1: ['fist', 'chainsaw'],
  2: ['pistol'],
  3: ['shotgun', 'superShotgun'],
  4: ['chaingun'],
  5: ['rocket'],
  6: ['plasma'],
  7: ['bfg'],
}

/**
 * Map a 1..7 selection key to a weapon kind. Already in this slot → cycle to the next
 * owned variant (intra-slot toggle). Otherwise jump to the BEST owned variant (last in
 * the candidate list); if nothing in the slot is owned yet, fall back to the slot's base
 * weapon (first candidate) so the default loadout still maps 3→shotgun etc. — requestWeapon
 * rejects an unowned kind. Null only for an out-of-range slot.
 */
export function weaponBySlot(slot: number, player: Player): WeaponKind | null {
  const candidates = SLOT_CANDIDATES[slot]
  if (candidates === undefined || candidates.length === 0) {
    return null
  }
  const owned = candidates.filter(k => player.weapons[k] === true)
  if (owned.length === 0) {
    return candidates[0] ?? null
  }
  const i = owned.indexOf(player.currentWeapon)
  return i >= 0 ? (owned[(i + 1) % owned.length] ?? null) : (owned[owned.length - 1] ?? null)
}

/** Next/previous owned weapon in slot-ascending order, wrapping. */
export function nextOwnedWeapon(player: Player, dir: 1 | -1): WeaponKind {
  const order = WEAPON_SELECT_ORDER.filter(k => player.weapons[k] === true)
  if (order.length === 0) {
    return player.currentWeapon
  }
  const i = order.indexOf(player.currentWeapon)
  return order[(i + dir + order.length) % order.length] ?? player.currentWeapon
}

/**
 * Best owned RANGED weapon that has live ammo (highest autoSwitchRank). Melee weapons
 * (ammoPerShot 0) are never auto-switch targets on a dry trigger pull. null if none.
 */
export function pickBestArmedWeapon(player: Player): WeaponKind | null {
  let best: WeaponKind | null = null
  let bestRank = -1
  for (const kind of WEAPON_SELECT_ORDER) {
    if (player.weapons[kind] !== true) {
      continue
    }
    const def = WEAPONS[kind]
    if (def.ammo === null || def.ammoPerShot <= 0) {
      continue
    }
    if ((player.ammo[def.ammo] ?? 0) < def.ammoPerShot) {
      continue
    }
    if (def.autoSwitchRank > bestRank) {
      bestRank = def.autoSwitchRank
      best = kind
    }
  }
  return best
}

/** On pickup: switch to the picked weapon if it ranks at least as high as the current one. */
export function maybeAutoSwitch(player: Player, kind: WeaponKind): void {
  if (WEAPONS[kind].autoSwitchRank >= WEAPONS[player.currentWeapon].autoSwitchRank) {
    requestWeapon(player, kind)
  }
}

/**
 * HUD/test-only derived cadence: sum of tics from chain.atk through the state whose action
 * is 'reFire' (inclusive), divided by TICRATE. The engine never reads this.
 */
export function fireDelaySeconds(def: WeaponDef): number {
  const states = def.chain.states
  let tics = 0
  let i = def.chain.atk
  // Walk along `next`, accumulating tics, until (and including) the reFire state.
  let guard = states.length
  while (guard-- > 0) {
    const s = states[i]
    if (s === undefined) {
      break
    }
    tics += s.tics
    if (s.action === 'reFire') {
      break
    }
    i = s.next
  }
  return tics * SECONDS_PER_TIC
}

export interface WeaponTickResult {
  fired: WeaponKind | null
  dryFired: boolean
  pull?: Vec2
}

/** Per-tick combat context shared by the action dispatcher + the layer walkers. */
interface WeaponCtx {
  readonly scene: SceneQuery
  readonly enemies: Enemy[]
  readonly projectiles: Projectile[]
  readonly rng: Rng
  readonly result: WeaponTickResult
}

/** True when the weapon can fire one more shot (melee always can). */
function stillHasAmmo(player: Player, def: WeaponDef): boolean {
  return def.ammo === null || (player.ammo[def.ammo] ?? 0) >= def.ammoPerShot
}

/**
 * Roll one damage value from the (sides, mul) dice: (1 + floor(rng*sides)) * mul.
 *
 * Melee (sides 10) and projectile (sides 8) use this UNIFORM die — the sanctioned
 * simplification (weaponPlan.md §5: "distributions match, sequences don't"). A %8 die is
 * exactly uniform and a %10 die's bias is negligible, so the difference from canon's
 * P_Random%N is immaterial. This is deliberately NOT rollHitscanDamage, which keeps the
 * faithful %3 bias because there the 3-bucket skew is observable (5 modal vs 10/15).
 */
function rollDamage(rng: Rng, sides: number, mul: number): number {
  return (1 + Math.floor(rng() * sides)) * mul
}

// --- Phase C: faithful linuxdoom-1.10 hitscan spread + damage --------------------
//
// Doom drives bullet scatter off P_Random bytes. We mirror that deterministically
// from the engine Rng so the cone shape and damage distribution match canon.

/** One P_Random() byte ∈ [0,255]. */
function rndByte(rng: Rng): number {
  return Math.floor(rng() * 256)
}

/** Triangular driver (P_Random − P_Random) ∈ [−255,255], denser near 0. Consumes 2 rng() calls. */
function rndDiff(rng: Rng): number {
  return rndByte(rng) - rndByte(rng)
}

/** Convert a Doom BAM angle (1/2^32 of a turn) to radians. */
const BAM_TO_RAD = (2 * Math.PI) / 2 ** 32

/**
 * Triangular horizontal spread half-angle in radians: (P_Random−P_Random) << shift BAM.
 * shift 18 (pistol/chaingun/shotgun) → ±0.09817 rad; shift 19 (SSG) → ±0.19635 rad.
 */
function spreadRad(rng: Rng, shift: number): number {
  return rndDiff(rng) * (1 << shift) * BAM_TO_RAD
}

/**
 * Hitscan damage roll: 5*((P_Random%3)+1) ∈ {5,10,15}; the %3 bias slightly favours 5
 * (of the 256 byte values 86 map to 5, 85 to 10, 85 to 15 — so 5 is modal while 10 and 15
 * are tied). Exported so the bias is tested against the REAL function, not a re-implementation.
 */
export function rollHitscanDamage(rng: Rng): number {
  return 5 * ((rndByte(rng) % 3) + 1)
}

/**
 * Engine-chosen mapping from a `(P_Random−P_Random) << verticalSlopeShift` slope value to a
 * rise/run ratio for the planar vertical gate. NOT an id-source constant — canon only specifies
 * the BAM shift; this scale is pinned by test (hitscan.test.ts) so 255*(1<<5)*SLOPE_UNIT ≈ 0.12.
 */
export const SLOPE_UNIT = 1.47e-5

/** Begin the flash layer at `head` (or no-op if the weapon has no flash). */
function startFlash(player: Player, head: number, ctx: WeaponCtx): void {
  if (head < 0) {
    return
  }
  walkLayer(player, head, 'flash', ctx)
}

/**
 * Consume ammo + fire, dispatched by fireMode. The folded muzzle flash is started here
 * for the weapons whose flash is implicit.
 */
function runFireAction(action: PspAction, player: Player, def: WeaponDef, ctx: WeaponCtx): void {
  // Canon A_FireCGun/A_FirePistol etc. begin with `if (!player->ammo[…]) return;`. The
  // chaingun's atk chain dispatches fireCGun on TWO consecutive frames (CHGG A then B), so
  // with 1 bullet the A frame would fire (→0) and the B frame would fire AGAIN (→-1). Guard
  // here — BEFORE any debit / result.fired / flash / dispatch — so an out-of-ammo fire frame
  // is a no-op. Single-fire weapons never reach a second fire frame, so this is a pure safety
  // net for them. Melee (ammo:null) always passes.
  if (!stillHasAmmo(player, def)) {
    return
  }
  if (def.ammo !== null && def.ammoPerShot > 0) {
    // Accepted simplification: all ammo (incl. the BFG's 40 cells) is debited here at the
    // fire frame, not mid-charge at A_FireBFG (~30 tics in); the charge-window refund is deferred.
    player.ammo[def.ammo] = (player.ammo[def.ammo] ?? 0) - def.ammoPerShot
  }
  ctx.result.fired = def.kind

  const chain = def.chain
  if (action === 'fireCGun') {
    const offset = Math.min(1, Math.max(0, player.pspIndex - chain.atk))
    startFlash(player, chain.flash + offset, ctx)
  } else if (action === 'firePlasma') {
    startFlash(player, chain.flash + (ctx.rng() < 0.5 ? 0 : 1), ctx)
  } else if (action === 'firePistol' || action === 'fireShotgun' || action === 'fireShotgun2') {
    startFlash(player, chain.flash, ctx)
  }

  switch (def.fireMode) {
    case 'melee': {
      const { pull } = fireMelee(player, ctx.scene, ctx.enemies, def, ctx.rng)
      // Phase D: surface the chainsaw pull (unit enemy←player vector) to the caller; the
      // world routes it through collision so the player is dragged toward the target.
      if (pull !== undefined) {
        ctx.result.pull = pull
      }
      break
    }
    case 'projectile':
      fireProjectile(player, ctx.projectiles, def, ctx.rng)
      break
    default:
      fireHitscan(player, ctx.scene, ctx.enemies, def, ctx.rng)
      break
  }
}

/** Park the gun-layer at its static ready frame unless we're mid raise/lower travel. */
function settleReady(player: Player): void {
  if (player.weaponState !== 'raising' && player.weaponState !== 'lowering') {
    player.weaponState = 'ready'
  }
}

/**
 * Dispatch an A_* action ON ENTRY. Returns: -1 = no retarget (loop honours tics/next);
 * >=0 = jump the layer to that index (its action runs on entry too); -2 = flash-layer
 * terminated. `layer` selects gun vs flash. Mutates player + ctx only — the calling loop
 * owns all index/tics changes (actions retarget by return value, never recursion).
 */
function runAction(
  action: PspAction | null,
  player: Player,
  layer: 'gun' | 'flash',
  ctx: WeaponCtx,
): number {
  if (action === null) {
    return -1
  }
  const def = WEAPONS[player.currentWeapon]
  const chain = def.chain

  switch (action) {
    case 'ready': {
      if (player.pendingWeapon !== null) {
        player.weaponState = 'lowering'
        return chain.down
      }
      if (player.attackLatch === true) {
        if (stillHasAmmo(player, def)) {
          player.weaponState = 'firing'
          player.attackLatch = false
          return chain.atk
        }
        player.attackLatch = false
        const best = pickBestArmedWeapon(player)
        if (best !== null && best !== player.currentWeapon) {
          requestWeapon(player, best)
          return chain.down
        }
        ctx.result.dryFired = true
        setMessage(player, 'OUT OF AMMO')
        settleReady(player) // out of ammo, nothing to switch to: sit at ready
        return -1
      }
      settleReady(player) // idle: the firing chain has unwound back to ready
      return -1
    }

    case 'firePistol':
    case 'fireShotgun':
    case 'fireShotgun2':
    case 'fireCGun':
    case 'fireMissile':
    case 'firePlasma':
    case 'fireBFG':
    case 'punch':
    case 'saw':
      runFireAction(action, player, def, ctx)
      return -1

    case 'gunFlash':
      startFlash(player, chain.flash, ctx)
      return -1

    case 'reFire':
      if (player.attackLatch === true && stillHasAmmo(player, def)) {
        player.refireCount++
        player.attackLatch = false
        return chain.atk
      }
      player.refireCount = 0
      return -1

    case 'lower': {
      player.pspSy = Math.min(WEAPONBOTTOM, player.pspSy + RAISE_LOWER_SPEED)
      if (player.pspSy >= WEAPONBOTTOM) {
        player.currentWeapon = player.pendingWeapon ?? player.currentWeapon
        player.pendingWeapon = null
        player.refireCount = 0
        player.flashIndex = -1
        player.weaponState = 'raising'
        player.pspSy = WEAPONBOTTOM
        return WEAPONS[player.currentWeapon].chain.up
      }
      return -1
    }

    case 'raise':
      player.pspSy = Math.max(WEAPONTOP, player.pspSy - RAISE_LOWER_SPEED)
      if (player.pspSy <= WEAPONTOP) {
        player.pspSy = WEAPONTOP
        player.weaponState = 'ready'
        return chain.ready
      }
      return -1

    case 'light0':
      player.extralight = 0
      if (layer === 'flash') {
        player.flashIndex = -1
        return -2
      }
      return -1

    case 'light1':
      player.extralight = 1
      return -1

    case 'light2':
      player.extralight = 2
      return -1

    // Sound is engine-side; the reload sub-actions are no-ops for the sim.
    case 'bfgSound':
    case 'checkReload':
    case 'openShotgun2':
    case 'loadShotgun2':
    case 'closeShotgun2':
      return -1

    default: {
      // Exhaustiveness guard: a new/typo PspAction that no case handles is a COMPILE error
      // here, not a silent fall-through to -1.
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

/**
 * Walk one psprite layer from `index`, running actions ON ENTRY until a timed state. The
 * gun layer records pspIndex/pspTics/weaponFrame; the flash layer records flashIndex/
 * flashTics and stops on a -2 (light0 terminator). 0-tic states fall through the same tic;
 * an action's >=0 return retargets the walk (its head's action then runs on entry too).
 */
function walkLayer(player: Player, index: number, layer: 'gun' | 'flash', ctx: WeaponCtx): void {
  let i = index
  let guard = 64
  while (guard-- > 0) {
    const s = WEAPONS[player.currentWeapon].chain.states[i]
    if (s === undefined) {
      if (layer === 'flash') {
        player.flashIndex = -1
      }
      return
    }
    if (layer === 'gun') {
      player.pspIndex = i
      player.pspTics = s.tics
      player.weaponFrame = s.frame
    } else {
      player.flashIndex = i
      player.flashTics = s.tics
    }
    const jump = runAction(s.action, player, layer, ctx)
    if (jump === -2) {
      return
    }
    if (jump >= 0) {
      i = jump
      continue
    }
    if (s.tics === 0) {
      i = s.next
      continue
    }
    return
  }
}

/** Advance both psprite layers by one 35Hz tic. */
function tickPsprite(player: Player, ctx: WeaponCtx): void {
  // 1) FLASH layer (independent of the gun layer).
  if (player.flashIndex !== -1) {
    player.flashTics--
    if (player.flashTics <= 0) {
      const s = WEAPONS[player.currentWeapon].chain.states[player.flashIndex]
      if (s !== undefined) {
        walkLayer(player, s.next, 'flash', ctx)
      } else {
        player.flashIndex = -1
      }
    }
  }

  // 2) GUN layer.
  player.pspTics--
  if (player.pspTics <= 0) {
    const s = WEAPONS[player.currentWeapon].chain.states[player.pspIndex]
    if (s !== undefined) {
      walkLayer(player, s.next, 'gun', ctx)
    }
  }
}

/**
 * Drive the psprite state machine for one 60Hz frame: latch the attack intent so a 35Hz
 * tic never misses a 60Hz-frame edge press, then run as many 35Hz tics as `dt` carries.
 */
export function updateWeapon(
  player: Player,
  attack: boolean,
  scene: SceneQuery,
  enemies: Enemy[],
  projectiles: Projectile[],
  rng: Rng,
  dt: number,
): WeaponTickResult {
  const result: WeaponTickResult = { fired: null, dryFired: false }
  const ctx: WeaponCtx = { scene, enemies, projectiles, rng, result }
  player.attackLatch ||= attack
  player.ticAccumulator += dt
  while (player.ticAccumulator >= SECONDS_PER_TIC) {
    player.ticAccumulator -= SECONDS_PER_TIC
    tickPsprite(player, ctx)
  }
  return result
}

/**
 * Melee: one hitscan at MELEE_RANGE. The angle wiggle is Doom's triangular
 * `(P_Random−P_Random) << 18` (≈±0.098 rad / ±5.6°), the SAME spreadShift-18 driver the
 * hitscan path uses — NOT a uniform randRange. Fist gets the ×10 berserk boost; the
 * chainsaw never does (no `berserkBoost` key). A meleePull weapon (chainsaw) that connects
 * surfaces a unit pull vector (enemy − player) so the caller can drag the player toward the
 * target; there is NO backward recoil for either melee weapon (Doom has none — kept by design).
 */
function fireMelee(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  def: WeaponDef,
  rng: Rng,
): { pull?: Vec2 } {
  const wiggle = def.spread.horizontal > 0 ? spreadRad(rng, def.spreadShift ?? 18) : 0
  const result = hitscan(scene, enemies, player.pos, player.angle + wiggle, def.range)
  if (!result.hitEnemy) {
    return {}
  }
  const enemy = enemies[result.enemyIndex]
  if (enemy === undefined) {
    return {}
  }
  let dmg = rollDamage(rng, def.damage.sides, def.damage.mul)
  if (def.damage.berserkBoost === true && player.berserk === true) {
    dmg *= 10
  }
  damageEnemy(enemy, dmg, rng)
  const pull = def.meleePull === true ? normalize(sub(enemy.pos, player.pos)) : undefined
  return { pull }
}

/**
 * Hitscan: fire def.pellets rays with faithful Doom scatter (p_pspr.c / p_map.c).
 *
 * Horizontal: triangular `(P_Random−P_Random) << spreadShift` BAM half-angle. A first
 * shot from a single-pellet weapon flagged firstShotAccurate (pistol/chaingun, while
 * refireCount===0) is pinpoint; multi-pellet weapons (shotgun/SSG) ALWAYS spread.
 *
 * The chaingun's "first TWO shots accurate" is NOT a property of this function — it emerges
 * from the CHGG state chain firing fireCGun on two consecutive frames (atk indices 3 & 4)
 * while A_ReFire bumps refireCount only ONCE per A/B pair. So both shots of the opening pair
 * see refireCount===0 (accurate), and only from the second pair on does refireCount>0 spread.
 * There is intentionally no `accurateShots` field: a `refireCount < accurateShots` shortcut
 * would wrongly keep pair-2 pinpoint, breaking canon.
 *
 * Vertical: weapons with verticalSlopeShift (SSG) perturb the bullet slope per pellet;
 * combat.hitscan then gates the hit against ENEMY_HALF_HEIGHT (a far pellet at a steep
 * slope clears the target). player.bulletSlope is always 0.
 *
 * Per-pellet RNG-call ORDER is load-bearing for determinism:
 *   1. spreadRad → rndDiff consumes 2 rng() (skipped only on the accurate single-shot path),
 *   2. vertical slope → rndDiff consumes 2 more rng() (SSG only),
 *   3. rollHitscanDamage consumes 1 rng() (only on a hit),
 *   4. damageEnemy's painChance consumes 1 rng() (only on a hit).
 */
function fireHitscan(
  player: Player,
  scene: SceneQuery,
  enemies: Enemy[],
  def: WeaponDef,
  rng: Rng,
): void {
  const shift = def.spreadShift ?? 18
  const accurate = def.firstShotAccurate === true && player.refireCount === 0
  for (let i = 0; i < def.pellets; i++) {
    const angle =
      accurate && def.pellets === 1 ? player.angle : player.angle + spreadRad(rng, shift)
    const slope =
      def.verticalSlopeShift !== undefined
        ? player.bulletSlope + rndDiff(rng) * (1 << def.verticalSlopeShift) * SLOPE_UNIT
        : player.bulletSlope
    const result = hitscan(scene, enemies, player.pos, angle, def.range, slope)
    if (result.hitEnemy) {
      const enemy = enemies[result.enemyIndex]
      if (enemy !== undefined) {
        damageEnemy(enemy, rollHitscanDamage(rng), rng)
      }
    }
  }
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
  const dmg = rollDamage(rng, PROJECTILE_DAMAGE_SIDES, pdef.base)
  projectiles.push(spawnProjectile(projKind, muzzle, dir, dmg, false, pdef.speed))
}
