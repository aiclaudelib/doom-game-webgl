// Scalar math utilities: clamping, interpolation, angle wrapping. Pure leaf, no imports.

const TWO_PI = Math.PI * 2

export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min
  if (v > max) return max
  return v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Wrap an angle to the half-open range (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let r = a % TWO_PI
  if (r > Math.PI) r -= TWO_PI
  else if (r <= -Math.PI) r += TWO_PI
  return r
}

/** Shortest signed rotation taking angle a to angle b, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return normalizeAngle(b - a)
}

export function sign(v: number): number {
  if (v > 0) return 1
  if (v < 0) return -1
  return 0
}

/** Step current toward target by at most maxDelta, never overshooting. */
export function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + sign(delta) * maxDelta
}
