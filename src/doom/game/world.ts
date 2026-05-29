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
  Rng,
  SceneQuery,
  Settings,
  SpriteInstance,
  Texture,
  WeaponKind,
} from '~/doom/types'
import { approach } from '~/doom/core/math'
import { dist } from '~/doom/core/vec'
import { cellIndex, tileDef } from '~/doom/game/map'
import {
  createPlayer,
  requestWeapon,
  setMessage,
  tickPlayerTimers,
  updatePlayerMovement,
} from '~/doom/game/player'
import { enemyDef, enemyFrame, spawnEnemy, updateEnemy } from '~/doom/game/enemy'
import { projectileFrame, updateProjectile } from '~/doom/game/projectile'
import { tryFire, updateWeapon, weaponBySlot, weaponDef } from '~/doom/game/weapon'
import { applyPickup, spawnPickup } from '~/doom/game/pickup'

/** Door motion phase: shut, sliding open, held fully open, or sliding closed. */
type DoorPhase = 'shut' | 'opening' | 'open' | 'closing'

/** Per-kind billboard scale for projectiles (enemies/pickups carry their own). */
const PROJECTILE_SCALE = 0.4
/** Height above the floor (in tiles) projectiles fly at, so they don't roll along it. */
const PROJECTILE_Z_OFFSET = 0.4
/** Fallback billboard scale for any pickup. */
const PICKUP_SCALE = 0.55

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

  /** Per-cell door openness 0 (shut) .. 1 (fully open), keyed by cellIndex. */
  private readonly doorOpenness: Float32Array
  /** Per-cell hold timer counting down while a door rests fully open. */
  private readonly doorHold: Float32Array
  /** Per-cell door motion phase, keyed by cellIndex. */
  private readonly doorPhase: DoorPhase[]

  private kills = 0
  private readonly totalEnemies: number
  private exited = false

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
    this.totalEnemies = this.enemies.length

    for (const spawn of level.pickupSpawns) {
      this.pickups.push(spawnPickup(spawn.kind, spawn.x, spawn.y))
    }
  }

  /** Swap in the live Settings so movement reads current mouse-look + sensitivity. */
  setSettings(settings: Settings): void {
    this.settings = settings
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

  // ── Simulation tick ─────────────────────────────────────────────────────────

  update(input: InputFrame, dt: number): WorldEvents {
    const player = this._player
    const healthBefore = player.health

    // 1. Player movement (turn + collide-and-slide) using the live Settings so
    //    mouse sensitivity + mouse-look toggles take effect immediately.
    updatePlayerMovement(player, this, input, this.settings, dt)

    // 2. Use: open the nearest door (or recede a secret wall) within reach.
    const doorOpened = input.use ? this.tryUseDoor() : false

    // 3. Weapon selection + firing.
    const weaponPhase = this.updateWeaponPhase(input, dt)
    const fired = weaponPhase.fired
    const dryFired = weaponPhase.dryFired

    // 4. Enemies — count freshly finished deaths into kills.
    let enemyHurt = false
    let enemyDied = false
    for (const enemy of this.enemies) {
      const aliveBefore = enemy.alive
      const stateBefore = enemy.state
      updateEnemy(enemy, player, this, this.projectiles, this.rng, dt)
      if (enemy.state === 'hurt' && stateBefore !== 'hurt') {
        enemyHurt = true
      }
      if (aliveBefore && !enemy.alive) {
        this.kills++
        enemyDied = true
      }
    }

    // 5. Projectiles — advance, then prune the dead.
    for (const proj of this.projectiles) {
      updateProjectile(proj, player, this, dt)
    }
    pruneDead(this.projectiles)

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
      const kind = weaponBySlot(input.weaponSlot)
      if (kind !== null) {
        requestWeapon(player, kind)
      }
    }

    updateWeapon(player, dt)

    const def = weaponDef(player.currentWeapon)
    const wantsToFire = def.automatic ? input.firing : input.fire
    if (wantsToFire && player.weaponState === 'ready') {
      const outcome = tryFire(player, this, this.enemies, this.rng)
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
      sprites.push({
        texture: enemyFrame(enemy, this.assets),
        pos: { x: enemy.pos.x, y: enemy.pos.y },
        scale: enemyDef(enemy.kind).scale,
      })
    }

    for (const proj of this.projectiles) {
      if (!proj.alive) {
        continue
      }
      sprites.push({
        texture: projectileFrame(proj, this.assets),
        pos: { x: proj.pos.x, y: proj.pos.y },
        scale: PROJECTILE_SCALE,
        zOffset: PROJECTILE_Z_OFFSET,
      })
    }

    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue
      }
      sprites.push({
        texture: pickupTexture(this.assets, pickup),
        pos: { x: pickup.pos.x, y: pickup.pos.y },
        scale: PICKUP_SCALE,
      })
    }

    return sprites
  }
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
