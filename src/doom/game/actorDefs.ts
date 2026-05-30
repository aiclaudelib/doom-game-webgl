// Data-driven actor state tables, modelled on Doom's frame/tic state machine.
// Each actor maps to a 4-letter sprite prefix and a small set of named state
// sequences (see / melee / missile / pain / death). The renderer resolves the
// current frame LETTER for a phase + animation clock; the SpriteAtlas then turns
// that letter + rotation into a draw ref. Pure data + a pure resolver, zero DOM —
// runs identically under jsdom.

import type { EnemyKind } from '~/doom/types'

/** Doom runs its state machine at 35Hz; one tic is 1/35s. */
const TICS_PER_SECOND = 35

/** A single animation frame: a sprite letter held for `tics` (negative = forever). */
export interface StateFrame {
  readonly letter: string
  readonly tics: number
  readonly bright?: boolean
}

/** An ordered run of frames; `loop` cycles back to the start when finished. */
export interface StateSeq {
  readonly frames: readonly StateFrame[]
  readonly loop?: boolean
}

/** The named state sequences an actor can play. `see` + `death` are mandatory. */
export interface ActorStates {
  readonly see: StateSeq
  readonly melee?: StateSeq
  readonly missile?: StateSeq
  readonly pain?: StateSeq
  readonly death: StateSeq
}

/** One actor: its 4-letter sprite prefix and its state table. */
export interface ActorDef {
  readonly sprite: string
  readonly states: ActorStates
}

/** A resolved frame for the renderer: which letter to draw, and whether it is fullbright. */
export interface ResolvedFrame {
  readonly letter: string
  readonly bright: boolean
}

/** The phases the resolver understands. `corpse` holds the death sequence's last frame. */
export type ActorPhase = 'see' | 'melee' | 'missile' | 'pain' | 'death' | 'corpse'

// ─────────────────────────────────────────────────────────────────────────────
// Compact DSL — terse builders so every actor block is short and all-distinct.
// This keeps the 13-monster table well under the jscpd duplication threshold:
// each `seq('...')` string differs per actor, so no two state blocks clone.
// ─────────────────────────────────────────────────────────────────────────────

/** Token grammar: letter + signed tics + optional 'b' (bright). 'L-1' = hold forever. */
const FRAME_TOKEN = /^([A-Za-z[\]\\])(-?\d+)(b?)$/

/**
 * Parse one frame token: `'A4'` → held A for 4 tics; `'G6b'` → bright; `'L-1'`
 * → hold forever (the resting corpse). Unparseable tokens fall back to a 1-tic
 * 'A' so the table never produces an undefined frame.
 */
function f(token: string): StateFrame {
  const m = FRAME_TOKEN.exec(token)
  if (m === null) {
    return { letter: 'A', tics: 1 }
  }
  const letter = m[1] ?? 'A'
  const tics = Number.parseInt(m[2] ?? '1', 10)
  const frame: StateFrame = { letter, tics }
  return m[3] === 'b' ? { ...frame, bright: true } : frame
}

/** Build a sequence from a space-separated spec, e.g. `seq('A4 B4 C4 D4', true)`. */
function seq(spec: string, loop = false): StateSeq {
  const frames = spec
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(f)
  return loop ? { frames, loop: true } : { frames }
}

/**
 * The full BASE monster roster. Letters are taken from Doom's `info.c` state
 * tables, every one constrained to the frame letters present in the atlas. The
 * attack pose is `melee` and/or `missile`; `pain` flinches; `death` ends on a
 * `-1` hold frame (the resting corpse). spectre reuses SARG (= demon).
 */
