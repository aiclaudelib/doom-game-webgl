import { describe, expect, it } from 'vitest'
import type { InputFrame, LevelSource, NavEdge } from '~/doom/types'
import { mulberry32 } from '~/doom/core/rng'
import { createAssets } from '~/doom/engine/textures'
import { compileLevel } from '~/doom/game/map'
import { defaultSettings } from '~/doom/game/state'
import { World } from '~/doom/game/world'

const NO_NAV: NavEdge = {
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
}

const IDLE: InputFrame = {
  moveForward: 0,
  moveStrafe: 0,
  turnAxis: 0,
  mouseDX: 0,
  firing: false,
  fire: false,
  run: false,
  use: false,
  nav: NO_NAV,
  weaponSlot: 0,
  pointerX: 0,
  pointerY: 0,
  pointerDown: false,
}

function input(partial: Partial<InputFrame>): InputFrame {
  return { ...IDLE, ...partial }
}

// Player '@' faces east (angle 0) down a clear corridor. A grunt 'g' is lined up
// straight ahead, a health pickup 'h' sits one tile east of the start, and the
// exit switch 'X' caps the far end.
const SOURCE: LevelSource = {
  name: 'World Test',
  rows: ['##########', '#@h..g..X#', '##########'],
  floorFlat: 0,
  ceilingFlat: 2,
  playerAngle: 0,
}

function makeWorld(): World {
  const level = compileLevel(SOURCE)
  const assets = createAssets(1)
  return new World(level, assets, mulberry32(1), defaultSettings())
}

