// The live simulation. World owns the player, enemies, projectiles, pickups and
// per-cell door state, implementing SceneQuery so the raycaster / collision /
// line-of-sight queries see dynamic door openness. `update` drives one tick of
// the whole simulation and returns the events the engine maps to sfx + mode
// changes; `buildSprites` produces the billboards to draw after the walls.

import {
  DOOR_OPEN_TIME,
  DOOR_PASSABLE_AT,
  DOOR_SPEED,
  PICKUP_RADIUS,
  USE_RANGE,
} from '~/doom/config'
import type {
  Assets,
  Camera,
  Enemy,
  InputFrame,
  KeyKind,
  Level,
  Pickup,
  Player,
  Projectile,
  ProjectileImpact,
  Prop,
  Rng,
  SceneQuery,
  Settings,
  SpriteInstance,
  Texture,
  Vec2,
  WeaponKind,
} from '~/doom/types'
import { approach } from '~/doom/core/math'
import { dist } from '~/doom/core/vec'
import { hitscan, lineOfSight, splashDamage } from '~/doom/game/combat'
import { cellIndex, tileDef } from '~/doom/game/map'
import {
  createPlayer,
  damagePlayer,
  requestWeapon,
  setMessage,
  tickPlayerTimers,
  updatePlayerMovement,
} from '~/doom/game/player'
import type { SpriteAtlas } from '~/doom/engine/sprites/spriteAtlas'
import { spriteRotation } from '~/doom/engine/sprites/spriteAtlas'
import { PICKUP_SPRITE } from '~/doom/game/pickupSprites'
import { ACTOR_DEFS, resolveActorFrame } from '~/doom/game/actorDefs'
import type { ActorPhase } from '~/doom/game/actorDefs'
import {
  damageEnemy,
  enemyDef,
  enemyFrame,
  spawnEnemy,
  startLostSoulCharge,
  updateEnemy,
} from '~/doom/game/enemy'
import { PROJECTILE_DEFS, projectileFrame, updateProjectile } from '~/doom/game/projectile'
import { tryFire, updateWeapon, weaponBySlot, weaponDef } from '~/doom/game/weapon'
import { applyPickup, spawnPickup } from '~/doom/game/pickup'
import { PROP_DEFS, propFrameLetter, spawnProp, updateProp } from '~/doom/game/prop'

/** Door motion phase: shut, sliding open, held fully open, or sliding closed. */
type DoorPhase = 'shut' | 'opening' | 'open' | 'closing'

/** Per-kind billboard scale for projectiles (enemies/pickups carry their own). */
const PROJECTILE_SCALE = 0.4
/** Height above the floor (in tiles) projectiles fly at, so they don't roll along it. */
const PROJECTILE_Z_OFFSET = 0.4
/** Height above the floor (in tiles) flying enemies (caco, lost soul) hover at. */
const FLYING_Z_OFFSET = 0.6
/** Fallback billboard scale for any pickup. */
const PICKUP_SCALE = 0.55
/** Pickup float: base lift (cells) + bob amplitude, advanced by a per-world clock. */
const PICKUP_BOB = 0.18
const PICKUP_BOB_AMP = 0.06

/** Ceiling-anchored props (hanging victims) hang this many cells below the ceiling. */
const CEILING_PROP_Z_OFFSET = 1.2

/** Player collision radius (cells) used as the splash target radius for the player. */
const PLAYER_SPLASH_RADIUS = 0.22
/** BFG spray: 40 tracer rays across a 90° fan, 2.25°/ray, range 16 cells (1024u). */
const BFG_RAYS = 40
const BFG_FAN = Math.PI / 2
const BFG_RAY_STEP = BFG_FAN / BFG_RAYS
const BFG_RAY_RANGE = 16

/** Pain Elemental: hard cap on simultaneously-live Lost Souls (doomBehaviorSpec.md §3.1). */
const LOST_SOUL_CAP = 20
/** A spit Lost Soul appears this many cells in front of the Pain Elemental (prestep). */
const PAIN_SKULL_PRESTEP = 0.6
/** A_PainDie spawns up to this many Lost Souls in a ring on the elemental's death. */
const PAIN_DEATH_SKULLS = 3
/** Arch-vile resurrection: a corpse within this range (cells) may be raised. */
const VILE_RAISE_RANGE = 3.0
/** Seconds between Arch-vile resurrection scans (one revive per window). */
const VILE_RAISE_COOLDOWN = 1.5

export interface WorldEvents {
  readonly fired: WeaponKind | null
  readonly dryFired: boolean
  readonly doorOpened: boolean
  readonly enemyHurt: boolean
  readonly enemyDied: boolean
  readonly playerHurt: boolean
  readonly pickedUp: boolean
  readonly playerDead: boolean
  readonly reachedExit: boolean
}

export interface WorldStats {
  readonly kills: number
  readonly totalEnemies: number
  readonly level: string
}

export class World implements SceneQuery {
  readonly width: number
  readonly height: number
  readonly floorFlat: number
  readonly ceilingFlat: number

  private readonly name: string
  private readonly tiles: Uint8Array
  private readonly assets: Assets
  private readonly rng: Rng
  private settings: Settings

  private readonly _player: Player
  private readonly enemies: Enemy[] = []
  private readonly projectiles: Projectile[] = []
  private readonly pickups: Pickup[] = []
  private readonly props: Prop[] = []
  /** Indices into `enemies` of barrels that have already detonated (no re-chaining). */
  private readonly detonated = new Set<number>()

