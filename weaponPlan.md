# weaponPlan.md

> **GOAL.** Make the TypeScript Doom-like at `/Users/dkuznetsov/Work/doom-game-webgl` use the **real Freedoom weapon viewmodel sprites** (correct per-frame letters, Doom X/Y anchor offsets, separate bright muzzle-flash overlay, raise/lower travel, tic-accurate timing, movement-driven bob) **and** port **original-Doom weapon mechanics/properties faithfully**: linuxdoom-1.10 damage rolls, triangular `(P_Random−P_Random)` spread with first-shot accuracy, correct pellet counts, per-weapon ammo costs and caps, 35Hz psprite-tic cadence/refire, and the projectile + splash + BFG two-stage-spray mechanics. The arsenal already exists and is green; this plan converts the ad-hoc, seconds-based, procedurally-rendered weapon subsystem into a single data-driven psprite state machine backed by the atlas, then fixes the per-weapon-class mechanics to canon — with all concrete numbers and file refs preserved.

---

## 0. Current state summary

Audited from `src/doom/game/weapon.ts`, `types.ts`, `player.ts`, `pickup.ts`, `projectile.ts`, `combat.ts`, `world.ts`, `engine/input.ts`, `config.ts`, `ui/hud.ts`, `engine/textures.ts`, `scripts/build-sprites.ts`, `public/sprites/atlas.json`.

**Identity / table (data-driven, keep & extend):**
- `WeaponKind` union of 9 — `types.ts:39-48` (`fist|chainsaw|pistol|shotgun|superShotgun|chaingun|rocket|plasma|bfg`); no enum.
- Central `WEAPONS: Readonly<Record<WeaponKind, WeaponDef>>` — `weapon.ts:31-163`; `WeaponDef` contract — `types.ts:431-452`. Holds `ammo`, `damageSides/Mul`, `pellets`, `spread`, `fireDelay`, `range`, `automatic`, `slot`, `fireMode`, `ammoPerShot`, `projectileKind?`, `verticalSpread?`, `berserkBoost?`.
- `PROJECTILE_DEFS` — `projectile.ts:48-58` (speed=cells/s, base=damage mul, splash/homing/bfgSpray/sprite). Rocket `{speed:10.94, base:20, splashCells:2.0}`, plasma `{speed:13.67, base:5}`, bfg `{speed:13.67, base:100, bfgSpray:true}`.
- Default loadout — `createPlayer` `player.ts:54-92`: owns `fist`+`pistol`, `currentWeapon:'pistol'`, `pendingWeapon:null`, `weaponState:'ready'`.

**Ammo (data-driven, already correct):**
- `AmmoKind = 'bullets'|'shells'|'rockets'|'cells'` — `types.ts:49`.
- Consts — `player.ts:28-40`: `START_BULLETS=50`; caps `MAX_BULLETS=200/MAX_SHELLS=50/MAX_ROCKETS=50/MAX_CELLS=300`; clips `CLIP_BULLETS=10/CLIP_SHELLS=4/CLIP_CELLS=20/CLIP_ROCKETS=1`. Backpack ×2 → 400/100/100/600 (`giveBackpack` `player.ts:185-198`). `giveAmmo` clamp `player.ts:175-179`.
- Pickup tables `AMMO_PICKUPS`/`WEAPON_PICKUPS` — `pickup.ts:66-105`; `clipDropped`=5 bullets (half clip) — `pickup.ts:68-69`, driven by `EnemyDef.drop` `types.ts:511-515`.

**Firing pipeline:**
- `World.updateWeaponPhase(input, dt)` — `world.ts:632-661`: slot → `weaponBySlot`+`requestWeapon`; `updateWeapon`; `wantsToFire = def.automatic ? input.firing : input.fire` (`world.ts:651`); fires only when `weaponState==='ready'`.
- `tryFire` — `weapon.ts:243-284`: ammo guard `:258-263` (`'OUT OF AMMO'`), decrement `:264`, set `firing`, branch on `fireMode` → `fireMelee` `:287-309` / `fireHitscan` `:317-340` / `fireProjectile` `:343-353`.
- `hitscan` — `combat.ts:88-132`: planar DDA wall cast + perpendicular enemy projection (`ENEMY_HIT_RADIUS=0.42` `config.ts:41`); **no vertical/pitch/autoaim**.
- Projectile resolution in world: `applyProjectileImpact` `world.ts:389-415`, `applySplash` `world.ts:469-488` (Chebyshev, LoS-gated, hurts shooter `:484`, `splashImmune` skip `:475`), `fireBfgSpray` `world.ts:604-624`.

**Hardcoded / scattered (this plan converts):**
- **Cadence = single `fireDelay` (seconds)** doubling as anim length + min gap, quantized by global `SWITCH_TIME=0.18` — `updateWeapon` `weapon.ts:196-223`, const `weapon.ts:27`. No tic table, no raise/lower, no `A_ReFire`.
- **`weaponBySlot` is a `switch`** ignoring each `WeaponDef.slot` — `weapon.ts:174-193` (two sources of truth, drift risk).
- **Weapon-select keys hardcoded `Digit1..Digit7`** — `input.ts:187-213`, `isGameKey` `input.ts:248-262`; `KeyBindings` (`types.ts:397-407`) has no weapon actions, no next/prev, no mousewheel.
- **No auto-switch** on pickup or empty; dry-fire just sets `'OUT OF AMMO'` (`weapon.ts:261`).
- **Projectile damage bypasses WeaponDef**: `fireProjectile` rolls `rollDamage(rng, 8, pdef.base)` with hardcoded `8` (`weapon.ts:351`); rocket/plasma/bfg `damageSides/damageMul/range` fields are **dead** (hand-synced to `PROJECTILE_DEFS.base`).
- **Spread is uniform** `randRange(rng,-spread,+spread)` (radian half-angle `0.098/0.087/0.196`) — not Doom's `(P_Random−P_Random)` triangular BAM shift; **no refire/first-shot-accuracy** (`Player` has no `refire`).
- **SSG vertical spread faked** as `verticalSpread:0.25` per-pellet `continue`-miss — `weapon.ts:326-328` (distance-independent, deletes ~5 of 20 pellets unconditionally).
- **BFG spray approximate**: `BFG_RAYS=40`/`BFG_FAN=π/2`/`BFG_RAY_STEP`/`BFG_RAY_RANGE=16` literals `world.ts:85-88`; per-ray 15×`(1+floor(rng*8))` literals `world.ts:618-622`; sprays from frozen `proj.originPos` (stale muzzle). `originPos`/`originAngle` are written together in `spawnProjectile` (`projectile.ts:99-100`, inside the `def.bfgSpray === true` branch).

**Sprites / viewmodel (the headline gap):**
- Atlas `public/sprites/atlas.json` packs **all 15 viewmodel prefixes complete with real Doom offsets** (`PUNG/SAWG/PISG/PISF/SHTG/SHTF/SHT2/CHGG/CHGF/MISG/MISF/PLSG/PLSF/BFGG/BFGF`, `rotated=false`, e.g. `PISG A ox-125 oy-97`, `BFGG A ox-95 oy-106`). The 15 viewmodel prefixes are declared in the `ROSTER` at `scripts/build-sprites.ts:42-43`; the generic actor/frame manifest (frames + per-actor slot index) is emitted at `scripts/build-sprites.ts:222-262`. (There is no viewmodel-specific packing at `:128-260` — that span is `cropToBbox` + `main()` setup.)
- **Runtime never reads them for the gun.** `renderWeaponSprite` (`hud.ts:159-175`) draws procedural `assets.weapon[...]` from `buildWeapons` (`textures.ts:1060`); atlas is wired into `world.buildSprites` (`world.ts:836+`) for **world billboards only**.
- Each weapon collapses to **1 idle + 3 fire** procedural frames (`makeWeapon` `textures.ts:889-894`) regardless of real counts; offsets dropped (`WeaponVisual` `types.ts:205-209` has no offset fields); hard-anchored bottom-centre at `scale=2` (`hud.ts:161,170-173`).
- **No flash overlay** (baked into fire frame via `muzzleFlash` `textures.ts:760-764`, alpha-tested; fist/chainsaw get none). **No raise/lower travel** (switch waits 0.18s then snaps; old idle stays). **Bob is `weaponTimer*6` sinusoid** (`hud.ts:165-167`), not movement-driven. Frame-index vs 3-texture-array **granularity mismatch** (`hud.ts:153`).
- `blitTexture` (`framebuffer.ts:198-225`) is alpha-test + opaque write — a bright/additive variant is needed for flash. `VIEW_W=320`, `VIEW_H=160` (`config.ts:10-11`); `TIMESTEP=1/60` (`config.ts:49`) — **sim runs at 60Hz, tic clock must be derived (35Hz)**.

**Key constants:** `GUN_RANGE=32` (`weapon.ts:29`, "MISSILERANGE 2048u ≈ 32 cells"); `MELEE_RANGE=1.1` (`config.ts:45`); `SWITCH_TIME=0.18` (`weapon.ts:27`); `PLAYER_SPLASH_RADIUS=0.22` (`world.ts:83`); muzzle offset `0.4`.

---

## 1. Canonical Doom reference (linuxdoom-1.10)

### 1.1 Per-weapon stats & ammo

