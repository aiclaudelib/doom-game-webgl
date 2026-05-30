// CONTRACT LOCK (B6): the viewmodel is COSMETIC. Shots originate at player.pos along
// player.angle (+spread). The render-space view-bob / slide fields (bob, bobPhase, pspSy,
// extralight) AND the derived bobX/bobY must NEVER feed a shot's origin or direction. This
// guards against "aim from the muzzle sprite" creeping in with the new atlas viewmodel.

import { describe, expect, it } from 'vitest'
import type { Enemy, Player, Projectile, Rng, SceneQuery } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { createPlayer, giveWeapon } from '~/doom/game/player'
import { updateWeapon } from '~/doom/game/weapon'
import { viewmodelBob } from '~/doom/ui/viewmodel'

const TIC = 1 / 35
const RNG: Rng = () => 0.99

function openScene(): SceneQuery {
  return {
    width: 64,
    height: 64,
    floorFlat: 0,
    ceilingFlat: 0,
    tileAt: () => 0,
    isSolid: () => false,
    wallTextureAt: () => -1,
    doorOpennessAt: () => 0,
  }
}

/** Arm the rocket launcher (a projectile weapon — its spawn carries origin + velocity). */
function rocketPlayer(): Player {
  const player = createPlayer(vec(10.5, 10.5), 1.0)
  giveWeapon(player, 'rocket')
  player.currentWeapon = 'rocket'
  player.ammo.rockets = 5
  return player
}

/** Hold the trigger until exactly one rocket spawns; return its origin (pos) + velocity. */
function fireRocketOrigin(player: Player): {
  pos: { x: number; y: number }
  vel: { x: number; y: number }
} {
  const enemies: Enemy[] = []
  const projectiles: Projectile[] = []
  for (let i = 0; i < 200 && projectiles.length === 0; i++) {
    updateWeapon(player, true, openScene(), enemies, projectiles, RNG, TIC)
  }
  const proj = projectiles[0]
  if (proj === undefined) throw new Error('rocket never spawned')
  return { pos: { x: proj.pos.x, y: proj.pos.y }, vel: { x: proj.vel.x, y: proj.vel.y } }
}

describe('aim decoupling (viewmodel is cosmetic)', () => {
  it('shot origin + direction track player.pos / player.angle', () => {
    const a = fireRocketOrigin(rocketPlayer())

    const moved = rocketPlayer()
    moved.pos = vec(20.5, 4.5)
    const b = fireRocketOrigin(moved)
    expect(b.pos).not.toEqual(a.pos) // moving the player moves the muzzle origin

    const turned = rocketPlayer()
    turned.angle = 1.0 + Math.PI / 2
    const c = fireRocketOrigin(turned)
    expect(c.vel).not.toEqual(a.vel) // turning the player turns the shot direction
  })

  it('mutating render-only bob / slide fields leaves origin + direction BYTE-IDENTICAL', () => {
    const baseline = fireRocketOrigin(rocketPlayer())

    const shaken = rocketPlayer()
    // Wild render-space values — none of these may touch the shot.
    shaken.bob = 1
    shaken.bobPhase = 2.345
    shaken.pspSy = 128
    shaken.extralight = 2
    const shot = fireRocketOrigin(shaken)

    expect(shot.pos).toEqual(baseline.pos)
    expect(shot.vel).toEqual(baseline.vel)

    // And the derived render bob (what would shift the SPRITE) is non-zero here yet
    // never entered the shot — proof the two systems are independent.
    const renderBob = viewmodelBob('ready', shaken.bob, shaken.bobPhase)
    expect(renderBob.x === 0 && renderBob.y === 0).toBe(false)
  })
})
