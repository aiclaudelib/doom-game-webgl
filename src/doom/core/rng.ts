// Deterministic seeded pseudo-randomness. Every procedural system threads an Rng
// from here so output is reproducible and testable. Pure leaf.

import type { Rng } from '~/doom/types'

/** mulberry32 — a fast deterministic 32-bit PRNG producing floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

/** Integer in [min, max], inclusive of both endpoints. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p
}

/** Pick a uniformly-random element; the non-empty tuple guarantees element 0 exists. */
export function pick<T>(rng: Rng, items: readonly [T, ...T[]]): T {
  const index = Math.floor(rng() * items.length)
  return items[index] ?? items[0]
}
