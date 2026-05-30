// Shared cross-module data contracts. Type-only, zero imports — a dependency leaf.
// Internal/private types live in their own modules; only contracts shared across
// module boundaries belong here.

// ─────────────────────────────────────────────────────────────────────────────
// Geometry & primitives
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number
  y: number
}

/** Seeded pseudo-random source returning a float in [0, 1). */
export type Rng = () => number

/** RGBA pixel buffer the whole engine draws into; presented by the GL/2D layer. */
export interface Framebuffer {
  readonly width: number
  readonly height: number
  /** Length === width * height * 4, RGBA order, row-major. */
  readonly data: Uint8ClampedArray
}

/** A procedurally generated RGBA image. Alpha 0 marks transparent sprite pixels. */
export interface Texture {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** Per-column wall depth produced by the raycaster, consumed for sprite occlusion. */
export type DepthBuffer = Float32Array

// ─────────────────────────────────────────────────────────────────────────────
// Kinds (string-literal unions — avoids enum-member naming rules, stays tree-shakeable)
// ─────────────────────────────────────────────────────────────────────────────

export type WeaponKind =
  | 'fist'
  | 'chainsaw'
  | 'pistol'
  | 'shotgun'
  | 'superShotgun'
  | 'chaingun'
  | 'rocket'
  | 'plasma'
  | 'bfg'
export type AmmoKind = 'bullets' | 'shells' | 'rockets' | 'cells'
export type EnemyKind =
  | 'grunt'
  | 'shotgunGuy'
  | 'chaingunner'
  | 'imp'
  | 'demon'
  | 'spectre'
  | 'lostSoul'
  | 'cacodemon'
  | 'hellKnight'
  | 'baron'
  | 'mancubus'
  | 'arachnotron'
  | 'revenant'
  // Tier-2 bosses + their signature mechanics (doomBehaviorSpec.md §3.1):
  // painElemental spits charging Lost Souls (archetype 'spawner'); archvile is the
  // instant-LOS fire attacker + corpse resurrector (archetype 'vile'); cyberdemon
  // fires splash rockets and spiderMastermind a 3-bullet hitscan burst (both splash-immune).
  | 'painElemental'
  | 'archvile'
  | 'cyberdemon'
  | 'spiderMastermind'
  // Explosive barrel — a stationary, shootable, exploding decor entity modelled as
  // an enemy so the hitscan / projectile / splash damage paths hit it for free.
  | 'barrel'
export type EnemyStateName = 'idle' | 'chase' | 'attack' | 'hurt' | 'dying' | 'dead'
export type ProjectileKind =
  | 'fireball'
  | 'cacoball'
  | 'baronball'
  | 'fatshot'
  | 'tracer'
  | 'aplasma'
  | 'rocket'
  | 'plasma'
  | 'bfg'
export type KeyKind = 'red' | 'blue' | 'yellow'
/**
 * Render-only decoration props (doomBehaviorSpec.md §3.5). Non-colliding billboards
 * (a conscious simplification); the per-kind sprite/anim/ceiling data lives in
 * game/prop.ts PROP_DEFS. Kept here so the Level contract can carry prop spawns.
 */
export type PropKind =
  // Lamps / torches / candles (fullbright).
  | 'techLamp'
  | 'shortTechLamp'
  | 'floorLamp'
  | 'candelabra'
  | 'redTorch'
  | 'greenTorch'
  | 'blueTorch'
  | 'shortRedTorch'
  | 'shortGreenTorch'
  | 'shortBlueTorch'
  | 'candle'
  // Pillars / columns (sector-lit).
  | 'greenPillar'
  | 'shortGreenPillar'
  | 'redPillar'
  | 'shortRedPillar'
  | 'heartPillar'
  | 'skullPillar'
  // Trees.
  | 'torchTree'
  | 'bigTree'
  // Hanging victims (ceiling-anchored).
  | 'hangingVictim'
  | 'hangingArmsOut'
  | 'hangingLeg'
  | 'hangingTorso'
  // Floor corpses / gore (pass-through).
  | 'deadMarine'
  | 'gibbedMarine'
  | 'deadZombie'
  | 'deadShotgunGuy'
  | 'deadImp'
  | 'deadDemon'
  | 'deadCacodemon'
  | 'poolOfBlood'
/** Which powerup a startPowerup() call activates (the timed ones; berserk/allMap are flags). */
export type PowerupKind = 'invuln' | 'radsuit' | 'lightAmp' | 'blur'
/** Armor tiers: green absorbs 1/3, blue absorbs 1/2 (doomBehaviorSpec.md §3.4). */
export type ArmorType = 'none' | 'green' | 'blue'
export type PickupKind =
  // Existing (reinterpreted canonically: health=Stimpack +10/cap100,
  // medkit=Medikit +25/cap100, armor=Green armor set100/cap100).
  | 'health'
  | 'medkit'
  | 'armor'
  | 'bullets'
  // Dropped clip from a slain Zombieman — a HALF clip (5 bullets), the canonical
  // dropped-ammo halving (doomBehaviorSpec.md §3.4 / §5 #18). Reuses the CLIP sprite/icon.
  | 'clipDropped'
  | 'shells'
  | 'shotgun'
  | 'chaingun'
  | 'keyRed'
  | 'keyBlue'
  | 'keyYellow'
  // Health / armor (BON1/BON2/ARM1/ARM2/SOUL/MEGA).
  | 'healthBonus'
  | 'armorBonus'
  | 'greenArmor'
  | 'blueArmor'
  | 'soulsphere'
  | 'megasphere'
  // Powerups (PSTR/PINV/SUIT/PVIS/PMAP/PINS).
  | 'berserk'
  | 'invuln'
  | 'radsuit'
  | 'lightAmp'
  | 'allMap'
  | 'blur'
  // Ammo (BPAK/ROCK/BROK/CELL/CELP/AMMO/SBOX).
  | 'backpack'
  | 'rockets'
  | 'rocketBox'
  | 'cells'
  | 'cellPack'
  | 'bulletBox'
  | 'shellBox'
  // Weapons (SHT2/LAUN/PLAS/BFUG/CSAW).
  | 'superShotgun'
  | 'rocketLauncher'
  | 'plasmaGun'
  | 'bfg'
  | 'chainsaw'
  // Skull keys (RSKU/BSKU/YSKU — same lock as the matching card).
  | 'keySkullRed'
  | 'keySkullBlue'
  | 'keySkullYellow'

/** Top-level screen the engine is currently presenting. */
export type GameMode =
  | 'menu'
  | 'options'
  | 'controls'
  | 'playing'
  | 'paused'
  | 'dead'
  | 'levelComplete'
  | 'victory'

// ─────────────────────────────────────────────────────────────────────────────
// Procedural assets (built once at startup by engine/textures.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-enemy animation frames. The last `die` frame is the resting corpse. */
export interface EnemyVisual {
  readonly walk: readonly Texture[]
  readonly attack: readonly Texture[]
  readonly hurt: readonly Texture[]
  readonly die: readonly Texture[]
}

/** First-person weapon sprites: a steady idle frame plus a firing sequence. */
export interface WeaponVisual {
  readonly idle: Texture
  readonly fire: readonly Texture[]
}

export interface Assets {
  /** Wall textures indexed by tile texture id (see TileDef.wallTexture). Index 0 is a placeholder. */
  readonly wall: readonly Texture[]
  /** Floor/ceiling flats indexed by flat id (see Level.floorFlat / ceilingFlat). */
  readonly flat: readonly Texture[]
  readonly enemy: Readonly<Record<EnemyKind, EnemyVisual>>
  readonly weapon: Readonly<Record<WeaponKind, WeaponVisual>>
  readonly pickup: Readonly<Record<PickupKind, Texture>>
  readonly projectile: Readonly<Record<ProjectileKind, readonly Texture[]>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Map & levels
// ─────────────────────────────────────────────────────────────────────────────

/** Static properties of a tile id. The tile grid stores ids; this table interprets them. */
export interface TileDef {
  readonly solid: boolean
  /** Index into Assets.wall, or -1 when the tile draws no wall (floor/empty). */
  readonly wallTexture: number
  readonly door: boolean
  /** Key required to open a locked door, or null when freely openable / not a door. */
  readonly locked: KeyKind | null
  readonly exit: boolean
  readonly secret: boolean
}

export interface EnemySpawn {
  readonly kind: EnemyKind
  readonly x: number
  readonly y: number
}

export interface PickupSpawn {
  readonly kind: PickupKind
  readonly x: number
  readonly y: number
}

export interface PropSpawn {
  readonly kind: PropKind
  readonly x: number
  readonly y: number
}

/** Authoring form: an ASCII grid + metadata, compiled into a Level by game/map.ts. */
export interface LevelSource {
  readonly name: string
  readonly rows: readonly string[]
  readonly floorFlat: number
  readonly ceilingFlat: number
  /** Player facing at spawn, in radians (0 = +x / east). */
  readonly playerAngle: number
}

/** Runtime level: tile ids in a flat row-major Uint8Array plus extracted spawns. */
export interface Level {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly tiles: Uint8Array
  readonly floorFlat: number
  readonly ceilingFlat: number
  readonly playerStart: Vec2
  readonly playerAngle: number
  readonly enemySpawns: readonly EnemySpawn[]
  readonly pickupSpawns: readonly PickupSpawn[]
  readonly propSpawns: readonly PropSpawn[]
}

/**
 * Read-only view the raycaster & collision query. The live World implements it so
 * dynamic door state participates in rendering, movement and line-of-sight, while
 * the raycaster itself stays pure and unit-testable against a stub.
 */
export interface SceneQuery {
  readonly width: number
  readonly height: number
  readonly floorFlat: number
  readonly ceilingFlat: number
  /** Tile id at a cell; 0 (empty) for out-of-bounds. */
  tileAt(tx: number, ty: number): number
  /** Whether a cell blocks movement/sight right now (open doors are not solid). */
  isSolid(tx: number, ty: number): boolean
  /** Wall texture index to draw for a cell, or -1 for none. */
  wallTextureAt(tx: number, ty: number): number
  /** Door openness 0 (shut) .. 1 (fully open); 0 for non-door cells. */
  doorOpennessAt(tx: number, ty: number): number
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera & rendering
// ─────────────────────────────────────────────────────────────────────────────

export interface Camera {
  readonly pos: Vec2
  /** View angle in radians. */
  readonly angle: number
}

/**
 * A billboarded world sprite to draw after walls, depth-tested against the wall buffer.
 *
 * Two anchoring modes coexist. When `pxH` is set the renderer uses Doom-offset
 * anchoring (the `ox`/`oy` leftoffset/topoffset of an authentic sprite) plus the
 * optional horizontal `flip`, sizing the billboard in atlas pixels. When `pxH` is
 * absent the renderer falls back to the legacy bottom-centre, aspect-fit path driven
 * by `scale`.
 */
export interface SpriteInstance {
  readonly texture: Texture
  readonly pos: Vec2
  /** Size multiplier; 1 ≈ one tile tall, anchored to the floor. */
  readonly scale: number
  /** height above the floor in tiles (0 = floor-anchored) */
  readonly zOffset?: number
  /** Mirror the sprite horizontally (Doom-offset path only). */
  readonly flip?: boolean
  /** Doom leftoffset in atlas pixels; defaults to half the frame width. */
  readonly ox?: number
  /** Doom topoffset in atlas pixels; defaults to the frame height (floor-anchored). */
  readonly oy?: number
  /** Frame width in atlas pixels; defaults to the texture width. */
  readonly pxW?: number
  /** Frame height in atlas pixels; presence selects the Doom-offset anchoring path. */
  readonly pxH?: number
  /** Frame is fullbright (glowing item/projectile/explosion): skip distance shading. */
  readonly bright?: boolean
  /** Render with the partial-invisibility "fuzz" shimmer (Spectre). */
  readonly fuzz?: boolean
}

/** Presenter transform mapping render-buffer pixels onto the on-screen canvas. */
export interface ViewportTransform {
  readonly offsetX: number
  readonly offsetY: number
  /** Buffer-pixel → client-pixel scale factor (integer or fractional). */
  readonly scale: number
}

/** Abstraction over WebGL2 vs Canvas2D presentation of the framebuffer. */
export interface Presenter {
  /** True when a usable drawing context was acquired (false under jsdom/headless w/o GL or 2D). */
  readonly ready: boolean
  /** Recompute the letterboxed transform for a new canvas client size. */
  resize(clientWidth: number, clientHeight: number): void
  /** Upload + draw the framebuffer to the canvas. No-op when not ready. */
  present(frame: Framebuffer): void
  /** Current buffer→client transform (for mapping pointer coordinates). */
  readonly viewport: ViewportTransform
  dispose(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────

/** Edge-triggered navigation signals for menus (true only on the frame pressed). */
export interface NavEdge {
  readonly up: boolean
  readonly down: boolean
  readonly left: boolean
  readonly right: boolean
  readonly confirm: boolean
  readonly back: boolean
}

/** One frame's worth of player intent, produced by engine/input.ts. */
export interface InputFrame {
  readonly moveForward: number // -1..1 (held)
  readonly moveStrafe: number // -1..1 (held)
  readonly turnAxis: number // -1..1 keyboard turn (held)
  readonly mouseDX: number // raw horizontal mouse delta since last poll (pointer lock)
  readonly firing: boolean // fire held (for automatic weapons)
  readonly fire: boolean // fire edge
  readonly run: boolean // run/sprint key held
  readonly use: boolean // use/open-door edge
  readonly nav: NavEdge
  readonly weaponSlot: number // 0 = none this frame, else 1..7
  readonly weaponCycle: -1 | 0 | 1 // -1 = previous, +1 = next, 0 = none this frame
  /** Pointer position in render-buffer coordinates, and click edge — for menu mousing. */
  readonly pointerX: number
  readonly pointerY: number
  readonly pointerDown: boolean
}

/** Rebindable physical-key codes (KeyboardEvent.code values). */
export interface KeyBindings {
  forward: string
  back: string
  turnLeft: string
  turnRight: string
  strafeLeft: string
  strafeRight: string
  run: string
  use: string
  fire: string
  weapon1: string
  weapon2: string
  weapon3: string
  weapon4: string
  weapon5: string
  weapon6: string
  weapon7: string
  weaponNext: string
  weaponPrev: string
}

export type BindingAction = keyof KeyBindings

// ─────────────────────────────────────────────────────────────────────────────
// Settings (persisted)
// ─────────────────────────────────────────────────────────────────────────────

export interface Settings {
  masterVolume: number // 0..1
  sfxVolume: number // 0..1
  musicVolume: number // 0..1
  mouseSensitivity: number // radians per mouse pixel
  mouseLook: boolean
  bindings: KeyBindings
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity definitions (static tuning tables) and live entity state
// ─────────────────────────────────────────────────────────────────────────────

/** How the fire action delivers damage; drives the branch in game/weapon.ts. */
export type WeaponFireMode = 'melee' | 'hitscan' | 'projectile'

/** 35Hz psprite tic rate (Doom info.c). The sim runs at 60Hz; tics are derived. */
export const TICRATE = 35
export const SECONDS_PER_TIC = 1 / TICRATE

/** A_* action pointers dispatched by the psprite tic engine. null = pure animation frame. */
export type PspAction =
  | 'ready'
  | 'lower'
  | 'raise'
  | 'reFire'
  | 'firePistol'
  | 'fireShotgun'
  | 'fireShotgun2'
  | 'fireCGun'
  | 'fireMissile'
  | 'firePlasma'
  | 'fireBFG'
  | 'punch'
  | 'saw'
  | 'gunFlash'
  | 'bfgSound'
  | 'checkReload'
  | 'openShotgun2'
  | 'loadShotgun2'
  | 'closeShotgun2'
  | 'light0'
  | 'light1'
  | 'light2'

/** One psprite state: which sprite frame, how many 35Hz tics, bright flag, action, and next index. */
export interface WeaponPspState {
  readonly sprite: string // e.g. 'PISG' (gun layer) or 'PISF' (flash layer)
  readonly frame: number // 0 = letter 'A', 1 = 'B', … (letterOf(frame)=String.fromCharCode(65+frame))
  readonly tics: number // duration in 35Hz tics; 0 = same-tic fallthrough; <0 forbidden
  readonly bright: boolean // fullbright (flash/muzzle)
  readonly action: PspAction | null
  readonly next: number // index into the weapon's states[]; self-index for 1-tic heads
}

/** Per-weapon psprite state table + named entry indices. flash = -1 when the weapon has no flash layer. */
export interface WeaponStateChain {
  readonly up: number
  readonly down: number
  readonly ready: number
  readonly atk: number
  readonly flash: number // index of the flash-layer head, or -1
  readonly states: readonly WeaponPspState[]
}

export interface DamageSpec {
  readonly sides: number
  readonly mul: number
  readonly berserkBoost?: boolean
}

export interface SpreadSpec {
  readonly horizontal: number
  readonly vertical?: number
}

export interface WeaponDef {
  readonly kind: WeaponKind
  readonly slot: number // 1..7 selection key — source of truth
  readonly ammo: AmmoKind | null // null = melee / costs nothing
  readonly ammoPerShot: number // SSG 2, BFG 40, melee 0
  readonly fireMode: WeaponFireMode
  readonly pellets: number // 1 (pistol) .. 20 (super shotgun)
  readonly automatic: boolean // fires while held (chaingun/plasma)
  readonly damage: DamageSpec
  readonly spread: SpreadSpec
  readonly range: number // hitscan reach in tiles (full-level for guns)
  readonly projectileKind?: ProjectileKind
  /** Phase C hitscan detail (present now, consumed in Phase C). */
  readonly spreadShift?: number // 18 pistol/chaingun/shotgun, 19 SSG
  readonly firstShotAccurate?: boolean // pistol/chaingun
  readonly verticalSlopeShift?: number // SSG = 5
  /** Phase D. */
  readonly meleePull?: boolean // chainsaw only
  readonly chain: WeaponStateChain
  readonly autoSwitchRank: number
}

/**
 * How an enemy delivers damage; drives the AI dispatch in game/enemy.ts.
 * `inert` actors (the explosive barrel) never chase or attack — they only process
 * their hurt/dying/dead timers and animation.
 */
export type EnemyArchetype =
  | 'melee'
  | 'hitscan'
  | 'projectile'
  | 'charger'
  | 'inert'
  // Pain Elemental: faces + chases the player (flying) and SIGNALS a Lost-Soul spawn
  // (enemy.spawnPending) which world.ts consumes — enemy.ts never spawns (world owns
  // the enemies array + the global >20 live-skull cap).
  | 'spawner'
  // Arch-vile: chases fast and performs an instant, LOS-gated FIRE attack (flat 20 +
  // 0..70 distance falloff, no projectile); resurrection is world-side.
  | 'vile'

export interface EnemyDef {
  readonly kind: EnemyKind
  readonly maxHealth: number
  readonly speed: number // tiles per second
  readonly radius: number
  readonly attackRange: number // tiles
  readonly attackCooldown: number // seconds
  readonly painChance: number // 0..1 probability of flinching when hurt
  readonly scale: number // billboard size multiplier
  readonly archetype: EnemyArchetype
  /** Convenience flag = archetype === 'projectile'; kept so existing callers stay terse. */
  readonly ranged: boolean
  /** Ranged/hitscan/charge contact damage = (1 + floor(rng*damageSides)) * damageMul. */
  readonly damageSides: number
  readonly damageMul: number
  /** Bullets per hitscan attack, or projectiles per volley (mancubus 6, else 1). */
  readonly attackShots: number
  /** Hybrid melee branch (imp/caco/revenant) when within meleeRange. */
  readonly hasMelee?: boolean
  readonly meleeSides?: number
  readonly meleeMul?: number
  readonly meleeRange?: number // cells; default config MELEE_RANGE
  /** cells/s for projectile/charger spawn (charger = dash speed). */
  readonly projectileSpeed?: number
  /** float: render with a zOffset, altitude irrelevant on the 2D plane. */
  readonly flying?: boolean
  /** Spectre — render flag. world.ts sets SpriteInstance.fuzz from kind==='spectre'. */
  readonly fuzz?: boolean
  readonly reactionTics?: number
  /** Cyber/Spider bosses ignore radius/splash damage (honoured by world.applySplash). */
  readonly splashImmune?: boolean
  /**
   * Ordinary monster an Arch-vile may resurrect from its corpse (doomBehaviorSpec.md
   * §3.1). True for the rank-and-file roster; false/omitted for bosses, viles, the
   * barrel and the corpse-less Lost Soul (world's resurrection scan honours it).
   */
  readonly raisable?: boolean
  /**
   * Pickup spawned at the corpse on death (doomBehaviorSpec.md §3.1 / §5 #18): the
   * Zombieman drops a half clip ('clipDropped' = 5 bullets), the Shotgun guy/Chaingunner
   * drop their weapon. Omitted ⇒ the kind drops nothing (barrels, bosses, the rest).
   */
  readonly drop?: PickupKind
}

export interface Enemy {
  kind: EnemyKind
  pos: Vec2
  angle: number
  health: number
  state: EnemyStateName
  stateTimer: number // seconds remaining in transient states (hurt/attack/dying)
  animTimer: number // free-running animation clock
  attackTimer: number // cooldown until next attack is allowed
  alive: boolean // false once the death animation has finished (becomes a corpse)
  /** Lost-soul charger: true while dashing toward the player along chargeVel. */
  charging?: boolean
  /** Lost-soul charge velocity (cells/s), set when a charge begins. */
  chargeVel?: Vec2
  /** Mancubus multi-shot index within the current volley. */
  volleyShot?: number
  /**
   * Pain Elemental: queued Lost-Soul spawns the world must consume this tick (the
   * 'spawner' archetype sets it to 1 when in range + off cooldown; A_PainDie queues
   * up to 3 on death). World spawns them (honouring the global >20 cap) and clears it.
   */
  spawnPending?: number
  /** Arch-vile: a just-resurrected corpse this tick — guards against double-processing. */
  justRaised?: boolean
  /** Arch-vile: seconds until the next resurrection scan is allowed. */
  raiseCooldown?: number
  /**
   * Infighting target (doomBehaviorSpec.md §4 / §5 #20): when set to another live enemy,
   * this monster chases + attacks THAT enemy instead of the player. undefined/null = the
   * player. Resolved per tick in updateEnemy (cleared if the target dies); a plain
   * reference, never a recursive structure.
   */
  target?: Enemy | null
}

export interface Projectile {
  kind: ProjectileKind
  pos: Vec2
  vel: Vec2
  damage: number
  fromEnemy: boolean
  alive: boolean
  animTimer: number
  /** Homing (tracer): the enemy index it steers toward; the player when -1. */
  homing?: boolean
  /** Fixed 60Hz step counter so homing turns only on the canonical cadence. */
  steps?: number
  /** BFG: frozen fire-time facing so the spray fan ignores live player turning (the spray
   *  origin POINT re-reads the shooter's live position). */
  originAngle?: number
  /**
   * Infighting (doomBehaviorSpec.md §4 / §5 #20): the enemy that fired this missile (so a
   * non-owner enemy it strikes retaliates against the owner). undefined/null = a player shot.
   */
  owner?: Enemy | null
}

/** What a projectile hit this step — world.ts applies the actual damage. */
export type ProjectileImpactKind = 'none' | 'wall' | 'enemy' | 'player' | 'expire'

export interface ProjectileImpact {
  readonly hit: ProjectileImpactKind
  /** Index into the enemies array when hit === 'enemy', else -1. */
  readonly enemyIndex: number
  /** World-space impact point (for splash centring). */
  readonly pos: Vec2
}

export interface Pickup {
  kind: PickupKind
  pos: Vec2
  active: boolean
}

/** A live decoration prop: a render-only billboard whose anim clock advances each tick. */
export interface Prop {
  kind: PropKind
  pos: Vec2
  /** Free-running animation clock (seconds), advanced by updateProp. */
  animTimer: number
}

export type WeaponState = 'ready' | 'firing' | 'raising' | 'lowering'

export interface Player {
  pos: Vec2
  angle: number
  health: number
  armor: number
  /** Armor tier driving damage absorption: green 1/3, blue 1/2, none 0 (§3.4). */
  armorType: ArmorType
  ammo: Record<AmmoKind, number>
  maxAmmo: Record<AmmoKind, number>
  weapons: Record<WeaponKind, boolean>
  keys: Record<KeyKind, boolean>
  currentWeapon: WeaponKind
  pendingWeapon: WeaponKind | null
  /** Berserk pack active (fist ×10), level-long once picked up. */
  berserk?: boolean
  /** Powerup countdowns in SECONDS; >0 ⇒ active. tickPlayerTimers decays them. */
  invulnTimer: number
  radSuitTimer: number
  lightAmpTimer: number
  blurTimer: number
  /** Computer-area-map flag (level-scoped; no automap exists yet). */
  allMapRevealed: boolean
  /** Backpack claimed: maxAmmo already doubled, later backpacks only top up clips. */
  hasBackpack: boolean
  weaponState: WeaponState
  /** Derived current gun-layer frame letter index (= chain.states[pspIndex].frame); read by the
   *  procedural HUD fallback. Written by the tic engine whenever pspIndex changes. */
  weaponFrame: number
  /** Psprite tic cursor (35Hz state machine, src/doom/game/weapon.ts). */
  pspIndex: number // current gun-layer state index into currentWeapon's chain.states
  pspTics: number // tics remaining in the current gun-layer state
  flashIndex: number // current flash-layer state index, -1 = no flash active
  flashTics: number // tics remaining in flash state
  refireCount: number // A_ReFire counter; 0 = first shot
  pspSy: number // weapon Y slide, 32 (WEAPONTOP) .. 128 (WEAPONBOTTOM)
  ticAccumulator: number // seconds carried toward the next 35Hz tic
  extralight: number // 0/1/2 muzzle-flash screen light (consumed by hud.renderFlash)
  attackLatch: boolean // edge/held attack latched until consumed by a ready/refire tic
  bulletSlope: number // always 0 (Phase C autoaim hook); SSG perturbs per-pellet locally
  bob: number // 0..1 smoothed movement speed (Phase B)
  bobPhase: number // bob oscillator phase (Phase B)
  /** Recent damage flash 0..1 and pickup flash 0..1, for HUD/screen tint; decays over time. */
  damageFlash: number
  pickupFlash: number
  /** Transient HUD message + its remaining display time (seconds). */
  message: string
  messageTimer: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat
// ─────────────────────────────────────────────────────────────────────────────

export interface HitscanResult {
  /** Index into the enemies array of the nearest enemy struck before any wall, else -1. */
  readonly enemyIndex: number
  /** Distance to the impact point (enemy or wall) in tiles. */
  readonly distance: number
  /** World-space impact point. */
  readonly point: Vec2
  /** True when an enemy (not just a wall) was hit. */
  readonly hitEnemy: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu plumbing — menus emit actions; the engine applies them.
// ─────────────────────────────────────────────────────────────────────────────

export type MenuAction =
  | { readonly type: 'none' }
  | { readonly type: 'newGame' }
  | { readonly type: 'resume' }
  | { readonly type: 'goto'; readonly screen: GameMode }
  | { readonly type: 'quitToMenu' }
  | { readonly type: 'quit' }
  | { readonly type: 'nextLevel' }
  | { readonly type: 'restart' }
  | { readonly type: 'setMasterVolume'; readonly value: number }
  | { readonly type: 'setSfxVolume'; readonly value: number }
  | { readonly type: 'setMusicVolume'; readonly value: number }
  | { readonly type: 'setSensitivity'; readonly value: number }
  | { readonly type: 'toggleMouseLook' }
  | { readonly type: 'rebind'; readonly action: BindingAction; readonly code: string }

/** Mutable cursor/scroll state for the canvas menus, owned by the engine. */
export interface MenuState {
  cursor: number
  /** When set, the controls screen is capturing the next key press for this action. */
  rebinding: BindingAction | null
  /** screen that OPTIONS/CONTROLS returns to (pause vs main menu) */
  returnTo: GameMode | null
}