export const ACTOR_DEFS: Readonly<Record<EnemyKind, ActorDef>> = {
  grunt: {
    sprite: 'POSS',
    states: {
      see: seq('A4 B4 C4 D4', true),
      missile: seq('E10 F8 G8b'),
      pain: seq('H3'),
      death: seq('H5 I5 J5 K5 L-1'),
    },
  },
  shotgunGuy: {
    sprite: 'SPOS',
    states: {
      see: seq('A3 B3 C3 D3', true),
      missile: seq('E10 F10 G10b'),
      pain: seq('H3 H3'),
      death: seq('H5 I5 J5 K5 L5 M-1'),
    },
  },
  chaingunner: {
    sprite: 'CPOS',
    states: {
      see: seq('A3 B3 C3 D3 A3 B3 C3 D3', true),
      missile: seq('E10 F4b G4b F4b G4b'),
      pain: seq('H6'),
      death: seq('H5 I5 J5 K5 L5 M5 N-1'),
    },
  },
  imp: {
    sprite: 'TROO',
    states: {
      see: seq('A3 B3 C3 D3', true),
      melee: seq('E8 F8 G6'),
      missile: seq('E8 F8 G6b'),
      pain: seq('H2 H2'),
      death: seq('I8 J8 K6 L6 M-1'),
    },
  },
  demon: {
    sprite: 'SARG',
    states: {
      see: seq('A2 B2 C2 D2', true),
      melee: seq('E8 F8 G8'),
      pain: seq('H2'),
      death: seq('I8 J8 K4 L4 M4 N-1'),
    },
  },
  spectre: {
    sprite: 'SARG',
    states: {
      see: seq('A2 B2 C2 D2 A2 B2', true),
      melee: seq('E8 F8 G8 F8'),
      pain: seq('H2 H2'),
      death: seq('I8 J8 K4 L4 M4 N-1'),
    },
  },
  lostSoul: {
    sprite: 'SKUL',
    states: {
      see: seq('A6 B6', true),
      missile: seq('C10b D10b E10b'),
      pain: seq('G3 G3'),
      death: seq('I6 J6 K-1'),
    },
  },
  cacodemon: {
    sprite: 'HEAD',
    states: {
      see: seq('A8', true),
      missile: seq('B5 C5 D5b'),
      pain: seq('E8 F8'),
      death: seq('G8 H8 I8 J8 K8 L-1'),
    },
  },
  hellKnight: {
    sprite: 'BOS2',
    states: {
      see: seq('A3 B3 C3 D3', true),
      melee: seq('E8 F8 G8'),
      missile: seq('E8 F8 G8b'),
      pain: seq('H2'),
      death: seq('I8 J8 K8 L8 M8 N-1'),
    },
  },
  baron: {
    sprite: 'BOSS',
    states: {
      see: seq('A4 B4 C4 D4', true),
      melee: seq('E9 F9 G9'),
      missile: seq('E9 F9 G9b'),
      pain: seq('H3'),
      death: seq('I7 J7 K7 L7 M7 N-1'),
    },
  },
  mancubus: {
    sprite: 'FATT',
    states: {
      see: seq('A4 A4 B4 B4 C4 C4', true),
      missile: seq('E10 F10b G10b'),
      pain: seq('I3 I3'),
      death: seq('J6 K6 L6 M6 N6 O6 P-1'),
    },
  },
  arachnotron: {
    sprite: 'BSPI',
    states: {
      see: seq('A4 B4 C4 D4 E4 F4', true),
      missile: seq('A10b G6b H6b'),
      pain: seq('I3 I3'),
      death: seq('J6 K6 L6 M6 N6 O-1'),
    },
  },
  revenant: {
    sprite: 'SKEL',
    states: {
      see: seq('A2 B2 C2 D2 E2 F2', true),
      melee: seq('G6 H6 I6'),
      missile: seq('J10 K10b L10'),
      pain: seq('M5'),
      death: seq('M7 N7 O7 P7 Q-1'),
    },
  },
}

/** Pick the sequence for a phase, falling back to `see` when the phase is undefined. */
function seqForPhase(def: ActorDef, phase: ActorPhase): StateSeq {
  const states = def.states
  switch (phase) {
    case 'death':
    case 'corpse':
      return states.death
    case 'melee':
      return states.melee ?? states.see
    case 'missile':
      return states.missile ?? states.see
    case 'pain':
      return states.pain ?? states.see
    default:
      return states.see
  }
}

/** Resolve to { letter, bright } given a sequence and a frame index. */
function resolveAt(seq: StateSeq, index: number): ResolvedFrame {
  const frames = seq.frames
  const safeIndex = frames.length === 0 ? 0 : Math.min(Math.max(0, index), frames.length - 1)
  const frame = frames[safeIndex]
  return { letter: frame?.letter ?? 'A', bright: frame?.bright === true }
}

/**
 * Resolve the current frame for an actor's `phase` at `clockSeconds`. Pure.
 *
 * Tics accumulate at 35Hz; a frame with tics < 0 holds forever (the resting corpse).
 * A looping sequence wraps over its total non-negative tic length. `corpse` pins the
 * death sequence's LAST frame regardless of the clock.
 */
export function resolveActorFrame(
  def: ActorDef,
  phase: ActorPhase,
  clockSeconds: number,
): ResolvedFrame {
  const seq = seqForPhase(def, phase)
  const frames = seq.frames

  if (phase === 'corpse') {
    return resolveAt(seq, frames.length - 1)
  }

  const tics = Math.max(0, clockSeconds) * TICS_PER_SECOND

  // Sum the non-negative tic length up to (but not including) any hold-forever frame.
  let totalTics = 0
  let firstHold = -1
  for (let i = 0; i < frames.length; i++) {
    const ft = frames[i]?.tics ?? 0
    if (ft < 0) {
      firstHold = i
      break
    }
    totalTics += ft
  }

  // Looping sequences with positive length wrap; everything else clamps.
  let cursor = tics
  if (seq.loop === true && totalTics > 0) {
    cursor = tics % totalTics
  }

  let acc = 0
  for (let i = 0; i < frames.length; i++) {
    const ft = frames[i]?.tics ?? 0
    if (ft < 0) {
      // Hold-forever frame reached — stay here.
      return resolveAt(seq, i)
    }
    acc += ft
    if (cursor < acc) {
      return resolveAt(seq, i)
    }
  }

  // Past the end of a non-looping sequence: hold the final frame (or its hold frame).
  if (firstHold >= 0) {
    return resolveAt(seq, firstHold)
  }
  return resolveAt(seq, frames.length - 1)
}