  /** Per-cell door openness 0 (shut) .. 1 (fully open), keyed by cellIndex. */
  private readonly doorOpenness: Float32Array
  /** Per-cell hold timer counting down while a door rests fully open. */
  private readonly doorHold: Float32Array
  /** Per-cell door motion phase, keyed by cellIndex. */
  private readonly doorPhase: DoorPhase[]

  private kills = 0
  private readonly totalEnemies: number
  private exited = false
  /** Free-running clock (seconds) driving the cosmetic pickup bob. */
  private bobClock = 0

  /** Authentic sprite atlas, swapped in once loaded; null = procedural fallback. */
  private spriteAtlas: SpriteAtlas | null = null

  constructor(level: Level, assets: Assets, rng: Rng, settings: Settings) {
    this.width = level.width
    this.height = level.height
    this.floorFlat = level.floorFlat
    this.ceilingFlat = level.ceilingFlat
    this.name = level.name
    this.assets = assets
    this.rng = rng
    this.settings = settings

    // Own a private copy of the tile grid so the World is self-contained.
    this.tiles = new Uint8Array(level.tiles)

    const cells = this.width * this.height
    this.doorOpenness = new Float32Array(cells)
    this.doorHold = new Float32Array(cells)
    this.doorPhase = new Array<DoorPhase>(cells).fill('shut')

    this._player = createPlayer(level.playerStart, level.playerAngle)

    for (const spawn of level.enemySpawns) {
      this.enemies.push(spawnEnemy(spawn.kind, spawn.x, spawn.y))
    }
    // Barrels are decor (excluded). Lost Souls have NO MF_COUNTKILL in Doom II (§3.1)
    // AND a Pain Elemental breeds more at runtime — excluding them keeps kills ≤ total.
    // The 4 tier-2 bosses ARE monsters and DO count toward the total.
    this.totalEnemies = this.enemies.filter(e => !isUncounted(e.kind)).length

    for (const spawn of level.pickupSpawns) {
      this.pickups.push(spawnPickup(spawn.kind, spawn.x, spawn.y))
    }

    for (const spawn of level.propSpawns) {
      this.props.push(spawnProp(spawn.kind, spawn.x, spawn.y))
    }
  }

  /** Swap in the live Settings so movement reads current mouse-look + sensitivity. */
  setSettings(settings: Settings): void {
    this.settings = settings
  }

  /** Swap in (or clear) the authentic sprite atlas; null reverts to the procedural look. */
  setSpriteAtlas(atlas: SpriteAtlas | null): void {
    this.spriteAtlas = atlas
  }

  // ── SceneQuery ──────────────────────────────────────────────────────────────

