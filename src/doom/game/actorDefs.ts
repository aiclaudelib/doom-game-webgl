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
  /** Arch-vile resurrection / heal pose (VILE '[' '\' ']'); falls back to `see` elsewhere. */
  readonly heal?: StateSeq
}

/** One actor: its 4-letter sprite prefix and its state table. */
export interface ActorDef {
  readonly sprite: string
  readonly states: ActorStates
}

/**
 * A resolved frame for the renderer: which letter to draw, and whether it is fullbright.
 * `bright` is CONSUMED by the renderer: world.ts copies it onto SpriteInstance.bright and
 * renderSprites skips distance shading for that frame (muzzle flashes, fireball windups…).
 */
export interface ResolvedFrame {
  readonly letter: string
  readonly bright: boolean
}

/** The phases the resolver understands. `corpse` holds the death sequence's last frame. */
export type ActorPhase = 'see' | 'melee' | 'missile' | 'pain' | 'death' | 'corpse' | 'heal'

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
  // Pain Elemental — PAIN: float see A-C, A_PainAttack missile pose D-F (F bright),
  // pain G, death H-M (doomBehaviorSpec.md §3.1). No direct attack; world spawns skulls.
  painElemental: {
    sprite: 'PAIN',
    states: {
      see: seq('A3 B3 C3', true),
      missile: seq('D4 E4 F4b'),
      pain: seq('G6 G6'),
      death: seq('H8 I8 J8 K8 L8 M-1'),
    },
  },
  // Arch-vile — VILE: fast see A-F, the fire-attack pose G-J (J bright), pain K, the
  // resurrection heal pose '[' '\' ']', death S-Y. Fire damage is handled specially
  // in enemy.ts (instant LOS hit, not a missile); resurrection is world-side.
  archvile: {
    sprite: 'VILE',
    states: {
      see: seq('A2 B2 C2 D2 E2 F2', true),
      missile: seq('G8 H8 I8 J8b'),
      pain: seq('K5'),
      heal: seq('[6 \\6 ]6'),
      death: seq('S7 T7 U7 V7 W7 X7 Y-1'),
    },
  },
  // Cyberdemon — CYBR: see A-D, the 3-frame rocket attack E-G (each spawns a rocket),
  // pain H, death I-P (doomBehaviorSpec.md §3.1). HP4000, splash-immune.
  cyberdemon: {
    sprite: 'CYBR',
    states: {
      see: seq('A4 B4 C4 D4', true),
      missile: seq('E6 F6 G6'),
      pain: seq('H6'),
      death: seq('I9 J9 K9 L9 M9 N9 O9 P-1'),
    },
  },
  // Spider Mastermind — SPID: wide see A-F, the 3-bullet hitscan burst G-H (H bright),
  // pain I, death J-S (doomBehaviorSpec.md §3.1). HP3000, radius 2.0, splash-immune.
  spiderMastermind: {
    sprite: 'SPID',
    states: {
      see: seq('A3 B3 C3 D3 E3 F3', true),
      missile: seq('A4 G4b H4b'),
      pain: seq('I3'),
      death: seq('J6 K6 L6 M6 N6 O6 P6 Q6 R6 S-1'),
    },
  },
  // Explosive barrel — idle BAR1 A/B @6t. The death blast uses the separate BEXP
  // lump, so world.ts special-cases the barrel's billboard entirely; this entry only
  // keeps the Record<EnemyKind, ActorDef> total satisfied with a sane idle fallback.
  barrel: {
    sprite: 'BAR1',
    states: {
      see: seq('A6 B6', true),
      death: seq('A6 B6 A-1'),
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
    case 'heal':
      return states.heal ?? states.see
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
