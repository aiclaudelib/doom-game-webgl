# Doom Behavior Specification — Canonical Gameplay Source of Truth

## 1. Intro

**Purpose.** This document is the single source of truth for the **gameplay phase** of `spritePlan.md`. It pins down the *behavior* of every Doom II entity (monsters, weapons, projectiles, pickups/powerups, props) with exact canonical numbers, so that the implementation in `src/doom/game/*` can be built and verified against real Doom rather than guessed approximations.

**Source provenance.** Every value here is verified against id Software's original **linuxdoom-1.10** source — `info.c` (the `mobjinfo[]` stat table and `states[]` tic/frame table), `p_enemy.c` (monster action functions), `p_pspr.c` (player weapon action functions), `p_map.c` (`PIT_CheckThing` projectile-impact damage and `PIT_RadiusAttack` splash), `p_inter.c` (pickups), `p_user.c` (powerup tick), and `doomdef.h` (powerup durations) — cross-checked against the [Doom Wiki](https://doomwiki.org). Source URLs are cited per entity. Where the canonical value contradicts a common myth (e.g. "Lost Soul never flinches"), the correct source-verified value is used and the myth is flagged.

**Art vs. behavior.** **Art comes from Freedoom** (free, GPL-compatible sprite/sound replacements that map 1:1 onto Doom's sprite-prefix / frame-letter scheme). **Behavior is canonical Doom**, derived from `info.c` / Doom Wiki as above. The Freedoom sprite for `TROO` looks different from id's imp, but it lives at the same lump name and animates with the same state table — so this spec drives logic, Freedoom drives pixels.

**Timebase conventions (apply everywhere).**
- Doom playsim runs at **35 tics/second**. This engine runs a **fixed 1/60 s sim step**. Both are noted explicitly throughout.
- **Durations:** convert tics → seconds as `tics / 35` (e.g. `reactiontime` 8 tics = 0.229 s; fire cadence is `ticCount/35` s — *not* `/60*`). For powerup timers, convert by **real seconds**, then to frames at 60 Hz (30 s invuln = 1800 frames, *not* 1050).
- **Projectile speed:** `info.c` stores missile `speed` as `N*FRACUNIT` = N map units **per tic** ⇒ units/sec = `N*35`. Per 60 Hz step, multiply units/sec by `1/60`.
- **Monster WALK speed:** do **not** use `speed*35`. Use the Doom-Wiki units/sec figures (a monster moves its `speed` value once per See-state transition, and walk states span multiple tics). Authoritative cruise = `speed * 35 / (run-state tic count)`.
- **Units:** 1 floor cell = 64 map units; pick a units-per-cell `S` (S=64 if a cell = one 64u texture tile). Convert ranges/radii by `1/S`. Radii: 16u=0.25, 20u=0.31, 24u=0.38, 30/31u≈0.47/0.48, 40u=0.63, 48u=0.75, 64u=1.0, 128u=2.0 cells.
- **Pain:** `painchance` is 0–255; per-hit flinch probability = `painchance/256`, rolled `P_Random() < painchance`.
- **P_Random()** is a *fixed 256-entry table* (deterministic), returning 0–255; `(P_Random()-P_Random())` ∈ −255..255. We may use a real RNG (see §4).
- **MELEERANGE** = 64u (1 cell). **MISSILERANGE** (hitscan) = 2048u (32 cells, effectively whole level). **BFG tracer range** = 1024u (16 cells).
- **Projectile impact damage** (universal, `PIT_CheckThing`): `damage = ((P_Random()%8)+1) * missile.info.damage`. The random factor is always 1..8; the per-missile multiplier is the `damage` field.
- **Engine target modules:** monsters → `src/doom/game/enemy.ts` (`ENEMY_DEFS`, `spawnEnemy`, `updateEnemy`, `damageEnemy`); weapons → `weapon.ts` (`WEAPONS`, `tryFire`); projectiles → `projectile.ts` (`spawnProjectile`, `updateProjectile`); hitscan/LOS → `combat.ts` (`hitscan`, `lineOfSight`); pickups → `pickup.ts` (`applyPickup`); player state → `player.ts`. Current kinds are a simplified subset (`EnemyKind = grunt|imp|demon`, `WeaponKind = fist|pistol|shotgun|chaingun`, `AmmoKind = bullets|shells`, `ProjectileKind = fireball`) — this spec defines the full target set to grow into.

---

## 2. Coverage Matrix

The master checklist — every documented entity, proving nothing is missed. "Target module" is where the behavior lands in the engine.

### Monsters (17)

| Entity | Sprite | Type | Core correct behavior (1 line) | Target module |
|---|---|---|---|---|
| Zombieman | POSS | hitscan infantry | 1 rifle bullet 3–15, painchance 200, cruise 70 u/s; drops clip(5) | `enemy.ts` (`grunt` exists) |
| Shotgun guy | SPOS | hitscan infantry | 3-pellet burst 9–45, painchance 170, cruise 93.3 u/s; drops 8 shells | `enemy.ts` (new kind) |
| Heavy weapon dude | CPOS | hitscan infantry | single bullets in ~2-shot bursts via A_CPosRefire (40/256 continue), 3–15 each | `enemy.ts` (new) |
| Imp | TROO | melee+projectile | claw 3–24 or fireball MT_TROOPSHOT 3–24, painchance 200 | `enemy.ts` (`imp` exists) |
| Demon (Pinky) | SARG | melee bruiser | bite 4–40, HP150, fastest grounder 175 u/s | `enemy.ts` (`demon` exists) |
| Spectre | SARG | melee bruiser (fuzz) | Demon clone + MF_SHADOW fuzz render | `enemy.ts` (new) + fuzz shader |
| Lost Soul | SKUL | flying charger | charge 700 u/s, contact 3–24, painchance 256 (flinches always), no corpse | `enemy.ts` (new) |
| Cacodemon | HEAD | flying ranged | bite 10–60 or ball MT_HEADSHOT 5–40, floats, HP400 | `enemy.ts` (new, flying) |
| Hell Knight | BOS2 | bruiser ranged | claw 10–80 or MT_BRUISERSHOT 8–64, HP500, no infight w/ Baron | `enemy.ts` (new) |
| Baron of Hell | BOSS | bruiser ranged (boss) | same as Hell Knight, HP1000 | `enemy.ts` (new) |
| Pain Elemental | PAIN | skull-spawner | spits charging Lost Souls (cap >20), +3 on death, floats | `enemy.ts` (new) + spawn cap |
| Revenant | SKEL | hybrid + homing | homing MT_TRACER 10–80 (~25% home) or fist 6–60, HP300 | `enemy.ts` (new) + homing proj |
| Mancubus | FATT | multi-projectile | 6× MT_FATSHOT 8–64 in a fan, HP600, slow | `enemy.ts` (new) |
| Arachnotron | BSPI | plasma stream | rapid MT_ARACHPLAZ 5–40 via A_SpidRefire, HP500 | `enemy.ts` (new) |
| Arch-vile | VILE | special | LOS fire attack flat 20 + splash 0–70, resurrects corpses, HP700 | `enemy.ts` (new) + resurrection |
| Cyberdemon | CYBR | boss | 3× MT_ROCKET 20–160 + splash, splash-IMMUNE, HP4000 | `enemy.ts` (new) + immunity flag |
| Spider Mastermind | SPID | boss | 3-bullet hitscan burst 9–45 sustained, splash-IMMUNE, HP3000 | `enemy.ts` (new) + immunity flag |

(17 monster rows including Spectre and Lost Soul.)

### Weapons (9)

| Entity | Sprite | Type | Core correct behavior (1 line) | Target module |
|---|---|---|---|---|
| Fist | PUNG | melee | 2–20 (×10 berserk → 20–200), MELEERANGE 64u | `weapon.ts` (`fist` exists) + `combat.ts` |
| Chainsaw | SAWG | melee | 2–20, ~4 tics/hit, pulls toward target, infinite ammo | `weapon.ts` (new) |
| Pistol | PISG | hitscan | 5/10/15, 1 bullet, first shot accurate, 150/min held | `weapon.ts` (`pistol` exists) |
| Shotgun | SHTG | hitscan | 7 pellets 5/10/15 each, 1 shell, 44-tic cycle | `weapon.ts` (`shotgun` exists) |
| Super Shotgun | SHT2 | hitscan | 20 pellets, 2 shells, H+V spread, 62-tic cycle | `weapon.ts` (new) + vertical spread |
| Chaingun | CHGG | hitscan | 5/10/15, 4 tics/shot, first 2 accurate | `weapon.ts` (`chaingun` exists) |
| Rocket Launcher | MISG | projectile | MT_ROCKET 20–160 + 128u splash, 1 rocket | `weapon.ts` (new) + `projectile.ts` + splash |
| Plasma Rifle | PLSG | projectile | MT_PLASMA 5–40, 3 tics/shot, 1 cell | `weapon.ts` (new) + `projectile.ts` |
| BFG9000 | BFGG | projectile+spray | MT_BFG ball 100–800 + 40-ray spray, 40 cells | `weapon.ts` (new) + spray + `projectile.ts` |

### Projectiles (10)

| Entity | Sprite | Type | Core correct behavior (1 line) | Target module |
|---|---|---|---|---|
| Imp fireball | BAL1 | enemy missile | 350 u/s, impact 3–24 | `projectile.ts` (`fireball` exists) |
| Cacodemon ball | BAL2 | enemy missile | 350 u/s, impact 5–40 | `projectile.ts` (new) |
| Bruiser shot | BAL7 | enemy missile | 525 u/s, impact 8–64 (Baron+Knight) | `projectile.ts` (new) |
| Revenant tracer | FATB | homing missile | 350 u/s, impact 10–80, ~16.875°/turn homing | `projectile.ts` (new) + homing |
| Mancubus ball | MANF | enemy missile | 700 u/s, impact 8–64 (6/cycle) | `projectile.ts` (new) |
| Rocket | MISL | player/cyber missile | 700 u/s, direct 20–160 + 128u Chebyshev splash | `projectile.ts` (new) + splash |
| Plasma | PLSS | player missile | 875 u/s, impact 5–40 | `projectile.ts` (new) |
| Arachnotron plasma | APLS | enemy missile | 875 u/s, impact 5–40 (= plasma) | `projectile.ts` (new) |
| BFG ball | BFS1 | player missile+spray | 875 u/s, direct 100–800; spray = 40 hitscans | `projectile.ts` (new) + spray |
| Arch-vile fire | FIRE | special anchor | not a flying missile; LOS hit (see Arch-vile) | `enemy.ts` (handled in vile logic) |

### Pickups & Powerups (33)

| Entity | Sprite | Type | Core correct behavior (1 line) | Target module |
|---|---|---|---|---|
| Stimpack | STIM | health | +10, cap 100, refused if ≥100 | `pickup.ts` |
| Medikit | MEDI | health | +25, cap 100 | `pickup.ts` |
| Health bonus | BON1 | health | +1, cap 200, always taken | `pickup.ts` |
| Armor bonus | BON2 | armor | +1, cap 200, sets green if unarmored | `pickup.ts` |
| Green armor | ARM1 | armor | set 100, 1/3 absorb | `pickup.ts` |
| Blue armor (Megaarmor) | ARM2 | armor | set 200, 1/2 absorb | `pickup.ts` |
| Soulsphere | SOUL | health | +100, cap 200 | `pickup.ts` |
| Megasphere | MEGA | health+armor | set health=200 + blue armor 200 (DoomII) | `pickup.ts` |
| Berserk pack | PSTR | powerup | heal to 100, fist ×10 rest of level, switch to fist | `pickup.ts`+`player.ts`+`weapon.ts` |
| Invulnerability | PINV | powerup | 30 s immunity (<1000 dmg), inverse palette | `pickup.ts`+powerup timer |
| Radiation suit | SUIT | powerup | 60 s floor-damage immunity | `pickup.ts`+powerup timer |
| Light visor | PVIS | powerup | 120 s full-bright render | `pickup.ts`+powerup timer |
| Computer area map | PMAP | powerup | reveal automap (level-scoped flag) | `pickup.ts` |
| Partial invisibility (Blur) | PINS | powerup | 60 s monster aim offset, MF_SHADOW | `pickup.ts`+powerup timer |
| Backpack | BPAK | ammo | first: double all max + 1 clip each | `pickup.ts`+`player.ts` |
| Clip | CLIP | ammo | +10 bullets (dropped 5) | `pickup.ts` |
| Box of bullets | AMMO | ammo | +50 bullets | `pickup.ts` |
| 4 shells | SHEL | ammo | +4 shells (dropped 2) | `pickup.ts` |
| Box of shells | SBOX | ammo | +20 shells | `pickup.ts` |
| Rocket | ROCK | ammo | +1 rocket (new ammo) | `pickup.ts`+`player.ts` |
| Box of rockets | BROK | ammo | +5 rockets | `pickup.ts` |
| Cell charge | CELL | ammo | +20 cells (new ammo) | `pickup.ts`+`player.ts` |
| Cell pack | CELP | ammo | +100 cells | `pickup.ts` |
| Blue keycard | BKEY | key | blue lock | `pickup.ts`+`player.ts` |
| Red keycard | RKEY | key | red lock | `pickup.ts` |
| Yellow keycard | YKEY | key | yellow lock | `pickup.ts` |
| Blue skull key | BSKU | key | blue lock (= card in vanilla) | `pickup.ts` |
| Red skull key | RSKU | key | red lock | `pickup.ts` |
| Yellow skull key | YSKU | key | yellow lock | `pickup.ts` |

### Props (45)

| Entity | Sprite | Type | Core correct behavior (1 line) | Target module |
|---|---|---|---|---|
| Explosive barrel | BAR1/BEXP | destructible | HP20, on death 128u Chebyshev splash, chains | `world.ts`/`enemy.ts` + splash |
| Tall techno lamp | TLMP | solid fullbright anim | static solid, 4-frame fullbright loop | `world.ts` props/`sprites.ts` |
| Short techno lamp | TLP2 | solid fullbright anim | static solid, 4-frame fullbright loop | props |
| Floor lamp (column) | COLU | solid fullbright | static solid, single fullbright frame | props |
| Tall red torch | TRED | solid fullbright anim | 4-frame fullbright loop | props |
| Tall green torch | TGRN | solid fullbright anim | 4-frame fullbright loop | props |
| Tall blue torch | TBLU | solid fullbright anim | 4-frame fullbright loop | props |
| Short red torch | SMRT | solid fullbright anim | 4-frame fullbright loop | props |
| Short green torch | SMGT | solid fullbright anim | 4-frame fullbright loop | props |
| Short blue torch | SMBT | solid fullbright anim | 4-frame fullbright loop | props |
| Candle | CAND | non-solid fullbright | pass-through, single fullbright frame | props |
| Candelabra | CBRA | solid fullbright | static solid, single fullbright frame | props |
| Tall green pillar | COL1 | solid | static solid, sector-lit | props |
| Short green pillar | COL2 | solid | static solid, sector-lit | props |
| Tall red pillar | COL3 | solid | static solid, sector-lit | props |
| Short red pillar | COL4 | solid | static solid, sector-lit | props |
| Heart pillar | COL5 | solid anim | 2-frame pulse, sector-lit | props |
| Skull pillar | COL6 | solid | static solid, sector-lit | props |
| Torch tree (bush) | TRE1 | solid | static solid, sector-lit | props |
| Big tree | TRE2 | solid (r32) | large 32u radius, sector-lit | props |
| Hanging twitching victim | GOR1 | ceiling solid anim | ceiling-anchored, 4-frame twitch | props (ceiling) |
| Hanging victim arms out | GOR2 | ceiling solid | ceiling-anchored, h84 | props |
| Hanging one-legged | GOR3 | ceiling solid | ceiling-anchored, h84 | props |
| Hanging pair of legs | GOR4 | ceiling solid | ceiling-anchored, h68 | props |
| Hanging leg | GOR5 | ceiling solid | ceiling-anchored, h52 | props |
| Hanging no-guts | HDB1 | ceiling solid | ceiling-anchored, h88 | props |
| Hanging no-guts/brain | HDB2 | ceiling solid | ceiling-anchored, h88 | props |
| Hanging torso down | HDB3 | ceiling solid | ceiling-anchored, h64 | props |
| Hanging torso open skull | HDB4 | ceiling solid | ceiling-anchored, h64 | props |
| Hanging torso up | HDB5 | ceiling solid | ceiling-anchored, h64 | props |
| Hanging torso no-brain | HDB6 | ceiling solid | ceiling-anchored, h64 | props |
| Impaled human (dead) | POL1 | solid | static solid floor | props |
| Twitching impaled human | POL6 | solid anim | 2-frame twitch | props |
| Five skulls on pole | POL2 | solid | static solid | props |
| Skull on pole | POL4 | solid | static solid | props |
| Skulls & candles pile | POL3 | solid fullbright anim | 2-frame fullbright flicker | props |
| Pool of blood/flesh (gibs) | POL5 | non-solid | pass-through floor decor | props |
| Pool of blood large | POB1 | non-solid (no blockmap) | render-only | props |
| Pool of blood small | POB2 | non-solid (no blockmap) | render-only | props |
| Pool of brains | BRS1 | non-solid (no blockmap) | render-only | props |
| Gibbed player ×2 | PLAY-W | non-solid corpse | pass-through (things 10 & 12) | props |
| Dead player | PLAY-N | non-solid corpse | pass-through floor | props |
| Dead zombieman | POSS-L | non-solid corpse | pass-through floor | props |
| Dead shotgun guy | SPOS-L | non-solid corpse | pass-through floor | props |
| Dead imp | TROO-M | non-solid corpse | pass-through floor | props |
| Dead demon | SARG-N | non-solid corpse | pass-through floor | props |
| Dead cacodemon | HEAD-L | non-solid corpse | pass-through floor | props |
| Dead lost soul | SKUL-K | non-solid corpse | shows ~6 tics then self-removes | props |

---

## 3. Detailed specs

### 3.1 Monsters

All HP/radius/height/painchance/reactiontime/mass/damage formulas verified from `info.c` + `p_enemy.c` + `p_map.c`. `reactiontime = 8 tics = 0.229 s` for all. Each entry ends with an **Engine** note.

#### Zombieman — POSS
- HP **20**, radius 20u (0.31 cell), height 56u, painchance **200** (0.78), mass 100.
- **Cruise 70.0 u/s** (1.09 cells/s). POSS run states are **4 tics** each ⇒ `8*35/4 = 70.0`. *(Correction: not 93.3/1.46 — that is the 3-tic figure.)*
- **Attack** `A_PosAttack`: 1 hitscan bullet, `damage = ((P_Random()%5)+1)*3` ∈ {3,6,9,12,15}, range MISSILERANGE 2048u, autoaim slope + horizontal jitter `angle += (P_Random()-P_Random())<<20` (≈ ±5.6°). sfx_pistol.
- Flags MF_SOLID|MF_SHOOTABLE|MF_COUNTKILL. Infights normally. Drops a clip = **5 bullets** on death. Has xdeath gib on overkill.
- **Engine:** existing `grunt` kind. Hitscan-with-spread at 32 cells via `combat.ts hitscan`; damage one of {3,6,9,12,15}; painChance 0.78; cruise ~1.1 cells/s. Drop a bullets pickup (5).
- Sources: [Zombieman](https://doomwiki.org/wiki/Zombieman), [p_enemy.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_enemy.c), [info.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/info.c), [p_local.h](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_local.h)

#### Shotgun guy — SPOS
- HP **30**, radius 20u, height 56u, painchance **170** (0.66), mass 100.
- **Cruise 93.3 u/s** (1.46 cells/s); SPOS run states are 3 tics.
- **Attack** `A_SPosAttack`: one blast = `for(i=0;i<3;i++)` 3 independent pellets, each `((P_Random()%5)+1)*3` ∈ {3..15}, total 9–45. Slope computed once; each pellet `angle = bangle + ((P_Random()-P_Random())<<20)`. sfx_shotgn. Range MISSILERANGE.
- Flags MF_SOLID|MF_SHOOTABLE|MF_COUNTKILL. Drops a shotgun = **4 shells** (8 on ITYTD/Nightmare). xdeath gib on overkill.
- **Engine:** new kind; hitscan-with-spread fired 3× in one attack tick (engine shotgun spread). painChance 0.66, cruise ~1.46 cells/s. Drop shotgun weapon.
- Sources: [Shotgun guy](https://doomwiki.org/wiki/Shotgun_guy), p_enemy.c, info.c.

#### Heavy weapon dude (Chaingunner) — CPOS
- HP **70**, radius 20u, height 56u, painchance **170** (0.66), mass 100.
- **Cruise 93.3 u/s** (1.46 cells/s); CPOS run states 3 tics.
- **Attack** `A_CPosAttack` fires ONE bullet/call (same math as Zombieman but sfx_shotgn), `((P_Random()%5)+1)*3` ∈ {3..15}, jitter `<<20`. Missile state loops the attack twice then `A_CPosRefire`: `if (P_Random() < 40) return;` (~15.6% chance to keep going without LOS recheck), else break to seestate if target dead/gone/no `P_CheckSight`. Perceived as ~2-bullet bursts. Rate ~466.7 shots/min (~0.13 s interval).
- Flags MF_SOLID|MF_SHOOTABLE|MF_COUNTKILL. Drops chaingun = **10 bullets** (20 ITYTD/NM). xdeath gib.
- **Engine:** new kind; repeated single-bullet hitscan-with-spread while LOS holds; fire interval ~0.13 s; per-refire 40/256 (~15.6%) chance to continue regardless else stop on lost LOS. Strong infight instigator. Drop chaingun.
- Sources: [Heavy weapon dude](https://doomwiki.org/wiki/Heavy_weapon_dude), [A_CPosAttack](https://doomwiki.org/wiki/A_CPosAttack), p_enemy.c, info.c.

#### Imp — TROO
- HP **60**, radius 20u, height 56u, painchance **200** (0.78), mass 100.
- **Cruise 93.3 u/s** (1.46 cells/s); TROO run states 3 tics.
- **Attack** `A_TroopAttack` (faces target, chooses by range): **melee** if `P_CheckMeleeRange` — claw `(P_Random()%8+1)*3` ∈ {3..24}, sfx_claw; **else projectile** `P_SpawnMissile(MT_TROOPSHOT)` — fireball **350 u/s** (5.5 cells/s), impact `((P_Random()%8)+1)*3` ∈ {3..24}. Under -fast/Nightmare fireball doubles to 700 u/s.
- Flags MF_SOLID|MF_SHOOTABLE|MF_COUNTKILL. Infights. xdeath gib.
- **Engine:** existing `imp` kind. Reuse billboard-projectile (`fireball`, base 3) at ~5.5 cells/s, impact {3..24} step 3; melee branch within ~1 cell deals same {3..24}. painChance 0.78. Fireball engage range ~7 cells.
- Sources: [Imp](https://doomwiki.org/wiki/Imp), p_enemy.c, p_map.c, info.c.

#### Demon (Pinky) — SARG
- HP **150**, radius 30u (0.47 cell), height 56u, painchance **180** (0.70), mass **400** (hard to knock back).
- **Cruise 175.0 u/s** (2.73 cells/s) — fastest grounded infantry; SARG run states 2 tics.
- **Attack** `A_SargAttack`: bite only (no ranged), `((P_Random()%10)+1)*4` ∈ {4,8,…,40}. MELEERANGE.
- Flags MF_SOLID|MF_SHOOTABLE|MF_COUNTKILL. **No xdeath** (xdeathstate = S_NULL) — shows normal death even on overkill (correction to the "gibs" myth). Chainsaw stunlock is emergent, not a flag.
- **Engine:** existing `demon` kind. maxHealth 150, damage {4..40} step 4, cruise ~2.73 cells/s, melee at ~1 cell, painChance 0.70.
- Sources: [Demon](https://doomwiki.org/wiki/Demon), p_enemy.c, info.c.

#### Spectre — SARG (fuzz)
- Stat-identical clone of Demon (MT_SHADOWS) — HP 150, dmg {4..40}, 2.73 cells/s, radius 0.47, painChance 0.70. Reuses all SARG sprites/states.
- Only difference: flags add **MF_SHADOW** → rendered with partial-invisibility **fuzz** (same shading as the Invisibility powerup). Fuzz is render-only; no death gib (S_NULL).
- **Engine:** reuse Demon def entirely; flag to use a fuzz/partial-invisible shader. All combat numbers identical.
- Sources: [Spectre](https://doomwiki.org/wiki/Spectre), p_enemy.c, info.c.

#### Lost Soul — SKUL
- HP **100**, radius 16u (0.25 cell), height 56u, painchance **256**, mass 50, contact damage field 3.
- **Idle hover 46.7 u/s** (0.73 cells/s); SKUL run states 6 tics. **Charge = SKULLSPEED 20 u/tic = 700 u/s** (10.9 cells/s).
- **Attack** `A_SkullAttack` deals NO damage itself: sets MF_SKULLFLY, plays sfx_sklatk, faces target, `momx/momy = SKULLSPEED*cos/sin`, `momz` aimed at `dest->z + dest->height/2`. Damage applied in `PIT_CheckThing` on collision: `((P_Random()%8)+1)*3` ∈ {3,6,…,24}; then clears MF_SKULLFLY, zeroes momentum, returns to idle.
- Flags MF_SOLID|MF_SHOOTABLE|**MF_FLOAT|MF_NOGRAVITY** (flies). **CORRECTION:** it *does* have a pain state (S_SKULL_PAIN) and `painchance 256` ⇒ **flinches on EVERY hit** (~6 tics, 0.171 s) — the "never flinches" claim is FALSE. **CORRECTION:** MT_SKULL has **NO MF_COUNTKILL** in linuxdoom-1.10 ⇒ does **not** count toward kills in PC Doom/Doom II. Often spawned by Pain Elemental. Infights.
- **Death:** leaves NO corpse — S_SKULL_DIE1..6 end at S_NULL (DIE2 = A_Scream sfx_firxpl, DIE4 = A_Fall); the skull bursts/vanishes.
- **Engine:** new flying kind. Needs a *charge* attack mode + no-gravity flight flag. Idle hover ~0.73 cells/s; on attack dash straight at player at ~10.9 cells/s, deal {3..24} on contact, then revert to idle (zero momentum). **Keep pain/flinch ENABLED.** Remove corpse on death.
- Sources: [Lost soul](https://doomwiki.org/wiki/Lost_soul), p_enemy.c, p_map.c, info.c.

#### Cacodemon — HEAD
- HP **400**, radius 31u (0.48), height 56u, painchance **128** (0.50), mass 400. Flags MF_FLOAT|MF_NOGRAVITY (floats, seeks player z).
- **Cruise 280 u/s** (`info.c speed=8`, floater). 
- **Attack** `A_HeadAttack` (faces target): **melee** if `P_CheckMeleeRange` — bite `(P_Random()%6+1)*10` ∈ {10..60}; **else** `P_SpawnMissile(MT_HEADSHOT)` — ball **350 u/s**, impact `((P_Random()%8)+1)*5` ∈ {5..40}. Melee and missile share the one attack frame (bite is rare in practice).
- Death: HEAD death frames → static corpse (no explosion). No xdeath. Arch-vile-resurrectable. Subject to splash.
- **Engine:** new ranged flying kind, maxHealth 400, painChance 0.50; reuse `spawnProjectile` with a `cacoball` type, impact `(rand%8+1)*5`; speed ~350 u/s scaled; flying → variable-z sprite, ignores floor collision.
- Sources: [Cacodemon](https://doomwiki.org/wiki/Cacodemon), p_enemy.c, info.c, p_map.c.

#### Hell Knight — BOS2
- HP **500**, radius 24u (0.38), height 64u, painchance **50** (0.1953 raw per-hit), mass 1000. Ground walker.
- **Cruise 280 u/s** (`speed=8`).
- **Attack** `A_BruisAttack` (does **not** call A_FaceTarget): **melee** if range — claw `(P_Random()%8+1)*10` ∈ {10..80}, sfx_claw; **else** `P_SpawnMissile(MT_BRUISERSHOT)` — green plasma **525 u/s**, impact `((P_Random()%8)+1)*8` ∈ {8..64}.
- Behaviorally identical to Baron but half HP. **Hell Knights and Barons do NOT infight each other** (PIT_CheckThing groups MT_KNIGHT+MT_BRUISER as one species). Resurrectable. No xdeath.
- **Engine:** new kind, maxHealth 500, painChance ≈0.195; melee 10–80, ranged 8–64; reuse `spawnProjectile` `baronball` (525 u/s scaled); ground walker reuses existing collision/gravity.
- Sources: [Hell knight](https://doomwiki.org/wiki/Hell_knight), p_enemy.c, info.c, p_map.c.

#### Baron of Hell — BOSS
- HP **1000**, radius 24u, height 64u, painchance **50**, mass 1000. Ground walker. Cruise **280 u/s**.
- **Attack** identical to Hell Knight (`A_BruisAttack`; MT_BRUISERSHOT 8–64; melee 10–80).
- Doom 1 E1M8 boss (`A_BossDeath` lowers exit floor); in Doom II a regular tough monster. Only diff vs Hell Knight: 1000 HP + BOSS sprite. Infights everything except Hell Knights. Resurrectable, no xdeath.
- **Engine:** new kind = Hell Knight but maxHealth 1000 + BOSS sprites; reuse same `baronball`. Mark isBoss for music/HUD cue.
- Sources: [Baron of Hell](https://doomwiki.org/wiki/Baron_of_Hell), p_enemy.c, info.c, p_map.c.

#### Pain Elemental — PAIN
- HP **400**, radius 31u, height 56u, painchance **128** (0.50), mass 400. Floats (MF_FLOAT|MF_NOGRAVITY). Cruise **280 u/s**. Doom II only.
- **Attack** `A_PainAttack → A_PainShootSkull(actor->angle)`: faces target, spawns ONE MT_SKULL (Lost Soul) at `prestep = 4 + 3*(actor.radius + skull.radius)/2` in front, `z = actor.z + 8`, then immediately `A_SkullAttack` so it charges. **CAP:** first counts ALL MT_SKULL thinkers on the level; if `> 20` (21+ exist) it returns and spawns nothing (still plays anim). If spawn position solid (`P_TryMove` fails) the new skull is instantly killed.
- **Death** `A_PainDie`: A_Fall then `A_PainShootSkull` at angle+ANG90, +ANG180, +ANG270 → up to **3** Lost Souls in a ring (each subject to the >20 cap). The spawned skulls bite 3–24 charging at 700 u/s.
- No xdeath. Resurrectable (can re-breed). No direct attack of its own.
- **Engine:** new floating kind, maxHealth 400, painChance 0.50, no direct-damage attack. Implement A_PainAttack (spawn 1 charging Lost Soul ahead) + A_PainDie (spawn 3 on death), both gated by a **global live-Lost-Soul counter** that refuses when >20 exist. Requires the Lost Soul kind. Render at variable z.
- Sources: [Pain elemental](https://doomwiki.org/wiki/Pain_elemental), [Lost soul](https://doomwiki.org/wiki/Lost_soul), p_enemy.c, info.c, p_map.c.

#### Revenant — SKEL
- HP **300**, radius 20u, height 56u, painchance **100** (0.39), mass 500.
- **Cruise ~175 u/s** (`speed=10`; walk figure from Doom Wiki, *not* speed*35).
- **Ranged** `A_SkelMissile` → `P_SpawnMissile(MT_TRACER)`, sets `mo->tracer = target`; actor z +16 during spawn so missile launches higher, then nudged forward one momentum step. **Homing** via `A_Tracer` runs only when `!(gametic & 3)` (every 4th tic): turns `actor->angle` by **TRACEANGLE 16.875°** toward target, recomputes momx/momy, adjusts momz ±FRACUNIT/8 toward `target->z + 40`. Spawns MT_PUFF + MT_SMOKE corkscrew trail. Net **~25% of missiles actually home** (homes only if flight state's tic count is even; spawn shortens first state by `P_Random()&3` against base 2). Tracer speed **350 u/s**, impact `(P_Random()%8+1)*10` ∈ {10..80}.
- **Melee** `A_SkelFist` (after `A_SkelWhoosh`): punch `((P_Random()%10)+1)*6` ∈ {6..60} at MELEERANGE. Commits to fist only when target distance **< 196u**.
- Resurrectable, gibs on extreme overkill.
- **Engine:** new ranged+melee hybrid; homing billboard projectile `tracer` (turnRate 16.875° per (4/35)s tick, at 60 Hz ≈ every 7th step), home toward player; roll ~25% homing vs straight at spawn; impact base 10 → `(rand%8+1)*10`. Melee swing 6–60 when player < 196u-equivalent. Walk ~175 u/s scaled.
- Sources: [Revenant](https://doomwiki.org/wiki/Revenant), p_enemy.c, info.c.

#### Mancubus — FATT
- HP **600**, radius 48u (0.75), height 64u, painchance **80** (0.3125), mass 1000.
- **Cruise ~70 u/s** (slow); wide radius blocks doorways.
- **Attack** across THREE frames `A_FatAttack1/2/3`, each spawning **two** MT_FATSHOT ⇒ **6 fireballs/cycle**. `FATSPREAD = ANG90/8 = 11.25°`. Verbatim fan: vol1 {+11.25°, +22.5°}, vol2 {−11.25°, −33.75°}, vol3 {−5.625°, +5.625°} (relative to freshly-faced angle; actor-angle rotation in 1&2 shifts the first shot too — offsets are cumulative). `A_FatRaise` is the prep frame (faces target, sfx_manatk) — **not** a resurrection function. Fireball **700 u/s**, impact `(P_Random()%8+1)*8` ∈ {8..64}; full volley 48–384.
- Resurrectable, gibs.
- **Engine:** new kind; schedule three sub-volleys over the attack pose, 2 `fatshot` each (6 total), apply the verbatim fan; impact base 8 → `(rand%8+1)*8`. Slow ~70 u/s, big radius.
- Sources: [Mancubus](https://doomwiki.org/wiki/Mancubus), p_enemy.c, info.c.

#### Arachnotron — BSPI
- HP **500**, radius 64u (1.0 cell), height 64u, painchance **128** (0.50), mass 600.
- **Cruise ~140 u/s** (`speed=12`).
- **Attack** `A_BspiAttack` fires one MT_ARACHPLAZ bolt, then `A_SpidRefire` decides re-loop vs break: `A_FaceTarget; if (P_Random() < 10) return;` (~3.9% short-circuit continue), then stop if target dead/null/no `P_CheckSight`. Sustained ~233.3 shots/min. Bolt **875 u/s** (fastest monster projectile), impact `(P_Random()%8+1)*5` ∈ {5..40}. sfx_plasma.
- High painchance interrupts its own stream. Resurrectable, gibs.
- **Engine:** new kind; fast `aplasma` billboard (~875 u/s scaled), impact base 5 → `(rand%8+1)*5`. Implement A_SpidRefire: re-evaluate LOS each shot, ~3.9% skip-and-continue, break to chase on lost LOS/dead. painChance 0.50, walk ~140 u/s.
- Sources: [Arachnotron](https://doomwiki.org/wiki/Arachnotron), p_enemy.c, info.c.

#### Arch-vile — VILE
- HP **700**, radius 20u, height 56u, painchance **10** (0.039 — most pain-resistant), mass 500.
- **Cruise ~262.5 u/s** (`speed=15`; fastest non-charging monster). **NOT splash-immune.**
- **(1) Resurrection** `A_VileChase`: while walking, scans blockmap squares at next step (`PIT_VileCheck`) for raisable corpses (a corpse with a raisestate, at its corpse frame). On finding one: heal anim S_VILE_HEAL1, sfx_slop, set corpse to raisestate, restore `info->spawnhealth` + `info->flags`, restore height, clear revived thing's target, re-solidify (MF_SOLID/shootable). **Cannot raise:** things with no raisestate, gibbed (xdeath) corpses, other Arch-viles, Cyberdemons, Spider Masterminds, Commander Keens.
- **(2) Fire attack** — NON-projectile, instant LOS hit. `A_VileStart` (sfx_vilatk) → `A_VileTarget` spawns MT_FIRE as `actor->tracer` → `A_Fire` glues MT_FIRE in front of the target each tic → `A_VileAttack`: if `!P_CheckSight` on the firing tic, deal nothing; else sfx_barexp, `P_DamageMobj(target, 20)` (**flat 20, not randomized**), `target->momz = 1000*FRACUNIT/target->info->mass` (player mass 100 → +10 u/tic upward launch), then `P_RadiusAttack(fire, 70)` (splash 0–70 by distance). Doom Wiki total **20–90**.
- **Engine:** new kind. Fire attack = special, not projectile: on attack tick, if `lineOfSight(vile, player)` deal flat 20 + radius-falloff blast up to 70 + a brief upward thrust (fake the momz launch as screen kick / vertical bob); if LOS broken on that exact tick, deal nothing. Resurrection: in chase, scan nearby dead enemies with a raisestate (exclude bosses, gibs, other archviles); restore to spawnhealth/idle, re-solidify, clear target. Very fast ~262.5 u/s, almost never flinches. NOT splash-immune.
- Sources: [Arch-vile](https://doomwiki.org/wiki/Arch-vile), [A_VileAttack](https://doomwiki.org/wiki/A_VileAttack), p_enemy.c, info.c.

#### Cyberdemon — CYBR (boss)
- HP **4000**, radius 40u (0.63), height 110u, painchance **20** (0.0781, 10-tic pain), mass 1000.
- **Cruise ~186.7 u/s** (`speed=16`). **IMMUNE to splash/radius damage** (hardcoded type check — own + player rockets never blast it; never infights from splash). Can still enter brief pain from direct rolls but rarely staggers out of a volley.
- **Attack** sequence runs three `A_CyberAttack` frames: each `A_FaceTarget; P_SpawnMissile(MT_ROCKET)` → **3-rocket volley**, re-aiming between each. Rocket **700 u/s**, no homing, auto-aimed at launch. Direct `(P_Random()%8+1)*20` ∈ {20..160} + `P_RadiusAttack(128)` splash 0–128. (A_Hoof/A_Metal are walk-cycle stomp sounds.)
- Boss: counts toward boss-death map specials. Not practically Arch-vile-raisable. Long death (sfx_cybdth).
- **Engine:** new boss kind. Reuse `rocket` projectile: direct `(rand%8+1)*20` + 0–128 radius splash; fire 3 rockets/cycle re-aiming each. **Mark splash-immune** so its/player rockets never stagger or infight it; treat painChance as effectively ~0 in practice. HP 4000, tall (110u), ~186.7 u/s.
- Sources: [Cyberdemon](https://doomwiki.org/wiki/Cyberdemon), p_enemy.c, info.c.

#### Spider Mastermind — SPID (boss)
- HP **3000**, radius **128u** (2.0 cells — largest in game), height 100u, painchance **40** (0.1563), mass 1000.
- **Cruise ~140 u/s** (`speed=12`). **IMMUNE to splash/radius damage** (like Cyberdemon).
- **Attack** = hitscan chaingun (NOT projectile): a **3-bullet burst** per shot, each `(P_Random()%5+1)*3` ∈ {3..15} (same math as Shotgun Guy / Chaingunner), 9–45/shot, with horizontal spread, then `A_SpidRefire` to sustain: `A_FaceTarget; if (P_Random() < 10) return;` (~3.9% forced continue), else break to seestate if target dead/null/out of sight. ~466.7 shots/min. sfx_shotgn.
- Boss: triggers end-of-level specials. Long death (sfx_spidth). Not practically resurrectable.
- **Engine:** new boss kind. Use `combat.ts hitscan` with spread: per shot fire 3 bullets each `(rand%5+1)*3`. Loop A_SpidRefire logic (~3.9% forced continue, else continue while in LOS). Massive radius 128u scaled, HP 3000, **splash-immune**, painChance ≈0.156, ~140 u/s.
- Sources: [Spiderdemon](https://doomwiki.org/wiki/Spiderdemon), p_enemy.c, info.c.

---

### 3.2 Weapons

`P_Random()` is the fixed 256-entry table. `P_GunShot` damage (pistol/chaingun/all shotgun & SSG pellets) = `5*((P_Random()%3)+1)` = **5/10/15**. Melee (fist/saw) = `2*((P_Random()%10)+1)` = **2..20**. Projectile impact = `((P_Random()&7)+1)*info.damage`. Hitscan range MISSILERANGE=2048u (≈whole level — the engine's current short ranges must be widened). `fireDelay seconds = ticCount/35`. Accuracy: `P_GunShot(mo, accurate)` where `accurate = !player->refire`.

#### Fist — PUNG (slot 1, no ammo)
- `A_Punch`: `damage = (P_Random()%10+1)<<1` = 2..20; **berserk** (pw_strength) `damage *= 10` → **20..200**. Range MELEERANGE 64u. Horizontal jitter `(P_Random()-P_Random())<<18` (≈±5.6°); vertical auto-aim via `P_AimLineAttack`. Cycle S_PUNCH1..5 = 4+4+5+4+5 = **22 tics**, ~95.5/min, fireDelay 0.629 s. On hit: sfx_punch + turn to face target.
- **Engine:** existing `fist`. Melee primitive at 64u; `damage = (1+floor(rng*10))*2`, ×10 if berserk flag; single hitscan ±5.6° horizontal jitter; fireDelay ~0.63 s.
- Sources: [Fist](https://doomwiki.org/wiki/Fist), [p_pspr.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_pspr.c), info.c.

#### Chainsaw — SAWG (slot 1, no ammo)
- `A_Saw`: `damage = 2*(P_Random()%10+1)` = 2..20 (**NOT** berserk-boosted — no pw_strength check). Range MELEERANGE+1 = 65u. Horizontal jitter `<<18`; snaps player angle toward target (ANG90/20 or ANG90/21). sfx_sawhit/sfx_sawful, sets MF_JUSTATTACKED. Cycle ~8 tics for 2 attack frames ⇒ one hit every ~4 tics (~525/min), fireDelay ~0.114 s.
- **Engine:** new weapon; melee primitive at 65u, automatic ~4 tics/hit, `damage = (1+floor(rng*10))*2`. Add optional pull-toward-target turn; ignore berserk. Infinite ammo.
- Sources: [Chainsaw](https://doomwiki.org/wiki/Chainsaw), p_pspr.c.

#### Pistol — PISG (slot 2, 1 bullet/shot)
- `A_FirePistol → P_BulletSlope + P_GunShot(mo, !refire)`: 1 bullet, `5*((P_Random()%3)+1)` = 5/10/15. **First shot (not refiring) dead accurate**; held shots get `<<18` spread. Hitscan MISSILERANGE. Full cycle 19 tics; **held rate 150 shots/min** (A_ReFire loops), fireDelay (held) ~0.4 s.
- **Engine:** existing `pistol`. Hitscan full-level range; `damage = 5*(1+floor(rng*3))`; spread 0 on first shot, ±5.6° when held; fireDelay ~0.4 s held.
- Sources: [Pistol](https://doomwiki.org/wiki/Pistol), p_pspr.c.

#### Shotgun — SHTG (slot 3, 1 shell/shot)
- `A_FireShotgun`: **7 pellets**, each `P_GunShot(mo, false)` = 5/10/15 (always inaccurate, `<<18` horizontal each), shared vertical auto-aim slope. Full hit 35–105, avg ~70. Cycle = **44 tics** (3+7+5+5+4+5+5+3+7), ~47.7/min, fireDelay **1.257 s**. MISSILERANGE.
- **Engine:** existing `shotgun`. 7-pellet hitscan; `damage = 5*(1+floor(rng*3))` per pellet; spread ±~5° horizontal, no vertical; full-level range; fireDelay ~1.257 s.
- Sources: [Shotgun](https://doomwiki.org/wiki/Shotgun), p_pspr.c.

#### Super Shotgun — SHT2 (slot 3, 2 shells/shot, Doom II only)
- `A_FireShotgun2`: **20 pellets**, each `5*((P_Random()%3)+1)` = 5/10/15. Per pellet: horizontal `(P_Random()-P_Random())<<19` (**double** normal, ≈±11.2°) AND vertical `slope = bulletslope + ((P_Random()-P_Random())<<5)` — **the only Doom hitscan with random vertical spread**. Consumes 2 shells. Full hit 100–300 (fixed-RNG ~175–245). Cycle = **62 tics**, ~33.9/min, fireDelay **1.771 s**.
- **Engine:** new weapon; extend pellet hitscan to 20 pellets, 2 shells; **add vertical spread** (engine currently horizontal-only). horiz ~±11°, small vertical. `damage = 5*(1+floor(rng*3))` per pellet; fireDelay ~1.77 s.
- Sources: [Super shotgun](https://doomwiki.org/wiki/Super_shotgun), [A_FireShotgun2](https://doomwiki.org/wiki/A_FireShotgun2), p_pspr.c.

#### Chaingun — CHGG (slot 4, 1 bullet/shot)
- `A_FireCGun → P_BulletSlope + P_GunShot(mo, !refire)`: per bullet 5/10/15 (= pistol). **First two shots accurate**, then `<<18` spread. One bullet every 4 tics ⇒ 525/min (fires in pairs), fireDelay 0.114 s. Flash state offset by which CHAIN frame.
- **Engine:** existing `chaingun`. Automatic hitscan 4 tics/shot; `damage = 5*(1+floor(rng*3))`; first 1–2 shots spread 0 then ±5.6°; full-level range.
- Sources: [Chaingun](https://doomwiki.org/wiki/Chaingun), p_pspr.c.

#### Rocket Launcher — MISG (slot 5, 1 rocket/shot)
- `A_FireMissile → P_SpawnPlayerMissile(MT_ROCKET)`. Rocket speed **20 u/tic = 700 u/s**, no spread. **Direct** impact `((P_Random()&7)+1)*20` = 20..160. **Splash** on death `A_Explode → P_RadiusAttack(thing, thing->target, 128)`: **Chebyshev** `dist = max(|dx|,|dy|)`; `dist = (dist - target->radius)>>FRACBITS`; if <0→0; if ≥128 no damage; else `damage = 128 - dist`; requires `P_CheckSight` (walls block); **hurts the shooter too**. **Cyberdemon (MT_CYBORG) & Spider Mastermind (MT_SPIDER) splash-immune via hardcoded type check** (still take direct hit). Cycle 20 tics, ~105/min, fireDelay 0.571 s. Point-blank direct+splash up to ~288.
- **Engine:** new weapon; new `rocket` billboard projectile (speed 20 u/tic). On impact: direct `(1+floor(rng*8))*20` to struck target, then radius pass `dmg = 128 - max(|dx|,|dy|)` minus target radius, clamped ≥0, over a **128u square** to all incl. player, gated by `combat.ts lineOfSight`; skip Cyber/Mastermind analogues. fireDelay ~0.57 s. New `rockets` ammo.
- Sources: [Rocket launcher](https://doomwiki.org/wiki/Rocket_launcher), [Splash damage](https://doomwiki.org/wiki/Splash_damage), p_map.c, info.c.

#### Plasma Rifle — PLSG (slot 6, 1 cell/shot)
- `A_FirePlasma → P_SpawnPlayerMissile(MT_PLASMA)`. Speed **25 u/tic = 875 u/s**, no spread. Impact `((P_Random()&7)+1)*5` = 5..40. Cycle: S_PLASMA1(3, fire) + S_PLASMA2(20, refire) ⇒ held cadence one shot every **3 tics** (700/min); on release the ~20-tic frame plays out as cooldown. fireDelay (held) 0.086 s. Flash alternates via `(P_Random()&1)`.
- **Engine:** new weapon; `plasma` billboard (speed 25 u/tic), automatic 3 tics/shot, impact `(1+floor(rng*8))*5`. Add ~0.57 s release pause for vanilla feel. New `cells` ammo.
- Sources: [Plasma gun](https://doomwiki.org/wiki/Plasma_gun), p_pspr.c, info.c.

#### BFG9000 — BFGG (slot 7, 40 cells/shot)
- `A_FireBFG`: `ammo -= BFGCELLS(40)`, `P_SpawnPlayerMissile(MT_BFG)`. Ball speed **25 u/tic = 875 u/s**. **Ball direct** impact `((P_Random()&7)+1)*100` = 100..800. On ball death, `A_BFGSpray` emits **40 tracer rays** from `mo->target` (the PLAYER): `for(i=0;i<40;i++){ an = mo->angle - ANG90/2 + ANG90/40*i; P_AimLineAttack(mo->target, an, 16*64*FU); ... damage = sum of 15× ((P_Random()&7)+1); P_DamageMobj(linetarget, damage); }`. So **90° fan** (ANG90/40 = 2.25°/ray), range **1024u**, theoretical 15–120/ray (realized ~49–87 due to shared LUT), spawns MT_EXTRABFG flash per hit. **CRITICAL:** `mo->angle` is the **ball's frozen facing = player's angle when the ball was FIRED**. Turning after firing does NOT change tracer direction — the classic technique is aiming at fire time, not turning during flight. Cycle 60 tics, 35/min, fireDelay 1.714 s (ball spawned at S_BFG3 after 30-tic windup).
- **Engine:** new weapon; `bfg` billboard ball (speed 25 u/tic) direct `(1+floor(rng*8))*100`. On ball impact fire **40 hitscans** (reuse `combat.ts hitscan`) across a 90° fan (2.25°/ray, range 1024u), each ray summing 15× `(1+floor(rng*8))` (~49–87 typical). Consume 40 cells at fire time. **Freeze spray angle to firing angle**, not live player angle. fireDelay ~1.71 s.
- Sources: [BFG9000](https://doomwiki.org/wiki/BFG9000), [A_BFGSpray](https://doomwiki.org/wiki/A_BFGSpray), [A_FireBFG](https://doomwiki.org/wiki/A_FireBFG), p_pspr.c, info.c.

---

### 3.3 Projectiles / missiles

Universal impact rule (`PIT_CheckThing`): `damage = ((P_Random()%8)+1) * missile.info.damage`. Speeds are `N u/tic` (= `N*35` u/s). Per-cell conversion (S=64) noted as cells/s. Each entry ends with an **Engine** note.

| Field | BAL1 | BAL2 | BAL7 | FATB | MANF | MISL | PLSS | APLS | BFS1 |
|---|---|---|---|---|---|---|---|---|---|
| Name | Imp fireball | Caco ball | Bruiser shot | Revenant tracer | Mancubus ball | Rocket | Plasma | Arach plasma | BFG ball |
| Missile type | MT_TROOPSHOT | MT_HEADSHOT | MT_BRUISERSHOT | MT_TRACER | MT_FATSHOT | MT_ROCKET | MT_PLASMA | MT_ARACHPLAZ | MT_BFG |
| Speed u/tic | 10 | 10 | 15 | 10 | 20 | 20 | 25 | 25 | 25 |
| Speed u/s | 350 | 350 | 525 | 350 | 700 | 700 | 875 | 875 | 875 |
| cells/s (S=64) | 5.47 | 5.47 | 8.20 | 5.47 | 10.94 | 10.94 | 13.67 | 13.67 | 13.67 |
| damage field | 3 | 5 | 8 | 10 | 8 | 20 | 5 | 5 | 100 |
| Impact range | 3–24 | 5–40 | 8–64 | 10–80 | 8–64 | 20–160 | 5–40 | 5–40 | 100–800 |
| radius u | 6 | 6 | 6 | 11 | 6 | 11 | 13 | 13 | 13 |
| homing | no | no | no | **yes** | no | no | no | no | no |
| splash | no | no | no | no | no | **128 Chebyshev** | no | no | no (spray instead) |

**Imp fireball (BAL1)** — fired by Imp `A_TroopAttack` (ranged branch only; melee is a *separate* `(P_Random()%8+1)*3` in the same function). **Engine:** kind `fireball` (exists), base 3.

**Cacodemon ball (BAL2)** — fired by Caco `A_HeadAttack` ranged branch. **CORRECTION:** projectile is **5–40**, not `(P_Random()%6+1)*10`=10–60 (that's the Caco *melee bite*). **Engine:** kind `cacoball`, base 5.

**Bruiser shot (BAL7)** — Baron + Hell Knight share it (`A_BruisAttack` ranged). **CORRECTION:** projectile is **8–64**, not 10–80 (that's the Bruiser *melee claw*). **Engine:** kind `baronball`, base 8.

**Revenant tracer (FATB)** — `A_SkelMissile` sets `mo->tracer = target`. **Homing** (`A_Tracer`): every 4th tic, turn ≤16.875° toward `R_PointToAngle2(target)` (snap on overshoot), recompute momx/momy from new angle, adjust momz ±FRACUNIT/8 toward `target->z + 40`; spawns puff + MT_SMOKE trail; stops if `!dest || dest->health<=0`. Only ~25% of missiles end up homing. **Engine:** kind `tracer`, homing=true, base 10; at 60 Hz approximate "every 4th of 35 tics" as every ~7th fixed step; rotate velocity toward player by `min(angleDiff, 16.875°)` then renormalize to speed.

**Mancubus ball (MANF)** — `A_FatAttack1/2/3`, 6/cycle, FATSPREAD 11.25° fan. **Engine:** kind `fatshot`, base 8; fire pairs at the documented offsets.

**Rocket (MISL)** — player `A_FireMissile` + Cyberdemon `A_CyberAttack` (no homing). Direct **20–160** in `PIT_CheckThing`, plus `A_Explode → P_RadiusAttack(128)` splash: `damage = 128 - (max(|dx|,|dy|) - target.radius)`, clamped, LOS-gated, hits shooter; **Cyber/Spider immune**. **Engine:** kind `rocket`, base 20; on wall/enemy/expire run a radius pass over enemies+player (radius 128/S cells), LOS via `combat.ts`, excluding cyber/spider analogues.

**Plasma (PLSS)** — player `A_FirePlasma`. 5–40, no splash. **Engine:** kind `plasma`, base 5.

**Arachnotron plasma (APLS)** — `A_BspiAttack → MT_ARACHPLAZ`; stat-identical to player plasma (speed 25, damage 5), only sprite (APLS/APBX) differs. **Engine:** kind `aplasma`, base 5 (can reuse `plasma` logic, different sprite).

**BFG ball (BFS1)** — `A_FireBFG`, BFGCELLS=40. Ball direct **100–800**; **no `A_Explode`** — all area effect from the 40-ray spray (see §3.2 BFG). Each ray = sum of 15× `(P_Random()&7)+1`. Spray fans from the player at detonation around the ball's **frozen** firing angle. **Engine:** kind `bfg`, base 100; on detonation fire 40 hitscans across the 90° fan (2.25°/ray, range 1024u).

**Arch-vile fire (FIRE)** — not a flying missile (`info.c speed=0`); it is a visual/damage anchor (`actor->tracer`) repositioned in front of the target each tic. Handled inside Arch-vile logic (§3.1), not the projectile system.

- Sources: per-projectile — [Imp](https://doomwiki.org/wiki/Imp), [Cacodemon](https://doomwiki.org/wiki/Cacodemon), [Baron](https://doomwiki.org/wiki/Baron_of_Hell)/[Hell knight](https://doomwiki.org/wiki/Hell_knight), [Revenant](https://doomwiki.org/wiki/Revenant), [Mancubus](https://doomwiki.org/wiki/Mancubus), [Rocket launcher](https://doomwiki.org/wiki/Rocket_launcher), [Plasma gun](https://doomwiki.org/wiki/Plasma_gun), [Arachnotron](https://doomwiki.org/wiki/Arachnotron), [BFG9000](https://doomwiki.org/wiki/BFG9000); all values from [info.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/info.c), [p_enemy.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_enemy.c), [p_pspr.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_pspr.c), [p_map.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_map.c).

---

### 3.4 Pickups & Powerups

Constants: MAXHEALTH=100; overheal/armor ceiling=200 (hardcoded). Ammo arrays (order am_clip, am_shell, am_cell, am_misl): `clipammo[]={10,4,20,1}`, `maxammo[]={200,50,300,50}`; first backpack doubles maxammo to `{400,100,600,100}`. Box pickups = 5× small. ITYTD/Nightmare double ALL ammo grants. **Dropped** clips/shells give half (5 / 2). Armor absorb in `P_DamageMobj`: green `damage/3` (~33%), blue `damage/2` (50%), integer floor; armortype resets to 0 when armorpoints hits 0. **Powerup durations** convert by REAL SECONDS to 60 Hz frames. Every entry maps to `pickup.ts applyPickup` unless noted.

**Health**
- **Stimpack (STIM, thing 2011):** `P_GiveBody(+10)`, cap 100, **refused if ≥100**. "Picked up a stimpack."
- **Medikit (MEDI, 2012):** `P_GiveBody(+25)`, cap 100, refused if ≥100. "Picked up a medikit." Vanilla quirk: the "REALLY need!" string is chosen by `health<25` *after* the +25 heal, so it essentially never shows — test pre-heal health if you want it.
- **Health bonus (BON1, 2014):** `health++`, cap 200, **always taken**.
- **Soulsphere (SOUL, 2013):** `health += 100`, cap 200, always taken. sfx_getpow.
- **Megasphere (MEGA, 83, Doom II only):** **SETS** `health = 200` AND blue armor 200, always taken.

**Armor**
- **Armor bonus (BON2, 2015):** `armorpoints++`, cap 200; sets green (type 1, 1/3) only if currently unarmored; never downgrades blue. Always taken.
- **Green armor (ARM1, 2018):** `P_GiveArmor(1)` → set armor 100, absorb 1/3; **refused if armorpoints ≥ 100**.
- **Blue armor / Megaarmor (ARM2, 2019):** `P_GiveArmor(2)` → set armor 200, absorb 1/2; **refused if armorpoints ≥ 200**.

**Powerups** (need timers — see §5)
- **Berserk pack (PSTR, 2023):** `P_GiveBody(100)` (heal to 100, **no overheal**), set `pw_strength=1` which **counts UP** each tic (effectively level-long — would only wrap after ~3.9 years). Fist punch ×10 (base 2–20 → **20–200**). Auto-switch to fist. Red tint fade ~20 s (cosmetic, unrelated to the lasting bonus). **CORRECTION:** base punch is `(P_Random()%10+1)<<1` = 2–20, **not** ×3. **Engine:** heal capped 100; set `berserkActive=true` for the level; punch base 2–20, ×10 when berserk; switch to fist.
- **Invulnerability (PINV, 2022):** INVULNTICS = 30·35 = **1050 tics = 30 s**. Immune to all damage except hits ≥1000 (telefrag 10000). Inverse-monochrome palette, blinks when low. sfx_getpow. **Engine:** `invulnTimer = 30 s` (= 1800 frames at 60 Hz); block damage <1000 while >0.
- **Radiation shielding suit (SUIT, 2025):** IRONTICS = 60·35 = **2100 tics = 60 s**. Negates damaging-floor sectors **except sector special type 11** (20%-damage + exit-when-low). Known leak: 6/256 (~2.3%) chance every 32 tics on 20% floors. Does NOT block monster/projectile damage. Re-pickup resets timer (no stack). **Engine:** `radSuitTimer = 60 s`; ignore floor-damage sectors except type-11.
- **Light amplification visor (PVIS, thing 2045 — NOT 2024):** INFRATICS = 120·35 = **4200 tics = 120 s**. Full-bright render of everything except sky. Purely visual. Re-pickup resets. **Engine:** `lightAmpTimer = 120 s`; render all sectors at max light.
- **Computer area map (PMAP, 2026):** `pw_allmap` flag (no timer), reveals all automap lines for the level. **Engine:** `fullMapRevealed = true` (level-scoped).
- **Partial invisibility / Blur sphere (PINS, thing 2024):** INVISTICS = 60·35 = **2100 tics = 60 s**, sets `MF_SHADOW` (cleared at expiry). Monsters targeting a SHADOW player get a large random aim offset (hitscan ~±45°, missiles ~±22.5°); does NOT affect melee, homing missiles, or arch-vile flame. **Engine:** `blurTimer = 60 s`; add random aim offset to monster attacks vs player.

**Ammo** (→ `player.ts giveAmmo`)
- **Backpack (BPAK, 8):** first pickup doubles all maxammo (→ 400/100/600/100) and grants 1 clip of each (10 bullets / 4 shells / 20 cells / 1 rocket); later backpacks only the +1-clip grant. ITYTD/NM doubles the grants.
- **Clip (CLIP, 2007):** +10 bullets (dropped → 5). Max 200/400.
- **Box of bullets (AMMO, 2048):** +50 bullets.
- **4 shotgun shells (SHEL, 2008):** +4 shells (dropped → 2). Max 50/100. (A slain shotgun guy drops a shotgun *weapon* → 8 shells, separate item.)
- **Box of shotgun shells (SBOX, 2049):** +20 shells.
- **Rocket (ROCK, 2010):** +1 rocket (**new ammo kind**). Max 50/100.
- **Box of rockets (BROK, 2046):** +5 rockets.
- **Cell charge (CELL, 2047):** +20 cells (**new ammo kind**). Max 300/600.
- **Cell charge pack (CELP, 17):** +100 cells.

**Keys** (→ `player.ts giveKey`, never refused, not in deathmatch)
- **Blue keycard (BKEY, 5)** / **Blue skull key (BSKU, 40)** → blue lock (interchangeable in vanilla) → `hasBlueKey`.
- **Red keycard (RKEY, 13)** / **Red skull key (RSKU, 38)** → red lock → `hasRedKey`.
- **Yellow keycard (YKEY, 6)** / **Yellow skull key (YSKU, 39)** → yellow lock → `hasYellowKey`.

- Sources: [Stimpack](https://doomwiki.org/wiki/Stimpack), [Medikit](https://doomwiki.org/wiki/Medikit), [Health bonus](https://doomwiki.org/wiki/Health_bonus), [Armor bonus](https://doomwiki.org/wiki/Armor_bonus), [Armor](https://doomwiki.org/wiki/Armor), [Megaarmor](https://doomwiki.org/wiki/Megaarmor), [Supercharge](https://doomwiki.org/wiki/Supercharge), [Megasphere](https://doomwiki.org/wiki/Megasphere), [Berserk](https://doomwiki.org/wiki/Berserk), [Invulnerability](https://doomwiki.org/wiki/Invulnerability), [Radiation shielding suit](https://doomwiki.org/wiki/Radiation_shielding_suit), [Light amplification visor](https://doomwiki.org/wiki/Light_amplification_visor), [Computer area map](https://doomwiki.org/wiki/Computer_area_map), [Partial invisibility](https://doomwiki.org/wiki/Partial_invisibility), [Backpack](https://doomwiki.org/wiki/Backpack), [Ammo](https://doomwiki.org/wiki/Ammo), [Key](https://doomwiki.org/wiki/Key); [p_inter.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/p_inter.c), [doomdef.h](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/doomdef.h), p_pspr.c, p_user.c.

---

### 3.5 Props / Decorations

All decor `spawnhealth = 1000` (not MF_SHOOTABLE) **except the barrel (HP 20)**. All radius 16u / height 16u / mass 100 unless noted. **Fullbright** (frame bit 0x8000) = render ignoring sector light. **Solid** iff flags has MF_SOLID. MF_SPAWNCEILING → z aligned to ceiling (`ceilingheight - height`). Animation tic counts are at 35 Hz — drive a 35 Hz logical clock or scale by 60/35 (~1.714). Values identical Doom/Doom II (shared `info.c`). Target module: a props/decoration list in `world.ts` rendered via `sprites.ts`.

**Explosive barrel (BAR1 / BEXP, thing — MT_BARREL):** HP **20**, **radius 10u, height 42u**, flags MF_SOLID|MF_SHOOTABLE|MF_NOBLOOD. Idle BAR1 A/B @6t (not fullbright). On death: BEXP A(5t)→B(5t, A_Scream sfx_barexp)→C(5t)→D(10t, **A_Explode**)→E(10t)→S_NULL — all 5 frames fullbright, **35 tics = 1.0 s**. `A_Explode = P_RadiusAttack(self, self->target, 128)`: same Chebyshev 128u square splash as the rocket, LOS-gated, `damage = 128 - (max(|dx|,|dy|) - target.radius)` clamped ≥0. **No special upward thrust** (standard horizontal damage kick). **Cyberdemon & Spider Mastermind immune** (concussion). Affects player, other monsters, other barrels → **chain detonation**; kills credited to original shooter via `target`. Explosion sound (frame B) plays ~15 tics *before* damage (frame D). **Engine:** destructible prop HP 20, r10/h42; on death a 5-frame fullbright anim then on the 4th frame apply the radial blast (reuse the rocket's splash routine — `dmg = clamp(128 - chebyshevUnits, 0, 128)`) to every shootable actor (incl. player + barrels, excl. flagged bosses) with LOS, re-triggering barrel destruction for chains.

**Light/lamp props (all MF_SOLID, fullbright):**
- TLMP tall techno lamp (85), TLP2 short techno lamp (86): 4-frame fullbright loop @4t.
- COLU floor/column lamp (2028): single fullbright frame.
- CBRA candelabra (35): single fullbright frame, solid.

**Torches (all MF_SOLID, fullbright, 4-frame @4t loop):** TRED tall red (46), TGRN tall green (45), TBLU tall blue (44), SMRT short red (57), SMGT short green (56), SMBT short blue (55).

**Candle (CAND, 34):** **NON-SOLID** (flags=0, in blockmap but non-blocking), radius 20u, single fullbright frame — the only non-solid light prop.

**Pillars/columns (all MF_SOLID, sector-lit / not fullbright):** COL1 tall green (30), COL2 short green (31), COL3 tall red (32), COL4 short red (33), **COL5 short pillar w/ beating heart (36)** — 2-frame pulse @14t (only animated column), **COL6 short red pillar w/ skull (37)** — single frame.

**Trees (MF_SOLID, sector-lit):** TRE1 torch/burning tree-bush (43) single frame; **TRE2 big brown tree (54) radius 32u** (largest decoration footprint) single frame.

**Hanging victims (all MF_SOLID|MF_SPAWNCEILING|MF_NOGRAVITY, sector-lit, ceiling-anchored, r16):**
- GOR1 twitching victim (49): h68, **4-frame twitch** A(10t)→B(15t)→C(8t)→B(6t) loop (only animated hanging corpse).
- GOR2 arms out (50): h84, single frame. GOR3 one-legged (51): h84. GOR4 pair of legs (52): h68. GOR5 leg (53): h52.
- HDB1 no-guts (73): h88. HDB2 no-guts/brain (74): h88. HDB3 torso down (75): h64. HDB4 torso open skull (76): h64. HDB5 torso up (77): h64. HDB6 torso no-brain (78): h64. (HDB1-6 / POB / BRS art is Doom II-new; values shared.)

**Floor gore on stakes (MF_SOLID, sector-lit unless noted):** POL1 impaled human dead (25) single frame; **POL6 twitching impaled human (26)** 2-frame twitch A(6t)→B(8t); POL2 five skulls (28) single frame; POL4 skull on pole (27) single frame; **POL3 skulls & candles pile (29)** 2-frame fullbright flicker @6t (only self-lit + animated floor gore).

**Non-solid floor decals (render-only / pass-through):**
- POL5 pool of blood/flesh gibs (24): flags=0, r20, in blockmap but non-blocking.
- POB1 large blood pool (79), POB2 small blood pool (80), BRS1 brain stem pool (81): flags=MF_NOBLOCKMAP (never collide at all), r20. Doom II-added.

**Non-solid corpses (flags=0, r20, single static frame):** gibbed player ×2 (PLAY-W, things 10 & 12); dead player (PLAY-N, 15); dead zombieman (POSS-L, 18); dead shotgun guy (SPOS-L, 19); dead imp (TROO-M, 20); dead demon (SARG-N, 21); dead cacodemon (HEAD-L, 22). **Dead lost soul (SKUL-K, 23):** spawnstate is SKUL frame K with **tics=6 → S_NULL** — visible ~6 tics (~0.17 s) then **self-removes** (the only non-static floor-corpse). **CORRECTION:** not "invisible / persists" — it is briefly visible and self-deletes.

**Engine (props general):** static solid billboards collide as r16 (r10 barrel, r32 big tree, r20 several decals/corpses); ceiling props place top at `ceiling - height`; fullbright props ignore sector light; non-solid props skip collision; animated props loop their frame lists on the 35 Hz clock. Reuse one radial-damage routine for both rocket and barrel (P_RadiusAttack 128).

- Sources: [Exploding barrel](https://doomwiki.org/wiki/Exploding_barrel), [Thing types](https://doomwiki.org/wiki/Thing_types), [info.c](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/info.c), p_enemy.c, p_map.c.

---

## 4. Simplification decisions

What we **faithfully implement** vs. **consciously simplify** — so scope is honest. This is a 2D-plane pseudo-3D raycaster at 60 Hz, so some Doom internals are deliberately abstracted.

**Faithfully implemented (canonical):**
- All HP, painchance, damage formulas, ammo amounts/caps, fire cadences, projectile speeds, splash radius & falloff — exact integers from `info.c`/`p_pspr.c`/`p_map.c`.
- Damage *ranges* via `(rand%N)+1` rolls (e.g. {3,6,…,24}, 5/10/15) using the engine RNG.
- Projectile-vs-melee branch selection by range; hitscan-with-spread; per-pellet shotgun spread; multi-shot bursts (Mancubus 6-ball fan, Spider/Chaingunner bursts).
- Splash damage (Chebyshev box, LOS-gated, hurts shooter, Cyber/Spider immune) for rocket + barrel.
- Revenant homing tracer; BFG two-stage ball + 40-ray frozen-angle spray; Lost Soul charge; Pain Elemental skull-spawn with >20 cap and 3-on-death; Arch-vile fire attack + corpse resurrection; barrel chain detonation.
- Powerup timers by real seconds; berserk ×10 fist; pickup accept/refuse rules; backpack max-doubling; dropped-ammo halving.
- Monster infighting (retarget last attacker); Knight↔Baron same-species no-infight; splash immunity for Cyber/Spider.
- Spectre/Blur fuzz render; fullbright vs sector-lit props; solid vs pass-through props; ceiling-anchored hanging props.

**Consciously simplified:**
- **RNG:** use a normal PRNG, not Doom's fixed 256-entry `rndtable`. Damage *distributions* match; exact replayable sequences do not (acceptable — we are not doing demo-compat).
- **Timebase:** AI/animation logic approximated on the 60 Hz step (e.g. "every 4th of 35 tics" → ~every 7th 60 Hz step) rather than a literal 35 Hz playsim. Durations preserved in real seconds.
- **Vertical aim / Z combat:** this is a flat-plane raycaster. Monster missiles aim straight at the player (the vertical lead `target->z + 40`, SSG vertical spread, and autoaim slope are faked or dropped to a slight visual bob). Floating monsters (Caco/Pain) get variable sprite-z for *rendering* but combat is planar.
- **Angles in degrees**, not BAM — spread/turn values converted (e.g. ±5.6°, 11.25°, 16.875°, 2.25°/ray) rather than raw `<<18` / BAM math.
- **Monster movement** uses Doom-Wiki units/sec figures directly (not the per-See-state P_Move tic model).
- **Infighting** is "retarget whatever last hurt me"; we do **not** model the full A_Chase target-memory/threshold edge cases.
- **Lateral / leading projectile aim**, A_Tracer corkscrew smoke puffs, exact muzzle-flash frame alternation, A_VileTarget/A_Fire intermediate frames — visual-only, simplified to the end effect.
- **Vanilla quirks** (Medikit "REALLY need" post-heal test, radsuit 6/256 leak, sk_baby/Nightmare ×2 ammo) — implement the intended behavior; quirks optional.
- **Difficulty scaling** (-fast doubled fireballs, ITYTD double ammo) — single baseline difficulty unless explicitly added.
- **Props** mostly cosmetic; only the **barrel** is interactive. Self-removing dead-lost-soul corpse can be skipped (just don't place one).

---

## 5. New engine mechanics required

Derived from the above; each tied to the entities that need it. Current engine has hitscan-with-spread, billboard projectiles (`fireball`), and melee — these new mechanics extend it.

- [ ] **New ammo kinds: `rockets` + `cells`** (extend `AmmoKind`, `player.ts`, HUD, pickups). — Rocket Launcher, Plasma Rifle, BFG; ROCK/BROK/CELL/CELP/Backpack pickups; Cyberdemon (rockets), Arachnotron (cells-flavored).
- [ ] **Projectile weapons + new `ProjectileKind`s** (`rocket`, `plasma`, `bfg`, `cacoball`, `baronball`, `fatshot`, `tracer`, `aplasma`; extend `projectile.ts` to roll `(rand%8+1)*base` at impact). — Rocket Launcher, Plasma Rifle, BFG; Caco, Baron/Knight, Mancubus, Revenant, Arachnotron, Cyberdemon.
- [ ] **Splash / radius damage system** (Chebyshev box, `damage = 128 - (max(|dx|,|dy|)-radius)`, LOS-gated via `combat.ts lineOfSight`, hurts shooter, immune-list). — Rocket, Explosive barrel, Arch-vile fire, Cyberdemon rockets.
- [ ] **Splash immunity flag** (hardcoded exclude). — Cyberdemon, Spider Mastermind.
- [ ] **Chain detonation** (a barrel's blast re-triggers other barrels' destruction). — Explosive barrel.
- [ ] **Homing tracers** (rotate velocity toward player ≤16.875°/tick, ~7th 60 Hz step, ~25% home-eligible). — Revenant tracer.
- [ ] **BFG two-stage: ball + 40-ray hitscan spray** with the **spray angle frozen to fire-time facing** (90° fan, 2.25°/ray, range 1024u, 15-roll-per-ray damage). — BFG9000.
- [ ] **Vertical hitscan spread** (engine currently horizontal-only). — Super Shotgun (only vanilla hitscan with random vertical spread).
- [ ] **Flying monster support** (MF_FLOAT|MF_NOGRAVITY: variable-z render, altitude-seeking, ignore floor collision). — Cacodemon, Pain Elemental, Lost Soul.
- [ ] **Charge attack mode** (dash straight at player at high speed, contact damage, revert to idle). — Lost Soul.
- [ ] **Skull-spawning with a global live-count cap (>20) + spawn-on-death (3)**. — Pain Elemental (requires Lost Soul kind).
- [ ] **Corpse resurrection** (Arch-vile scans nearby dead, restores spawnhealth/idle/solid, clears target; excludes bosses/gibs/other viles). — Arch-vile.
- [ ] **Arch-vile LOS fire attack** (instant, flat 20 + 0–70 splash + upward thrust, no projectile; nothing if LOS broken on the tick). — Arch-vile.
- [ ] **Fuzz / partial-invisibility render** (MF_SHADOW shader). — Spectre, Partial Invisibility powerup.
- [ ] **Powerup timers (real-seconds → 60 Hz frames)** + their effects: invulnerability (block <1000 dmg, inverse palette), radiation suit (floor-damage immunity), light visor (full-bright render), computer map (automap reveal), partial invisibility (monster aim offset), berserk (×10 fist, level-long, auto-switch). — the six powerups.
- [ ] **Berserk fist multiplier** (×10, base 2–20 → 20–200) + auto-switch to fist. — Berserk pack / Fist.
- [ ] **Backpack max-ammo doubling** (first pickup doubles all four caps to 400/100/600/100). — Backpack.
- [ ] **Dropped-ammo halving** (enemy-dropped clip=5, shells=2). — Zombieman/Shotgun guy drops.
- [ ] **Fullbright prop rendering** + **ceiling-anchored billboards** + **non-solid pass-through props**. — lamps/torches/candles, hanging GOR/HDB, blood pools & corpses.
- [ ] **Monster infighting** (retarget last attacker; Knight↔Baron same-species exempt). — all monsters.
- [ ] **Widen hitscan range to full level (2048u)** — current short ranges are wrong. — all hitscan weapons & hitscan monsters.

---

*All numeric values verified against id Software linuxdoom-1.10 (`info.c`, `p_enemy.c`, `p_pspr.c`, `p_map.c`, `p_inter.c`, `p_user.c`, `doomdef.h`, `p_local.h`) and cross-checked on doomwiki.org. Art is supplied by Freedoom; this document governs behavior only.*