  /** Tile id at a cell; 0 (empty) for out-of-bounds. */
  tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
      return 0
    }
    return this.tiles[cellIndex(this.width, tx, ty)] ?? 0
  }

  /** Solid per TILE_DEFS, except an open-enough door / secret cell is passable. */
  isSolid(tx: number, ty: number): boolean {
    const def = tileDef(this.tileAt(tx, ty))
    if (!def.solid) {
      return false
    }
    if (def.door || def.secret) {
      return this.doorOpennessAt(tx, ty) < DOOR_PASSABLE_AT
    }
    return true
  }

  /** Wall texture index to draw for a cell, or -1 for none. */
  wallTextureAt(tx: number, ty: number): number {
    return tileDef(this.tileAt(tx, ty)).wallTexture
  }

  /** Openness 0..1 for slidable cells (doors + secret walls); 0 for everything else. */
  doorOpennessAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
      return 0
    }
    const def = tileDef(this.tileAt(tx, ty))
    if (!def.door && !def.secret) {
      return 0
    }
    return this.doorOpenness[cellIndex(this.width, tx, ty)] ?? 0
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get player(): Player {
    return this._player
  }

  get camera(): Camera {
    return { pos: this._player.pos, angle: this._player.angle }
  }

  get stats(): WorldStats {
    return { kills: this.kills, totalEnemies: this.totalEnemies, level: this.name }
  }

  /**
   * Read-only snapshot of every entity's kind + live state, plus its infight target's kind
   * (null = hunting the player) — for tests / a debug HUD. The target kind lets a test see a
   * retarget (doomBehaviorSpec.md §4 / §5 #20) without exposing the mutable enemies array.
   */
  get enemyStates(): readonly {
    kind: Enemy['kind']
    state: Enemy['state']
    targetKind: Enemy['kind'] | null
  }[] {
    return this.enemies.map(e => ({
      kind: e.kind,
      state: e.state,
      targetKind: e.target?.kind ?? null,
    }))
  }

  /** Read-only snapshot of every prop's kind + anim clock (for tests / debug HUD). */
  get propStates(): readonly { kind: Prop['kind']; animTimer: number }[] {
    return this.props.map(p => ({ kind: p.kind, animTimer: p.animTimer }))
  }

  // ── Simulation tick ─────────────────────────────────────────────────────────

  update(input: InputFrame, dt: number): WorldEvents {
    const player = this._player
    const healthBefore = player.health
    this.bobClock += dt

    // 1. Player movement (turn + collide-and-slide) using the live Settings so
    //    mouse sensitivity + mouse-look toggles take effect immediately.
    updatePlayerMovement(player, this, input, this.settings, dt)

    // 2. Use: open the nearest door (or recede a secret wall) within reach.
    const doorOpened = input.use ? this.tryUseDoor() : false

    // 3. Weapon selection + firing.
    const weaponPhase = this.updateWeaponPhase(input, dt)
    const fired = weaponPhase.fired
    const dryFired = weaponPhase.dryFired

    // 4. Enemies — count freshly finished deaths into kills (barrels are decor: they
    //    never count, but a barrel that just started dying detonates a radius blast).
    let enemyHurt = false
    let enemyDied = false
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]
      if (enemy === undefined) {
        continue
      }
      const aliveBefore = enemy.alive
      const stateBefore = enemy.state
      enemy.justRaised = false
      updateEnemy(enemy, player, this, this.projectiles, this.enemies, this.rng, dt)
      if (enemy.state === 'hurt' && stateBefore !== 'hurt') {
        enemyHurt = true
      }
      if (enemy.kind === 'barrel') {
        // Detonate the first frame a barrel is dying/dead and hasn't blown yet. The
        // `detonated` set makes this idempotent so a chain (splash → other barrels
        // start dying) can't re-detonate the same barrel or loop forever.
        if ((enemy.state === 'dying' || enemy.state === 'dead') && !this.detonated.has(i)) {
          this.detonateBarrel(i)
        }
        continue
      }
      // Pain Elemental: consume queued skull spawns + breed 3 on death (global cap).
      if (enemy.kind === 'painElemental') {
        this.servicePainElemental(enemy)
      }
      // Arch-vile: while chasing, resurrect one nearby raisable corpse per scan window.
      if (enemy.kind === 'archvile') {
        this.serviceArchvile(enemy, dt)
      }
      if (aliveBefore && !enemy.alive) {
        // Death-transition frame (fires exactly once): drop the kind's pickup, if any
        // (Zombieman → half clip, Shotgun guy → shotgun, Chaingunner → chaingun; §3.1).
        this.spawnEnemyDrop(enemy)
        if (!isUncounted(enemy.kind)) {
          this.kills++
          enemyDied = true
        }
      }
    }

    // 5. Projectiles — advance + collide (cycle-safe; the descriptor comes back
    //    here), then apply all damage / splash / BFG spray, then prune the dead.
    for (const proj of this.projectiles) {
      const impact = updateProjectile(proj, this, player, this.enemies, dt)
      if (impact.hit !== 'none') {
        this.applyProjectileImpact(proj, impact)
      }
    }
    pruneDead(this.projectiles)

    // 5b. Props — advance each decoration's animation clock (render-only).
    for (const prop of this.props) {
      updateProp(prop, dt)
    }

    // 6. Doors — animate openness, auto-close after the hold (never onto an entity).
    this.animateDoors(dt)

    // 7. Pickups — grab any active pickup the player is standing on.
    const pickedUp = this.collectPickups()

    // 8. Exit — stepping onto an exit tile completes the level (once).
    const reachedExit = this.checkExit()

    // 9. Decay HUD flashes + message timers.
    tickPlayerTimers(player, dt)

    const playerHurt = player.health < healthBefore
    const playerDead = player.health <= 0

    return {
      fired,
      dryFired,
      doorOpened,
      enemyHurt,
      enemyDied,
      playerHurt,
      pickedUp,
      playerDead,
      reachedExit,
    }
  }

  /**
   * Apply a projectile's resolved outcome. Direct damage goes to the struck enemy
   * or the player; splash kinds blast a radius around the impact point; BFG-spray
   * kinds fan 40 hitscans from the FROZEN firing origin/angle. world owns this so
   * the projectile module never imports enemy/player/combat (no import cycle).
   */
  private applyProjectileImpact(proj: Projectile, impact: ProjectileImpact): void {
    const pdef = PROJECTILE_DEFS[proj.kind]

    if (impact.hit === 'enemy') {
      const enemy = this.enemies[impact.enemyIndex]
      if (enemy !== undefined) {
        // An ENEMY missile striking a DIFFERENT enemy is infighting: provoke the victim
        // (retarget the owner) + damage it, UNLESS they are the exempt Knight/Baron pair
        // (which passes through unharmed). Player shots always just deal damage. (§4 / §5 #20)
        const owner = proj.owner ?? null
        if (proj.fromEnemy && owner !== null && owner !== enemy) {
          this.provokeInfight(enemy, owner, proj.damage)
        } else {
          damageEnemy(enemy, proj.damage, this.rng)
        }
      }
    } else if (impact.hit === 'player') {
      damagePlayer(this._player, proj.damage)
    }

    if (pdef.splashCells !== undefined) {
      this.applySplash(impact.pos, this.rng)
    }
    if (pdef.bfgSpray === true) {
      this.fireBfgSpray(proj)
    }
  }

  /**
   * Infighting (doomBehaviorSpec.md §4 / §5 #20): an enemy missile hit `victim`, fired by
   * `attacker`. UNLESS they belong to the same exempt species (the Knight/Baron pair, which
   * never infight), the victim retargets the attacker and takes the missile damage (which
   * also wakes it via damageEnemy). The exempt pair passes through: no damage, no retarget.
   */
  private provokeInfight(victim: Enemy, attacker: Enemy, damage: number): void {
    if (sameInfightSpecies(victim.kind, attacker.kind)) {
      return
    }
    // Only retarget a still-fighting attacker — never lock onto one that already died on
    // the same tick (resolveTarget would clear it next frame, but skip the dead pointer now).
    if (attacker.alive && attacker.state !== 'dead' && attacker.state !== 'dying') {
      victim.target = attacker
    }
    damageEnemy(victim, damage, this.rng)
  }

  /**
   * Drop the slain enemy's pickup at its corpse (doomBehaviorSpec.md §3.1 / §5 #18). Only
   * kinds with a `drop` in ENEMY_DEFS leave anything (Zombieman → half clip, Shotgun guy →
   * shotgun, Chaingunner → chaingun); barrels / bosses / the rest drop nothing. Called once
   * on the death-transition frame, so there is no double-spawn.
   */
  private spawnEnemyDrop(enemy: Enemy): void {
    const drop = enemyDef(enemy.kind).drop
    if (drop === undefined) {
      return
    }
    this.pickups.push(spawnPickup(drop, enemy.pos.x, enemy.pos.y))
  }

  /**
   * Detonate barrel `index`: mark it spent (so it never re-chains) then apply the
   * same 128u Chebyshev splash a rocket uses, centred on the barrel. The blast
   * damages monsters, the player AND other barrels (each newly-dying barrel is
   * detonated by the update loop in turn → chain detonation), all LOS-gated.
   */
  private detonateBarrel(index: number): void {
    this.detonated.add(index)
    const barrel = this.enemies[index]
    if (barrel === undefined) {
      return
    }
    this.applySplash({ x: barrel.pos.x, y: barrel.pos.y }, this.rng)
  }

  /**
   * Chebyshev radius blast (rocket / barrel): every live, non-immune enemy within
   * the falloff and in line-of-sight takes splash; the player takes it too (splash
   * hurts the shooter). Damage is the pure combat.splashDamage falloff.
   */
  private applySplash(center: Vec2, rng: Rng): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.state === 'dead' || enemy.state === 'dying') {
        continue
      }
      const def = enemyDef(enemy.kind)
      if (def.splashImmune === true) {
        continue
      }
      const d = splashDamage(center, enemy.pos, def.radius)
      if (d > 0 && lineOfSight(this, center, enemy.pos)) {
        damageEnemy(enemy, d, rng)
      }
    }
    const player = this._player
    const pd = splashDamage(center, player.pos, PLAYER_SPLASH_RADIUS)
    if (pd > 0 && lineOfSight(this, center, player.pos)) {
      damagePlayer(player, pd)
    }
  }

  /** Count Lost Souls that are alive and not in their death sequence (for the >20 cap). */
  private liveLostSouls(): number {
    let n = 0
    for (const e of this.enemies) {
      if (e.kind === 'lostSoul' && e.alive && e.state !== 'dead' && e.state !== 'dying') {
        n++
      }
    }
    return n
  }

  /**
   * Spawn ONE charging Lost Soul a short prestep in front of `origin` (the Pain
   * Elemental), gated by the global >20 cap. Returns true when a skull was spawned.
   * The new skull is immediately launched into its dash at the player so it behaves
   * exactly like the canonical A_PainShootSkull → A_SkullAttack (§3.1).
   */
  private spawnPainSkull(origin: Enemy): boolean {
    if (this.liveLostSouls() >= LOST_SOUL_CAP) {
      return false
    }
    const x = origin.pos.x + Math.cos(origin.angle) * PAIN_SKULL_PRESTEP
    const y = origin.pos.y + Math.sin(origin.angle) * PAIN_SKULL_PRESTEP
    const skull = spawnEnemy('lostSoul', x, y)
    // Guard the freshly-spawned skull from being re-processed as a spawner this tick.
    skull.justRaised = true
    startLostSoulCharge(skull, this._player)
    this.enemies.push(skull)
    return true
  }

  /**
   * Pain Elemental orchestration (doomBehaviorSpec.md §3.1). While alive it spits one
   * charging Lost Soul per queued `spawnPending` (cap-gated); the first frame it starts
   * dying it breeds up to 3 in a ring (A_PainDie), each still cap-gated. `painDied`
   * tracks the one-shot death burst via the same idempotent `detonated` set the barrel
   * uses, so a re-entrant spawn can never double-breed.
   */
  private servicePainElemental(pain: Enemy): void {
    if (pain.alive && (pain.spawnPending ?? 0) > 0) {
      this.spawnPainSkull(pain)
      pain.spawnPending = 0
    }
    const dyingNow = pain.state === 'dying' || pain.state === 'dead'
    const idx = this.enemies.indexOf(pain)
    if (dyingNow && idx >= 0 && !this.detonated.has(idx)) {
      this.detonated.add(idx)
      for (let s = 0; s < PAIN_DEATH_SKULLS; s++) {
        // Ring of skulls: nudge the elemental's facing 90° apart so they fan out.
        pain.angle += Math.PI / 2
        if (!this.spawnPainSkull(pain)) {
          break
        }
      }
    }
  }

  /**
   * Arch-vile resurrection (doomBehaviorSpec.md §3.1). While the vile is chasing/attacking
   * and off its scan cooldown, look for the nearest CORPSE within VILE_RAISE_RANGE that is
   * `raisable` (true on the rank-and-file roster; never bosses / viles / barrel / Lost Soul),
   * and restore it: full health, alive, back to chasing, death timers cleared. One revive
   * per window. Bounded: a single corpse, never the vile itself.
   */
  private serviceArchvile(vile: Enemy, dt: number): void {
    if (!vile.alive || vile.state === 'dying' || vile.state === 'dead') {
      return
    }
    vile.raiseCooldown = Math.max(0, (vile.raiseCooldown ?? 0) - dt)
    if (vile.raiseCooldown > 0) {
      return
    }
    const corpse = this.findRaisableCorpse(vile)
    if (corpse === null) {
      return
    }
    const def = enemyDef(corpse.kind)
    corpse.health = def.maxHealth
    corpse.alive = true
    corpse.state = 'chase'
    corpse.stateTimer = 0
    corpse.animTimer = 0
    corpse.charging = false
    corpse.chargeVel = undefined
    corpse.justRaised = true
    vile.raiseCooldown = VILE_RAISE_COOLDOWN
  }

  /** Nearest dead, raisable corpse within VILE_RAISE_RANGE of `vile` (never the vile). */
  private findRaisableCorpse(vile: Enemy): Enemy | null {
    let best: Enemy | null = null
    let bestDist = VILE_RAISE_RANGE
    for (const e of this.enemies) {
      if (e === vile || e.state !== 'dead' || e.alive) {
        continue
      }
      if (enemyDef(e.kind).raisable !== true) {
        continue
      }
      const d = dist(vile.pos, e.pos)
      if (d <= bestDist) {
        best = e
        bestDist = d
      }
    }
    return best
  }

  /**
   * BFG spray: on the ball's impact, fire BFG_RAYS hitscans across a 90° fan around
   * the FROZEN firing angle (BFG_RAY_STEP per ray), from the FROZEN firing origin —
   * turning after firing must not change the spray. Each ray that hits an enemy
   * deals the sum of 15 dice rolls (1+floor(rng*8)) — 15..120 (realized ~49..87).
   */
  private fireBfgSpray(proj: Projectile): void {
    const origin = proj.originPos ?? proj.pos
    const baseAngle = proj.originAngle ?? Math.atan2(proj.vel.y, proj.vel.x)
    const start = baseAngle - BFG_FAN / 2
    for (let i = 0; i < BFG_RAYS; i++) {
      const angle = start + i * BFG_RAY_STEP
      const result = hitscan(this, this.enemies, origin, angle, BFG_RAY_RANGE)
      if (!result.hitEnemy) {
        continue
      }
      const enemy = this.enemies[result.enemyIndex]
      if (enemy === undefined) {
        continue
      }
      let dmg = 0
      for (let r = 0; r < 15; r++) {
        dmg += 1 + Math.floor(this.rng() * 8)
      }
      damageEnemy(enemy, dmg, this.rng)
    }
  }

  /**
   * Map the weapon slot, run the switch/fire phase, then fire when intent + ready.
   * Automatic weapons (chaingun) repeat while the key is held; the rest need a
   * fresh press per shot. `dryFired` reports the empty-click case (trigger pulled
   * with no ammo) so the engine can play a distinct sound from a real shot.
   */
  private updateWeaponPhase(
    input: InputFrame,
    dt: number,
  ): {
    fired: WeaponKind | null
    dryFired: boolean
  } {
    const player = this._player

    if (input.weaponSlot > 0) {
      const kind = weaponBySlot(input.weaponSlot, player)
      if (kind !== null) {
        requestWeapon(player, kind)
      }
    }

    updateWeapon(player, dt)

    const def = weaponDef(player.currentWeapon)
    const wantsToFire = def.automatic ? input.firing : input.fire
    if (wantsToFire && player.weaponState === 'ready') {
      const outcome = tryFire(player, this, this.enemies, this.projectiles, this.rng)
      if (outcome.fired) {
        return { fired: outcome.soundKind, dryFired: false }
      }
      // Ready + intent but no shot ⇒ empty trigger pull (out of ammo).
      return { fired: null, dryFired: true }
    }
    return { fired: null, dryFired: false }
  }

  /**
   * Find the nearest slidable cell (door or secret wall) within USE_RANGE and begin
   * opening it (key permitting). Secret walls recede on use exactly like a door,
   * reusing the openness machinery so isSolid flips and the raycaster slides them.
   */
  private tryUseDoor(): boolean {
    const player = this._player
    const px = player.pos.x
    const py = player.pos.y
    const minX = Math.max(0, Math.floor(px - USE_RANGE))
    const maxX = Math.min(this.width - 1, Math.floor(px + USE_RANGE))
    const minY = Math.max(0, Math.floor(py - USE_RANGE))
    const maxY = Math.min(this.height - 1, Math.floor(py + USE_RANGE))

    let bestIdx = -1
    let bestTx = -1
    let bestTy = -1
    let bestDist = USE_RANGE
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const def = tileDef(this.tileAt(tx, ty))
        if (!def.door && !def.secret) {
          continue
        }
        const d = dist(player.pos, { x: tx + 0.5, y: ty + 0.5 })
        if (d <= bestDist) {
          bestDist = d
          bestIdx = cellIndex(this.width, tx, ty)
          bestTx = tx
          bestTy = ty
        }
      }
    }

    if (bestIdx < 0) {
      return false
    }

    const def = tileDef(this.tileAt(bestTx, bestTy))
    const locked = def.locked
    if (locked !== null && !this.hasKey(locked)) {
      setMessage(player, `YOU NEED THE ${locked.toUpperCase()} KEY`)
      return false
    }

    const phase = this.doorPhase[bestIdx] ?? 'shut'
    if (phase === 'open') {
      // Already open — pet the hold timer so it stays open a while longer.
      this.doorHold[bestIdx] = DOOR_OPEN_TIME
      return false
    }
    if (phase === 'opening') {
      return false
    }
    // shut or closing → (re)start opening.
    this.doorPhase[bestIdx] = 'opening'
    return true
  }

  private hasKey(key: KeyKind): boolean {
    return this._player.keys[key] === true
  }

  /** Advance every door's openness toward its phase target; auto-close after the hold. */
  private animateDoors(dt: number): void {
    const step = DOOR_SPEED * dt
    for (let idx = 0; idx < this.doorPhase.length; idx++) {
      const phase = this.doorPhase[idx] ?? 'shut'
      if (phase === 'shut') {
        continue
      }
      const openness = this.doorOpenness[idx] ?? 0

      if (phase === 'opening') {
        const next = approach(openness, 1, step)
        this.doorOpenness[idx] = next
        if (next >= 1) {
          this.doorPhase[idx] = 'open'
          this.doorHold[idx] = DOOR_OPEN_TIME
        }
        continue
      }

      if (phase === 'open') {
        const hold = (this.doorHold[idx] ?? 0) - dt
        this.doorHold[idx] = hold
        if (hold <= 0 && !this.entityInCell(idx)) {
          this.doorPhase[idx] = 'closing'
        }
        continue
      }

      // closing
      if (this.entityInCell(idx)) {
        // Something walked under the door — reopen rather than crush it.
        this.doorPhase[idx] = 'opening'
        continue
      }
      const next = approach(openness, 0, step)
      this.doorOpenness[idx] = next
      if (next <= 0) {
        this.doorPhase[idx] = 'shut'
      }
    }
  }

  /** True when the player or a live enemy occupies the door cell at `idx`. */
  private entityInCell(idx: number): boolean {
    const tx = idx % this.width
    const ty = Math.floor(idx / this.width)
    const player = this._player
    if (Math.floor(player.pos.x) === tx && Math.floor(player.pos.y) === ty) {
      return true
    }
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        continue
      }
      if (Math.floor(enemy.pos.x) === tx && Math.floor(enemy.pos.y) === ty) {
        return true
      }
    }
    return false
  }

  /** Grab the first active pickup within PICKUP_RADIUS that the player can use. */
  private collectPickups(): boolean {
    const player = this._player
    let any = false
    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue
      }
      if (dist(player.pos, pickup.pos) > PICKUP_RADIUS) {
        continue
      }
      const result = applyPickup(player, pickup.kind)
      if (result.taken) {
        setMessage(player, result.message)
        pickup.active = false
        any = true
      }
    }
    return any
  }

  /**
   * Latch the exit flag the first frame the player reaches an exit tile. The exit
   * switch stays solid (id 5) so the player cannot stand on it; instead we complete
   * the level when an exit tile sits in the player's own cell or any of its 8
   * neighbours — i.e. the player is standing directly in front of the switch.
   */
  private checkExit(): boolean {
    if (this.exited) {
      return false
    }
    const player = this._player
    const cx = Math.floor(player.pos.x)
    const cy = Math.floor(player.pos.y)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (tileDef(this.tileAt(cx + dx, cy + dy)).exit) {
          this.exited = true
          return true
        }
      }
    }
    return false
  }

  // ── Sprite assembly ───────────────────────────────────────────────────────

  /** Billboards for every enemy (incl. corpses), live projectile, and active pickup. */
  buildSprites(): SpriteInstance[] {
    const sprites: SpriteInstance[] = []

    for (const enemy of this.enemies) {
      if (enemy.kind === 'barrel') {
        // Barrels are special: dead ⇒ no corpse (skip). Alive/idle ⇒ BAR1; dying ⇒
        // the BEXP blast frames (fullbright). The atlas path falls back to the
        // procedural barrel-ish billboard so headless still renders something.
        if (enemy.state === 'dead') {
          continue
        }
        const barrelSprite = this.atlasBarrelSprite(enemy)
        sprites.push(barrelSprite ?? this.proceduralEnemySprite(enemy))
        continue
      }
      const atlasSprite = this.atlasEnemySprite(enemy)
      if (atlasSprite !== null) {
        sprites.push(atlasSprite)
        continue
      }
      sprites.push(this.proceduralEnemySprite(enemy))
    }

    for (const proj of this.projectiles) {
      if (!proj.alive) {
        continue
      }
      const atlasSprite = this.atlasProjectileSprite(proj)
      if (atlasSprite !== null) {
        sprites.push(atlasSprite)
        continue
      }
      // Procedural fallback: bottom-centre billboard from the generated frames.
      sprites.push({
        texture: projectileFrame(proj, this.assets),
        pos: { x: proj.pos.x, y: proj.pos.y },
        scale: PROJECTILE_SCALE,
        zOffset: PROJECTILE_Z_OFFSET,
        bright: true,
      })
    }

    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue
      }
      const atlasSprite = this.atlasPickupSprite(pickup)
      if (atlasSprite !== null) {
        sprites.push(atlasSprite)
        continue
      }
      // Procedural fallback: bottom-centre billboard from the generated icon.
      sprites.push({
        texture: pickupTexture(this.assets, pickup),
        pos: { x: pickup.pos.x, y: pickup.pos.y },
        scale: PICKUP_SCALE,
        zOffset: this.pickupBob(pickup),
        bright: true,
      })
    }

    // Decor props render only when an atlas is loaded — there is no procedural prop
    // art, so headless / procedural runs simply omit them (decor is optional).
    for (const prop of this.props) {
      const propSprite = this.atlasPropSprite(prop)
      if (propSprite !== null) {
        sprites.push(propSprite)
      }
    }

    return sprites
  }

  /** Procedural bottom-centre billboard for an enemy from the generated textures. */
  private proceduralEnemySprite(enemy: Enemy): SpriteInstance {
    const fbDef = enemyDef(enemy.kind)
    return {
      texture: enemyFrame(enemy, this.assets),
      pos: { x: enemy.pos.x, y: enemy.pos.y },
      scale: fbDef.scale,
      ...(fbDef.flying === true ? { zOffset: FLYING_Z_OFFSET } : {}),
      ...(enemy.kind === 'spectre' ? { fuzz: true } : {}),
    }
  }

  /**
   * Build the atlas billboard for a prop, or null when no atlas / actor / frame is
   * available (procedural runs then skip the prop). Ceiling-anchored props (hanging
   * victims) get a zOffset pinning them near the ceiling; animated props pick their
   * letter off the 35Hz anim clock via prop.propFrameLetter.
   */
  private atlasPropSprite(prop: Prop): SpriteInstance | null {
    const atlas = this.spriteAtlas
    if (atlas === null) {
      return null
    }
    const def = PROP_DEFS[prop.kind]
    if (!atlas.hasActor(def.sprite)) {
      return null
    }
    const ref = atlas.actorFrame(def.sprite, propFrameLetter(prop), 1)
    if (ref === null) {
      return null
    }
    return offsetSprite(ref, prop.pos, def.ceiling === true ? CEILING_PROP_Z_OFFSET : undefined, {
      bright: def.fullbright === true,
    })
  }

  /**
   * Build the atlas billboard for a barrel: BAR1 'A'/'B' (slow 2-frame idle clock)
   * while alive, or the BEXP blast frames while dying (FULLBRIGHT, by death progress).
   * Returns null when no atlas / frame so the caller falls back to the procedural art.
   */
  private atlasBarrelSprite(barrel: Enemy): SpriteInstance | null {
    const atlas = this.spriteAtlas
    if (atlas === null) {
      return null
    }
    const dying = barrel.state === 'dying'
    const sprite = dying ? 'BEXP' : 'BAR1'
    if (!atlas.hasActor(sprite)) {
      return null
    }
    const letter = dying
      ? barrelExplosionLetter(barrel.animTimer)
      : barrelIdleLetter(barrel.animTimer)
    const ref = atlas.actorFrame(sprite, letter, 1)
    if (ref === null) {
      return null
    }
    // The BEXP blast is fullbright; the idle BAR1 frames shade with distance.
    return offsetSprite(ref, barrel.pos, undefined, { bright: dying })
  }

  /**
   * Build the atlas billboard for a pickup (its 'A' frame, single rotation), or null
   * when no atlas / actor / frame is available so the caller falls back to the
   * procedural icon. A gentle vertical bob keyed off position keeps items lively.
   */
  private atlasPickupSprite(pickup: Pickup): SpriteInstance | null {
    const atlas = this.spriteAtlas
    if (atlas === null) {
      return null
    }
    const sprite = PICKUP_SPRITE[pickup.kind]
    if (!atlas.hasActor(sprite)) {
      return null
    }
    const ref = atlas.actorFrame(sprite, 'A', 1)
    if (ref === null) {
      return null
    }
    // Items are lit pickups — render fullbright so they stay visible at any distance.
    return offsetSprite(ref, pickup.pos, this.pickupBob(pickup), { bright: true })
  }

  /** Small deterministic vertical bob (cells) so pickups gently float in place. */
  private pickupBob(pickup: Pickup): number {
    const phase = (pickup.pos.x + pickup.pos.y) * 1.3 + this.bobClock
    return PICKUP_BOB + Math.sin(phase) * PICKUP_BOB_AMP
  }

  /**
   * Build the atlas billboard for an enemy, or null when no atlas / actor / frame is
   * available (the caller then falls back to the procedural texture). Maps the live
   * enemy state onto an animation phase, resolves the Doom frame LETTER for the current
   * clock, then asks the atlas for the rotation view facing the camera.
   */
  private atlasEnemySprite(enemy: Enemy): SpriteInstance | null {
    const atlas = this.spriteAtlas
    if (atlas === null) {
      return null
    }
    const def = ACTOR_DEFS[enemy.kind]
    if (!atlas.hasActor(def.sprite)) {
      return null
    }

    const phase = enemyPhase(enemy)
    // 'death' + 'corpse' advance off the free-running animTimer (reset to 0 on death,
    // so death frames march forward); other phases also key off animTimer.
    const clock = enemy.animTimer
    const resolved = resolveActorFrame(def, phase, clock)

    const camera = this.camera
    const rot = spriteRotation(enemy.angle, camera.pos.x, camera.pos.y, enemy.pos.x, enemy.pos.y)
    const ref = atlas.actorFrame(def.sprite, resolved.letter, rot)
    if (ref === null) {
      return null
    }

    const flying = enemyDef(enemy.kind).flying === true
    return offsetSprite(ref, enemy.pos, flying ? FLYING_Z_OFFSET : undefined, {
      bright: resolved.bright,
      fuzz: enemy.kind === 'spectre',
    })
  }

  /**
   * Build the atlas billboard for a projectile (its 'A' frame, single rotation), or
   * null when no atlas / actor / frame is available so the caller falls back to the
   * procedural fireball frames. Keeps the flight-height zOffset either way.
   */
  private atlasProjectileSprite(proj: Projectile): SpriteInstance | null {
    const atlas = this.spriteAtlas
    if (atlas === null) {
      return null
    }
    const sprite = PROJECTILE_DEFS[proj.kind].sprite
    if (!atlas.hasActor(sprite)) {
      return null
    }
    const ref = atlas.actorFrame(sprite, 'A', 1)
    if (ref === null) {
      return null
    }
    // Projectiles glow — render fullbright so they read as energy in the dark.
    return offsetSprite(ref, proj.pos, PROJECTILE_Z_OFFSET, { bright: true })
  }
}

