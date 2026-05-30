// View-bob model (B5): movement drives player.bob (0..1) + bobPhase in updatePlayerMovement;
// the renderer turns those into a 90°-apart figure-eight, SUPPRESSED while firing/raising/
// lowering. Two halves: the player-side source, and the pure render-side viewmodelBob().

import { describe, expect, it } from 'vitest'
import type { InputFrame, SceneQuery, Settings } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { createPlayer, updatePlayerMovement } from '~/doom/game/player'
import { defaultSettings } from '~/doom/game/state'
import { BOB_AMP, viewmodelBob } from '~/doom/ui/viewmodel'

const DT = 1 / 60

const OPEN_SCENE: SceneQuery = {
  width: 64,
  height: 64,
  floorFlat: 0,
  ceilingFlat: 0,
  tileAt: () => 0,
  isSolid: () => false,
  wallTextureAt: () => -1,
  doorOpennessAt: () => 0,
}

const IDLE_INPUT: InputFrame = {
  moveForward: 0,
  moveStrafe: 0,
  turnAxis: 0,
  mouseDX: 0,
  firing: false,
  fire: false,
  run: false,
  use: false,
  nav: { up: false, down: false, left: false, right: false, confirm: false, back: false },
  weaponSlot: 0,
  weaponCycle: 0,
  pointerX: 0,
  pointerY: 0,
  pointerDown: false,
}

function input(partial: Partial<InputFrame>): InputFrame {
  return { ...IDLE_INPUT, ...partial }
}

const settings: Settings = defaultSettings()

describe('view-bob source (updatePlayerMovement)', () => {
  it('ramps player.bob toward 1 and advances bobPhase while walking forward', () => {
    const player = createPlayer(vec(8.5, 8.5), 0)
    const forward = input({ moveForward: 1 })
    let lastPhase = player.bobPhase
    for (let i = 0; i < 30; i++) {
      updatePlayerMovement(player, OPEN_SCENE, forward, settings, DT)
      expect(player.bobPhase).toBeGreaterThan(lastPhase) // phase advances each moving tick
      lastPhase = player.bobPhase
    }
    expect(player.bob).toBeGreaterThan(0.9) // full-speed walk → bob → ~1
    expect(player.bob).toBeLessThanOrEqual(1)
  })

  it('decays player.bob to a hard 0 (and freezes phase) once standing still', () => {
    const player = createPlayer(vec(8.5, 8.5), 0)
    for (let i = 0; i < 20; i++) {
      updatePlayerMovement(player, OPEN_SCENE, input({ moveForward: 1 }), settings, DT)
    }
    expect(player.bob).toBeGreaterThan(0)
    const phaseWhenStopped = player.bobPhase
    for (let i = 0; i < 200; i++) {
      updatePlayerMovement(player, OPEN_SCENE, IDLE_INPUT, settings, DT)
    }
    expect(player.bob).toBe(0) // hard zero, not an asymptote
    expect(player.bobPhase).toBe(phaseWhenStopped) // oscillator frozen while still
  })
})

describe('viewmodelBob (render figure-eight + suppression)', () => {
  it('is {0,0} when bob is 0 regardless of phase', () => {
    expect(viewmodelBob('ready', 0, 1.23)).toEqual({ x: 0, y: 0 })
  })

  it('traces the 90°-apart figure-eight while ready and moving', () => {
    // phase 0 → cos=1, |sin|=0 → x peaks, y at 0.
    const atZero = viewmodelBob('ready', 1, 0)
    expect(atZero.x).toBeCloseTo(BOB_AMP, 6)
    expect(atZero.y).toBeCloseTo(0, 6)
    // phase π/2 → cos=0, |sin|=1 → x at 0, y peaks (axes 90° apart).
    const atQuarter = viewmodelBob('ready', 1, Math.PI / 2)
    expect(atQuarter.x).toBeCloseTo(0, 6)
    expect(atQuarter.y).toBeCloseTo(BOB_AMP, 6)
    // y is the abs(sin) lobe — never negative.
    expect(viewmodelBob('ready', 1, -Math.PI / 2).y).toBeCloseTo(BOB_AMP, 6)
  })

  it('scales amplitude with bob', () => {
    expect(viewmodelBob('ready', 0.5, 0).x).toBeCloseTo(BOB_AMP * 0.5, 6)
  })

  it('suppresses bob entirely during firing / raising / lowering at full speed', () => {
    for (const state of ['firing', 'raising', 'lowering'] as const) {
      expect(viewmodelBob(state, 1, Math.PI / 3)).toEqual({ x: 0, y: 0 })
    }
  })
})