| Weapon | slot | mobj/mode | ammo | ammo/shot | direct damage | pellets | area effect |
|---|---|---|---|---|---|---|---|
| Fist | 1 | melee | none | 0 | `2*((P_Random%10)+1)` → 2..20; berserk ×10 → 20..200 | 1 | — |
| Chainsaw | 1 | melee | none | 0 | `2*((P_Random%10)+1)` → 2..20; **NOT berserk-boosted** | 1 | — (pulls player to target) |
| Pistol | 2 | hitscan | bullets | 1 | `5*((P_Random%3)+1)` → 5/10/15 | 1 | — |
| Shotgun | 3 | hitscan | shells | 1 | 5/10/15 per pellet | 7 | — |
| Super Shotgun | 3 | hitscan | shells | **2** | 5/10/15 per pellet | 20 | — |
| Chaingun | 4 | hitscan | bullets | 1 | 5/10/15 | 1 | — |
| Rocket | 5 | projectile `MT_ROCKET` 20u/tic | rockets | 1 | `20*((P_Random%8)+1)` → 20..160 | — | `A_Explode P_RadiusAttack(128)`, hurts shooter, Cyber/Spider immune |
| Plasma | 6 | projectile `MT_PLASMA` 25u/tic | cells | 1 | `5*((P_Random%8)+1)` → 5..40 | — | none |
| BFG9000 | 7 | projectile `MT_BFG` 25u/tic | cells | **40** (`BFGCELLS`) | ball `100*((P_Random%8)+1)` → 100..800 | — | `A_BFGSpray` 40 tracers (see 1.4) |