/** Optional render flags an atlas billboard may carry (fullbright frame / fuzz shimmer). */
interface SpriteFlags {
  readonly bright?: boolean
  readonly fuzz?: boolean
}

/** A Doom-offset billboard from an atlas frame ref at a world position (shared so
 *  enemy + projectile atlas paths don't duplicate the SpriteInstance literal). */
function offsetSprite(
  ref: { tex: Texture; flip: boolean; ox: number; oy: number },
  pos: Vec2,
  zOffset: number | undefined,
  flags: SpriteFlags = {},
): SpriteInstance {
  return {
    texture: ref.tex,
    pos: { x: pos.x, y: pos.y },
    scale: 1,
    flip: ref.flip,
    ox: ref.ox,
    oy: ref.oy,
    pxW: ref.tex.width,
    pxH: ref.tex.height,
    ...(zOffset !== undefined ? { zOffset } : {}),
    ...(flags.bright === true ? { bright: true } : {}),
    ...(flags.fuzz === true ? { fuzz: true } : {}),
  }
}

/**
 * Map an enemy's live state onto the actor-state animation phase. The attack pose
 * is chosen by archetype: hitscan/projectile prefer a 'missile' seq (falling back
 * to 'melee' when none exists, e.g. a pistol pose actor), while melee/charger use
 * 'melee'. The resolver already falls back to 'see' for any missing seq.
 */
