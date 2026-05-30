// Decoration props (doomBehaviorSpec.md §3.5). Render-only billboards — a conscious
// simplification: props do NOT collide (see §4 "Props mostly cosmetic"). Pure data +
// two tiny pure functions; zero DOM, deterministic, headless-safe. world.ts owns the
// live prop list, ticks updateProp, and renders each via the sprite atlas (skipping
// props entirely when no atlas is loaded — decor is optional in the procedural look).

import type { Prop, PropKind } from '~/doom/types'

/** Doom's state machine runs at 35Hz; animated props loop on this logical clock. */
const TICS_PER_SECOND = 35

/**
 * Static per-kind prop data, faithful to §3.5 sprite prefixes + animation.
 * - `sprite`     4-letter atlas lump prefix.
 * - `frame`      the single static frame letter for non-animated props (default 'A').
 * - `animLetters`+`animTics` an animated loop: each consecutive letter shows for
 *   `animTics` tics on the 35Hz clock (the few animated props: lamps, torches,
 *   heart pillar, twitching victim, flickering gore).
 * - `fullbright` render ignoring sector light (lamps/torches/candles/self-lit gore).
 *   CONSUMED by the renderer: world.ts sets SpriteInstance.bright from it, and
 *   renderSprites then skips distance shading for the billboard.
 * - `ceiling`    MF_SPAWNCEILING → pin the billboard near the ceiling.
 */
export interface PropDef {
  readonly sprite: string
  readonly frame?: string
  readonly animLetters?: string
  readonly animTics?: number
  readonly fullbright?: boolean
  readonly ceiling?: boolean
}

/** Animation cadence reused by every 4-frame torch/lamp loop (§3.5: @4t). */
const TORCH = { animLetters: 'ABCD', animTics: 4, fullbright: true } as const

export const PROP_DEFS: Readonly<Record<PropKind, PropDef>> = {
  // Lamps / torches / candles — fullbright.
  techLamp: { sprite: 'TLMP', ...TORCH },
  shortTechLamp: { sprite: 'TLP2', ...TORCH },
  floorLamp: { sprite: 'COLU', fullbright: true },
  candelabra: { sprite: 'CBRA', fullbright: true },
  redTorch: { sprite: 'TRED', ...TORCH },
  greenTorch: { sprite: 'TGRN', ...TORCH },
  blueTorch: { sprite: 'TBLU', ...TORCH },
  shortRedTorch: { sprite: 'SMRT', ...TORCH },
  shortGreenTorch: { sprite: 'SMGT', ...TORCH },
  shortBlueTorch: { sprite: 'SMBT', ...TORCH },
  candle: { sprite: 'CAND', fullbright: true },
  // Pillars / columns — sector-lit. Heart pillar pulses A/B @14t.
  greenPillar: { sprite: 'COL1' },
  shortGreenPillar: { sprite: 'COL2' },
  redPillar: { sprite: 'COL3' },
  shortRedPillar: { sprite: 'COL4' },
  heartPillar: { sprite: 'COL5', animLetters: 'AB', animTics: 14 },
  skullPillar: { sprite: 'COL6' },
  // Trees.
  torchTree: { sprite: 'TRE1' },
  bigTree: { sprite: 'TRE2' },
  // Hanging victims — ceiling-anchored. The twitcher animates A/B/C @ ~10t.
  hangingVictim: { sprite: 'GOR1', animLetters: 'ABCB', animTics: 10, ceiling: true },
  hangingArmsOut: { sprite: 'GOR2', ceiling: true },
  hangingLeg: { sprite: 'GOR5', ceiling: true },
  hangingTorso: { sprite: 'HDB3', ceiling: true },
  // Floor corpses / gore — pass-through floor decor.
  deadMarine: { sprite: 'PLAY', frame: 'N' },
  gibbedMarine: { sprite: 'PLAY', frame: 'W' },
  deadZombie: { sprite: 'POSS', frame: 'L' },
  deadShotgunGuy: { sprite: 'SPOS', frame: 'L' },
  deadImp: { sprite: 'TROO', frame: 'M' },
  deadDemon: { sprite: 'SARG', frame: 'N' },
  deadCacodemon: { sprite: 'HEAD', frame: 'L' },
  poolOfBlood: { sprite: 'POB1' },
}

/** Lookup the static prop data for a kind. */
export function propDef(kind: PropKind): PropDef {
  return PROP_DEFS[kind]
}

/** Create a fresh prop at the given world position with a zeroed anim clock. */
export function spawnProp(kind: PropKind, x: number, y: number): Prop {
  return { kind, pos: { x, y }, animTimer: 0 }
}

/** Advance a prop's animation clock by dt seconds (the only per-tick prop work). */
export function updateProp(prop: Prop, dt: number): void {
  prop.animTimer += dt
}

/**
 * Resolve the sprite frame LETTER to draw for a prop at its current anim clock.
 * Static props return their single `frame` (default 'A'); animated props step their
 * `animLetters` loop on the 35Hz clock. Pure — safe to call every render.
 */
export function propFrameLetter(prop: Prop): string {
  const def = PROP_DEFS[prop.kind]
  const letters = def.animLetters
  if (letters === undefined || letters.length === 0) {
    return def.frame ?? 'A'
  }
  const tics = def.animTics ?? 4
  const step = Math.floor((prop.animTimer * TICS_PER_SECOND) / tics) % letters.length
  return letters[step] ?? letters[0] ?? 'A'
}
