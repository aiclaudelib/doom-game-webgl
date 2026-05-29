// Shared procedural-pattern math: deterministic hashes and value/fractal noise.
// Pure functions, zero imports — the leaf every texture generator builds on.

/**
 * Deterministic integer hash → float in [0, 1). Mixes integer cell coordinates
 * and a seed via a few rounds of multiply/xor scrambling. Stable across runs.
 */
export function hash2(x: number, y: number, seed: number): number {
  // Work in unsigned 32-bit space so results are reproducible everywhere.
  let h =
    (Math.floor(x) | 0) * 374761393 + (Math.floor(y) | 0) * 668265263 + (seed | 0) * 2147483647
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/** Smoothstep easing (3t² − 2t³) for noise interpolation. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Linear interpolation between a and b. */
function mixf(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Bilinearly-smoothed value noise sampled at (x, y) → [0, 1). Lattice corners are
 * hashed integers; the fractional position is eased with smoothstep before blending.
 */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const c00 = hash2(x0, y0, seed)
  const c10 = hash2(x0 + 1, y0, seed)
  const c01 = hash2(x0, y0 + 1, seed)
  const c11 = hash2(x0 + 1, y0 + 1, seed)
  const top = mixf(c00, c10, fx)
  const bottom = mixf(c01, c11, fx)
  return mixf(top, bottom, fy)
}

/**
 * Fractal Brownian motion: sum of octaves of value noise at doubling frequency and
 * halving amplitude, normalized back to [0, 1). At least one octave is always taken.
 */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  const count = Math.max(1, Math.floor(octaves))
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let total = 0
  for (let i = 0; i < count; i++) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 1013) * amplitude
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total > 0 ? sum / total : 0
}