function enemyPhase(enemy: Enemy): ActorPhase {
  switch (enemy.state) {
    case 'dead':
      return 'corpse'
    case 'dying':
      return 'death'
    case 'hurt':
      return 'pain'
    case 'attack':
      return attackPhase(enemy)
    default:
      // idle / chase share the walk (see) cycle.
      return 'see'
  }
}

/** Pick the attack-pose phase for an enemy by its archetype + available seqs. */
function attackPhase(enemy: Enemy): ActorPhase {
  const def = enemyDef(enemy.kind)
  if (def.archetype === 'melee' || def.archetype === 'charger') {
    return 'melee'
  }
  // hitscan / projectile: prefer the missile pose, else the melee pose.
  return ACTOR_DEFS[enemy.kind].states.missile !== undefined ? 'missile' : 'melee'
}

/** Barrel idle: BAR1 toggles A/B on a slow ~2.4 Hz clock (Doom's 6-tic cadence). */
function barrelIdleLetter(animTimer: number): string {
  return Math.floor(animTimer / 0.17) % 2 === 0 ? 'A' : 'B'
}

/**
 * Barrel explosion: BEXP A→B→C→D→E across the ~0.6 s dying window. animTimer is reset
 * to 0 when dying begins (damageEnemy), so the blast marches forward from frame A.
 */