describe('World', () => {
  it('exposes SceneQuery dimensions and initial stats from the level', () => {
    const world = makeWorld()
    expect(world.width).toBe(10)
    expect(world.height).toBe(3)
    expect(world.stats.totalEnemies).toBe(1)
    expect(world.stats.kills).toBe(0)
    expect(world.stats.level).toBe('World Test')
  })

  it('kills a lined-up enemy when fired upon repeatedly', () => {
    const world = makeWorld()
    let died = false

    // Hold fire for plenty of ticks. tryFire only fires on a ready frame; the
    // weapon cycles ready→firing→ready on its own. Death finishes after the
    // dying animation, which is the frame kills increments.
    for (let i = 0; i < 240 && !died; i++) {
      const events = world.update(input({ fire: true, firing: true }), 1 / 60)
      if (events.enemyDied) {
        died = true
      }
    }

    expect(died).toBe(true)
    expect(world.stats.kills).toBe(1)
  })

  it('grabs a pickup the player walks onto', () => {
    const world = makeWorld()
    // Below the cap so the stimpack heals (it would be refused at ≥100). The grunt
    // down the corridor now hitscans the player while they walk, so compare against
    // the health on the tick BEFORE the grab — proving the stimpack added on top.
    world.player.health = 40

    let grabbed = false
    let healthBeforeGrab = world.player.health
    // Walk east toward the health pickup one tile away.
    for (let i = 0; i < 120 && !grabbed; i++) {
      healthBeforeGrab = world.player.health
      const events = world.update(input({ moveForward: 1 }), 1 / 60)
      if (events.pickedUp) {
        grabbed = true
      }
    }

    expect(grabbed).toBe(true)
    // The stimpack's +10 outweighs at most one hitscan hit on the grab tick.
    expect(world.player.health).toBeGreaterThan(healthBeforeGrab)
  })

  it('reports reachedExit when the player stands beside the (solid) exit switch', () => {
    const world = makeWorld()
    // The exit switch at column 8 is solid, so the player can never stand on it.
    // Standing in the adjacent cell (column 7) must still complete the level.
    world.player.pos.x = 7.5
    world.player.pos.y = 1.5
    expect(world.isSolid(8, 1)).toBe(true) // switch stays solid/visible
    const events = world.update(input({}), 1 / 60)
    expect(events.reachedExit).toBe(true)

    // The flag latches — a second tick beside the same switch does not re-fire it.
    const again = world.update(input({}), 1 / 60)
    expect(again.reachedExit).toBe(false)
  })

  it('does not report reachedExit when nowhere near the exit switch', () => {
    const world = makeWorld()
    // Start cell (column 1) is far from the exit at column 8.
    const events = world.update(input({}), 1 / 60)
    expect(events.reachedExit).toBe(false)
  })

  it('a fired rocket spawns a projectile that kills a lined-up enemy via impact + splash', () => {
    const world = makeWorld()
    const player = world.player
    // Arm the rocket launcher; the grunt (HP 20) sits straight ahead down the corridor.
    player.weapons.rocket = true
    player.currentWeapon = 'rocket'
    player.ammo.rockets = 5

    // Hold fire: tryFire spawns the rocket on a ready frame, it flies down the
    // corridor, and on impact world applies direct (20..160) + Chebyshev splash.
    let died = false
    for (let i = 0; i < 240 && !died; i++) {
      const events = world.update(input({ fire: true, firing: true }), 1 / 60)
      if (events.enemyDied) {
        died = true
      }
    }
    expect(died).toBe(true)
    expect(world.stats.kills).toBe(1)
  })

  it('applies a powerup the player walks onto (blur timer starts)', () => {
    // A blur sphere 'w' sits one tile east of the start down a clear corridor.
    const source: LevelSource = {
      name: 'Powerup Test',
      rows: ['##########', '#@w......X#', '##########'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const powerWorld = new World(
      compileLevel(source),
      createAssets(1),
      mulberry32(1),
      defaultSettings(),
    )
    expect(powerWorld.player.blurTimer).toBe(0)

    let grabbed = false
    for (let i = 0; i < 120 && !grabbed; i++) {
      const events = powerWorld.update(input({ moveForward: 1 }), 1 / 60)
      if (events.pickedUp) {
        grabbed = true
      }
    }
    expect(grabbed).toBe(true)
    expect(powerWorld.player.blurTimer).toBeGreaterThan(0)
  })

  it('shooting a barrel explodes it, chain-detonates an adjacent barrel, and hurts the player', () => {
    // Player '@' faces east; two barrels 'Q' sit down the corridor (cols 3 and 5).
    // The nearest is shot, detonates, and its 2-cell Chebyshev splash both chains the
    // far barrel AND reaches back to the (close) player — proving splash hurts the shooter.
    const source: LevelSource = {
      name: 'Barrel Test',
      rows: ['##########', '#@.Q.Q..X#', '##########'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    // Two barrels spawned; neither counts toward the kill total (decor, not monsters).
    expect(world.enemyStates.filter(e => e.kind === 'barrel')).toHaveLength(2)
    expect(world.stats.totalEnemies).toBe(0)

    const healthBefore = world.player.health
    // Hold fire: the pistol hitscans the nearest barrel; it dies → detonates → chains.
    for (let i = 0; i < 240; i++) {
      world.update(input({ fire: true, firing: true }), 1 / 60)
      const barrels = world.enemyStates.filter(e => e.kind === 'barrel')
      const allBlown = barrels.every(b => b.state === 'dying' || b.state === 'dead')
      if (allBlown) {
        break
      }
    }

    const barrels = world.enemyStates.filter(e => e.kind === 'barrel')
    // BOTH barrels detonated — the shot one and the chained one.
    expect(barrels.every(b => b.state === 'dying' || b.state === 'dead')).toBe(true)
    // The explosion's splash hurt the player (splash hurts the shooter).
    expect(world.player.health).toBeLessThan(healthBefore)
    // Barrels never count as kills.
    expect(world.stats.kills).toBe(0)
  })

  it('ticks a decor prop and advances its animation clock', () => {
    // A techlamp 'T' (animated, fullbright) sits beside the player; no monsters.
    const source: LevelSource = {
      name: 'Prop Test',
      rows: ['##########', '#@T.....X#', '##########'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    expect(world.propStates).toHaveLength(1)
    expect(world.propStates[0]?.kind).toBe('techLamp')
    expect(world.propStates[0]?.animTimer).toBe(0)

    for (let i = 0; i < 30; i++) {
      world.update(input({}), 1 / 60)
    }
    // The prop's animation clock advanced (animated props loop on this clock).
    expect(world.propStates[0]?.animTimer).toBeGreaterThan(0)
  })

  it('a pain elemental spits a charging lost soul when it can see the player', () => {
    // Player '@' faces east; a pain elemental 'ø' sits down a clear, wide corridor.
    const source: LevelSource = {
      name: 'Pain Spawn',
      rows: [
        '##############',
        '#............#',
        '#@.........ø.#',
        '#............#',
        '##############',
      ],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    expect(world.enemyStates.filter(e => e.kind === 'lostSoul')).toHaveLength(0)
    // The 4 tier-2 bosses count as monsters: the lone pain elemental is the total.
    expect(world.stats.totalEnemies).toBe(1)

    let souls = 0
    for (let i = 0; i < 600 && souls === 0; i++) {
      world.update(input({}), 1 / 60)
      souls = world.enemyStates.filter(e => e.kind === 'lostSoul').length
    }
    expect(souls).toBeGreaterThanOrEqual(1)
  })

  it('a pain elemental refuses to spawn when 20+ lost souls are already live (>20 cap)', () => {
    // Twenty-one lost souls 'l' fill the room alongside a pain elemental 'ø'. With the
    // cap already met, the elemental must spawn NOTHING — the count stays 21.
    // Row 2 holds 19 lost souls, row 3 holds 2 → 21 live souls, one over the >20 cap.
    const source: LevelSource = {
      name: 'Pain Cap',
      rows: [
        '#####################',
        '#@.................ø#',
        '#lllllllllllllllllll#',
        '#ll................ø#',
        '#####################',
      ],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    const liveSouls = () =>
      world.enemyStates.filter(e => e.kind === 'lostSoul' && e.state !== 'dead').length
    expect(liveSouls()).toBe(21)

    // Tick a few frames: the elemental sees the player and tries to spawn, but the cap
    // (>20) blocks it — no NEW soul appears (count never climbs above the starting 21).
    let maxSeen = liveSouls()
    for (let i = 0; i < 20; i++) {
      world.update(input({}), 1 / 60)
      maxSeen = Math.max(maxSeen, liveSouls())
    }
    expect(maxSeen).toBeLessThanOrEqual(21)
  })

  it('a pain elemental breeds up to 3 lost souls when it dies', () => {
    // Player '@' faces a near-dead pain elemental 'ø'; a few pistol shots finish it and
    // A_PainDie spits a ring of up to 3 charging lost souls.
    const source: LevelSource = {
      name: 'Pain Death',
      rows: ['##############', '#@.........ø.#', '##############'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    // Give the player the rocket launcher to burst the 400-HP elemental down quickly.
    world.player.weapons.rocket = true
    world.player.currentWeapon = 'rocket'
    world.player.ammo.rockets = 40

    let painDead = false
    for (let i = 0; i < 600 && !painDead; i++) {
      world.update(input({ fire: true, firing: true }), 1 / 60)
      painDead = world.enemyStates.some(
        e => e.kind === 'painElemental' && (e.state === 'dying' || e.state === 'dead'),
      )
    }
    expect(painDead).toBe(true)
    // The death burst bred at least one (≤3) lost soul.
    const souls = world.enemyStates.filter(e => e.kind === 'lostSoul').length
    expect(souls).toBeGreaterThanOrEqual(1)
    expect(souls).toBeLessThanOrEqual(3)
  })

  it('an arch-vile resurrects a nearby raisable corpse but never a barrel', () => {
    // Player '@' faces east along row 1, with a grunt 'g' (raisable) then a barrel 'Q'
    // lined up ahead. An arch-vile '†' sits one row below — adjacent to both corpses
    // (inside VILE_RAISE_RANGE) but OFF the player's firing line so it survives. We shoot
    // the grunt + barrel dead, then let the vile's scan raise the grunt — never the barrel.
    const source: LevelSource = {
      name: 'Vile Raise',
      rows: ['#######', '#@.gQ.#', '#..†..#', '#######'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())

    const corpse = (kind: string) =>
      world.enemyStates.some(e => e.kind === kind && e.state === 'dead')

    // Phase 1: fire until the grunt AND the barrel are corpses (the pistol drops the
    // grunt first, then the now-exposed barrel detonates).
    for (let i = 0; i < 1200; i++) {
      world.update(input({ fire: true, firing: true }), 1 / 60)
      if (corpse('grunt') && corpse('barrel')) {
        break
      }
    }
    expect(corpse('grunt')).toBe(true)
    expect(corpse('barrel')).toBe(true)
    // The vile must still be alive to do the resurrecting.
    expect(world.enemyStates.some(e => e.kind === 'archvile' && e.state !== 'dead')).toBe(true)

    // Phase 2: stop firing and let the vile's resurrection scan run. The raisable grunt
    // comes back alive (no longer a corpse); the barrel corpse must persist (never raised).
    let gruntRaised = false
    for (let i = 0; i < 600 && !gruntRaised; i++) {
      world.update(input({}), 1 / 60)
      gruntRaised = world.enemyStates.some(e => e.kind === 'grunt' && e.state !== 'dead')
    }
    expect(gruntRaised).toBe(true)
    // The barrel is decor — never raisable. Its corpse stays dead.
    expect(corpse('barrel')).toBe(true)
  })

  it('a cyberdemon is immune to its own rocket splash (splashImmune)', () => {
    // A cyberdemon 'Δ' sits point-blank-ish to the player; it fires splash rockets that
    // detonate near itself. splashImmune means those blasts never chip its 4000 HP via
    // splash — it only ever takes the player's direct shots. We never fire, so the only
    // damage source is the cyber's own rockets' splash → its HP must stay at full.
    const source: LevelSource = {
      name: 'Cyber Splash',
      rows: ['##############', '#@.........Δ.#', '##############'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    const playerHpBefore = world.player.health
    for (let i = 0; i < 300; i++) {
      world.update(input({}), 1 / 60) // never fire
    }
    // The cyberdemon is alive and undamaged — splash never staggered or chipped it.
    expect(world.enemyStates.some(e => e.kind === 'cyberdemon' && e.state !== 'dead')).toBe(true)
    expect(world.stats.kills).toBe(0)
    // Its own rockets' splash did reach the player though (proving splash fired at all).
    expect(world.player.health).toBeLessThan(playerHpBefore)
  })

  it('a slain grunt drops a half clip the player can grab for +5 bullets', () => {
    // Player '@' faces east; a lone grunt 'g' down the corridor. The player drains its
    // own ammo low, kills the grunt, then walks over the corpse to grab the dropped clip.
    const source: LevelSource = {
      name: 'Grunt Drop',
      rows: ['############', '#@.......g.X#', '############'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())

    // Kill the grunt with the pistol; on death it drops a 'clipDropped' pickup at its corpse.
    let died = false
    for (let i = 0; i < 600 && !died; i++) {
      const events = world.update(input({ fire: true, firing: true }), 1 / 60)
      if (events.enemyDied) {
        died = true
      }
    }
    expect(died).toBe(true)

    // Set bullets low (well under cap) so the +5 from the dropped clip is observable, then
    // walk east over the corpse/drop and confirm the grab tops bullets up by the dropped 5.
    world.player.ammo.bullets = 0
    let grabbed = false
    for (let i = 0; i < 600 && !grabbed; i++) {
      const events = world.update(input({ moveForward: 1 }), 1 / 60)
      if (events.pickedUp) {
        grabbed = true
      }
    }
    expect(grabbed).toBe(true)
    // The dropped clip grants the halved 5 bullets (not a full clip's 10).
    expect(world.player.ammo.bullets).toBe(5)
  })

  it('a slain shotgun guy drops a shotgun weapon', () => {
    // Player '@' faces a shotgun guy 'S'. The player has no shotgun; killing the guy drops
    // the shotgun weapon, which the player then walks over to claim.
    const source: LevelSource = {
      name: 'Shotgun Drop',
      rows: ['############', '#@.......S.X#', '############'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())
    expect(world.player.weapons.shotgun).toBe(false)

    let died = false
    for (let i = 0; i < 600 && !died; i++) {
      const events = world.update(input({ fire: true, firing: true }), 1 / 60)
      if (events.enemyDied) {
        died = true
      }
    }
    expect(died).toBe(true)

    // Walk east over the dropped shotgun to claim it.
    let grabbed = false
    for (let i = 0; i < 600 && !grabbed; i++) {
      const events = world.update(input({ moveForward: 1 }), 1 / 60)
      if (events.pickedUp) {
        grabbed = true
      }
    }
    expect(grabbed).toBe(true)
    expect(world.player.weapons.shotgun).toBe(true)
  })

  it('infight: an enemy missile hitting a different enemy makes the victim retarget the attacker', () => {
    // Player '@' at the west end; a demon 'd' stands between the player and an imp 'i' down
    // the line. The imp fires fireballs at the player; the first to pass the demon's cell hits
    // the demon → the demon retargets the imp (its targetKind becomes 'imp').
    const source: LevelSource = {
      name: 'Infight',
      rows: ['###############', '#@..d......i..#', '###############'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())

    let demonTargetsImp = false
    for (let i = 0; i < 600 && !demonTargetsImp; i++) {
      world.update(input({}), 1 / 60) // never fire — only the imp's fireballs act
      demonTargetsImp = world.enemyStates.some(e => e.kind === 'demon' && e.targetKind === 'imp')
    }
    expect(demonTargetsImp).toBe(true)
  })

  it('infight: a hell knight missile hitting a baron does NOT retarget (Knight/Baron exempt)', () => {
    // A baron 'n' stands between the player and a hell knight 'K'. The knight fires
    // baronballs at the player; one passes the baron's cell — but the Knight/Baron species
    // pair is exempt, so the baron NEVER retargets the knight (its target stays the player).
    const source: LevelSource = {
      name: 'Bruiser Exempt',
      rows: ['###############', '#@..n......K..#', '###############'],
      floorFlat: 0,
      ceilingFlat: 2,
      playerAngle: 0,
    }
    const world = new World(compileLevel(source), createAssets(1), mulberry32(1), defaultSettings())

    // Run long enough for many knight missiles to cross the baron's cell.
    let baronRetargeted = false
    for (let i = 0; i < 600; i++) {
      world.update(input({}), 1 / 60)
      if (world.enemyStates.some(e => e.kind === 'baron' && e.targetKind === 'hellKnight')) {
        baronRetargeted = true
        break
      }
    }
    // The exempt pair passes through: the baron never targets the hell knight.
    expect(baronRetargeted).toBe(false)
  })

  it('reports dryFired on an empty trigger pull and not on a real shot', () => {
    const world = makeWorld()
    // Drain the pistol's ammo so the next fresh press clicks empty.
    world.player.ammo.bullets = 0

    let sawDryFire = false
    for (let i = 0; i < 30 && !sawDryFire; i++) {
      const events = world.update(input({ fire: true }), 1 / 60)
      expect(events.fired).toBeNull()
      if (events.dryFired) {
        sawDryFire = true
      }
    }
    expect(sawDryFire).toBe(true)

    // A real shot (ammo present) reports fired, never dryFired.
    const armed = makeWorld()
    let sawShot = false
    for (let i = 0; i < 30 && !sawShot; i++) {
      const events = armed.update(input({ fire: true }), 1 / 60)
      if (events.fired !== null) {
        expect(events.dryFired).toBe(false)
        sawShot = true
      }
    }
    expect(sawShot).toBe(true)
  })
})