**Ammo caps / pickups (repo already correct):** caps `bullets 200 / shells 50 / rockets 50 / cells 300`; **backpack ×2** → `400/100/100/600` + one clip each (`10/4/20/1`). Pickups: clip 10 / box 50; shells 4 / box 20; rocket 1 / box 5; cell 20 / pack 100. Dropped Zombieman clip = **5 bullets (half clip)**. (The canon "+half-max" backpack figure is non-vanilla; repo's ×2+clip is correct — no change.)

### 1.2 Per-weapon sprite state/tic chains (35Hz `info.c` psprites)

Universal: `up`/`down`/`ready` heads self-loop 1 tic until `A_Raise`/`A_Lower`/input breaks them; `bright:true` on flash/muzzle frames; 0-tic states fall through the **same** tic. `RAISESPEED=LOWERSPEED=6` view-units/tic; `WEAPONTOP=32`, `WEAPONBOTTOM=128`.

| Weapon | atk chain (frame · tics · action) | refire | derived cadence |
|---|---|---|---|
| Fist (PUNG) | B4, **C4 `A_Punch`**, D5, C4, **B5 `A_ReFire`** | yes | 4+4+5+4+5 = **22 tics ≈ 0.629s** |
| Chainsaw (SAWG) | **A4 `A_Saw`**, **B4 `A_Saw`**, B0 **`A_ReFire`**; ready idles SAWG C↔D 4-tic | yes | **4 tics/bite ≈ 0.114s** |
| Pistol (PISG) | A4, **B6 `A_FirePistol`**, C4, **B5 `A_ReFire`**; flash PISF/A | yes | `S_PISTOL1..4 = 4+6+4+5` = **19 tics ≈ 0.543s** (fires on B / PISTOL2) |
| Shotgun (SHTG) | A3, **A7 `A_FireShotgun`**, B5,C5,D4,C5,B5,A3, **A7 `A_ReFire`**; flash SHTF/A,B | yes | `S_SGUN1..9 = 3+7+5+5+4+5+5+3+7` = **44 tics ≈ 1.257s** |
| Super Shotgun (SHT2) | A3, **A7 `A_FireShotgun2`**, B7, **C7 `A_CheckReload`**, D7 `A_OpenShotgun2`, E7, **F7 `A_LoadShotgun2`**, G6, **H6 `A_CloseShotgun2`**, **A5 `A_ReFire`**; flash baked SHT2 I/J | yes | `S_DSGUN1..10 = 3+7+7+7+7+7+7+6+6+5` = **62 tics ≈ 1.771s** |
| Chaingun (CHGG) | **A4 `A_FireCGun`**, **B4 `A_FireCGun`**, B0 **`A_ReFire`**; flash CHGF/A,B | yes | **4 tics/shot ≈ 0.114s** (~8.75 rps); the two-frame A/B loop is **8 tics ≈ 0.229s per pair** |
| Rocket (MISG) | **B8 `A_GunFlash`**, **B12 `A_FireMissile`**, B0 **`A_ReFire`**; flash MISF A..D | yes | `S_MISSILE1+2 = 8+12` = **20 tics ≈ 0.571s** |
| Plasma (PLSG) | **A3 `A_FirePlasma`** (= S_PLASMA1), B20 **`A_ReFire`** (= S_PLASMA2); flash `flashstate+(P_Random&1)` PLSF A/B | yes | **held cadence = one shot every 3 tics ≈ 0.086s (700/min)**; the 20-tic S_PLASMA2 only plays out as a release cooldown (≈0.571s) — see note below |
| BFG (BFGG) | A20 `A_BFGsound`, **B10 `A_GunFlash`**, **B10 `A_FireBFG`**, B20 **`A_ReFire`**; flash BFGF A/B | yes | `20+10+10+20` = **60 tics ≈ 1.714s** (ball fires ~30 tics after charge) |

`A_Light0/1/2` set `extralight` 0/1/2; flash layer self-terminates at `S_LIGHTDONE` → `A_Light0` → null. `SHTG E` is `S_LIGHTDONE`'s shared terminal sprite — letter exists but is never drawn.

> **Plasma held-cadence derivation (explicit, to kill ambiguity).** The chain is `S_PLASMA1(3, A_FirePlasma) → S_PLASMA2(20, A_ReFire)`. `A_ReFire` is **not** a passive wait: when +attack is *held* and ammo remains, it immediately re-targets the psprite back to the **atk head** (`S_PLASMA1`), so the 20-tic `S_PLASMA2` is **never traversed under sustained fire**. Sustained rate is therefore **1 shot per 3 tics ≈ 11.67 shots/s (700/min)**, not `1 / (3+20)`. The 20-tic `S_PLASMA2` is only fully played when fire is *released* on that frame — it then reads as a ~0.571s settle before `ready`. (The same short-circuit governs chaingun/chainsaw/rocket/BFG: `A_ReFire` loops to the atk head while held, plays through `next` on release. Our Phase A `tickPsprite` implements `A_ReFire` exactly this way, so the held cadence equals the **atk-head loop length**, not the full chain.) The "~11.6 shots/s held" figure below is the realized 35/3 rate — pinned by a golden trace in Phase B, not asserted blind. This matches the repo's own canon note `doomBehaviorSpec.md:354` ("held cadence one shot every 3 tics (700/min)").

### 1.3 Spread & damage formulas

- **`P_Random()` byte** ∈ `[0,255]`. Our deterministic `rndByte(rng) = floor(rng()*256)`.
- **Triangular spread driver** `rndDiff(rng) = rndByte − rndByte` ∈ `[−255,255]`, centred on 0 (denser in middle than uniform — this is the second half of the spread fix).
- **Horizontal spread** = `(P_Random−P_Random) << shift` BAM. `BAM_TO_RAD = 2π / 2^32 ≈ 1.4629e-9`. `spreadRad(rng,shift) = rndDiff(rng) * (1<<shift) * BAM_TO_RAD`.
  - `shift=18` (pistol/chaingun/shotgun): max `±0.09817 rad ≈ ±5.625°`.
  - `shift=19` (SSG): max `±0.19635 rad ≈ ±11.25°` (~2× shotgun, by design).
- **First-shot accuracy:** `accurate = !player->refire`. `refire` is incremented by `A_ReFire` while held, reset to 0 on release. Pistol 1 accurate shot, chaingun 2; shotgun/SSG **always** spread (multi-pellet ignores accurate path); automatic plasma is pinpoint (no spread).
- **Hitscan damage** `rollHitscanDamage(rng) = 5*((rndByte % 3)+1)` ∈ `{5,10,15}` (the `%256→%3` bias slightly favors `5` — faithful, keep). Rolled independently per pellet.
- **Melee damage** `rollDamage(rng,10,2) = 2*((rndByte%10)+1)` ∈ {2..20}; punch ×10 under berserk; angle wiggle `(P_Random−P_Random)<<18 ≈ ±5.6°` (`spread:0.098`).
- **SSG vertical scatter** (per pellet): `slope = bulletSlope + (P_Random−P_Random) << 5`. Modelled distance-aware (see §6/Phase E Task E4).

### 1.4 Projectile & BFG mechanics

- **Universal projectile impact** (`PIT_CheckThing`): `damage = ((P_Random%8)+1) * info.damage`; multiplier 20/5/100.
- **Speeds (already correct as cells/s):** `u/tic × 35 ÷ 64`. Rocket `20×35÷64 = 10.94`, plasma/bfg `25×35÷64 = 13.67`. **No change.**
- **Rocket splash** `A_Explode → P_RadiusAttack(128)`: peak 128 at epicenter, falloff `128 − dist`, LOS-gated, **damages shooter**, Cyber/Spider immune. Canon uses `P_AproxDistance (max+min/2)`; repo uses Chebyshev `max(|dx|,|dy|)` — **kept by design** (sanctioned simplification). Direct-hit enemy takes impact roll **AND** ~128 splash (double-count is faithful).
- **BFG two-stage:** ball flies, on death `A_BFGSpray` emits **40** `P_AimLineAttack` tracers; `an = mo->angle − ANG90/2 + ANG90/40*i` → ±45° fan, **2.25°/ray**; range `16*64 = 1024u` (16 cells). Each connecting ray = `Σ_{j=0}^{14} ((P_Random&7)+1)` → 15..120 (realized ~49–87 with the fixed LUT; our PRNG gives the full 15–120). Origin = **`mo->target` = the shooting PLAYER's current position**; angle = **frozen** ball facing = player's facing when the ball was FIRED (turning after firing does NOT swing the spray). Spawns `MT_EXTRABFG` (`BFE2`) cosmetic at each hit.
- **Plasma flash:** `A_FirePlasma` sets `flashstate + (P_Random&1)` (alternating PLSF A/B). Chaingun flash by barrel frame: `flashstate + (gunState − atk0)` (CHGF A/B).

---

## 2. Gap matrix

Each cell: **current → canon → ACTION**.

| Weapon | Viewmodel frames | Flash overlay | Per-frame offsets | Damage | Spread / accuracy | Ammo/shot | Cadence / refire | Projectile / splash |
|---|---|---|---|---|---|---|---|---|
| **Fist** | 1 idle+3 proc → PUNG A·B·C·D → use atlas; fire B→C→D→C→B, hit on C | none → none (correct) → keep | dropped → PUNG ox/oy → honor | 2..20, ×10 berserk (correct) → keep | `randRange ±0.098` → `<<18` wiggle → migrate helper, no accurate path | 0 (correct) → keep | `fireDelay 0.63` flat → 22-tic chain `A_Punch` on C → tic engine | n/a |
| **Chainsaw** | 1 idle+3 proc → SAWG A·B·C·D, animated C↔D idle → use atlas | none (correct) → keep | dropped → SAWG ox/oy → honor | 2..20, **no** berserk (correct) → keep+lock test | `randRange ±0.098` → `<<18` wiggle → migrate | 0 (correct) → keep | `fireDelay 0.114` flat, `automatic` → 4-tic/bite `A_Saw` loop → tic engine | n/a (adds player **pull** to target, no recoil) |
| **Pistol** | 1 idle+3 proc → PISG A·B·C(+E term) → use atlas | baked → PISF/A bright overlay → flash layer | dropped → PISG ox/oy → honor | `3×5`=5/10/15 (correct) → `rollHitscanDamage` doc | uniform, no refire → `<<18`, **1st shot accurate** → `refire` counter | 1 (correct) → keep | `0.4`/SWITCH quantum → 19-tic chain (4+6+4+5), fires on B → tic engine | n/a |
| **Shotgun** | 1 idle+3 proc → SHTG A·B·C·D → use atlas | baked → SHTF A·B overlay → flash layer | dropped → SHTG ox/oy → honor | 5/10/15 (correct) → keep | uniform `±0.087`, 7 pellets → `<<18`, **always** spread → rewrite `fireHitscan` | 1 (correct) → keep | `1.257` → 44-tic chain `A_FireShotgun` on frame 2 → tic engine | n/a |
| **Super Shotgun** | 1 idle+3 proc → SHT2 A..J → use atlas (I/J flash baked) | baked → SHT2 I/J bright → flash layer | dropped → SHT2 ox/oy → honor | 5/10/15 ×20 (correct) → keep | uniform `±0.196` + `verticalSpread:0.25` miss-hack → `<<19` + per-pellet vertical **slope** (`<<5`) | **2** (correct) → keep | `1.771` flat → 62-tic open/load/close chain → tic engine | n/a; **delete `verticalSpread`** |
| **Chaingun** | 1 idle+3 proc → CHGG A·B → use atlas | baked → CHGF A·B (by barrel frame) → flash layer | dropped → CHGG ox/oy → honor | 5/10/15 (correct) → keep | uniform, no refire → `<<18`, **first 2 accurate** → `refire` | 1 (correct) → keep | `0.114` flat, `automatic` → 4-tic/shot pair loop → tic engine | n/a |
| **Rocket** | 1 idle+3 proc → MISG A·B → use atlas | baked → MISF A·B·C·D explicit `A_GunFlash` → flash layer | dropped → MISG ox/oy → honor | `rollDamage(rng,8,base)` hardcoded `8` → 20..160 → const `PROJECTILE_DAMAGE_SIDES` | none (correct) → keep | 1 (correct) → keep | `0.571` ≈20-tic (correct) → tic engine | splash Chebyshev-128, hurts shooter, immune bosses (correct) → keep+document; wire `splashCells` |
| **Plasma** | 1 idle+3 proc → PLSG A·B → use atlas | baked → PLSF A/B `(rng&1)` → flash layer | dropped → PLSG ox/oy → honor | 5..40 (correct) → keep | none (correct) → keep | 1 (correct) → keep | `0.086` flat, no release pause → **3-tic/shot held** (S_PLASMA1; A_ReFire short-circuits S_PLASMA2 while held) **+ 20-tic S_PLASMA2 release-only cooldown** → native to tic engine (no `releaseDelay` hack) | none (correct) → keep |
| **BFG** | 1 idle+3 proc → BFGG A·B·C → use atlas | baked → BFGF A·B explicit `A_GunFlash` → flash layer | dropped → BFGG ox/oy → honor | ball 100..800 (correct) → keep | n/a | **40** (correct) → keep | `1.714` ≈60-tic (correct) → tic engine | spray from **stale muzzle** → from **player current pos**, frozen angle (Task B2); hoist consts; optional `BFE2` puff |

---

## 3. Implementation plan (phased, ordered)

> **Hard ordering:** Phase A is a prerequisite for everything. Phase B depends on A's data model. Phases C/D/E (per-weapon-class mechanics) depend on A's table + cadence engine and can proceed in parallel once A lands. Land A as one PR that compiles, passes all gates, and is observably behaviour-neutral for the shipped path (pistol still fires, empty weapon still refuses) — a mechanically-neutral refactor of cadence + selection + a faithful raise/lower addition, shipping the full 9-weapon table from the canonical tic tables.

### Phase A — Shared infrastructure (data table + cadence/tic engine + ammo + switching)

**Goal.** Replace the seconds-based `fireDelay`/`SWITCH_TIME` model and the `weaponBySlot` switch with one data-driven psprite state machine (35Hz tics) plus rebindable selection and auto-switch, so every later phase is "add a record + a state chain + wire the fire-action specifics," never "edit the engine."

**A1. New canonical shapes (`src/doom/types.ts`, alongside `:428-452`).** Add:
- `export const TICRATE = 35` (and `SECONDS_PER_TIC = 1/TICRATE`).
- `WeaponAction` enum (A_* pointers): `'raise' | 'lower' | 'ready' | 'fire' | 'refire' | 'flash' | 'light0' | 'checkReload' | 'reFireReset' | null` — extended per-weapon variants live in the state module as `PspAction` (`'FirePistol'|'FireShotgun'|'FireShotgun2'|'FireCGun'|'FireMissile'|'FirePlasma'|'FireBFG'|'BFGsound'|'Punch'|'Saw'|'OpenShotgun2'|'LoadShotgun2'|'CloseShotgun2'|'GunFlash'|'Light0/1/2'`).
- `interface WeaponPspState { frame:number; tics:number; bright:boolean; action; next:number }`.
- `interface WeaponStateChain { up; down; ready; atk; flash:number /* -1 = none */; states: readonly WeaponPspState[] }`.
- `interface DamageSpec { sides:number; mul:number; berserkBoost?:boolean }`.
- `interface SpreadSpec { horizontal:number; vertical?:number; accurateShots:number }`.
- Extend `WeaponState` to `'ready' | 'firing' | 'raising' | 'lowering'` (drop `'switching'`).
- Extend `KeyBindings` (`:397-407`) with `weapon1..weapon7`, `weaponNext`, `weaponPrev`.
- Add `InputFrame.weaponCycle: -1 | 0 | 1` alongside the existing `InputFrame.weaponSlot` (`types.ts:389`, inside `interface InputFrame` at `:379`).

**A2. Rewrite `WeaponDef` (`types.ts`, replacing `:431-452`).** Authoritative fields:
```ts
interface WeaponDef {
  kind: WeaponKind
  slot: number                  // 1..7 — NOW the source of truth
  ammo: AmmoKind | null
  ammoPerShot: number           // SSG 2, BFG 40, melee 0
  fireMode: WeaponFireMode      // 'melee' | 'hitscan' | 'projectile'
  pellets: number
  automatic: boolean            // stored: selects held-vs-edge fire read
  damage: DamageSpec            // {sides:3,mul:5} hitscan; {sides:10,mul:2,berserkBoost} melee; {sides:8,mul:20|5|100} projectile
  spread: SpreadSpec
  range: number                 // GUN_RANGE=32 / MELEE_RANGE=1.1
  projectileKind?: ProjectileKind
  // hitscan spread detail (Phase C):
  spreadShift?: number          // 18 pistol/chaingun/shotgun, 19 SSG
  firstShotAccurate?: boolean   // pistol/chaingun
  verticalSlopeShift?: number   // SSG = 5
  meleePull?: boolean           // chainsaw only (Phase D)
  chain: WeaponStateChain       // cadence lives HERE
  autoSwitchRank: number        // higher = better (auto-switch search)
}
```
Migration: **delete** `fireDelay` (seconds) and the dead `damageSides/damageMul/range` from projectile entries; keep a derived `fireDelaySeconds(def) = sum(atk-chain tics)/TICRATE` for tests/HUD **only** (engine never reads it). **Remove** `verticalSpread` once Phase C lands.

**A3. Populate the table + state chains (`src/doom/game/weapon.ts`, extends `:31-163`).** Transcribe all 9 `WEAPONS` records to the new shape with their §1.2 state chains. Factor each weapon's `states[]` via a local `chain(states, {up,down,ready,atk,flash})` builder so later phases append one array + index map. Add derivations: `WEAPON_SELECT_ORDER` (slot ascending), `SLOT_CANDIDATES` (`buildSlotCandidates(WEAPONS)`: slot1 `['fist','chainsaw']`, slot3 `['shotgun','superShotgun']`, else single), `WEAPONS_USING_AMMO: Record<AmmoKind, WeaponKind[]>`. Put the full canonical chains in `src/doom/game/weaponStates.ts` (pure data, zero imports beyond types) keyed by `WeaponStateId`, exposing `PSP_STATES` and `WEAPON_STATE_HEADS: Record<WeaponKind, WeaponStateHeads>`.

**A4. Cadence / refire engine (`src/doom/game/weapon.ts`).** Replace `updateWeapon`'s seconds quantizer (`:196-223`):
```ts
const SECONDS_PER_TIC = 1 / TICRATE
function updateWeapon(player, input, dt) {
  player.ticAccumulator += dt
  while (player.ticAccumulator >= SECONDS_PER_TIC) {
    player.ticAccumulator -= SECONDS_PER_TIC
    tickPsprite(player, input)   // one 35Hz tic of gun + flash layers
  }
}
```
`tickPsprite`: advance flash layer independently; decrement `pspTics`; while `pspTics===0` re-read state, `runAction(state.action, input)` (may RETARGET pspIndex), and if not retargeted advance to `state.next`; stop when landing on a timed state. `runAction` behaviours:
- `ready` (`A_WeaponReady`): apply bob; if `pendingWeapon` → enter `down`; else if attack (held if `automatic`, edge otherwise) → jump to `atk` head, `weaponState='firing'`. **Only place input is consumed** (so firing is impossible during lower/raise).
- `fire`: dispatch `fireMelee`/`fireHitscan`/`fireProjectile` using `spread.accurateShots > refireCount` for pinpoint-vs-spread; consume `ammoPerShot`; push flash layer (folded `A_GunFlash` for pistol/shotgun/chaingun/plasma/SSG; explicit `flash` state for rocket/bfg). Reads `def.damage` (kills hardcoded `8`).
- `refire` (`A_ReFire`): if attack held AND ammo → `setPspState(atk head)` (`refireCount++`); else `refireCount=0`, run ammo check / auto-switch, fall to `next`.
- `flash`: `setFlashState(chain.flash)`, `extralight` via light rows; advances each tic, self-terminates at `S_LIGHTDONE` → `-1`.
- `raise`/`lower`: slide `weaponY` (`pspSy`) by 6/tic; loop until top/bottom, then ready / commit-pending+raise.

New `Player` psprite cursor fields (`types.ts:626-628` region, replacing `weaponTimer`/`weaponFrame` placeholders): `weaponState`, `pspIndex`, `pspTics`, `flashIndex`/`flashTics` (-1 = none), `refireCount`, `pspSy` (32 top..128 bottom slide), `ticAccumulator`, `extralight`. Keep `weaponFrame` **derived** = `states[pspIndex].frame` each advance for the HUD consumer. Init all in `createPlayer` (`player.ts:84-86`): `pspSy=32`, `flashIndex=-1`, gun layer = `chain.ready` head.

**A5. World wiring (`src/doom/game/world.ts`, `updateWeaponPhase` `:632-661`).** Becomes: resolve `weaponSlot`/`weaponCycle` → `requestWeapon`; build `WeaponInput = { attack: def.automatic ? input.firing : input.fire }` (the `automatic` flag still selects held-vs-edge, as `:651`); `updateWeapon(player, weaponInput, dt)`. `tryFire` is **no longer called per-frame** — it becomes the `fire` action body invoked by `tickPsprite` (firing now lands on the exact canonical frame). World keeps projectile-impact resolution (`applyProjectileImpact`/splash/spray) unchanged.

**A6. Slot table is source of truth (`weapon.ts`).** Delete `weaponBySlot` switch body (`:174-193`); reimplement reading `WeaponDef.slot`:
```ts
function weaponBySlot(slot, player) {
  const owned = (SLOT_CANDIDATES[slot] ?? []).filter(k => player.weapons[k])
  if (!owned.length) return null
  const cur = owned.indexOf(player.currentWeapon)   // intra-slot cycle on repeat press
  return cur >= 0 ? owned[(cur+1)%owned.length] : owned[0]
}
function nextOwnedWeapon(player, dir) {
  const order = WEAPON_SELECT_ORDER.filter(k => player.weapons[k])
  const i = order.indexOf(player.currentWeapon)
  return order[(i+dir+order.length)%order.length]
}
```

**A7. Input wiring (`src/doom/engine/input.ts`).** Make weapon keys rebindable: replace the hardcoded `Digit1..7` switch in `captureWeaponSlot` (body at `:187-213`) and the `Digit*` checks in `isGameKey` (`:233+`) with `KeyBindings` lookups (defaults `Digit1..Digit7`, next/prev = mousewheel / `BracketRight` / `BracketLeft`). Add `wheel` event → `weaponCycle` (consumed-on-poll like `weaponSlot`, which is reset at `:109`/`:159`); `poll()` (declared `:127`) snapshots both into the `InputFrame`.

**A8. Auto-switch + raise/lower hand-off (auto-switch logic lives in `weapon.ts`, NOT `player.ts` — respect the no-import rule `player.ts:1-2`).**
- Rewrite `requestWeapon` (`player.ts:231-239`): sets `pendingWeapon` and, if `ready`, kicks the **current** weapon into its `down` chain. `lower` slides down; at bottom commits `currentWeapon=pendingWeapon`, clears pending, enters new weapon's `up`; `raise` slides up; at top → `ready`. Firing impossible during lower/raise.
- **On pickup** (`pickup.ts applyWeaponPickup :175+`): after `giveWeapon` returns `newlyOwned`, `maybeAutoSwitch(player, kind)` `requestWeapon`s if `autoSwitchRank ≥ current`. (Berserk → fist auto-switch `player.ts:251` stays.)
- **On empty** (in the `fire`/`refire` action): when ammo check fails on an **edge press**, `pickBestArmedWeapon(player)` (highest `autoSwitchRank` among owned weapons with ≥ `ammoPerShot`; melee always armed) → `requestWeapon`; fall back to `'OUT OF AMMO'` only if nothing armed (replaces `weapon.ts:261`).

**A9. Ammo alignment (no numeric changes).** Reconcile only: caps `200/50/50/300`, ×2 backpack, clips `10/4/20/1`, pickups, `clipDropped=5`, `ammoPerShot` (SSG 2 / BFG 40) all stay byte-identical. Add `WEAPONS_USING_AMMO` derivation for auto-switch.

**Acceptance (Phase A):**
- **AC-A1:** `weaponBySlot`/`nextOwnedWeapon` derive everything from `WeaponDef.slot`; no weapon-kind `switch` outside table builders; `fireDelay` (seconds) gone; no `SWITCH_TIME` remains.
- **AC-A2:** for each weapon `sum(atk-chain tics)/35` equals the canonical refire within ±1 tic. Assert against the **tic sums** (the source of truth), not the legacy seconds — the old `fireDelay` seconds (e.g. `0.63`/`0.4`) are the values being *replaced* and must not masquerade as canon:
  - fist `4+4+5+4+5 = 22 tics` (`22/35 ≈ 0.629s`),
  - pistol `4+6+4+5 = 19 tics` (`19/35 ≈ 0.543s`),
  - shotgun `S_SGUN1..9 = 3+7+5+5+4+5+5+3+7 = 44 tics` (`44/35 ≈ 1.257s`),
  - SSG `S_DSGUN1..10 = 3+7+7+7+7+7+7+6+6+5 = 62 tics` (`62/35 ≈ 1.771s`),
  - chaingun `4 tics/shot` (the A/B loop = `8 tics ≈ 0.229s per pair`),
  - rocket `S_MISSILE1+2 = 8+12 = 20 tics` (`20/35 ≈ 0.571s`),
  - plasma `3 tics/shot held` (`3/35 ≈ 0.086s`; the `S_PLASMA2` 20-tic frame is a release-only cooldown, not part of held cadence — see §1.2 note),
  - bfg `20+10+10+20 = 60 tics` (`60/35 ≈ 1.714s`).
- **AC-A3:** holding +attack on an automatic weapon loops the atk chain via `refire` at exactly the chain length; releasing → ready ≤1 tic; single-shot fires once per edge regardless of hold.
- **AC-A4:** pistol first held shot pinpoint, then spreads; chaingun first two pinpoint (`accurateShots` vs `refireCount`).
- **AC-A5:** switching lowers fully (cannot fire during lower/raise), commits at bottom, raises new; `weaponY`/`pspSy` reaches extremes.
- **AC-A6:** higher-rank pickup auto-switches; edge-press emptying auto-switches to best armed, else `'OUT OF AMMO'`.
- **AC-A7:** ammo numbers byte-identical to baseline.

**Files (Phase A):** `src/doom/types.ts`, `src/doom/game/weapon.ts`, `src/doom/game/weaponStates.ts` (new), `src/doom/game/player.ts`, `src/doom/game/pickup.ts`, `src/doom/engine/input.ts`, `src/doom/game/world.ts`.

---

### Phase B — Sprites & viewmodel animation + flash overlay

**Goal.** Replace procedural `assets.weapon` viewmodel with the atlas-backed psprite render: real frames, honored Doom offsets, separate bright flash overlay, raise/lower slide, movement-driven bob. Keep the procedural path as a headless/no-atlas fallback.

**B1. Build-time coverage gate (`scripts/build-sprites.ts`, after `actors` ~`:260`).** Add `REQUIRED_VIEWMODEL_FRAMES: Record<string,string[]>` mirroring §1.2 (PUNG A-D, SAWG A-D, PISG A-C + PISF A, SHTG A-E + SHTF A-B, SHT2 A-J incl. I/J flash, CHGG A-B + CHGF A-B, MISG A-B + MISF A-D, PLSG A-B + PLSF A-B, BFGG A-B + BFGF A-B) and throw if any required `(prefix,letter)` is missing from `actors[prefix].frames`. `SHTG E` exists but is never *drawn* — coverage check must not require it as a drawn frame. **No `atlas.json` schema change** — the runtime manifest frame type `AtlasFrame{x,y,w,h,ox,oy}` (`src/doom/engine/sprites/atlasTypes.ts:8`) already carries everything; `bright`/tics are runtime gameplay data, not manifest data. (Naming note: the build script keeps a **local mirror** of this shape named `ManifestFrame` at `scripts/build-sprites.ts:64-71`, declared to stay in lockstep with the shared runtime `AtlasFrame`. The runtime/loader-shared type is `AtlasFrame` — that is the correct name to reference in this plan. Separately, `SpriteAtlas.actorFrame(...)` resolves a letter+rotation to an `ActorFrameRef{tex,flip,ox,oy}` (`atlasTypes`/`spriteAtlas.ts:11`) — that is the *draw ref* carrying the sliced `tex`, distinct from the placement-only `AtlasFrame`.)
- AC: `bun run build:sprites` succeeds on current WAD, fails loudly if a required letter drops. Test asserts every required `(prefix,letter)` resolves to `w>0 && h>0` and `rotated===false` for all 15 prefixes.

**B2. Bright/additive flash blit (`src/doom/engine/framebuffer.ts`).** Add `blitTextureBright(fb, tex, dx, dy, scale, boost)` next to `blitTexture` (`:198-225`): same alpha-test loop but **additively** accumulate RGB (`min(255, dst+src)` / lerp-toward-white by boost) instead of overwrite. Draw order per frame: world → gun layer (`blitTexture`) → flash layer (`blitTextureBright`) → HUD. Gate on `frame.bright`.
- AC test: over mid-grey, a yellow flash texel raises channels (additive); transparent texel leaves background unchanged.

**B3. Honor per-frame offsets — the viewmodel needs its OWN draw convention, NOT the world-billboard one.** ⚠️ Do **not** copy `screenCenterX − ox` from the billboard path (`src/doom/engine/sprites.ts:128-135`, `left = round(screenCenterX − ox*scale)`). That path assumes a **positive** hotspot offset (~half sprite width). Weapon viewmodel offsets are the opposite — **full-320-screen-relative and negative**, because Doom authors them to place the gun across the whole 320×200 view:

| frame | ox | oy | w×h |
|---|---|---|---|
| `PISG/A` | −125 | −97 | 82×92 |
| `SHTG/A` | −122 | −107 | 67×62 |
| `BFGG/A` | −95 | −106 | 130×74 |

So `screenCenterX − ox = 160 − (−125) = 285` would shove the pistol off the right edge. Use Doom's `R_DrawPSprite` math instead: `x1 = centerx + (psp->sx − 160 − leftoffset)` — `centerx (160)` and the `−160` **cancel**, leaving `x = psp->sx − leftoffset` with `psp->sx ≈ 0` = just the bob shift. At our native `VIEW_W=320`, `scale=1`:
```ts
// Weapon ox/oy are full-screen-relative negatives → the screen centre is ALREADY baked in.
// Do NOT add 160. bobX/bobY are the only render-space shifts; pspSy is the raise/lower slide (32 top..128 bottom).
const WEAPON_BASE_Y = /* calibrated, see below */ 0
function viewmodelDrawPos(ref: ActorFrameRef, bobX: number, bobY: number, pspSy: number) {
  return {
    x: Math.round(bobX - ref.ox),                              // PISG/A, bob 0 → 0 − (−125) = 125
    y: Math.round(WEAPON_BASE_Y + pspSy + bobY - ref.oy),
  }
}
```
- **Horizontal is exact and offset-driven** — no magic centre constant; the negative `ox` does the centring (PISG left edge 125, 82px wide → spans 125..206, centred ~166 ≈ screen centre 160).
- **Vertical** `WEAPON_BASE_Y` is the one free constant: pick it so a fully-raised gun (`pspSy = 32` = WEAPONTOP) rests at the bottom of the 320×160 view (the lower-40px clip mimics Doom's status-bar overlap of the 320×200 logical space), then **pin it by golden test** — do not hand-wave the magnitude. `pspSy` runs 32↔128 (`A4`/`B5`), so larger `pspSy` → lower on screen.

Rewrite `renderWeaponSprite` to resolve the frame via `atlas.actorFrame(sprite,letter,1)` → `ActorFrameRef` and `blitTexture(fb, ref.tex, x, y, 1)`.
- AC test (golden, from real `atlas.json`): `PISG/A` at bob 0 → `x = 125`; `BFGG/A` → `x = 95`; two frames with different `ox` give different `x`; **regression guard: gun left edge must be `< 160` (a value ≥ 160 means the old `160 − ox` bug came back).**

**B4. Runtime resolution + fallback (`hud.ts` + `engine.ts`).** Pass the engine's `SpriteAtlas` (loaded `engine.ts:115-119`) into `renderWeaponSprite` (`engine.ts:113`). Resolve via `atlas.actorFrame(sprite, letterOf(frame), 1)` (rot=1, viewmodels single-slot, `spriteAtlas.ts:71`):
```ts
// Same B3 convention; gun + flash share ONE anchor so the muzzle flash stays glued to the barrel.
const gun = PSP_STATES[player.gunState]
const gx = atlas.actorFrame(gun.sprite, letterOf(gun.frame), 1)
blitTexture(fb, gx.tex, bobX - gx.ox, WEAPON_BASE_Y + player.pspSy + bobY - gx.oy, 1)
if (player.flashIndex !== -1) {
  const fl = PSP_STATES[player.flashState]
  const fx = atlas.actorFrame(fl.sprite, letterOf(fl.frame), 1)
  blitTextureBright(fb, fx.tex, bobX - fx.ox, WEAPON_BASE_Y + player.pspSy + bobY - fx.oy, 1)
}
```
**Fallback:** when `atlas===null` (jsdom/headless/load-fail), fall back to existing procedural `assets.weapon` path. **Keep** `buildWeapons`/`textures.ts` builders.

**B5. Bob, raise/lower, ready-return (`hud.ts` + `player.ts`).**
- **Movement-driven bob:** track `player.bob` (0..1 smoothed move speed) in `updatePlayerMovement` from `len(delta)` (`player.ts:115`), decayed so standing still → 0; `bobPhase` advances per tic while moving. `bobX = amp*cos(angle)`, `bobY = amp*|sin(angle)|` (90° apart, figure-eight), amplitude ∝ `bob`. **No bob while still, firing, or raise/lower.**
- **Lower/raise travel:** `A_Lower`/`A_Raise` slide `pspSy` 32↔128 at 6/tic (~16 tics each way ≈ 0.46s round trip); old weapon's down-frame visible descending, new weapon's up-frame ascending — fixes "old idle stays then snaps."
- **Ready return:** `A_ReFire` returns to `<weapon>.ready` on release/empty; automatic weapons (chaingun/plasma/chainsaw) re-enter atk.

**B6. Aim model & crosshair — the viewmodel is COSMETIC, decoupled from where shots go (contract lock + tests, no behaviour change).** Doom never aims from the gun sprite; record and lock this so no later change couples render to aim:
- **Shots originate at the PLAYER, not the visible barrel.** Hitscan: `origin = player.pos`, `dir = player.angle (+ spread)` (`weapon.ts fireHitscan` → `combat.hitscan(scene, enemies, player.pos, angle, range, slope)`). Projectile: `muzzle = player.pos + dir*0.4`, `dir = fromAngle(player.angle)` (`weapon.ts:350`). The `0.4`-cell nudge only avoids self-collision — it is **not** the on-screen muzzle tip, and `bobX/bobY/pspSy` (which move the *sprite*) must never feed the shot.
- **Aim point = screen-centre on the horizon.** The engine is a flat-plane raycaster (no pitch/Z/autoaim), so the convergence point is always the horizontal centre at the horizon line. `player.bulletSlope = 0` (Phase C); only SSG perturbs slope per pellet (`<<5`).
- **No crosshair** — vanilla Doom has none and none exists in the repo (`DoomGame.tsx` only styles the host cursor). Keep it absent (optional reticle is an explicit deviation, see §5).
- **Contract test:** moving `player.pos`/`player.angle` moves the hitscan & projectile origin/direction; changing `bobX/bobY/pspSy` (gun shake, raise/lower) leaves origin/direction byte-identical. This is the guardrail against "aim from the muzzle" creeping in with the new viewmodel.

**Acceptance (Phase B):**
- **Aim stays decoupled (B6):** shot origin tracks `player.pos`/`angle` only; viewmodel bob/raise/lower never shift the shot; no crosshair added.
- With atlas present, every weapon's first-person view is the real Freedoom sprite anchored by its own `ox/oy`.
- Firing plays the exact canonical frame/tic chain (golden traces); flash is a separate bright overlay during its own chain only; fist/chainsaw have no flash.
- Switching lowers then raises with correct down/up frames, no snap.
- Bob is movement-driven; recoil/raise/lower suppress it. **Concrete AC:** with `|delta| == 0` for ≥ `BOB_DECAY_TICS` (name the smoothing constant, e.g. an exponential decay `bob *= BOB_DECAY` per tic toward 0), `player.bob == 0` and `bobX == bobY == 0`; while moving at full speed `bob → 1` and `bobX/bobY` trace the 90°-apart figure-eight (amplitude ∝ `bob`); during `firing`/`raising`/`lowering`, `bobX == bobY == 0` regardless of `|delta|`.
- Timing tic-accurate at 35Hz regardless of 60Hz loop; deterministic (seeded RNG for plasma flash; no wall-clock).
- Headless/no-atlas falls back to procedural; all gates green.

**Files (Phase B):** `scripts/build-sprites.ts`, `src/doom/engine/framebuffer.ts`, `src/doom/ui/hud.ts` (+ optional `src/doom/ui/viewmodel.ts`), `src/doom/engine.ts`, `src/doom/game/player.ts` (bob source), `src/doom/game/weaponStates.ts`, `src/doom/engine/sprites/spriteAtlas.ts` (consumer).

---

### Phase C — Hitscan weapons (Pistol, Shotgun, Super Shotgun, Chaingun)

**Goal.** Faithful `p_pspr.c`/`p_map.c`: first-shot accuracy via `refire`, triangular `(R−R)` spread shifts, correct pellet counts, SSG distance-aware vertical scatter (delete the miss-hack), canonical `5*((rnd%3)+1)` damage.

**C1. Spread/damage helpers (`src/doom/game/weapon.ts`).** Add `rndByte`, `rndDiff`, `BAM_TO_RAD`, `spreadRad(rng,shift)`, `rollHitscanDamage(rng) = 5*((rndByte%3)+1)` (§1.3). Per-weapon fields: pistol/shotgun/chaingun `spreadShift:18`; SSG `spreadShift:19`; pistol/chaingun `firstShotAccurate:true`; SSG `verticalSlopeShift:5`. pellets pistol 1 / shotgun **7** / SSG **20** / chaingun 1.

**C2. Refire counter.** `refire` already lives on the psprite engine as `refireCount` (Phase A). The `fire` action computes `accurate = def.firstShotAccurate === true && refireCount === 0`. (Pistol edge-trigger resets `refireCount` between presses → every deliberate press is accurate; chaingun held keeps `refireCount>0` and opens the cone after shot 1 — matches Doom.)

**C3. Rewrite `fireHitscan` (`weapon.ts:317-340`).**
```ts
function fireHitscan(player, scene, enemies, def, rng) {
  let hitAny = false
  const shift = def.spreadShift ?? 18
  const accurate = def.firstShotAccurate === true && player.refireCount === 0
  const baseSlope = player.bulletSlope   // 0 for now (Task C4)
  for (let i = 0; i < def.pellets; i++) {
    const angle = accurate && def.pellets === 1 ? player.angle : player.angle + spreadRad(rng, shift)
    const slope = def.verticalSlopeShift !== undefined
      ? baseSlope + rndDiff(rng) * (1 << def.verticalSlopeShift) * SLOPE_UNIT
      : baseSlope
    const r = hitscan(scene, enemies, player.pos, angle, def.range, slope)
    if (r.hitEnemy) { const e = enemies[r.enemyIndex]; if (e) { damageEnemy(e, rollHitscanDamage(rng), rng); hitAny = true } }
  }
  return hitAny
}
```
Multi-pellet weapons (`pellets!==1`) **never** use the accurate path (shotgun/SSG always spread). Delete the old `verticalSpread` `continue`-miss branch.

**C4. SSG vertical spread — add slope to `hitscan` (restPln.md #8, Option B).** Do **not** add per-entity Z (renderer/AI/collision-wide, out of scope). Give `hitscan` (`combat.ts:88-132`) an optional trailing `slope=0` and an analytic vertical gate against an assumed half-height:
```ts
export function hitscan(scene, enemies, origin, angle, range, slope = 0): HitscanResult {
  // ... existing wall + planar enemy projection ...
  if (perp <= ENEMY_HIT_RADIUS) {
    const vertOffset = Math.abs(slope) * along           // NEW vertical gate
    if (vertOffset <= ENEMY_HALF_HEIGHT) { bestIndex = i; bestDist = along }
  }
}
```
`slope===0` (every non-SSG caller) → `vertOffset===0` always passes → identical behaviour (safe additive change). Constants: `ENEMY_HALF_HEIGHT ≈ 0.44` cells (≈56u mobj half-height) in `config.ts`; `SLOPE_UNIT` in `weapon.ts` is an **engine-chosen mapping constant, NOT an id-source value** — canon only specifies the literal `bulletslope + ((P_Random()−P_Random())<<5)`; the `<<5`→degrees relation is a nonlinear, distance-dependent approximation (~±7° at typical range). We pick `SLOPE_UNIT ≈ 1.47e-5` so `255*(1<<5)*SLOPE_UNIT ≈ 0.1199` max rise/run, then **pin it by test** — do not present the `0.12` magnitude as if it came from the original source. `player.bulletSlope` new field = **0** always (no pitch/autoaim) — only SSG perturbs it per pellet; storing it on `player` keeps the door open for real autoaim (deferred Option C). Delete `verticalSpread` from SSG def + `WeaponDef`; update `weapon.ts` header comment; mark `restPln.md` #8 resolved (Option B, full Z deferred).

**C5. Cadence** is handled by the Phase A tic engine; the §1.2 chains give chaingun 4 tics/shot (~8.75 rps), shotgun 44, SSG 62, pistol **19** (4+6+4+5). (The interim `fireTics/35` quantum from the hitscan draft — including its unsourced "~15 tic" pistol figure — is **superseded** by the full psprite engine; there is no separate `SWITCH_TIME` quantum and no `fireTics`.)

**Acceptance (Phase C):**
- Damage roll ∈ {5,10,15} only; `count(5) >= count(10) >= count(15)` (the `%3` bias, gap <1%).
- `shift=18` bound `≤0.09818 rad`; `shift=19` `≤0.19636 rad`, SSG max > shotgun max × 1.9. Triangular shape: `count(|a|<0.02) > count(0.06<|a|<0.08)`.
- Pistol `refire=0` → exact `player.angle` every time; `refire=1` → spread. Shotgun/SSG `refire=0` → spread on all pellets.
- Pellet calls: pistol/chaingun 1, shotgun 7, SSG 20; SSG consumes 2 shells.
- `hitscan(...,slope=0)` byte-identical to old 5-arg; `|slope|*along > ENEMY_HALF_HEIGHT` → miss; SSG point-blank lands ≥18/20, far lands fewer (`nearHits > farHits`); `WEAPONS.superShotgun` has no `verticalSpread`, has `verticalSlopeShift===5`.

**Files (Phase C):** `src/doom/types.ts`, `src/doom/config.ts` (`ENEMY_HALF_HEIGHT`), `src/doom/game/combat.ts` (`hitscan` slope), `src/doom/game/weapon.ts`, `src/doom/game/player.ts` (`bulletSlope:0`), `restPln.md`.

---

### Phase D — Melee weapons (Fist, Chainsaw, Berserk)

**Goal.** Faithful `A_Punch`/`A_Saw`: the two corrections — **(1) chainsaw does NOT get berserk ×10**, **(2) chainsaw pulls the player toward the target with no recoil** — plus idle/rip sound and viewmodel hookup. Mechanic constants are already correct; close the state-machine/feel/sound/wiring gaps.

**D1. Fist (`A_Punch`).** Keep `damage {sides:10, mul:2, berserkBoost:true}` (2..20, ×10 berserk → 20..200); keep `automatic:false`; keep `ammo:null`/`ammoPerShot:0` (never dry-fires). Cadence from PUNG chain (22 tics, `A_Punch` on PUNCH2 = the C frame). `fireMelee` (`weapon.ts:287-309`) reads `def.damage.berserkBoost === true && player.berserk === true` — only the fist satisfies both. Angle wiggle `±0.098` (`<<18`).

**D2. Chainsaw (`A_Saw`).** Keep `damage {sides:10, mul:2}` with **no** `berserkBoost` key (lock with regression test). `automatic:true`, continuous ~4 tics/bite (~8.75 bites/s). `ammo:null`/`ammoPerShot:0`. Wiggle `±0.098`.

**D3. Chainsaw pull (no recoil).** Add `meleePull:true` to chainsaw def (and `WeaponDef.meleePull?`). Extend `FireOutcome` with `pull?: Vec2`. In `fireMelee`, when `def.meleePull && enemy hit`, return `pull = normalize(enemy.pos − player.pos)`. In `world.ts updateWeaponPhase`, after a successful fire with `outcome.pull`, nudge via collision: `const SAW_PULL = 0.18` (cells/bite); route through `moveWithCollision`/`PLAYER_RADIUS` (expose a `nudgePlayer` helper in `player.ts` so world doesn't import collision). **No backward recoil** for either melee weapon (none exists; keep + comment).

**D4. Chainsaw sound (`src/doom/audio/sfx.ts` + `engine.ts`).** Add `'sawIdle'` (quiet low buzz) and `'sawHit'` (gritty bite) to `SfxName`; keep `'chainsaw'` generic. Add `WorldEvents.weaponIdle: 'chainsaw' | null` set when `currentWeapon==='chainsaw' && weaponState==='ready' && !held`. In `playEventSounds` (`engine.ts:242-247`) map `ev.fired==='chainsaw'` → `sawHit`, gate `sawIdle` on a "was idling" latch (engine-side, throttled — keeps the sim audio-free).

**D5. Viewmodel hookup.** Fist PUNG: idle A, fire `[B,C,D,C,B]` (hit on C/PUNCH2). Chainsaw SAWG: animated idle C↔D (extend `WeaponVisual` with optional `idleFrames?`), fire `[A,B]`. Both obey the Phase A/B raise/lower + "cannot fire mid-raise" gate (key on `'ready'` only). Berserk auto-switch (`giveBerserk` `player.ts:251` → `requestWeapon('fist')`) animates the raise (PUNCHUP), no instant pop. Berserk is level-long (no timer — `tickPlayerTimers` `player.ts:263-276` intentionally doesn't decay it).

**Acceptance (Phase D):** punch ∈ {2..20} / {20..200} berserk; saw stays {2..20} under berserk and `WEAPONS.chainsaw.berserkBoost === undefined`; fist never reports OUT OF AMMO; saw pull closes the gap (collision-capped, no overshoot), whiff = no movement, fist never pulls; idle buzz vs rip cadence swaps within ~1 frame; berserk raises the fist visibly.

**Files (Phase D):** `src/doom/game/weapon.ts`, `src/doom/types.ts` (`meleePull?`, `FireOutcome.pull`, `WeaponVisual.idleFrames?`), `src/doom/game/world.ts`, `src/doom/game/player.ts` (`nudgePlayer`), `src/doom/audio/sfx.ts`, `src/doom/engine.ts`, `src/doom/ui/hud.ts`.

---

### Phase E — Projectile weapons (Rocket, Plasma, BFG9000)

**Goal.** Close the documented gaps vs canon: de-duplicate projectile damage, align/document splash, model the plasma release pause + alternating flash, hoist BFG spray constants, and fix the **one real BFG bug** (spray origin). The planar/no-Z/normal-PRNG simplifications stay (sanctioned).

**E1. Rocket — de-duplicate direct damage (`weapon.ts`).** Add `const PROJECTILE_DAMAGE_SIDES = 8`; in `fireProjectile` (`:351`) `const dmg = rollDamage(rng, PROJECTILE_DAMAGE_SIDES, pdef.base)`. Make rocket/plasma/bfg WeaponDef `damageSides/damageMul/range` optional and **delete** them from the three projectile entries (single source = `PROJECTILE_DEFS.base`, which stays 20/5/100). Grep shows the `8` literal gone; outputs 20..160 / 5..40 / 100..800 unchanged.

**E2. Rocket — document + wire splash.** First, locate the pieces precisely: `applySplash` (`world.ts:469`) only **iterates targets** (enemies + player, LOS gate, `splashImmune` skip) and calls `splashDamage(center, target.pos, target.radius)` per target; the **peak `128` and the `128 − distUnits` falloff live in `combat.splashDamage` (`combat.ts:140-152`, the `const dmg = 128 - distUnits` at `:148`, clamped to `[0,128]`)**, keyed on the **target's own radius** (`def.radius` / `PLAYER_SPLASH_RADIUS`), not on the rocket. Add the deviation doc-comment on **`combat.splashDamage`** (where the geometry actually is): canon `P_RadiusAttack` uses octagonal `P_AproxDistance (max+min/2)` with peak 128; we use Chebyshev `max(|dx|,|dy|)·64 − radius·64` — same peak 128, same `128 − dist` falloff, same shooter self-damage (`applySplash:484`), same LOS gate, same Cyber/Spider immunity (`applySplash:475`). On `splashCells`: it is currently only a **gate** (`world.ts:409`: `if (pdef.splashCells !== undefined) applySplash(...)` — it decides *whether* a projectile splashes, not the reach). To make the magic 128 data-driven, thread a peak/radius parameter through **`combat.splashDamage`** (e.g. `splashDamage(center, target, targetRadius, peak = 128)`), feeding `peak` from `PROJECTILE_DEFS.rocket` (and keep `splashCells` as the on/off gate, or rename it to a real `splashPeakUnits`/`splashCells` reach driving `peak = splashCells*64`). Test: a smaller peak/reach halves the blast radius. **Keep Chebyshev** (`P_AproxDistance` is opt-in polish only).

**E3. Plasma — release pause + alternating flash.** Plasma held cadence (3-tic) and the 20-tic `S_PLASMA2` release pause are both expressed natively by the Phase A psprite chain (no `releaseDelay` hack needed once the full chain is in). The held rate is **`35/3 ≈ 11.67 shots/s (700/min)`**, derived from `A_ReFire` short-circuiting back to `S_PLASMA1` while +attack is held so the 20-tic `S_PLASMA2` is never traversed under sustained fire (see the §1.2 derivation note and `doomBehaviorSpec.md:354`); a tap-then-tap that *releases* on `S_PLASMA2` instead plays out the ~0.571s settle. **This 11.67/s is pinned by a golden held-fire trace (Phase B / `weapon-states.test.ts`), not asserted blind.** Alternating muzzle flash: the `fire` action sets the flash layer to `flashstate + (rng()<0.5 ? 1 : 0)` (deterministic `this.rng`) → PLSF A/B; cosmetic, no damage impact. (If kept on the legacy single-`fireDelay` model interim, add `WeaponDef.releaseDelay?=0.571` and document — superseded by the psprite chain.)

**E4. BFG — hoist constants (`world.ts`).** Replace literals with named consts co-located with BFG tuning:
```ts
const BFG_SPRAY_RAYS = 40
const BFG_SPRAY_FAN  = Math.PI / 2     // ±45°, 2.25°/ray
const BFG_SPRAY_RANGE = 16             // cells (1024u)
const BFG_SPRAY_ROLLS = 15
const BFG_SPRAY_DICE  = 8              // each ray = Σ15 of (1+floor(rng*8)) → 15..120, mean ≈ 67.5
```
Replace the `for(r<15)`/`floor(rng*8)` literals (`:618-620`).

**E5. BFG — spray from PLAYER's current position (the real bug).** Canon `A_BFGSpray` originates rays at `mo->target` (the player) — **now** — not the ball/impact point. `fireBfgSpray` (`world.ts:604`) currently uses stale `proj.originPos` (fire-time muzzle):
```ts
private fireBfgSpray(proj) {
  const origin = this._player.pos                      // ← was proj.originPos (the bug)
  const baseAngle = proj.originAngle ?? Math.atan2(proj.vel.y, proj.vel.x)  // FROZEN at fire time (keep)
  const start = baseAngle - BFG_SPRAY_FAN / 2
  for (let i = 0; i < BFG_SPRAY_RAYS; i++) {
    const angle = start + i * (BFG_SPRAY_FAN / BFG_SPRAY_RAYS)
    const r = hitscan(this, this.enemies, origin, angle, BFG_SPRAY_RANGE)
    if (!r.hitEnemy) continue
    const e = this.enemies[r.enemyIndex]; if (!e) continue
    let dmg = 0
    for (let k = 0; k < BFG_SPRAY_ROLLS; k++) dmg += 1 + Math.floor(this.rng() * BFG_SPRAY_DICE)
    damageEnemy(e, dmg, this.rng)
  }
}
```
Keep the frozen `originAngle` (faithful — turning after firing doesn't swing the cone). `proj.originPos` may become unused for BFG; keep the `originAngle` write in `spawnProjectile` (`projectile.ts:99-100`, where `originPos`/`originAngle` are set together inside the `def.bfgSpray === true` branch).

**E6. BFG — confirm ball + cost + optional puff.** Ball direct via `applyProjectileImpact` → `rollDamage(8,100)` = 100..800 (keep); `ammoPerShot=40` (keep); refuses under 40. (Accepted simplification: cells debit at `tryFire` not at `A_FireBFG`/`S_BFG3` ~30 tics in — comment it; charge-window refund deferred — though the Phase A psprite chain makes the per-state debit feasible as a follow-up.) **Optional cosmetic** `MT_EXTRABFG` (`BFE2`) green puff per raked enemy, gated behind atlas presence; defer if no transient-decal system.

**Acceptance (Phase E):**
- Direct rolls: rocket 20..160 (×20), plasma 5..40 (×5), bfg 100..800 (×100); ammo debits 1/1/40, refuses when short.
- Rocket splash: epicenter 128; enemy at ≥128u → 0; LOS-blocked → 0; shooter self-damages within 128u; direct-hit enemy takes roll + ~128; Cyber/Spider 0 splash but full direct.
- BFG spray: up to 40 rays ±45° around **fire-time** facing from the **player's spray-time** position, 16-cell reach; each connecting ray ∈ [15,120], mean ≈ 67.5; turning after firing doesn't rotate the cone; an enemy that only lines up from the moved position gets hit (proves E5).

**Files (Phase E):** `src/doom/game/weapon.ts`, `src/doom/game/projectile.ts`, `src/doom/game/world.ts`, `src/doom/game/combat.ts` (`splashDamage` radius), `src/doom/types.ts` (optional dead-field removal), `doomBehaviorSpec.md`/`restPln.md` (doc cross-links).

---

## 4. Test & verification plan

All unit tests use a seeded `mulberry32(SEED)` for determinism; assert over large samples. Gates already in repo: `bun run check` (`tsc --noEmit && biome check && eslint . --max-warnings 0`), `bun run test` (vitest), `bun run e2e` (playwright, self-hosts build+preview); pre-commit hook runs biome + tsc + jscpd (target 0% dup on new code).

**Shared infrastructure (`weapon`/`player` unit, Phase A):**
- **Ammo regression:** assert caps `200/50/50/300`, ×2 backpack (`400/100/100/600` + clips `10/4/20/1`), and the 9 `ammoPerShot` (SSG 2 / BFG 40) against a hardcoded canon table.
- **Cadence:** drive `updateWeapon` with `dt=1/35` ticks; gun reaches `ready` after exactly `sum(atk tics)` and not before; `fireDelaySeconds(def)` per weapon within ±1 tic.
- **Refire loop:** `attack=true` continuous → `fire` runs once per chain cycle (ammo decrements over N tics = N/cycleTics); `attack=false` at refire → falls through to ready.
- **Accuracy:** deterministic RNG, spy/mock `hitscan` angle — pistol first shot spread 0, chaingun first two 0, later non-zero.
- **Raise/lower:** `requestWeapon` while ready → `weaponState` `lowering`→(commit at bottom)→`raising`→`ready`; `currentWeapon` flips only at bottom; fire action is a no-op during lower/raise.
- **Slot/cycle:** fist+chainsaw → `weaponBySlot(1)` toggles; shotgun+SSG → slot 3 toggles; `nextOwnedWeapon` walks slot order + wraps.
- **Auto-switch:** empty pistol owning shotgun+shells → `requestWeapon('shotgun')`; nothing armed → `'OUT OF AMMO'`, no switch. Higher-rank pickup → `pendingWeapon` set; lower-rank pickup while holding better → no switch.

**Viewmodel frame-timing (`weapon-states.test.ts`, Phase B):**
- Golden `(sprite,frame,cumulative-tic)` traces per weapon from each `atk` head (pistol A(4)→B(6,fires)→C(4)→B(5,refire); SSG full open/load/close; chaingun A/B with matching flash; BFG 20-tic wind-up before ball).
- 0-tic states (`S_SAW3`/`S_CHAIN3`/`S_MISSILE3`) consume zero tics (same-tic fallthrough).
- Flash layer non-null only across its chain, reset to `-1`/null at `S_LIGHTDONE`; `extralight` returns to 0. Chaingun flash letter = barrel frame; plasma seeded RNG picks expected A/B.
- `viewmodelDrawPos` golden offsets for `PISG/A`, `BFGG/A`; different `ox` → different `x`. `blitTextureBright` additive over grey; transparent leaves background.
- Determinism: same seed + same input script ⇒ identical state trace (no wall-clock).

**Hitscan (`weapon.spec.ts` + `combat.spec.ts`, Phase C):** damage distribution {5,10,15} with `count(5)>=count(10)>=count(15)`; spread bounds + triangular shape; first-shot accuracy; pellet counts 1/7/20/1; `hitscan(...,slope=0)` regression-identical; SSG slope gate near vs far (`nearHits>=18`, `nearHits>farHits`).

**Melee (`weapon.melee.test.ts`, Phase D):** fist {2..20}/{20..200}; saw {2..20} under berserk + `berserkBoost===undefined`; no-OUT-OF-AMMO invariant; range gate at `MELEE_RANGE±`; continuous-fire cadence ~`SAW_TICS`; saw pull closes gap (collision-bounded) / whiff no-move; `giveBerserk` heals to MAX + level-long; viewmodel mapping (`fist.fire.length===5`, `chainsaw.idleFrames?.length===2`).

**Projectile/BFG (`world` + `weapon.projectile` vitest, Phase E):** damage bounds + multiples + ammo debit/refuse; rocket-splash-self (shooter HP drops, enemy >128u and LOS-blocked take 0); rocket-direct-double (≥20+~128); splash-immune Cyberdemon (0 splash, full direct); BFG frozen-angle (enemy in original cone hit, new-facing enemy not); BFG origin-current (enemy lining up only from moved position is hit); BFG per-ray bounds [15,120], mean ≈ 67.5.

**E2E (playwright, existing gates):** `KeyW`/`ArrowLeft`/`Space` move/turn/fire and the frame keeps changing (`ARCHITECTURE.md §6`); new weapons switch (`spritePlan.md §11`); select slots 5/6/7, fire each, viewmodel frame changes and (rocket/bfg) a nearby barrel/enemy dies from splash/spray; optional on-screen-gun screenshot diff.

**Existing parity (`world` integration):** "spawn → fire kills enemy" and "shotgun = N pellets" (`ARCHITECTURE.md §6`) still pass unchanged — proving Phase A is behaviour-neutral for the shipped path.

**Determinism of `build:sprites`:** `bun run build:sprites` is reproducible on the gitignored WAD; the Phase B coverage gate fails loudly if any required `(prefix,letter)` drops.

---

## 5. Risks & explicitly-deferred simplifications

**Scope calls made in this plan:**
- **SSG vertical spread (Option B, not full Z).** We add a `slope` param + analytic half-height gate to `hitscan` (`ENEMY_HALF_HEIGHT≈0.44`) instead of giving every `Enemy` a real `z`/`height` and the `Player` a `pitch`. Full per-entity Z + autoaim (`P_BulletSlope`) would touch renderer, AI, collision, and every spawn — disproportionate for one weapon. `player.bulletSlope` is stored (=0) to keep the door open for real autoaim later (Option C). **Deferred:** real vertical aim / pitch / autoaim slope / shooting over low obstacles / projectile Z-arc — the engine stays a flat-plane raycaster (sanctioned, `doomBehaviorSpec.md §4`).

**Explicitly deferred / kept-as-simplified (do NOT implement here):**
- **Chebyshev splash** kept by design vs canon `P_AproxDistance` octagon (same peak 128, same falloff); `P_AproxDistance` is opt-in polish only. Self-damage thrust/knockback (momz) not modelled.
- **Normal PRNG, not Doom's 256-entry `rndtable`** — damage *distributions* match, exact replayable sequences do not (no demo-compat). BFG per-ray realized range is 15–120 (ours) vs 49–87 (vanilla LUT) — accepted.
- **BFG cell debit timing:** cells spent at `tryFire`/fire-action, not at `A_FireBFG` (`S_BFG3`, ~30 tics after charge); the mid-charge refund is deferred (feasible follow-up now that Phase A has a per-state chain).
- **Plasma `(P_Random&1)` flash alternation** and chaingun flash-by-frame are visual-only, modelled to the end effect with the seeded RNG.
- **Angles in degrees/radians, not raw BAM math** (spreads converted: ±5.6°, ±11.25°, 2.25°/ray) — equivalent values, not bit-shift math at runtime (we do convert `<<18`/`<<19`/`<<5` via `BAM_TO_RAD`/`SLOPE_UNIT`, pinned by test).
- **60Hz sim, 35Hz tic logic** bridged by `ticAccumulator` — durations preserved in real seconds, logic on the tic step; deterministic for tests (`dt=N/35`).
- **Single baseline difficulty** — no ITYTD ×2 ammo, no `-fast` doubled monster fireballs.
- **Inverse-palette / other out-of-scope render items** (not part of the weapon viewmodel) — untouched.
- **No crosshair; muzzle-origin is the player, not the visible barrel** — faithful to vanilla (shots from `player.pos` along facing, aim = screen-centre/horizon, gun sprite cosmetic; see Phase B6). Deferred deviations if ever wanted: an optional crosshair reticle, a true muzzle-tip projectile origin, and real vertical aim/pitch (the last is the same Option C deferral as SSG vertical spread).
- **From `restPln.md`:** SSG #8 marked resolved (Option B, full Z deferred); monster-side weapon approximations (Revenant 100%-homing vs ~25% home-eligible #6, probabilistic `A_*Refire` cadences as fixed cooldowns, Mancubus 6-fan in one tic, Cyberdemon 3-rocket burst, Arch-vile fire 0–70 single-target falloff + faked momz #13) are **monster** behavior and explicitly **out of this weapon plan's scope**.

**Risks to guard:**
- **The two melee corrections are easy to "fix" wrongly** — a contributor will be tempted to add `berserkBoost` to the chainsaw or round `MELEE_RANGE` to 1.0; both wrong. The Phase D comment block + regression tests are the guardrails.
- **`FireOutcome.pull`, `WeaponVisual.idleFrames`, optional `WeaponDef` fields** are additive optionals — keep them optional so existing defs/assets compile unchanged.
- **Saw pull must go through `moveWithCollision`/`PLAYER_RADIUS`** — a raw `player.pos +=` would drag the player through walls.
- **Idle-saw sound throttling lives in the engine** (a "was idling" latch), never in `world.update` — the deterministic sim stays audio-state-free.
- **Phase A is a hard prerequisite** — do not start Phase C/D/E mechanics edits until the table + cadence engine + selection PR is merged; downstream depends on stable `WeaponDef`/`WeaponStateChain` shapes, `tickPsprite` dispatch, `weaponBySlot`/`nextOwnedWeapon`, `pickBestArmedWeapon`, `WeaponInput`.