const BEXP_LETTERS = 'ABCDE'
function barrelExplosionLetter(animTimer: number): string {
  const idx = Math.min(BEXP_LETTERS.length - 1, Math.floor(animTimer / 0.12))
  return BEXP_LETTERS[idx] ?? 'A'
}

/** Drop the dead projectiles, compacting in place to keep the array tight. */
function pruneDead(projectiles: Projectile[]): void {
  let write = 0
  for (const proj of projectiles) {
    if (proj?.alive) {
      projectiles[write++] = proj
    }
  }
  projectiles.length = write
}

/** The icon texture for a pickup kind. */
function pickupTexture(assets: Assets, pickup: Pickup): Texture {
  return assets.pickup[pickup.kind]
}

/**
 * Kinds excluded from the kill total: the barrel is decor, and Lost Souls have no
 * MF_COUNTKILL in Doom II (doomBehaviorSpec.md §3.1) AND are bred at runtime by a Pain
 * Elemental — counting them would push kills past the level's monster total.
 */
function isUncounted(kind: Enemy['kind']): boolean {
  return kind === 'barrel' || kind === 'lostSoul'
}

/**
 * Infighting same-species exemption (doomBehaviorSpec.md §4 / §3.1): a Hell Knight and a
 * Baron are grouped as one species and NEVER infight each other (PIT_CheckThing groups
 * MT_KNIGHT+MT_BRUISER). All other kind pairs — including two identical kinds — DO infight.
 * Kept deliberately narrow: only this one pair is exempt.
 */
function sameInfightSpecies(a: Enemy['kind'], b: Enemy['kind']): boolean {
  const bruiser = (k: Enemy['kind']): boolean => k === 'hellKnight' || k === 'baron'
  return bruiser(a) && bruiser(b)
}
